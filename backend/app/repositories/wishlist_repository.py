from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)

class WishlistRepository(BaseRepository):
    """Wishlist repository (one document per user-product pair)."""

    def __init__(self):
        super().__init__("wishlists")

    async def add(self, user_id: str, product_id: str) -> bool:
        """Add a product to the user's wishlist (idempotent)."""
        try:
            doc = {
                "userId": ObjectId(user_id),
                "productId": ObjectId(product_id),
                "createdAt": datetime.utcnow(),
            }
            await self.collection.update_one(
                {"userId": doc["userId"], "productId": doc["productId"]},
                {"$setOnInsert": doc},
                upsert=True,
            )
            return True
        except Exception as e:
            logger.error(f"Error adding {product_id} to wishlist: {e}")
            return False

    async def remove(self, user_id: str, product_id: str) -> bool:
        """Remove a product from the user's wishlist."""
        try:
            return await self.hard_delete({
                "userId": ObjectId(user_id),
                "productId": ObjectId(product_id),
            })
        except Exception as e:
            logger.error(f"Error removing {product_id} from wishlist: {e}")
            return False

    async def get_by_user(self, user_id: str, limit: int = 500) -> List[Dict[str, Any]]:
        """Get all wishlist documents for a user, newest first."""
        return await self.find_many(
            {"userId": ObjectId(user_id)},
            limit=limit,
            sort=[("createdAt", -1)],
        )

    async def count_by_user(self, user_id: str) -> int:
        """Count wishlist items for a user."""
        return await self.count({"userId": ObjectId(user_id)})

    async def is_wishlisted(self, user_id: str, product_id: str) -> bool:
        """Check whether a user has a product in their wishlist."""
        try:
            found = await self.find_one({
                "userId": ObjectId(user_id),
                "productId": ObjectId(product_id),
            })
            return found is not None
        except Exception as e:
            logger.error(f"Error checking wishlist: {e}")
            return False

# Singleton instance
wishlist_repository = WishlistRepository()
