# backend/app/repositories/product_review_repository.py
from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)

class ProductReviewRepository(BaseRepository):
    """Product review repository."""
    
    def __init__(self):
        super().__init__("product_reviews")
    
    async def create_review(self, data: Dict[str, Any]) -> Optional[str]:
        """Create a review."""
        data["helpful"] = 0
        return await self.create(data)
    
    async def get_by_id(self, review_id: str) -> Optional[Dict[str, Any]]:
        """Get review by ID."""
        try:
            obj_id = ObjectId(review_id)
            return await self.find_one({"_id": obj_id, "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting review: {str(e)}")
            return None
    
    async def get_by_user_product(self, user_id: str, product_id: str) -> Optional[Dict[str, Any]]:
        """Get review by user and product."""
        try:
            return await self.find_one({
                "userId": ObjectId(user_id),
                "productId": ObjectId(product_id),
                "deletedAt": None
            })
        except Exception as e:
            logger.error(f"Error getting review: {str(e)}")
            return None

    async def get_by_user(
        self,
        user_id: str,
        skip: int = 0,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """Get reviews written by a user (newest first)."""
        try:
            return await self.find_many(
                {"userId": ObjectId(user_id), "deletedAt": None},
                skip=skip,
                limit=limit,
                sort=[("createdAt", -1)]
            )
        except Exception as e:
            logger.error(f"Error getting reviews by user: {str(e)}")
            return []

    async def count_by_user(self, user_id: str) -> int:
        """Count reviews written by a user."""
        try:
            return await self.count({"userId": ObjectId(user_id), "deletedAt": None})
        except Exception as e:
            logger.error(f"Error counting reviews by user: {str(e)}")
            return 0

    async def get_by_products(
        self,
        product_ids: List[str],
        skip: int = 0,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """Get reviews for a list of products (newest first)."""
        try:
            ids = [ObjectId(pid) for pid in product_ids]
            return await self.find_many(
                {"productId": {"$in": ids}, "deletedAt": None},
                skip=skip,
                limit=limit,
                sort=[("createdAt", -1)]
            )
        except Exception as e:
            logger.error(f"Error getting reviews by products: {str(e)}")
            return []

    async def count_by_products(self, product_ids: List[str]) -> int:
        """Count reviews for a list of products."""
        try:
            ids = [ObjectId(pid) for pid in product_ids]
            return await self.count({"productId": {"$in": ids}, "deletedAt": None})
        except Exception as e:
            logger.error(f"Error counting reviews by products: {str(e)}")
            return 0
    
    async def rating_summary(self, product_id: str) -> Dict[str, Any]:
        """Aggregate rating count and total score across all customer reviews for a product."""
        try:
            pipeline = [
                {"$match": {"productId": ObjectId(product_id), "deletedAt": None}},
                {"$group": {"_id": None, "count": {"$sum": 1}, "total": {"$sum": "$rating"}}},
            ]
            result = await self.collection.aggregate(pipeline).to_list(1)
            if not result:
                return {"count": 0, "total": 0}
            return {
                "count": result[0].get("count", 0),
                "total": result[0].get("total", 0),
            }
        except Exception as e:
            logger.error(f"Error aggregating product ratings: {str(e)}")
            return {"count": 0, "total": 0}

    async def get_by_product_id(
        self,
        product_id: str,
        skip: int = 0,
        limit: int = 20,
        sort_by: str = "createdAt",
        sort_order: str = "desc"
    ) -> List[Dict[str, Any]]:
        """Get reviews by product ID."""
        try:
            sort_dir = -1 if sort_order == "desc" else 1
            return await self.find_many(
                {"productId": ObjectId(product_id), "deletedAt": None},
                skip=skip,
                limit=limit,
                sort=[(sort_by, sort_dir)]
            )
        except Exception as e:
            logger.error(f"Error getting reviews: {str(e)}")
            return []

# Singleton instance
product_review_repository = ProductReviewRepository()