from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime, timedelta
from app.repositories.base_repository import BaseRepository
from app.schemas.delivery import DeliveryStatus
import logging

logger = logging.getLogger(__name__)

class DeliveryAssignmentRepository(BaseRepository):
    """Delivery assignment repository."""
    
    def __init__(self):
        super().__init__("delivery_assignments")
    
    async def create_assignment(self, assignment_data: Dict[str, Any]) -> Optional[str]:
        """Create a delivery assignment."""
        assignment_data["createdAt"] = datetime.utcnow()
        assignment_data["updatedAt"] = datetime.utcnow()
        assignment_data["status"] = DeliveryStatus.ASSIGNED
        assignment_data["assignedAt"] = datetime.utcnow()
        return await self.create(assignment_data)
    
    async def get_by_id(self, assignment_id: str) -> Optional[Dict[str, Any]]:
        """Get assignment by ID."""
        try:
            obj_id = ObjectId(assignment_id)
            return await self.find_one({"_id": obj_id, "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting assignment: {str(e)}")
            return None
    
    async def get_by_order_id(self, order_id: str) -> Optional[Dict[str, Any]]:
        """Get assignment by order ID."""
        try:
            return await self.find_one({
                "orderId": ObjectId(order_id),
                "deletedAt": None
            })
        except Exception as e:
            logger.error(f"Error getting assignment by order: {str(e)}")
            return None
    
    async def get_by_delivery_partner(
        self,
        partner_id: str,
        status: Optional[DeliveryStatus] = None,
        date: Optional[datetime] = None,
        skip: int = 0,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Get assignments by delivery partner.

        Matches deliveryPartnerId stored either as an ObjectId or as a plain
        string, since legacy records may use either representation.
        """
        partner_values = [partner_id]
        try:
            partner_values.append(ObjectId(partner_id))
        except Exception:
            pass
        filter = {
            "deliveryPartnerId": {"$in": partner_values},
            "deletedAt": None
        }
        if status:
            filter["status"] = status
        if date:
            start_date = datetime(date.year, date.month, date.day)
            end_date = start_date + timedelta(days=1)
            filter["assignedAt"] = {"$gte": start_date, "$lt": end_date}
        
        return await self.find_many(
            filter,
            skip=skip,
            limit=limit,
            sort=[("assignedAt", -1)]
        )
    
    async def update_status(
        self,
        assignment_id: str,
        status: DeliveryStatus,
        data: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Update assignment status."""
        try:
            obj_id = ObjectId(assignment_id)
            update_data = {
                "status": status,
                "updatedAt": datetime.utcnow()
            }
            
            if status == DeliveryStatus.ACCEPTED:
                update_data["acceptedAt"] = datetime.utcnow()
            elif status == DeliveryStatus.PICKED_UP:
                update_data["pickedUpAt"] = datetime.utcnow()
            elif status == DeliveryStatus.DELIVERED:
                update_data["completedAt"] = datetime.utcnow()
            elif status == DeliveryStatus.FAILED:
                update_data["failureReason"] = data.get("reason") if data else None
            
            if data:
                update_data.update(data)
            
            return await self.update({"_id": obj_id}, update_data)
        except Exception as e:
            logger.error(f"Error updating assignment status: {str(e)}")
            return False
    
    async def complete_by_order_id(self, order_id: str) -> bool:
        """Mark every open assignment for an order as delivered."""
        try:
            await self.collection.update_many(
                {
                    "orderId": ObjectId(order_id),
                    "deletedAt": None,
                    "status": {"$ne": DeliveryStatus.DELIVERED}
                },
                {
                    "$set": {
                        "status": DeliveryStatus.DELIVERED,
                        "completedAt": datetime.utcnow(),
                        "updatedAt": datetime.utcnow(),
                        "completedBy": "system"
                    }
                }
            )
            return True
        except Exception as e:
            logger.error(f"Error completing assignments for order {order_id}: {str(e)}")
            return False

    async def get_active_assignments(
        self,
        partner_id: str
    ) -> List[Dict[str, Any]]:
        """Get active assignments for a partner."""
        try:
            return await self.find_many({
                "deliveryPartnerId": ObjectId(partner_id),
                "status": {"$in": [
                    DeliveryStatus.ASSIGNED,
                    DeliveryStatus.ACCEPTED,
                    DeliveryStatus.PICKED_UP,
                    DeliveryStatus.IN_TRANSIT
                ]},
                "deletedAt": None
            })
        except Exception as e:
            logger.error(f"Error getting active assignments: {str(e)}")
            return []

    async def count_active_for_partner(self, partner_id: str) -> int:
        """Number of open (assigned/accepted/in-progress) jobs for a partner."""
        try:
            return await self.count({
                "deliveryPartnerId": ObjectId(partner_id),
                "status": {"$in": [
                    DeliveryStatus.ASSIGNED,
                    DeliveryStatus.ACCEPTED,
                    DeliveryStatus.PICKED_UP,
                    DeliveryStatus.IN_TRANSIT
                ]},
                "deletedAt": None
            })
        except Exception as e:
            logger.error(f"Error counting active assignments for partner: {str(e)}")
            return 0

    async def reassign_open_assignment(
        self,
        order_id: str,
        new_partner_id: str
    ) -> bool:
        """Point an unaccepted assignment at a different partner.

        Only updates assignments that are still in the ``assigned`` state so an
        accepted job is never silently re-routed.
        """
        try:
            result = await self.collection.update_many(
                {
                    "orderId": ObjectId(order_id),
                    "deletedAt": None,
                    "status": DeliveryStatus.ASSIGNED,
                },
                {
                    "$set": {
                        "deliveryPartnerId": ObjectId(new_partner_id),
                        "updatedAt": datetime.utcnow(),
                    }
                }
            )
            return True
        except Exception as e:
            logger.error(f"Error reassigning assignment for order {order_id}: {str(e)}")
            return False

    async def cancel_by_order_id(self, order_id: str, reason: str = "") -> bool:
        """Cancel all open assignments for an order (farmer reclaimed it)."""
        try:
            await self.collection.update_many(
                {
                    "orderId": ObjectId(order_id),
                    "deletedAt": None,
                    "status": {"$in": [
                        DeliveryStatus.ASSIGNED,
                        DeliveryStatus.ACCEPTED
                    ]},
                },
                {
                    "$set": {
                        "status": DeliveryStatus.CANCELLED,
                        "cancelledAt": datetime.utcnow(),
                        "cancellationReason": reason or "Farmer switched order to self-delivery",
                        "updatedAt": datetime.utcnow(),
                    }
                }
            )
            return True
        except Exception as e:
            logger.error(f"Error cancelling assignments for order {order_id}: {str(e)}")
            return False
    
    
    async def get_pending_assignments(
        self,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Get pending assignments ready for delivery."""
        try:
            return await self.find_many({
                "status": DeliveryStatus.ASSIGNED,
                "deletedAt": None
            }, limit=limit, sort=[("assignedAt", 1)])
        except Exception as e:
            logger.error(f"Error getting pending assignments: {str(e)}")
            return []


delivery_assignment_repository = DeliveryAssignmentRepository()
