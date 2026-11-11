from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository


COLLECTION_READY = "ready_for_pickup"
COLLECTION_ASSIGNED = "team_assigned"
COLLECTION_EN_ROUTE = "en_route"
COLLECTION_ARRIVED = "arrived_at_farm"
COLLECTION_COLLECTED = "collected"
COLLECTION_DEPARTED = "departed_farm"
COLLECTION_ARRIVED_WAREHOUSE = "arrived_warehouse"


class WarehouseCollectionRepository(BaseRepository):
    """Farm-to-warehouse collection jobs for bulk and packed transfers."""

    def __init__(self):
        super().__init__("warehouse_collections")

    async def get_by_id(self, collection_id: str) -> Optional[Dict[str, Any]]:
        try:
            return await self.find_one({"_id": ObjectId(collection_id), "deletedAt": None})
        except Exception:
            return None

    async def get_by_warehouse(self, warehouse_id: str, status: Optional[str] = None, limit: int = 500) -> List[Dict[str, Any]]:
        query = {"warehouseId": {"$in": [ObjectId(warehouse_id), warehouse_id]}, "deletedAt": None}
        if status and status != "all":
            query["status"] = status
        return await self.find_many(query, skip=0, limit=limit, sort=[("createdAt", 1)])

    async def get_by_incoming(self, incoming_id: str) -> Optional[Dict[str, Any]]:
        try:
            return await self.find_one({"incomingStockId": {"$in": [ObjectId(incoming_id), incoming_id]}, "deletedAt": None})
        except Exception:
            return None

    async def get_by_order(self, order_id: str, collection_type: Optional[str] = None) -> List[Dict[str, Any]]:
        query = {"orderId": ObjectId(order_id), "deletedAt": None}
        if collection_type:
            query["collectionType"] = collection_type
        return await self.find_many(query, skip=0, limit=100, sort=[("createdAt", 1)])

    async def create_job(self, data: Dict[str, Any]) -> Optional[str]:
        now = datetime.utcnow()
        payload = dict(data)
        payload.setdefault("status", COLLECTION_READY)
        payload.setdefault("createdAt", now)
        payload.setdefault("updatedAt", now)
        payload.setdefault("deletedAt", None)
        return await self.create(payload)

    async def reserve_job_for_route(self, collection_id: str, route_id: str) -> bool:
        """Atomically reserve an unassigned ready collection job for one route."""
        try:
            from pymongo import ReturnDocument
            oid = ObjectId(collection_id)
            route_oid = ObjectId(route_id)
            now = datetime.utcnow()
            query = {
                "_id": oid,
                "status": COLLECTION_READY,
                "$and": [
                    {"$or": [{"pickupRouteId": {"$exists": False}}, {"pickupRouteId": None}, {"pickupRouteId": ""}, {"pickupRouteId": route_oid}]},
                    {"$or": [{"collectionTeamId": {"$exists": False}}, {"collectionTeamId": None}, {"collectionTeamId": ""}]},
                ],
            }
            claimed = await self.collection.find_one_and_update(
                query,
                {"$set": {"pickupRouteId": route_oid, "pickupRouteStatus": "offered", "updatedAt": now}},
                return_document=ReturnDocument.AFTER,
            )
            return bool(claimed)
        except Exception:
            return False

    async def release_route_reservation(self, collection_id: str, route_id: str) -> bool:
        """Release only an unaccepted reservation owned by the specified route."""
        try:
            result = await self.collection.update_one(
                {
                    "_id": ObjectId(collection_id),
                    "pickupRouteId": ObjectId(route_id),
                    "status": COLLECTION_READY,
                    "$or": [{"collectionTeamId": {"$exists": False}}, {"collectionTeamId": None}, {"collectionTeamId": ""}],
                },
                {"$unset": {"pickupRouteId": "", "pickupRouteStatus": ""}, "$set": {"updatedAt": datetime.utcnow()}},
            )
            return result.modified_count > 0
        except Exception:
            return False

    async def release_route_assignment(self, collection_id: str, route_id: str, partner_id: str) -> bool:
        """Roll back only a route/team assignment created by the specified route."""
        try:
            result = await self.collection.update_one(
                {
                    "_id": ObjectId(collection_id),
                    "pickupRouteId": ObjectId(route_id),
                    "collectionTeamId": ObjectId(partner_id),
                    "status": COLLECTION_ASSIGNED,
                },
                {
                    "$set": {
                        "status": COLLECTION_READY,
                        "pickupRouteStatus": "offered",
                        "updatedAt": datetime.utcnow(),
                    },
                    "$unset": {
                        "collectionTeamId": "",
                        "collectionTeamName": "",
                        "collectionVehicleNumber": "",
                        "teamAssignedAt": "",
                        "pickupAssignmentSource": "",
                    },
                },
            )
            return result.modified_count > 0
        except Exception:
            return False

    async def assign_job_to_route(
        self,
        collection_id: str,
        route_id: str,
        partner_id: str,
        extra_fields: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Atomically assign a collection job, refusing a different route/team winner."""
        try:
            from pymongo import ReturnDocument
            now = datetime.utcnow()
            query = {
                "_id": ObjectId(collection_id),
                "status": {"$in": [COLLECTION_READY, COLLECTION_ASSIGNED]},
                "$and": [
                    {"$or": [{"pickupRouteId": {"$exists": False}}, {"pickupRouteId": None}, {"pickupRouteId": ""}, {"pickupRouteId": ObjectId(route_id)}]},
                    {"$or": [{"collectionTeamId": {"$exists": False}}, {"collectionTeamId": None}, {"collectionTeamId": ""}, {"collectionTeamId": ObjectId(partner_id)}]},
                ],
            }
            fields = {
                "pickupRouteId": ObjectId(route_id),
                "pickupRouteStatus": "assigned",
                "collectionTeamId": ObjectId(partner_id),
                "status": COLLECTION_ASSIGNED,
                "teamAssignedAt": now,
                "updatedAt": now,
            }
            fields.update(extra_fields or {})
            return await self.collection.find_one_and_update(
                query,
                {"$set": fields},
                return_document=ReturnDocument.AFTER,
            )
        except Exception:
            return None

    async def update_job(self, collection_id: str, data: Dict[str, Any]) -> bool:
        payload = dict(data)
        payload["updatedAt"] = datetime.utcnow()
        return await self.update({"_id": ObjectId(collection_id)}, payload)


warehouse_collection_repository = WarehouseCollectionRepository()
