from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum


class Cadence(str, Enum):
    WEEKLY = "weekly"
    BIWEEKLY = "biweekly"
    MONTHLY = "monthly"


class BasketDeliveryMode(str, Enum):
    DELIVERY = "delivery"
    PICKUP = "pickup"


class BasketPlanStatus(str, Enum):
    ACTIVE = "active"
    DISABLED = "disabled"


class SubscriptionStatus(str, Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    CANCELLED = "cancelled"


class BasketItem(BaseModel):
    productId: str
    name: str
    quantity: float = Field(ge=0)
    unit: str = "kg"
    unitPrice: float = Field(ge=0)


class BasketPlanCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    description: Optional[str] = None
    cadence: Cadence
    day: str
    price: float = Field(gt=0)
    items: List[BasketItem]
    maxSubscribers: int = Field(default=50, ge=1)
    deliveryMode: BasketDeliveryMode = BasketDeliveryMode.DELIVERY
    status: BasketPlanStatus = BasketPlanStatus.ACTIVE


class BasketPlanUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=120)
    description: Optional[str] = None
    cadence: Optional[Cadence] = None
    day: Optional[str] = None
    price: Optional[float] = Field(None, gt=0)
    items: Optional[List[BasketItem]] = None
    maxSubscribers: Optional[int] = Field(None, ge=1)
    deliveryMode: Optional[BasketDeliveryMode] = None
    status: Optional[BasketPlanStatus] = None


class WeeklyAdjustRequest(BaseModel):
    note: str = Field(min_length=5)
    itemAdjustments: Optional[List[BasketItem]] = None
    priceAdjustment: Optional[float] = Field(None, gt=0)


class BasketPlanResponse(BaseModel):
    id: str
    farmerId: str
    farmerName: str
    name: str
    description: Optional[str] = None
    cadence: Cadence
    day: str
    price: float
    items: List[BasketItem]
    maxSubscribers: int
    subscriberCount: int = 0
    deliveryMode: BasketDeliveryMode
    status: BasketPlanStatus
    rating: Optional[float] = None
    distanceKm: Optional[float] = None
    createdAt: datetime
    updatedAt: datetime


class SubscriptionCreate(BaseModel):
    planId: str


class SubscriptionResponse(BaseModel):
    id: str
    planId: str
    customerId: str
    customerName: Optional[str] = None
    planName: str
    cadence: Cadence
    day: str
    price: float
    items: List[BasketItem]
    farmerId: str
    farmerName: str
    deliveryMode: BasketDeliveryMode
    status: SubscriptionStatus
    nextDelivery: Optional[datetime] = None
    weekNumber: int = 0
    createdAt: datetime
    updatedAt: datetime