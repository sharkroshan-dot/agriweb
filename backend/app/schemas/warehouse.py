from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum


class StorageType(str, Enum):
    AMBIENT = "ambient"
    CHILLED = "chilled"
    FROZEN = "frozen"
    CONTROLLED = "controlled_atmosphere"


class StockStatus(str, Enum):
    IN_STOCK = "in_stock"
    LOW_STOCK = "low_stock"
    OUT_OF_STOCK = "out_of_stock"
    EXPIRED = "expired"
    RESERVED = "reserved"
    DAMAGED = "damaged"
    QUARANTINED = "quarantined"
    TRANSFERRED = "transferred"


class IncomingStatus(str, Enum):
    SCHEDULED = "scheduled"
    IN_TRANSIT = "in_transit"
    RECEIVED = "received"
    QUALITY_CHECK = "quality_check"
    STORED = "stored"
    REJECTED = "rejected"


class OutgoingStatus(str, Enum):
    PENDING = "pending"
    PICKED = "picked"
    PACKED = "packed"
    DISPATCHED = "dispatched"


class WarehouseBase(BaseModel):
    name: str
    location: Dict[str, Any]
    address: Dict[str, str]
    totalCapacity: float = Field(ge=0)
    coldStorageCapacity: Optional[float] = Field(0, ge=0)
    managerId: Optional[str] = None
    isActive: bool = True


class WarehouseCreate(WarehouseBase):
    pass


class WarehouseUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[Dict[str, Any]] = None
    address: Optional[Dict[str, str]] = None
    totalCapacity: Optional[float] = Field(None, ge=0)
    coldStorageCapacity: Optional[float] = Field(None, ge=0)
    managerId: Optional[str] = None
    isActive: Optional[bool] = None


class WarehouseResponse(WarehouseBase):
    id: str
    usedCapacity: float = 0
    coldStorageUsed: float = 0
    createdAt: datetime
    updatedAt: datetime

    class Config:
        from_attributes = True


class WarehouseStockBase(BaseModel):
    warehouseId: str
    productId: str
    variantId: Optional[str] = None
    quantity: int = Field(ge=0)
    reservedQuantity: int = Field(0, ge=0)
    minThreshold: int = Field(10, ge=0)
    maxThreshold: Optional[int] = Field(None, ge=0)
    locationInWarehouse: Optional[str] = None
    batchNumber: Optional[str] = None
    expiryDate: Optional[datetime] = None
    storageType: StorageType = StorageType.AMBIENT


class WarehouseStockCreate(WarehouseStockBase):
    pass


class WarehouseStockUpdate(BaseModel):
    quantity: Optional[int] = Field(None, ge=0)
    reservedQuantity: Optional[int] = Field(None, ge=0)
    minThreshold: Optional[int] = Field(None, ge=0)
    maxThreshold: Optional[int] = Field(None, ge=0)
    locationInWarehouse: Optional[str] = None
    batchNumber: Optional[str] = None
    expiryDate: Optional[datetime] = None
    storageType: Optional[StorageType] = None
    status: Optional[StockStatus] = None


class WarehouseStockResponse(WarehouseStockBase):
    id: str
    status: StockStatus
    lastRestocked: Optional[datetime]
    updatedAt: datetime

    class Config:
        from_attributes = True


class IncomingStockBase(BaseModel):
    warehouseId: str
    productId: str
    variantId: Optional[str] = None
    farmerId: str
    orderId: Optional[str] = None
    quantity: int = Field(ge=1)
    expectedDate: datetime
    batchNumber: Optional[str] = None
    qualityGrade: Optional[str] = None
    storageType: StorageType = StorageType.AMBIENT


class IncomingStockCreate(IncomingStockBase):
    pass


class IncomingStockUpdate(BaseModel):
    status: Optional[IncomingStatus] = None
    receivedDate: Optional[datetime] = None
    qualityCheck: Optional[str] = None
    qualityNotes: Optional[str] = None
    storageLocation: Optional[str] = None


class IncomingStockResponse(IncomingStockBase):
    id: str
    status: IncomingStatus
    receivedDate: Optional[datetime] = None
    qualityCheck: str = "pending"
    qualityNotes: Optional[str] = None
    storageLocation: Optional[str] = None
    createdAt: datetime
    updatedAt: datetime

    class Config:
        from_attributes = True


class OutgoingStockBase(BaseModel):
    warehouseId: str
    productId: str
    variantId: Optional[str] = None
    orderId: str
    quantity: int = Field(ge=1)
    batchNumber: Optional[str] = None


class OutgoingStockCreate(OutgoingStockBase):
    pass


class OutgoingStockUpdate(BaseModel):
    status: Optional[OutgoingStatus] = None
    dispatchDate: Optional[datetime] = None
    deliveryPartnerId: Optional[str] = None
    notes: Optional[str] = None


class OutgoingStockResponse(OutgoingStockBase):
    id: str
    status: OutgoingStatus
    dispatchDate: Optional[datetime] = None
    deliveryPartnerId: Optional[str] = None
    notes: Optional[str] = None
    createdAt: datetime
    updatedAt: datetime

    class Config:
        from_attributes = True


class ColdStorageBase(BaseModel):
    warehouseId: str
    productId: str
    variantId: Optional[str] = None
    quantity: int = Field(ge=0)
    temperature: float
    humidity: Optional[float] = None
    storageType: str = "chilled"
    optimalTemperature: Optional[float] = None
    optimalHumidity: Optional[float] = None


class ColdStorageCreate(ColdStorageBase):
    pass


class ColdStorageUpdate(BaseModel):
    quantity: Optional[int] = Field(None, ge=0)
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    optimalTemperature: Optional[float] = None
    optimalHumidity: Optional[float] = None


class ColdStorageResponse(ColdStorageBase):
    id: str
    addedDate: datetime
    expectedRemoval: Optional[datetime]
    createdAt: datetime
    updatedAt: datetime

    class Config:
        from_attributes = True


class WarehouseTransferBase(BaseModel):
    fromWarehouseId: str
    toWarehouseId: str
    productId: str
    variantId: Optional[str] = None
    quantity: int = Field(ge=1)
    reason: str
    batchNumber: Optional[str] = None


class WarehouseTransferCreate(WarehouseTransferBase):
    pass


class WarehouseTransferUpdate(BaseModel):
    status: Optional[str] = None
    transferredBy: Optional[str] = None
    receivedBy: Optional[str] = None


class WarehouseTransferResponse(WarehouseTransferBase):
    id: str
    status: str
    transferredBy: Optional[str] = None
    transferredAt: Optional[datetime] = None
    receivedBy: Optional[str] = None
    receivedAt: Optional[datetime] = None
    createdAt: datetime
    updatedAt: datetime

    class Config:
        from_attributes = True


class WarehouseDashboardResponse(BaseModel):
    warehouse: WarehouseResponse
    stockSummary: Dict[str, Any]
    capacityUtilization: float
    coldStorageUtilization: float
    incomingToday: int
    outgoingToday: int
    lowStockItems: List[Dict[str, Any]]
    recentActivities: List[Dict[str, Any]]
