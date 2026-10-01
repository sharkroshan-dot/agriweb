from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class PackingTeamAssignment(BaseModel):
    packingTeamId: str = Field(min_length=1)


class PackingCompleteRequest(BaseModel):
    packedQuantity: float = Field(gt=0)
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
