from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


class PackingTeamAssignment(BaseModel):
    packingTeamId: str = Field(min_length=1)


class PackingItemInput(BaseModel):
    productId: str = Field(min_length=1)
    variantId: Optional[str] = None
    packedQuantity: float = Field(ge=0)


class PackingCompleteRequest(BaseModel):
    # Aggregate quantity is kept for backward compatibility with older clients.
    packedQuantity: Optional[float] = Field(None, ge=0)
    items: Optional[List[PackingItemInput]] = None
    packageId: Optional[str] = None
    notes: Optional[str] = None


class PackingVerifyRequest(BaseModel):
    verified: bool
    notes: Optional[str] = None


class WarehousePackingTaskResponse(BaseModel):
    id: str
    warehouseId: str
    orderId: str
    farmerId: str
    productId: str
    variantId: Optional[str] = None
    batchId: Optional[str] = None
    quantityRequired: float
    packedQuantity: float = 0
    status: str
    packingTeamId: Optional[str] = None
    packageId: Optional[str] = None
    verified: bool = False
    createdAt: datetime
    updatedAt: datetime
