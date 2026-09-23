from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum

class ComplaintStatus(str, Enum):
    PENDING = "pending"
    UNDER_REVIEW = "under_review"
    RESOLVED = "resolved"
    REJECTED = "rejected"

class ComplaintType(str, Enum):
    PRODUCT = "product"
    DELIVERY = "delivery"
    PAYMENT = "payment"
    FARMER = "farmer"
    APP = "app"
    OTHER = "other"

class ComplaintCreate(BaseModel):
    type: ComplaintType
    subject: str
    description: str
    orderId: Optional[str] = None
    productId: Optional[str] = None

class ComplaintResponse(BaseModel):
    id: str
    userId: str
    userName: str
    userRole: str
    type: ComplaintType
    subject: str
    description: str
    status: ComplaintStatus
    orderId: Optional[str] = None
    productId: Optional[str] = None
    adminResponse: Optional[str] = None
    resolvedAt: Optional[datetime] = None
    createdAt: datetime
    updatedAt: datetime

class ComplaintUpdate(BaseModel):
    status: Optional[ComplaintStatus] = None
    adminResponse: Optional[str] = None

class ComplaintListResponse(BaseModel):
    complaints: List[ComplaintResponse]
    total: int
    page: int
    pages: int
