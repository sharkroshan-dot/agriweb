import logging
from typing import Any, Dict, List, Optional
from bson import ObjectId
from fastapi import HTTPException, status

from app.repositories.delivery_rating_repository import delivery_rating_repository
from app.repositories.order_repository import order_repository
from app.repositories.delivery_repository import delivery_repository
from app.schemas.delivery_rating import DeliveryRatingCreate

logger = logging.getLogger(__name__)


class DeliveryRatingService:
    """Business logic for delivery partner ratings."""

    @staticmethod
    async def submit_rating(customer_id: str, order_id: str, data: DeliveryRatingCreate) -> Dict[str, Any]:
        """Create a delivery partner rating for a delivered order.

        Validations:
        - order must exist and belong to the customer
        - order status must be delivered
        - a delivery partner must be assigned
        - the same order cannot be rated twice
        """
        order = await order_repository.get_by_id(order_id)
        if not order:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Order not found")

        if str(order.get("customerId")) != customer_id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail="You can only rate delivery partners for your own orders"
            )

        if order.get("orderStatus") != "delivered":
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="You can only rate the delivery partner after the order is delivered"
            )

        partner_id = order.get("deliveryPartnerId")
        if not partner_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="No delivery partner was assigned to this order"
            )

        existing = await delivery_rating_repository.get_by_order(order_id)
        if existing:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail="You have already rated the delivery partner for this order"
            )

        rating_data = {
            "deliveryPartnerId": ObjectId(str(partner_id)) if not isinstance(partner_id, ObjectId) else partner_id,
            "orderId": order["_id"],
            "customerId": ObjectId(customer_id),
            "orderNumber": order.get("orderNumber", ""),
            "overallRating": data.overallRating,
            "onTimeRating": data.onTimeRating,
            "professionalismRating": data.professionalismRating,
            "handlingRating": data.handlingRating,
            "communicationRating": data.communicationRating,
            "feedback": (data.feedback or "").strip() or None,
        }

        rating_id = await delivery_rating_repository.create(rating_data)
        if not rating_id:
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to save your rating"
            )

        await delivery_repository.refresh_rating_stats(str(partner_id))
        rating_data["id"] = rating_id
        return rating_data

    @staticmethod
    async def get_partner_summary(partner_id: str) -> Dict[str, Any]:
        return await delivery_rating_repository.get_summary(partner_id)

    @staticmethod
    async def get_partner_ratings(
        partner_id: str,
        page: int = 1,
        limit: int = 20
    ) -> Dict[str, Any]:
        """Ratings visible to a delivery partner.

        Customer personal information (name, phone, email, address) is
        deliberately excluded to keep customer data private.
        """
        skip = (page - 1) * limit
        ratings = await delivery_rating_repository.get_by_partner(partner_id, skip=skip, limit=limit)
        total = await delivery_rating_repository.count_by_partner(partner_id)
        summary = await delivery_rating_repository.get_summary(partner_id)

        return {
            "ratings": [
                {
                    "id": str(r["_id"]),
                    "orderId": str(r["orderId"]),
                    "orderNumber": r.get("orderNumber", ""),
                    "overallRating": r.get("overallRating", 0),
                    "onTimeRating": r.get("onTimeRating", 0),
                    "professionalismRating": r.get("professionalismRating", 0),
                    "handlingRating": r.get("handlingRating", 0),
                    "communicationRating": r.get("communicationRating", 0),
                    "feedback": r.get("feedback"),
                    "createdAt": r.get("createdAt"),
                }
                for r in ratings
            ],
            "summary": summary,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit if limit else 0,
            },
        }

    @staticmethod
    async def get_customer_ratings(
        customer_id: str,
        page: int = 1,
        limit: int = 20
    ) -> Dict[str, Any]:
        skip = (page - 1) * limit
        ratings = await delivery_rating_repository.get_by_customer(customer_id, skip=skip, limit=limit)
        total = await delivery_rating_repository.count_by_customer(customer_id)

        return {
            "ratings": [
                {
                    "id": str(r["_id"]),
                    "deliveryPartnerId": str(r["deliveryPartnerId"]),
                    "orderId": str(r["orderId"]),
                    "orderNumber": r.get("orderNumber", ""),
                    "overallRating": r.get("overallRating", 0),
                    "onTimeRating": r.get("onTimeRating", 0),
                    "professionalismRating": r.get("professionalismRating", 0),
                    "handlingRating": r.get("handlingRating", 0),
                    "communicationRating": r.get("communicationRating", 0),
                    "feedback": r.get("feedback"),
                    "createdAt": r.get("createdAt"),
                }
                for r in ratings
            ],
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit if limit else 0,
            },
        }

    @staticmethod
    async def list_for_admin(
        partner_id: Optional[str] = None,
        page: int = 1,
        limit: int = 20
    ) -> Dict[str, Any]:
        """Admin listing with partner + customer names attached."""
        skip = (page - 1) * limit
        ratings = await delivery_rating_repository.get_all(
            skip=skip,
            limit=limit,
            partner_id=partner_id
        )
        total = await delivery_rating_repository.count_all(partner_id=partner_id)

        from app.repositories.user_repository import user_repository
        from app.repositories.delivery_repository import delivery_repository as _delivery_repo

        partner_names: Dict[str, str] = {}
        customer_names: Dict[str, str] = {}

        async def _name(obj_id: Any, kind: str) -> str:
            if obj_id is None:
                return "Unknown"
            key = str(obj_id)
            cache = partner_names if kind == "partner" else customer_names
            if key in cache:
                return cache[key]
            if kind == "partner":
                profile = await _delivery_repo.get_by_id(key)
                if profile:
                    user = await user_repository.get_by_id(str(profile.get("userId")))
                    if user:
                        cache[key] = f"{user.get('firstName', '')} {user.get('lastName', '')}".strip() or "Partner"
                        return cache[key]
            else:
                user = await user_repository.get_by_id(key)
                if user:
                    cache[key] = f"{user.get('firstName', '')} {user.get('lastName', '')}".strip() or "Customer"
                    return cache[key]
            cache[key] = "Unknown"
            return cache[key]

        result = []
        for r in ratings:
            partner_name = await _name(r.get("deliveryPartnerId"), "partner")
            customer_name = await _name(r.get("customerId"), "customer")
            result.append({
                "id": str(r["_id"]),
                "deliveryPartnerId": str(r.get("deliveryPartnerId")),
                "deliveryPartnerName": partner_name,
                "customerId": str(r.get("customerId")),
                "customerName": customer_name,
                "orderId": str(r.get("orderId")),
                "orderNumber": r.get("orderNumber", ""),
                "overallRating": r.get("overallRating", 0),
                "onTimeRating": r.get("onTimeRating", 0),
                "professionalismRating": r.get("professionalismRating", 0),
                "handlingRating": r.get("handlingRating", 0),
                "communicationRating": r.get("communicationRating", 0),
                "feedback": r.get("feedback"),
                "createdAt": r.get("createdAt"),
            })

        return {
            "ratings": result,
            "total": total,
            "page": page,
            "limit": limit,
            "totalPages": (total + limit - 1) // limit if limit else 0,
        }

    @staticmethod
    async def delete_rating(rating_id: str) -> Dict[str, Any]:
        """Admin delete. Recomputes the partner's stats afterwards."""
        rating = await delivery_rating_repository.get_by_id(rating_id)
        if not rating:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Rating not found")

        partner_id = str(rating.get("deliveryPartnerId"))
        deleted = await delivery_rating_repository.hard_delete(rating_id)
        if not deleted:
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to delete rating"
            )
        if partner_id:
            await delivery_repository.refresh_rating_stats(partner_id)
        return {"message": "Rating deleted", "ratingId": rating_id}


delivery_rating_service = DeliveryRatingService()
