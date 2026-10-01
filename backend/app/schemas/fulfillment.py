from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

class FulfillmentDecisionResponse(BaseModel):
    orderId: str
    fulfillmentSource: str
    originLocation: Optional[Dict[str, Any]] = None
    customerLocation: Optional[Dict[str, Any]] = None
    estimatedDistanceKm: Optional[float] = None
    estimatedDeliveryMinutes: Optional[int] = None
    remainingShelfLifeHours: Optional[float] = None
    perishabilityLevel: Optional[str] = None
    perishabilityRisk: Optional[str] = None
    nearbyFulfillmentRequired: bool = False
    nearbyFulfillmentType: Optional[str] = None
    nearbyFulfillmentLocationId: Optional[str] = None
    nearbyFulfillmentLocation: Optional[str] = None
    hubToCustomerDistanceKm: Optional[float] = None
    logisticsMode: Optional[str] = None
    decision: str
    nextStep: str
    decisionAt: Any

class FulfillmentHubCreate(BaseModel):
    name: str = Field(min_length=2)
    location: Dict[str, Any]
    address: Dict[str, str] = Field(default_factory=dict)
    storageCapacity: float = Field(gt=0)
    availableCapacity: Optional[float] = None
    coldStorageAvailable: bool = False
    coldStorageCapacity: float = Field(default=0, ge=0)
    supportedProducts: List[str] = Field(default_factory=list)
    operatingHours: Optional[Dict[str, str]] = None
    handlingInstructions: Optional[str] = None
    qualityVerificationRequired: bool = True
    isActive: bool = True

class HubTransferCreate(BaseModel):
    hubId: str
    quantity: int = Field(gt=0)
    transferDistanceKm: Optional[float] = None
    notes: Optional[str] = None

class HubReceiveRequest(BaseModel):
    qualityCheck: str = Field(pattern="^(passed|failed)$")
    notes: Optional[str] = None

class HubDispatchRequest(BaseModel):
    deliveryPartnerId: Optional[str] = None

class FulfillmentRatingCreate(BaseModel):
    orderId: str
    productQuality: Optional[int] = Field(None, ge=1, le=5)
    freshness: Optional[int] = Field(None, ge=1, le=5)
    quantityAccuracy: Optional[int] = Field(None, ge=1, le=5)
    farmerPerformance: Optional[int] = Field(None, ge=1, le=5)
    warehouseHandling: Optional[int] = Field(None, ge=1, le=5)
    packaging: Optional[int] = Field(None, ge=1, le=5)
    storageHandling: Optional[int] = Field(None, ge=1, le=5)
    fulfillmentAccuracy: Optional[int] = Field(None, ge=1, le=5)
    deliveryOnTime: Optional[int] = Field(None, ge=1, le=5)
    deliveryHandling: Optional[int] = Field(None, ge=1, le=5)
    deliveryCommunication: Optional[int] = Field(None, ge=1, le=5)
    comment: Optional[str] = None
