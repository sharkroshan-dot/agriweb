from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from jose import JWTError, jwt
from passlib.context import CryptContext
import random
import string
import hashlib
import hmac
import secrets
from app.core.config import settings

pwd_context = CryptContext(
    schemes=["pbkdf2_sha256", "bcrypt"],
    default="pbkdf2_sha256",
    deprecated="auto",
)

# Roles a user may self-assign at registration. Privileged roles (admin,
# super_admin, finance, support, operations, security) are granted only via
# the admin seed/management scripts - never from a client-supplied payload.
SELF_REGISTRATION_ROLES = frozenset({"customer", "farmer", "delivery", "warehouse", "business"})

ALL_ROLES = frozenset({
    "customer", "farmer", "delivery", "warehouse", "business",
    "admin", "super_admin", "finance", "support", "operations", "security",
})

class Security:
    """Security utilities for authentication and encryption."""
    
    @staticmethod
    def verify_password(plain_password: str, hashed_password: str) -> bool:
        """Verify a plain password against a hashed password."""
        return pwd_context.verify(plain_password, hashed_password)
    
    @staticmethod
    def get_password_hash(password: str) -> str:
        """Hash a password."""
        return pwd_context.hash(password)
    
    @staticmethod
    def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
        """Create a JWT access token with a unique jti for revocation."""
        to_encode = data.copy()
        if expires_delta:
            expire = datetime.utcnow() + expires_delta
        else:
            expire = datetime.utcnow() + timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
        to_encode.update({
            "exp": expire,
            "type": "access",
            "jti": secrets.token_urlsafe(24),
        })
        return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    
    @staticmethod
    def create_refresh_token(data: Dict[str, Any]) -> str:
        """Create a JWT refresh token with a unique jti for revocation."""
        to_encode = data.copy()
        expire = datetime.utcnow() + timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS)
        to_encode.update({
            "exp": expire,
            "type": "refresh",
            "jti": secrets.token_urlsafe(24),
        })
        return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    
    @staticmethod
    def decode_token(token: str) -> Dict[str, Any]:
        """Decode a JWT token."""
        try:
            payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
            return payload
        except JWTError:
            return {}
    
    @staticmethod
    def generate_otp(length: int = 6) -> str:
        """Generate a numeric OTP."""
        return ''.join(random.choices(string.digits, k=length))
    
    @staticmethod
    def hash_otp(otp: str) -> str:
        """Hash an OTP with a random salt for at-rest storage (never store raw)."""
        salt = secrets.token_hex(8)
        digest = hashlib.sha256(f"{salt}:{otp}".encode()).hexdigest()
        return f"{salt}${digest}"
    
    @staticmethod
    def verify_otp(provided: str, stored_hash: str) -> bool:
        """Constant-time OTP comparison against a stored ``salt$digest`` hash."""
        try:
            salt, digest = stored_hash.split("$", 1)
        except (ValueError, AttributeError):
            return False
        candidate = hashlib.sha256(f"{salt}:{provided}".encode()).hexdigest()
        return hmac.compare_digest(candidate, digest)
    
    @staticmethod
    def generate_password_reset_token() -> str:
        """Generate a password reset token."""
        return ''.join(random.choices(string.ascii_letters + string.digits, k=64))
    
    @staticmethod
    def hash_token(token: str) -> str:
        """Hash a token for storage."""
        return pwd_context.hash(token)
    
    @staticmethod
    def digest_token(token: str) -> str:
        """Deterministic SHA-256 digest of a token, for lookup keys.

        Unlike ``hash_token`` (random-salt passlib hash) this is deterministic
        so a value can be stored under ``digest(x)`` and looked up again with
        ``digest(x)`` - without ever storing the raw token.
        """
        return hashlib.sha256(token.encode()).hexdigest()
    
    @staticmethod
    def verify_token(token: str, hashed_token: str) -> bool:
        """Verify a token against its hash."""
        return pwd_context.verify(token, hashed_token)

# Role-based access control dependency
def require_role(role: str):
    """Dependency factory that requires the current user to have a specific role."""
    from fastapi import Depends, HTTPException, status
    from app.api.v1.auth import get_current_user

    async def _role_checker(current_user: dict = Depends(get_current_user)):
        if current_user.get("role") != role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{role}' is required for this action",
            )
        return current_user

    return _role_checker

# Password strength validator
def validate_password_strength(password: str) -> tuple[bool, str]:
    """Validate password strength."""
    if len(password) < 8:
        return False, "Password must be at least 8 characters long"
    if not any(c.isupper() for c in password):
        return False, "Password must contain at least one uppercase letter"
    if not any(c.islower() for c in password):
        return False, "Password must contain at least one lowercase letter"
    if not any(c.isdigit() for c in password):
        return False, "Password must contain at least one digit"
    if not any(c in "!@#$%^&*()_+-=[]{}|;:,.<>?" for c in password):
        return False, "Password must contain at least one special character"
    return True, "Password is strong"
