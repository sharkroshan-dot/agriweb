from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository


class WarehousePickupRouteRepository(BaseRepository):
    def __init__(self):
        super().__init__("warehouse_pickup_routes")

    async def create_route(self, data: Dict[str, Any]) -> Optional[str]:
        now = datetime.utcnow()
        payload = dict(data)
        payload.update({"createdAt": now, "updatedAt": now, "deletedAt": None})
        return await self.create(payload)

    async def get_by_id(self, route_id: str) -> Optional[Dict[str, Any]]:
        try:
            return await self.find_one({"_id": ObjectId(route_id), "deletedAt": None})
        except Exception:
            return None

    async def get_by_warehouse(self, warehouse_id: str, date_key: Optional[str] = None) -> List[Dict[str, Any]]:
        query = {"warehouseId": ObjectId(warehouse_id), "deletedAt": None}
        if date_key:
            query["routeDate"] = date_key
        return await self.find_many(query, skip=0, limit=200, sort=[("createdAt", -1)])

    async def get_by_partner(self, partner_id: str, date_key: Optional[str] = None) -> List[Dict[str, Any]]:
        query = {"deliveryPartnerId": ObjectId(partner_id), "deletedAt": None}
        if date_key:
            query["routeDate"] = date_key
        return await self.find_many(query, skip=0, limit=50, sort=[("createdAt", -1)])

    async def get_active_by_partner(self, partner_id: str) -> List[Dict[str, Any]]:
        """Return every route not yet handed back to the warehouse, regardless of its route date.

        An unfinished route must remain visible across midnight. A route only leaves
        this active list after the partner explicitly marks the return/handover.
        """
        query = {
            "deliveryPartnerId": ObjectId(partner_id),
            "status": {"$nin": ["returned_to_warehouse", "cancelled", "closed", "archived"]},
            "deletedAt": None,
        }
        return await self.find_many(query, skip=0, limit=100, sort=[("createdAt", -1)])
    async def get_offered_for_warehouses(self, warehouse_ids: List[str], date_key: Optional[str] = None) -> List[Dict[str, Any]]:
        """Return open and assigned routes visible to approved partners.

        Assigned routes remain visible so losing partners can see who won.
        """
        ids = [ObjectId(x) for x in warehouse_ids if ObjectId.is_valid(str(x))]
        if not ids:
            return []
        query = {
            "warehouseId": {"$in": ids},
            "status": {"$in": ["offered", "assigned"]},
            "deletedAt": None,
        }
        if date_key:
            query["routeDate"] = date_key
        return await self.find_many(query, skip=0, limit=100, sort=[("createdAt", -1)])

    async def claim_route(
        self,
        route_id: str,
        partner_id: str,
        assigned_by: Optional[str] = None,
        partner_name: Optional[str] = None,
        vehicle_type: Optional[str] = None,
        vehicle_number: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Atomically claim an offered route. The first successful claim wins."""
        try:
            from pymongo import ReturnDocument
            update = {"$set": {
                "deliveryPartnerId": ObjectId(partner_id),
                "status": "assigned",
                "assignedAt": datetime.utcnow(),
                "updatedAt": datetime.utcnow(),
                "deliveryPartnerName": partner_name or None,
                "deliveryPartnerVehicleType": vehicle_type or None,
                "deliveryPartnerVehicleNumber": vehicle_number or None,
            }}
            if assigned_by and ObjectId.is_valid(str(assigned_by)):
                update["$set"]["assignedBy"] = ObjectId(str(assigned_by))
            return await self.collection.find_one_and_update(
                {"_id": ObjectId(route_id), "status": "offered", "deliveryPartnerId": None, "deletedAt": None},
                update,
                return_document=ReturnDocument.AFTER,
            )
        except Exception:
            return None

    async def update_route(self, route_id: str, data: Dict[str, Any]) -> bool:
        payload = dict(data)
        payload["updatedAt"] = datetime.utcnow()
        return await self.update({"_id": ObjectId(route_id)}, payload)


warehouse_pickup_route_repository = WarehousePickupRouteRepository()
