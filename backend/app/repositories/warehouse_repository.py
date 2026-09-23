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
            return await self.find_one({"_id": obj_id, "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting warehouse: {str(e)}")
            return None

    async def get_by_farmer_id(self, farmer_id: str) -> Optional[Dict[str, Any]]:
        try:
            return await self.find_one({
                "farmerId": ObjectId(farmer_id),
                "deletedAt": None
            })
        except Exception as e:
            logger.error(f"Error getting warehouse by farmer ID: {str(e)}")
            return None

    async def get_by_user_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        return await self.get_by_manager(user_id)

    async def get_by_manager(self, manager_id: str) -> Optional[Dict[str, Any]]:
        try:
            return await self.find_one({
                "managerId": ObjectId(manager_id),
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
            "capacityUtilization": (warehouse.get("usedCapacity", 0) / warehouse.get("totalCapacity", 1)) * 100,
            "coldStorageUtilization": (warehouse.get("coldStorageUsed", 0) / warehouse.get("coldStorageCapacity", 1)) * 100 if warehouse.get("coldStorageCapacity", 0) > 0 else 0
        }


warehouse_repository = WarehouseRepository()
