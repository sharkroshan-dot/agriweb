from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from enum import Enum


class ReservationStatus(str, Enum):
    ACTIVE = "active"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


class Inventory(BaseModel):
    product_id: str
    farmer_id: str
    total_stock: int = Field(ge=0)
    reserved_stock: int = Field(default=0, ge=0)
    sold_stock: int = Field(default=0, ge=0)
    unit: str = "kg"
    version: int = Field(default=0)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class Reservation(BaseModel):
    product_id: str
    customer_id: str
    order_id: Optional[str] = None
    quantity: int = Field(ge=1)
    status: ReservationStatus = ReservationStatus.ACTIVE
    expires_at: datetime
    confirmed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
