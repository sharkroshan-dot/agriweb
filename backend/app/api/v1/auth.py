from fastapi import APIRouter, Depends, HTTPException, status, Body, Form, Request
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from datetime import datetime, timedelta
from typing import Optional
import logging

from bson import ObjectId

from app.core.security import Security, validate_password_strength
from app.core.config import settings
from app.utils.helpers import normalize_phone_number
from app.utils.totp import generate_secret, verify_code, otpauth_uri
from app.schemas.auth import (
    UserRegister, UserLogin, TokenResponse, 
    OTPRequest, OTPVerify, PasswordResetRequest,
    PasswordReset, UserResponse
)
from app.services.auth_service import AuthService
from app.services.user_service import UserService
from app.services.notification_service import NotificationService
from app.services.audit_service import AuditService
from app.services.risk_engine import risk_engine
from app.repositories.session_repository import session_repository
from app.repositories.user_repository import user_repository
from app.database.redis import RedisClient

logger = logging.getLogger(__name__)
router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

# Roles that are required to use TOTP once enabled.
PRIVILEGED_ROLES = {"admin", "super_admin", "finance", "support", "operations", "security"}


def _client_info(request: Request):
    ip = request.client.host if request.client else None
    ua = (request.headers.get("user-agent") or "")[:300]
    return ip, ua


def _device_label(ua: str) -> str:
    """Coarse device label from a User-Agent string (no external libs)."""
    ua_l = ua.lower()
    if "mobile" in ua_l:
        kind = "mobile"
    elif "tablet" in ua_l:
        kind = "tablet"
    else:
        kind = "desktop"
    os = "unknown"
    for needle, name in (("windows", "Windows"), ("android", "Android"), ("iphone", "iOS"), ("ipad", "iPadOS"), ("mac os", "macOS"), ("linux", "Linux")):
        if needle in ua_l:
            os = name
            break
    return f"{kind} / {os}"


async def _register_session(user_id: str, jti: str, ip: Optional[str], ua: str) -> None:
    """Record a login session (best-effort)."""
    try:
        await session_repository.create_session({
            "userId": ObjectId(user_id),
            "jti": jti,
            "ip": ip,
            "userAgent": ua,
            "device": _device_label(ua),
        })
    except Exception as exc:
        logger.error(f"Session registration failed: {exc}")


def _jti_from_token(token: str) -> Optional[str]:
    payload = Security.decode_token(token)
    return payload.get("jti") if payload else None


class LoginForm(OAuth2PasswordRequestForm):
    """Password login form with an optional TOTP code for MFA users."""
    totp_code: Optional[str] = Form(None)


async def _send_otp_for_phone(phone: str, otp_type: str, otp: Optional[str] = None, email: Optional[str] = None) -> dict:
    """Store an OTP and attempt delivery for the given phone number.

    The OTP is stored as a salted SHA-256 hash together with an attempt counter;
    the raw value is never persisted.
    """
    otp_value = otp or Security.generate_otp()
    try:
        normalized_phone = normalize_phone_number(phone)
    except Exception as exc:
        logger.error("Phone normalization failed for %s: %s", phone, exc)
        return {"sent": False, "otp": otp_value, "email_sent": False, "sms_sent": False}

    try:
        cache_key = f"otp:{normalized_phone}"
        cache_data = {
            "otp_hash": Security.hash_otp(otp_value),
            "type": otp_type,
            "attempts": 0,
        }

        await RedisClient.set_cache(
            cache_key,
            cache_data,
            ttl=settings.OTP_EXPIRY_MINUTES * 60,
        )

        email_sent = True
        if email:
            email_sent = await NotificationService.send_otp_email(email, otp_value)
            if not email_sent and settings.DEBUG:
                logger.warning("Email delivery failed for %s", email)
        sms_result = await NotificationService.send_otp(normalized_phone, otp_value)

        if settings.DEBUG:
            border = "=" * 60
            logger.warning(f"\n{border}\nDEVELOPMENT OTP: {otp_value}\nFor phone: {normalized_phone}\nFor email: {email or 'N/A'}\n{border}\n")

        otp_sent = email_sent or sms_result
        return {"sent": otp_sent, "otp": otp_value, "email_sent": email_sent, "sms_sent": sms_result}
    except Exception as exc:
        logger.error(f"OTP storage or delivery failed for {phone}: {exc}", exc_info=True)
        return {"sent": False, "otp": otp_value, "email_sent": False, "sms_sent": False}


async def _send_registration_otp(user: dict, phone: str) -> dict:
    """Store and send a registration OTP for the given user/phone."""
    return await _send_otp_for_phone(phone, "registration", email=user.get("email"))

# Dependency
async def _revoked_tokens() -> set:
    """Return the set of revoked token jtis (empty when Redis is down)."""
    data = await RedisClient.get_cache("auth:revoked_jtis")
    return set(data) if data else set()


async def _revoke_token(token: str):
    """Add a token's jti to the revocation denylist for its remaining lifetime."""
    payload = Security.decode_token(token)
    jti = payload.get("jti")
    exp = payload.get("exp")
    if not jti:
        return
    revoked = await _revoked_tokens()
    revoked.add(jti)
    ttl = max(60, int(exp - datetime.utcnow().timestamp())) if exp else settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60
    await RedisClient.set_cache("auth:revoked_jtis", list(revoked), ttl=ttl)


async def _is_token_revoked(token: str) -> bool:
    payload = Security.decode_token(token)
    jti = payload.get("jti")
    if not jti:
        return True  # refuse tokens without a jti (e.g. old forged ones)
    revoked = await _revoked_tokens()
    return jti in revoked


async def get_current_user(token: str = Depends(oauth2_scheme)):
    """Get current user from token.

    Sensitive fields (password hash, reset tokens) are stripped before the
    user document is handed to endpoint handlers, so they can never be
    serialized into responses.
    """
    if await _is_token_revoked(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been revoked",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = Security.decode_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user = await UserService.get_user_by_id(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not user.get("isActive"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is inactive",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # PII / secret minimization: never expose the password hash or reset tokens.
    user = {k: v for k, v in user.items() if k not in ("passwordHash", "passwordResetToken", "otpHash")}
    
    return user

@router.post("/register", response_model=dict, status_code=status.HTTP_201_CREATED)
async def register(user_data: UserRegister):
    """
    Register a new user.
    
    - **email**: Valid email address
    - **phone**: Valid phone number with country code
    - **password**: Strong password (8+ chars, uppercase, lowercase, digit, special)
    - **firstName**: User's first name
    - **lastName**: User's last name
    - **role**: User role (customer, farmer, delivery, warehouse)
    """
    # Check if user already exists.
    existing_user = await UserService.get_user_by_email(user_data.email)
    if existing_user is None:
        existing_user = await UserService.get_user_by_phone(user_data.phone)

    if existing_user:
        is_verified = bool(existing_user.get("isVerified", existing_user.get("is_verified", False)))
        if is_verified:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Account already exists. Please sign in instead."
            )

        otp_delivery = await _send_registration_otp(existing_user, existing_user.get("phone", user_data.phone))
        otp_sent = otp_delivery["sent"]
        return {
            "success": True,
            "data": {
                "userId": str(existing_user["_id"]),
                "email": existing_user["email"],
                "phone": existing_user["phone"],
                "role": existing_user.get("role", user_data.role),
                "requiresVerification": True,
                "otpSent": otp_sent,
                "delivery": {
                    "email": otp_delivery["email_sent"],
                    "phone": otp_delivery["sms_sent"],
                },
                "existingAccount": True,
            },
            "message": (
                "Account already exists but is not verified. We sent a new OTP."
                if otp_sent
                else "Account already exists but is not verified. You can request a new OTP from login."
            ),
        }

    # Validate password strength
    is_valid, message = validate_password_strength(user_data.password)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=message
        )
    
    # Create user
    try:
        user = await AuthService.register_user(user_data.dict())
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc)
        )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Registration failed"
        )

    logger.info(f"User registered successfully: {user.get('email')}, phone: {user.get('phone')}")
    otp_delivery = await _send_registration_otp(user, user_data.phone)
    otp_sent = otp_delivery["sent"]
    logger.info(f"OTP send result for registration: {otp_sent}")

    return {
        "success": True,
        "data": {
            "userId": str(user["_id"]),
            "email": user["email"],
            "phone": user["phone"],
            "role": user_data.role,
            "requiresVerification": True,
            "otpSent": otp_sent,
            "otp": otp_delivery["otp"] if settings.DEBUG else None,
            "delivery": {
                "email": otp_delivery["email_sent"],
                "phone": otp_delivery["sms_sent"],
            }
        },
        "message": (
            "Registration successful. Please verify your phone number."
            if otp_sent
            else "Registration successful, but we could not send the OTP right now. You can request a new one from login."
        )
    }

def _build_user_response(user: dict) -> UserResponse:
    """Map a stored user document into the response schema."""
    return UserResponse(
        id=str(user["_id"]),
        email=user["email"],
        phone=user["phone"],
        first_name=user.get("first_name") or user.get("firstName", ""),
        last_name=user.get("last_name") or user.get("lastName", ""),
        role=user["role"],
        avatar_url=user.get("avatarUrl") or user.get("avatar_url"),
        is_verified=bool(user.get("isVerified", user.get("is_verified", False))),
        is_active=bool(user.get("isActive", user.get("is_active", True))),
        created_at=user.get("createdAt") or user.get("created_at") or datetime.utcnow(),
    )

async def _log_login_event(user_id: str, role: str, ip: str, ua: str, is_new_device: bool = False) -> None:
    """Log login event with device information."""
    try:
        await AuditService.log(
            actor_id=user_id,
            actor_role=role,
            action="login",
            resource="auth",
            outcome="success" if not is_new_device else "new_device",
            ip=ip,
            user_agent=ua,
            metadata={"newDevice": is_new_device},
        )
    except Exception as exc:
        logger.error(f"Login event logging failed: {exc}")


@router.post("/login", response_model=TokenResponse)
async def login(form_data: LoginForm = Depends(), request: Request = None):
    """
    Login with email/phone and password.
    
    - **username**: Email or phone number
    - **password**: User password
    - **totp_code**: Required when the account has 2FA enabled
    """
    ip, ua = _client_info(request) if request else (None, "")
    # Check if username is email or phone
    user = await AuthService.authenticate_user(form_data.username, form_data.password)
    if not user:
        await AuditService.log(
            actor_id=None, actor_role=None, action="login", resource="auth",
            outcome="failure", ip=ip, user_agent=ua,
            metadata={"reason": "bad_credentials"},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email/phone or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 2FA: privileged accounts with TOTP enabled must present a valid code.
    if user.get("totpEnabled") and user.get("role") in PRIVILEGED_ROLES:
        totp_code = (form_data.totp_code or "").strip()
        if not totp_code or not verify_code(user.get("totpSecret", ""), totp_code):
            await AuditService.log(
                actor_id=str(user["_id"]), actor_role=user.get("role"), action="login",
                resource="auth", outcome="failure", ip=ip, user_agent=ua,
                metadata={"reason": "mfa_failed"},
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Two-factor authentication code required or invalid",
                headers={"WWW-Authenticate": "Bearer"},
            )

    # Check if user is verified
    if not user.get("isVerified", user.get("is_verified", False)):
        otp_delivery = await _send_otp_for_phone(user["phone"], "verification", email=user.get("email"))
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Email/Phone not verified. OTP sent again."
                if otp_delivery["sent"]
                else "Email/Phone not verified. OTP could not be delivered right now."
            )
        )
    
    # Detect new device based on IP + User-Agent fingerprint
    user_id = str(user["_id"])
    is_new_device = False
    device_key = f"device:{user_id}:{ua or 'no-ua'}"
    devices = await RedisClient.get_cache("active_devices") or {}
    user_devices = devices.get(user_id, [])
    if ua and user_id not in user_devices:
        # Simple new device detection: check if this UA+IP combo exists
        existing_ua = next((d for d in user_devices if d.get("ua") == ua), None)
        if not existing_ua:
            is_new_device = True
            user_devices.append({"ua": ua, "ip": ip, "lastSeen": datetime.utcnow().isoformat()})
            # Keep only last 5 devices per user
            if len(user_devices) > 5:
                user_devices = user_devices[-5:]
            devices[user_id] = user_devices
            await RedisClient.set_cache("active_devices", devices, ttl=86400 * 30)
    
    # Log new device detection
    await _log_login_event(str(user["_id"]), user.get("role"), ip, ua, is_new_device)
    
    # Create tokens
    access_token = Security.create_access_token(
        data={"sub": str(user["_id"]), "role": user["role"]}
    )
    refresh_token = Security.create_refresh_token(
        data={"sub": str(user["_id"])}
    )
    
    # Update last login
    await UserService.update_last_login(str(user["_id"]))

    # Record the session and evaluate login risk.
    await _register_session(str(user["_id"]), _jti_from_token(access_token) or "", ip, ua)
    await AuditService.log(
        actor_id=str(user["_id"]), actor_role=user.get("role"), action="login",
        resource="auth", outcome="success", ip=ip, user_agent=ua,
    )
    
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=_build_user_response(user)
    )

@router.post("/login/otp")
async def login_otp(otp_request: OTPRequest):
    """
    Request OTP for phone login.
    
    - **phone**: Phone number with country code
    """
    normalized_phone = normalize_phone_number(otp_request.phone)
    user = await UserService.get_user_by_phone(normalized_phone)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Phone number not registered"
        )
    
    otp_delivery = await _send_otp_for_phone(normalized_phone, "login", email=user.get("email"))
    otp_sent = otp_delivery["sent"]

    return {
        "success": True,
        "data": {
            "otpSent": otp_sent,
            "otp": otp_delivery["otp"] if settings.DEBUG else None,
            "delivery": {
                "email": otp_delivery["email_sent"],
                "phone": otp_delivery["sms_sent"],
            },
            "expiresIn": settings.OTP_EXPIRY_MINUTES * 60
        },
        "message": (
            "OTP sent successfully"
            if otp_sent
            else "OTP was generated but could not be delivered right now."
        )
    }

@router.post("/verify-otp")
async def verify_otp(otp_data: OTPVerify, request: Request = None):
    """
    Verify OTP and login.
    
    - **phone**: Phone number
    - **otp**: OTP code
    """
    ip, ua = _client_info(request) if request else (None, "")
    # Get OTP from cache
    try:
        normalized_phone = normalize_phone_number(otp_data.phone)
    except Exception as exc:
        logger.error(f"Phone normalization failed for {otp_data.phone}: {exc}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid phone number format"
        )
    
    cache_key = f"otp:{normalized_phone}"

    cached_data = await RedisClient.get_cache(cache_key)
    if not cached_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OTP expired or invalid"
        )

    # Attempt lockout: max 5 wrong attempts invalidates the OTP.
    attempts = int(cached_data.get("attempts", 0) or 0)
    if attempts >= 5:
        await RedisClient.delete_cache(cache_key)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many incorrect attempts. Request a new OTP."
        )

    stored_hash = cached_data.get("otp_hash")
    if not stored_hash or not Security.verify_otp(otp_data.otp, stored_hash):
        attempts += 1
        await RedisClient.set_cache(
            cache_key,
            {**cached_data, "attempts": attempts},
            ttl=settings.OTP_EXPIRY_MINUTES * 60,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid OTP"
        )
    
    # Get user
    user = await UserService.get_user_by_phone(normalized_phone)
    if not user:
        logger.warning(f"User not found for phone: {normalized_phone}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Mark as verified if not
    if not user.get("isVerified", user.get("is_verified", False)):
        await UserService.mark_verified(str(user["_id"]))
        user["isVerified"] = True
        user["is_verified"] = True
    
    # Create tokens
    access_token = Security.create_access_token(
        data={"sub": str(user["_id"]), "role": user["role"]}
    )
    refresh_token = Security.create_refresh_token(
        data={"sub": str(user["_id"])}
    )
    
    # Delete OTP from cache
    await RedisClient.delete_cache(cache_key)
    logger.info(f"OTP verification successful for {normalized_phone}")

    # Record the session and audit the login.
    await _register_session(str(user["_id"]), _jti_from_token(access_token) or "", ip, ua)
    await AuditService.log(
        actor_id=str(user["_id"]), actor_role=user.get("role"), action="login",
        resource="auth", outcome="success", ip=ip, user_agent=ua,
        metadata={"method": "otp"},
    )
    
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=_build_user_response(user)
    )

@router.get("/debug/otp/{phone}", include_in_schema=False)
async def debug_otp(phone: str, current_user: dict = Depends(get_current_user)):
    """Debug endpoint to check if OTP exists in Redis. DEBUG + admin only."""
    if not settings.DEBUG:
        raise HTTPException(status_code=403, detail="Only available in debug mode")
    if current_user.get("role") not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Admin privileges required")
    try:
        normalized_phone = normalize_phone_number(phone)
    except Exception as exc:
        return {"error": f"Phone normalization failed: {exc}"}
    
    cache_key = f"otp:{normalized_phone}"
    cached_data = await RedisClient.get_cache(cache_key)
    
    return {
        "phone_input": phone,
        "normalized_phone": normalized_phone,
        "cache_key": cache_key,
        "otp_exists": cached_data is not None,
        "otp_data": (
            {
                "type": cached_data.get("type"),
                "attempts": cached_data.get("attempts", 0),
            } if cached_data else None
        ),
    }


@router.post("/refresh")
async def refresh_token(refresh_token: str = Body(..., embed=True)):
    """Refresh access token."""
    payload = Security.decode_token(refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token"
        )

    if await _is_token_revoked(refresh_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token has been revoked"
        )

    user_id = payload.get("sub")
    user = await UserService.get_user_by_id(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found"
        )

    if not user.get("isActive"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is inactive"
        )

    # Create new access token
    access_token = Security.create_access_token(
        data={"sub": str(user["_id"]), "role": user["role"]}
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "expires_in": settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60
    }

@router.post("/logout")
async def logout(
    refresh_token: Optional[str] = Body(None, embed=True),
    current_user: dict = Depends(get_current_user)
):
    """Logout: revoke the current session's refresh token server-side."""
    revoked: list[str] = []
    if refresh_token:
        payload = Security.decode_token(refresh_token)
        if payload and str(payload.get("sub")) == str(current_user["_id"]):
            await _revoke_token(refresh_token)
            revoked.append("refresh")
            await session_repository.revoke_by_jti(
                payload.get("jti") or "", "logout"
            )
    await AuditService.log(
        actor_id=str(current_user["_id"]), actor_role=current_user.get("role"),
        action="logout", resource="auth", outcome="success",
    )
    return {
        "success": True,
        "message": "Logged out successfully",
        "revoked": revoked,
    }

@router.post("/forgot-password")
async def forgot_password(email: str = Body(..., embed=True)):
    """Request password reset."""
    user = await UserService.get_user_by_email(email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Email not found"
        )
    
    # Generate reset token
    reset_token = Security.generate_password_reset_token()
    token_key = Security.digest_token(reset_token)

    # Store token (keyed by digest so the raw token is never persisted)
    await RedisClient.set_cache(
        f"password_reset:{token_key}",
        {
            "userId": str(user["_id"]),
            "email": user["email"]
        },
        ttl=settings.PASSWORD_RESET_EXPIRY_HOURS * 3600
    )
    
    # Send reset email
    await NotificationService.send_password_reset_email(
        user["email"],
        user["firstName"],
        reset_token
    )
    
    return {
        "success": True,
        "message": "Password reset email sent"
    }

@router.post("/reset-password")
async def reset_password(reset_data: PasswordReset):
    """Reset password with token."""
    # Validate password strength
    is_valid, message = validate_password_strength(reset_data.newPassword)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=message
        )
    
    # Get reset data (lookup keyed by token digest)
    reset_info = await RedisClient.get_cache(f"password_reset:{Security.digest_token(reset_data.token)}")
    if not reset_info:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token"
        )
    
    # Update password
    await UserService.update_password(
        reset_info["userId"],
        Security.get_password_hash(reset_data.newPassword)
    )
    
    # Delete reset token
    await RedisClient.delete_cache(f"password_reset:{Security.digest_token(reset_data.token)}")
    
    return {
        "success": True,
        "message": "Password reset successful"
    }

@router.get("/debug-otp", include_in_schema=False)
async def debug_get_otp(phone: str, current_user: dict = Depends(get_current_user)):
    if not settings.DEBUG:
        raise HTTPException(status_code=403, detail="Only available in debug mode")
    if current_user.get("role") not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Admin privileges required")
    from app.utils.helpers import normalize_phone_number as norm
    cache_key = f"otp:{norm(phone)}"
    data = await RedisClient.get_cache(cache_key)
    if data:
        return {
            "success": True,
            "phone": phone,
            "otp_exists": True,
            "type": data.get("type"),
            "attempts": data.get("attempts", 0),
        }
    return {"success": False, "message": "No OTP found for this phone number"}


# ============== SESSIONS ==============

@router.get("/sessions")
async def list_sessions(current_user: dict = Depends(get_current_user)):
    """List the current user's active sessions/devices."""
    sessions = await session_repository.get_active_by_user(str(current_user["_id"]))
    for s in sessions:
        s["id"] = str(s.pop("_id", ""))
        s.pop("jti", None)
    return {"success": True, "data": {"sessions": sessions, "count": len(sessions)}}


@router.post("/sessions/{jti}/revoke")
async def revoke_session(
    jti: str,
    token: str = Depends(oauth2_scheme),
    current_user: dict = Depends(get_current_user),
):
    """Revoke a single session by its jti (own sessions only)."""
    session = await session_repository.get_by_jti(jti)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    owner = str(session.get("userId") or "")
    if owner != str(current_user["_id"]) and current_user.get("role") not in PRIVILEGED_ROLES:
        raise HTTPException(status_code=403, detail="You can only revoke your own sessions")

    current_jti = _jti_from_token(token) or ""
    if jti == current_jti:
        raise HTTPException(status_code=400, detail="Use logout to end the current session")

    await session_repository.revoke_by_jti(jti, "user_revoked")
    await AuditService.log(
        actor_id=str(current_user["_id"]), actor_role=current_user.get("role"),
        action="revoke_session", resource="session", resource_id=jti, outcome="success",
    )
    return {"success": True, "message": "Session revoked"}


@router.post("/sessions/revoke-all")
async def revoke_all_sessions(
    token: str = Depends(oauth2_scheme),
    current_user: dict = Depends(get_current_user),
):
    """Revoke all sessions except the current one (logout everywhere else)."""
    current_jti = _jti_from_token(token) or ""
    count = await session_repository.revoke_all_for_user(
        str(current_user["_id"]), except_jti=current_jti
    )
    await AuditService.log(
        actor_id=str(current_user["_id"]), actor_role=current_user.get("role"),
        action="revoke_all_sessions", resource="session", outcome="success",
        metadata={"revoked": count},
    )
    return {"success": True, "message": "Other sessions revoked", "revoked": count}


# ============== 2FA (TOTP) ==============

@router.post("/2fa/setup")
async def setup_2fa(current_user: dict = Depends(get_current_user)):
    """Generate a TOTP secret for the current user (enables on verify)."""
    secret = generate_secret()
    await UserService.update_totp_secret(str(current_user["_id"]), secret, enabled=False)
    account = current_user.get("email") or str(current_user["_id"])
    return {
        "success": True,
        "data": {
            "secret": secret,
            "otpauthUrl": otpauth_uri(secret, account),
            "instructions": "Scan with an authenticator app, then call /2fa/enable with a code.",
        },
    }


@router.post("/2fa/enable")
async def enable_2fa(code: str = Body(..., embed=True), current_user: dict = Depends(get_current_user)):
    """Activate 2FA after verifying a code generated by the setup secret."""
    secret = current_user.get("totpSecret", "")
    if not secret or not verify_code(secret, code):
        raise HTTPException(status_code=400, detail="Invalid or missing 2FA code — enter the current code shown in your authenticator app")
    await UserService.update_totp_secret(str(current_user["_id"]), secret, enabled=True)
    await AuditService.log(
        actor_id=str(current_user["_id"]), actor_role=current_user.get("role"),
        action="enable_2fa", resource="auth", outcome="success",
    )
    return {"success": True, "message": "Two-factor authentication enabled"}


@router.post("/2fa/disable")
async def disable_2fa(code: str = Body(..., embed=True), current_user: dict = Depends(get_current_user)):
    """Disable 2FA (requires a valid current code)."""
    secret = current_user.get("totpSecret", "")
    if not secret or not verify_code(secret, code):
        raise HTTPException(status_code=400, detail="Invalid 2FA code — enter the current code shown in your authenticator app")
    await UserService.update_totp_secret(str(current_user["_id"]), "", enabled=False)
    await AuditService.log(
        actor_id=str(current_user["_id"]), actor_role=current_user.get("role"),
        action="disable_2fa", resource="auth", outcome="success",
    )
    return {"success": True, "message": "Two-factor authentication disabled"}


@router.get("/2fa/status")
async def get_2fa_status(current_user: dict = Depends(get_current_user)):
    """Whether 2FA is enabled for the current user."""
    return {
        "success": True,
        "data": {
            "enabled": bool(current_user.get("totpEnabled")),
            "role": current_user.get("role"),
            "required": current_user.get("role") in PRIVILEGED_ROLES,
        },
    }


# ============== SECURITY CENTER ==============

@router.get("/security-center")
async def security_center(current_user: dict = Depends(get_current_user)):
    """Account security overview: sessions, 2FA, risk flags, verifications."""
    user_id = str(current_user["_id"])
    sessions = await session_repository.get_active_by_user(user_id)
    session_count = len(sessions)

    created_at = current_user.get("createdAt") or current_user.get("created_at")
    account_age_days = 0
    if created_at:
        try:
            account_age_days = max(0, (datetime.utcnow() - created_at).days)
        except (TypeError, ValueError):
            account_age_days = 0

    # The security-center endpoint is not itself a login event, so it must not
    # manufacture a "new device" or failed-OTP signal.
    risk_event = {
        "event_type": "security_review",
        "active_sessions": session_count,
        "is_new_device": False,
        "failed_otp_attempts": 0,
        "account_age_days": account_age_days,
    }
    risk = risk_engine.evaluate(risk_event)

    # Verification status (best-effort; KYC data may be absent).
    verification: dict = {}
    trust_score: int = 0
    try:
        from app.repositories.kyc_repository import kyc_repository
        kyc = await kyc_repository.get_by_user_id(user_id)
        if kyc:
            status_map = kyc.get("verificationStatus") or {}
            verification = {k: bool(v) for k, v in status_map.items()}
            trust_score = int(kyc.get("trustScore") or 0)
    except Exception as exc:
        logger.debug(f"Security center KYC lookup skipped: {exc}")

    return {
        "success": True,
        "data": {
            "userId": user_id,
            "role": current_user.get("role"),
            "mfaEnabled": bool(current_user.get("totpEnabled")),
            "activeSessions": session_count,
            "sessions": sessions,
            "riskScore": risk["score"],
            "riskLevel": risk["level"],
            "riskFlags": risk["flags"],
            "verification": verification,
            "trustScore": trust_score,
            "passwordChangedAt": current_user.get("passwordChangedAt"),
            "lastLoginAt": current_user.get("lastLoginAt"),
        },
    }
