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

        if "totalCapacity" in update_data:
            total_capacity = float(update_data["totalCapacity"] or 0)
            await warehouse_repository.sync_capacity_usage(warehouse_id)
            current = await warehouse_repository.get_by_id(warehouse_id)
            current_used = float(current.get("usedCapacity", 0) or 0) if current else 0
            if total_capacity < current_used:
                raise ValueError(
                    f"Total capacity cannot be lower than current used capacity ({current_used:g})."
                )

        if "coldStorageCapacity" in update_data:
            cold_capacity = float(update_data["coldStorageCapacity"] or 0)
            current = await warehouse_repository.get_by_id(warehouse_id)
            current_cold_used = float(current.get("coldStorageUsed", 0) or 0) if current else 0
            if cold_capacity < current_cold_used:
                raise ValueError(
                    f"Cold storage capacity cannot be lower than current used cold storage ({current_cold_used:g})."
                )

        success = await warehouse_repository.update_warehouse(warehouse_id, update_data)
        if not success:
            return None
        return await warehouse_repository.get_by_id(warehouse_id)

    @staticmethod
    async def get_warehouse_dashboard(warehouse_id: str) -> Dict[str, Any]:
        warehouse = await warehouse_repository.get_by_id(warehouse_id)
        if not warehouse:
            return {}
        await warehouse_repository.sync_capacity_usage(warehouse_id)
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

        warehouse = await warehouse_repository.get_by_id(data.warehouseId)
        if not warehouse:
            return None
        current_used = float(warehouse.get("usedCapacity", 0) or 0)
        existing_quantity = float(existing.get("quantity", 0) or 0) if existing else 0
        new_total = current_used - existing_quantity + float(data.quantity)
        total_capacity = float(warehouse.get("totalCapacity", 0) or 0)
        if total_capacity > 0 and new_total > total_capacity:
            raise ValueError(
                f"Warehouse capacity exceeded. Available: {max(0, total_capacity - current_used):g}, requested: {data.quantity:g}."
            )

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
            warehouse = await warehouse_repository.get_by_id(str(incoming["warehouseId"]))
            if not warehouse:
                return None
            current_used = float(warehouse.get("usedCapacity", 0) or 0)
            total_capacity = float(warehouse.get("totalCapacity", 0) or 0)
            if total_capacity > 0 and current_used + quantity > total_capacity:
                return None

            stock_filter = {
                "warehouseId": ObjectId(incoming["warehouseId"]),
                "productId": ObjectId(incoming["productId"]),
                "variantId": ObjectId(incoming["variantId"]) if incoming.get("variantId") else None,
                "deletedAt": None,
            }
            existing_stock = await warehouse_stock_repository.find_one(stock_filter)
            if existing_stock:
                updated = await warehouse_stock_repository.update_stock(
                    str(existing_stock["_id"]),
                    {"quantity": int(existing_stock.get("quantity", 0)) + quantity}
                )
                if not updated:
                    return None
            else:
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

        if incoming.get("orderId") and str(incoming.get("sourceMode") or "") == "farmer_fulfillment_transfer" and quality_check == "passed" and str(incoming.get("status")) == "received":
            try:
                from app.repositories.order_repository import order_repository
                await order_repository.update({"_id": ObjectId(str(incoming["orderId"]))}, {"warehouseFulfillmentStage": "received_transfer", "warehouseCollectionStatus": "arrived_warehouse", "updatedAt": datetime.utcnow()})
            except Exception:
                logger.exception("Failed to update farmer transfer order after receipt")

        if incoming.get("orderId") and quality_check == "passed" and str(incoming.get("status")) == "received":
            try:
                from app.repositories.order_repository import order_repository
                await order_repository.update(
                    {"_id": ObjectId(str(incoming["orderId"]))},
                    {"warehouseFulfillmentStage": "received", "updatedAt": datetime.utcnow()},
                )
                await order_repository.append_tracking_event(str(incoming["orderId"]), "warehouse_received", "Warehouse received the shipment", "Warehouse staff received the shipment after collection.", actor_role="warehouse", metadata={"incomingStockId": str(incoming["_id"])})
            except Exception:
                logger.exception("Failed to update farmer order warehouse stage after receipt")

        # Outgoing work is intentionally created after the explicit Store step.
        return await incoming_stock_repository.get_by_id(incoming_id)

    @staticmethod
    async def store_incoming(incoming_id: str, warehouse_id: str) -> Optional[Dict[str, Any]]:
        incoming = await incoming_stock_repository.get_by_id(incoming_id)
        if not incoming or str(incoming.get("warehouseId")) != str(warehouse_id):
            return None
        if str(incoming.get("status")) != "received" or str(incoming.get("qualityCheck")) != "passed":
            return None

        updated = await incoming_stock_repository.update(
            {"_id": incoming["_id"]},
            {"status": "stored", "storedAt": datetime.utcnow(), "updatedAt": datetime.utcnow()},
        )
        if not updated:
            return None

        if incoming.get("orderId"):
            try:
                from app.repositories.order_repository import order_repository
                await order_repository.update(
                    {"_id": ObjectId(str(incoming["orderId"]))},
                    {"warehouseFulfillmentStage": "stored", "updatedAt": datetime.utcnow()},
                )
                await order_repository.append_tracking_event(str(incoming["orderId"]), "stock_stored", "Stock stored at warehouse", "Quality-approved stock has been stored and is ready for order allocation.", actor_role="warehouse", metadata={"incomingStockId": str(incoming["_id"])})
            except Exception:
                logger.exception("Failed to update farmer order warehouse stage after storage")

        # Transfer-only inbound from Farmer Fulfillment is already packed.
        # It goes directly to dispatch after receipt/storage; warehouse packing
        # is only used when packingRequired is true.
        if incoming.get("orderId") and incoming.get("packingRequired") is False:
            try:
                from app.repositories.order_repository import order_repository
                from app.repositories.outgoing_stock_repository import outgoing_stock_repository
                existing = await outgoing_stock_repository.get_by_order_id(
                    str(incoming["orderId"]), str(incoming["productId"]), str(incoming.get("variantId") or "")
                )
                if not existing:
                    await WarehouseService.create_outgoing(OutgoingStockCreate(
                        warehouseId=str(warehouse_id),
                        productId=str(incoming["productId"]),
                        variantId=str(incoming["variantId"]) if incoming.get("variantId") else None,
                        orderId=str(incoming["orderId"]),
                        quantity=int(incoming.get("quantity", 0)),
                        batchNumber=incoming.get("batchNumber"),
                    ))
                await order_repository.update(
                    {"_id": ObjectId(str(incoming["orderId"]))},
                    {"warehouseFulfillmentStage": "ready_for_dispatch", "updatedAt": datetime.utcnow()},
                )
            except Exception:
                logger.exception("Failed to create transfer-only dispatch for %s", incoming.get("orderId"))
            return await incoming_stock_repository.get_by_id(incoming_id)

        # Warehouse fulfillment creates exactly one order-level packing task.
        # The task is created only after EVERY inbound line for the order is stored.
        # This prevents a multi-product customer order from being treated as packed
        # when only one product line reached the packing queue.
        if incoming.get("orderId"):
            await WarehouseService.ensure_order_packing_task(str(incoming["orderId"]), str(warehouse_id))
        return await incoming_stock_repository.get_by_id(incoming_id)

    @staticmethod
    async def ensure_order_packing_task(order_id: str, warehouse_id: str) -> Optional[Dict[str, Any]]:
        """Create/update one packing checklist for the complete customer order.

        A warehouse order is not packable until every ordered product has a
        matching, quality-approved, stored inbound quantity. One task owns the
        complete customer package, so no item can silently fall outside the
        packing/verification workflow.
        """
        from app.repositories.order_repository import order_repository
        from app.repositories.warehouse_packing_repository import warehouse_packing_repository
        order = await order_repository.get_by_id(order_id)
        if not order or str(order.get("fulfillmentMethod") or "") != "warehouse":
            return None
        incoming = await incoming_stock_repository.find_many({
            "orderId": ObjectId(order_id),
            "warehouseId": ObjectId(warehouse_id),
            "packingRequired": True,
            "deletedAt": None,
        }, skip=0, limit=1000)
        inbound_by_key = {}
        for row in incoming:
            key = (str(row.get("productId")), str(row.get("variantId") or ""))
            inbound_by_key[key] = inbound_by_key.get(key, 0.0) + float(row.get("quantityReceived") or row.get("quantity") or 0)
        packing_items = []
        missing = []
        for item in order.get("items") or []:
            key = (str(item.get("productId")), str(item.get("variantId") or ""))
            required = float(item.get("quantity") or 0)
            stored_qty = inbound_by_key.get(key, 0.0)
            if stored_qty + 1e-9 < required:
                missing.append({"productId": key[0], "variantId": key[1] or None, "required": required, "stored": stored_qty})
            packing_items.append({
                "itemKey": f"{key[0]}:{key[1]}",
                "productId": key[0],
                "variantId": key[1] or None,
                "productName": item.get("productName") or "Product",
                "quantityRequired": required,
                "packedQuantity": 0.0,
                "unit": item.get("unit") or "kg",
            })
        if missing:
            await order_repository.update({"_id": ObjectId(order_id)}, {
                "warehouseFulfillmentStage": "stored",
                "packingReadiness": {"complete": False, "missingItems": missing},
                "updatedAt": datetime.utcnow(),
            })
            return None
        existing = await warehouse_packing_repository.get_by_order(order_id)
        if existing:
            existing_items = existing.get("packingItems") or []
            for item in packing_items:
                old_item = next((x for x in existing_items if x.get("itemKey") == item["itemKey"]), None)
                if old_item:
                    item["packedQuantity"] = float(old_item.get("packedQuantity") or 0)
            await warehouse_packing_repository.update_task(str(existing["_id"]), {
                "packingItems": packing_items,
                "quantityRequired": sum(x["quantityRequired"] for x in packing_items),
            })
            task = await warehouse_packing_repository.get_by_id(str(existing["_id"]))
        else:
            first = packing_items[0] if packing_items else {}
            task_id = await warehouse_packing_repository.create_task({
                "warehouseId": ObjectId(warehouse_id),
                "orderId": ObjectId(order_id),
                "farmerId": ObjectId(str(order.get("farmerId"))),
                "productId": ObjectId(first["productId"]) if first.get("productId") else None,
                "variantId": ObjectId(first["variantId"]) if first.get("variantId") else None,
                "quantityRequired": sum(x["quantityRequired"] for x in packing_items),
                "packedQuantity": 0.0,
                "packingItems": packing_items,
                "orderPacking": True,
                "status": "ready_for_packing",
                "packingResponsibility": "warehouse",
            })
            task = await warehouse_packing_repository.get_by_id(str(task_id)) if task_id else None
        await order_repository.update({"_id": ObjectId(order_id)}, {
            "warehouseFulfillmentStage": "ready_for_packing",
            "packingReadiness": {"complete": True, "missingItems": []},
            "packingTaskId": task.get("_id") if task else None,
            "updatedAt": datetime.utcnow(),
        })
        return task

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
        from app.repositories.order_repository import order_repository
        order = await order_repository.get_by_id(data.orderId)
        if not order:
            return None
        fulfillment_method = str(order.get("fulfillmentMethod") or "farmer")
        transfer_only = str(order.get("logisticsMode") or "") == "farmer_to_warehouse_to_local_hub_to_delivery_partner"
        if fulfillment_method != "warehouse" and not transfer_only:
            return None
        if str(order.get("warehouseId")) != str(data.warehouseId):
            return None
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
        current_status = str(outgoing.get("status") or "pending")
        # Packing verification creates an outgoing record in "pending",
        # which represents the UI stage "Ready for Dispatch".
        # Delivery Decision must be recorded before the physical dispatch.
        allowed = {
            "pending": {"dispatched"},
            "packed": {"dispatched"},
            "dispatched": set(),
        }
        if status not in allowed.get(current_status, set()):
            return None
        if warehouse_id and str(outgoing.get("warehouseId")) != str(warehouse_id):
            return None
        from app.repositories.order_repository import order_repository
        order = await order_repository.get_by_id(str(outgoing.get("orderId"))) if outgoing.get("orderId") else None
        if not order:
            return None
        transfer_only = str(order.get("logisticsMode") or "") == "farmer_to_warehouse_to_local_hub_to_delivery_partner"
        if str(order.get("fulfillmentMethod") or "farmer") != "warehouse" and not transfer_only:
            return None

        # Exact warehouse sequence:
        # Ready for Dispatch -> Delivery Decision -> Warehouse Dispatch.
        # Never allow a package to leave the warehouse without a selected
        # nearby/long-distance delivery route.
        if status == "dispatched":
            route = str(outgoing.get("deliveryPartnerRoute") or "")
            if route not in ("nearby", "long_distance"):
                return None
            if str(order.get("warehouseFulfillmentStage") or "") not in (
                "ready_for_dispatch", "delivery_decision", "dispatched"
            ):
                return None

        success = await outgoing_stock_repository.update_status(outgoing_id, status, data)
        if not success:
            return None
        try:
            stage_map = {"packed": "packed", "dispatched": "dispatched"}
            if str(outgoing.get("orderId")) in ("", "None"):
                pass
            elif status in stage_map:
                from app.repositories.order_repository import order_repository
                await order_repository.update(
                    {"_id": ObjectId(str(outgoing["orderId"]))},
                    {"warehouseFulfillmentStage": stage_map[status], "updatedAt": datetime.utcnow()},
                )
        except Exception:
            logger.exception("Failed to update farmer order warehouse stage for outgoing %s", outgoing_id)

        if status == "dispatched":
            await warehouse_stock_repository.release_stock(
                str(outgoing["productId"]),
                outgoing.get("quantity", 0),
                str(outgoing["warehouseId"]) if outgoing.get("warehouseId") else None,
                str(outgoing["variantId"]) if outgoing.get("variantId") else None,
            )
            await warehouse_repository.sync_capacity_usage(str(outgoing["warehouseId"]))
            # Complete the warehouse -> delivery handoff. An outgoing record
            # always carries orderId, so dispatching it must move the order
            # into the delivery-ready state instead of leaving the order stuck
            # in warehouse operations.
            order_id = outgoing.get("orderId")
            if order_id:
                from app.repositories.order_repository import order_repository
                order = await order_repository.get_by_id(str(order_id))
                if order and str(order.get("orderStatus") or "").lower() not in ("delivered", "completed", "cancelled"):
                    await order_repository.update(
                        {"_id": order["_id"]},
                        {
                            "orderStatus": "ready_for_delivery",
                            "warehouseDispatchedAt": datetime.utcnow(),
                            "updatedAt": datetime.utcnow(),
                        },
                    )
                    try:
                        customer_id = order.get("customerId")
                        if customer_id:
                            await NotificationService.send_order_ready(str(customer_id), str(order["_id"]))
                    except Exception:
                        logger.exception("Failed to notify customer after warehouse dispatch")
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
            data.fromWarehouseId,
            data.variantId,
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
        await warehouse_repository.sync_capacity_usage(str(transfer["fromWarehouseId"]))
        stock_data = {
            "warehouseId": transfer["toWarehouseId"],
            "productId": transfer["productId"],
            "variantId": transfer.get("variantId"),
            "quantity": transfer.get("quantity", 0),
            "batchNumber": transfer.get("batchNumber")
        }
        await warehouse_stock_repository.create_stock(stock_data)
        await warehouse_repository.sync_capacity_usage(str(transfer["toWarehouseId"]))
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
