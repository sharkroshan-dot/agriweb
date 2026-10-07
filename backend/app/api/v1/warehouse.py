from fastapi import APIRouter, Depends, HTTPException, status, Query
from typing import Any, Dict, List, Optional
from datetime import datetime
from pydantic import BaseModel, Field
from bson import ObjectId
from app.database.mongodb import MongoDB
from app.api.v1.auth import get_current_user
from app.repositories.warehouse_repository import warehouse_repository
from app.repositories.order_repository import order_repository
from app.repositories.outgoing_stock_repository import outgoing_stock_repository
from app.repositories.incoming_stock_repository import incoming_stock_repository
from app.schemas.warehouse import (
    WarehouseResponse, WarehouseCreate, WarehouseUpdate,
    WarehouseStockResponse, WarehouseStockCreate, WarehouseStockUpdate,
    IncomingStockResponse, IncomingStockCreate,
    OutgoingStockResponse, OutgoingStockCreate, OutgoingStockUpdate,
    ColdStorageResponse, ColdStorageCreate, ColdStorageUpdate,
    WarehouseTransferResponse, WarehouseTransferCreate,
    WarehouseDashboardResponse
)
from app.services.warehouse_service import WarehouseService
from app.services.user_service import UserService
from app.services.logistics_routing_service import apply_partner_route
from app.services.delivery_job_service import build_job_document, build_warehouse_pickup_job, eligible_partners_for_job, job_weight_kg, JOB_DEFAULT_EXPIRY_MINUTES
from app.repositories.delivery_job_repository import delivery_job_repository, JOB_OPEN
from app.repositories.warehouse_packing_repository import warehouse_packing_repository
from app.schemas.warehouse_packing import PackingTeamAssignment, PackingCompleteRequest, PackingVerifyRequest
from app.repositories.warehouse_collection_repository import warehouse_collection_repository
from app.services.warehouse_collection_service import serialize_collection
from app.repositories.warehouse_pickup_team_repository import warehouse_pickup_team_repository
from app.repositories.warehouse_pickup_route_repository import warehouse_pickup_route_repository
from app.services.warehouse_pickup_route_service import build_smart_routes, serialize_route, assign_route
from app.services.notification_service import NotificationService
from app.schemas.notification import NotificationPriority, NotificationType
import logging

logger = logging.getLogger(__name__)
class WarehouseReceiveRequest(BaseModel):
    quantity: int = Field(..., gt=0)
    usableQuantity: Optional[float] = Field(None, ge=0)
    qualityCheck: str = Field(..., pattern="^(pending|passed|failed)$")
    notes: Optional[str] = None


class WarehouseDeliveryRouteRequest(BaseModel):
    route: str = Field(..., pattern="^(nearby|long_distance)$")
    radius: int = Field(10, ge=1, le=200)


class WarehouseFarmerReturnRequest(BaseModel):
    reason: str = Field(..., min_length=3, max_length=500)
    notes: Optional[str] = Field(None, max_length=1000)
    quantity: Optional[float] = Field(None, gt=0)


router = APIRouter()

@router.get("/me", response_model=WarehouseResponse)
async def get_my_warehouse(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can access this endpoint"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found for this user"
        )
    warehouse["id"] = str(warehouse["_id"])
    return warehouse

@router.get("/me/dashboard", response_model=WarehouseDashboardResponse)
async def get_my_dashboard(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can access this endpoint"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    dashboard = await WarehouseService.get_warehouse_dashboard(str(warehouse["_id"]))
    return dashboard


# ---------------------------------------------------------------------------
# Warehouse fulfillment control plane
# ---------------------------------------------------------------------------

@router.get("/me/workflow")
async def get_warehouse_workflow(current_user: dict = Depends(get_current_user)):
    """Return one authoritative snapshot of every warehouse fulfillment stage."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can access warehouse workflow")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    wid = ObjectId(str(warehouse["_id"]))
    active_order_filter = {
        "warehouseId": wid,
        "fulfillmentMethod": "warehouse",
        "deletedAt": None,
        "orderStatus": {"$nin": ["delivered", "completed", "cancelled", "refunded"]},
    }
    orders = await order_repository.find_many(active_order_filter, skip=0, limit=1000, sort=[("orderDate", -1), ("createdAt", -1)])
    incoming = await WarehouseService.get_incoming_stock(str(warehouse["_id"]), None, 0, 1000)
    collections = await warehouse_collection_repository.get_by_warehouse(str(warehouse["_id"]), None)
    packing = await warehouse_packing_repository.get_by_warehouse(str(warehouse["_id"]), None)
    outgoing = await WarehouseService.get_outgoing_stock(str(warehouse["_id"]), None, 0, 1000)
    from app.repositories.warehouse_shortage_repository import warehouse_shortage_repository
    shortages = await warehouse_shortage_repository.get_by_warehouse(str(warehouse["_id"]), None, limit=1000)

    stage_counts: Dict[str, int] = {}
    for order in orders:
        stage = str(order.get("warehouseFulfillmentStage") or "awaiting_farmer_confirmation")
        stage_counts[stage] = stage_counts.get(stage, 0) + 1

    return {
        "success": True,
        "data": {
            "warehouse": {
                "id": str(warehouse["_id"]),
                "name": warehouse.get("name") or warehouse.get("warehouseName"),
                "totalCapacity": warehouse.get("totalCapacity", 0),
                "usedCapacity": warehouse.get("usedCapacity", 0),
            },
            "counts": {
                "orders": len(orders),
                "collections": len(collections),
                "incoming": len(incoming[0]),
                "packing": len(packing),
                "outgoing": len(outgoing[0]),
                "shortages": len([x for x in shortages if x.get("status") not in ("resolved", "cancelled")]),
            },
            "stages": stage_counts,
        },
    }


@router.get("/me/farmer-fulfillment-transfers")
async def get_farmer_fulfillment_transfers(
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user: dict = Depends(get_current_user),
):
    """Packed farmer-fulfillment transfers routed through this warehouse.

    These shipments are already packed and verified by the farmer. Warehouse
    staff must never create a second packing task for them.
    """
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can access farmer fulfillment transfers")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    query: Dict[str, Any] = {
        "$or": [
            {"warehouseId": ObjectId(str(warehouse["_id"]))},
            {"warehouseIds": ObjectId(str(warehouse["_id"]))},
        ],
        "logisticsMode": {"$in": [
            "farmer_to_warehouse_to_local_hub_to_delivery_partner",
            "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner",
        ]},
        "deletedAt": None,
        "orderStatus": {"$nin": ["delivered", "completed", "cancelled", "refunded"]},
    }
    if status_filter:
        query["warehouseFulfillmentStage"] = status_filter

    orders = await order_repository.find_many(
        query, skip=0, limit=200,
        sort=[("orderDate", -1), ("createdAt", -1), ("updatedAt", -1), ("_id", -1)],
    )
    result = []
    for order in orders:
        outgoing = await outgoing_stock_repository.find_many({
            "orderId": order["_id"],
            "warehouseId": ObjectId(str(warehouse["_id"])),
            "deletedAt": None,
        }, skip=0, limit=1000)
        incoming = await incoming_stock_repository.find_many({
            "orderId": order["_id"],
            "warehouseId": ObjectId(str(warehouse["_id"])),
            "deletedAt": None,
        }, skip=0, limit=1000)
        result.append({
            "id": str(order["_id"]),
            "orderNumber": order.get("orderNumber"),
            "orderStatus": order.get("orderStatus"),
            "stage": order.get("warehouseFulfillmentStage") or "awaiting_farmer_confirmation",
            "warehouseId": str(warehouse["_id"]),
            "warehouseName": warehouse.get("name") or warehouse.get("warehouseName"),
            "farmerId": str(order["farmerId"]) if order.get("farmerId") else None,
            "farmerName": order.get("farmerName"),
            "deliveryAddress": order.get("deliveryAddress") or {},
            "items": [{
                "productId": str(x.get("productId")),
                "variantId": str(x.get("variantId")) if x.get("variantId") else None,
                "productName": x.get("productName") or "Product",
                "quantity": float(x.get("quantity") or 0),
                "unit": x.get("unit") or "kg",
            } for x in (order.get("items") or [])],
            "incoming": [{
                "id": str(x["_id"]),
                "status": x.get("status"),
                "expectedQuantity": float(x.get("quantity") or 0),
                "receivedQuantity": float(x.get("quantityReceived") or 0),
                "qualityCheck": x.get("qualityCheck"),
                "packingRequired": bool(x.get("packingRequired", True)),
            } for x in incoming],
            "outgoing": [{
                "id": str(x["_id"]),
                "status": x.get("status"),
                "quantity": float(x.get("quantity") or 0),
                "deliveryPartnerRoute": x.get("deliveryPartnerRoute"),
                "dispatchDate": x.get("dispatchDate"),
            } for x in outgoing],
        })
    return {"success": True, "data": {"transfers": result}}



@router.get("/me/farmer-fulfillment-consolidations")
async def get_farmer_fulfillment_consolidations(current_user: dict = Depends(get_current_user)):
    """Show multi-warehouse farmer-packed orders awaiting consolidation/handoff."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can access farmer fulfillment consolidation")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    orders = await order_repository.find_many({
        "logisticsMode": "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner",
        "$or": [
            {"warehouseId": ObjectId(str(warehouse["_id"]))},
            {"warehouseIds": ObjectId(str(warehouse["_id"]))},
        ],
        "deletedAt": None,
        "orderStatus": {"$nin": ["cancelled", "refunded", "delivered", "completed"]},
    }, skip=0, limit=200, sort=[("updatedAt", -1)])

    consolidation_collection = MongoDB.get_collection("farmer_fulfillment_consolidations")
    result = []
    for order in orders:
        cid = order.get("consolidationId")
        consolidation = await consolidation_collection.find_one({"_id": cid, "deletedAt": None}) if cid else None
        incoming = await incoming_stock_repository.find_many({
            "orderId": order["_id"],
            "sourceMode": "farmer_fulfillment_transfer",
            "deletedAt": None,
        }, skip=0, limit=1000)
        stored = [x for x in incoming if str(x.get("status")) == "stored"]
        result.append({
            "orderId": str(order["_id"]),
            "orderNumber": order.get("orderNumber"),
            "warehouseIds": [str(x) for x in (order.get("warehouseIds") or [])],
            "warehouseCount": int(order.get("warehouseCount") or len(order.get("warehouseIds") or [])),
            "allocations": order.get("warehouseAllocations") or [],
            "consolidationId": str(cid) if cid else None,
            "consolidationWarehouseId": str(order.get("consolidationWarehouseId")) if order.get("consolidationWarehouseId") else None,
            "consolidationWarehouseName": order.get("consolidationWarehouseName"),
            "consolidationStatus": order.get("consolidationStatus") or (consolidation or {}).get("status"),
            "localHub": order.get("nearbyFulfillmentLocation"),
            "transferStatus": order.get("transferStatus"),
            "logisticsMode": order.get("logisticsMode"),
            "warehouseCount": int(order.get("warehouseCount") or 1),
            "incomingCount": len(incoming),
            "storedCount": len(stored),
            "allWarehousesReceived": bool(incoming) and len(stored) == len(incoming),
            "allConsolidationLegsReceived": (
                len(await MongoDB.get_collection("farmer_fulfillment_transfer_legs").find({
                    "orderId": order["_id"],
                    "legType": "warehouse_to_consolidation",
                    "deletedAt": None,
                }).to_list(length=1000)) > 0
                and len(await MongoDB.get_collection("farmer_fulfillment_transfer_legs").find({
                    "orderId": order["_id"],
                    "legType": "warehouse_to_consolidation",
                    "deletedAt": None,
                    "status": "received_at_consolidation",
                }).to_list(length=1000))
                == len(await MongoDB.get_collection("farmer_fulfillment_transfer_legs").find({
                    "orderId": order["_id"],
                    "legType": "warehouse_to_consolidation",
                    "deletedAt": None,
                }).to_list(length=1000))
            ),
            "canDispatchToConsolidation": any(str(a.get("warehouseId")) == str(warehouse["_id"]) for a in (order.get("warehouseAllocations") or [])),
            "isConsolidationWarehouse": str(order.get("consolidationWarehouseId") or "") == str(warehouse["_id"]),
            "deliveryPartnerJobId": order.get("deliveryPartnerJobId"),
        })
    return {"success": True, "data": {"consolidations": result}}



@router.post("/me/farmer-fulfillment/{order_id}/dispatch-to-consolidation")
async def dispatch_farmer_fulfillment_to_consolidation(
    order_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Dispatch one received/stored farmer-packed portion from its source warehouse to the consolidation warehouse."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can dispatch farmer fulfillment transfers")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid order ID")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    order = await order_repository.get_by_id(order_id)
    if not warehouse or not order:
        raise HTTPException(status_code=404, detail="Order or warehouse not found")
    if str(order.get("logisticsMode") or "") != "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner":
        raise HTTPException(status_code=404, detail="Multi-warehouse farmer fulfillment order not found")
    wid = str(warehouse["_id"])
    allocations = [a for a in (order.get("warehouseAllocations") or []) if str(a.get("warehouseId")) == wid]
    if not allocations:
        raise HTTPException(status_code=403, detail="This order has no allocation at your warehouse")

    legs = MongoDB.get_collection("farmer_fulfillment_transfer_legs")
    # A source warehouse may dispatch only after its own incoming records have
    # been physically received, quality-approved and stored.
    source_incoming = await incoming_stock_repository.find_many({
        "orderId": ObjectId(order_id),
        "warehouseId": ObjectId(wid),
        "sourceMode": "farmer_fulfillment_transfer",
        "deletedAt": None,
    }, skip=0, limit=1000)
    if not source_incoming or any(str(x.get("status")) != "stored" for x in source_incoming):
        raise HTTPException(status_code=400, detail="Receive, quality-check and store this farmer-packed portion before dispatching it to consolidation")
    source_legs = await legs.find({
        "orderId": ObjectId(order_id),
        "sourceWarehouseId": ObjectId(wid),
        "legType": "warehouse_to_consolidation",
        "deletedAt": None,
    }).to_list(length=1000)
    if not source_legs:
        raise HTTPException(status_code=404, detail="No consolidation transfer legs found for this warehouse")

    invalid = [x for x in source_legs if str(x.get("status")) not in ("pending", "stored", "received_at_source")]
    if invalid:
        if all(str(x.get("status")) in ("in_transit", "received_at_consolidation") for x in source_legs):
            return {"success": True, "data": {"status": "already_dispatched"}, "message": "This warehouse portion has already been dispatched to consolidation."}
        raise HTTPException(status_code=400, detail="This warehouse portion is not ready for consolidation dispatch")

    now = datetime.utcnow()
    await legs.update_many(
        {"_id": {"$in": [x["_id"] for x in source_legs]}},
        {"$set": {
            "status": "in_transit",
            "dispatchedAt": now,
            "dispatchedBy": ObjectId(str(current_user["_id"])),
            "updatedAt": now,
        }},
    )

    consolidation_id = order.get("consolidationWarehouseId")
    consolidation_manager_id = None
    if consolidation_id:
        consolidation = await warehouse_repository.get_by_id(str(consolidation_id))
        if consolidation and consolidation.get("managerId"):
            consolidation_manager_id = str(consolidation["managerId"])

    await order_repository.append_tracking_event(
        order_id,
        "warehouse_portion_dispatched_to_consolidation",
        "Warehouse portion dispatched to consolidation",
        f"{warehouse.get('name') or 'Warehouse'} dispatched its farmer-packed portion to the consolidation warehouse.",
        actor_id=str(current_user["_id"]),
        actor_role="warehouse",
        metadata={"sourceWarehouseId": wid, "consolidationWarehouseId": str(consolidation_id) if consolidation_id else None},
    )

    refreshed = await order_repository.get_by_id(order_id)
    if refreshed:
        recipients = [str(order.get("farmerId")) if order.get("farmerId") else None, consolidation_manager_id]
        await NotificationService.send_order_workflow_update(
            refreshed,
            stage="warehouse_portion_in_transit",
            title=f"Order #{order.get('orderNumber')}: warehouse portion dispatched",
            message=f"{warehouse.get('name') or 'A warehouse'} dispatched its portion to the consolidation warehouse.",
            actor_role="warehouse",
            priority=NotificationPriority.HIGH,
        )
        for recipient in [x for x in recipients if x and x != str(current_user["_id"])]:
            try:
                await NotificationService.create_in_app_notification(
                    recipient,
                    NotificationType.WAREHOUSE if recipient == consolidation_manager_id else NotificationType.FARMER,
                    f"Order #{order.get('orderNumber')}: portion dispatched to consolidation",
                    f"{warehouse.get('name') or 'Warehouse'} has dispatched its portion to the consolidation warehouse.",
                    {"orderId": order_id, "sourceWarehouseId": wid, "consolidationWarehouseId": str(consolidation_id) if consolidation_id else None},
                    NotificationPriority.HIGH,
                    mandatory=True,
                )
            except Exception:
                logger.exception("Failed to notify consolidation/source dispatch")

    return {
        "success": True,
        "data": {
            "orderId": order_id,
            "sourceWarehouseId": wid,
            "status": "in_transit",
            "legCount": len(source_legs),
        },
        "message": "Warehouse portion dispatched to consolidation.",
    }


@router.post("/me/farmer-fulfillment/{order_id}/receive-at-consolidation")
async def receive_farmer_fulfillment_at_consolidation(
    order_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Receive all in-transit portions belonging to the consolidation warehouse."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can receive consolidation transfers")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid order ID")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    order = await order_repository.get_by_id(order_id)
    if not warehouse or not order:
        raise HTTPException(status_code=404, detail="Order or warehouse not found")
    if str(order.get("logisticsMode") or "") != "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner":
        raise HTTPException(status_code=404, detail="Multi-warehouse farmer fulfillment order not found")
    consolidation_id = str(order.get("consolidationWarehouseId") or "")
    if str(warehouse["_id"]) != consolidation_id:
        raise HTTPException(status_code=403, detail="Only the assigned consolidation warehouse can receive these portions")

    legs = MongoDB.get_collection("farmer_fulfillment_transfer_legs")
    rows = await legs.find({
        "orderId": ObjectId(order_id),
        "destinationWarehouseId": ObjectId(str(warehouse["_id"])),
        "legType": "warehouse_to_consolidation",
        "deletedAt": None,
    }).to_list(length=1000)
    if not rows:
        raise HTTPException(status_code=404, detail="No consolidation transfer legs found")
    pending = [x for x in rows if str(x.get("status")) == "in_transit"]
    if not pending:
        if all(str(x.get("status")) == "received_at_consolidation" for x in rows):
            return {"success": True, "data": {"status": "received", "legCount": len(rows)}, "message": "All consolidation portions are already received."}
        raise HTTPException(status_code=400, detail="No warehouse portions are currently in transit to this consolidation warehouse")

    now = datetime.utcnow()
    await legs.update_many(
        {"_id": {"$in": [x["_id"] for x in pending]}},
        {"$set": {
            "status": "received_at_consolidation",
            "receivedAtConsolidation": now,
            "receivedByConsolidation": ObjectId(str(current_user["_id"])),
            "updatedAt": now,
        }},
    )

    await order_repository.append_tracking_event(
        order_id,
        "consolidation_portions_received",
        "Warehouse portions received at consolidation",
        "The consolidation warehouse received the dispatched farmer-packed portions.",
        actor_id=str(current_user["_id"]),
        actor_role="warehouse",
        metadata={"receivedLegCount": len(pending), "consolidationWarehouseId": str(warehouse["_id"])},
    )
    refreshed = await order_repository.get_by_id(order_id)
    if refreshed:
        await NotificationService.send_order_workflow_update(
            refreshed,
            stage="consolidation_portions_received",
            title=f"Order #{order.get('orderNumber')}: consolidation receipt updated",
            message="The consolidation warehouse received the dispatched farmer-packed portions. Complete consolidation when every portion has arrived.",
            actor_role="warehouse",
            priority=NotificationPriority.HIGH,
        )

    return {
        "success": True,
        "data": {
            "orderId": order_id,
            "status": "received",
            "receivedLegCount": len(pending),
            "totalLegCount": len(rows),
        },
        "message": "Farmer-packed portions received at the consolidation warehouse.",
    }


@router.post("/me/farmer-fulfillment/{order_id}/complete-consolidation")
async def complete_farmer_fulfillment_consolidation(
    order_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Complete consolidation only after every source warehouse has dispatched and the consolidation warehouse has received its portion."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can complete farmer fulfillment consolidation")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid order ID")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    order = await order_repository.get_by_id(order_id)
    if not order or str(order.get("logisticsMode") or "") != "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner":
        raise HTTPException(status_code=404, detail="Multi-warehouse farmer fulfillment order not found")

    consolidation_warehouse_id = str(order.get("consolidationWarehouseId") or "")
    if str(warehouse["_id"]) != consolidation_warehouse_id:
        raise HTTPException(status_code=403, detail="Only the consolidation warehouse can complete this consolidation")

    incoming = await incoming_stock_repository.find_many({
        "orderId": ObjectId(order_id),
        "sourceMode": "farmer_fulfillment_transfer",
        "deletedAt": None,
    }, skip=0, limit=1000)

    expected = {}
    for allocation in order.get("warehouseAllocations") or []:
        key = (str(allocation.get("warehouseId")), str(allocation.get("productId")), str(allocation.get("variantId") or ""))
        expected[key] = expected.get(key, 0.0) + float(allocation.get("quantity") or 0)

    received = {}
    not_stored = []
    for row in incoming:
        key = (str(row.get("warehouseId")), str(row.get("productId")), str(row.get("variantId") or ""))
        if str(row.get("status")) != "stored":
            not_stored.append(row)
            continue
        qty = row.get("usableQuantity")
        if qty is None:
            qty = row.get("quantityReceived")
        if qty is None:
            qty = row.get("quantity")
        received[key] = received.get(key, 0.0) + max(0.0, float(qty or 0))

    missing = [
        {"warehouseId": key[0], "productId": key[1], "variantId": key[2] or None, "required": required, "stored": received.get(key, 0.0)}
        for key, required in expected.items()
        if received.get(key, 0.0) + 1e-9 < required
    ]

    legs = await MongoDB.get_collection("farmer_fulfillment_transfer_legs").find({
        "orderId": ObjectId(order_id),
        "legType": "warehouse_to_consolidation",
        "deletedAt": None,
    }).to_list(length=1000)
    not_received_at_consolidation = [
        x for x in legs if str(x.get("status")) != "received_at_consolidation"
    ]

    if not expected or missing or not_stored or not_received_at_consolidation:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Every warehouse portion must be received, quality-checked, stored at its source warehouse, dispatched, and received at the consolidation warehouse before consolidation.",
                "missingPortions": missing,
                "unstoredReceipts": len(not_stored),
                "pendingConsolidationLegs": len(not_received_at_consolidation),
            },
        )

    consolidation_id = order.get("consolidationId")
    consolidation_collection = MongoDB.get_collection("farmer_fulfillment_consolidations")
    consolidation = await consolidation_collection.find_one({"_id": consolidation_id, "deletedAt": None}) if consolidation_id else None
    if not consolidation:
        raise HTTPException(status_code=400, detail="Consolidation record is missing")

    now = datetime.utcnow()
    await consolidation_collection.update_one(
        {"_id": consolidation["_id"]},
        {"$set": {"status": "consolidated", "consolidatedAt": now, "updatedAt": now}},
    )
    await order_repository.update(
        {"_id": ObjectId(order_id)},
        {
            "consolidationStatus": "consolidated",
            "transferStatus": "consolidated",
            "warehouseFulfillmentStage": "consolidated",
            "updatedAt": now,
        },
    )
    await order_repository.append_tracking_event(
        order_id,
        "farmer_fulfillment_consolidated",
        "Farmer-packed order consolidated",
        "All warehouse portions have arrived at the consolidation warehouse and the original customer order is complete.",
        actor_id=str(current_user["_id"]),
        actor_role="warehouse",
        metadata={"consolidationId": str(consolidation["_id"]), "warehouseCount": len(order.get("warehouseIds") or [])},
    )
    refreshed = await order_repository.get_by_id(order_id)
    if refreshed:
        await NotificationService.send_order_workflow_update(
            refreshed,
            stage="consolidated",
            title=f"Order #{order.get('orderNumber')}: consolidation complete",
            message="All warehouse portions have been received and consolidated. The complete order is ready for the local-hub handoff.",
            actor_role="warehouse",
            priority=NotificationPriority.HIGH,
        )
    return {
        "success": True,
        "data": {"orderId": order_id, "consolidationId": str(consolidation["_id"]), "status": "consolidated", "localHub": order.get("nearbyFulfillmentLocation")},
        "message": "All warehouse portions are consolidated into the complete customer order.",
    }


@router.post("/me/farmer-fulfillment/{order_id}/handoff-local-hub")
async def handoff_farmer_fulfillment_to_local_hub(
    order_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Move the completed consolidated order to its one local hub and open one delivery job."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can hand off farmer fulfillment")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid order ID")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    order = await order_repository.get_by_id(order_id)
    if not order or str(order.get("logisticsMode") or "") != "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner":
        raise HTTPException(status_code=404, detail="Consolidated farmer fulfillment order not found")
    if str(order.get("consolidationStatus")) != "consolidated":
        raise HTTPException(status_code=400, detail="Complete consolidation after all warehouse receipts are stored first")

    hub = order.get("nearbyFulfillmentLocation") or {}
    hub_id = order.get("nearbyFulfillmentLocationId")
    if not hub_id:
        raise HTTPException(status_code=400, detail="No local hub has been selected for this order")

    hub_collection = MongoDB.get_collection("fulfillment_hubs")
    hub_doc = await hub_collection.find_one({"_id": ObjectId(str(hub_id)), "deletedAt": None, "isActive": True, "approvalStatus": "approved"})
    if not hub_doc:
        raise HTTPException(status_code=400, detail="Selected local hub is unavailable")

    transfer_collection = MongoDB.get_collection("farmer_fulfillment_hub_transfers")
    existing_transfer = await transfer_collection.find_one({"orderId": ObjectId(order_id), "deletedAt": None})
    if not existing_transfer:
        existing_transfer = {
            "orderId": ObjectId(order_id),
            "orderNumber": order.get("orderNumber"),
            "consolidationId": order.get("consolidationId"),
            "localHubId": ObjectId(str(hub_id)),
            "localHubName": hub_doc.get("name") or hub_doc.get("hubName") or "Local Fulfillment Hub",
            "status": "in_transit",
            "createdAt": datetime.utcnow(),
            "updatedAt": datetime.utcnow(),
            "deletedAt": None,
        }
        inserted = await transfer_collection.insert_one(existing_transfer)
        existing_transfer["_id"] = inserted.inserted_id
    else:
        await transfer_collection.update_one(
            {"_id": existing_transfer["_id"]},
            {"$set": {"status": "in_transit", "updatedAt": datetime.utcnow()}},
        )

    await order_repository.update(
        {"_id": ObjectId(order_id)},
        {
            "transferStatus": "hub_handoff_pending",
            "consolidationStatus": "hub_handoff_pending",
            "deliveryPickupLocation": {
                "type": "local_hub",
                "id": str(hub_doc["_id"]),
                "name": hub_doc.get("name") or hub_doc.get("hubName") or "Local Fulfillment Hub",
                "address": hub_doc.get("address") or "",
                "coordinates": (hub_doc.get("location") or {}).get("coordinates") or (hub_doc.get("coordinates") or {}).get("coordinates") or [],
            },
            "updatedAt": datetime.utcnow(),
        },
    )

    # The physical hub transfer is one manifest for the complete order. The
    # delivery marketplace job is intentionally created only after the local
    # hub confirms receipt, so the partner never gets sent to an unreceived load.
    return {"success": True, "data": {"orderId": order_id, "status": "in_transit", "localHub": order.get("nearbyFulfillmentLocation")}, "message": "Complete order transferred to the local hub. Waiting for hub receipt."}


@router.post("/me/farmer-fulfillment/{order_id}/receive-local-hub")
async def receive_farmer_fulfillment_at_local_hub(
    order_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Confirm the complete order arrived at the local hub, then open exactly one final job."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can receive farmer fulfillment at the local hub")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid order ID")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    order = await order_repository.get_by_id(order_id)
    if not order or str(order.get("logisticsMode") or "") != "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner":
        raise HTTPException(status_code=404, detail="Farmer fulfillment consolidation not found")
    if str(order.get("consolidationStatus")) not in ("hub_handoff_pending", "local_hub_ready"):
        raise HTTPException(status_code=400, detail="Complete consolidation and local-hub handoff first")

    hub_id = order.get("nearbyFulfillmentLocationId")
    if not hub_id:
        raise HTTPException(status_code=400, detail="Local hub is not assigned")
    hub_doc = await MongoDB.get_collection("fulfillment_hubs").find_one({
        "_id": ObjectId(str(hub_id)),
        "deletedAt": None,
        "isActive": True,
        "approvalStatus": "approved",
    })
    if not hub_doc:
        raise HTTPException(status_code=400, detail="Local hub is unavailable")

    transfer_collection = MongoDB.get_collection("farmer_fulfillment_hub_transfers")
    transfer = await transfer_collection.find_one({"orderId": ObjectId(order_id), "deletedAt": None})
    if not transfer:
        raise HTTPException(status_code=400, detail="Local hub transfer manifest does not exist")
    await transfer_collection.update_one(
        {"_id": transfer["_id"]},
        {"$set": {"status": "received", "receivedAt": datetime.utcnow(), "updatedAt": datetime.utcnow()}},
    )
    await order_repository.update(
        {"_id": ObjectId(order_id)},
        {"transferStatus": "local_hub_ready", "consolidationStatus": "local_hub_ready", "updatedAt": datetime.utcnow()},
    )
    job = await _create_single_farmer_fulfillment_delivery_job(order_id, hub_doc, current_user)
    return {"success": True, "data": job, "message": "Local hub received the complete order. One final delivery partner job is now open."}


async def _create_single_farmer_fulfillment_delivery_job(order_id: str, hub_doc: dict, current_user: dict) -> dict:
    order = await order_repository.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    existing = await delivery_job_repository.get_by_order_id(order_id)
    if existing and existing.get("status") in ("open", "accepted", "assigned", "picked_up", "in_transit"):
        return {"jobId": str(existing["_id"]), "status": existing.get("status"), "existing": True}

    address = order.get("deliveryAddress") or {}
    destination = address.get("location") or address.get("deliveryLocation") or {}
    coords = destination.get("coordinates") if isinstance(destination, dict) else None
    if not coords:
        lat = address.get("lat", address.get("latitude"))
        lng = address.get("lng", address.get("longitude"))
        if lat is not None and lng is not None:
            coords = [float(lng), float(lat)]
    if not coords or len(coords) < 2:
        raise HTTPException(status_code=400, detail="Customer delivery coordinates are required before final delivery assignment")

    hub_location = hub_doc.get("location") or hub_doc.get("coordinates") or {}
    hub_coords = hub_location.get("coordinates") if isinstance(hub_location, dict) else None
    if not hub_coords or len(hub_coords) < 2:
        raise HTTPException(status_code=400, detail="Local hub coordinates are required before final delivery assignment")

    farm = {
        "name": hub_doc.get("name") or hub_doc.get("hubName") or "Local Fulfillment Hub",
        "address": hub_doc.get("address") or "",
        "lat": float(hub_coords[1]),
        "lng": float(hub_coords[0]),
    }
    hub_pickup = {
        "type": "local_hub",
        "id": str(hub_doc["_id"]),
        "name": farm["name"],
        "address": farm["address"],
        "coordinates": [float(hub_coords[0]), float(hub_coords[1])],
    }
    patched_order = dict(order)
    patched_order["deliveryPickupLocation"] = hub_pickup
    patched_order["nearbyFulfillmentLocation"] = hub_pickup
    patched_order["nearbyFulfillmentLocationId"] = hub_doc["_id"]
    distance = _haversine_km(float(hub_coords[1]), float(hub_coords[0]), float(coords[1]), float(coords[0]))
    eligible = await eligible_partners_for_job(float(hub_coords[1]), float(hub_coords[0]), job_weight_kg(order))
    job_doc = build_job_document(patched_order, farm, distance, eligible_partner_ids=[p["id"] for p in eligible])
    job_doc["jobType"] = "farmer_fulfillment_consolidated_delivery"
    job_doc["consolidationId"] = order.get("consolidationId")
    job_doc["localHubId"] = hub_doc["_id"]
    job_doc["localHubName"] = farm["name"]
    job_doc["singleFinalDelivery"] = True
    try:
        job_id = await delivery_job_repository.create_job(job_doc)
    except Exception as exc:
        # The delivery_jobs collection has a unique sparse orderId index. If
        # two warehouse/hub workers race at the final handoff, the loser must
        # reuse the already-created job instead of opening a second delivery.
        existing = await delivery_job_repository.get_by_order_id(order_id)
        if existing:
            return {"jobId": str(existing["_id"]), "status": existing.get("status", "open"), "existing": True}
        logger.exception("Failed to create final delivery job for order %s", order_id)
        raise HTTPException(status_code=409, detail="Final delivery job could not be created safely") from exc
    if not job_id:
        raise HTTPException(status_code=500, detail="Failed to create final delivery job")

    await order_repository.update(
        {"_id": ObjectId(order_id)},
        {
            "transferStatus": "local_hub_ready",
            "consolidationStatus": "local_hub_ready",
            "deliveryPartnerJobId": ObjectId(job_id),
            "partnerAssignmentOpen": True,
            "deliveryPickupLocation": hub_pickup,
            "deliveryDecisionStatus": "partner_pending",
            "updatedAt": datetime.utcnow(),
        },
    )
    for partner in eligible:
        try:
            if partner.get("userId"):
                await NotificationService.send_custom_notification(
                    str(partner["userId"]),
                    f"Complete farmer fulfillment order {order.get('orderNumber', '')} is ready at {farm['name']}.",
                    title="New Final Delivery Job",
                    data={"type": "farmer_fulfillment_final_delivery", "jobId": job_id, "orderId": order_id},
                )
        except Exception:
            logger.exception("Failed to notify partner for consolidated farmer fulfillment")
    return {"jobId": job_id, "status": "open", "eligiblePartners": len(eligible), "localHub": hub_pickup}

@router.get("/me/customer-orders")
async def get_warehouse_customer_orders(
    stage: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    """List customer orders whose fulfillment source is this warehouse."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can access customer orders")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    query: Dict[str, Any] = {
        "warehouseId": ObjectId(str(warehouse["_id"])),
        "fulfillmentMethod": "warehouse",
        "deletedAt": None,
        "orderStatus": {"$nin": ["delivered", "completed", "cancelled", "refunded"]},
    }
    if stage:
        query["warehouseFulfillmentStage"] = stage

    orders = await order_repository.find_many(
        query, skip=0, limit=200,
        sort=[("orderDate", -1), ("createdAt", -1), ("updatedAt", -1), ("_id", -1)],
    )
    result = []
    for order in orders:
        customer = None
        if order.get("customerId"):
            try:
                customer = await UserService.get_user_by_id(str(order["customerId"]))
            except Exception:
                customer = None
        result.append({
            "id": str(order["_id"]),
            "orderNumber": order.get("orderNumber") or str(order["_id"])[-8:],
            "orderStatus": order.get("orderStatus"),
            "warehouseFulfillmentStage": order.get("warehouseFulfillmentStage") or "awaiting_farmer_confirmation",
            "fulfillmentMethod": order.get("fulfillmentMethod"),
            "totalAmount": order.get("totalAmount", 0),
            "paymentStatus": order.get("paymentStatus"),
            "shortageResolutionRequired": bool(order.get("shortageResolutionRequired")),
            "packingComplete": bool(order.get("packingComplete")),
            "packingVerified": bool(order.get("packingVerified")),
            "deliveryPartnerRoute": order.get("deliveryPartnerRoute"),
            "deliveryAddress": order.get("deliveryAddress") or {},
            "customer": {
                "name": (
                    f"{customer.get('firstName', '')} {customer.get('lastName', '')}".strip()
                    if customer else "Customer"
                ),
                "phone": customer.get("phone") if customer else None,
            },
            "items": [
                {
                    "productId": str(item.get("productId")),
                    "variantId": str(item.get("variantId")) if item.get("variantId") else None,
                    "productName": item.get("productName") or "Product",
                    "quantity": float(item.get("quantity", 0) or 0),
                    "unit": item.get("unit") or "kg",
                    "unitPrice": float(item.get("unitPrice", 0) or 0),
                }
                for item in (order.get("items") or [])
            ],
            "createdAt": order.get("createdAt"),
            "updatedAt": order.get("updatedAt"),
        })
    return {"success": True, "data": {"orders": result}}


@router.post("/me/customer-orders/{order_id}/allocate")
async def allocate_warehouse_customer_order(
    order_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Move a stored warehouse order into the packing queue.

    Allocation is deliberately idempotent: inventory was reserved by the
    authoritative order/inventory workflow; this endpoint never reserves the
    same stock a second time.
    """
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can allocate warehouse orders")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid order ID")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    order = await order_repository.get_by_id(order_id)
    if not order or str(order.get("warehouseId")) != str(warehouse["_id"]) or str(order.get("fulfillmentMethod") or "") != "warehouse":
        raise HTTPException(status_code=404, detail="Warehouse customer order not found")
    if str(order.get("orderStatus") or "").lower() in ("cancelled", "refunded", "delivered", "completed"):
        raise HTTPException(status_code=400, detail="This order is already closed")

    stage = str(order.get("warehouseFulfillmentStage") or "")
    if stage in ("ready_for_dispatch", "delivery_decision", "dispatched"):
        return {"success": True, "data": {"orderId": order_id, "stage": stage}, "message": "Order is already past allocation"}

    task = await WarehouseService.ensure_order_packing_task(order_id, str(warehouse["_id"]))
    if not task:
        raise HTTPException(status_code=400, detail="The order has no warehouse-packable inventory yet")

    await order_repository.update(
        {"_id": ObjectId(order_id)},
        {
            "warehouseFulfillmentStage": "ready_for_packing",
            "warehouseAllocatedAt": datetime.utcnow(),
            "warehouseAllocatedBy": ObjectId(str(current_user["_id"])),
            "updatedAt": datetime.utcnow(),
        },
    )
    await order_repository.append_tracking_event(
        order_id,
        "warehouse_stock_allocated",
        "Warehouse stock allocated",
        "Reserved warehouse stock has been allocated to the customer order and the order is ready for packing.",
        actor_id=str(current_user["_id"]),
        actor_role="warehouse",
        metadata={"packingTaskId": str(task.get("_id")) if task.get("_id") else None},
    )
    return {
        "success": True,
        "data": {
            "orderId": order_id,
            "orderNumber": order.get("orderNumber"),
            "stage": "ready_for_packing",
            "packingTaskId": str(task.get("_id")) if task.get("_id") else None,
        },
        "message": "Stock allocated. Customer order is ready for packing.",
    }


@router.get("/me/consolidation")
async def get_warehouse_consolidation(
    current_user: dict = Depends(get_current_user),
):
    """Read-only consolidation readiness for multi-farm event fulfillments."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can view consolidation")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    try:
        from app.api.v1.bulk_orders import event_fulfillment_repo
        rows = await event_fulfillment_repo.find_many({
            "warehouseId": ObjectId(str(warehouse["_id"])),
            "deletedAt": None,
        }, skip=0, limit=1000, sort=[("updatedAt", -1)])
    except Exception:
        rows = []

    grouped: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        request_id = str(row.get("requestId") or row.get("eventRequestId") or row.get("_id"))
        group = grouped.setdefault(request_id, {
            "requestId": request_id,
            "items": [],
            "totalItems": 0,
            "storedItems": 0,
            "complete": False,
            "status": "collecting",
        })
        status_value = str(row.get("status") or "")
        group["items"].append({
            "id": str(row["_id"]),
            "productName": row.get("productName") or row.get("cropName") or "Product",
            "allocatedQuantity": float(row.get("allocatedQuantityKg") or row.get("quantityKg") or 0),
            "status": status_value,
        })
        group["totalItems"] += 1
        if status_value in ("stored", "consolidated", "ready_for_delivery", "delivered"):
            group["storedItems"] += 1

    for group in grouped.values():
        group["complete"] = group["totalItems"] > 0 and group["storedItems"] == group["totalItems"]
        group["status"] = "consolidation_ready" if group["complete"] else (
            "partially_received" if group["storedItems"] else "collecting"
        )

    return {"success": True, "data": {"groups": list(grouped.values())}}

@router.put("/me", response_model=WarehouseResponse)
async def update_my_warehouse(
    data: WarehouseUpdate,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can update their warehouse"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse and current_user.get("role") == "warehouse":
        # Self-heal legacy warehouse accounts created before managerId was
        # standardized. This creates a profile only when none exists at all.
        from app.repositories.warehouse_repository import warehouse_repository
        now = datetime.utcnow()
        warehouse_id = await warehouse_repository.create({
            "userId": ObjectId(str(current_user["_id"])),
            "managerId": ObjectId(str(current_user["_id"])),
            "name": f"Warehouse of {current_user.get('firstName', 'Manager')}",
            "warehouseName": f"Warehouse of {current_user.get('firstName', 'Manager')}",
            "location": {},
            "address": {},
            "totalCapacity": 0,
            "coldStorageCapacity": 0,
            "usedCapacity": 0,
            "coldStorageUsed": 0,
            "isActive": True,
            "isVerified": False,
            "deletedAt": None,
            "createdAt": now,
            "updatedAt": now,
        })
        warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse profile could not be created for this account"
        )
    try:
        updated = await WarehouseService.update_warehouse(str(warehouse["_id"]), data)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc)
        ) from exc
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to update warehouse"
        )
    updated["id"] = str(updated["_id"])
    return updated

@router.get("/me/stock", response_model=dict)
async def get_my_warehouse_stock(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can access this endpoint"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    skip = (page - 1) * limit
    stock, total = await WarehouseService.get_warehouse_stock(
        str(warehouse["_id"]),
        skip,
        limit,
        status
    )
    for item in stock:
        item["id"] = str(item["_id"])
    return {
        "success": True,
        "data": {
            "stock": stock,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit
            }
        }
    }

@router.post("/me/stock", response_model=WarehouseStockResponse)
async def add_stock(
    data: WarehouseStockCreate,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can add stock"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    data.warehouseId = str(warehouse["_id"])
    try:
        stock = await WarehouseService.add_stock(data)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc)
        ) from exc
    if not stock:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to add stock"
        )
    stock["id"] = str(stock["_id"])
    return stock

@router.put("/me/stock/{stock_id}", response_model=WarehouseStockResponse)
async def update_stock(
    stock_id: str,
    data: WarehouseStockUpdate,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can update stock"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    stock = await WarehouseService.update_stock(stock_id, data, str(warehouse["_id"]))
    if not stock:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stock not found"
        )
    stock["id"] = str(stock["_id"])
    return stock

@router.get("/recommended")
async def get_recommended_warehouse(
    lat: float = Query(...),
    lng: float = Query(...),
    quantity: float = Query(0, ge=0),
    storageType: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") not in ("farmer", "admin"):
        raise HTTPException(status_code=403, detail="Only farmers and admins can request warehouse recommendations")
    warehouse = await WarehouseService.find_best_warehouse(
        {"type": "Point", "coordinates": [lng, lat]},
        required_capacity=quantity,
        storage_type=storageType,
    )
    if not warehouse:
        raise HTTPException(status_code=404, detail="No suitable warehouse is available near this location")
    return {"success": True, "data": {
        "id": str(warehouse["_id"]),
        "name": warehouse.get("name"),
        "address": warehouse.get("address") or {},
        "distanceKm": warehouse.get("selectionDistanceKm"),
        "availableCapacity": warehouse.get("availableCapacity"),
        "totalCapacity": warehouse.get("totalCapacity", 0),
        "usedCapacity": warehouse.get("usedCapacity", 0),
        "serviceAreas": warehouse.get("serviceAreas") or [],
        "supportedStorageTypes": warehouse.get("supportedStorageTypes") or [],
        "selectionReason": warehouse.get("selectionReason"),
    }}

class PickupTeamApplicationRequest(BaseModel):
    vehicleType: str = Field(..., min_length=1)
    vehicleNumber: str = Field(..., min_length=1)
    vehicleModel: Optional[str] = None
    vehicleYear: Optional[int] = None
    capacity: Optional[float] = Field(None, ge=0)
    fuelType: Optional[str] = None
    licenseDetails: Optional[Dict[str, Any]] = None
    verificationDetails: Optional[Dict[str, Any]] = None
    notes: Optional[str] = None


class PickupRouteCreateRequest(BaseModel):
    collectionIds: List[str] = Field(default_factory=list)
    maxStops: int = Field(8, ge=1, le=30)
    maxWeightKg: float = Field(0, ge=0)


class PickupRouteAssignRequest(BaseModel):
    deliveryPartnerId: str = Field(..., min_length=1)


@router.get("/me/pickup-team/applications")
async def get_pickup_team_applications(
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can manage pickup teams")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    apps = await warehouse_pickup_team_repository.get_applications(str(warehouse["_id"]), status_filter)
    for item in apps:
        item["id"] = str(item["_id"])
        item["deliveryPartnerId"] = str(item["deliveryPartnerId"])
        try:
            user = await UserService.get_user_by_id(str(item.get("userId") or item["deliveryPartnerId"]))
            if user:
                item["name"] = (f"{user.get('firstName','')} {user.get('lastName','')}").strip() or user.get("name") or "Delivery Partner"
                item["phone"] = user.get("phone")
        except Exception:
            item["name"] = "Delivery Partner"
    return {"success": True, "data": {"applications": apps}}


@router.put("/me/pickup-team/applications/{application_id}")
async def review_pickup_team_application(
    application_id: str,
    decision: str = Query(..., pattern="^(approve|reject)$"),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can review pickup team applications")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    apps = await warehouse_pickup_team_repository.get_applications(str(warehouse["_id"]), "pending")
    app = next((x for x in apps if str(x["_id"]) == application_id), None)
    if not app:
        raise HTTPException(status_code=404, detail="Pickup team application not found")
    now = datetime.utcnow()
    update = {
        "status": "approved" if decision == "approve" else "rejected",
        "reviewedAt": now,
        "reviewedBy": ObjectId(str(current_user["_id"])),
    }
    if decision == "approve":
        update["approvedAt"] = now
    await warehouse_pickup_team_repository.update_application(application_id, update)
    return {"success": True, "message": "Pickup team member approved" if decision == "approve" else "Application rejected"}


@router.get("/me/pickup-team/members")
async def get_pickup_team_members(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can access pickup team")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    members = await warehouse_pickup_team_repository.get_approved_members(str(warehouse["_id"]))
    result = []
    for x in members:
        item = {**x, "id": str(x["_id"]), "deliveryPartnerId": str(x["deliveryPartnerId"])}
        try:
            user = await UserService.get_user_by_id(str(x.get("userId") or x["deliveryPartnerId"]))
            if user:
                item["name"] = (f"{user.get('firstName','')} {user.get('lastName','')}").strip() or user.get("name") or "Delivery Partner"
                item["phone"] = user.get("phone")
        except Exception:
            item["name"] = "Delivery Partner"
        result.append(item)
    return {"success": True, "data": {"members": result}}


@router.post("/me/pickup-routes")
async def create_pickup_routes(
    data: PickupRouteCreateRequest,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can create pickup routes")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    jobs = await warehouse_collection_repository.get_by_warehouse(str(warehouse["_id"]), "ready_for_pickup")
    if data.collectionIds:
        selected = set(data.collectionIds)
        jobs = [j for j in jobs if str(j["_id"]) in selected]
    if not jobs:
        raise HTTPException(status_code=400, detail="No ready-for-pickup farms are available")
    route_groups = await build_smart_routes(warehouse, jobs, data.maxStops, data.maxWeightKg)
    created = []
    route_date = datetime.utcnow().strftime("%Y-%m-%d")
    for group in route_groups:
        route_id = await warehouse_pickup_route_repository.create_route({
            "warehouseId": warehouse["_id"],
            "routeDate": route_date,
            "status": "offered",
            "deliveryPartnerId": None,
            "routeNumber": f"PR-{datetime.utcnow().strftime('%Y%m%d')}-{len(created)+1:02d}",
            "stops": group["stops"],
            "totalStops": group["totalStops"],
            "totalQuantity": group["totalQuantity"],
            "createdBy": ObjectId(str(current_user["_id"])),
        })
        if route_id:
            route_doc = await warehouse_pickup_route_repository.get_by_id(route_id)
            members = await warehouse_pickup_team_repository.get_approved_members(str(warehouse["_id"]))
            if members:
                # Approved pickup partners get the exclusive first-accept route offer.
                await warehouse_pickup_route_repository.update_route(route_id, {"assignmentMode": "pickup_partner"})
                for member in members:
                    try:
                        user_id = str(member.get("userId") or "")
                        if user_id:
                            await NotificationService.send_custom_notification(
                                user_id,
                                f"Pickup route {route_doc.get('routeNumber', route_id)} is available. Accept it to claim this route.",
                                title="New Warehouse Pickup Route",
                                data={"type": "warehouse_pickup_offer", "routeId": route_id},
                            )
                    except Exception:
                        logger.exception("Failed to notify pickup partner about route offer")
            else:
                # No approved pickup partner: publish the same route as a normal
                # delivery marketplace job. Eligibility is based on availability,
                # verification and remaining vehicle capacity.
                await warehouse_pickup_route_repository.update_route(route_id, {"assignmentMode": "delivery_marketplace"})
                warehouse_point = (warehouse.get("location") or {}).get("coordinates") or [0, 0]
                first_stop_point = ((group.get("stops") or [{}])[0].get("pickupLocation") or {}).get("coordinates") or warehouse_point
                eligible = await eligible_partners_for_job(
                    float(first_stop_point[1]) if len(first_stop_point) > 1 else 0.0,
                    float(first_stop_point[0]) if first_stop_point else 0.0,
                    float(group.get("totalQuantity") or 0),
                    job_type="warehouse_pickup",
                )
                job_doc = build_warehouse_pickup_job(route_doc, warehouse, [p["id"] for p in eligible])
                job_id = await delivery_job_repository.create_job(job_doc)
                if job_id:
                    for partner in eligible:
                        try:
                            if partner.get("userId"):
                                await NotificationService.send_custom_notification(
                                    str(partner["userId"]),
                                    f"Warehouse pickup job {route_doc.get('routeNumber', route_id)} is available: {group.get('totalStops', 0)} farms, {group.get('totalQuantity', 0)} kg.",
                                    title="New Warehouse Pickup Job",
                                    data={"type": "warehouse_pickup_job", "jobId": job_id, "routeId": route_id},
                                )
                        except Exception:
                            logger.exception("Failed to notify delivery partner about warehouse pickup job")
            created.append(serialize_route(await warehouse_pickup_route_repository.get_by_id(route_id)))
    return {"success": True, "data": {"routes": created}, "message": f"{len(created)} pickup route(s) created"}


@router.get("/me/pickup-routes")
async def get_pickup_routes(
    date: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can view pickup routes")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    routes = await warehouse_pickup_route_repository.get_by_warehouse(str(warehouse["_id"]), date or datetime.utcnow().strftime("%Y-%m-%d"))
    return {"success": True, "data": {"routes": [serialize_route(x) for x in routes]}}


@router.put("/me/pickup-routes/{route_id}/assign")
async def assign_pickup_route(
    route_id: str,
    data: PickupRouteAssignRequest,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can assign pickup routes")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    route = await warehouse_pickup_route_repository.get_by_id(route_id)
    if not warehouse or not route or str(route.get("warehouseId")) != str(warehouse["_id"]):
        raise HTTPException(status_code=404, detail="Pickup route not found")
    membership = await warehouse_pickup_team_repository.get_membership(str(warehouse["_id"]), data.deliveryPartnerId)
    if not membership:
        raise HTTPException(status_code=400, detail="This delivery partner is not an approved pickup team member")
    membership["deliveryPartnerUserId"] = str(membership.get("userId") or membership.get("deliveryPartnerUserId"))
    route["assignedBy"] = ObjectId(str(current_user["_id"]))
    updated = await assign_route(route, membership)
    return {"success": True, "data": serialize_route(updated), "message": "Pickup route assigned to approved team member"}


class CollectionTeamAssignment(BaseModel):
    teamId: str = Field(..., min_length=1, max_length=100)


@router.get("/me/collections", response_model=dict)
async def get_collection_queue(status: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can access collection jobs")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    jobs = await warehouse_collection_repository.get_by_warehouse(str(warehouse["_id"]), status)
    return {"success": True, "data": {"collections": [serialize_collection(x) for x in jobs]}}


@router.put("/me/collections/{collection_id}/assign")
async def assign_collection_team(collection_id: str, data: CollectionTeamAssignment, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can assign collection teams")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    job = await warehouse_collection_repository.get_by_id(collection_id)
    if not warehouse or not job or str(job.get("warehouseId")) != str(warehouse["_id"]):
        raise HTTPException(status_code=404, detail="Collection job not found")
    if job.get("status") not in ("ready_for_pickup", "team_assigned"):
        raise HTTPException(status_code=400, detail="Collection job is not waiting for team assignment")
    await warehouse_collection_repository.update_job(collection_id, {"collectionTeamId": data.teamId, "status": "team_assigned", "teamAssignedAt": datetime.utcnow()})
    if job.get("orderId"):
        await order_repository.update({"_id": ObjectId(str(job["orderId"]))}, {"warehouseCollectionStatus": "team_assigned", "warehouseCollectionTeamId": data.teamId, "warehouseFulfillmentStage": "collection_team_assigned", "updatedAt": datetime.utcnow()})
        await order_repository.append_tracking_event(str(job["orderId"]), "collection_team_assigned", "Collection team assigned", "A warehouse collection team has been assigned to collect the farm shipment.", actor_id=str(current_user["_id"]), actor_role="warehouse", metadata={"teamId": data.teamId})
    return {"success": True, "data": serialize_collection(await warehouse_collection_repository.get_by_id(collection_id))}


@router.put("/me/collections/{collection_id}/status")
async def update_collection_status(collection_id: str, collection_status: str = Query(..., alias="status", pattern="^(en_route|arrived_at_farm|collected|departed_farm|arrived_warehouse)$"), current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can update collection jobs")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    job = await warehouse_collection_repository.get_by_id(collection_id)
    if not warehouse or not job or str(job.get("warehouseId")) != str(warehouse["_id"]):
        raise HTTPException(status_code=404, detail="Collection job not found")
    allowed = {
        "team_assigned": {"en_route"}, "en_route": {"arrived_at_farm"},
        "arrived_at_farm": {"collected"}, "collected": {"departed_farm"},
        "departed_farm": {"arrived_warehouse"},
    }
    current = str(job.get("status") or "")
    if collection_status not in allowed.get(current, set()):
        raise HTTPException(status_code=400, detail=f"Invalid collection transition: {current} -> {collection_status}")
    update = {"status": collection_status}
    if collection_status == "collected": update["collectedAt"] = datetime.utcnow()
    if collection_status == "arrived_warehouse": update["arrivedWarehouseAt"] = datetime.utcnow()
    await warehouse_collection_repository.update_job(collection_id, update)
    incoming_id = job.get("incomingStockId")
    if incoming_id and collection_status == "collected":
        from app.repositories.incoming_stock_repository import incoming_stock_repository
        await incoming_stock_repository.update({"_id": ObjectId(str(incoming_id))}, {"status": "in_transit", "collectedAt": datetime.utcnow(), "updatedAt": datetime.utcnow()})
    if incoming_id and collection_status == "arrived_warehouse":
        # Arrival at the warehouse is not the same as warehouse receipt.
        # Keep the incoming shipment in transit until staff performs Receive + QC.
        from app.repositories.incoming_stock_repository import incoming_stock_repository
        await incoming_stock_repository.update({"_id": ObjectId(str(incoming_id))}, {"status": "in_transit", "arrivedWarehouseAt": datetime.utcnow(), "updatedAt": datetime.utcnow()})
        if job.get("orderId"):
            await order_repository.update({"_id": ObjectId(str(job["orderId"]))}, {"warehouseCollectionStatus": "arrived_warehouse", "warehouseFulfillmentStage": "warehouse_arrived", "updatedAt": datetime.utcnow()})
            await order_repository.append_tracking_event(str(job["orderId"]), "arrived_warehouse", "Shipment arrived at warehouse", "The collection team has arrived at the warehouse. Warehouse receiving and quality check are still required.", actor_id=str(current_user["_id"]), actor_role="warehouse")
            updated_order = await order_repository.get_by_id(str(job["orderId"]))
            if updated_order:
                await NotificationService.send_order_workflow_update(
                    updated_order, stage="warehouse_arrived",
                    title=f"Order #{updated_order.get('orderNumber') or job['orderId']}: shipment arrived at warehouse",
                    message="The shipment has arrived at the warehouse. Receiving and quality check are now required.",
                    actor_role="warehouse",
                )
    elif job.get("orderId"):
        stage_map = {"en_route": "collection_en_route", "arrived_at_farm": "collection_arrived", "collected": "collected", "departed_farm": "collection_departed"}
        await order_repository.update({"_id": ObjectId(str(job["orderId"]))}, {"warehouseCollectionStatus": collection_status, "warehouseFulfillmentStage": stage_map[collection_status], "updatedAt": datetime.utcnow()})
        await order_repository.append_tracking_event(str(job["orderId"]), f"collection_{collection_status}", {"en_route":"Collection team en route","arrived_at_farm":"Collection team arrived at farm","collected":"Product collected from farm","departed_farm":"Collection team departed farm"}[collection_status], "Warehouse collection progress updated.", actor_id=str(current_user["_id"]), actor_role="warehouse")
        updated_order = await order_repository.get_by_id(str(job["orderId"]))
        if updated_order:
            await NotificationService.send_order_workflow_update(
                updated_order, stage=stage_map[collection_status],
                title=f"Order #{updated_order.get('orderNumber') or job['orderId']}: collection updated",
                message={"en_route":"Collection team is on the way to the farm.","arrived_at_farm":"Collection team has arrived at the farm.","collected":"The product has been collected from the farm.","departed_farm":"The collection team has departed the farm."}[collection_status],
                actor_role="warehouse",
            )
    return {"success": True, "data": serialize_collection(await warehouse_collection_repository.get_by_id(collection_id))}


@router.get("/me/incoming", response_model=dict)
async def get_my_incoming_stock(
    status: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can access this endpoint"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    skip = (page - 1) * limit
    incoming, total = await WarehouseService.get_incoming_stock(
        str(warehouse["_id"]),
        status,
        skip,
        limit
    )
    for item in incoming:
        item["id"] = str(item["_id"])
    return {
        "success": True,
        "data": {
            "incoming": incoming,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit
            }
        }
    }

@router.post("/me/incoming", response_model=IncomingStockResponse)
async def schedule_incoming(
    data: IncomingStockCreate,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can schedule incoming stock"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    data.warehouseId = str(warehouse["_id"])
    incoming = await WarehouseService.schedule_incoming(data)
    if not incoming:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to schedule incoming stock"
        )
    incoming["id"] = str(incoming["_id"])
    return incoming

@router.put("/me/incoming/{incoming_id}/receive")
async def receive_incoming_stock(
    incoming_id: str,
    quantity: int = Query(..., gt=0),
    quality_check: str = Query(..., pattern="^(pending|passed|failed)$"),
    usable_quantity: Optional[float] = Query(None, ge=0, alias="usableQuantity"),
    notes: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can receive stock"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    incoming = await WarehouseService.receive_incoming(
        incoming_id,
        quantity,
        quality_check,
        notes,
        str(warehouse["_id"]),
        usable_quantity
    )
    if not incoming:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to receive stock"
        )

    # Notify farmer/customer when warehouse receiving changes the authoritative order workflow.
    try:
        order_id = incoming.get("orderId")
        if order_id:
            updated_order = await order_repository.get_by_id(str(order_id))
            if updated_order:
                await NotificationService.send_order_workflow_update(
                    updated_order,
                    stage=updated_order.get("warehouseFulfillmentStage") or "received",
                    title=f"Order #{updated_order.get('orderNumber') or order_id}: warehouse receiving updated",
                    message=(
                        "The warehouse received the shipment and it passed quality check." if quality_check == "passed"
                        else "The warehouse received the shipment, but the quality check requires attention."
                    ),
                    actor_role="warehouse",
                    priority=NotificationPriority.HIGH if quality_check == "passed" else NotificationPriority.URGENT,
                )
    except Exception:
        logger.exception("Failed to notify workflow roles after warehouse receiving")

    return {
        "success": True,
        "data": incoming,
        "message": "Stock received successfully" if quality_check == "passed" else "Stock rejected"
    }

@router.put("/me/incoming/{incoming_id}/store")
async def store_incoming_stock(
    incoming_id: str,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can store incoming stock")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    incoming = await WarehouseService.store_incoming(
        incoming_id, str(warehouse["_id"])
    )
    if not incoming:
        raise HTTPException(status_code=400, detail="Incoming stock must be received and quality approved before storage")
    try:
        order_id = incoming.get("orderId")
        if order_id:
            updated_order = await order_repository.get_by_id(str(order_id))
            if updated_order:
                await NotificationService.send_order_workflow_update(
                    updated_order,
                    stage=updated_order.get("warehouseFulfillmentStage") or "stored",
                    title=f"Order #{updated_order.get('orderNumber') or order_id}: stock stored",
                    message="The warehouse has stored the received product. Order allocation and packing can proceed.",
                    actor_role="warehouse",
                )
    except Exception:
        logger.exception("Failed to notify workflow roles after warehouse storage")
    return {"success": True, "data": incoming, "message": "Stock stored successfully"}


@router.get("/me/packing-tasks", response_model=dict)
async def get_packing_tasks(status: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can access packing tasks")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse: raise HTTPException(status_code=404, detail="Warehouse not found")
    tasks = await warehouse_packing_repository.get_by_warehouse(str(warehouse["_id"]), status)
    for task in tasks:
        task["id"] = str(task["_id"])
        for key in ("warehouseId","orderId","farmerId","productId","variantId","batchId"):
            if task.get(key) is not None: task[key] = str(task[key])
        if task.get("orderId"):
            order = await order_repository.get_by_id(str(task["orderId"]))
            if order:
                task["orderNumber"] = order.get("orderNumber")
                task["deliveryAddress"] = order.get("deliveryAddress") or {}
                task["items"] = [
                    {
                        "productId": str(item.get("productId")),
                        "productName": item.get("productName") or "Product",
                        "quantity": float(item.get("quantity", 0) or 0),
                        "unitPrice": item.get("unitPrice", 0),
                    }
                    for item in (order.get("items") or [])
                ]
                customer = await UserService.get_user_by_id(str(order.get("customerId"))) if order.get("customerId") else None
                task["customer"] = {
                    "name": f"{customer.get('firstName', '')} {customer.get('lastName', '')}".strip() if customer else "Customer",
                    "phone": customer.get("phone") if customer else None,
                }
    return {"success": True, "data": {"tasks": tasks}}

@router.get("/me/packing-tasks/{task_id}/label")
async def get_packing_label(task_id: str, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can access packing labels")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    task = await warehouse_packing_repository.get_by_id(task_id)
    if not warehouse or not task or str(task.get("warehouseId")) != str(warehouse["_id"]):
        raise HTTPException(status_code=404, detail="Packing task not found")
    order = await order_repository.get_by_id(str(task["orderId"])) if task.get("orderId") else None
    if not order:
        raise HTTPException(status_code=404, detail="Order not found for packing task")
    customer = await UserService.get_user_by_id(str(order.get("customerId"))) if order.get("customerId") else None
    address = order.get("deliveryAddress") or {}
    items = [
        {"productName": item.get("productName") or "Product", "quantity": float(item.get("quantity", 0) or 0), "unit": item.get("unit") or "kg"}
        for item in (order.get("items") or [])
    ]
    return {"success": True, "data": {
        "packageId": task.get("packageId") or f"PKG-{str(task['_id'])[-8:]}",
        "orderId": str(order["_id"]),
        "orderNumber": order.get("orderNumber"),
        "customer": {"name": f"{customer.get('firstName','')} {customer.get('lastName','')}".strip() if customer else "Customer", "phone": customer.get("phone") if customer else None},
        "items": items,
        "address": address,
        "quantityTotal": sum(x["quantity"] for x in items),
    }}

@router.put("/me/packing-tasks/{task_id}/assign")
async def assign_packing_team(task_id: str, data: PackingTeamAssignment, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse": raise HTTPException(status_code=403, detail="Only warehouse managers can assign packing teams")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    task = await warehouse_packing_repository.get_by_id(task_id)
    if not warehouse or not task or str(task.get("warehouseId")) != str(warehouse["_id"]): raise HTTPException(status_code=404, detail="Packing task not found")
    await warehouse_packing_repository.update_task(task_id, {"packingTeamId": data.packingTeamId, "status": "assigned"})
    from app.repositories.order_repository import order_repository
    await order_repository.update(
        {"_id": ObjectId(str(task["orderId"]))},
        {"warehouseFulfillmentStage": "packing_team_assigned", "packingTeamId": data.packingTeamId, "updatedAt": datetime.utcnow()},
    )
    await order_repository.append_tracking_event(str(task["orderId"]), "packing_team_assigned", "Packing team assigned", "The warehouse packing team has been assigned to this customer order.", actor_id=str(current_user["_id"]), actor_role="warehouse", metadata={"packingTeamId": data.packingTeamId, "quantityRequired": task.get("quantityRequired", 0)})
    return {"success": True, "data": await warehouse_packing_repository.get_by_id(task_id)}

@router.put("/me/packing-tasks/{task_id}/start")
async def start_packing_task(task_id: str, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse": raise HTTPException(status_code=403, detail="Only warehouse managers can start packing")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    task = await warehouse_packing_repository.get_by_id(task_id)
    if not warehouse or not task or str(task.get("warehouseId")) != str(warehouse["_id"]): raise HTTPException(status_code=404, detail="Packing task not found")
    if task.get("status") not in ("ready_for_packing","assigned"): raise HTTPException(status_code=400, detail="Task is not ready to start packing")
    await warehouse_packing_repository.update_task(task_id, {"status":"packing"})
    from app.repositories.order_repository import order_repository
    await order_repository.update(
        {"_id": ObjectId(str(task["orderId"]))},
        {"warehouseFulfillmentStage": "packing", "updatedAt": datetime.utcnow()},
    )
    await order_repository.append_tracking_event(str(task["orderId"]), "packing_started", "Packing started", "The packing team has started preparing your customer package.", actor_id=str(current_user["_id"]), actor_role="warehouse", metadata={"quantityRequired": task.get("quantityRequired", 0)})
    return {"success": True, "data": await warehouse_packing_repository.get_by_id(task_id)}

@router.put("/me/packing-tasks/{task_id}/complete")
async def complete_packing_task(task_id: str, data: PackingCompleteRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse": raise HTTPException(status_code=403, detail="Only warehouse managers can complete packing")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    task = await warehouse_packing_repository.get_by_id(task_id)
    if not warehouse or not task or str(task.get("warehouseId")) != str(warehouse["_id"]): raise HTTPException(status_code=404, detail="Packing task not found")
    required = float(task.get("quantityRequired") or 0)
    if task.get("status") not in ("ready_for_packing","assigned","packing","partially_packed"):
        raise HTTPException(status_code=400, detail="Task is not packable")
    packing_items = [dict(x) for x in (task.get("packingItems") or [])]
    if not packing_items:
        raise HTTPException(status_code=400, detail="Packing checklist is missing for this order. Re-sync the warehouse packing task before packing.")

    # The actual packed quantity is the authoritative shortage check.
    # Do not decide the final shortage from inventory availability alone.
    requested = {}
    for item in (data.items or []):
        key = (str(item.productId), str(item.variantId or ""))
        requested[key] = max(0.0, float(item.packedQuantity))

    if not requested:
        # Backward-compatible clients pack the currently available quantity.
        for line in packing_items:
            key = (str(line.get("productId")), str(line.get("variantId") or ""))
            available = float(line.get("quantityAvailable") or 0)
            requested[key] = available

    any_shortage = False
    for line in packing_items:
        key = (str(line.get("productId")), str(line.get("variantId") or ""))
        required_line = float(line.get("quantityRequired") or 0)
        already_packed = float(line.get("packedQuantity") or 0)
        actual = max(already_packed, requested.get(key, 0.0))
        if actual > required_line + 1e-9:
            raise HTTPException(status_code=400, detail=f"Packed quantity cannot exceed required quantity for {line.get('productName') or line.get('productId')}")
        line["packedQuantity"] = min(required_line, actual)
        line["verified"] = False
        line["quantityShort"] = max(0.0, required_line - line["packedQuantity"])
        # This is informational until packing is complete; it becomes the
        # authoritative shortage only after the final pack action.
        any_shortage = any_shortage or line["quantityShort"] > 1e-9

    packed_total = sum(float(x.get("packedQuantity") or 0) for x in packing_items)
    all_packed = all(float(x.get("packedQuantity") or 0) + 1e-9 >= float(x.get("quantityRequired") or 0) for x in packing_items)
    packed_status = "packed" if all_packed else "partially_packed"

    await warehouse_packing_repository.update_task(
        task_id,
        {
            "packedQuantity": packed_total,
            "packingItems": packing_items,
            "packageId": data.packageId or f"PKG-{str(task['_id'])[-8:]}",
            "packingNotes": data.notes,
            "status": packed_status,
            "packingAttemptComplete": True,
            "shortageDetectedAfterPacking": any_shortage,
        },
    )

    from app.repositories.order_repository import order_repository
    order = await order_repository.get_by_id(str(task["orderId"]))
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if all_packed:
        await order_repository.update(
            {"_id": ObjectId(str(task["orderId"]))},
            {"warehouseFulfillmentStage": "packed", "packingComplete": True, "updatedAt": datetime.utcnow()},
        )
        event = ("packing_completed", "Order packing completed",
                 "All customer-order quantities were physically packed. Final shortage check found no shortage.")
    else:
        # Final shortage is now known from the physical pack result.
        # Create/update shortage cases only now; do not use an inventory
        # availability shortage as the final business decision.
        from app.repositories.warehouse_shortage_repository import warehouse_shortage_repository
        existing_cases = await warehouse_shortage_repository.get_by_warehouse(str(warehouse["_id"]), status=None, limit=1000)
        existing_by_key = {
            (str(x.get("orderId")), str(x.get("productId")), str(x.get("variantId") or "")): x
            for x in existing_cases
            if str(x.get("orderId")) == str(task["orderId"]) and x.get("status") not in ("resolved", "cancelled")
        }
        for line in packing_items:
            short = float(line.get("quantityShort") or 0)
            if short <= 1e-9:
                continue
            key = (str(task["orderId"]), str(line.get("productId")), str(line.get("variantId") or ""))
            case = existing_by_key.get(key)
            payload = {
                "orderId": ObjectId(str(task["orderId"])),
                "warehouseId": ObjectId(str(warehouse["_id"])),
                "productId": ObjectId(str(line["productId"])),
                "variantId": ObjectId(str(line["variantId"])) if line.get("variantId") else None,
                "requiredQuantity": float(line.get("quantityRequired") or 0),
                "availableQuantity": float(line.get("packedQuantity") or 0),
                "shortageQuantity": short,
                "productName": line.get("productName") or "Product",
                "shortageType": "packing_shortage",
                "status": (case or {}).get("status") or "resolution_required",
                "resolutionType": (case or {}).get("resolutionType"),
                "notes": "Final shortage determined from actual physical packing.",
            }
            if case:
                await warehouse_shortage_repository.update_case(str(case["_id"]), payload)
            else:
                await warehouse_shortage_repository.create_case(payload)

        await order_repository.update(
            {"_id": ObjectId(str(task["orderId"]))},
            {
                "warehouseFulfillmentStage": "shortage_pending",
                "packingComplete": True,
                "shortageDetected": True,
                "shortageResolutionRequired": True,
                "updatedAt": datetime.utcnow(),
            },
        )
        event = ("packing_completed_with_shortage", "Packing completed with shortage",
                 "Physical packing finished and the unresolved quantity requires a shortage resolution before dispatch.")

    await order_repository.append_tracking_event(
        str(task["orderId"]), event[0], event[1], event[2],
        actor_id=str(current_user["_id"]), actor_role="warehouse",
        metadata={"packedQuantity": packed_total, "quantityRequired": required,
                  "packageId": data.packageId or f"PKG-{str(task['_id'])[-8:]}"}
    )
    return {"success": True, "data": await warehouse_packing_repository.get_by_id(task_id)}

@router.get("/me/orders/{order_id}/fulfillment-check")
async def warehouse_fulfillment_check(order_id: str, current_user: dict = Depends(get_current_user)):
    """Return a hard completion checklist before a warehouse order can dispatch."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can audit fulfillment")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    order = await order_repository.get_by_id(order_id)
    if not warehouse or not order or str(order.get("warehouseId")) != str(warehouse["_id"]):
        raise HTTPException(status_code=404, detail="Warehouse order not found")
    tasks = await warehouse_packing_repository.get_by_order_all(order_id)
    outgoing = await outgoing_stock_repository.find_many({"orderId": ObjectId(order_id), "warehouseId": ObjectId(str(warehouse["_id"])), "deletedAt": None}, skip=0, limit=1000)
    required = [{"productId": str(i.get("productId")), "variantId": str(i.get("variantId") or ""), "quantity": float(i.get("quantity") or 0), "productName": i.get("productName") or "Product"} for i in (order.get("items") or [])]
    packed = {}
    for t in tasks:
        for line in (t.get("packingItems") or []):
            packed[str(line.get("itemKey"))] = float(line.get("packedQuantity") or 0)
    missing=[]
    for i in required:
        key=f"{i['productId']}:{i['variantId']}"
        qty=packed.get(key, 0.0)
        if qty + 1e-9 < i["quantity"]:
            missing.append({**i, "packedQuantity": qty})
    all_verified=bool(tasks) and all(t.get("verified") is True for t in tasks) and not missing
    outgoing_keys={(str(x.get("productId")), str(x.get("variantId") or "")): float(x.get("quantity") or 0) for x in outgoing}
    missing_outgoing=[]
    for i in required:
        qty=outgoing_keys.get((i["productId"],i["variantId"]),0)
        if qty + 1e-9 < i["quantity"]: missing_outgoing.append({**i,"outgoingQuantity":qty})
    shortage_pending = bool(order.get("shortageResolutionRequired")) or str(order.get("warehouseFulfillmentStage") or "") == "shortage_pending"
    # A resolved Cancel/Refund shortage changes the final order quantities.
    # Dispatch is evaluated against those final quantities, never the original
    # customer-requested quantity.
    final_quantity_complete = not missing
    ready=all_verified and final_quantity_complete and not missing_outgoing and not shortage_pending and str(order.get("warehouseFulfillmentStage")) in ("ready_for_dispatch","delivery_decision")
    return {"success":True,"data":{"orderId":order_id,"orderNumber":order.get("orderNumber"),"readyForDispatch":ready,"packingComplete":not missing,"allPackingVerified":all_verified,"outgoingComplete":not missing_outgoing,"shortagePending":shortage_pending,"missingItems":missing,"missingOutgoing":missing_outgoing,"taskCount":len(tasks),"outgoingCount":len(outgoing)}}

@router.put("/me/packing-tasks/{task_id}/verify")
async def verify_packing_task(task_id: str, data: PackingVerifyRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse": raise HTTPException(status_code=403, detail="Only warehouse managers can verify packing")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    task = await warehouse_packing_repository.get_by_id(task_id)
    if not warehouse or not task or str(task.get("warehouseId")) != str(warehouse["_id"]): raise HTTPException(status_code=404, detail="Packing task not found")
    if data.verified and task.get("packedQuantity",0) < task.get("quantityRequired",0): raise HTTPException(status_code=400, detail="Complete the required quantity before verification")
    await warehouse_packing_repository.update_task(task_id, {"verified":data.verified,"verificationNotes":data.notes,"status":"ready_for_dispatch" if data.verified else "packed"})
    if data.verified:
        from app.repositories.order_repository import order_repository
        order_id=str(task["orderId"])
        packing_items = task.get("packingItems") or []
        if not packing_items or any(float(x.get("packedQuantity") or 0) + 1e-9 < float(x.get("quantityRequired") or 0) for x in packing_items):
            raise HTTPException(status_code=400, detail="Every customer order item must be completely packed before verification")
        await warehouse_packing_repository.update_task(task_id, {"packingItems": [{**x, "verified": True} for x in packing_items]})
        await order_repository.update({"_id":ObjectId(order_id)}, {"warehouseFulfillmentStage":"ready_for_dispatch","packingComplete":True,"packingVerified":True,"packingTaskId":task["_id"],"updatedAt":datetime.utcnow()})
        await order_repository.append_tracking_event(order_id, "packing_verified", "Packing verified", "Every product in the customer order was packed and verified. The complete package is ready for dispatch.", actor_id=str(current_user["_id"]), actor_role="warehouse", metadata={"packageId": task.get("packageId"), "quantity": task.get("packedQuantity", 0), "itemCount": len(packing_items)})
        # One outgoing shipment record is created for every customer-order line.
        # No line is allowed to disappear behind a single-product outgoing row.
        for line in packing_items:
            existing=await outgoing_stock_repository.get_by_order_id(order_id,str(line["productId"]),str(line.get("variantId") or ""))
            if not existing:
                created = await WarehouseService.create_outgoing(OutgoingStockCreate(warehouseId=str(warehouse["_id"]),productId=str(line["productId"]),variantId=str(line.get("variantId")) if line.get("variantId") else None,orderId=order_id,quantity=int(line.get("packedQuantity") or 0),batchNumber=line.get("batchNumber")))
                if not created:
                    raise HTTPException(status_code=400, detail=f"Could not create dispatch record for {line.get('productName') or line.get('productId')}")
    return {"success":True,"data":await warehouse_packing_repository.get_by_id(task_id)}

@router.post("/me/outgoing/{outgoing_id}/delivery-route")
async def choose_warehouse_delivery_route(
    outgoing_id: str,
    data: WarehouseDeliveryRouteRequest,
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can choose delivery routing")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    outgoing = await outgoing_stock_repository.get_by_id(outgoing_id)
    if not outgoing or str(outgoing.get("warehouseId")) != str(warehouse["_id"]):
        raise HTTPException(status_code=404, detail="Outgoing shipment not found")
    if outgoing.get("status") not in ("pending", "dispatched"):
        raise HTTPException(
            status_code=400,
            detail="Delivery routing can be selected only when the package is Ready for Dispatch or already Dispatched",
        )

    order_id = outgoing.get("orderId")
    if not order_id:
        raise HTTPException(status_code=400, detail="This shipment is not linked to an order")
    order = await order_repository.get_by_id(str(order_id))
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Farmer Fulfillment is already packed by the farmer. Its warehouse
    # records are transfer/receiving legs only and must never enter the normal
    # warehouse packing/outgoing delivery pipeline.
    if str(order.get("fulfillmentMethod") or "") == "farmer":
        raise HTTPException(
            status_code=409,
            detail="Farmer Fulfillment uses the Farmer Fulfillment transfer/consolidation workflow; warehouse packing and outgoing routing are not allowed.",
        )

    result = await apply_partner_route(
        order,
        data.route,
        data.radius,
        warehouse_id=str(warehouse["_id"]),
    )
    # Delivery routing is an order-level decision. Persist it to every
    # outgoing line so a multi-product package cannot split accidentally.
    order_outgoings = await outgoing_stock_repository.find_many(
        {"orderId": ObjectId(str(order_id)), "warehouseId": ObjectId(str(warehouse["_id"])), "deletedAt": None},
        skip=0, limit=1000,
    )
    for row in order_outgoings:
        await outgoing_stock_repository.update(
            {"_id": row["_id"]},
            {
                "deliveryPartnerRoute": data.route,
                "deliveryRouteRadiusKm": data.radius,
                "deliveryRouteSelectedAt": datetime.utcnow(),
                "updatedAt": datetime.utcnow(),
            },
        )
    # Ready for Dispatch -> Delivery Decision happens before the physical
    # warehouse dispatch. The delivery job is opened only after the outgoing
    # shipment is actually dispatched.
    if outgoing.get("status") == "pending":
        await order_repository.update(
            {"_id": ObjectId(str(order_id))},
            {
                "warehouseFulfillmentStage": "delivery_decision",
                "deliveryPartnerRoute": data.route,
                "updatedAt": datetime.utcnow(),
            },
        )
        return {
            "success": True,
            "data": {**result, "deliveryJob": None},
            "message": "Delivery route selected. Dispatch the warehouse shipment next.",
        }

    await order_repository.update_order_field(
        str(order_id), "warehouseFulfillmentStage", "dispatched"
    )

    # Warehouse Fulfillment delivery decision:
    # nearby -> Warehouse -> Delivery Partner -> Customer
    # long-distance -> Warehouse -> Local Hub -> Delivery Partner -> Customer
    refreshed = await order_repository.get_by_id(str(order_id)) or order
    existing_job = await delivery_job_repository.get_by_order_id(str(order_id))
    job = existing_job
    if not existing_job or existing_job.get("status") != JOB_OPEN:
        destination = (refreshed.get("deliveryAddress") or {}).get("location") or {}
        coords = destination.get("coordinates") or []
        pickup = refreshed.get("deliveryPickupLocation") or {}
        pickup_coords = pickup.get("coordinates") or []
        pickup_lat = float(pickup_coords[1]) if len(pickup_coords) >= 2 else 0.0
        pickup_lng = float(pickup_coords[0]) if len(pickup_coords) >= 2 else 0.0
        delivery_lat = float(coords[1]) if len(coords) >= 2 else 0.0
        delivery_lng = float(coords[0]) if len(coords) >= 2 else 0.0
        from app.services.delivery_job_service import _haversine_km
        distance = _haversine_km(pickup_lat, pickup_lng, delivery_lat, delivery_lng)
        partners = await eligible_partners_for_job(
            pickup_lat, pickup_lng, job_weight_kg(refreshed)
        )
        eligible_ids = [p["id"] for p in partners]
        farm_location = refreshed.get("farmLocation") or {"lat": pickup_lat, "lng": pickup_lng}
        job_doc = build_job_document(
            refreshed, farm_location, distance,
            expires_in_minutes=JOB_DEFAULT_EXPIRY_MINUTES,
            eligible_partner_ids=eligible_ids,
        )
        job_id = await delivery_job_repository.create(job_doc)
        if job_id:
            job = await delivery_job_repository.get_by_id(job_id)

    return {
        "success": True,
        "data": {**result, "deliveryJob": {"id": str(job["_id"]), "status": job.get("status")} if job else None},
        "message": "Delivery decision saved and delivery partner job opened",
    }



@router.post("/me/farmer-fulfillment/{order_id}/return-to-farmer")
async def return_farmer_fulfillment_to_farmer(
    order_id: str,
    payload: WarehouseFarmerReturnRequest,
    current_user: dict = Depends(get_current_user),
):
    """Create an auditable warehouse -> farmer return/rejection handoff.

    This is used when a packed Farmer Fulfillment portion cannot continue
    because of quantity/quality/damage/transfer exceptions. It never creates
    a warehouse packing task.
    """
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can return a farmer fulfillment shipment")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid order ID")

    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    order = await order_repository.get_by_id(order_id)
    if not order or str(order.get("fulfillmentMethod") or "") != "farmer":
        raise HTTPException(status_code=404, detail="Farmer fulfillment order not found")

    warehouse_id = str(warehouse["_id"])
    assigned_ids = {str(x) for x in (order.get("warehouseIds") or [])}
    if str(order.get("warehouseId") or ""):
        assigned_ids.add(str(order.get("warehouseId")))
    if warehouse_id not in assigned_ids:
        raise HTTPException(status_code=403, detail="This order is not assigned to your warehouse")

    if str(order.get("orderStatus") or "").lower() in {"delivered", "completed", "cancelled", "refunded"}:
        raise HTTPException(status_code=400, detail="Order is no longer eligible for a warehouse-to-farmer return")

    now = datetime.utcnow()
    transfers = MongoDB.get_collection("warehouse_farmer_transfers")
    existing = await transfers.find_one({
        "orderId": ObjectId(order_id),
        "warehouseId": ObjectId(warehouse_id),
        "direction": "warehouse_to_farmer",
        "status": {"$in": ["pending_farmer_acceptance", "accepted"]},
        "deletedAt": None,
    })
    if existing:
        return {"success": True, "data": {"transferId": str(existing["_id"]), "status": existing["status"], "existing": True}}

    allocations = [
        x for x in (order.get("warehouseAllocations") or [])
        if str(x.get("warehouseId")) == warehouse_id
    ]
    if not allocations and str(order.get("warehouseId") or "") == warehouse_id:
        allocations = [{
            "warehouseId": warehouse_id,
            "productId": x.get("productId"),
            "variantId": x.get("variantId"),
            "productName": x.get("productName") or "Product",
            "quantity": x.get("quantity"),
            "unit": x.get("unit") or "kg",
        } for x in (order.get("items") or [])]

    if not allocations:
        raise HTTPException(status_code=400, detail="No assigned shipment portion exists for this warehouse")

    items = []
    remaining = payload.quantity
    for allocation in allocations:
        qty = float(allocation.get("quantity") or 0)
        if remaining is not None:
            if remaining <= 0:
                break
            take = min(qty, remaining)
            remaining -= take
        else:
            take = qty
        if take > 0:
            items.append({
                "productId": allocation.get("productId"),
                "variantId": allocation.get("variantId"),
                "productName": allocation.get("productName") or "Product",
                "quantity": round(float(take), 3),
                "unit": allocation.get("unit") or "kg",
            })
    if not items:
        raise HTTPException(status_code=400, detail="Return quantity does not match the assigned warehouse portion")

    doc = {
        "orderId": ObjectId(order_id),
        "orderNumber": order.get("orderNumber"),
        "farmerId": ObjectId(str(order["farmerId"])),
        "warehouseId": ObjectId(warehouse_id),
        "direction": "warehouse_to_farmer",
        "status": "pending_farmer_acceptance",
        "reason": payload.reason,
        "notes": payload.notes,
        "items": items,
        "createdBy": ObjectId(str(current_user["_id"])),
        "createdAt": now,
        "updatedAt": now,
        "deletedAt": None,
    }
    result = await transfers.insert_one(doc)
    transfer_id = result.inserted_id

    await order_repository.update(
        {"_id": ObjectId(order_id)},
        {
            "warehouseReturnStatus": "pending_farmer_acceptance",
            "warehouseReturnTransferId": transfer_id,
            "warehouseReturnReason": payload.reason,
            "warehouseReturnRequestedAt": now,
            "warehouseReturnWarehouseId": ObjectId(warehouse_id),
            "transferStatus": "warehouse_to_farmer_pending",
            "updatedAt": now,
        },
    )

    farmer_id = str(order["farmerId"])
    try:
        await NotificationService.create_in_app_notification(
            farmer_id,
            NotificationType.WAREHOUSE,
            "Warehouse return request",
            f"Warehouse {warehouse.get('name') or 'your assigned warehouse'} requested a return for order {order.get('orderNumber', order_id)}: {payload.reason}",
            data={
                "type": "warehouse_to_farmer_return",
                "transferId": str(transfer_id),
                "orderId": order_id,
                "warehouseId": warehouse_id,
            },
            priority=NotificationPriority.URGENT,
            mandatory=True,
        )
    except Exception:
        logger.exception("Failed to notify farmer about warehouse return request")

    return {
        "success": True,
        "data": {"transferId": str(transfer_id), "status": "pending_farmer_acceptance"},
        "message": "Warehouse-to-farmer return request created and sent to the farmer.",
    }


@router.put("/me/farmer-fulfillment/returns/{transfer_id}/dispatch")
async def dispatch_farmer_return(transfer_id: str, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can dispatch farmer returns")
    if not ObjectId.is_valid(transfer_id):
        raise HTTPException(status_code=400, detail="Invalid return transfer ID")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    transfers = MongoDB.get_collection("warehouse_farmer_transfers")
    transfer = await transfers.find_one({
        "_id": ObjectId(transfer_id),
        "warehouseId": ObjectId(str(warehouse["_id"])),
        "direction": "warehouse_to_farmer",
        "deletedAt": None,
    })
    if not transfer:
        raise HTTPException(status_code=404, detail="Return transfer not found")
    if transfer.get("status") != "accepted":
        raise HTTPException(status_code=400, detail="Farmer must accept the return before dispatch")

    now = datetime.utcnow()
    await transfers.update_one({"_id": transfer["_id"]}, {"$set": {
        "status": "in_transit_to_farmer",
        "dispatchedAt": now,
        "updatedAt": now,
    }})
    await order_repository.update({"_id": transfer["orderId"]}, {
        "transferStatus": "warehouse_to_farmer_in_transit",
        "warehouseReturnStatus": "in_transit_to_farmer",
        "updatedAt": now,
    })
    try:
        await order_repository.append_tracking_event(
            str(transfer["orderId"]), "warehouse_return_dispatched",
            "Warehouse return dispatched to farmer",
            "The warehouse has dispatched the returned farmer-fulfillment shipment.",
            actor_id=str(current_user["_id"]), actor_role="warehouse",
            metadata={"transferId": transfer_id},
        )
    except Exception:
        logger.exception("Failed to append farmer return dispatch event")
    return {"success": True, "data": {"transferId": transfer_id, "status": "in_transit_to_farmer"}}


@router.get("/me/farmer-fulfillment/{order_id}/return-status")
async def get_farmer_fulfillment_return_status(
    order_id: str,
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can view warehouse-to-farmer returns")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid order ID")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    transfer = await MongoDB.get_collection("warehouse_farmer_transfers").find_one({
        "orderId": ObjectId(order_id),
        "warehouseId": ObjectId(str(warehouse["_id"])),
        "direction": "warehouse_to_farmer",
        "deletedAt": None,
    }, sort=[("createdAt", -1)])
    if not transfer:
        return {"success": True, "data": None}
    transfer["id"] = str(transfer["_id"])
    transfer["_id"] = str(transfer["_id"])
    for key in ("orderId", "farmerId", "warehouseId", "createdBy"):
        if transfer.get(key) is not None:
            transfer[key] = str(transfer[key])
    return {"success": True, "data": transfer}


@router.get("/me/outgoing", response_model=dict)
async def get_my_outgoing_stock(
    status: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can access this endpoint"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    skip = (page - 1) * limit
    outgoing, total = await WarehouseService.get_outgoing_stock(
        str(warehouse["_id"]),
        status,
        skip,
        limit
    )
    for item in outgoing:
        item["id"] = str(item["_id"])
    return {
        "success": True,
        "data": {
            "outgoing": outgoing,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit
            }
        }
    }

@router.put("/me/outgoing/{outgoing_id}/status")
async def update_outgoing_status(
    outgoing_id: str,
    status: str = Query(..., pattern="^(pending|packed|dispatched)$"),
    notes: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can update outgoing status")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    outgoing = await outgoing_stock_repository.get_by_id(outgoing_id)
    if not outgoing or str(outgoing.get("warehouseId")) != str(warehouse["_id"]):
        raise HTTPException(status_code=404, detail="Outgoing record not found")
    if status != "dispatched":
        updated = await WarehouseService.update_outgoing_status(outgoing_id, status, str(warehouse["_id"]), {"notes": notes} if notes else None)
        if not updated:
            raise HTTPException(status_code=400, detail="Outgoing status update is not allowed")
        return {"success": True, "data": updated, "message": f"Outgoing status updated to {status}"}

    # Dispatch is an ORDER-level operation. A multi-product customer order
    # must leave the warehouse as one complete shipment; never dispatch only
    # the line that happened to be clicked in the UI.
    order_id = str(outgoing.get("orderId") or "")
    if not order_id:
        raise HTTPException(status_code=400, detail="Outgoing record is not linked to an order")
    order = await order_repository.get_by_id(order_id)
    if not order or str(order.get("warehouseId")) != str(warehouse["_id"]):
        raise HTTPException(status_code=404, detail="Warehouse order not found")
    all_outgoing = await outgoing_stock_repository.find_many({
        "orderId": ObjectId(order_id), "warehouseId": ObjectId(str(warehouse["_id"])), "deletedAt": None
    }, skip=0, limit=1000)
    required = {(str(i.get("productId")), str(i.get("variantId") or "")): float(i.get("quantity") or 0) for i in (order.get("items") or [])}
    by_key = {(str(x.get("productId")), str(x.get("variantId") or "")): x for x in all_outgoing}
    missing=[]
    for key, qty in required.items():
        row=by_key.get(key)
        if not row or float(row.get("quantity") or 0) + 1e-9 < qty:
            missing.append({"productId":key[0],"variantId":key[1] or None,"required":qty,"outgoing":float((row or {}).get("quantity") or 0)})
        if row and str(row.get("deliveryPartnerRoute") or "") not in ("nearby","long_distance"):
            missing.append({"productId":key[0],"reason":"Delivery route not selected"})
    if missing:
        raise HTTPException(status_code=400, detail={"message":"This customer order cannot be dispatched because one or more order lines are incomplete.","missing":missing})
    if any(str(x.get("status") or "pending") == "dispatched" for x in all_outgoing) and not all(str(x.get("status") or "pending") == "dispatched" for x in all_outgoing):
        raise HTTPException(status_code=409, detail="This order is partially dispatched. Resolve the shipment before continuing.")
    dispatched=[]
    for row in all_outgoing:
        if str(row.get("status") or "pending") == "dispatched":
            dispatched.append(str(row["_id"]))
            continue
        updated = await WarehouseService.update_outgoing_status(str(row["_id"]), "dispatched", str(warehouse["_id"]), {"notes": notes} if notes else None)
        if not updated:
            raise HTTPException(status_code=400, detail=f"Could not dispatch complete order line {row.get('productId')}")
        dispatched.append(str(row["_id"]))
    await order_repository.append_tracking_event(order_id, "warehouse_order_dispatched", "Complete customer order dispatched", "All packed customer-order lines were dispatched together from the warehouse.", actor_id=str(current_user["_id"]), actor_role="warehouse", metadata={"outgoingCount":len(dispatched),"route":outgoing.get("deliveryPartnerRoute")})
    return {"success":True,"data":{"orderId":order_id,"outgoingIds":dispatched},"message":"Complete customer order dispatched. No order line was left behind."}

class ShortageResolutionRequest(BaseModel):
    resolutionType: str = Field(
        ...,
        pattern="^(farmer_replenishment|customer_approval_pending|substitution_pending|refund_cancellation)$",
    )
    notes: Optional[str] = None
    resolvedQuantity: Optional[float] = Field(None, ge=0)
    approvedQuantity: Optional[float] = Field(None, ge=0)
    substituteProductId: Optional[str] = None
    substituteVariantId: Optional[str] = None


@router.put("/me/shortages/{shortage_id}/resolution")
async def update_shortage_resolution(
    shortage_id: str,
    data: ShortageResolutionRequest,
    current_user: dict = Depends(get_current_user),
):
    """Record and execute a shortage resolution for one affected order line.

    Available stock is never discarded. This endpoint only resolves the
    missing quantity; the packing task is then recalculated so already
    available quantity can continue through packing immediately.
    """
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can resolve shortage cases")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    from app.repositories.warehouse_shortage_repository import warehouse_shortage_repository
    case = await warehouse_shortage_repository.get_by_id(shortage_id)
    if not case or str(case.get("warehouseId")) != str(warehouse["_id"]):
        raise HTTPException(status_code=404, detail="Shortage case not found")
    if case.get("status") in ("resolved", "cancelled"):
        raise HTTPException(status_code=400, detail="Shortage case is already closed")

    required = float(case.get("requiredQuantity") or 0)
    available = float(case.get("availableQuantity") or 0)
    shortage = max(0.0, required - available)
    resolution = data.resolutionType

    if resolution == "farmer_replenishment":
        await warehouse_shortage_repository.update_case(shortage_id, {
            "resolutionType": resolution,
            "status": "replenishment_requested",
            "replenishmentQuantity": shortage,
            "notes": data.notes or "Farmer replenishment requested for the unresolved quantity.",
        })
        return {"success": True, "data": await warehouse_shortage_repository.get_by_id(shortage_id),
                "message": f"Replenishment requested for {shortage:g} kg. The available quantity remains packable."}

    if resolution == "customer_approval_pending":
        await warehouse_shortage_repository.update_case(shortage_id, {
            "resolutionType": resolution,
            "status": "customer_approval_pending",
            "proposedQuantity": data.approvedQuantity if data.approvedQuantity is not None else available,
            "notes": data.notes or "Customer approval is required for the reduced quantity.",
        })
        return {"success": True, "data": await warehouse_shortage_repository.get_by_id(shortage_id),
                "message": "Customer approval is pending. Available quantity remains reserved for this order."}

    if resolution == "substitution_pending":
        if not data.substituteProductId:
            raise HTTPException(status_code=400, detail="substituteProductId is required for substitution")
        if not ObjectId.is_valid(data.substituteProductId):
            raise HTTPException(status_code=400, detail="Invalid substitute product ID")
        await warehouse_shortage_repository.update_case(shortage_id, {
            "resolutionType": resolution,
            "status": "substitution_pending",
            "substituteProductId": ObjectId(data.substituteProductId),
            "substituteVariantId": ObjectId(data.substituteVariantId) if data.substituteVariantId else None,
            "proposedQuantity": shortage,
            "notes": data.notes or "Substitute product requires customer approval before packing.",
        })
        return {"success": True, "data": await warehouse_shortage_repository.get_by_id(shortage_id),
                "message": "Substitution proposal recorded. Customer approval is required."}

    if resolution == "refund_cancellation":
        if data.resolvedQuantity is None or data.resolvedQuantity <= 0:
            raise HTTPException(status_code=400, detail="resolvedQuantity is required for refund/cancellation")
        if data.resolvedQuantity > shortage + 1e-9:
            raise HTTPException(status_code=400, detail="Refund quantity cannot exceed the shortage")
        order = await order_repository.get_by_id(str(case["orderId"]))
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        # Do not silently alter the paid amount. Record the exact quantity
        # approved for cancellation/refund for the payment/refund workflow.
        new_available = available + float(data.resolvedQuantity)
        fully_resolved = new_available + 1e-9 >= required
        await warehouse_shortage_repository.update_case(shortage_id, {
            "resolutionType": resolution,
            "status": "resolved" if fully_resolved else "partial_allocation",
            "refundQuantity": float(data.resolvedQuantity),
            "availableQuantity": new_available,
            "remainingShortage": max(0.0, required - new_available),
            "resolvedAt": datetime.utcnow() if fully_resolved else None,
            "notes": data.notes or "Unfulfilled quantity marked for refund/cancellation processing.",
        })
        # Cancel/refund the unavailable portion of the customer order. The
        # physically packed quantity stays unchanged; only the order line and
        # payable amount are reduced.
        cancel_qty = float(data.resolvedQuantity)
        items = [dict(x) for x in (order.get("items") or [])]
        for item in items:
            if str(item.get("productId")) == str(case.get("productId")) and str(item.get("variantId") or "") == str(case.get("variantId") or ""):
                original_qty = float(item.get("quantity") or 0)
                if cancel_qty > max(0.0, original_qty - available) + 1e-9:
                    raise HTTPException(status_code=400, detail="Cancellation quantity exceeds the unresolved packed shortage")
                item["quantity"] = max(0.0, original_qty - cancel_qty)
                item["totalPrice"] = float(item.get("unitPrice") or 0) * item["quantity"]
                break
        items = [x for x in items if float(x.get("quantity") or 0) > 1e-9]
        final_subtotal = sum(float(x.get("totalPrice") or 0) for x in items)
        final_discount = min(float(order.get("discount") or 0), final_subtotal)
        final_total = max(0.0, final_subtotal + float(order.get("deliveryCharge") or 0) + float(order.get("platformFee") or 0) - final_discount)
        payment_method = str(order.get("paymentMethod") or "").lower()
        is_cod = payment_method in ("cash", "cod", "cash_on_delivery")
        order_update = {
            "items": items,
            "subtotal": final_subtotal,
            "discount": final_discount,
            "totalAmount": final_total,
            "finalPayableAmount": final_total,
            "shortageResolutionRequired": False if fully_resolved else True,
            "shortageResolved": fully_resolved,
            "warehouseFulfillmentStage": "packed" if fully_resolved else "shortage_pending",
            "shortagePaymentHandling": "cod_amount_reduced" if is_cod else "refund_required",
            "updatedAt": datetime.utcnow(),
        }
        if not is_cod and str(order.get("paymentStatus") or "").lower() == PaymentStatus.PAID.value:
            order_update["refundStatus"] = "pending"
            order_update["refundRequiredAmount"] = float(data.resolvedQuantity) * float(case.get("unitPrice") or 0)
        await order_repository.update({"_id": order["_id"]}, order_update)

        # Align the packing checklist with the final customer quantities after
        # cancellation/refund, so verification checks the final order, not the
        # original unavailable quantity.
        packing_task = await warehouse_packing_repository.get_by_order(str(case["orderId"]))
        if packing_task:
            final_lines = []
            for line in (packing_task.get("packingItems") or []):
                key_product = str(line.get("productId"))
                key_variant = str(line.get("variantId") or "")
                matched = next(
                    (x for x in items if str(x.get("productId")) == key_product and str(x.get("variantId") or "") == key_variant),
                    None,
                )
                final_required = float(matched.get("quantity") or 0) if matched else 0.0
                final_lines.append({
                    **line,
                    "quantityRequired": final_required,
                    "quantityShort": 0.0,
                    "packedQuantity": min(float(line.get("packedQuantity") or 0), final_required),
                    "verified": False,
                })
            await warehouse_packing_repository.update_task(
                str(packing_task["_id"]),
                {
                    "quantityRequired": sum(float(x.get("quantityRequired") or 0) for x in final_lines),
                    "packedQuantity": sum(float(x.get("packedQuantity") or 0) for x in final_lines),
                    "packingItems": final_lines,
                    "status": "packed",
                },
            )

        await order_repository.append_tracking_event(
            str(case["orderId"]),
            "shortage_refund_requested",
            "Short quantity marked for refund/cancellation",
            f"{data.resolvedQuantity:g} kg of shortage was marked for refund/cancellation.",
            actor_id=str(current_user["_id"]),
            actor_role="warehouse",
            metadata={"shortageId": shortage_id, "quantity": float(data.resolvedQuantity)},
        )
        await WarehouseService.ensure_order_packing_task(str(case["orderId"]), str(warehouse["_id"]))
        return {"success": True, "data": await warehouse_shortage_repository.get_by_id(shortage_id),
                "message": "Short quantity recorded for refund/cancellation and packing was recalculated."}

    raise HTTPException(status_code=400, detail="Unsupported shortage resolution")


@router.get("/me/shortages")
async def get_my_shortages(
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can access shortage cases")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    from app.repositories.warehouse_shortage_repository import warehouse_shortage_repository
    cases = await warehouse_shortage_repository.get_by_warehouse(str(warehouse["_id"]), status_filter)
    for case in cases:
        case["id"] = str(case["_id"])
        for key in ("orderId", "warehouseId", "productId", "variantId"):
            if case.get(key) is not None:
                case[key] = str(case[key])
    return {"success": True, "data": {"shortages": cases}}


@router.get("/me/cold-storage", response_model=dict)
async def get_my_cold_storage(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can access this endpoint"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    skip = (page - 1) * limit
    storage, total = await WarehouseService.get_cold_storage(
        str(warehouse["_id"]),
        skip,
        limit
    )
    for item in storage:
        item["id"] = str(item["_id"])
    return {
        "success": True,
        "data": {
            "coldStorage": storage,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit
            }
        }
    }

@router.post("/me/cold-storage", response_model=ColdStorageResponse)
async def add_cold_storage(
    data: ColdStorageCreate,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can add to cold storage"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    data.warehouseId = str(warehouse["_id"])
    storage = await WarehouseService.add_cold_storage(data)
    if not storage:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to add cold storage item"
        )
    storage["id"] = str(storage["_id"])
    return storage

@router.get("/me/transfers", response_model=dict)
async def get_my_transfers(
    status: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can access this endpoint"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    skip = (page - 1) * limit
    transfers, total = await WarehouseService.get_transfers(
        str(warehouse["_id"]),
        status,
        skip,
        limit
    )
    for item in transfers:
        item["id"] = str(item["_id"])
    return {
        "success": True,
        "data": {
            "transfers": transfers,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit
            }
        }
    }

@router.post("/me/transfers", response_model=WarehouseTransferResponse)
async def create_transfer(
    data: WarehouseTransferCreate,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can create transfers"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    data.fromWarehouseId = str(warehouse["_id"])
    transfer = await WarehouseService.create_transfer(data)
    if not transfer:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to create transfer. Insufficient stock or invalid destination."
        )
    transfer["id"] = str(transfer["_id"])
    return transfer

@router.put("/me/transfers/{transfer_id}/complete")
async def complete_transfer(
    transfer_id: str,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can complete transfers"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    transfer = await WarehouseService.complete_transfer(
        transfer_id,
        str(current_user["_id"]),
        str(warehouse["_id"])
    )
    if not transfer:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to complete transfer"
        )
    return {
        "success": True,
        "data": transfer,
        "message": "Transfer completed successfully"
    }

@router.get("/admin", response_model=dict)
async def get_all_warehouses(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    is_active: Optional[bool] = True,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can access this endpoint"
        )
    skip = (page - 1) * limit
    warehouses = await warehouse_repository.get_all_warehouses(
        is_active, skip, limit
    )
    total = await warehouse_repository.count({
        "deletedAt": None,
        "isActive": is_active if is_active is not None else True
    })
    for warehouse in warehouses:
        warehouse["id"] = str(warehouse["_id"])
    return {
        "success": True,
        "data": {
            "warehouses": warehouses,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit
            }
        }
    }

@router.post("/admin", response_model=WarehouseResponse)
async def create_warehouse(
    data: WarehouseCreate,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can create warehouses"
        )
    warehouse = await WarehouseService.create_warehouse(data)
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to create warehouse"
        )
    warehouse["id"] = str(warehouse["_id"])
    return warehouse

@router.get("/admin/{warehouse_id}", response_model=WarehouseResponse)
async def get_warehouse(
    warehouse_id: str,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can access this endpoint"
        )
    warehouse = await WarehouseService.get_warehouse(warehouse_id)
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    warehouse["id"] = str(warehouse["_id"])
    return warehouse

@router.get("/admin/stats")
async def get_warehouse_stats(
    period: str = Query("month", description="day, week, month"),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can access this endpoint"
        )
    warehouses = await warehouse_repository.find_many({"deletedAt": None})
    total_warehouses = len(warehouses)
    active_warehouses = len([w for w in warehouses if w.get("isActive")])
    total_capacity = sum(w.get("totalCapacity", 0) for w in warehouses)
    total_used = sum(w.get("usedCapacity", 0) for w in warehouses)
    total_cold_capacity = sum(w.get("coldStorageCapacity", 0) for w in warehouses)
    total_cold_used = sum(w.get("coldStorageUsed", 0) for w in warehouses)
    return {
        "success": True,
        "data": {
            "summary": {
                "totalWarehouses": total_warehouses,
                "activeWarehouses": active_warehouses,
                "totalCapacity": total_capacity,
                "usedCapacity": total_used,
                "capacityUtilization": round((total_used / total_capacity * 100) if total_capacity > 0 else 0, 1),
                "coldCapacity": total_cold_capacity,
                "coldUsed": total_cold_used,
                "coldUtilization": round((total_cold_used / total_cold_capacity * 100) if total_cold_capacity > 0 else 0, 1)
            }
        }
    }