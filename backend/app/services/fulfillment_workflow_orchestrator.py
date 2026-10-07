"""Cross-role fulfillment reconciliation and communication.

This service is deliberately read/reconcile driven. Domain endpoints remain the
authority for business mutations; the reconciler makes sure that every completed
mutation is reflected consistently in the order, tracking timeline, notification
queue and next-role queue.

It is safe to run repeatedly. Workflow notification keys are stored on the order
so the same operational event is not notified twice.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional

from bson import ObjectId

from app.database.mongodb import MongoDB
from app.repositories.order_repository import order_repository
from app.repositories.warehouse_repository import warehouse_repository
from app.services.notification_service import NotificationService
from app.schemas.notification import NotificationPriority, NotificationType

logger = logging.getLogger(__name__)

ACTIVE_ORDER_STATUSES = {
    "pending",
    "confirmed",
    "processing",
    "ready_for_delivery",
    "ready_for_pickup",
    "transfer_pending",
    "dispatched",
    "in_transit",
    "out_for_delivery",
    "picked_up",
}

FARMER_FULFILLMENT_MULTI = (
    "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner"
)
FARMER_FULFILLMENT_SINGLE = (
    "farmer_to_warehouse_to_local_hub_to_delivery_partner"
)


def _oid(value: Any) -> Optional[ObjectId]:
    try:
        oid = ObjectId(str(value))
        return oid
    except Exception:
        return None


def _as_id(value: Any) -> str:
    return str(value) if value is not None else ""


def _allocation_key(row: Dict[str, Any]) -> tuple[str, str, str]:
    return (
        _as_id(row.get("warehouseId")),
        _as_id(row.get("productId")),
        _as_id(row.get("variantId")),
    )


class FulfillmentWorkflowOrchestrator:
    """Synchronize cross-role workflow state for active orders."""

    @staticmethod
    async def _emit_once(
        order: Dict[str, Any],
        event_key: str,
        event_type: str,
        title: str,
        message: str,
        *,
        actor_role: str = "system",
        metadata: Optional[Dict[str, Any]] = None,
        notify_user_ids: Optional[Iterable[str]] = None,
        priority: NotificationPriority = NotificationPriority.HIGH,
    ) -> bool:
        oid = order.get("_id")
        if not oid:
            return False

        # Atomic compare-and-set. Only the first reconciler that adds the key
        # performs the side effects.
        result = await MongoDB.get_collection("orders").update_one(
            {"_id": oid, "workflowEventKeys": {"$ne": event_key}},
            {"$addToSet": {"workflowEventKeys": event_key}, "$set": {"updatedAt": datetime.utcnow()}},
        )
        if result.modified_count != 1:
            return False

        try:
            await order_repository.append_tracking_event(
                str(oid),
                event_type,
                title,
                message,
                actor_role=actor_role,
                metadata=metadata or {},
            )
        except Exception:
            logger.exception("Workflow tracking event failed: %s", event_key)

        for user_id in dict.fromkeys(str(x) for x in (notify_user_ids or []) if x):
            try:
                await NotificationService.create_in_app_notification(
                    user_id=user_id,
                    type=NotificationType.SYSTEM,
                    title=title,
                    message=message,
                    data={
                        "type": "fulfillment_workflow",
                        "event": event_type,
                        "eventKey": event_key,
                        "orderId": str(oid),
                        "orderNumber": order.get("orderNumber"),
                        **(metadata or {}),
                    },
                    priority=priority,
                    mandatory=True,
                )
            except Exception:
                logger.exception("Workflow notification failed for %s -> %s", event_key, user_id)
        return True

    @staticmethod
    async def _warehouse_manager_ids(warehouse_ids: Iterable[Any]) -> List[str]:
        result: List[str] = []
        for wid in dict.fromkeys(_as_id(x) for x in warehouse_ids if x):
            if not _oid(wid):
                continue
            warehouse = await warehouse_repository.get_by_id(wid)
            if warehouse and warehouse.get("managerId"):
                result.append(str(warehouse["managerId"]))
        return result

    @staticmethod
    async def _sync_multi_warehouse(order: Dict[str, Any]) -> Dict[str, Any]:
        oid = order["_id"]
        incoming_collection = MongoDB.get_collection("incoming_stock")
        incoming = await incoming_collection.find(
            {
                "orderId": oid,
                "sourceMode": "farmer_fulfillment_transfer",
                "deletedAt": None,
            }
        ).to_list(length=1000)

        allocations = order.get("warehouseAllocations") or []
        expected: Dict[tuple[str, str, str], float] = {}
        for allocation in allocations:
            key = _allocation_key(allocation)
            expected[key] = expected.get(key, 0.0) + float(allocation.get("quantity") or 0)

        received: Dict[tuple[str, str, str], float] = {}
        stored_rows = 0
        for row in incoming:
            key = _allocation_key(row)
            if str(row.get("status") or "") != "stored":
                continue
            qty = row.get("usableQuantity")
            if qty is None:
                qty = row.get("quantityReceived")
            if qty is None:
                qty = row.get("quantity")
            received[key] = received.get(key, 0.0) + max(0.0, float(qty or 0))
            stored_rows += 1

        missing = []
        for key, required in expected.items():
            if received.get(key, 0.0) + 1e-9 < required:
                missing.append({
                    "warehouseId": key[0],
                    "productId": key[1],
                    "variantId": key[2] or None,
                    "required": required,
                    "stored": received.get(key, 0.0),
                })

        all_stored = bool(expected) and not missing and stored_rows >= len(expected)
        # A source receipt being stored is not enough for consolidation. Every
        # warehouse portion must also be dispatched and physically received by
        # the consolidation warehouse.
        transfer_legs = await MongoDB.get_collection("farmer_fulfillment_transfer_legs").find({
            "orderId": oid,
            "legType": "warehouse_to_consolidation",
            "deletedAt": None,
        }).to_list(length=1000)
        all_legs_received = bool(expected) and bool(transfer_legs) and all(
            str(x.get("status") or "") == "received_at_consolidation" for x in transfer_legs
        )
        consolidation_ready = all_stored and all_legs_received
        current = str(order.get("warehouseFulfillmentStage") or "")
        consolidation_status = str(order.get("consolidationStatus") or "")

        if consolidation_ready and consolidation_status not in {
            "consolidated",
            "hub_handoff_pending",
            "local_hub_ready",
            "partner_pending",
        }:
            stage = "ready_for_consolidation"
            status = "ready_for_consolidation"
        elif incoming and stored_rows:
            stage = "partial_received"
            status = "partial"
        elif incoming:
            stage = "received_transfer"
            status = "collecting_from_warehouses"
        else:
            stage = current or "awaiting_warehouse_receipt"
            status = consolidation_status or "collecting_from_warehouses"

        updates: Dict[str, Any] = {
            "warehouseFulfillmentStage": stage,
            "consolidationStatus": status,
            "warehouseTransferSummary": {
                "expectedPortions": len(expected),
                "receivedRows": len(incoming),
                "storedRows": stored_rows,
                "allStored": all_stored,
                "allConsolidationLegsReceived": all_legs_received,
                "missingPortions": missing,
                "updatedAt": datetime.utcnow(),
            },
            "updatedAt": datetime.utcnow(),
        }
        await MongoDB.get_collection("orders").update_one({"_id": oid}, {"$set": updates})

        warehouse_ids = [x.get("warehouseId") for x in allocations if x.get("warehouseId")]
        managers = await FulfillmentWorkflowOrchestrator._warehouse_manager_ids(warehouse_ids)
        farmer_id = _as_id(order.get("farmerId"))

        if consolidation_ready:
            await FulfillmentWorkflowOrchestrator._emit_once(
                order,
                f"multi:{oid}:all-warehouses-stored",
                "farmer_fulfillment_all_warehouses_stored",
                "All warehouse portions are ready for consolidation",
                f"All warehouse portions for order {order.get('orderNumber', str(oid))} have been received, verified and stored. Complete consolidation before the local-hub handoff.",
                metadata={
                    "warehouseCount": len(set(_as_id(x) for x in warehouse_ids)),
                    "nextAction": "complete_consolidation",
                },
                notify_user_ids=[*managers, farmer_id, _as_id(order.get("customerId"))],
            )
        elif incoming:
            await FulfillmentWorkflowOrchestrator._emit_once(
                order,
                f"multi:{oid}:partial-receipt",
                "farmer_fulfillment_partial_receipt",
                "Farmer-packed shipment partially received",
                f"Order {order.get('orderNumber', str(oid))} has partial warehouse receipts. Remaining warehouse portions are still pending.",
                metadata={"receivedRows": len(incoming), "storedRows": stored_rows},
                notify_user_ids=[farmer_id, _as_id(order.get("customerId"))],
            )

        return {
            "mode": "multi",
            "stage": stage,
            "consolidationStatus": status,
            "allStored": all_stored,
            "missing": missing,
        }

    @staticmethod
    async def _sync_single_warehouse(order: Dict[str, Any]) -> Dict[str, Any]:
        oid = order["_id"]
        incoming = await MongoDB.get_collection("incoming_stock").find(
            {
                "orderId": oid,
                "sourceMode": "farmer_fulfillment_transfer",
                "deletedAt": None,
            }
        ).to_list(length=1000)

        stored = [x for x in incoming if str(x.get("status") or "") == "stored"]
        warehouse_id = order.get("warehouseId")
        managers = await FulfillmentWorkflowOrchestrator._warehouse_manager_ids([warehouse_id])
        farmer_id = _as_id(order.get("farmerId"))

        if stored:
            await MongoDB.get_collection("orders").update_one(
                {"_id": oid},
                {"$set": {
                    "warehouseFulfillmentStage": "ready_for_dispatch",
                    "transferStatus": "ready_for_dispatch",
                    "updatedAt": datetime.utcnow(),
                }},
            )
            await FulfillmentWorkflowOrchestrator._emit_once(
                order,
                f"single:{oid}:stored-ready-for-dispatch",
                "farmer_fulfillment_stored",
                "Farmer-packed order stored at warehouse",
                f"Order {order.get('orderNumber', str(oid))} is received, verified and stored. It is ready for the warehouse-to-local-hub handoff.",
                metadata={"nextAction": "handoff_to_local_hub"},
                notify_user_ids=[farmer_id, *managers],
            )
        elif incoming:
            await FulfillmentWorkflowOrchestrator._emit_once(
                order,
                f"single:{oid}:received",
                "farmer_fulfillment_received",
                "Farmer-packed order received at warehouse",
                f"Warehouse has received order {order.get('orderNumber', str(oid))}. Verify and store the sealed farmer package.",
                metadata={"nextAction": "verify_and_store"},
                notify_user_ids=[farmer_id],
            )

        return {
            "mode": "single",
            "stage": str(order.get("warehouseFulfillmentStage") or "awaiting_warehouse_receipt"),
            "stored": len(stored),
        }

    @staticmethod
    async def reconcile_order(order: Dict[str, Any] | str) -> Dict[str, Any]:
        if isinstance(order, str):
            order_doc = await order_repository.get_by_id(order)
        else:
            order_doc = order
        if not order_doc:
            return {"ok": False, "reason": "order_not_found"}

        status = str(order_doc.get("orderStatus") or "").lower()
        if status in {"cancelled", "refunded", "delivered", "completed"}:
            return {"ok": True, "skipped": True, "reason": "closed"}

        logistics_mode = str(order_doc.get("logisticsMode") or "")
        fulfillment_method = str(order_doc.get("fulfillmentMethod") or "").lower()
        fulfillment_source = str(order_doc.get("fulfillmentSource") or "").lower()

        if logistics_mode == FARMER_FULFILLMENT_MULTI:
            return {"ok": True, "data": await FulfillmentWorkflowOrchestrator._sync_multi_warehouse(order_doc)}
        if logistics_mode == FARMER_FULFILLMENT_SINGLE:
            return {"ok": True, "data": await FulfillmentWorkflowOrchestrator._sync_single_warehouse(order_doc)}

        # Normal warehouse fulfillment deliberately stays on the normal
        # customer-order packing pipeline. Never create a farmer-transfer
        # notification/job for it.
        if fulfillment_method == "warehouse" or fulfillment_source == "warehouse":
            return {"ok": True, "data": {"mode": "warehouse_fulfillment", "stage": order_doc.get("warehouseFulfillmentStage")}}

        return {"ok": True, "data": {"mode": "farmer_direct", "stage": order_doc.get("orderStatus")}}

    @staticmethod
    async def reconcile_active_orders(limit: int = 500) -> Dict[str, Any]:
        rows = await MongoDB.get_collection("orders").find(
            {
                "deletedAt": None,
                "orderStatus": {"$in": list(ACTIVE_ORDER_STATUSES)},
                "$or": [
                    {"logisticsMode": {"$in": [FARMER_FULFILLMENT_SINGLE, FARMER_FULFILLMENT_MULTI]}},
                    {"fulfillmentMethod": "warehouse"},
                    {"fulfillmentSource": "warehouse"},
                ],
            },
            {"_id": 1, "orderNumber": 1, "orderStatus": 1, "farmerId": 1, "customerId": 1,
             "fulfillmentMethod": 1, "fulfillmentSource": 1, "logisticsMode": 1,
             "warehouseId": 1, "warehouseIds": 1, "warehouseAllocations": 1,
             "warehouseFulfillmentStage": 1, "consolidationStatus": 1},
        ).sort("updatedAt", -1).limit(limit).to_list(length=limit)

        processed = 0
        failed = 0
        for order in rows:
            try:
                await FulfillmentWorkflowOrchestrator.reconcile_order(order)
                processed += 1
            except Exception:
                failed += 1
                logger.exception("Workflow reconciliation failed for order %s", order.get("_id"))
        return {"processed": processed, "failed": failed, "checkedAt": datetime.utcnow().isoformat()}

    @staticmethod
    async def ensure_indexes() -> None:
        try:
            await MongoDB.get_collection("orders").create_index("workflowEventKeys")
        except Exception:
            logger.exception("Could not create workflow event index")
