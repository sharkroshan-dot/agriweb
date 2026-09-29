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
warehouse_incoming = BaseRepository("incoming_stock")
warehouse_outgoing = BaseRepository("outgoing_stock")
warehouse_stock = BaseRepository("warehouse_stock")
b2b_orders = BaseRepository("b2b_orders")


ROLE_STEPS = {
    "farmer": ["Farm Setup","Crop Planning","Growing","Pre-orders","Harvest","Batch","Quality","Product","Inventory","Orders","Delivery","Earnings"],
    "customer": ["Browse","Product","Address","Delivery Fee","Checkout","Payment","Order","Tracking","Delivery","Review"],
    "delivery": ["Availability","Assignment","Accept","Pickup","Verify","Dispatch","Route","Delivery","Proof","Completed","Earnings"],
    "warehouse": ["Warehouse Setup","Incoming Stock","Receive","Batch Verification","Quality","Storage","Inventory","Pick","Pack","Dispatch","Transfer"],
    "business": ["Business Setup","Category","RFQ","Farmer Quotes","Compare Quotes","Select Quote","Contract","B2B Order","Payment","Fulfillment","Delivery","Completion"],
    "admin": ["Overview","Users","Farmers","Products","Harvests","Batches","Quality","Inventory","Orders","Payments","Delivery","Warehouse","Complaints","Settlements","Analytics","AI","Audit"],
}

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

    verification = str(product.get("verificationStatus") or product.get("qualityStatus") or "").lower()
    if verification not in ("verified", "buyer_verified", "approved"):
        return {"currentStep": "Product Created", "state": "IN_PROGRESS",
                "next": _href(f"/farmer/quality?batchId={batch['_id']}", "Review Quality Approval", "The product is still waiting for the verified quality gate."),
                "entityId": str(product["_id"])}
    return {"currentStep": "Inventory / Marketplace", "state": "IN_PROGRESS",
            "next": _href("/farmer/restock", "Review Inventory", "The verified product is ready for inventory and marketplace availability."),
            "entityId": str(product["_id"]), "availableQuantity": float(product.get("availableQuantity", product.get("quantity", 0)) or 0)}

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
        return {"currentStep": "Review", "state": "ACTION_REQUIRED", "next": _href("/customer/reviews", "Review Order", "Your order is completed and ready for review.")}
    return {"currentStep": "Order Tracking", "state": "IN_PROGRESS", "next": _href("/orders", "Track Order", "Continue tracking your active order."), "entityId": str(order["_id"])}

async def _business(uid: str):
    rfq = await _latest(rfqs, {"businessUserId": _id(uid), "deletedAt": None}, "updatedAt")
    if not rfq:
        return {"currentStep": "Business Setup", "state": "ACTION_REQUIRED", "next": _href("/business/rfqs/new", "Create RFQ", "Create a structured bulk request with a product category.")}
    status = str(rfq.get("status") or "").lower()
    if status in ("open", "published", "active"):
        return {"currentStep": "RFQ Published", "state": "ACTION_REQUIRED", "next": _href(f"/business/rfqs/{rfq['_id']}", "Review Farmer Quotes", "Review and compare farmer offers before awarding the RFQ."), "entityId": str(rfq["_id"])}
    order = await _latest(b2b_orders, {"businessUserId": _id(uid), "deletedAt": None}, "createdAt")
    if not order:
        return {"currentStep": "RFQ Awarded", "state": "ACTION_REQUIRED", "next": _href("/business/rfqs", "Review Awarded RFQ", "Review the selected offer and proceed to the B2B order."), "entityId": str(rfq["_id"])}
    status = str(order.get("status") or order.get("orderStatus") or "").lower()
    if status not in ("completed", "delivered"):
        return {"currentStep": "B2B Fulfillment", "state": "IN_PROGRESS", "next": _href("/business/orders", "Continue B2B Order", "Continue preparing, quality checking, dispatching or receiving the order."), "entityId": str(order["_id"])}
    return {"currentStep": "B2B Completed", "state": "COMPLETED", "next": _href("/business/orders", "Review B2B Order", "Review the completed order and invoice."), "entityId": str(order["_id"])}

async def _delivery(uid: str):
    job = await _latest(delivery_jobs, {"acceptedBy": _id(uid), "deletedAt": None}, "updatedAt")
    if not job:
        job = await _latest(delivery_jobs, {"partnerId": _id(uid), "deletedAt": None}, "updatedAt")
    if not job:
        job = await _latest(delivery_jobs, {"assignedTo": _id(uid), "deletedAt": None}, "updatedAt")
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
    incoming = await _latest(warehouse_incoming, {"deletedAt": None, "status": {"$nin": ["received", "completed", "cancelled"]}}, "updatedAt")
    if incoming:
        status = str(incoming.get("status") or "pending").lower()
        if status in ("pending","created","in_transit"):
            return {"currentStep":"Incoming Stock","state":"ACTION_REQUIRED","next":_href("/warehouse/incoming","Receive Incoming Stock","Receive the shipment before it can enter warehouse inventory."),"entityId":str(incoming["_id"])}
        if status in ("received","received_pending_quality"):
            return {"currentStep":"Batch Verification","state":"ACTION_REQUIRED","next":_href("/warehouse/incoming","Verify Batch","Verify traceability and quality before storage."),"entityId":str(incoming["_id"])}
    outgoing = await _latest(warehouse_outgoing, {"deletedAt": None, "status": {"$nin": ["completed","cancelled"]}}, "updatedAt")
    if outgoing:
        status = str(outgoing.get("status") or "").lower()
        if status in ("pending","created","picking"):
            return {"currentStep":"Pick & Pack","state":"ACTION_REQUIRED","next":_href("/warehouse/stock","Pick & Pack","Prepare the requested stock for dispatch."),"entityId":str(outgoing["_id"])}
        if status in ("packed","ready","ready_for_dispatch"):
            return {"currentStep":"Dispatch","state":"ACTION_REQUIRED","next":_href("/warehouse/stock","Dispatch Shipment","Release the packed shipment to delivery."),"entityId":str(outgoing["_id"])}
        if status == "dispatched":
            return {"currentStep":"Transfer","state":"IN_PROGRESS","next":_href("/warehouse/stock","Track Transfer","The shipment is with delivery operations."),"entityId":str(outgoing["_id"])}
    return {"currentStep":"Inventory","state":"IN_PROGRESS","next":_href("/warehouse/stock","Review Inventory","Review warehouse stock and incoming/outgoing operations.")}



async def _admin(uid: str):
    unverified = await quality.find_many({"verificationStatus": {"$in": ["declared", "evidence_submitted"]}, "deletedAt": None}, limit=1)
    if unverified:
        return {"currentStep": "Quality Review", "state": "ACTION_REQUIRED", "next": _href("/admin/dashboard", "Review Quality Queue", "A quality inspection is waiting for independent verification."), "entityId": str(unverified[0]["_id"])}
    pending_orders = await orders.find_many({"orderStatus": {"$in": ["pending", "confirmed", "processing"]}, "deletedAt": None}, limit=1)
    if pending_orders:
        return {"currentStep": "Order Operations", "state": "IN_PROGRESS", "next": _href("/admin/dashboard", "Review Orders", "There are active orders requiring platform oversight."), "entityId": str(pending_orders[0]["_id"])}
    return {"currentStep": "Platform Overview", "state": "IN_PROGRESS", "next": _href("/admin/dashboard", "Open Platform Overview", "Review platform workflow and operational alerts.")}

async def _resolve_entity(entity_type: str, oid):
    repos = {
        "harvest": harvests,
        "batch": batches,
        "quality": quality,
        "product": products,
        "order": orders,
        "preorder": preorders,
        "rfq": rfqs,
        "delivery": delivery_jobs,
    }
    repo = repos.get(entity_type.lower())
    if not repo:
        return None
    return await repo.get_by_id(str(oid))

@router.get("/me")
async def get_my_workflow(current_user: dict = Depends(get_current_user)):
    uid = str(current_user["_id"])
    role = str(current_user.get("role") or "customer").lower()
    resolver = {"farmer": _farmer, "customer": _customer, "business": _business, "delivery": _delivery, "warehouse": _warehouse, "admin": _admin}.get(role, _customer)
    result = await resolver(uid)
    result["steps"] = ROLE_STEPS.get(role, ROLE_STEPS["customer"])
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
        result["next"] = _href("/customer/orders", "Open Order", "Continue order fulfillment.")
    elif entity_type == "rfq":
        result["next"] = _href(f"/business/rfqs/{entity_id}", "Open RFQ", "Continue quote selection and award.")
    elif entity_type == "delivery":
        result["next"] = _href("/delivery/deliveries", "Open Delivery", "Continue pickup, dispatch, route and proof of delivery.")
    return {"success": True, "data": result}
