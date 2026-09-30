"""State-aware workflow orchestration for AgriConnect.

The domain APIs remain the source of truth for mutations.  This router is the
read-side orchestration layer: it inspects real domain records and exposes one
common state model and the next actionable destination for every role.

Common states:
    NOT_STARTED -> IN_PROGRESS -> ACTION_REQUIRED -> COMPLETED
                                   \-> BLOCKED

No workflow step is advanced by this endpoint; the existing domain endpoint
must perform the actual operation.  This keeps the guide safe and idempotent.
"""
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from urllib.parse import quote

from bson import ObjectId
from fastapi import APIRouter, Depends

from app.api.v1.auth import get_current_user
from app.repositories.base_repository import BaseRepository
from app.services.warehouse_service import WarehouseService

router = APIRouter()

harvests = BaseRepository("harvest_plans")
batches = BaseRepository("batches")
quality = BaseRepository("quality_inspections")
products = BaseRepository("products")
orders = BaseRepository("orders")
preorders = BaseRepository("harvest_preorders")
rfqs = BaseRepository("b2b_rfqs")
b2b_orders = BaseRepository("b2b_orders")
delivery_jobs = BaseRepository("delivery_jobs")
warehouse_incoming = BaseRepository("incoming_stock")
warehouse_outgoing = BaseRepository("outgoing_stock")

NOT_STARTED = "NOT_STARTED"
IN_PROGRESS = "IN_PROGRESS"
ACTION_REQUIRED = "ACTION_REQUIRED"
COMPLETED = "COMPLETED"
BLOCKED = "BLOCKED"
STATES = (NOT_STARTED, IN_PROGRESS, ACTION_REQUIRED, COMPLETED, BLOCKED)

ROLE_STEPS = {
    "farmer": [
        ("farm_setup", "Farm Setup", "/farmer/dashboard"),
        ("crop_planning", "Crop Planning", "/farmer/harvest-planner"),
        ("growing", "Growing", "/farmer/harvest-planner"),
        ("preorders", "Pre-orders", "/farmer/harvest-planner"),
        ("harvest", "Harvest", "/farmer/harvest-planner"),
        ("batch", "Batch", "/farmer/batches"),
        ("quality", "Quality", "/farmer/quality"),
        ("product", "Product", "/farmer/products"),
        ("inventory", "Inventory", "/farmer/restock"),
        ("orders", "Orders", "/farmer/orders"),
        ("delivery", "Delivery", "/farmer/order-map"),
        ("earnings", "Earnings", "/farmer/earnings"),
    ],
    "customer": [
        ("browse", "Browse", "/nearby"),
        ("product", "Product", "/nearby"),
        ("address", "Address", "/profile"),
        ("delivery_fee", "Delivery Fee", "/checkout"),
        ("checkout", "Checkout", "/checkout"),
        ("payment", "Payment", "/checkout"),
        ("order", "Order", "/orders"),
        ("tracking", "Tracking", "/orders"),
        ("delivery", "Delivery", "/orders"),
        ("review", "Review", "/reviews"),
    ],
    "delivery": [
        ("availability", "Availability", "/delivery/dashboard"),
        ("assignment", "Assignment", "/delivery/dashboard"),
        ("accept", "Accept", "/delivery/dashboard"),
        ("pickup", "Pickup", "/delivery/deliveries"),
        ("verify", "Verify", "/delivery/deliveries"),
        ("dispatch", "Dispatch", "/delivery/route"),
        ("route", "Route", "/delivery/route"),
        ("delivery", "Delivery", "/delivery/deliveries"),
        ("proof", "Proof", "/delivery/deliveries"),
        ("completed", "Completed", "/delivery/deliveries"),
        ("earnings", "Earnings", "/delivery/earnings"),
    ],
    "warehouse": [
        ("warehouse_setup", "Warehouse Setup", "/warehouse/settings"),
        ("incoming", "Incoming Stock", "/incoming"),
        ("receive", "Receive", "/incoming"),
        ("batch_verification", "Batch Verification", "/incoming"),
        ("quality", "Quality", "/warehouse/quality-inspection"),
        ("storage", "Storage", "/stock"),
        ("inventory", "Inventory", "/stock"),
        ("pick", "Pick", "/stock"),
        ("pack", "Pack", "/stock"),
        ("dispatch", "Dispatch", "/stock"),
        ("transfer", "Transfer", "/transfers"),
    ],
    "business": [
        ("business_setup", "Business Setup", "/business/dashboard"),
        ("category", "Category", "/business/rfqs/new"),
        ("rfq", "RFQ", "/business/rfqs/new"),
        ("farmer_quotes", "Farmer Quotes", "/business/quotes"),
        ("compare_quotes", "Compare Quotes", "/business/quotes"),
        ("select_quote", "Select Quote", "/business/quotes"),
        ("contract", "Contract", "/business/contracts"),
        ("b2b_order", "B2B Order", "/business/orders"),
        ("payment", "Payment", "/business/orders"),
        ("fulfillment", "Fulfillment", "/business/orders"),
        ("delivery", "Delivery", "/business/orders"),
        ("completion", "Completion", "/business/orders"),
    ],
    "admin": [
        ("overview", "Overview", "/admin/dashboard"),
        ("users", "Users", "/admin/users"),
        ("farmers", "Farmers", "/admin/farmers"),
        ("products", "Products", "/admin/products"),
        ("harvests", "Harvests", "/admin/dashboard"),
        ("batches", "Batches", "/admin/dashboard"),
        ("quality", "Quality", "/admin/dashboard"),
        ("inventory", "Inventory", "/admin/inventory"),
        ("orders", "Orders", "/admin/orders"),
        ("payments", "Payments", "/admin/payments"),
        ("delivery", "Delivery", "/admin/delivery"),
        ("warehouse", "Warehouse", "/admin/warehouse"),
        ("complaints", "Complaints", "/admin/complaints"),
        ("settlements", "Settlements", "/admin/settlements"),
        ("analytics", "Analytics", "/admin/analytics"),
        ("ai", "AI", "/admin/ai"),
        ("audit", "Audit", "/admin/audit"),
    ],
}

def _id(value: Any) -> Optional[ObjectId]:
    try:
        return ObjectId(str(value))
    except Exception:
        return None

async def _latest(repo: BaseRepository, query: Dict[str, Any], sort_field: str = "updatedAt"):
    rows = await repo.find_many(query, limit=25, sort=[(sort_field, -1)])
    return rows[0] if rows else None

def _href(path: str, label: str, reason: str) -> Dict[str, str]:
    return {"href": path, "label": label, "reason": reason}

def _step(key: str, label: str, href: str, state: str, active: bool = False) -> Dict[str, Any]:
    return {"key": key, "label": label, "href": href, "state": state, "active": active}

def _build_steps(role: str, current_key: str, completed: set[str], blocked: set[str] | None = None):
    blocked = blocked or set()
    rows = ROLE_STEPS.get(role, ROLE_STEPS["customer"])
    current_index = next((i for i, (key, _, _) in enumerate(rows) if key == current_key), 0)
    result = []
    for i, (key, label, href) in enumerate(rows):
        if key in blocked:
            state = BLOCKED
        elif key in completed or i < current_index:
            state = COMPLETED
        elif key == current_key:
            state = ACTION_REQUIRED
        else:
            state = NOT_STARTED
        result.append(_step(key, label, href, state, key == current_key))
    return result

def _result(role: str, current_key: str, state: str, next_action: Optional[Dict[str, Any]],
            completed: set[str] | None = None, entity: Optional[Dict[str, Any]] = None,
            blocked: set[str] | None = None, blocked_reason: Optional[str] = None) -> Dict[str, Any]:
    completed = completed or set()
    steps = _build_steps(role, current_key, completed, blocked)
    return {
        "currentStep": next((x["label"] for x in steps if x["active"]), current_key),
        "currentKey": current_key,
        "state": state,
        "next": next_action,
        "steps": steps,
        "entity": entity,
        "blockedReason": blocked_reason,
        "updatedAt": datetime.utcnow().isoformat(),
    }

async def _farmer(uid: str):
    fid = _id(uid)
    plan = await _latest(harvests, {"farmerId": fid, "deletedAt": None})
    if not plan:
        return _result("farmer", "farm_setup", ACTION_REQUIRED,
                       _href("/farmer/dashboard", "Complete Farm Setup", "Create your farm profile before planning a crop."))

    status = str(plan.get("status") or "planned").lower()
    plan_id = str(plan["_id"])
    entity = {"type": "harvest", "id": plan_id}

    if status == "cancelled":
        return _result("farmer", "crop_planning", BLOCKED,
                       _href("/farmer/harvest-planner", "Create a New Crop Plan", "The latest crop plan was cancelled."),
                       entity=entity, blocked={"harvest"}, blocked_reason="This harvest plan was cancelled.")
    if status != "harvested":
        if status == "preorder":
            expected_date = plan.get("expectedHarvestDate")
            ready = False
            try:
                if isinstance(expected_date, datetime):
                    ready = expected_date <= datetime.utcnow()
                elif expected_date:
                    parsed = datetime.fromisoformat(str(expected_date).replace("Z", "+00:00"))
                    if parsed.tzinfo:
                        ready = parsed.astimezone(timezone.utc).replace(tzinfo=None) <= datetime.utcnow()
                    else:
                        ready = parsed <= datetime.utcnow()
            except (TypeError, ValueError):
                ready = False
            if ready:
                return _result("farmer", "harvest", ACTION_REQUIRED,
                               _href("/farmer/harvest-planner", "Mark Harvested", "The planned harvest date has arrived. Record actual kilograms and the final selling rate."),
                               completed={"farm_setup", "crop_planning", "growing", "preorders"}, entity=entity)
            return _result("farmer", "preorders", IN_PROGRESS,
                           _href("/farmer/harvest-planner", "Review Pre-orders", "Pre-orders are open; record the actual harvest when the crop is harvested."),
                           completed={"farm_setup", "crop_planning", "growing"}, entity=entity)
        if status in ("ready", "ready_for_harvest"):
            return _result("farmer", "harvest", ACTION_REQUIRED,
                           _href("/farmer/harvest-planner", "Mark Harvested", "The crop is ready. Record actual kilograms and the final selling rate."),
                           completed={"farm_setup", "crop_planning", "growing", "preorders"}, entity=entity)
        expected = float(plan.get("expectedQuantityKg") or 0)
        return _result("farmer", "growing", IN_PROGRESS,
                       _href("/farmer/harvest-planner", "Continue Crop Plan", "Continue the active crop plan until it is ready for harvest."),
                       completed={"farm_setup", "crop_planning"}, entity={**entity, "expectedQuantityKg": expected})

    actual = float(plan.get("actualQuantityKg") or 0)
    rate = float(plan.get("finalRatePerKg") or 0)
    if actual <= 0 or rate <= 0:
        return _result("farmer", "harvest", BLOCKED,
                       _href("/farmer/harvest-planner", "Complete Harvest Confirmation", "Actual harvested quantity and final selling rate are required before batching."),
                       completed={"farm_setup", "crop_planning", "growing", "preorders"},
                       entity=entity, blocked_reason="Actual harvested KG and final ₹/kg are missing.")

    batch = await _latest(batches, {"farmerId": fid, "sourceHarvestPlanId": plan["_id"], "deletedAt": None}, "createdAt")
    if not batch:
        crop = quote(str(plan.get("cropName") or ""))
        href = f"/farmer/batches?fromHarvest={plan_id}&name={crop}&quantity={actual}&price={rate}&harvestDate={quote(str(plan.get('harvestedAt') or ''))}"
        return _result("farmer", "batch", ACTION_REQUIRED, _href(href, "Create Batch", "The harvest is complete. Create its traceable batch using the recorded harvest values."),
                       completed={"farm_setup", "crop_planning", "growing", "preorders", "harvest"}, entity=entity)

    batch_id = str(batch["_id"])
    verification = str(batch.get("verificationStatus") or "").lower()
    batch_status = str(batch.get("status") or "").lower()
    if batch_status in ("cancelled", "expired") or verification == "rejected":
        return _result("farmer", "batch", BLOCKED,
                       _href(f"/farmer/batches/{batch_id}", "Resolve Batch", "The batch cannot proceed until its blocked state is resolved."),
                       completed={"farm_setup", "crop_planning", "growing", "preorders", "harvest"}, entity={"type":"batch","id":batch_id},
                       blocked_reason="The batch is cancelled, expired, or rejected.")
    inspection = await _latest(quality, {"batchId": batch["_id"], "deletedAt": None}, "createdAt")
    inspection_status = str((inspection or {}).get("verificationStatus") or "").lower()
    if not inspection or inspection_status not in ("verified", "approved", "buyer_verified"):
        return _result("farmer", "quality", ACTION_REQUIRED,
                       _href(f"/farmer/quality?batchId={batch_id}", "Run Quality Inspection", "The batch must pass AI-assisted inspection and independent human approval."),
                       completed={"farm_setup", "crop_planning", "growing", "preorders", "harvest", "batch"}, entity={"type":"batch","id":batch_id})

    product = None
    if plan.get("productId"):
        product = await products.get_by_id(str(plan["productId"]))
    if not product:
        product = await _latest(products, {"farmerId": fid, "sourceHarvestPlanId": plan["_id"], "deletedAt": None}, "createdAt")
    if not product:
        href = f"/farmer/products/new?fromHarvest={plan_id}&name={quote(str(plan.get('cropName') or ''))}&quantity={actual}&unit=kg&price={rate}&harvestDate={quote(str(plan.get('harvestedAt') or ''))}"
        return _result("farmer", "product", ACTION_REQUIRED, _href(href, "Create Product", "Quality is approved. Create the customer-facing product without re-entering the harvest data."),
                       completed={"farm_setup","crop_planning","growing","preorders","harvest","batch","quality"}, entity={"type":"batch","id":batch_id})

    product_id = str(product["_id"])
    available = float(product.get("availableQuantity", product.get("quantity", 0)) or 0)
    active_orders = await orders.count({"farmerId": fid, "deletedAt": None, "orderStatus": {"$in": ["pending","confirmed","processing","ready_for_delivery","ready_for_pickup","dispatched","in_transit"]}})
    if available <= 0 and active_orders == 0:
        return _result("farmer", "inventory", ACTION_REQUIRED,
                       _href("/farmer/restock", "Review Inventory", "The verified product has no available stock; replenish or publish inventory before accepting orders."),
                       completed={"farm_setup","crop_planning","growing","preorders","harvest","batch","quality","product"}, entity={"type":"product","id":product_id})

    if active_orders:
        return _result("farmer", "orders", ACTION_REQUIRED,
                       _href("/farmer/orders", "Process Orders", "There are active customer orders requiring confirmation or preparation."),
                       completed={"farm_setup","crop_planning","growing","preorders","harvest","batch","quality","product","inventory"}, entity={"type":"product","id":product_id})

    return _result("farmer", "inventory", IN_PROGRESS,
                   _href("/farmer/restock", "Manage Inventory", "Verified produce is available for marketplace orders."),
                   completed={"farm_setup","crop_planning","growing","preorders","harvest","batch","quality","product"}, entity={"type":"product","id":product_id})

async def _customer(uid: str):
    cid = _id(uid)
    preorder = await _latest(preorders, {"customerId": cid, "deletedAt": None}, "updatedAt")
    if preorder:
        pstatus = str(preorder.get("status") or "").lower()
        if pstatus == "ready_for_confirmation":
            return _result("customer", "payment", ACTION_REQUIRED,
                           _href(f"/customer/harvests/preorders/{preorder['_id']}/checkout", "Confirm & Pay", "Your harvest pre-order is ready for confirmation and payment."),
                           completed={"browse","product","address","delivery_fee","checkout"}, entity={"type":"preorder","id":str(preorder["_id"])})
        if pstatus in ("confirmed", "paid", "fulfilled"):
            # Continue to the ordinary order state below when a normal order was created.
            pass

    order = await _latest(orders, {"customerId": cid, "deletedAt": None}, "createdAt")
    if not order:
        return _result("customer", "browse", ACTION_REQUIRED,
                       _href("/nearby", "Browse Products", "Choose produce from the marketplace."),
                       completed=set())
    oid = str(order["_id"])
    payment = str(order.get("paymentStatus") or order.get("payment", {}).get("status") or "").lower()
    status = str(order.get("orderStatus") or order.get("status") or "pending").lower()
    if status in ("cancelled", "refunded"):
        return _result("customer", "browse", ACTION_REQUIRED,
                       _href("/nearby", "Shop Again", "The latest order is closed; start a new purchase when ready."),
                       entity={"type":"order","id":oid})
    if payment in ("pending", "created", "failed", "unpaid") and status not in ("delivered","completed"):
        return _result("customer", "payment", ACTION_REQUIRED,
                       _href(f"/orders/{oid}", "Complete Payment", "The order exists but payment has not been verified."),
                       completed={"browse","product","address","delivery_fee","checkout"}, entity={"type":"order","id":oid})
    if status in ("delivered", "completed"):
        return _result("customer", "review", ACTION_REQUIRED,
                       _href(f"/orders/{oid}#review", "Review Order", "The order is complete and can now be reviewed."),
                       completed={"browse","product","address","delivery_fee","checkout","payment","order","tracking","delivery"}, entity={"type":"order","id":oid})
    if status in ("dispatched", "in_transit", "out_for_delivery", "ready_for_delivery"):
        return _result("customer", "tracking", IN_PROGRESS,
                       _href(f"/orders/{oid}", "Track Delivery", "Your paid order is in delivery operations."),
                       completed={"browse","product","address","delivery_fee","checkout","payment","order"}, entity={"type":"order","id":oid})
    return _result("customer", "order", IN_PROGRESS,
                   _href(f"/orders/{oid}", "Open Order", "Your order is active; continue tracking fulfillment."),
                   completed={"browse","product","address","delivery_fee","checkout","payment"}, entity={"type":"order","id":oid})

async def _delivery(uid: str):
    did = _id(uid)
    job = None
    for field in ("acceptedBy", "partnerId", "assignedTo", "deliveryPartnerId"):
        job = await _latest(delivery_jobs, {field: did, "deletedAt": None})
        if job:
            break
    if not job:
        return _result("delivery", "availability", ACTION_REQUIRED,
                       _href("/delivery/dashboard", "Set Availability", "Set your service availability before accepting delivery jobs."))
    jid = str(job["_id"])
    status = str(job.get("status") or job.get("assignmentStatus") or "").lower()
    if status in ("pending","open","offered","assigned"):
        accepted = status == "assigned" and bool(job.get("acceptedAt"))
        if not accepted:
            return _result("delivery", "accept", ACTION_REQUIRED,
                           _href("/delivery/dashboard", "Accept Assignment", "Review the assignment and accept it before pickup."),
                           completed={"availability","assignment"}, entity={"type":"delivery","id":jid})
    if status in ("accepted","assigned"):
        return _result("delivery", "pickup", ACTION_REQUIRED,
                       _href("/delivery/deliveries", "Start Pickup", "Verify the package and confirm pickup."),
                       completed={"availability","assignment","accept"}, entity={"type":"delivery","id":jid})
    if status in ("picked_up","picked","collected"):
        return _result("delivery", "verify", ACTION_REQUIRED,
                       _href("/delivery/deliveries", "Verify Pickup", "Confirm package/QR verification before dispatch."),
                       completed={"availability","assignment","accept","pickup"}, entity={"type":"delivery","id":jid})
    if status in ("verified","dispatched"):
        return _result("delivery", "route", ACTION_REQUIRED,
                       _href("/delivery/route", "Start Route", "Dispatch the verified package and follow the optimized route."),
                       completed={"availability","assignment","accept","pickup","verify","dispatch"}, entity={"type":"delivery","id":jid})
    if status in ("in_transit","out_for_delivery"):
        return _result("delivery", "proof", ACTION_REQUIRED,
                       _href("/delivery/deliveries", "Capture Proof of Delivery", "Complete the drop-off and upload proof."),
                       completed={"availability","assignment","accept","pickup","verify","dispatch","route","delivery"}, entity={"type":"delivery","id":jid})
    if status in ("delivered","completed"):
        return _result("delivery", "earnings", ACTION_REQUIRED,
                       _href("/delivery/earnings", "View Earnings", "The delivery is complete; review earnings and settlement."),
                       completed={"availability","assignment","accept","pickup","verify","dispatch","route","delivery","proof","completed"}, entity={"type":"delivery","id":jid})
    return _result("delivery", "assignment", ACTION_REQUIRED,
                   _href("/delivery/dashboard", "Review Assignments", "Review available delivery work."), entity={"type":"delivery","id":jid})

async def _warehouse(uid: str):
    warehouse = await WarehouseService.get_warehouse_by_manager(uid)
    if not warehouse:
        return _result("warehouse", "warehouse_setup", ACTION_REQUIRED,
                       _href("/warehouse/settings", "Complete Warehouse Setup", "Create or complete the warehouse profile for this manager."))
    wid = warehouse["_id"]
    incoming = await _latest(warehouse_incoming, {"warehouseId": wid, "deletedAt": None}, "updatedAt")
    if incoming:
        status = str(incoming.get("status") or "pending").lower()
        iid = str(incoming["_id"])
        if status in ("pending","created","in_transit","scheduled"):
            return _result("warehouse","receive",ACTION_REQUIRED,
                           _href(f"/incoming?incomingId={iid}","Receive Incoming Stock","Receive the shipment and record quantity and quality."),
                           completed={"warehouse_setup","incoming"},entity={"type":"incoming","id":iid})
        if status in ("received","received_pending_quality","quality_pending"):
            return _result("warehouse","quality",ACTION_REQUIRED,
                           _href(f"/incoming?incomingId={iid}","Verify Batch & Quality","Verify traceability and quality before storage."),
                           completed={"warehouse_setup","incoming","receive","batch_verification"},entity={"type":"incoming","id":iid})
        if status in ("rejected","cancelled"):
            return _result("warehouse","incoming",BLOCKED,
                           _href(f"/incoming?incomingId={iid}","Resolve Incoming Stock","The incoming shipment is rejected or cancelled."),
                           completed={"warehouse_setup"},entity={"type":"incoming","id":iid},blocked_reason="Incoming stock is rejected or cancelled.")
    outgoing = await _latest(warehouse_outgoing, {"warehouseId": wid, "deletedAt": None}, "updatedAt")
    if outgoing:
        status = str(outgoing.get("status") or "pending").lower()
        oid = str(outgoing["_id"])
        if status in ("pending","created"):
            return _result("warehouse","pick",ACTION_REQUIRED,
                           _href(f"/stock?outgoingId={oid}","Pick Stock","Pick the requested warehouse stock."),
                           completed={"warehouse_setup","incoming","receive","batch_verification","quality","storage","inventory"},entity={"type":"outgoing","id":oid})
        if status == "picked":
            return _result("warehouse","pack",ACTION_REQUIRED,
                           _href(f"/stock?outgoingId={oid}","Pack Shipment","Pack and label the picked stock."),
                           completed={"warehouse_setup","incoming","receive","batch_verification","quality","storage","inventory","pick"},entity={"type":"outgoing","id":oid})
        if status == "packed":
            return _result("warehouse","dispatch",ACTION_REQUIRED,
                           _href(f"/stock?outgoingId={oid}","Dispatch Shipment","Release the packed shipment to delivery."),
                           completed={"warehouse_setup","incoming","receive","batch_verification","quality","storage","inventory","pick","pack"},entity={"type":"outgoing","id":oid})
        if status == "dispatched":
            return _result("warehouse","transfer",IN_PROGRESS,
                           _href("/transfers","Track Transfer","The shipment has left warehouse operations."),
                           completed={"warehouse_setup","incoming","receive","batch_verification","quality","storage","inventory","pick","pack","dispatch"},entity={"type":"outgoing","id":oid})
    return _result("warehouse","inventory",IN_PROGRESS,
                   _href("/stock","Review Inventory","Review current stock and warehouse operations."),
                   completed={"warehouse_setup","incoming","receive","batch_verification","quality","storage"})

async def _business(uid: str):
    bid = _id(uid)
    rfq = await _latest(rfqs, {"businessUserId": bid, "deletedAt": None})
    if not rfq:
        return _result("business","business_setup",ACTION_REQUIRED,
                       _href("/business/rfqs/new","Create RFQ","Create a structured bulk request after completing business setup."))
    rid = str(rfq["_id"])
    rstatus = str(rfq.get("status") or "").lower()
    if rstatus in ("open","published","active"):
        offers = await BaseRepository("b2b_offers").count({"rfqId": rfq["_id"], "deletedAt": None, "status": {"$nin":["declined","rejected"]}})
        if offers == 0:
            return _result("business","rfq",IN_PROGRESS,
                           _href(f"/business/rfqs/{rid}","Monitor RFQ","The RFQ is open and waiting for farmer quotes."),
                           completed={"business_setup","category","rfq"},entity={"type":"rfq","id":rid})
        return _result("business","compare_quotes",ACTION_REQUIRED,
                       _href(f"/business/rfqs/{rid}","Compare Farmer Quotes","Farmer quotes are available for comparison and selection."),
                       completed={"business_setup","category","rfq","farmer_quotes"},entity={"type":"rfq","id":rid})
    order = await _latest(b2b_orders, {"businessUserId": bid, "deletedAt": None})
    if not order:
        return _result("business","select_quote",ACTION_REQUIRED,
                       _href(f"/business/rfqs/{rid}","Select Quote","The RFQ has been awarded; finish quote selection and create the B2B order."),
                       completed={"business_setup","category","rfq","farmer_quotes","compare_quotes"},entity={"type":"rfq","id":rid})
    oid = str(order["_id"])
    payment = str(order.get("paymentStatus") or order.get("payment",{}).get("status") or order.get("status") or "").lower()
    if payment in ("pending","created","unpaid") and str(order.get("status") or "").lower() not in ("cancelled","completed","delivered"):
        return _result("business","payment",ACTION_REQUIRED,
                       _href(f"/business/orders/{oid}","Pay B2B Order","Complete payment before fulfillment can proceed."),
                       completed={"business_setup","category","rfq","farmer_quotes","compare_quotes","select_quote","contract","b2b_order"},entity={"type":"b2b_order","id":oid})
    status = str(order.get("status") or order.get("orderStatus") or "").lower()
    if status in ("completed","delivered"):
        return _result("business","completion",COMPLETED,
                       _href(f"/business/orders/{oid}","Review Completion","Review the completed B2B order and invoice."),
                       completed={"business_setup","category","rfq","farmer_quotes","compare_quotes","select_quote","contract","b2b_order","payment","fulfillment","delivery"},entity={"type":"b2b_order","id":oid})
    if status in ("dispatched","in_transit","out_for_delivery"):
        return _result("business","delivery",IN_PROGRESS,
                       _href(f"/business/orders/{oid}","Track B2B Delivery","The paid order is in delivery."),
                       completed={"business_setup","category","rfq","farmer_quotes","compare_quotes","select_quote","contract","b2b_order","payment","fulfillment"},entity={"type":"b2b_order","id":oid})
    return _result("business","fulfillment",IN_PROGRESS,
                   _href(f"/business/orders/{oid}","Continue Fulfillment","Continue preparation, quality checks and dispatch."),
                   completed={"business_setup","category","rfq","farmer_quotes","compare_quotes","select_quote","contract","b2b_order","payment"},entity={"type":"b2b_order","id":oid})

async def _admin(uid: str):
    inspection = await _latest(quality, {"verificationStatus": {"$in": ["declared","evidence_submitted"]}, "deletedAt": None}, "createdAt")
    if inspection:
        return _result("admin","quality",ACTION_REQUIRED,
                       _href("/admin/dashboard","Review Quality Queue","A quality inspection is waiting for independent verification."),
                       completed={"overview","users","farmers","products","harvests","batches"},entity={"type":"quality","id":str(inspection["_id"])})
    pending = await _latest(orders, {"orderStatus": {"$in":["pending","confirmed","processing"]}, "deletedAt": None}, "updatedAt")
    if pending:
        return _result("admin","orders",IN_PROGRESS,
                       _href("/admin/orders","Review Active Orders","Active orders require platform oversight."),
                       completed={"overview","users","farmers","products","harvests","batches","quality","inventory"},entity={"type":"order","id":str(pending["_id"])})
    return _result("admin","overview",IN_PROGRESS,
                   _href("/admin/dashboard","Open Platform Overview","Review platform operations, alerts and audit activity."))

async def _resolve_entity(entity_type: str, entity_id: str):
    oid = _id(entity_id)
    if not oid:
        return None
    repos = {
        "harvest": harvests, "batch": batches, "quality": quality,
        "product": products, "order": orders, "preorder": preorders,
        "rfq": rfqs, "b2b_order": b2b_orders, "delivery": delivery_jobs,
    }
    repo = repos.get(entity_type.lower())
    return await repo.get_by_id(entity_id) if repo else None

@router.get("/me")
async def get_my_workflow(current_user: dict = Depends(get_current_user)):
    uid = str(current_user["_id"])
    role = str(current_user.get("role") or "customer").lower()
    resolver = {
        "farmer": _farmer, "customer": _customer, "business": _business,
        "delivery": _delivery, "warehouse": _warehouse, "admin": _admin,
    }.get(role, _customer)
    return {"success": True, "role": role, "data": await resolver(uid)}

@router.get("/entity/{entity_type}/{entity_id}")
async def get_entity_workflow(entity_type: str, entity_id: str, current_user: dict = Depends(get_current_user)):
    """Return traceability relationships and the next domain action for an entity."""
    entity = await _resolve_entity(entity_type, entity_id)
    result: Dict[str, Any] = {"entityType": entity_type, "entityId": entity_id, "state": NOT_STARTED, "next": None, "links": []}
    if not entity:
        return {"success": True, "data": result}

    result["state"] = IN_PROGRESS
    et = entity_type.lower()
    if et == "harvest":
        batch = await batches.find_one({"sourceHarvestPlanId": entity["_id"], "deletedAt": None})
        result["links"].append({"type":"batch","id":str(batch["_id"])} if batch else None)
        result["links"] = [x for x in result["links"] if x]
        result["next"] = _href(f"/farmer/batches?fromHarvest={entity_id}", "Create Batch", "Create the traceable batch.") if not batch else _href(f"/farmer/quality?batchId={batch['_id']}", "Quality Inspection", "Inspect the linked batch.")
    elif et == "batch":
        inspection = await quality.find_one({"batchId": entity["_id"], "deletedAt": None})
        result["links"].append({"type":"quality","id":str(inspection["_id"])} if inspection else None)
        result["links"] = [x for x in result["links"] if x]
        result["next"] = _href(f"/farmer/quality?batchId={entity_id}", "Quality Inspection", "Inspect the harvest batch.")
    elif et == "quality":
        batch_id = entity.get("batchId")
        if batch_id:
            result["links"].append({"type":"batch","id":str(batch_id)})
        result["next"] = _href("/farmer/products", "Create Product", "Use the approved quality record to publish the product.")
    elif et == "product":
        result["next"] = _href("/farmer/restock", "Review Inventory", "Review stock linked to the verified product.")
    elif et == "order":
        result["next"] = _href(f"/orders/{entity_id}", "Open Order", "Continue payment, fulfillment or delivery.")
    elif et == "rfq":
        result["next"] = _href(f"/business/rfqs/{entity_id}", "Open RFQ", "Continue quote comparison, selection and award.")
    elif et == "b2b_order":
        result["next"] = _href(f"/business/orders/{entity_id}", "Open B2B Order", "Continue payment and fulfillment.")
    elif et == "delivery":
        result["next"] = _href("/delivery/deliveries", "Open Delivery", "Continue pickup, dispatch, route and proof of delivery.")
    return {"success": True, "data": result}
