from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime, timedelta
from app.repositories.base_repository import BaseRepository
from app.schemas.inventory import ReservationStatus
import logging

logger = logging.getLogger(__name__)


class ReservationRepository(BaseRepository):
    """Reservation repository for inventory reservations."""

    def __init__(self):
        super().__init__("reservations")

    async def create_reservation(self, data: Dict[str, Any]) -> Optional[str]:
        data["created_at"] = datetime.utcnow()
        data["updated_at"] = datetime.utcnow()
        return await self.create(data)

    async def get_by_id(self, reservation_id: str) -> Optional[Dict[str, Any]]:
        try:
            obj_id = ObjectId(reservation_id)
            return await self.find_one({"_id": obj_id, "deleted_at": None})
        except Exception as e:
            logger.error(f"Error getting reservation: {str(e)}")
            return None

    async def get_active_by_product_and_customer(
        self, product_id: str, customer_id: str
    ) -> Optional[Dict[str, Any]]:
        try:
            return await self.find_one({
                "product_id": ObjectId(product_id),
                "customer_id": ObjectId(customer_id),
                "status": ReservationStatus.ACTIVE.value,
                "deleted_at": None,
            })
        except Exception as e:
            logger.error(f"Error finding active reservation: {str(e)}")
            return None

    async def get_active_reservations_by_product(
        self, product_id: str
    ) -> List[Dict[str, Any]]:
        try:
            return await self.find_many(
                {
                    "product_id": ObjectId(product_id),
                    "status": ReservationStatus.ACTIVE.value,
                    "deleted_at": None,
                }
            )
        except Exception as e:
            logger.error(f"Error finding reservations by product: {str(e)}")
            return []

    async def get_expired_reservations(self) -> List[Dict[str, Any]]:
        try:
            now = datetime.utcnow()
            return await self.find_many(
                {
                    "status": ReservationStatus.ACTIVE.value,
                    "expires_at": {"$lte": now},
                    "deleted_at": None,
                }
            )
        except Exception as e:
            logger.error(f"Error finding expired reservations: {str(e)}")
            return []

    async def update_status(
        self, reservation_id: str, status: ReservationStatus, extra: Optional[Dict[str, Any]] = None
    ) -> bool:
        try:
            obj_id = ObjectId(reservation_id)
            data = {"status": status.value, "updated_at": datetime.utcnow()}
            if extra:
                data.update(extra)
            return await self.update({"_id": obj_id}, data)
        except Exception as e:
            logger.error(f"Error updating reservation status: {str(e)}")
            return False

    async def mark_expired(self, reservation_id: str) -> bool:
        return await self.update_status(reservation_id, ReservationStatus.EXPIRED)

    async def cancel(self, reservation_id: str) -> bool:
        return await self.update_status(
            reservation_id, ReservationStatus.CANCELLED,
            {"cancelled_at": datetime.utcnow()}
        )

    async def confirm(self, reservation_id: str, order_id: str) -> bool:
        return await self.update_status(
            reservation_id, ReservationStatus.CONFIRMED,
            {"order_id": ObjectId(order_id), "confirmed_at": datetime.utcnow()}
        )

    async def get_customer_reservations(
        self, customer_id: str, status: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        try:
            filter_dict = {
                "customer_id": ObjectId(customer_id),
                "deleted_at": None,
            }
            if status:
                filter_dict["status"] = status
            return await self.find_many(filter_dict, sort=[("created_at", -1)])
        except Exception as e:
            logger.error(f"Error getting customer reservations: {str(e)}")
            return []

    async def get_farmer_reservations(
        self, farmer_id: str, status: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        try:
            filter_dict = {
                "farmer_id": ObjectId(farmer_id),
                "deleted_at": None,
            }
            if status:
                filter_dict["status"] = status
            return await self.find_many(filter_dict, sort=[("created_at", -1)])
        except Exception as e:
            logger.error(f"Error getting farmer reservations: {str(e)}")
            return []


reservation_repository = ReservationRepository()
