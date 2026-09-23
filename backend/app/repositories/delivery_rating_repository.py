from typing import Optional, Dict, Any, List
from bson import ObjectId
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)


class DeliveryRatingRepository(BaseRepository):
    """Repository for delivery partner ratings (collection: delivery_ratings).

    One rating document per delivered order - a unique index on ``orderId``
    guarantees a customer cannot rate the same order twice.
    """

    def __init__(self):
        super().__init__("delivery_ratings")

    async def get_by_order(self, order_id: str) -> Optional[Dict[str, Any]]:
        """Return the rating for an order (if any)."""
        try:
            return await self.find_one({"orderId": ObjectId(order_id)})
        except Exception as e:
            logger.error(f"Error getting rating by order: {str(e)}")
            return None

    async def get_by_order_ids(self, order_ids: List[ObjectId]) -> List[Dict[str, Any]]:
        """Return ratings for a batch of order ids."""
        if not order_ids:
            return []
        try:
            return await self.find_many(
                {"orderId": {"$in": order_ids}},
                limit=len(order_ids)
            )
        except Exception as e:
            logger.error(f"Error getting ratings by order ids: {str(e)}")
            return []

    async def get_by_customer(
        self,
        customer_id: str,
        skip: int = 0,
        limit: int = 20
    ) -> List[Dict[str, Any]]:
        return await self.find_many(
            {"customerId": ObjectId(customer_id)},
            skip=skip,
            limit=limit,
            sort=[("createdAt", -1)]
        )

    async def count_by_customer(self, customer_id: str) -> int:
        return await self.count({"customerId": ObjectId(customer_id)})

    async def get_by_partner(
        self,
        partner_id: str,
        skip: int = 0,
        limit: int = 20
    ) -> List[Dict[str, Any]]:
        return await self.find_many(
            {"deliveryPartnerId": ObjectId(partner_id)},
            skip=skip,
            limit=limit,
            sort=[("createdAt", -1)]
        )

    async def count_by_partner(self, partner_id: str) -> int:
        return await self.count({"deliveryPartnerId": ObjectId(partner_id)})

    async def get_summary(self, partner_id: str) -> Dict[str, Any]:
        """Aggregate rating statistics for a delivery partner."""
        pipeline = [
            {"$match": {"deliveryPartnerId": ObjectId(partner_id)}},
            {"$group": {
                "_id": None,
                "count": {"$sum": 1},
                "overallAvg": {"$avg": "$overallRating"},
                "onTimeAvg": {"$avg": "$onTimeRating"},
                "professionalismAvg": {"$avg": "$professionalismRating"},
                "handlingAvg": {"$avg": "$handlingRating"},
                "communicationAvg": {"$avg": "$communicationRating"},
                "positiveOnTime": {"$sum": {"$cond": [{"$gte": ["$onTimeRating", 4]}, 1, 0]}},
            }},
        ]
        rows = await self.aggregate(pipeline)
        if not rows:
            return {
                "count": 0,
                "overallAvg": 0,
                "onTimeAvg": 0,
                "professionalismAvg": 0,
                "handlingAvg": 0,
                "communicationAvg": 0,
                "onTimePercentage": 0,
                "distribution": {str(i): 0 for i in range(1, 6)},
            }
        row = rows[0]
        count = row.get("count", 0)
        return {
            "count": count,
            "overallAvg": round(row.get("overallAvg", 0) or 0, 2),
            "onTimeAvg": round(row.get("onTimeAvg", 0) or 0, 2),
            "professionalismAvg": round(row.get("professionalismAvg", 0) or 0, 2),
            "handlingAvg": round(row.get("handlingAvg", 0) or 0, 2),
            "communicationAvg": round(row.get("communicationAvg", 0) or 0, 2),
            "onTimePercentage": round(row.get("positiveOnTime", 0) / count * 100, 1) if count else 0,
            "distribution": await self.get_distribution(partner_id),
        }

    async def get_distribution(self, partner_id: str) -> Dict[str, int]:
        """Count of ratings per star level (1-5) for a partner."""
        pipeline = [
            {"$match": {"deliveryPartnerId": ObjectId(partner_id)}},
            {"$group": {"_id": "$overallRating", "count": {"$sum": 1}}},
        ]
        rows = await self.aggregate(pipeline)
        dist = {str(i): 0 for i in range(1, 6)}
        for row in rows:
            try:
                dist[str(int(row["_id"]))] = row.get("count", 0)
            except Exception:
                pass
        return dist

    async def get_all(
        self,
        skip: int = 0,
        limit: int = 20,
        partner_id: Optional[str] = None,
        customer_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        filter: Dict[str, Any] = {}
        if partner_id:
            filter["deliveryPartnerId"] = ObjectId(partner_id)
        if customer_id:
            filter["customerId"] = ObjectId(customer_id)
        return await self.find_many(
            filter,
            skip=skip,
            limit=limit,
            sort=[("createdAt", -1)]
        )

    async def count_all(
        self,
        partner_id: Optional[str] = None,
        customer_id: Optional[str] = None
    ) -> int:
        filter: Dict[str, Any] = {}
        if partner_id:
            filter["deliveryPartnerId"] = ObjectId(partner_id)
        if customer_id:
            filter["customerId"] = ObjectId(customer_id)
        return await self.count(filter)

    async def get_by_id(self, rating_id: str) -> Optional[Dict[str, Any]]:
        try:
            return await self.find_one({"_id": ObjectId(rating_id)})
        except Exception:
            return None

    async def hard_delete(self, rating_id: str) -> bool:
        """Permanently remove a rating (admin action)."""
        try:
            result = await self.collection.delete_one({"_id": ObjectId(rating_id)})
            return result.deleted_count > 0
        except Exception as e:
            logger.error(f"Error deleting rating: {str(e)}")
            return False


delivery_rating_repository = DeliveryRatingRepository()
