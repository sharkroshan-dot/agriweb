from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.warehouse_repository import warehouse_repository
from app.repositories.warehouse_stock_repository import warehouse_stock_repository
from app.repositories.incoming_stock_repository import incoming_stock_repository
from app.repositories.outgoing_stock_repository import outgoing_stock_repository
from app.repositories.cold_storage_repository import cold_storage_repository
from app.repositories.warehouse_transfer_repository import warehouse_transfer_repository
from app.schemas.warehouse import (
    WarehouseCreate, WarehouseUpdate,
    WarehouseStockCreate, WarehouseStockUpdate,
    IncomingStockCreate,
    OutgoingStockCreate, OutgoingStockUpdate,
    ColdStorageCreate, ColdStorageUpdate,
    WarehouseTransferCreate
)
from app.services.notification_service import NotificationService
import logging

logger = logging.getLogger(__name__)

class WarehouseService:
    """Warehouse service with business logic."""

    @staticmethod
    async def create_warehouse(data: WarehouseCreate) -> Optional[Dict[str, Any]]:
        warehouse_id = await warehouse_repository.create_warehouse(data.dict())
        if not warehouse_id:
            return None
        return await warehouse_repository.get_by_id(warehouse_id)

    @staticmethod
    async def get_warehouse(warehouse_id: str) -> Optional[Dict[str, Any]]:
        return await warehouse_repository.get_by_id(warehouse_id)

    @staticmethod
    async def get_warehouse_by_manager(manager_id: str) -> Optional[Dict[str, Any]]:
        return await warehouse_repository.get_by_manager(manager_id)

    @staticmethod
    async def update_warehouse(
        warehouse_id: str,
        data: WarehouseUpdate
    ) -> Optional[Dict[str, Any]]:
        warehouse = await warehouse_repository.get_by_id(warehouse_id)
        if not warehouse:
            return None
        update_data = data.dict(exclude_unset=True)
        success = await warehouse_repository.update_warehouse(warehouse_id, update_data)
        if not success:
            return None
        return await warehouse_repository.get_by_id(warehouse_id)

    @staticmethod
    async def get_warehouse_dashboard(warehouse_id: str) -> Dict[str, Any]:
        warehouse = await warehouse_repository.get_by_id(warehouse_id)
        if not warehouse:
            return {}
        stats = await warehouse_repository.get_warehouse_stats(warehouse_id)
        low_stock = await warehouse_stock_repository.get_low_stock_items(warehouse_id, limit=10)
        return {
            "warehouse": warehouse,
            "stockSummary": stats,
            "capacityUtilization": stats.get("capacityUtilization", 0),
            "coldStorageUtilization": stats.get("coldStorageUtilization", 0),
            "incomingToday": stats.get("incomingToday", 0),
            "outgoingToday": stats.get("outgoingToday", 0),
            "lowStockItems": low_stock,
            "recentActivities": []
        }

    @staticmethod
    async def add_stock(data: WarehouseStockCreate) -> Optional[Dict[str, Any]]:
        existing = await warehouse_stock_repository.find_one({
            "warehouseId": ObjectId(data.warehouseId),
            "productId": ObjectId(data.productId),
            "variantId": ObjectId(data.variantId) if data.variantId else None,
            "deletedAt": None
        })

        if existing:
            new_quantity = existing.get("quantity", 0) + data.quantity
            await warehouse_stock_repository.update_stock(
                str(existing["_id"]),
                {"quantity": new_quantity}
            )
            return await warehouse_stock_repository.get_by_id(str(existing["_id"]))

        stock_id = await warehouse_stock_repository.create_stock(data.dict())
        if not stock_id:
            return None
        return await warehouse_stock_repository.get_by_id(stock_id)

    @staticmethod
    async def update_stock(
        stock_id: str,
        data: WarehouseStockUpdate,
        warehouse_id: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        stock = await warehouse_stock_repository.get_by_id(stock_id)
        if stock and warehouse_id and str(stock.get("warehouseId")) != str(warehouse_id):
            return None
        if not stock:
            return None
        update_data = data.dict(exclude_unset=True)
        success = await warehouse_stock_repository.update_stock(stock_id, update_data)
        if not success:
            return None
        return await warehouse_stock_repository.get_by_id(stock_id)

    @staticmethod
    async def get_warehouse_stock(
        warehouse_id: str,
        skip: int = 0,
        limit: int = 100,
        status: Optional[str] = None,
    ) -> tuple[List[Dict[str, Any]], int]:
        stock = await warehouse_stock_repository.get_by_warehouse_id(
            warehouse_id, skip, limit, status
        )
        count_filter = {"warehouseId": ObjectId(warehouse_id), "deletedAt": None}
        if status:
            count_filter["status"] = status
        total = await warehouse_stock_repository.count(count_filter)
        return stock, total

    @staticmethod
    async def schedule_incoming(data: IncomingStockCreate) -> Optional[Dict[str, Any]]:
        incoming_id = await incoming_stock_repository.create_incoming(data.dict())
        if not incoming_id:
            return None
        incoming = await incoming_stock_repository.get_by_id(incoming_id)
        if incoming:
            warehouse = await warehouse_repository.get_by_id(data.warehouseId)
            if warehouse and warehouse.get("managerId"):
                await NotificationService.send_delivery_assignment(
                    str(warehouse["managerId"]),
                    incoming_id
                )
        return await incoming_stock_repository.get_by_id(incoming_id)

    @staticmethod
    async def receive_incoming(
        incoming_id: str,
        quantity: int,
        quality_check: str,
        notes: Optional[str] = None,
        warehouse_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        incoming = await incoming_stock_repository.get_by_id(incoming_id)
        if not incoming:
            return None
        if warehouse_id and str(incoming.get("warehouseId")) != str(warehouse_id):
            return None
        if incoming.get("status") in ("received", "rejected"):
            return None
        if quantity <= 0:
            return None

        expected_quantity = incoming.get("quantity", 0)
        if quantity > expected_quantity:
            return None

        success = await incoming_stock_repository.receive_stock(
            incoming_id,
            quantity,
            quality_check,
            notes
        )
        if not success:
            return None

        if quality_check == "passed" and quantity > 0:
            stock_data = {
                "warehouseId": incoming["warehouseId"],
                "productId": incoming["productId"],
                "variantId": incoming.get("variantId"),
                "quantity": quantity,
                "batchNumber": incoming.get("batchNumber"),
                "storageType": incoming.get("storageType", "ambient"),
            }
            stock_id = await warehouse_stock_repository.create_stock(stock_data)
            if not stock_id:
                return None

        return await incoming_stock_repository.get_by_id(incoming_id)

    @staticmethod
    async def get_incoming_stock(
        warehouse_id: str,
        status: Optional[str] = None,
        skip: int = 0,
        limit: int = 100
    ) -> tuple[List[Dict[str, Any]], int]:
        incoming = await incoming_stock_repository.get_by_warehouse_id(
            warehouse_id, status, skip, limit
        )
        total = await incoming_stock_repository.count({
            "warehouseId": ObjectId(warehouse_id),
            "deletedAt": None
        })
        return incoming, total

    @staticmethod
    async def create_outgoing(data: OutgoingStockCreate) -> Optional[Dict[str, Any]]:
        stock = await warehouse_stock_repository.find_one({
            "warehouseId": ObjectId(data.warehouseId),
            "productId": ObjectId(data.productId),
            "variantId": ObjectId(data.variantId) if data.variantId else None,
            "deletedAt": None
        })
        if not stock or stock.get("quantity", 0) < data.quantity:
            return None
        outgoing_id = await outgoing_stock_repository.create_outgoing(data.dict())
        if not outgoing_id:
            return None
        reserved = await warehouse_stock_repository.reserve_stock(
            data.productId,
            data.quantity,
            data.warehouseId,
            data.variantId,
        )
        if not reserved:
            await outgoing_stock_repository.update_status(outgoing_id, "pending", {"notes": "Stock reservation failed; outgoing record was not dispatched."})
            return None
        return await outgoing_stock_repository.get_by_id(outgoing_id)

    @staticmethod
    async def update_outgoing_status(
        outgoing_id: str,
        status: str,
        warehouse_id: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None
    ) -> Optional[Dict[str, Any]]:
        outgoing = await outgoing_stock_repository.get_by_id(outgoing_id)
        if not outgoing:
            return None
        if warehouse_id and str(outgoing.get("warehouseId")) != str(warehouse_id):
            return None
        success = await outgoing_stock_repository.update_status(outgoing_id, status, data)
        if not success:
            return None
        if status == "dispatched":
            await warehouse_stock_repository.release_stock(
                str(outgoing["productId"]),
                outgoing.get("quantity", 0),
                str(outgoing["warehouseId"]) if outgoing.get("warehouseId") else None,
                str(outgoing["variantId"]) if outgoing.get("variantId") else None,
            )
        return await outgoing_stock_repository.get_by_id(outgoing_id)

    @staticmethod
    async def get_outgoing_stock(
        warehouse_id: str,
        status: Optional[str] = None,
        skip: int = 0,
        limit: int = 100
    ) -> tuple[List[Dict[str, Any]], int]:
        outgoing = await outgoing_stock_repository.get_by_warehouse_id(
            warehouse_id, status, skip, limit
        )
        total = await outgoing_stock_repository.count({
            "warehouseId": ObjectId(warehouse_id),
            "deletedAt": None
        })
        return outgoing, total

    @staticmethod
    async def add_cold_storage(data: ColdStorageCreate) -> Optional[Dict[str, Any]]:
        existing = await cold_storage_repository.find_one({
            "warehouseId": ObjectId(data.warehouseId),
            "productId": ObjectId(data.productId),
            "variantId": ObjectId(data.variantId) if data.variantId else None,
            "deletedAt": None
        })
        if existing:
            new_quantity = existing.get("quantity", 0) + data.quantity
            await cold_storage_repository.update(
                {"_id": existing["_id"]},
                {"quantity": new_quantity}
            )
            return await cold_storage_repository.get_by_id(str(existing["_id"]))
        storage_id = await cold_storage_repository.create_cold_storage(data.dict())
        if not storage_id:
            return None
        return await cold_storage_repository.get_by_id(storage_id)

    @staticmethod
    async def update_cold_storage(
        storage_id: str,
        data: ColdStorageUpdate
    ) -> Optional[Dict[str, Any]]:
        storage = await cold_storage_repository.get_by_id(storage_id)
        if not storage:
            return None
        update_data = data.dict(exclude_unset=True)
        success = await cold_storage_repository.update(
            {"_id": ObjectId(storage_id)},
            update_data
        )
        if not success:
            return None
        return await cold_storage_repository.get_by_id(storage_id)

    @staticmethod
    async def get_cold_storage(
        warehouse_id: str,
        skip: int = 0,
        limit: int = 100
    ) -> tuple[List[Dict[str, Any]], int]:
        storage = await cold_storage_repository.get_by_warehouse_id(
            warehouse_id, skip, limit
        )
        total = await cold_storage_repository.count({
            "warehouseId": ObjectId(warehouse_id),
            "deletedAt": None
        })
        return storage, total

    @staticmethod
    async def create_transfer(data: WarehouseTransferCreate) -> Optional[Dict[str, Any]]:
        destination = await warehouse_repository.get_by_id(data.toWarehouseId)
        if not destination or str(data.fromWarehouseId) == str(data.toWarehouseId):
            return None
        source_stock = await warehouse_stock_repository.find_one({
            "warehouseId": ObjectId(data.fromWarehouseId),
            "productId": ObjectId(data.productId),
            "variantId": ObjectId(data.variantId) if data.variantId else None,
            "deletedAt": None
        })
        if not source_stock or source_stock.get("quantity", 0) < data.quantity:
            return None
        transfer_id = await warehouse_transfer_repository.create_transfer(data.dict())
        if not transfer_id:
            return None
        reserved = await warehouse_stock_repository.reserve_stock(
            data.productId,
            data.quantity,
            data.fromWarehouseId
        )
        if not reserved:
            await warehouse_transfer_repository.cancel_transfer(
                transfer_id,
                "Stock reservation failed"
            )
            return None
        return await warehouse_transfer_repository.get_by_id(transfer_id)

    @staticmethod
    async def complete_transfer(
        transfer_id: str,
        received_by: str,
        warehouse_id: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        transfer = await warehouse_transfer_repository.get_by_id(transfer_id)
        if not transfer:
            return None
        if warehouse_id and str(transfer.get("toWarehouseId")) != str(warehouse_id):
            return None
        success = await warehouse_transfer_repository.complete_transfer(
            transfer_id,
            received_by
        )
        if not success:
            return None
        await warehouse_stock_repository.release_stock(
            str(transfer["productId"]),
            transfer.get("quantity", 0),
            str(transfer["fromWarehouseId"]) if transfer.get("fromWarehouseId") else None
        )
        stock_data = {
            "warehouseId": transfer["toWarehouseId"],
            "productId": transfer["productId"],
            "variantId": transfer.get("variantId"),
            "quantity": transfer.get("quantity", 0),
            "batchNumber": transfer.get("batchNumber")
        }
        await warehouse_stock_repository.create_stock(stock_data)
        return await warehouse_transfer_repository.get_by_id(transfer_id)

    @staticmethod
    async def get_transfers(
        warehouse_id: str,
        status: Optional[str] = None,
        skip: int = 0,
        limit: int = 100
    ) -> tuple[List[Dict[str, Any]], int]:
        transfers = await warehouse_transfer_repository.get_by_warehouse_id(
            warehouse_id, status, skip, limit
        )
        total = await warehouse_transfer_repository.count({
            "$or": [
                {"fromWarehouseId": ObjectId(warehouse_id)},
                {"toWarehouseId": ObjectId(warehouse_id)}
            ],
            "deletedAt": None
        })
        return transfers, total


warehouse_service = WarehouseService()
