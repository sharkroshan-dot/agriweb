"""MongoDB-backed order domain model.

The application persists orders as MongoDB documents and uses the Pydantic
schemas in app.schemas.order at the HTTP boundary. This module is the
canonical typed order document for validation and serialization.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from bson import ObjectId
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.order import DeliveryType, OrderStatus, PaymentMethod, PaymentStatus


def _stringify_id(value: Any) -> Optional[str]:
    if value is None:
        return None
    return str(value)


class OrderItemDocument(BaseModel):
    """Persisted order-line representation."""

    model_config = ConfigDict(extra="allow")

    productId: str
    variantId: Optional[str] = None
    quantity: float = Field(gt=0)
    unitPrice: float = Field(gt=0)
    totalPrice: float = Field(default=0, ge=0)
    productName: str = ""
    productImage: Optional[str] = None
    attributes: Optional[Dict[str, Any]] = None
    reservationId: Optional[str] = None

    @field_validator("productId", "variantId", "reservationId", mode="before")
    @classmethod
    def normalize_ids(cls, value: Any) -> Optional[str]:
        return _stringify_id(value)


class OrderStatusHistoryDocument(BaseModel):
    """Immutable audit entry for an order status transition."""

    model_config = ConfigDict(extra="allow")

    status: OrderStatus
    changedBy: str
    timestamp: datetime
    note: Optional[str] = None
    location: Optional[Dict[str, Any]] = None

    @field_validator("changedBy", mode="before")
    @classmethod
    def normalize_changed_by(cls, value: Any) -> str:
        return str(value)


class OrderDocument(BaseModel):
    """Canonical persisted order contract.

    Extra fields are allowed because delivery, warehouse, payment,
    preorder and rating integrations add workflow-specific fields.
    """

    model_config = ConfigDict(populate_by_name=True, extra="allow", arbitrary_types_allowed=True)

    id: Optional[str] = Field(default=None, alias="_id")
    orderNumber: str
    customerId: str
    farmerId: Optional[str] = None
    warehouseId: Optional[str] = None
    deliveryPartnerId: Optional[str] = None
    items: List[OrderItemDocument] = Field(default_factory=list)

    subtotal: float = Field(default=0, ge=0)
    deliveryCharge: float = Field(default=0, ge=0)
    platformFee: float = Field(default=0, ge=0)
    platformCommission: float = Field(default=0, ge=0)
    discount: float = Field(default=0, ge=0)
    totalAmount: float = Field(default=0, ge=0)

    orderStatus: OrderStatus = OrderStatus.PENDING
    paymentStatus: PaymentStatus = PaymentStatus.PENDING
    paymentMethod: PaymentMethod

    deliveryType: DeliveryType = DeliveryType.DELIVERY
    deliveryMethod: str = "farmer"
    deliveryAddressId: Optional[str] = None
    deliveryAddress: Optional[Dict[str, Any]] = None
    pickupDate: Optional[datetime] = None
    pickupTimeSlot: Optional[str] = None
    pickupCode: Optional[str] = None
    requestedDeliveryDate: Optional[datetime] = None
    deliveryTimeSlot: Optional[str] = None
    specialInstructions: Optional[str] = None

    preorderId: Optional[str] = None
    idempotencyKey: Optional[str] = None
    couponCode: Optional[str] = None
    isBulkOrder: bool = False
    bulkDiscountApplied: float = Field(default=0, ge=0)
    selfDelivery: bool = False

    orderDate: datetime
    deliveryDate: Optional[datetime] = None
    deliveredAt: Optional[datetime] = None
    pickedUpAt: Optional[datetime] = None
    assignedAt: Optional[datetime] = None
    cancellationReason: Optional[str] = None
    deletedAt: Optional[datetime] = None
    statusHistory: List[OrderStatusHistoryDocument] = Field(default_factory=list)
    createdAt: datetime
    updatedAt: datetime

    @field_validator(
        "id", "customerId", "farmerId", "warehouseId", "deliveryPartnerId",
        "deliveryAddressId", "preorderId", mode="before"
    )
    @classmethod
    def normalize_ids(cls, value: Any) -> Optional[str]:
        return _stringify_id(value)

    def to_mongo(self) -> Dict[str, Any]:
        """Return a MongoDB-ready document with ObjectId references."""

        data = self.model_dump(by_alias=True, exclude_none=True)
        if data.get("_id"):
            data["_id"] = ObjectId(data["_id"])
        for key in (
            "customerId", "farmerId", "warehouseId", "deliveryPartnerId",
            "deliveryAddressId", "preorderId"
        ):
            if data.get(key):
                data[key] = ObjectId(data[key])
        return data

    @classmethod
    def from_mongo(cls, document: Dict[str, Any]) -> "OrderDocument":
        """Validate an existing MongoDB order document."""

        return cls.model_validate(document)
