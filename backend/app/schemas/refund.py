from pydantic import BaseModel, Field, validator
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum


class RefundStatus(str, Enum):
    REQUESTED = "requested"
    UNDER_REVIEW = "under_review"
    APPROVED = "approved"
    REFUND_PROCESSING = "refund_processing"
    REFUNDED = "refunded"
    REJECTED = "rejected"


class RefundType(str, Enum):
    FULL = "full"
    PARTIAL = "partial"
    CANCELLATION = "cancellation"
    DAMAGED = "damaged_product"
    MISSING = "missing_quantity"
    WRONG = "wrong_product"
    QUALITY = "poor_quality"
    SPOILED = "spoiled_expired"
    UNAVAILABLE = "product_unavailable"
    DELIVERY_FAILED = "delivery_failed"
    BULK = "bulk_event"
    OTHER = "other"


class RefundReason(str, Enum):
    ORDERED_BY_MISTAKE = "ordered_by_mistake"
    NO_LONGER_NEEDED = "no_longer_needed"
    DELIVERY_TOO_SLOW = "delivery_too_slow"
    FOUND_OTHER = "found_other"
    WRONG_PRODUCT = "wrong_product"
    MISSING_QUANTITY = "missing_quantity"
    DAMAGED_PRODUCT = "damaged_product"
    POOR_QUALITY = "poor_quality"
    SPOILED_EXPIRED = "spoiled_expired"
    OTHER = "other"


class RefundResolution(str, Enum):
    FULL_REFUND = "full_refund"
    REPLACEMENT = "replacement"
    PARTIAL_REFUND = "partial_refund"


class AffectedItemRequest(BaseModel):
    productId: str
    quantity: int = Field(ge=1)
    requestedAmount: Optional[float] = Field(default=None, ge=0)


class RefundRequestCreate(BaseModel):
    """Customer-facing refund request.

    The customer may *ask* for an amount, but the backend is authoritative and
    computes the final eligible amount from the order, payment and policy.
    """
    refundType: RefundType = RefundType.OTHER
    reason: RefundReason = RefundReason.OTHER
    resolution: RefundResolution = RefundResolution.FULL_REFUND
    description: Optional[str] = None
    evidence: List[str] = Field(default_factory=list)
    affectedItems: List[AffectedItemRequest] = Field(default_factory=list)
    requestedAmount: Optional[float] = Field(default=None, ge=0)

    @validator("evidence")
    def evidence_limit(cls, v):
        if len(v) > 10:
            raise ValueError("At most 10 evidence files are allowed")
        return v


class CancelOrderRequest(BaseModel):
    reason: str = "Not specified"
    reasonCode: Optional[RefundReason] = None


class RefundTimelineEntry(BaseModel):
    status: str
    note: Optional[str] = None
    actorId: Optional[str] = None
    actorRole: Optional[str] = None
    timestamp: datetime


class AffectedItemOut(BaseModel):
    productId: str
    productName: str
    quantity: int
    unitPrice: float
    requestedAmount: float
    approvedAmount: Optional[float] = None


class RefundResponse(BaseModel):
    id: str
    refundId: str
    orderId: str
    orderNumber: Optional[str] = None
    customerId: str
    paymentId: Optional[str] = None
    type: RefundType
    reason: RefundReason
    resolution: Optional[RefundResolution] = None
    description: Optional[str] = None
    evidence: List[str]
    affectedItems: List[AffectedItemOut]
    paymentMethod: str
    requestedAmount: float
    approvedAmount: Optional[float] = None
    status: RefundStatus
    rejectionReason: Optional[str] = None
    refundTransactionId: Optional[str] = None
    timeline: List[RefundTimelineEntry]
    requestedAt: datetime
    approvedAt: Optional[datetime] = None
    processedAt: Optional[datetime] = None
    completedAt: Optional[datetime] = None
    createdAt: datetime
    updatedAt: datetime

    class Config:
        from_attributes = True


class RefundActionRequest(BaseModel):
    note: Optional[str] = None


class RefundRejectRequest(BaseModel):
    reason: str = Field(min_length=1)


class RefundFilterParams(BaseModel):
    status: Optional[RefundStatus] = None
    page: int = 1
    limit: int = 20