# backend/app/schemas/auth.py
from pydantic import BaseModel, EmailStr, Field, validator
from typing import Optional
from datetime import datetime
from app.utils.helpers import normalize_phone_number
from app.core.security import SELF_REGISTRATION_ROLES

class UserRegister(BaseModel):
    """User registration schema."""
    email: EmailStr
    phone: str = Field(..., description="Phone number with country code (e.g., +919876543210)")
    password: str = Field(..., min_length=8, description="Password must be at least 8 characters")
    first_name: str = Field(..., min_length=1, max_length=50)
    last_name: str = Field(..., min_length=1, max_length=50)
    role: str = Field("customer", description="Role: customer, farmer, delivery, warehouse")
    vehicleType: Optional[str] = None
    vehicleNumber: Optional[str] = None
    vehicleModel: Optional[str] = None
    vehicleYear: Optional[int] = None
    capacity: Optional[float] = None
    fuelType: Optional[str] = None
    
    @validator('role')
    def validate_role(cls, v):
        role = v.strip().lower()
        if role not in SELF_REGISTRATION_ROLES:
            raise ValueError(f"Role must be one of: {', '.join(sorted(SELF_REGISTRATION_ROLES))}")
        return role
    
    @validator('phone')
    def validate_phone(cls, v):
        return normalize_phone_number(v)
    
    @validator('password')
    def validate_password(cls, v):
        if len(v) < 8:
            raise ValueError('Password must be at least 8 characters long')
        if not any(c.isupper() for c in v):
            raise ValueError('Password must contain at least one uppercase letter')
        if not any(c.islower() for c in v):
            raise ValueError('Password must contain at least one lowercase letter')
        if not any(c.isdigit() for c in v):
            raise ValueError('Password must contain at least one digit')
        if not any(c in "!@#$%^&*()_+-=[]{}|;:,.<>?" for c in v):
            raise ValueError('Password must contain at least one special character')
        return v

class UserLogin(BaseModel):
    """User login schema."""
    email: str = Field(..., description="Email or phone number")
    password: str = Field(..., description="User password")

class TokenResponse(BaseModel):
    """Token response schema."""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = 3600
    user: Optional["UserResponse"] = None

class OTPRequest(BaseModel):
    """OTP request schema."""
    phone: str = Field(..., description="Phone number to send OTP to")
    
    @validator('phone')
    def validate_phone(cls, v):
        import re
        if not re.match(r'^\+[1-9]\d{1,14}$', v):
            raise ValueError('Phone number must be in E.164 format (e.g., +919876543210)')
        return v

class OTPVerify(BaseModel):
    """OTP verification schema."""
    phone: str = Field(..., description="Phone number in E.164 format or local format")
    otp: str = Field(..., min_length=4, max_length=6, description="OTP code")
    
    @validator('phone')
    def validate_phone(cls, v):
        """Normalize phone to E.164 format."""
        return normalize_phone_number(v)

class PasswordResetRequest(BaseModel):
    """Password reset request schema."""
    email: EmailStr

class PasswordReset(BaseModel):
    """Password reset schema."""
    token: str
    new_password: str = Field(..., min_length=8)
    
    @validator('new_password')
    def validate_password(cls, v):
        if len(v) < 8:
            raise ValueError('Password must be at least 8 characters long')
        if not any(c.isupper() for c in v):
            raise ValueError('Password must contain at least one uppercase letter')
        if not any(c.islower() for c in v):
            raise ValueError('Password must contain at least one lowercase letter')
        if not any(c.isdigit() for c in v):
            raise ValueError('Password must contain at least one digit')
        if not any(c in "!@#$%^&*()_+-=[]{}|;:,.<>?" for c in v):
            raise ValueError('Password must contain at least one special character')
        return v

class UserResponse(BaseModel):
    """User response schema."""
    id: str
    email: EmailStr
    phone: str
    first_name: str
    last_name: str
    role: str
    avatar_url: Optional[str] = None
    is_verified: bool
    is_active: bool
    created_at: datetime
    
    class Config:
        from_attributes = True


TokenResponse.update_forward_refs()

class RefreshTokenRequest(BaseModel):
    """Refresh token request schema."""
    refresh_token: str
