# backend/app/schemas/__init__.py
from app.schemas.auth import (
    UserRegister,
    UserLogin,
    TokenResponse,
    OTPRequest,
    OTPVerify,
    PasswordResetRequest,
    PasswordReset,
    RefreshTokenRequest
)
from app.schemas.user import (
    UserResponse,
    UserUpdate,
    UserProfileResponse,
    AddressBase,
    AddressCreate,
    AddressUpdate,
    AddressResponse,
    ChangePasswordRequest
)