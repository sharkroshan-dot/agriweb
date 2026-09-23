from fastapi import APIRouter, Depends, HTTPException, status, Query, Body
from typing import List, Optional
from app.api.v1.auth import get_current_user
from app.schemas.product import (
    ProductResponse, ProductCreate, ProductUpdate,
    CategoryResponse, CategoryCreate, CategoryUpdate,
    ProductReviewResponse, ProductReviewCreate,
    InventoryResponse, InventoryUpdate,
    ProductSearchParams
)
from app.services.product_service import ProductService
from app.services.user_service import UserService
from app.repositories.base_repository import BaseRepository
from bson import ObjectId
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

harvest_plan_repo = BaseRepository("harvest_plans")

def _serialize_product(product: dict) -> dict:
    product["id"] = str(product["_id"])
    product["_id"] = str(product["_id"])
    for key in ("farmerId", "categoryId", "subCategoryId", "parentId"):
        if key in product and product[key] is not None:
            product[key] = str(product[key])
    # Quality transparency: declared vs verified must be visible to customers.
    product["farmerDeclaredGrade"] = product.get("farmerDeclaredGrade") or product.get("qualityGrade")
    product["effectiveGrade"] = product.get("verifiedGrade") or product.get("farmerDeclaredGrade") or product.get("qualityGrade")
    product.setdefault("verificationStatus", "farmer_declared")
    return product

# ============== CATEGORY ENDPOINTS ==============

@router.get("/categories", response_model=List[CategoryResponse])
async def get_categories(
    include_tree: bool = Query(False, description="Include category tree"),
):
    """
    Get all categories.
    
    - **include_tree**: If true, returns nested category tree
    """
    if include_tree:
        categories = await ProductService.get_category_tree()
    else:
        categories = await ProductService.get_all_categories()
    
    # Convert ObjectId to string
    for category in categories:
        category["id"] = str(category["_id"])
        if "children" in category:
            for child in category["children"]:
                child["id"] = str(child["_id"])
    
    return categories

@router.post("/categories", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_category(
    data: CategoryCreate,
    current_user: dict = Depends(get_current_user)
):
    """
    Create a new category (Admin only).
    
    - **name**: Category name
    - **slug**: URL-friendly name
    - **description**: Category description
    - **parentId**: Parent category ID (for subcategories)
    - **icon**: Icon identifier
    - **imageUrl**: Category image URL
    - **order**: Display order
    """
    # Check if admin
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can create categories"
        )
    
    category = await ProductService.create_category(data)
    if not category:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Category slug already exists"
        )
    
    category["id"] = str(category["_id"])
    return category

@router.put("/categories/{category_id}", response_model=CategoryResponse)
async def update_category(
    category_id: str,
    data: CategoryUpdate,
    current_user: dict = Depends(get_current_user)
):
    """
    Update a category (Admin only).
    """
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can update categories"
        )
    
    category = await ProductService.update_category(category_id, data)
    if not category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found or slug already exists"
        )
    
    category["id"] = str(category["_id"])
    return category

@router.delete("/categories/{category_id}")
async def delete_category(
    category_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Delete a category (Admin only).
    """
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can delete categories"
        )
    
    success = await ProductService.delete_category(category_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Category has products or subcategories"
        )
    
    return {
        "success": True,
        "message": "Category deleted successfully"
    }

# ============== PRODUCT ENDPOINTS ==============

@router.post("", status_code=status.HTTP_201_CREATED)
@router.post("/", status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def create_product(
    data: ProductCreate,
    current_user: dict = Depends(get_current_user)
):
    """
    Create a new product (Farmer only).
    
    - **name**: Product name
    - **slug**: URL-friendly name
    - **categoryId**: Category ID
    - **subCategoryId**: Sub-category ID (optional)
    - **price**: Price per unit
    - **unit**: Unit of measurement (kg, g, piece, etc.)
    - **quantity**: Available quantity
    - **description**: Product description
    - **images**: List of image URLs
    - **isOrganic**: Whether product is organic
    - **isFresh**: Whether product is fresh
    - **harvestDate**: Date of harvest
    - **expiryDate**: Expiry date
    - **attributes**: Additional attributes
    - **qualityGrade**: Premium, Standard, or Economy
    - **variants**: Product variants (optional)
    """
    # Check if user is a farmer
    if current_user.get("role") != "farmer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only farmers can create products"
        )

    # A harvest plan may only produce one product.
    if data.sourceHarvestPlanId:
        try:
            plan = await harvest_plan_repo.find_one(
                {"_id": ObjectId(data.sourceHarvestPlanId), "deletedAt": None}
            )
        except Exception:
            plan = None
        if plan and plan.get("productCreated"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A product was already created from this harvest plan, so another product cannot be added.",
            )

    from app.core.config import settings
    if not settings.DEBUG:
        from app.services.farmer_service import FarmerService
        farmer = await FarmerService.get_farmer_profile(str(current_user["_id"]))
        if not farmer:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Farmer profile not found"
            )
        if not farmer.get("isVerified"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Farmer profile must be verified to list products"
            )
    
    product = await ProductService.create_product(str(current_user["_id"]), data)
    if not product:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to create product"
        )
    
    return _serialize_product(product)

@router.get("/search")
async def search_products(
    query: Optional[str] = Query(None),
    category_id: Optional[str] = Query(None, alias="categoryId"),
    sub_category_id: Optional[str] = Query(None, alias="subCategoryId"),
    farmer_id: Optional[str] = Query(None, alias="farmerId"),
    min_price: Optional[float] = Query(None, alias="minPrice"),
    max_price: Optional[float] = Query(None, alias="maxPrice"),
    is_organic: Optional[bool] = Query(None, alias="isOrganic"),
    is_fresh: Optional[bool] = Query(None, alias="isFresh"),
    sort_by: str = Query("createdAt", alias="sortBy"),
    sort_order: str = Query("desc", alias="sortOrder"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    radius: Optional[int] = None,
    state: Optional[str] = Query(None, description="Filter by state"),
    district: Optional[str] = Query(None, description="Filter by district"),
    city: Optional[str] = Query(None, description="Filter by city"),
    country: Optional[str] = Query(None, description="Filter by country"),
):
    """
    Search and filter products.
    
    - **query**: Search term
    - **categoryId**: Filter by category
    - **subCategoryId**: Filter by sub-category
    - **farmerId**: Filter by farmer
    - **minPrice**: Minimum price
    - **maxPrice**: Maximum price
    - **isOrganic**: Filter organic products
    - **isFresh**: Filter fresh products
    - **sortBy**: Sort field (createdAt, price, rating)
    - **sortOrder**: Sort order (asc, desc)
    - **lat/lng/radius**: Location-based search (radius in km)
    - **state/district/city**: Filter by place
    """
    params = ProductSearchParams(
        query=query,
        categoryId=category_id,
        subCategoryId=sub_category_id,
        farmerId=farmer_id,
        minPrice=min_price,
        maxPrice=max_price,
        isOrganic=is_organic,
        isFresh=is_fresh,
        sortBy=sort_by,
        sortOrder=sort_order,
        page=page,
        limit=limit,
        lat=lat,
        lng=lng,
        radius=radius,
        state=state,
        district=district,
        city=city,
        country=country,
    )
    
    # If location is provided, use nearby search
    if lat and lng and radius:
        products = await ProductService.get_nearby_products(lat, lng, radius, (page-1)*limit, limit)
        total = len(products)  # In production, get total from aggregation
        total_pages = (total + limit - 1) // limit
    else:
        result = await ProductService.search_products(params)
        products = result["products"]
        total = result["total"]
        total_pages = result["totalPages"]

    # ObjectIds must be converted to strings for JSON serialization.
    for product in products:
        _serialize_product(product)

    return {
        "success": True,
        "data": {
            "products": products,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": total_pages
            }
        }
    }

@router.get("/featured")
async def get_featured_products(
    limit: int = Query(10, ge=1, le=50),
):
    """Get featured products."""
    products = await ProductService.get_featured_products(limit)
    return {
        "success": True,
        "data": products
    }

@router.get("/{product_id}")
async def get_product(
    product_id: str,
):
    """
    Get product by ID.
    
    Returns product details with category, variants, and recent reviews.
    """
    product = await ProductService.get_product(product_id)
    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found"
        )
    
    product["id"] = str(product["_id"])
    product["farmerId"] = str(product["farmerId"])
    
    # Convert category _id to id
    if product.get("category"):
        product["category"]["id"] = str(product["category"]["_id"])
    
    # Convert subCategory _id to id if present
    if product.get("subCategory"):
        product["subCategory"]["id"] = str(product["subCategory"]["_id"])
    
    product["farmerDeclaredGrade"] = product.get("farmerDeclaredGrade") or product.get("qualityGrade")
    product["effectiveGrade"] = product.get("verifiedGrade") or product.get("farmerDeclaredGrade") or product.get("qualityGrade")
    product.setdefault("verificationStatus", "farmer_declared")
    
    return product

@router.get("/slug/{slug}")
async def get_product_by_slug(
    slug: str,
):
    """Get product by slug."""
    product = await ProductService.get_product_by_slug(slug)
    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found"
        )
    
    return product

@router.put("/{product_id}", response_model=ProductResponse)
async def update_product(
    product_id: str,
    data: ProductUpdate,
    current_user: dict = Depends(get_current_user)
):
    """
    Update a product (Farmer only).
    """
    # Get product
    product = await ProductService.get_product(product_id)
    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found"
        )
    
    # Check if user owns this product
    if str(product["farmerId"]) != str(current_user["_id"]):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to update this product"
        )
    
    updated_product = await ProductService.update_product(product_id, data)
    if not updated_product:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to update product"
        )
    
    updated_product["id"] = str(updated_product["_id"])
    updated_product["farmerId"] = str(updated_product["farmerId"])
    
    # Convert category _id to id
    if updated_product.get("category"):
        updated_product["category"]["id"] = str(updated_product["category"]["_id"])
    
    # Convert subCategory _id to id if present
    if updated_product.get("subCategory"):
        updated_product["subCategory"]["id"] = str(updated_product["subCategory"]["_id"])
    
    return updated_product

@router.delete("/{product_id}")
async def delete_product(
    product_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Delete a product (Farmer only).
    """
    # Get product
    product = await ProductService.get_product(product_id)
    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found"
        )
    
    # Check if user owns this product
    if str(product["farmerId"]) != str(current_user["_id"]):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to delete this product"
        )
    
    success = await ProductService.delete_product(product_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to delete product"
        )
    
    return {
        "success": True,
        "message": "Product deleted successfully"
    }

@router.get("/{product_id}/stats")
async def get_product_stats(
    product_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Get product statistics (Farmer only).
    """
    # Get product
    product = await ProductService.get_product(product_id)
    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found"
        )
    
    # Check if user owns this product
    if str(product["farmerId"]) != str(current_user["_id"]):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to view this product's stats"
        )
    
    stats = await ProductService.get_product_stats(product_id)
    return {
        "success": True,
        "data": stats
    }

# ============== REVIEW ENDPOINTS ==============

@router.post("/{product_id}/reviews", response_model=ProductReviewResponse, status_code=status.HTTP_201_CREATED)
async def create_product_review(
    product_id: str,
    data: ProductReviewCreate,
    current_user: dict = Depends(get_current_user)
):
    """
    Create a review for a product (Customer only).
    
    - **rating**: 1-5 stars
    - **comment**: Review text
    - **orderId**: Order ID (to verify purchase)
    - **images**: Optional images
    """
    # Check if user is a customer
    if current_user.get("role") != "customer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only customers can write reviews"
        )
    
    review = await ProductService.create_review(
        str(current_user["_id"]),
        product_id,
        data
    )
    
    if not review:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You can only review products from your own delivered orders, and each order can be rated only once"
        )
    
    review["id"] = str(review["_id"])
    return review

@router.get("/{product_id}/reviews")
async def get_product_reviews(
    product_id: str,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=50),
):
    """Get product reviews."""
    skip = (page - 1) * limit
    reviews, total = await ProductService.get_product_reviews(product_id, skip, limit)
    
    return {
        "success": True,
        "data": {
            "reviews": reviews,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit
            }
        }
    }

# ============== INVENTORY ENDPOINTS ==============

@router.put("/{product_id}/inventory", response_model=InventoryResponse)
async def update_inventory(
    product_id: str,
    data: InventoryUpdate,
    current_user: dict = Depends(get_current_user)
):
    """
    Update product inventory (Farmer only).
    """
    # Get product
    product = await ProductService.get_product(product_id)
    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found"
        )
    
    # Check if user owns this product
    if str(product["farmerId"]) != str(current_user["_id"]):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to update this product's inventory"
        )
    
    inventory = await ProductService.update_inventory(product_id, data)
    if not inventory:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to update inventory"
        )

    return {
        "id": str(inventory["_id"]),
        "productId": str(inventory.get("product_id", product_id)),
        "variantId": inventory.get("variant_id"),
        "quantity": inventory.get("total_stock", 0),
        "reservedQuantity": inventory.get("reserved_stock", 0),
        "unit": inventory.get("unit", "kg"),
        "location": inventory.get("location"),
        "warehouseId": inventory.get("warehouse_id"),
        "batchNumber": inventory.get("batch_number"),
        "productionDate": inventory.get("production_date"),
        "expiryDate": inventory.get("expiry_date"),
        "quality": inventory.get("quality", "standard"),
        "lastRestocked": inventory.get("updated_at"),
        "updatedAt": inventory.get("updated_at"),
    }


# ============== FILE UPLOAD ENDPOINTS ==============

import os
import uuid
from fastapi import UploadFile, File
from app.core.config import settings

@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """Upload a file (product image, avatar, etc.)."""
    from app.utils.file_security import validate_upload, UploadValidationError

    upload_dir = settings.UPLOAD_DIR
    os.makedirs(upload_dir, exist_ok=True)

    content = await file.read()
    try:
        ext = validate_upload(
            file.filename or "file",
            content,
            content_type=file.content_type,
            max_bytes=settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
        )
    except UploadValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(upload_dir, filename)

    with open(filepath, "wb") as f:
        f.write(content)

    url = f"/uploads/{filename}"
    return {"success": True, "data": {"url": url, "filename": filename}}
