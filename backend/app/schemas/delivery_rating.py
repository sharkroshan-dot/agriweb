from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime


class DeliveryRatingCreate(BaseModel):
    """Payload for a customer rating a delivery partner on a delivered order."""
    orderId: str
    overallRating: int = Field(ge=1, le=5)
    onTimeRating: int = Field(ge=1, le=5)
    professionalismRating: int = Field(ge=1, le=5)
    handlingRating: int = Field(ge=1, le=5)
    communicationRating: int = Field(ge=1, le=5)
    feedback: Optional[str] = Field(None, max_length=2000)


class DeliveryRatingResponse(BaseModel):
    id: str
    deliveryPartnerId: str
    orderId: str
    orderNumber: str
    overallRating: int
    onTimeRating: int
    professionalismRating: int
    handlingRating: int
    communicationRating: int
    feedback: Optional[str] = None
    createdAt: datetime


class DeliveryRatingSummary(BaseModel):
    count: int = 0
    overallAvg: float = 0
    onTimeAvg: float = 0
    professionalismAvg: float = 0
    handlingAvg: float = 0
    communicationAvg: float = 0
    onTimePercentage: float = 0
    distribution: Dict[str, int] = {}
