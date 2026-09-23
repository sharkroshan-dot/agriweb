from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum


class ReservationStatus(str, Enum):
    ACTIVE = "active"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


class InventoryDocument(BaseModel):
    product_id: str
    farmer_id: str
    total_stock: int = Field(ge=0)
    reserved_stock: int = Field(ge=0, default=0)
    sold_stock: int = Field(ge=0, default=0)
    unit: str = "kg"
    version: int = Field(default=0)

    class Config:
        from_attributes = True

    @property
    def available_stock(self) -> int:
        return self.total_stock - self.reserved_stock - self.sold_stock


class ReservationDocument(BaseModel):
    product_id: str
    customer_id: str
    order_id: Optional[str] = None
    quantity: int = Field(ge=1)
    status: ReservationStatus = ReservationStatus.ACTIVE
    expires_at: datetime
    confirmed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ReserveRequest(BaseModel):
    product_id: str
    quantity: int = Field(ge=1)


class ReserveResponse(BaseModel):
    reservation_id: str
    product_id: str
    quantity: int
    status: ReservationStatus
    expires_at: datetime
    available_stock: int


class ConfirmReservationRequest(BaseModel):
    reservation_id: str
    order_id: str


class ConfirmReservationResponse(BaseModel):
    reservation_id: str
    status: ReservationStatus
    sold_stock: int
    available_stock: int


class CancelReservationRequest(BaseModel):
    reservation_id: str


class CancelReservationResponse(BaseModel):
    reservation_id: str
    status: ReservationStatus
    released_quantity: int
    available_stock: int


class StockResponse(BaseModel):
    product_id: str
    total_stock: int
    reserved_stock: int
    sold_stock: int
    available_stock: int
    unit: str
    is_out_of_stock: bool


class FarmerStockSummary(BaseModel):
    total_products: int
    total_stock: int
    total_available: int
    total_reserved: int
    total_sold: int
    products: List[StockResponse]


class InventoryAnalytics(BaseModel):
    total_products: int
    total_stock: int
    total_available: int
    total_reserved: int
    total_sold: int
    total_revenue: float
    low_stock_products: int
    out_of_stock_products: int
    avg_reservation_time_minutes: float
    reservation_completion_rate: float
    top_reserved_products: List[Dict[str, Any]]
