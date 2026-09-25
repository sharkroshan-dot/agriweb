from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime, timedelta
from app.repositories.base_repository import BaseRepository
from app.schemas.warehouse import StockStatus
import logging

logger = logging.getLogger(__name__)

class WarehouseStockRepository(BaseRepository):
    """Warehouse stock repository."""

    def __init__(self):
        super().__init__("warehouse_stock")

    async def create_stock(self, stock_data: Dict[str, Any]) -> Optional[str]:
        stock_data["createdAt"] = datetime.utcnow()
        stock_data["updatedAt"] = datetime.utcnow()
        stock_data["reservedQuantity"] = stock_data.get("reservedQuantity", 0)
        stock_data["status"] = StockStatus.IN_STOCK
        return await self.create(stock_data)

    async def get_by_id(self, stock_id: str) -> Optional[Dict[str, Any]]:
        try:
            obj_id = ObjectId(stock_id)
            return await self.find_one({"_id": obj_id, "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting stock: {str(e)}")
            return None

    async def get_by_warehouse_id(
        self,
        warehouse_id: str,
        skip: int = 0,
        limit: int = 100,
        status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        try:
            filter = {"warehouseId": ObjectId(warehouse_id), "deletedAt": None}
            if status:
                filter["status"] = status
            return await self.find_many(
                filter,
                skip=skip,
                limit=limit,
                sort=[("updatedAt", -1)]
            )
        except Exception as e:
            logger.error(f"Error getting stock by warehouse: {str(e)}")
            return []

    async def get_by_product_id(
        self,
        product_id: str,
        warehouse_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        filter = {"productId": ObjectId(product_id), "deletedAt": None}
        if warehouse_id:
            filter["warehouseId"] = ObjectId(warehouse_id)

        return await self.find_many(filter)

    async def update_stock(self, stock_id: str, data: Dict[str, Any]) -> bool:
        try:
            obj_id = ObjectId(stock_id)
            data["updatedAt"] = datetime.utcnow()

            if "quantity" in data and "status" not in data:
                stock = await self.get_by_id(stock_id)
                if stock:
                    quantity = data["quantity"]
                    min_threshold = stock.get("minThreshold", 10)
                    if quantity <= 0:
                        data["status"] = StockStatus.OUT_OF_STOCK
                    elif quantity < min_threshold:
                        data["status"] = StockStatus.LOW_STOCK
                    else:
                        data["status"] = StockStatus.IN_STOCK
                    expiry = stock.get("expiryDate")
                    if expiry and expiry < datetime.utcnow():
                        data["status"] = StockStatus.EXPIRED

            return await self.update({"_id": obj_id}, data)
        except Exception as e:
            logger.error(f"Error updating stock: {str(e)}")
            return False

    async def reserve_stock(
        self,
        product_id: str,
        quantity: int,
        warehouse_id: Optional[str] = None
    ) -> bool:
        try:
            filter = {
                "productId": ObjectId(product_id),
                "deletedAt": None
            }
            if warehouse_id:
                filter["warehouseId"] = ObjectId(warehouse_id)

            stock = await self.find_one(filter)
            if not stock:
                return False

            available = stock.get("quantity", 0) - stock.get("reservedQuantity", 0)
            if available < quantity:
                return False

            result = await self.collection.update_one(
                {"_id": stock["_id"]},
                {
                    "$inc": {"reservedQuantity": quantity},
                    "$set": {"updatedAt": datetime.utcnow()}
                }
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error reserving stock: {str(e)}")
            return False

    async def release_stock(
        self,
        product_id: str,
        quantity: int,
        warehouse_id: Optional[str] = None
    ) -> bool:
        try:
            filter = {
                "productId": ObjectId(product_id),
                "deletedAt": None
            }
            if warehouse_id:
                filter["warehouseId"] = ObjectId(warehouse_id)
            result = await self.collection.update_one(
                filter,
                {
                    "$inc": {"reservedQuantity": -quantity},
                    "$set": {"updatedAt": datetime.utcnow()}
                }
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error releasing stock: {str(e)}")
            return False

    async def get_low_stock_items(
        self,
        warehouse_id: Optional[str] = None,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        filter = {
            "status": {"$in": [StockStatus.LOW_STOCK, StockStatus.OUT_OF_STOCK]},
            "deletedAt": None
        }
        if warehouse_id:
            filter["warehouseId"] = ObjectId(warehouse_id)

        return await self.find_many(
            filter,
            limit=limit,
            sort=[("quantity", 1)]
        )

    async def get_expiring_items(
        self,
        days: int = 7,
        warehouse_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        expiry_date = datetime.utcnow() + timedelta(days=days)
        filter = {
            "expiryDate": {"$lte": expiry_date, "$gte": datetime.utcnow()},
            "deletedAt": None
        }
        if warehouse_id:
            filter["warehouseId"] = ObjectId(warehouse_id)

        return await self.find_many(
            filter,
            sort=[("expiryDate", 1)]
        )

    async def get_stock_value(self, warehouse_id: str) -> float:
        try:
            stock_items = await self.get_by_warehouse_id(warehouse_id)
            total_value = 0
            for item in stock_items:
                product_price = 0
                total_value += item.get("quantity", 0) * product_price
            return total_value
        except Exception as e:
            logger.error(f"Error calculating stock value: {str(e)}")
            return 0


warehouse_stock_repository = WarehouseStockRepository()
