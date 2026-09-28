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
    pid = plan.get("productId")
    bid = None
    batch = await _latest(batches, {"farmerId": _id(uid), "sourceHarvestPlanId": plan["_id"], "deletedAt": None}, "createdAt")
    if batch:
        bid = batch["_id"]
    if plan.get("status") != "harvested":
        if plan.get("status") == "preorder":
            return {"currentStep": "Pre-orders / Ready for Harvest", "state": "IN_PROGRESS", "next": _href("/farmer/harvest-planner", "Open Harvest Planner", "Pre-orders are open; record the actual harvest when the crop is harvested."), "entityId": str(plan["_id"])}
        return {"currentStep": "Crop Planning / Growing", "state": "IN_PROGRESS", "next": _href("/farmer/harvest-planner", "Continue Crop Plan", "Continue the active crop plan."), "entityId": str(plan["_id"])}
    if not batch:
        return {"currentStep": "Harvest Completed", "state": "ACTION_REQUIRED", "next": _href(f"/farmer/batches?fromHarvest={plan['_id']}", "Create Batch", "The harvest is complete. Create its traceable batch before quality inspection."), "entityId": str(plan["_id"])}
    inspection = await _latest(quality, {"batchId": batch["_id"], "deletedAt": None}, "createdAt")
    if not inspection or inspection.get("verificationStatus") not in ("verified", "approved", "buyer_verified"):
        return {"currentStep": "Batch Created", "state": "ACTION_REQUIRED", "next": _href(f"/farmer/quality?batchId={batch['_id']}", "Quality Inspection", "The batch is waiting for quality evidence and verification."), "entityId": str(batch["_id"])}
    product = None
    if pid:
        product = await products.get_by_id(str(pid))
    if not product:
        product = await _latest(products, {"farmerId": _id(uid), "sourceHarvestPlanId": plan["_id"], "deletedAt": None}, "createdAt")
    if not product:
        return {"currentStep": "Quality Approved", "state": "ACTION_REQUIRED", "next": _href(f"/farmer/products/new?fromHarvest={plan['_id']}&name={plan.get('cropName','')}&quantity={plan.get('actualQuantityKg',0)}&price={plan.get('finalRatePerKg',0)}&harvestDate={str(plan.get('harvestedAt',''))}", "Create Product", "Quality is approved. Publish the harvest as a marketplace product."), "entityId": str(batch["_id"])}
    qty = float(product.get("quantity", 0) or 0)
    if qty > 0:
        return {"currentStep": "Inventory / Orders", "state": "IN_PROGRESS", "next": _href("/farmer/orders", "Process Orders", "Your product is linked to inventory. Continue with incoming orders."), "entityId": str(product.get("_id"))}
    return {"currentStep": "Product Created", "state": "ACTION_REQUIRED", "next": _href("/farmer/restock", "Review Inventory", "Review the product inventory and availability."), "entityId": str(product.get("_id"))}

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
    rfq = await _latest(rfqs, {"businessId": _id(uid), "deletedAt": None}, "updatedAt")
    if not rfq:
        return {"currentStep": "Business Setup", "state": "ACTION_REQUIRED", "next": _href("/business/rfqs/new", "Create RFQ", "Create your first structured bulk request.")}
    status = str(rfq.get("status") or "").lower()
    if status in ("open", "published", "active"):
        return {"currentStep": "RFQ Published", "state": "IN_PROGRESS", "next": _href("/business/quotes", "Review Farmer Quotes", "Review incoming quotations for the active RFQ."), "entityId": str(rfq["_id"])}
    return {"currentStep": "B2B Orders", "state": "IN_PROGRESS", "next": _href("/business/orders", "Open B2B Orders", "Continue the B2B fulfillment process."), "entityId": str(rfq["_id"])}

async def _delivery(uid: str):
    job = await _latest(delivery_jobs, {"partnerId": _id(uid), "deletedAt": None}, "updatedAt")
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
    return {"currentStep": "Inventory Operations", "state": "ACTION_REQUIRED", "next": _href("/warehouse/incoming", "Review Incoming Stock", "Receive and verify incoming warehouse stock.")}

async def _admin(uid: str):
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
