"""State-aware workflow resolver for the AgriConnect guided UX.

This endpoint does not replace role pages. It reads the existing domain records and
returns the user's current workflow step and the next actionable destination.
"""
from datetime import datetime
from typing import Any, Dict
from bson import ObjectId
from fastapi import APIRouter, Depends
from app.api.v1.auth import get_current_user
from app.repositories.base_repository import BaseRepository

router = APIRouter()
harvests = BaseRepository("harvest_plans")
batches = BaseRepository("batches")
quality = BaseRepository("quality_inspections")
products = BaseRepository("products")
orders = BaseRepository("orders")
preorders = BaseRepository("harvest_preorders")
rfqs = BaseRepository("b2b_rfqs")
delivery_jobs = BaseRepository("delivery_jobs")
addresses = BaseRepository("addresses")

def _id(v: Any):
    try:
        return ObjectId(str(v))
    except Exception:
        return None

def _href(path: str, label: str, reason: str):
    return {"label": label, "href": path, "reason": reason}

async def _latest(repo, query: Dict[str, Any], sort_field: str = "createdAt"):
    rows = await repo.find_many(query, limit=20, sort=[(sort_field, -1)])
    return rows[0] if rows else None

async def _farmer(uid: str):
    plan = await _latest(harvests, {"farmerId": _id(uid), "deletedAt": None}, "updatedAt")
    if not plan:
        return {"currentStep": "Farm Setup", "state": "ACTION_REQUIRED", "next": _href("/farmer/dashboard", "Complete Farm Setup", "Create your farm profile before planning a crop.")}
    if plan.get("status") != "harvested":
        if plan.get("status") == "preorder":
            return {"currentStep": "Pre-orders / Ready for Harvest", "state": "IN_PROGRESS", "next": _href("/farmer/harvest-planner", "Open Harvest Planner", "Pre-orders are open; record the actual harvest when the crop is harvested."), "entityId": str(plan["_id"])}
        return {"currentStep": "Crop Planning / Growing", "state": "IN_PROGRESS", "next": _href("/farmer/harvest-planner", "Continue Crop Plan", "Continue the active crop plan."), "entityId": str(plan["_id"])}

    batch = await _latest(batches, {"farmerId": _id(uid), "sourceHarvestPlanId": plan["_id"], "deletedAt": None}, "createdAt")
    if not batch:
        return {"currentStep": "Harvest Completed", "state": "ACTION_REQUIRED",
                "next": _href(f"/farmer/batches?fromHarvest={plan['_id']}", "Create Batch", "The harvest is complete. Create its traceable batch before quality inspection."),
                "entityId": str(plan["_id"])}

    inspection = await _latest(quality, {"batchId": batch["_id"], "deletedAt": None}, "createdAt")
    verification = str((inspection or {}).get("verificationStatus") or "").lower()
    if not inspection or verification not in ("verified", "approved", "buyer_verified"):
        return {"currentStep": "Batch Created", "state": "ACTION_REQUIRED",
                "next": _href(f"/farmer/quality?batchId={batch['_id']}", "Quality Inspection", "The batch is waiting for independent quality inspection and human approval."),
                "entityId": str(batch["_id"])}

    product = None
    if plan.get("productId"):
        product = await products.get_by_id(str(plan["productId"]))
    if not product:
        product = await _latest(products, {"farmerId": _id(uid), "sourceHarvestPlanId": plan["_id"], "deletedAt": None}, "createdAt")
    if not product:
        from urllib.parse import quote
        crop = quote(str(plan.get("cropName") or ""))
        return {"currentStep": "Quality Approved", "state": "ACTION_REQUIRED",
                "next": _href(f"/farmer/products/new?fromHarvest={plan['_id']}&name={crop}&quantity={plan.get('actualQuantityKg',0)}&price={plan.get('finalRatePerKg',0)}&harvestDate={str(plan.get('harvestedAt',''))}",
                              "Create Product", "Quality is approved. Create the customer-facing product from the verified harvest."),
                "entityId": str(batch["_id"])}

    if str(product.get("qualityStatus") or "").lower() not in ("approved", "verified"):
        return {"currentStep": "Product Created", "state": "IN_PROGRESS",
                "next": _href(f"/farmer/quality?batchId={batch['_id']}", "Review Quality Approval", "The product is still waiting for the verified quality gate."),
                "entityId": str(product["_id"])}
    return {"currentStep": "Inventory / Marketplace", "state": "IN_PROGRESS",
            "next": _href("/farmer/restock", "Review Inventory", "The verified product is ready for inventory and marketplace availability."),
            "entityId": str(product["_id"]), "availableQuantity": float(product.get("quantity", 0) or 0)}

async def _customer(uid: str):
    po = await _latest(preorders, {"customerId": _id(uid), "deletedAt": None}, "updatedAt")
    if po and po.get("status") in ("ready_for_confirmation", "confirmed"):
        if po.get("status") == "ready_for_confirmation":
            return {"currentStep": "Harvest Ready", "state": "ACTION_REQUIRED", "next": _href(f"/customer/harvests/preorders/{po['_id']}/checkout", "Confirm & Pay", "Your pre-order is ready for confirmation and payment."), "entityId": str(po["_id"])}
    order = await _latest(orders, {"customerId": _id(uid), "deletedAt": None}, "createdAt")
    if not order:
        return {"currentStep": "Browse", "state": "ACTION_REQUIRED", "next": _href("/customer/products", "Browse Products", "Start by choosing produce from the marketplace.")}
    status = str(order.get("orderStatus") or "").lower()
    if status in ("delivered", "completed"):
        return {"currentStep": "Delivered", "state": "ACTION_REQUIRED", "next": _href("/customer/orders", "Review Order", "Your order is completed and ready for review.")}
    return {"currentStep": "Order Tracking", "state": "IN_PROGRESS", "next": _href("/customer/orders", "Track Order", "Continue tracking your active order."), "entityId": str(order["_id"])}

async def _business(uid: str):
    rfq = await _latest(rfqs, {"businessUserId": _id(uid), "deletedAt": None}, "updatedAt")
    if not rfq:
        return {"currentStep": "Business Setup", "state": "ACTION_REQUIRED", "next": _href("/business/rfqs/new", "Create RFQ", "Create your first structured bulk request.")}
    status = str(rfq.get("status") or "").lower()
    if status in ("open", "published", "active"):
        return {"currentStep": "RFQ Published", "state": "IN_PROGRESS", "next": _href("/business/quotes", "Review Farmer Quotes", "Review incoming quotations for the active RFQ."), "entityId": str(rfq["_id"])}
    return {"currentStep": "B2B Orders", "state": "IN_PROGRESS", "next": _href("/business/orders", "Open B2B Orders", "Continue the B2B fulfillment process."), "entityId": str(rfq["_id"])}

async def _delivery(uid: str):
    job = await _latest(delivery_jobs, {"acceptedBy": _id(uid), "deletedAt": None}, "updatedAt")
    if not job:
        return {"currentStep": "Availability", "state": "ACTION_REQUIRED", "next": _href("/delivery/dashboard", "View Delivery Jobs", "Check available delivery assignments.")}
    status = str(job.get("status") or "").lower()
    if status in ("open", "pending", "offered"):
        return {"currentStep": "Assignment", "state": "ACTION_REQUIRED", "next": _href("/delivery/dashboard", "Accept Delivery", "Review and accept the available delivery job."), "entityId": str(job["_id"])}
    if status in ("accepted", "assigned"):
        return {"currentStep": "Pickup", "state": "ACTION_REQUIRED", "next": _href("/delivery/deliveries", "Start Pickup", "Verify and collect the order."), "entityId": str(job["_id"])}
    if status in ("picked_up", "dispatched", "in_transit"):
        return {"currentStep": "Delivery", "state": "ACTION_REQUIRED", "next": _href("/delivery/deliveries", "Continue Delivery", "Update route and delivery status."), "entityId": str(job["_id"])}
    return {"currentStep": "Completed", "state": "COMPLETED", "next": _href("/delivery/earnings", "View Earnings", "Review completed delivery earnings."), "entityId": str(job["_id"])}

async def _warehouse(uid: str):
    warehouse = await BaseRepository("warehouses").find_one({"managerId": _id(uid), "deletedAt": None})
    if not warehouse:
        return {"currentStep": "Warehouse Setup", "state": "ACTION_REQUIRED", "next": _href("/warehouse/settings", "Complete Warehouse Setup", "Set up the warehouse profile before processing stock.")}
    wid = warehouse["_id"]
    incoming = await BaseRepository("incoming_stock").find_many({"warehouseId": wid, "deletedAt": None}, limit=20, sort=[("updatedAt", -1)])
    pending = next((x for x in incoming if str(x.get("status") or "").lower() in ("scheduled", "in_transit", "quality_check")), None)
    if pending:
        status = str(pending.get("status") or "").lower()
        if status in ("scheduled", "in_transit"):
            return {"currentStep": "Incoming Stock", "state": "ACTION_REQUIRED", "next": _href("/warehouse/incoming", "Receive Incoming Stock", "An incoming shipment is waiting to be received and verified."), "entityId": str(pending["_id"])}
        return {"currentStep": "Quality Check", "state": "ACTION_REQUIRED", "next": _href("/warehouse/incoming", "Complete Quality Check", "Received stock requires quality verification before storage."), "entityId": str(pending["_id"])}
    outgoing = await BaseRepository("outgoing_stock").find_many({"warehouseId": wid, "deletedAt": None}, limit=20, sort=[("updatedAt", -1)])
    pending_out = next((x for x in outgoing if str(x.get("status") or "").lower() in ("pending", "picked", "packed")), None)
    if pending_out:
        return {"currentStep": "Pick & Pack", "state": "ACTION_REQUIRED", "next": _href("/warehouse/stock", "Pick & Pack Order", "Warehouse stock is reserved for an outgoing order."), "entityId": str(pending_out["_id"])}
    return {"currentStep": "Inventory", "state": "IN_PROGRESS", "next": _href("/warehouse/stock", "Review Warehouse Inventory", "Review current stock, storage and outgoing reservations.")}

async def _admin(uid: str):
    unverified = await quality.find_many({"verificationStatus": {"$in": ["declared", "evidence_submitted"]}, "deletedAt": None}, limit=1)
    if unverified:
        return {"currentStep": "Quality Review", "state": "ACTION_REQUIRED", "next": _href("/admin/dashboard", "Review Quality Queue", "A quality inspection is waiting for independent verification."), "entityId": str(unverified[0]["_id"])}
    pending_orders = await orders.find_many({"orderStatus": {"$in": ["pending", "confirmed", "processing"]}, "deletedAt": None}, limit=1)
    if pending_orders:
        return {"currentStep": "Order Operations", "state": "IN_PROGRESS", "next": _href("/admin/orders", "Review Orders", "There are active orders requiring platform oversight."), "entityId": str(pending_orders[0]["_id"])}
    return {"currentStep": "Platform Overview", "state": "IN_PROGRESS", "next": _href("/admin/dashboard", "Open Platform Overview", "Review platform workflow and operational alerts.")}

@router.get("/me")
async def get_my_workflow(current_user: dict = Depends(get_current_user)):
    uid = str(current_user["_id"])
    role = str(current_user.get("role") or "customer").lower()
    resolver = {"farmer": _farmer, "customer": _customer, "business": _business, "delivery": _delivery, "warehouse": _warehouse, "admin": _admin}.get(role, _customer)
    result = await resolver(uid)
    return {"success": True, "role": role, "data": result, "updatedAt": datetime.utcnow().isoformat()}

@router.get("/entity/{entity_type}/{entity_id}")
async def get_entity_workflow(entity_type: str, entity_id: str, current_user: dict = Depends(get_current_user)):
    """Return a compact workflow relationship for a traceable entity."""
    oid = _id(entity_id)
    if not oid:
        return {"success": True, "data": {"entityType": entity_type, "entityId": entity_id, "next": None}}
    result = {"entityType": entity_type, "entityId": entity_id, "next": None}
    if entity_type == "harvest":
        plan = await harvests.get_by_id(entity_id)
        if plan:
            batch = await batches.find_one({"sourceHarvestPlanId": oid, "deletedAt": None})
            result["next"] = _href(f"/farmer/batches?fromHarvest={entity_id}", "Create Batch", "Create the traceable batch.") if not batch else _href(f"/farmer/quality?batchId={batch['_id']}", "Quality Inspection", "Inspect the batch.")
    elif entity_type == "batch":
        result["next"] = _href(f"/farmer/quality?batchId={entity_id}", "Quality Inspection", "Inspect the harvest batch.")
    elif entity_type == "order":
        result["next"] = _href(f"/customer/orders/{entity_id}", "Open Order", "Continue order fulfillment.")
    return {"success": True, "data": result}
