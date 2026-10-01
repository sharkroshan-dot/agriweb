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
