from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository
from app.schemas.product import ProductSearchParams
import logging
import re

logger = logging.getLogger(__name__)

class ProductRepository(BaseRepository):
    """Product repository."""
    
    def __init__(self):
        super().__init__("products")
    
    async def create_product(self, product_data: Dict[str, Any]) -> Optional[str]:
        """Create a new product."""
        product_data["createdAt"] = datetime.utcnow()
        product_data["updatedAt"] = datetime.utcnow()
        product_data["views"] = 0
        product_data["ratings"] = {"average": 0, "count": 0}
        
        # Generate slug if not provided
        if not product_data.get("slug"):
            product_data["slug"] = self.generate_slug(product_data["name"])
        
        return await self.create(product_data)
    
    async def get_by_id(self, product_id: str) -> Optional[Dict[str, Any]]:
        """Get product by ID."""
        try:
            obj_id = ObjectId(product_id)
            product = await self.find_one({"_id": obj_id, "deletedAt": None})
            if product:
                # Increment views
                await self.increment_views(product_id)
            return product
        except Exception as e:
            logger.error(f"Error getting product: {str(e)}")
            return None
    
    async def get_by_slug(self, slug: str) -> Optional[Dict[str, Any]]:
        """Get product by slug."""
        return await self.find_one({"slug": slug, "deletedAt": None})
    
    async def get_by_farmer(
        self,
        farmer_id: str,
        skip: int = 0,
        limit: int = 100,
        include_inactive: bool = False,
        include_basket_only: bool = False
    ) -> List[Dict[str, Any]]:
        """Get products by farmer."""
        filter = {
            "farmerId": ObjectId(farmer_id),
            "deletedAt": None
        }
        if not include_inactive:
            filter["isActive"] = True
        if not include_basket_only:
            filter["isBasketOnly"] = {"$ne": True}
        
        return await self.find_many(
            filter,
            skip=skip,
            limit=limit,
            sort=[("createdAt", -1)]
        )
    
    async def search_products(
        self,
        params: ProductSearchParams
    ) -> tuple[List[Dict[str, Any]], int]:
        """Search products with filters."""
        # Build filter
        filter = {
            "deletedAt": None,
            "isActive": True,
            "isBasketOnly": {"$ne": True}
        }
        
        if params.query:
            # Text search
            filter["$text"] = {"$search": params.query}
        
        if params.categoryId:
            filter["categoryId"] = ObjectId(params.categoryId)
        
        if params.subCategoryId:
            filter["subCategoryId"] = ObjectId(params.subCategoryId)
        
        if params.farmerId:
            filter["farmerId"] = ObjectId(params.farmerId)
        
        if params.minPrice is not None:
            filter["price"] = {"$gte": params.minPrice}
        if params.maxPrice is not None:
            if "price" in filter:
                filter["price"]["$lte"] = params.maxPrice
            else:
                filter["price"] = {"$lte": params.maxPrice}
        
        if params.isOrganic is not None:
            filter["isOrganic"] = params.isOrganic
        
        if params.isFresh is not None:
            filter["isFresh"] = params.isFresh
        
        if params.qualityGrade:
            filter["qualityGrade"] = params.qualityGrade

        if params.state:
            filter["state"] = params.state
        if params.district:
            filter["district"] = params.district
        if params.city:
            filter["city"] = params.city
        if params.country:
            filter["country"] = params.country
        
        # Sort
        sort_field = params.sortBy
        sort_order = -1 if params.sortOrder == "desc" else 1
        
        # Calculate skip
        skip = (params.page - 1) * params.limit
        
        # Get total count
        total = await self.count(filter)
        
        # Get products
        products = await self.find_many(
            filter,
            skip=skip,
            limit=params.limit,
            sort=[(sort_field, sort_order)]
        )
        
        # If location is provided, calculate distance
        if params.lat and params.lng and params.radius:
            # This would use aggregation pipeline for geospatial queries
            # For simplicity, we'll filter results in memory
            # In production, use $geoNear aggregation
            pass
        
        return products, total
    
    async def get_nearby_products(
        self,
        lat: float,
        lng: float,
        radius: int,
        skip: int = 0,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Get products near a location."""
        radius_meters = radius * 1000
        pipeline = [
            {
                "$match": {
                    "deletedAt": None,
                    "isActive": True,
                    "isBasketOnly": {"$ne": True}
                }
            },
            {
                "$lookup": {
                    "from": "farmer_profiles",
                    "localField": "farmerId",
                    "foreignField": "userId",
                    "as": "farmer"
                }
            },
            {
                "$unwind": {
                    "path": "$farmer",
                    "preserveNullAndEmptyArrays": True
                }
            },
            {
                "$addFields": {
                    "useLocation": {
                        "$cond": {
                            "if": {"$and": [{"$isArray": "$location.coordinates"}, {"$gt": [{"$size": "$location.coordinates"}, 0]}]},
                            "then": "$location",
                            "else": "$farmer.location"
                        }
                    }
                }
            },
            {
                "$match": {
                    "useLocation": {"$ne": None}
                }
            },
            {
                "$match": {
                    "useLocation": {
                        "$near": {
                            "$geometry": {
                                "type": "Point",
                                "coordinates": [lng, lat]
                            },
                            "$maxDistance": radius_meters
                        }
                    }
                }
            },
            {
                "$sort": {"createdAt": -1}
            },
            {
                "$skip": skip
            },
            {
                "$limit": limit
            }
        ]
        
        try:
            return await self.aggregate(pipeline)
        except Exception as e:
            logger.error(f"Error getting nearby products: {str(e)}")
            return []
    
    async def update_product(self, product_id: str, data: Dict[str, Any]) -> bool:
        """Update product."""
        try:
            obj_id = ObjectId(product_id)
            data["updatedAt"] = datetime.utcnow()
            return await self.update({"_id": obj_id}, data)
        except Exception as e:
            logger.error(f"Error updating product: {str(e)}")
            return False
    
    async def delete_product(self, product_id: str) -> bool:
        """Delete product."""
        try:
            obj_id = ObjectId(product_id)
            return await self.delete({"_id": obj_id})
        except Exception as e:
            logger.error(f"Error deleting product: {str(e)}")
            return False
    
    async def decrement_quantity(self, product_id: str, quantity: int) -> bool:
        """Decrement product quantity (after order placement)."""
        try:
            obj_id = ObjectId(product_id)
            result = await self.collection.update_one(
                {"_id": obj_id, "quantity": {"$gte": quantity}},
                {"$inc": {"quantity": -quantity}, "$set": {"updatedAt": datetime.utcnow()}}
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error decrementing quantity for {product_id}: {str(e)}")
            return False

    async def increment_views(self, product_id: str) -> bool:
        """Increment product view count."""
        try:
            obj_id = ObjectId(product_id)
            result = await self.collection.update_one(
                {"_id": obj_id},
                {"$inc": {"views": 1}}
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error incrementing views: {str(e)}")
            return False
    
    async def update_rating(
        self,
        product_id: str,
        new_rating: Optional[int] = None
    ) -> Dict[str, Any]:
        """Recompute the product rating from all customer reviews.

        The displayed average is always the true average of every rating given
        for this product, so it stays correct no matter how many customers rate.
        """
        try:
            from app.repositories.product_review_repository import product_review_repository
            obj_id = ObjectId(product_id)
            summary = await product_review_repository.rating_summary(product_id)
            count = summary.get("count", 0)
            total = summary.get("total", 0)
            average = round(total / count, 1) if count else 0.0

            await self.update(
                {"_id": obj_id},
                {"ratings": {"average": average, "count": count}}
            )
            return {"average": average, "count": count}
        except Exception as e:
            logger.error(f"Error updating rating: {str(e)}")
            return {}
    
    async def get_featured_products(
        self,
        limit: int = 10,
        category_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Get featured products."""
        filter = {
            "deletedAt": None,
            "isActive": True,
            "isFeatured": True,
            "isBasketOnly": {"$ne": True}
        }
        if category_id:
            filter["categoryId"] = ObjectId(category_id)
        
        return await self.find_many(
            filter,
            limit=limit,
            sort=[("ratings.average", -1), ("views", -1)]
        )
    
    async def get_product_stats(self, product_id: str) -> Dict[str, Any]:
        """Get product statistics."""
        product = await self.get_by_id(product_id)
        if not product:
            return {}
        
        # Get order stats
        from app.repositories.order_repository import OrderRepository
        order_repo = OrderRepository()
        
        # Count total orders for this product
        total_orders = await order_repo.count({
            "items.productId": ObjectId(product_id),
            "orderStatus": "delivered"
        })
        
        # Get total quantity sold
        orders = await order_repo.find_many({
            "items.productId": ObjectId(product_id),
            "orderStatus": "delivered"
        })
        
        total_sold = 0
        total_revenue = 0
        for order in orders:
            for item in order.get("items", []):
                if str(item.get("productId")) == product_id:
                    total_sold += item.get("quantity", 0)
                    total_revenue += item.get("totalPrice", 0)
        
        return {
            "totalOrders": total_orders,
            "totalSold": total_sold,
            "totalRevenue": total_revenue,
            "views": product.get("views", 0),
            "rating": product.get("ratings", {})
        }
    
    @staticmethod
    def generate_slug(name: str) -> str:
        """Generate URL-friendly slug from name."""
        slug = name.lower()
        slug = re.sub(r'[^a-z0-9-]', '-', slug)
        slug = re.sub(r'-+', '-', slug)
        return slug.strip('-')

# Singleton instance
product_repository = ProductRepository()
