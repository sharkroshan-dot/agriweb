from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.product_repository import product_repository
from app.repositories.category_repository import category_repository
from app.repositories.inventory_repository import inventory_repository
from app.repositories.price_history_repository import price_history_repository
from app.repositories.product_review_repository import product_review_repository
from app.repositories.base_repository import BaseRepository
from app.schemas.product import (
    ProductCreate, ProductUpdate, ProductSearchParams,
    CategoryCreate, CategoryUpdate,
    ProductReviewCreate, ProductReviewUpdate,
    InventoryCreate, InventoryUpdate
)
import logging

logger = logging.getLogger(__name__)

harvest_plan_repo = BaseRepository("harvest_plans")


class ProductService:
    """Product service with business logic."""
    
    # Category Operations
    @staticmethod
    async def create_category(data: CategoryCreate) -> Optional[Dict[str, Any]]:
        """Create a new category."""
        # Check if slug exists
        existing = await category_repository.get_by_slug(data.slug)
        if existing:
            return None
        
        category_id = await category_repository.create_category(data.dict())
        if not category_id:
            return None
        
        return await category_repository.get_by_id(category_id)
    
    @staticmethod
    async def get_category(category_id: str) -> Optional[Dict[str, Any]]:
        """Get category by ID."""
        return await category_repository.get_by_id(category_id)
    
    @staticmethod
    async def get_all_categories() -> List[Dict[str, Any]]:
        """Get all categories."""
        return await category_repository.get_all_categories()
    
    @staticmethod
    async def get_category_tree() -> List[Dict[str, Any]]:
        """Get category tree."""
        return await category_repository.get_category_tree()
    
    @staticmethod
    async def update_category(category_id: str, data: CategoryUpdate) -> Optional[Dict[str, Any]]:
        """Update category."""
        # Check if category exists
        category = await category_repository.get_by_id(category_id)
        if not category:
            return None
        
        # Check if slug is unique
        if data.slug:
            existing = await category_repository.get_by_slug(data.slug)
            if existing and str(existing["_id"]) != category_id:
                return None
        
        update_data = data.dict(exclude_unset=True)
        success = await category_repository.update_category(category_id, update_data)
        if not success:
            return None
        
        return await category_repository.get_by_id(category_id)
    
    @staticmethod
    async def delete_category(category_id: str) -> bool:
        """Delete category."""
        # Check if category has products
        stats = await category_repository.get_category_stats(category_id)
        if stats.get("productCount", 0) > 0:
            return False
        
        return await category_repository.delete_category(category_id)
    
    # Product Operations
    @staticmethod
    def _enrich_location_fields(product_data: Dict[str, Any]) -> None:
        """Populate product state/district/city when the caller only supplied a
        Nominatim-style address string (e.g. 'Manachanallur, Tiruchirappalli,
        Tamil Nadu, India'). Explicitly provided fields always win.
        """
        if product_data.get("state") and product_data.get("district") and product_data.get("city"):
            return
        from app.core.constants import INDIAN_STATES, INDIAN_DISTRICTS

        address = ""
        loc = product_data.get("location") or {}
        if isinstance(loc, dict):
            address = loc.get("address") or ""
        if not address:
            address = product_data.get("farmAddress") or ""

        parts = [p.strip() for p in address.split(",") if p.strip()]
        if len(parts) < 2:
            return

        # Last part (minus trailing 'India'/'Bharat') is the state.
        country_hint = ""
        if parts[-1].lower() in ("india", "bharat", "in"):
            country_hint = "India"
        state_hint = parts[-1]
        if country_hint and len(parts) >= 2:
            state_hint = parts[-2]
        matched_state = next((s for s in INDIAN_STATES if s.lower() == state_hint.lower()), "")
        if not matched_state:
            matched_state = next((s for s in INDIAN_STATES if s.lower() in state_hint.lower()), "")

        district_hint = ""
        city_hint = ""
        if matched_state:
            district_hint = parts[-2] if (parts[-1].lower() in ("india", "bharat", "in")) else parts[-1]
            if district_hint.lower() == matched_state.lower() and len(parts) >= 3:
                district_hint = parts[-3]
            district_hint = district_hint.replace(" district", "").replace(" District", "")
            city_hint = parts[0]

        if not product_data.get("country") and country_hint:
            product_data["country"] = country_hint
        if not product_data.get("state") and matched_state:
            product_data["state"] = matched_state
        if not product_data.get("district") and district_hint:
            product_data["district"] = district_hint
        if not product_data.get("city") and city_hint:
            product_data["city"] = city_hint

    @staticmethod
    async def create_product(farmer_id: str, data: ProductCreate) -> Optional[Dict[str, Any]]:
        """Create a new product."""
        # Check if slug exists. This must also consider soft-deleted products,
        # which still hold the unique slug index.
        import random
        import string
        existing = await product_repository.find_one({"slug": data.slug})
        if existing:
            for _ in range(20):
                suffix = ''.join(random.choices(string.digits, k=6))
                candidate = f"{data.slug}-{suffix}"
                if not await product_repository.find_one({"slug": candidate}):
                    data.slug = candidate
                    break
        
        # Prepare product data
        product_data = data.dict(exclude={"variants"})
        product_data["farmerId"] = ObjectId(farmer_id)
        product_data["status"] = "active"
        if not product_data.get("country"):
            product_data["country"] = "India"

        # A product grade is farmer-declared until verified by a non-farmer actor.
        from app.core.quality import base_verification_fields
        product_data.update(base_verification_fields(product_data.get("qualityGrade")))

        # Enrich location fields (state/district/city) from the chosen place
        ProductService._enrich_location_fields(product_data)
        
        # Create product
        product_id = await product_repository.create_product(product_data)
        if not product_id:
            return None
        
        # Create variants if provided
        if data.variants:
            for variant in data.variants:
                variant_data = variant.dict()
                variant_data["productId"] = ObjectId(product_id)
                await inventory_repository.create_inventory(variant_data)
        
        # Create inventory record for the product
        await inventory_repository.ensure_inventory_exists(
            product_id, farmer_id, data.quantity, data.unit
        )

        # Create initial price history
        await price_history_repository.create_price_history({
            "productId": ObjectId(product_id),
            "price": data.price,
            "date": datetime.utcnow()
        })

        # If the product was created from a harvest plan, lock the plan's
        # lifecycle (prev cannot be walked back) and mark it harvested so it
        # leaves the customer's pre-harvest page and moves to the harvested list.
        if data.sourceHarvestPlanId:
            try:
                plan_oid = ObjectId(data.sourceHarvestPlanId)
                # Mark harvested only if not already harvested (keeps original harvestedAt).
                await harvest_plan_repo.collection.update_one(
                    {"_id": plan_oid, "deletedAt": None, "status": {"$ne": "harvested"}},
                    {"$set": {
                        "status": "harvested",
                        "stage": "harvested",
                        "harvestedAt": datetime.utcnow(),
                        "updatedAt": datetime.utcnow(),
                    }},
                )
                await harvest_plan_repo.update(
                    {"_id": plan_oid, "deletedAt": None},
                    {
                        "productCreated": True,
                        "productId": ObjectId(product_id),
                        "updatedAt": datetime.utcnow(),
                    },
                )
            except Exception as e:
                logger.warning(f"Failed to link harvest plan {data.sourceHarvestPlanId} to product {product_id}: {e}")

        return await product_repository.get_by_id(product_id)
    
    @staticmethod
    async def get_product(product_id: str) -> Optional[Dict[str, Any]]:
        """Get product by ID."""
        product = await product_repository.get_by_id(product_id)
        if product:
            # Get category details
            if product.get("categoryId"):
                category = await category_repository.get_by_id(str(product["categoryId"]))
                if category:
                    product["category"] = category
            
            # Get variants
            variants = await inventory_repository.get_by_product_id(product_id)
            product["variants"] = [variants] if variants else []
            
            # Get reviews
            reviews = await product_review_repository.get_by_product_id(product_id, limit=5)
            product["recentReviews"] = reviews
            
            # Get farmer details
            from app.services.user_service import UserService
            farmer = await UserService.get_user_by_id(str(product["farmerId"]))
            if farmer:
                product["farmerName"] = f"{farmer.get('firstName', '')} {farmer.get('lastName', '')}"
        
        return product
    
    @staticmethod
    async def get_product_by_slug(slug: str) -> Optional[Dict[str, Any]]:
        """Get product by slug."""
        product = await product_repository.get_by_slug(slug)
        if product:
            product["id"] = str(product["_id"])
        return product
    
    @staticmethod
    async def get_farmer_products(
        farmer_id: str,
        skip: int = 0,
        limit: int = 100,
        include_inactive: bool = False,
        include_basket_only: bool = False
    ) -> tuple[List[Dict[str, Any]], int]:
        """Get products by farmer."""
        products = await product_repository.get_by_farmer(
            farmer_id, skip, limit,
            include_inactive=include_inactive,
            include_basket_only=include_basket_only
        )
        total = await product_repository.count({
            "farmerId": ObjectId(farmer_id),
            "deletedAt": None
        })
        
        # Convert ObjectId to string
        for product in products:
            product["id"] = str(product["_id"])
        
        return products, total
    
    @staticmethod
    async def update_product(product_id: str, data: ProductUpdate) -> Optional[Dict[str, Any]]:
        """Update product."""
        # Check if product exists
        product = await product_repository.get_by_id(product_id)
        if not product:
            return None

        # Verified products: the grade is locked. A farmer cannot downgrade an
        # independently verified grade to hide quality issues; they must create
        # a new batch/lot instead.
        from app.core.quality import VERIFICATION_STATUS_VERIFIED, VERIFICATION_STATUS_BUYER
        update_data = data.dict(exclude_unset=True)
        if product.get("verificationStatus") in (VERIFICATION_STATUS_VERIFIED, VERIFICATION_STATUS_BUYER):
            if "qualityGrade" in update_data and update_data["qualityGrade"] != product.get("qualityGrade"):
                return None
            if "qualityGrade" in update_data:
                update_data.pop("qualityGrade", None)

        # Check if slug is unique
        if data.slug:
            existing = await product_repository.get_by_slug(data.slug)
            if existing and str(existing["_id"]) != product_id:
                return None

        update_data = data.dict(exclude_unset=True)
        ProductService._enrich_location_fields(update_data)
        success = await product_repository.update_product(product_id, update_data)
        if not success:
            return None
        
        # Sync quantity to inventory record
        if data.quantity is not None:
            await inventory_repository.ensure_inventory_exists(
                product_id, str(product["farmerId"]), data.quantity, data.unit or product.get("unit", "kg")
            )
        
        # Update price history if price changed
        if data.price is not None and data.price != product.get("price"):
            await price_history_repository.create_price_history({
                "productId": ObjectId(product_id),
                "price": data.price,
                "date": datetime.utcnow()
            })

        # Fire back-in-stock / price-drop alerts
        from app.services.product_alert_service import product_alert_service
        await product_alert_service.check_and_notify(product_id)
        
        return await product_repository.get_by_id(product_id)
    
    @staticmethod
    async def delete_product(product_id: str) -> bool:
        """Delete product."""
        return await product_repository.delete_product(product_id)
    
    @staticmethod
    async def search_products(params: ProductSearchParams) -> Dict[str, Any]:
        """Search products with filters."""
        products, total = await product_repository.search_products(params)

        # Resolve category names from categoryId references (may be an ObjectId
        # string or a slug string such as "vegetables").
        category_ids = set()
        for product in products:
            cid = product.get("categoryId")
            if cid:
                category_ids.add(str(cid))

        if category_ids:
            valid_oids = []
            slugs = []
            for cid in category_ids:
                try:
                    valid_oids.append(ObjectId(cid))
                except Exception:
                    slugs.append(cid)
            criteria = []
            if valid_oids:
                criteria.append({"_id": {"$in": valid_oids}})
            if slugs:
                criteria.append({"slug": {"$in": slugs}})
            categories = await category_repository.find_many({"$or": criteria}) if criteria else []
            category_map = {str(c["_id"]): c.get("name", "General") for c in categories}
            category_map.update({c.get("slug"): c.get("name", "General") for c in categories if c.get("slug")})
            for product in products:
                cid = str(product.get("categoryId", ""))
                product["category"] = category_map.get(cid) or category_map.get(product.get("categoryId")) or "General"
        else:
            for product in products:
                product["category"] = "General"

        # Convert ObjectId to string
        for product in products:
            product["id"] = str(product["_id"])

        return {
            "products": products,
            "total": total,
            "page": params.page,
            "limit": params.limit,
            "totalPages": (total + params.limit - 1) // params.limit
        }
    
    @staticmethod
    async def get_nearby_products(
        lat: float,
        lng: float,
        radius: int,
        skip: int = 0,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Get nearby products."""
        return await product_repository.get_nearby_products(lat, lng, radius, skip, limit)
    
    @staticmethod
    async def get_featured_products(limit: int = 10) -> List[Dict[str, Any]]:
        """Get featured products."""
        products = await product_repository.get_featured_products(limit)
        for product in products:
            product["id"] = str(product["_id"])
        return products
    
    @staticmethod
    async def get_product_stats(product_id: str) -> Dict[str, Any]:
        """Get product statistics."""
        return await product_repository.get_product_stats(product_id)
    
    # Review Operations
    @staticmethod
    async def create_review(
        user_id: str,
        product_id: str,
        data: ProductReviewCreate
    ) -> Optional[Dict[str, Any]]:
        """Create a product review. Each delivered purchase (order) may be reviewed once."""
        from app.repositories.order_repository import OrderRepository
        order_repo = OrderRepository()

        order = None
        if data.orderId:
            order = await order_repo.get_by_id(data.orderId)
            if not order:
                return None

        if order:
            if str(order.get("customerId", "")) != user_id:
                return None
            if order.get("orderStatus") != "delivered":
                return None
            contains = any(
                str(item.get("productId")) == product_id
                for item in order.get("items", [])
            )
            if not contains:
                return None
            # Prevent re-reviewing the same purchase
            already = await product_review_repository.find_one({
                "userId": ObjectId(user_id),
                "productId": ObjectId(product_id),
                "orderId": data.orderId,
                "deletedAt": None,
            })
            if already:
                return None
        else:
            # No order id given: require any delivered purchase of this product
            has_purchased = await order_repo.count({
                "customerId": ObjectId(user_id),
                "items.productId": ObjectId(product_id),
                "orderStatus": "delivered"
            }) > 0
            if not has_purchased:
                return None
        
        # Create review
        review_data = data.dict()
        review_data["userId"] = ObjectId(user_id)
        review_data["productId"] = ObjectId(product_id)
        review_data["isVerifiedPurchase"] = True
        review_data["helpful"] = 0
        
        review_id = await product_review_repository.create_review(review_data)
        if not review_id:
            return None
        
        # Update product rating (recomputed from all customer reviews)
        await product_repository.update_rating(product_id)
        
        review = await product_review_repository.get_by_id(review_id)
        if review:
            from app.services.user_service import UserService
            user = await UserService.get_user_by_id(user_id)
            if user:
                review["userName"] = f"{user.get('firstName', '')} {user.get('lastName', '')}".strip() or "Customer"
        return review
    
    @staticmethod
    async def get_product_reviews(
        product_id: str,
        skip: int = 0,
        limit: int = 20
    ) -> tuple[List[Dict[str, Any]], int]:
        """Get product reviews."""
        reviews = await product_review_repository.get_by_product_id(
            product_id, skip, limit, sort_by="createdAt", sort_order="desc"
        )
        total = await product_review_repository.count({
            "productId": ObjectId(product_id),
            "deletedAt": None
        })
        
        # Get user details for each review
        from app.services.user_service import UserService
        for review in reviews:
            user = await UserService.get_user_by_id(str(review["userId"]))
            if user:
                review["userName"] = f"{user.get('firstName', '')} {user.get('lastName', '')}"
                review["userAvatar"] = user.get("avatarUrl")
            review["id"] = str(review["_id"])
        
        return reviews, total
    
    # Inventory Operations
    @staticmethod
    async def update_inventory(
        product_id: str,
        data: InventoryUpdate
    ) -> Optional[Dict[str, Any]]:
        """Update inventory."""
        product = await product_repository.get_by_id(product_id)
        if not product:
            return None

        farmer_id = str(product.get("farmerId"))
        unit = product.get("unit", "kg")

        inventory = await inventory_repository.get_by_product_id(product_id)
        if not inventory:
            inv_id = await inventory_repository.ensure_inventory_exists(
                product_id, farmer_id, 0, unit
            )
            if not inv_id:
                return None
            inventory = await inventory_repository.get_by_product_id(product_id)
            if not inventory:
                return None

        operation = data.operation or "restock"
        quantity = data.quantity or 0

        if operation == "restock":
            success = await inventory_repository.atomic_restock(
                str(inventory["_id"]), quantity
            )
        else:
            success = await inventory_repository.update_inventory(
                str(inventory["_id"]), {"total_stock": quantity}
            )

        if not success:
            return None

        # Apply any remaining metadata/reserved updates
        update_data = data.dict(exclude_unset=True, exclude={"quantity", "operation"})
        reserved = update_data.pop("reservedQuantity", None)
        if reserved is not None:
            update_data["reserved_stock"] = reserved
        if update_data:
            await inventory_repository.update_inventory(
                str(inventory["_id"]), update_data
            )

        # Fire back-in-stock / price-drop alerts based on available stock
        from app.services.product_alert_service import product_alert_service
        merged = await inventory_repository.get_by_id(str(inventory["_id"]))
        if merged:
            new_total = merged.get("total_stock", 0) or 0
            if product.get("quantity") != new_total:
                await product_repository.update_product(product_id, {"quantity": new_total})
            available = max(
                0,
                new_total
                - (merged.get("reserved_stock", 0) or 0)
                - (merged.get("sold_stock", 0) or 0),
            )
            await product_alert_service.check_and_notify(product_id, quantity=available)

        return merged or await inventory_repository.get_by_id(str(inventory["_id"]))

# Singleton instance
product_service = ProductService()
