from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository
from app.database.mongodb import MongoDB
import logging

logger = logging.getLogger(__name__)


class InventoryRepository(BaseRepository):
    """Inventory repository with atomic stock operations."""

    def __init__(self):
        super().__init__("inventory")

    async def create_inventory(self, data: Dict[str, Any]) -> Optional[str]:
        data["created_at"] = datetime.utcnow()
        data["updated_at"] = datetime.utcnow()
        data["version"] = 0
        return await self.create(data)

    async def get_by_product_id(self, product_id: str) -> Optional[Dict[str, Any]]:
        try:
            results = await self.find_many(
                {"product_id": str(product_id), "deleted_at": None}
            )
            return results[0] if results else None
        except Exception as e:
            logger.error(f"Error getting inventory by product: {str(e)}")
            return None

    async def get_by_id(self, inventory_id: str) -> Optional[Dict[str, Any]]:
        try:
            obj_id = ObjectId(inventory_id)
            return await self.find_one({"_id": obj_id, "deleted_at": None})
        except Exception as e:
            logger.error(f"Error getting inventory: {str(e)}")
            return None

    async def get_by_farmer(self, farmer_id: str) -> List[Dict[str, Any]]:
        try:
            return await self.find_many(
                {"farmer_id": str(farmer_id), "deleted_at": None}
            )
        except Exception as e:
            logger.error(f"Error getting farmer inventory: {str(e)}")
            return []

    async def get_by_farmer_with_pipeline(self, farmer_id: str) -> List[Dict[str, Any]]:
        try:
            pipeline = [
                {"$match": {"farmer_id": str(farmer_id), "deleted_at": None}},
                {
                    "$lookup": {
                        "from": "products",
                        "let": {"product_oid": {"$toObjectId": "$product_id"}},
                        "pipeline": [
                            {"$match": {"$expr": {"$eq": ["$_id", "$$product_oid"]}}}
                        ],
                        "as": "product",
                    }
                },
                {"$unwind": {"path": "$product", "preserveNullAndEmptyArrays": True}},
                {"$sort": {"updated_at": -1}},
            ]
            return await self.aggregate(pipeline)
        except Exception as e:
            logger.error(f"Error in farmer inventory pipeline: {str(e)}")
            return []

    async def update_inventory(self, inventory_id: str, data: Dict[str, Any]) -> bool:
        try:
            obj_id = ObjectId(inventory_id)
            data["updated_at"] = datetime.utcnow()
            return await self.update({"_id": obj_id}, data)
        except Exception as e:
            logger.error(f"Error updating inventory: {str(e)}")
            return False

    async def atomic_restock(self, inventory_id: str, quantity: int) -> bool:
        try:
            result = await self.collection.update_one(
                {"_id": ObjectId(inventory_id), "deleted_at": None},
                {
                    "$inc": {"total_stock": quantity, "version": 1},
                    "$set": {"updated_at": datetime.utcnow()},
                },
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error in atomic_restock: {str(e)}")
            return False

    async def atomic_reserve(
        self, product_id: str, quantity: int
    ) -> bool:
        try:
            result = await self.collection.update_one(
                {
                    "product_id": str(product_id),
                    "deleted_at": None,
                },
                {
                    "$inc": {"reserved_stock": quantity, "version": 1},
                    "$set": {"updated_at": datetime.utcnow()},
                }
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error in atomic_reserve: {str(e)}")
            return False

    async def atomic_release(self, product_id: str, quantity: int) -> bool:
        try:
            result = await self.collection.update_one(
                {
                    "product_id": str(product_id),
                    "reserved_stock": {"$gte": quantity},
                    "deleted_at": None,
                },
                {
                    "$inc": {"reserved_stock": -quantity, "version": 1},
                    "$set": {"updated_at": datetime.utcnow()},
                }
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error in atomic_release: {str(e)}")
            return False

    async def atomic_confirm(self, product_id: str, quantity: int) -> bool:
        try:
            result = await self.collection.update_one(
                {
                    "product_id": str(product_id),
                    "reserved_stock": {"$gte": quantity},
                    "deleted_at": None,
                },
                {
                    "$inc": {"reserved_stock": -quantity, "sold_stock": quantity, "version": 1},
                    "$set": {"updated_at": datetime.utcnow()},
                }
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error in atomic_confirm: {str(e)}")
            return False

    async def atomic_refund(self, product_id: str, quantity: int) -> bool:
        try:
            result = await self.collection.update_one(
                {
                    "product_id": str(product_id),
                    "sold_stock": {"$gte": quantity},
                    "deleted_at": None,
                },
                {
                    "$inc": {"sold_stock": -quantity, "version": 1},
                    "$set": {"updated_at": datetime.utcnow()},
                }
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error in atomic_refund: {str(e)}")
            return False

    async def get_stock_summary(self, product_id: str) -> Optional[Dict[str, Any]]:
        try:
            inventory = await self.get_by_product_id(product_id)
            if not inventory:
                return None

            available = (
                inventory.get("total_stock", 0)
                - inventory.get("reserved_stock", 0)
                - inventory.get("sold_stock", 0)
            )
            return {
                "product_id": product_id,
                "total_stock": inventory.get("total_stock", 0),
                "reserved_stock": inventory.get("reserved_stock", 0),
                "sold_stock": inventory.get("sold_stock", 0),
                "available_stock": max(0, available),
                "unit": inventory.get("unit", "kg"),
                "is_out_of_stock": available <= 0,
            }
        except Exception as e:
            logger.error(f"Error getting stock summary: {str(e)}")
            return None

    async def get_all_summary(self) -> Dict[str, Any]:
        try:
            pipeline = [
                {"$match": {"deleted_at": None}},
                {
                    "$group": {
                        "_id": None,
                        "total_products": {"$sum": 1},
                        "total_stock": {"$sum": "$total_stock"},
                        "total_reserved": {"$sum": "$reserved_stock"},
                        "total_sold": {"$sum": "$sold_stock"},
                    }
                },
            ]
            results = await self.aggregate(pipeline)
            if not results:
                return {
                    "total_products": 0,
                    "total_stock": 0,
                    "total_reserved": 0,
                    "total_sold": 0,
                    "total_available": 0,
                }

            r = results[0]
            total_available = r.get("total_stock", 0) - r.get("total_reserved", 0) - r.get("total_sold", 0)
            return {
                "total_products": r.get("total_products", 0),
                "total_stock": r.get("total_stock", 0),
                "total_reserved": r.get("total_reserved", 0),
                "total_sold": r.get("total_sold", 0),
                "total_available": max(0, total_available),
            }
        except Exception as e:
            logger.error(f"Error getting inventory summary: {str(e)}")
            return {
                "total_products": 0,
                "total_stock": 0,
                "total_reserved": 0,
                "total_sold": 0,
                "total_available": 0,
            }

    async def ensure_inventory_exists(self, product_id: str, farmer_id: str, total_stock: int, unit: str = "kg") -> Optional[str]:
        try:
            existing = await self.get_by_product_id(product_id)
            if existing:
                sold = existing.get("sold_stock", 0)
                new_total = max(total_stock, sold)
                await self.update_inventory(str(existing["_id"]), {
                    "total_stock": new_total,
                    "unit": unit,
                })
                return str(existing["_id"])

            data = {
                "product_id": str(product_id),
                "farmer_id": str(farmer_id),
                "total_stock": total_stock,
                "reserved_stock": 0,
                "sold_stock": 0,
                "unit": unit,
                "version": 0,
            }
            return await self.create_inventory(data)
        except Exception as e:
            logger.error(f"Error ensuring inventory exists: {str(e)}")
            return None


inventory_repository = InventoryRepository()
