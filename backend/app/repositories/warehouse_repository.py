from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime, timedelta
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)

class WarehouseRepository(BaseRepository):
    """Warehouse repository."""

    def __init__(self):
        super().__init__("warehouses")

    async def create_warehouse(self, warehouse_data: Dict[str, Any]) -> Optional[str]:
        warehouse_data["createdAt"] = datetime.utcnow()
        warehouse_data["updatedAt"] = datetime.utcnow()
        warehouse_data["usedCapacity"] = 0
        warehouse_data["coldStorageUsed"] = 0
        warehouse_data["isActive"] = True
        return await self.create(warehouse_data)

    async def get_by_id(self, warehouse_id: str) -> Optional[Dict[str, Any]]:
        try:
            obj_id = ObjectId(warehouse_id)
            warehouse = await self.find_one({"_id": obj_id, "deletedAt": None})
            if not warehouse:
                return None
            await self.sync_capacity_usage(warehouse_id)
            return await self.find_one({"_id": obj_id, "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting warehouse: {str(e)}")
            return None

    async def sync_capacity_usage(self, warehouse_id: str) -> bool:
        """Derive used capacity from live inventory records."""
        try:
            obj_id = ObjectId(warehouse_id)
            from app.repositories.warehouse_stock_repository import warehouse_stock_repository
            from app.repositories.cold_storage_repository import cold_storage_repository

            stock_items = await warehouse_stock_repository.get_by_warehouse_id(
                warehouse_id, skip=0, limit=100000
            )
            cold_items = await cold_storage_repository.get_by_warehouse_id(
                warehouse_id, skip=0, limit=100000
            )

            used_capacity = sum(float(item.get("quantity", 0) or 0) for item in stock_items)
            cold_used = sum(float(item.get("quantity", 0) or 0) for item in cold_items)

            return await self.update(
                {"_id": obj_id},
                {
                    "usedCapacity": max(0, used_capacity),
                    "coldStorageUsed": max(0, cold_used),
                },
            )
        except Exception as e:
            logger.error(f"Error syncing warehouse capacity: {str(e)}", exc_info=True)
            return False

    async def get_by_farmer_id(self, farmer_id: str) -> Optional[Dict[str, Any]]:
        """Find a farmer's warehouse across canonical and legacy owner fields.

        Older warehouse records may store farmer references as strings, or use
        snake_case fields. Query only explicit owner/farmer associations; never
        assign an arbitrary warehouse to an order.
        """
        try:
            farmer_ref: Any = ObjectId(farmer_id) if ObjectId.is_valid(str(farmer_id)) else str(farmer_id)
            refs = [farmer_ref]
            if isinstance(farmer_ref, ObjectId):
                refs.append(str(farmer_ref))
            warehouse = await self.find_one({
                "$or": [
                    {"farmerId": {"$in": refs}},
                    {"farmer_id": {"$in": refs}},
                    {"ownerFarmerId": {"$in": refs}},
                    {"owner_farmer_id": {"$in": refs}},
                ],
                "deletedAt": None,
            })
            return warehouse
        except Exception as e:
            logger.error("Error getting warehouse by farmer ID %s: %s", farmer_id, str(e))
            return None

    async def get_by_user_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        return await self.get_by_manager(user_id)

    async def get_by_manager(self, manager_id: str) -> Optional[Dict[str, Any]]:
        try:
            manager_object_id = ObjectId(manager_id)
            # Existing databases may contain either ObjectId or string user
            # references. Resolve both formats so legacy warehouse profiles
            # continue to work after the manager schema was standardized.
            manager_refs = [manager_object_id, manager_id]
            warehouse = await self.find_one({
                "$or": [
                    {"managerId": {"$in": manager_refs}},
                    {"manager_id": {"$in": manager_refs}},
                    {"userId": {"$in": manager_refs}},
                    {"user_id": {"$in": manager_refs}},
                    {"ownerId": {"$in": manager_refs}},
                    {"owner_id": {"$in": manager_refs}},
                    {"assignedManagerId": {"$in": manager_refs}},
                ],
                "deletedAt": None
            })

            # Repair legacy records on first successful lookup so all future
            # warehouse operations use the canonical managerId/userId fields.
            if warehouse and (
                str(warehouse.get("managerId") or "") != manager_id
                or str(warehouse.get("userId") or "") != manager_id
            ):
                await self.update(
                    {"_id": warehouse["_id"]},
                    {"managerId": manager_object_id, "userId": manager_object_id},
                )
                warehouse["managerId"] = manager_object_id
                warehouse["userId"] = manager_object_id
            if not warehouse:
                return None
            await self.sync_capacity_usage(str(warehouse["_id"]))
            return await self.find_one({
                "_id": warehouse["_id"],
                "deletedAt": None
            })
        except Exception as e:
            logger.error(f"Error getting warehouse by manager: {str(e)}")
            return None

    async def get_all_warehouses(
        self,
        is_active: Optional[bool] = True,
        skip: int = 0,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        filter = {"deletedAt": None}
        if is_active is not None:
            filter["isActive"] = is_active

        return await self.find_many(
            filter,
            skip=skip,
            limit=limit,
            sort=[("name", 1)]
        )

    async def update_warehouse(self, warehouse_id: str, data: Dict[str, Any]) -> bool:
        try:
            obj_id = ObjectId(warehouse_id)
            data["updatedAt"] = datetime.utcnow()
            return await self.update({"_id": obj_id}, data)
        except Exception as e:
            logger.error(f"Error updating warehouse: {str(e)}")
            return False

    async def update_capacity_usage(
        self,
        warehouse_id: str,
        used_capacity: float,
        cold_used: float = 0
    ) -> bool:
        try:
            obj_id = ObjectId(warehouse_id)
            return await self.update(
                {"_id": obj_id},
                {
                    "usedCapacity": used_capacity,
                    "coldStorageUsed": cold_used,
                    "updatedAt": datetime.utcnow()
                }
            )
        except Exception as e:
            logger.error(f"Error updating capacity usage: {str(e)}")
            return False

    async def get_nearby_warehouses(
        self,
        lat: float,
        lng: float,
        radius: int,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        try:
            return await self.find_many({
                "location": {
                    "$near": {
                        "$geometry": {
                            "type": "Point",
                            "coordinates": [lng, lat]
                        },
                        "$maxDistance": radius * 1000
                    }
                },
                "isActive": True,
                "deletedAt": None
            }, limit=limit)
        except Exception as e:
            logger.error(f"Error getting nearby warehouses: {str(e)}")
            return []

    async def find_best_warehouse(
        self,
        lat: float,
        lng: float,
        required_capacity: float = 0,
        storage_type: Optional[str] = None,
        radius_km: int = 200,
        limit: int = 10,
    ) -> Optional[Dict[str, Any]]:
        """Select the nearest active warehouse with capacity.

        Prefer the geospatial index, but fall back to scanning active warehouse
        records because older warehouse documents may store coordinates as
        lat/lng fields or nested address data instead of GeoJSON. This avoids
        incorrectly reporting that no warehouse exists when a legacy record is
        active and has sufficient capacity.
        """
        from math import radians, sin, cos, asin, sqrt
        from app.database.mongodb import MongoDB

        try:
            farm_lat, farm_lng = float(lat), float(lng)
        except (TypeError, ValueError):
            return None
        if not (-90 <= farm_lat <= 90 and -180 <= farm_lng <= 180):
            return None

        candidates: List[Dict[str, Any]] = []
        seen: set[str] = set()

        def add_candidate(row: Optional[Dict[str, Any]]) -> None:
            if not row:
                return
            key = str(row.get("_id") or row.get("id") or "")
            if key and key not in seen:
                seen.add(key)
                candidates.append(row)

        # Fast path: indexed GeoJSON lookup. Legacy documents may not be
        # represented in this result, so this is not the only source.
        try:
            for row in await self.get_nearby_warehouses(
                farm_lat, farm_lng, radius_km, limit=max(limit, 50)
            ):
                add_candidate(row)
        except Exception:
            logger.warning("Geospatial warehouse lookup failed; using compatibility scan", exc_info=True)

        # Compatibility path for warehouses with legacy location/capacity fields.
        try:
            collection = MongoDB.get_collection("warehouses")
            legacy_rows = await collection.find({
                "$or": [
                    {"deletedAt": None},
                    {"deleted_at": None},
                    {"deletedAt": {"$exists": False}},
                ]
            }).to_list(length=2000)
            for row in legacy_rows:
                add_candidate(row)
        except Exception:
            logger.exception("Could not load warehouse compatibility candidates")

        requested_storage = (storage_type or "").strip().lower()
        eligible = []

        def first_number(row: Dict[str, Any], keys: tuple[str, ...]) -> Optional[float]:
            for key in keys:
                value = row.get(key)
                if value is not None and value != "":
                    try:
                        return float(value)
                    except (TypeError, ValueError):
                        continue
            return None

        def extract_point(value: Any) -> Optional[tuple[float, float]]:
            if not isinstance(value, dict):
                return None
            nested_keys = ("location", "coordinates", "address", "geoLocation", "geo_location")
            for key in nested_keys:
                nested = value.get(key)
                if isinstance(nested, dict):
                    point = extract_point(nested)
                    if point:
                        return point
                elif key in ("coordinates", "location") and isinstance(nested, (list, tuple)) and len(nested) >= 2:
                    try:
                        # GeoJSON coordinates are [longitude, latitude].
                        first, second = float(nested[0]), float(nested[1])
                        if -180 <= first <= 180 and -90 <= second <= 90:
                            return second, first
                    except (TypeError, ValueError):
                        pass
            latitude = value.get("lat", value.get("latitude"))
            longitude = value.get("lng", value.get("longitude", value.get("lon", value.get("long"))))
            try:
                if latitude is not None and longitude is not None:
                    latitude, longitude = float(latitude), float(longitude)
                    if -90 <= latitude <= 90 and -180 <= longitude <= 180:
                        return latitude, longitude
            except (TypeError, ValueError):
                pass
            return None

        for warehouse in candidates:
            # Explicitly inactive/deleted records must never be assigned.
            if warehouse.get("isActive") is False or warehouse.get("is_active") is False:
                continue
            status = str(warehouse.get("status") or "").strip().lower()
            if status in {"inactive", "disabled", "suspended", "deleted", "rejected", "archived"}:
                continue
            if warehouse.get("deletedAt") or warehouse.get("deleted_at"):
                continue

            total = first_number(warehouse, (
                "totalCapacity", "total_capacity", "capacity", "storageCapacity", "storage_capacity"
            ))
            used = first_number(warehouse, (
                "usedCapacity", "used_capacity", "currentCapacityUsed", "current_capacity_used"
            ))
            # A missing capacity is not proof of free capacity. Do not assign
            # stock to a warehouse whose capacity cannot be verified.
            if total is None:
                continue
            free = max(0.0, total - (used or 0.0))
            if free + 1e-9 < float(required_capacity or 0):
                continue

            supported = [
                str(item).strip().lower()
                for item in (warehouse.get("supportedStorageTypes") or warehouse.get("supported_storage_types") or [])
            ]
            storage_ok = not requested_storage or not supported or requested_storage in supported
            if not storage_ok:
                continue

            location = (
                warehouse.get("location") or warehouse.get("coordinates")
                or warehouse.get("address") or warehouse.get("geoLocation")
                or warehouse.get("geo_location") or {}
            )
            warehouse_point = extract_point(location)
            if not warehouse_point:
                warehouse_point = extract_point(warehouse)
            if not warehouse_point:
                continue

            lat2, lng2 = warehouse_point
            dlat = radians(lat2 - farm_lat)
            dlng = radians(lng2 - farm_lng)
            a = (
                sin(dlat / 2) ** 2
                + cos(radians(farm_lat)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
            )
            distance_km = 6371.0088 * 2 * asin(sqrt(max(0.0, min(1.0, a))))
            if distance_km > float(radius_km):
                continue
            eligible.append((distance_km, warehouse, free))

        if not eligible:
            logger.warning(
                "No eligible warehouse found for farm coordinates (%s, %s), "
                "required_capacity=%s, radius_km=%s, candidate_count=%s",
                farm_lat, farm_lng, required_capacity, radius_km, len(candidates),
            )
            return None

        eligible.sort(key=lambda item: (
            item[0], -item[2], str(item[1].get("name") or item[1].get("warehouseName") or "")
        ))
        distance_km, warehouse, free = eligible[0]
        warehouse["selectionDistanceKm"] = round(distance_km, 1)
        warehouse["availableCapacity"] = round(free, 2)
        warehouse["selectionReason"] = "Nearest active warehouse with verified available capacity"
        return warehouse

    async def get_warehouse_stats(self, warehouse_id: str) -> Dict[str, Any]:
        warehouse = await self.get_by_id(warehouse_id)
        if not warehouse:
            return {}

        from app.repositories.warehouse_stock_repository import warehouse_stock_repository
        stock_items = await warehouse_stock_repository.get_by_warehouse_id(warehouse_id)

        total_items = len(stock_items)
        low_stock = len([s for s in stock_items if s.get("status") == "low_stock"])
        out_of_stock = len([s for s in stock_items if s.get("status") == "out_of_stock"])
        expired = len([s for s in stock_items if s.get("status") == "expired"])

        total_quantity = sum(s.get("quantity", 0) for s in stock_items)
        total_value = sum(s.get("quantity", 0) * s.get("productPrice", 0) for s in stock_items)

        from app.repositories.incoming_stock_repository import incoming_stock_repository
        incoming_today = await incoming_stock_repository.count({
            "warehouseId": ObjectId(warehouse_id),
            "expectedDate": {"$gte": datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)},
            "deletedAt": None
        })

        from app.repositories.outgoing_stock_repository import outgoing_stock_repository
        outgoing_today = await outgoing_stock_repository.count({
            "warehouseId": ObjectId(warehouse_id),
            "createdAt": {"$gte": datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)},
            "deletedAt": None
        })

        return {
            "totalItems": total_items,
            "totalQuantity": total_quantity,
            "totalValue": total_value,
            "lowStock": low_stock,
            "outOfStock": out_of_stock,
            "expired": expired,
            "incomingToday": incoming_today,
            "outgoingToday": outgoing_today,
            "capacityUtilization": round(
                (warehouse.get("usedCapacity", 0) / warehouse.get("totalCapacity", 1)) * 100,
                1
            ) if warehouse.get("totalCapacity", 0) > 0 else 0,
            "coldStorageUtilization": round(
                (warehouse.get("coldStorageUsed", 0) / warehouse.get("coldStorageCapacity", 1)) * 100,
                1
            ) if warehouse.get("coldStorageCapacity", 0) > 0 else 0
        }


warehouse_repository = WarehouseRepository()
