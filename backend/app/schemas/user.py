# backend/app/schemas/user.py
from pydantic import BaseModel, EmailStr, Field, validator
from typing import Optional, List, Dict, Any
from datetime import datetime
from app.utils.helpers import normalize_phone_number

# ============ USER SCHEMAS ============

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
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True

class UserUpdate(BaseModel):
    """Update user schema."""
    first_name: Optional[str] = Field(None, min_length=2, max_length=50)
    last_name: Optional[str] = Field(None, min_length=2, max_length=50)
    phone: Optional[str] = None
    avatar_url: Optional[str] = None
    
    @validator('phone')
    def validate_phone(cls, v):
        if v:
            return normalize_phone_number(v)
        return v

class UserProfileResponse(BaseModel):
    """Complete user profile response."""
    user: Dict[str, Any]
    role_profile: Optional[Dict[str, Any]] = None
    addresses: List[Dict[str, Any]] = []
    stats: Dict[str, Any] = {}

# ============ ADDRESS SCHEMAS ============

class AddressBase(BaseModel):
    """Base address schema."""
    address_line1: str
    address_line2: Optional[str] = None
    city: str
    state: str
    zip_code: str
    country: str = "India"
    landmark: Optional[str] = None
    address_type: str = "home"  # home, work, farm, warehouse, other
    is_default: bool = False
    location: Optional[Dict[str, Any]] = None  # GeoJSON Point

class AddressCreate(AddressBase):
    """Create address schema."""
    pass

class AddressUpdate(AddressBase):
    """Update address schema."""
    pass

class AddressResponse(AddressBase):
    """Address response schema."""
    id: str
    user_id: str
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

# ============ PASSWORD SCHEMAS ============

class ChangePasswordRequest(BaseModel):
    """Change password request schema."""
    current_password: str
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
