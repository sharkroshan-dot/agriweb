from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.warehouse_repository import warehouse_repository
from app.repositories.warehouse_stock_repository import warehouse_stock_repository
from app.repositories.incoming_stock_repository import incoming_stock_repository
from app.repositories.warehouse_pickup_route_repository import warehouse_pickup_route_repository
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
    async def find_best_warehouse(
        location: Dict[str, Any],
        required_capacity: float = 0,
        storage_type: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Select the nearest suitable warehouse instead of using a district mapping."""
        if not isinstance(location, dict):
            return None
        coordinates = location.get("coordinates")
        if isinstance(coordinates, (list, tuple)) and len(coordinates) >= 2:
            lng, lat = float(coordinates[0]), float(coordinates[1])
        else:
            lat = location.get("lat", location.get("latitude"))
            lng = location.get("lng", location.get("lon", location.get("longitude")))
            if lat is None or lng is None:
                return None
            lat, lng = float(lat), float(lng)
        return await warehouse_repository.find_best_warehouse(
            lat=lat,
            lng=lng,
            required_capacity=float(required_capacity or 0),
            storage_type=storage_type,
        )

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
    async def create_pickup_route_incoming(route_id: str) -> List[Dict[str, Any]]:
        route = await warehouse_pickup_route_repository.get_by_id(route_id)
        if not route or str(route.get("status")) not in ("completed", "returned_to_warehouse"):
            return []
        created = []
        for stop in route.get("stops") or []:
            collection_id = str(stop.get("collectionId") or "")
            existing = await incoming_stock_repository.find_one({"pickupRouteId": ObjectId(route_id), "collectionId": ObjectId(collection_id) if ObjectId.is_valid(collection_id) else collection_id, "deletedAt": None}) if collection_id else None
            if existing:
                created.append(existing); continue
            product_id, farmer_id = str(stop.get("productId") or ""), str(stop.get("farmerId") or "")
            if not ObjectId.is_valid(product_id) or not ObjectId.is_valid(farmer_id):
                continue
            qty = float(stop.get("actualQuantity") if stop.get("actualQuantity") is not None else stop.get("quantity") or 0)
            if qty <= 0: continue
            incoming_id = await incoming_stock_repository.create_incoming({
                "warehouseId": ObjectId(str(route["warehouseId"])), "productId": ObjectId(product_id),
                "variantId": ObjectId(str(stop["variantId"])) if ObjectId.is_valid(str(stop.get("variantId") or "")) else None,
                "farmerId": ObjectId(farmer_id), "orderId": ObjectId(str(stop["orderId"])) if ObjectId.is_valid(str(stop.get("orderId") or "")) else None,
                "quantity": int(qty), "expectedDate": datetime.utcnow(), "batchNumber": stop.get("batchNumber"),
                "qualityGrade": stop.get("qualityGrade"), "storageType": stop.get("storageType") or "ambient",
                "pickupRouteId": ObjectId(route_id), "collectionId": ObjectId(collection_id) if ObjectId.is_valid(collection_id) else collection_id,
                "sourceMode": "warehouse_pickup_route", "packingRequired": True,
            })
            if incoming_id:
                row = await incoming_stock_repository.get_by_id(incoming_id)
                if row: created.append(row)
        if created:
            await warehouse_pickup_route_repository.update_route(route_id, {"status": "arrived_warehouse", "warehouseArrivalAt": datetime.utcnow(), "incomingStockIds": [x["_id"] for x in created if x.get("_id")]})
        return created

    @staticmethod
    async def _sync_pickup_route_handoff(incoming: Dict[str, Any]) -> None:
        route_id = incoming.get("pickupRouteId")
        if not route_id: return
        try:
            rows = await incoming_stock_repository.get_by_route(str(route_id))
            statuses = {str(x.get("status")) for x in rows}
            if rows and statuses.issubset({"stored"}):
                await warehouse_pickup_route_repository.update_route(str(route_id), {"status": "stored", "storedAt": datetime.utcnow()})
            elif rows and statuses.issubset({"received", "stored"}):
                await warehouse_pickup_route_repository.update_route(str(route_id), {"status": "received", "receivedAt": datetime.utcnow()})
        except Exception:
            logger.exception("Failed to synchronize pickup route warehouse handoff")

    @staticmethod
    async def receive_incoming(
        incoming_id: str,
        quantity: int,
        quality_check: str,
        notes: Optional[str] = None,
        warehouse_id: Optional[str] = None,
        usable_quantity: Optional[float] = None,
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

        usable_quantity = float(quantity if usable_quantity is None else usable_quantity)
        if usable_quantity > float(quantity):
            return None
        success = await incoming_stock_repository.receive_stock(
            incoming_id,
            quantity,
            quality_check,
            notes,
            usable_quantity=usable_quantity,
        )
        if not success:
            return None

        # Receive records the physical receipt only. Inventory is committed by Store.\n
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

        await WarehouseService._sync_pickup_route_handoff(incoming)

        # Outgoing work is intentionally created after the explicit Store step.
        return await incoming_stock_repository.get_by_id(incoming_id)

    @staticmethod
    async def store_incoming(incoming_id: str, warehouse_id: str) -> Optional[Dict[str, Any]]:
        incoming = await incoming_stock_repository.get_by_id(incoming_id)
        if not incoming or str(incoming.get("warehouseId")) != str(warehouse_id):
            return None
        if str(incoming.get("status")) != "received" or str(incoming.get("qualityCheck")) != "passed":
            return None
        if incoming.get("inventoryPostedAt"):
            return await incoming_stock_repository.get_by_id(incoming_id)

        # Store is the single point where physically received stock becomes
        # warehouse inventory. This keeps Receive and Store auditable and
        # prevents double-counting if the operator retries the action.
        usable = float(incoming.get("usableQuantity") or 0)
        if usable <= 0:
            return None
        warehouse = await warehouse_repository.get_by_id(warehouse_id)
        if not warehouse:
            return None
        await warehouse_repository.sync_capacity_usage(warehouse_id)
        warehouse = await warehouse_repository.get_by_id(warehouse_id)
        current_used = float(warehouse.get("usedCapacity", 0) or 0)
        total_capacity = float(warehouse.get("totalCapacity", 0) or 0)
        if total_capacity > 0 and current_used + usable > total_capacity:
            return None
        stock_filter = {
            "warehouseId": ObjectId(warehouse_id),
            "productId": ObjectId(str(incoming["productId"])),
            "variantId": ObjectId(str(incoming["variantId"])) if incoming.get("variantId") else None,
            "deletedAt": None,
        }
        existing_stock = await warehouse_stock_repository.find_one(stock_filter)
        stock_data = {
            "warehouseId": ObjectId(warehouse_id),
            "productId": ObjectId(str(incoming["productId"])),
            "variantId": ObjectId(str(incoming["variantId"])) if incoming.get("variantId") else None,
            "quantity": int(usable),
            "batchNumber": incoming.get("batchNumber"),
            "storageType": incoming.get("storageType", "ambient"),
        }
        if existing_stock:
            await warehouse_stock_repository.update_stock(
                str(existing_stock["_id"]),
                {"quantity": int(existing_stock.get("quantity", 0)) + int(usable)},
            )
        else:
            if not await warehouse_stock_repository.create_stock(stock_data):
                return None

        updated = await incoming_stock_repository.update(
            {"_id": incoming["_id"]},
            {"status": "stored", "storedAt": datetime.utcnow(), "inventoryPostedAt": datetime.utcnow(), "updatedAt": datetime.utcnow()},
        )
        if not updated:
            return None

        await WarehouseService._sync_pickup_route_handoff(await incoming_stock_repository.get_by_id(incoming_id) or incoming)

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
        """Synchronize one complete customer-order packing task with usable stock.

        Partial usable stock is packable immediately. Only the unresolved
        quantity remains a shortage. The task is never created line-by-line,
        so the final dispatch audit can still prove every customer-order line.
        """
        from app.repositories.order_repository import order_repository
        from app.repositories.warehouse_packing_repository import warehouse_packing_repository
        from app.repositories.warehouse_shortage_repository import warehouse_shortage_repository

        order = await order_repository.get_by_id(order_id)
        if not order or str(order.get("fulfillmentMethod") or "") != "warehouse":
            return None

        incoming = await incoming_stock_repository.find_many({
            "orderId": ObjectId(order_id),
            "warehouseId": ObjectId(warehouse_id),
            "packingRequired": True,
            "deletedAt": None,
        }, skip=0, limit=1000)

        usable_by_key: Dict[tuple, float] = {}
        for row in incoming:
            if str(row.get("qualityCheck") or "") != "passed":
                continue
            key = (str(row.get("productId")), str(row.get("variantId") or ""))
            usable = float(
                row.get("usableQuantity")
                if row.get("usableQuantity") is not None
                else row.get("quantityReceived") or 0
            )
            usable_by_key[key] = usable_by_key.get(key, 0.0) + max(0.0, usable)

        existing = await warehouse_packing_repository.get_by_order(order_id)
        existing_items = (existing or {}).get("packingItems") or []
        existing_by_key = {str(x.get("itemKey")): x for x in existing_items}

        packing_items = []
        shortages = []
        for item in order.get("items") or []:
            key = (str(item.get("productId")), str(item.get("variantId") or ""))
            item_key = f"{key[0]}:{key[1]}"
            required = float(item.get("quantity") or 0)
            available = min(required, max(0.0, usable_by_key.get(key, 0.0)))
            short = max(0.0, required - available)
            old = existing_by_key.get(item_key) or {}
            packed = min(
                required,
                max(0.0, float(old.get("packedQuantity") or 0)),
            )
            packing_items.append({
                "itemKey": item_key,
                "productId": key[0],
                "variantId": key[1] or None,
                "productName": item.get("productName") or "Product",
                "quantityRequired": required,
                "quantityAvailable": available,
                "quantityShort": short,
                "packedQuantity": packed,
                "unit": item.get("unit") or "kg",
                "verified": bool(old.get("verified")) if short <= 1e-9 else False,
            })
            if short > 1e-9:
                shortages.append({
                    "productId": key[0],
                    "variantId": key[1] or None,
                    "required": required,
                    "available": available,
                    "shortage": short,
                })

        # Do not create a business shortage during allocation. Inventory availability
        # is only a planning signal. The authoritative shortage is created after
        # the packing team records actual packed quantities.
        total_required = sum(x["quantityRequired"] for x in packing_items)
        total_available = sum(x["quantityAvailable"] for x in packing_items)
        total_packed = sum(x["packedQuantity"] for x in packing_items)
        # No final shortage exists until actual packing is completed.
        has_shortage = False
        has_packable_stock = total_available > 1e-9

        if existing:
            task_updates = {
                "packingItems": packing_items,
                "quantityRequired": total_required,
                "packedQuantity": total_packed,
                "status": (
                    "ready_for_packing"
                    if has_packable_stock and total_packed + 1e-9 < total_required
                    else ("packed" if total_packed + 1e-9 >= total_required else "ready_for_packing")
                ),
            }
            await warehouse_packing_repository.update_task(str(existing["_id"]), task_updates)
            task = await warehouse_packing_repository.get_by_id(str(existing["_id"]))
        else:
            first = packing_items[0] if packing_items else {}
            task_id = await warehouse_packing_repository.create_task({
                "warehouseId": ObjectId(warehouse_id),
                "orderId": ObjectId(order_id),
                "farmerId": ObjectId(str(order.get("farmerId"))),
                "productId": ObjectId(first["productId"]) if first.get("productId") else None,
                "variantId": ObjectId(first["variantId"]) if first.get("variantId") else None,
                "quantityRequired": total_required,
                "packedQuantity": total_packed,
                "packingItems": packing_items,
                "orderPacking": True,
                "status": "ready_for_packing",
                "packingResponsibility": "warehouse",
            })
            task = await warehouse_packing_repository.get_by_id(str(task_id)) if task_id else None

        stage = "ready_for_packing"
        await order_repository.update({"_id": ObjectId(order_id)}, {
            "warehouseFulfillmentStage": stage,
            "packingReadiness": {
                "complete": not has_shortage,
                "partial": has_shortage and has_packable_stock,
                "missingItems": [],
                "shortagePending": has_shortage,
                "totalRequired": total_required,
                "totalAvailable": total_available,
                "totalPacked": total_packed,
            },
            "packingTaskId": task.get("_id") if task else None,
            "shortageResolutionRequired": has_shortage,
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
            # The order workflow notifier informs customer/farmer/delivery after
            # the warehouse has actually completed the physical dispatch.
            try:
                updated_order = await order_repository.get_by_id(str(outgoing.get("orderId"))) if outgoing.get("orderId") else None
                if updated_order:
                    await NotificationService.send_order_workflow_update(
                        updated_order,
                        status="ready_for_delivery",
                        stage="dispatched",
                        title=f"Order #{updated_order.get('orderNumber') or outgoing.get('orderId')}: dispatched from warehouse",
                        message="The warehouse has dispatched the customer package. Delivery processing can continue.",
                        actor_role="warehouse",
                    )
            except Exception:
                logger.exception("Failed to send warehouse dispatch workflow notification")
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
                        updated_order = await order_repository.get_by_id(str(order["_id"]))
                        if updated_order:
                            await NotificationService.send_order_workflow_update(
                                updated_order,
                                status="ready_for_delivery",
                                stage="dispatched",
                                title=f"Order #{updated_order.get('orderNumber') or order['_id']}: warehouse dispatch complete",
                                message="Your order has left the warehouse and is ready for delivery routing.",
                                actor_role="warehouse",
                            )
                    except Exception:
                        logger.exception("Failed to notify roles after warehouse dispatch")
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
