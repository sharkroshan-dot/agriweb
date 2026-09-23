from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field
from enum import Enum


class CommunityDeliveryStatus(str, Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    CANCELLED = "cancelled"


class CommunityDeliveryScheduleBase(BaseModel):
    areaName: str
    dayOfWeek: str
    windowStart: str
    windowEnd: str
    radiusKm: int = Field(default=10, ge=1, le=50)
    description: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class CommunityDeliveryScheduleCreate(CommunityDeliveryScheduleBase):
    pass


class CommunityDeliveryScheduleUpdate(BaseModel):
    areaName: Optional[str] = None
    dayOfWeek: Optional[str] = None
    windowStart: Optional[str] = None
    windowEnd: Optional[str] = None
    radiusKm: Optional[int] = Field(None, ge=1, le=50)
    description: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    status: Optional[CommunityDeliveryStatus] = None


class CommunityDeliveryScheduleResponse(CommunityDeliveryScheduleBase):
    id: str
    farmerId: str
    status: CommunityDeliveryStatus = CommunityDeliveryStatus.ACTIVE
    createdAt: datetime
    updatedAt: datetime
