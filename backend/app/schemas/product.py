from pydantic import BaseModel, Field, validator
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum

class ProductStatus(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    OUT_OF_STOCK = "out_of_stock"
    PENDING_REVIEW = "pending_review"

class ProductUnit(str, Enum):
    KG = "kg"
    G = "g"
    LB = "lb"
    PIECE = "piece"
    BUNCH = "bunch"
    LITER = "liter"
    ML = "ml"
    DOZEN = "dozen"
    BOX = "box"
    LITRE = "litre"
    BUNDLE = "bundle"

class QualityGrade(str, Enum):
    PREMIUM = "premium"
    STANDARD = "standard"
    ECONOMY = "economy"

class StorageType(str, Enum):
    AMBIENT = "ambient"
    CHILLED = "chilled"
    FROZEN = "frozen"
    CONTROLLED = "controlled_atmosphere"

# Category Schemas
class CategoryBase(BaseModel):
    name: str
    slug: str
    description: Optional[str] = None
    parentId: Optional[str] = None
    icon: Optional[str] = None
    imageUrl: Optional[str] = None
    order: int = 0
    isActive: bool = True

class CategoryCreate(CategoryBase):
    pass

class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = None
    parentId: Optional[str] = None
    icon: Optional[str] = None
    imageUrl: Optional[str] = None
    order: Optional[int] = None
    isActive: Optional[bool] = None

class CategoryResponse(CategoryBase):
    id: str
    createdAt: datetime
    updatedAt: datetime
    children: List['CategoryResponse'] = []
    
    class Config:
        from_attributes = True

# Product Schemas
class ProductVariantBase(BaseModel):
    attributes: Dict[str, Any]
    price: float = Field(gt=0)
    quantity: int = Field(ge=0)
    sku: Optional[str] = None
    imageUrl: Optional[str] = None
    isActive: bool = True

class ProductVariantCreate(ProductVariantBase):
    pass

class ProductVariantUpdate(BaseModel):
    attributes: Optional[Dict[str, Any]] = None
    price: Optional[float] = Field(None, gt=0)
    quantity: Optional[int] = Field(None, ge=0)
    sku: Optional[str] = None
    imageUrl: Optional[str] = None
    isActive: Optional[bool] = None

class ProductVariantResponse(ProductVariantBase):
    id: str
    productId: str
    createdAt: datetime
    updatedAt: datetime
    
    class Config:
        from_attributes = True

class ProductBase(BaseModel):
    name: str
    slug: str
    categoryId: str
    subCategoryId: Optional[str] = None
    price: float = Field(gt=0)
    unit: ProductUnit
    quantity: int = Field(ge=0)
    description: str
    images: List[str] = []
    isOrganic: bool = False
    isFresh: bool = True
    harvestDate: Optional[datetime] = None
    expiryDate: Optional[datetime] = None
    storageInstructions: Optional[str] = None
    attributes: Dict[str, Any] = {}
    qualityGrade: QualityGrade = QualityGrade.STANDARD
    storageType: StorageType = StorageType.AMBIENT
    isActive: bool = True
    isFeatured: bool = False
    isBasketOnly: bool = False
    location: Optional[Dict[str, Any]] = None
    country: Optional[str] = "India"
    state: Optional[str] = None
    district: Optional[str] = None
    city: Optional[str] = None
    pickupAvailable: bool = False
    pickupInstructions: Optional[str] = None
    farmAddress: Optional[str] = None
    minBulkQty: int = Field(0, ge=0)
    bulkPrice: Optional[float] = Field(None, gt=0)
    bulkDiscountPercent: float = Field(0, ge=0, le=100)

class ProductCreate(ProductBase):
    variants: Optional[List[ProductVariantCreate]] = None
    sourceHarvestPlanId: Optional[str] = None

    @validator('slug')
    def validate_slug(cls, v):
        import re
        v = v.lower()
        v = re.sub(r'[^a-z0-9-]', '-', v)
        v = re.sub(r'-+', '-', v)
        return v.strip('-')

class ProductUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    categoryId: Optional[str] = None
    subCategoryId: Optional[str] = None
    price: Optional[float] = Field(None, gt=0)
    unit: Optional[ProductUnit] = None
    quantity: Optional[int] = Field(None, ge=0)
    description: Optional[str] = None
    images: Optional[List[str]] = None
    isOrganic: Optional[bool] = None
    isFresh: Optional[bool] = None
    harvestDate: Optional[datetime] = None
    expiryDate: Optional[datetime] = None
    storageInstructions: Optional[str] = None
    attributes: Optional[Dict[str, Any]] = None
    qualityGrade: Optional[QualityGrade] = None
    storageType: Optional[StorageType] = None
    isActive: Optional[bool] = None
    isFeatured: Optional[bool] = None
    isBasketOnly: Optional[bool] = None
    location: Optional[Dict[str, Any]] = None
    country: Optional[str] = None
    state: Optional[str] = None
    district: Optional[str] = None
    city: Optional[str] = None
    pickupAvailable: Optional[bool] = None
    pickupInstructions: Optional[str] = None
    farmAddress: Optional[str] = None
    minBulkQty: Optional[int] = Field(None, ge=0)
    bulkPrice: Optional[float] = Field(None, gt=0)
    bulkDiscountPercent: Optional[float] = Field(None, ge=0, le=100)
    
    @validator('slug')
    def validate_slug(cls, v):
        if v:
            import re
            v = v.lower()
            v = re.sub(r'[^a-z0-9-]', '-', v)
            v = re.sub(r'-+', '-', v)
            return v.strip('-')
        return v

class ProductResponse(ProductBase):
    id: str
    farmerId: str
    farmerName: Optional[str] = None
    farmName: Optional[str] = None
    category: Optional[CategoryResponse] = None
    subCategory: Optional[CategoryResponse] = None
    variants: List[ProductVariantResponse] = []
    ratings: Dict[str, Any] = {
        "average": 0,
        "count": 0
    }
    views: int = 0
    createdAt: datetime
    updatedAt: datetime
    isActive: bool
    
    class Config:
        from_attributes = True

# Product Search and Filter
class ProductSearchParams(BaseModel):
    query: Optional[str] = None
    categoryId: Optional[str] = None
    subCategoryId: Optional[str] = None
    farmerId: Optional[str] = None
    minPrice: Optional[float] = None
    maxPrice: Optional[float] = None
    isOrganic: Optional[bool] = None
    isFresh: Optional[bool] = None
    qualityGrade: Optional[QualityGrade] = None
    sortBy: str = "createdAt"
    sortOrder: str = "desc"
    page: int = 1
    limit: int = 20
    lat: Optional[float] = None
    lng: Optional[float] = None
    radius: Optional[int] = None
    state: Optional[str] = None
    district: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None

# Review Schemas
class ProductReviewBase(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str
    images: List[str] = []

class ProductReviewCreate(ProductReviewBase):
    orderId: str = ""

class ProductReviewUpdate(BaseModel):
    rating: Optional[int] = Field(None, ge=1, le=5)
    comment: Optional[str] = None
    images: Optional[List[str]] = None

class ProductReviewResponse(ProductReviewBase):
    id: str
    productId: str
    userId: str
    userName: str
    userAvatar: Optional[str] = None
    orderId: str
    isVerifiedPurchase: bool
    helpful: int = 0
    createdAt: datetime
    updatedAt: datetime
    
    class Config:
        from_attributes = True

# Inventory Schemas
class InventoryBase(BaseModel):
    productId: str
    variantId: Optional[str] = None
    quantity: int = Field(ge=0)
    reservedQuantity: int = Field(ge=0, default=0)
    location: Optional[Dict[str, Any]] = None
    warehouseId: Optional[str] = None
    batchNumber: Optional[str] = None
    productionDate: Optional[datetime] = None
    expiryDate: Optional[datetime] = None
    quality: QualityGrade = QualityGrade.STANDARD

class InventoryCreate(InventoryBase):
    pass

class InventoryUpdate(BaseModel):
    quantity: Optional[int] = Field(None, ge=0)
    reservedQuantity: Optional[int] = Field(None, ge=0)
    operation: Optional[str] = None  # "restock" (add to stock) or "set" (exact stock)
    location: Optional[Dict[str, Any]] = None
    warehouseId: Optional[str] = None
    batchNumber: Optional[str] = None
    productionDate: Optional[datetime] = None
    expiryDate: Optional[datetime] = None
    quality: Optional[QualityGrade] = None

class InventoryResponse(InventoryBase):
    id: str
    lastRestocked: Optional[datetime]
    updatedAt: datetime
    
    class Config:
        from_attributes = True

# Price History Schema
class PriceHistoryResponse(BaseModel):
    id: str
    productId: str
    variantId: Optional[str]
    price: float
    date: datetime
    
    class Config:
        from_attributes = True
