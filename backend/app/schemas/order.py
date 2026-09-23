from pydantic import BaseModel, Field, validator
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum

class DeliveryType(str, Enum):
    DELIVERY = "delivery"
    PICKUP = "pickup"

class OrderStatus(str, Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    PROCESSING = "processing"
    READY_FOR_DELIVERY = "ready_for_delivery"
    READY_FOR_PICKUP = "ready_for_pickup"
    DISPATCHED = "dispatched"
    IN_TRANSIT = "in_transit"
    DELIVERED = "delivered"
    PICKED_UP = "picked_up"
    CANCELLED = "cancelled"
    REFUNDED = "refunded"

class PaymentStatus(str, Enum):
    PENDING = "pending"
    PAID = "paid"
    FAILED = "failed"
    REFUNDED = "refunded"

class PaymentMethod(str, Enum):
    CASH = "cash"
    CARD = "card"
    UPI = "upi"
    WALLET = "wallet"
    RAZORPAY = "razorpay"
    STRIPE = "stripe"

class OrderItemBase(BaseModel):
    productId: str
    variantId: Optional[str] = None
    quantity: int = Field(ge=1)
    unitPrice: float = Field(gt=0)

class OrderItemCreate(OrderItemBase):
    reservationId: Optional[str] = None

class OrderItemResponse(OrderItemBase):
    productName: str
    productImage: Optional[str] = None
    totalPrice: float
    attributes: Optional[Dict[str, Any]] = None
    pickupAvailable: Optional[bool] = None
    farmAddress: Optional[str] = None
    
    class Config:
        from_attributes = True

class OrderBase(BaseModel):
    idempotencyKey: Optional[str] = Field(None, min_length=16, max_length=100)
    items: List[OrderItemCreate]
    deliveryAddressId: Optional[str] = None
    specialInstructions: Optional[str] = None
    paymentMethod: PaymentMethod
    couponCode: Optional[str] = None
    deliveryType: DeliveryType = DeliveryType.DELIVERY
    deliveryMethod: str = "farmer"
    pickupDate: Optional[datetime] = None
    pickupTimeSlot: Optional[str] = None
    requestedDeliveryDate: Optional[datetime] = None
    deliveryTimeSlot: Optional[str] = None

class OrderCreate(OrderBase):
    pass

class OrderUpdate(BaseModel):
    orderStatus: Optional[OrderStatus] = None
    paymentStatus: Optional[PaymentStatus] = None
    deliveryPartnerId: Optional[str] = None
    warehouseId: Optional[str] = None
    cancellationReason: Optional[str] = None

class OrderStatusUpdate(BaseModel):
    status: OrderStatus
    note: Optional[str] = None
    location: Optional[Dict[str, Any]] = None
    deliveryPhoto: Optional[str] = None
    otp: Optional[str] = None

class AssignPartnerRequest(BaseModel):
    partnerId: Optional[str] = None

class OrderResponse(BaseModel):
    id: str
    orderNumber: str
    customer: Dict[str, Any]
    farmer: Dict[str, Any]
    deliveryPartner: Optional[Dict[str, Any]] = None
    warehouse: Optional[Dict[str, Any]] = None
    items: List[OrderItemResponse]
    subtotal: float
    deliveryCharge: float
    platformFee: float
    platformCommission: float = 0
    discount: float
    totalAmount: float
    orderStatus: OrderStatus
    paymentStatus: PaymentStatus
    paymentMethod: PaymentMethod
    deliveryAddress: Optional[Dict[str, Any]] = None
    specialInstructions: Optional[str] = None
    deliveryType: DeliveryType = DeliveryType.DELIVERY
    pickupDate: Optional[datetime] = None
    pickupTimeSlot: Optional[str] = None
    pickupCode: Optional[str] = None
    requestedDeliveryDate: Optional[datetime] = None
    deliveryTimeSlot: Optional[str] = None
    farmAddress: Optional[str] = None
    pickupInstructions: Optional[str] = None
    isBulkOrder: bool = False
    bulkDiscountApplied: float = 0
    selfDelivery: bool = False
    orderDate: datetime
    deliveryDate: Optional[datetime] = None
    deliveredAt: Optional[datetime] = None
    pickedUpAt: Optional[datetime] = None
    cancellationReason: Optional[str] = None
    statusHistory: List[Dict[str, Any]]
    createdAt: datetime
    updatedAt: datetime
    
    class Config:
        from_attributes = True

class OrderTrackingResponse(BaseModel):
    orderId: str
    orderStatus: OrderStatus
    currentLocation: Optional[Dict[str, Any]] = None
    deliveryLocation: Optional[Dict[str, Any]] = None
    eta: Optional[str] = None
    distanceRemaining: Optional[float] = None
    deliveryPartner: Optional[Dict[str, Any]] = None
    route: Optional[List[Dict[str, float]]] = None
    statusHistory: List[Dict[str, Any]]
    locationUpdatedAt: Optional[datetime] = None
    lastUpdated: Optional[datetime] = None

class OrderSummaryResponse(BaseModel):
    totalOrders: int
    pendingOrders: int
    deliveredOrders: int
    cancelledOrders: int
    totalRevenue: float
    averageOrderValue: float

class OrderFilterParams(BaseModel):
    status: Optional[OrderStatus] = None
    fromDate: Optional[datetime] = None
    toDate: Optional[datetime] = None
    farmerId: Optional[str] = None
    customerId: Optional[str] = None
    deliveryPartnerId: Optional[str] = None
    deliveryType: Optional[DeliveryType] = None
    isBulkOrder: Optional[bool] = None
    page: int = 1
    limit: int = 20

# Delivery Assignment Schema
class DeliveryAssignment(BaseModel):
    orderId: str
    deliveryPartnerId: str
    routeId: Optional[str] = None
    priority: int = 1

# Order Status History Schema
class OrderStatusHistoryResponse(BaseModel):
    id: str
    orderId: str
    status: OrderStatus
    changedBy: str
    changedByName: str
    note: Optional[str] = None
    location: Optional[Dict[str, Any]] = None
    createdAt: datetime
