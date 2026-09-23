from pydantic import BaseModel, Field, validator
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum


class DeliveryStatus(str, Enum):
    ASSIGNED = "assigned"
    ACCEPTED = "accepted"
    PICKED_UP = "picked_up"
    IN_TRANSIT = "in_transit"
    DELIVERED = "delivered"
    FAILED = "failed"
    CANCELLED = "cancelled"


class VehicleType(str, Enum):
    BIKE = "bike"
    CAR = "car"
    VAN = "van"
    TRUCK = "truck"
    TEMPO = "tempo"


class FuelType(str, Enum):
    PETROL = "petrol"
    DIESEL = "diesel"
    ELECTRIC = "electric"
    CNG = "cng"


class DeliveryPartnerStatus(str, Enum):
    AVAILABLE = "available"
    BUSY = "busy"
    OFFLINE = "offline"
    ON_BREAK = "on_break"


class DeliveryPartnerBase(BaseModel):
    userId: str
    vehicleType: VehicleType
    vehicleNumber: str
    vehicleModel: Optional[str] = None
    vehicleYear: Optional[int] = None
    capacity: Optional[float] = None
    fuelType: Optional[FuelType] = None
    isVerified: bool = False
    rating: float = 0
    totalDeliveries: int = 0


class DeliveryPartnerCreate(DeliveryPartnerBase):
    pass


class DeliveryPartnerUpdate(BaseModel):
    vehicleType: Optional[VehicleType] = None
    vehicleNumber: Optional[str] = None
    vehicleModel: Optional[str] = None
    vehicleYear: Optional[int] = None
    capacity: Optional[float] = None
    fuelType: Optional[FuelType] = None
    isVerified: Optional[bool] = None
    isAvailable: Optional[bool] = None
    status: Optional[DeliveryPartnerStatus] = None
    currentLocation: Optional[Dict[str, Any]] = None


class DeliveryPartnerResponse(DeliveryPartnerBase):
    id: str
    userId: str
    isAvailable: bool
    status: DeliveryPartnerStatus
    currentLocation: Optional[Dict[str, Any]] = None
    joinedDate: datetime
    updatedAt: datetime

    class Config:
        from_attributes = True


class DeliveryAssignmentBase(BaseModel):
    orderId: str
    deliveryPartnerId: str
    routeId: Optional[str] = None
    priority: int = 1


class DeliveryAssignmentCreate(DeliveryAssignmentBase):
    pass


class DeliveryAssignmentUpdate(BaseModel):
    status: Optional[DeliveryStatus] = None
    startedAt: Optional[datetime] = None
    pickedUpAt: Optional[datetime] = None
    completedAt: Optional[datetime] = None
    failureReason: Optional[str] = None


class DeliveryAssignmentResponse(DeliveryAssignmentBase):
    id: str
    status: DeliveryStatus
    assignedAt: datetime
    acceptedAt: Optional[datetime] = None
    startedAt: Optional[datetime] = None
    pickedUpAt: Optional[datetime] = None
    completedAt: Optional[datetime] = None
    failureReason: Optional[str] = None
    order: Optional[Dict[str, Any]] = None
    customer: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True


class RouteWaypoint(BaseModel):
    orderId: str
    location: Dict[str, Any]
    sequence: int
    pickup: bool = False
    dropoff: bool = True


class RouteOptimizationRequest(BaseModel):
    startLocation: Dict[str, Any]
    destinations: List[Dict[str, Any]]
    vehicleType: VehicleType = VehicleType.BIKE
    optimizationType: str = "distance"
    timeWindows: Optional[List[Dict[str, Any]]] = None
    maxWeight: Optional[float] = None


class RouteOptimizationResponse(BaseModel):
    optimizedRoute: List[RouteWaypoint]
    totalDistance: float
    totalTime: float
    fuelEstimated: float
    savings: Dict[str, float]
    routeGeometry: Dict[str, Any]


class DeliveryLocationUpdate(BaseModel):
    latitude: float
    longitude: float
    accuracy: Optional[float] = None
    speed: Optional[float] = None
    bearing: Optional[float] = None
    timestamp: Optional[datetime] = None


class DeliveryTrackingResponse(BaseModel):
    orderId: str
    deliveryPartnerId: str
    currentLocation: Dict[str, Any]
    status: DeliveryStatus
    speed: Optional[float] = None
    bearing: Optional[float] = None
    eta: Optional[str] = None
    distanceRemaining: Optional[float] = None
    updatedAt: datetime


class DeliveryZoneBase(BaseModel):
    name: str
    polygon: Dict[str, Any]
    city: str
    state: str
    zipCodes: List[str]
    baseCharge: float = 0
    perKmCharge: float = 10
    isActive: bool = True


class DeliveryZoneCreate(DeliveryZoneBase):
    pass


class DeliveryZoneUpdate(BaseModel):
    name: Optional[str] = None
    polygon: Optional[Dict[str, Any]] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zipCodes: Optional[List[str]] = None
    baseCharge: Optional[float] = None
    perKmCharge: Optional[float] = None
    isActive: Optional[bool] = None


class DeliveryZoneResponse(DeliveryZoneBase):
    id: str
    createdAt: datetime
    updatedAt: datetime

    class Config:
        from_attributes = True


class VehicleMaintenanceBase(BaseModel):
    vehicleId: str
    type: str
    description: str
    cost: float
    mileage: Optional[float] = None
    date: datetime
    notes: Optional[str] = None


class VehicleMaintenanceCreate(VehicleMaintenanceBase):
    pass


class VehicleMaintenanceResponse(VehicleMaintenanceBase):
    id: str
    createdAt: datetime

    class Config:
        from_attributes = True


class DeliveryStatsResponse(BaseModel):
    totalDeliveries: int
    completedDeliveries: int
    pendingDeliveries: int
    totalEarnings: float
    averageRating: float
    onTimeDelivery: float
    dailyTrend: List[Dict[str, Any]]
