from pydantic import BaseModel, Field, validator
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum

class DeliveryType(str, Enum):
    DELIVERY = "delivery"
    PICKUP = "pickup"

class FulfillmentMethod(str, Enum):
    FARM_DIRECT = "farmer"
    WAREHOUSE = "warehouse"

class FulfillmentStage(str, Enum):
    PENDING = "pending"
    PICKED = "picked"
    PACKED = "packed"
    DISPATCHED = "dispatched"

class DeliveryResponsibility(str, Enum):
    FARMER = "farmer"
    DELIVERY_PARTNER = "delivery_partner"

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
    quantity: float = Field(gt=0)
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
    # Links a checkout order to a previously reserved harvest pre-order.
    # Regular marketplace checkout leaves this unset.
    preorderId: Optional[str] = None
    items: List[OrderItemCreate]
    deliveryAddressId: Optional[str] = None
    specialInstructions: Optional[str] = None
    paymentMethod: PaymentMethod
    couponCode: Optional[str] = None
    deliveryType: DeliveryType = DeliveryType.DELIVERY
    fulfillmentMethod: Optional[FulfillmentMethod] = None
    fulfillmentStage: FulfillmentStage = FulfillmentStage.PENDING
    deliveryResponsibility: Optional[DeliveryResponsibility] = None
    pickupDate: Optional[datetime] = None
    pickupTimeSlot: Optional[str] = None
    requestedDeliveryDate: Optional[datetime] = None
    deliveryTimeSlot: Optional[str] = None

class OrderCreate(OrderBase):
    @validator("deliveryType")
    def delivery_must_be_home_delivery(cls, value):
        # Farm pickup is no longer part of the marketplace checkout workflow.
        # Keep the legacy enum value readable for old records, but reject it
        # for all newly-created orders.
        if value != DeliveryType.DELIVERY:
            raise ValueError("Farm pickup is no longer available. Orders are delivered to the customer address.")
        return value


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


class FulfillmentRouteUpdate(BaseModel):
    fulfillmentMethod: FulfillmentMethod = FulfillmentMethod.FARM_DIRECT

class DeliveryResponsibilityUpdate(BaseModel):
    deliveryResponsibility: DeliveryResponsibility


class BulkOrderProcessRequest(BaseModel):
    fulfillmentMethod: FulfillmentMethod
    deliveryResponsibility: Optional[DeliveryResponsibility] = None

class OrderResponse(BaseModel):
    id: str
    orderNumber: str
    customer: Dict[str, Any]
    farmer: Dict[str, Any]
    deliveryPartner: Optional[Dict[str, Any]] = None
    warehouse: Optional[Dict[str, Any]] = None
    fulfillmentMethod: Optional[FulfillmentMethod] = None
    fulfillmentStage: FulfillmentStage = FulfillmentStage.PENDING
    fulfillmentRouteSelected: bool = False
    fulfillmentRouteVersion: int = 0
    deliveryResponsibility: Optional[DeliveryResponsibility] = None
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
