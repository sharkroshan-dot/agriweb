from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)

class ProductAlertRepository(BaseRepository):
    """Product alerts (back-in-stock / price-drop) — one document per user-product-alertType pair."""

    def __init__(self):
        super().__init__("product_alerts")

    async def subscribe(
        self,
        user_id: str,
        product_id: str,
        alert_type: str,
        target_price: Optional[float] = None,
        price_at_subscribe: Optional[float] = None
    ) -> Optional[str]:
        """Subscribe the user to an alert for a product (idempotent). Returns the alert id."""
        try:
            filter_doc = {
                "userId": ObjectId(user_id),
                "productId": ObjectId(product_id),
                "alertType": alert_type,
            }
            existing = await self.find_one(filter_doc)
            now = datetime.utcnow()
            if existing:
                update = {
                    "isActive": True,
                    "targetPrice": target_price,
                    "priceAtSubscribe": price_at_subscribe,
                    "lastTriggeredAt": None,
                    "updatedAt": now,
                }
                await self.collection.update_one(filter_doc, {"$set": update})
                return str(existing["_id"])
            doc = {
                "userId": ObjectId(user_id),
                "productId": ObjectId(product_id),
                "alertType": alert_type,
                "targetPrice": target_price,
                "priceAtSubscribe": price_at_subscribe,
                "isActive": True,
                "lastTriggeredAt": None,
                "createdAt": now,
                "updatedAt": now,
            }
            result = await self.collection.insert_one(doc)
            return str(result.inserted_id)
        except Exception as e:
            logger.error(f"Error subscribing to alert for {product_id}: {e}")
            return None

    async def unsubscribe(self, alert_id: str, user_id: str) -> bool:
        """Remove an alert owned by the user."""
        try:
            return await self.hard_delete({
                "_id": ObjectId(alert_id),
                "userId": ObjectId(user_id),
            })
        except Exception as e:
            logger.error(f"Error unsubscribing alert {alert_id}: {e}")
            return False

    async def get_by_user(self, user_id: str, limit: int = 100) -> List[Dict[str, Any]]:
        """Get all active alerts for a user, newest first."""
        return await self.find_many(
            {"userId": ObjectId(user_id), "isActive": True},
            limit=limit,
            sort=[("createdAt", -1)],
        )

    async def count_active_by_user(self, user_id: str) -> int:
        """Count active alerts for a user."""
        return await self.count({"userId": ObjectId(user_id), "isActive": True})

    async def get_active_by_product(self, product_id: str) -> List[Dict[str, Any]]:
        """Get all active alerts for a product."""
        return await self.find_many(
            {"productId": ObjectId(product_id), "isActive": True},
            limit=100,
            sort=[("createdAt", -1)],
        )

    async def get_active_by_id(self, alert_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        """Get a single active alert by id owned by the user."""
        return await self.find_one({
            "_id": ObjectId(alert_id),
            "userId": ObjectId(user_id),
            "isActive": True,
        })

    async def deactivate(self, alert_id: str) -> bool:
        """Deactivate an alert after it fires (one-shot)."""
        try:
            await self.collection.update_one(
                {"_id": ObjectId(alert_id)},
                {"$set": {"isActive": False, "lastTriggeredAt": datetime.utcnow(), "updatedAt": datetime.utcnow()}},
            )
            return True
        except Exception as e:
            logger.error(f"Error deactivating alert {alert_id}: {e}")
            return False

# Singleton instance
product_alert_repository = ProductAlertRepository()
