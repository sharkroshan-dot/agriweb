from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum

class DiscountType(str, Enum):
    PERCENTAGE = "percentage"
    FIXED = "fixed"

class CouponStatus(str, Enum):
    ACTIVE = "active"
    EXPIRED = "expired"
    DISABLED = "disabled"

class CouponCreate(BaseModel):
    code: str
    description: str
    discountType: DiscountType
    discountValue: float
    minOrderValue: float = 0
    maxDiscount: Optional[float] = None
    usageLimit: Optional[int] = None
    expiresAt: Optional[datetime] = None

class CouponUpdate(BaseModel):
    description: Optional[str] = None
    discountType: Optional[DiscountType] = None
    discountValue: Optional[float] = None
    minOrderValue: Optional[float] = None
    maxDiscount: Optional[float] = None
    usageLimit: Optional[int] = None
    status: Optional[CouponStatus] = None
    expiresAt: Optional[datetime] = None

class CouponResponse(BaseModel):
    id: str
    code: str
    description: str
    discountType: DiscountType
    discountValue: float
    minOrderValue: float
    maxDiscount: Optional[float] = None
    usageLimit: Optional[int] = None
    usedCount: int
    status: CouponStatus
    expiresAt: datetime
    createdAt: datetime

class CouponValidateRequest(BaseModel):
    code: str
    orderValue: float

class CouponValidateResponse(BaseModel):
    valid: bool
    coupon: Optional[CouponResponse] = None
    discountAmount: float = 0
    finalAmount: float = 0
    message: Optional[str] = None
