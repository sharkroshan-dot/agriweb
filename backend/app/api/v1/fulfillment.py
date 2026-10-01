from fastapi import APIRouter, Depends, HTTPException
from bson import ObjectId
from datetime import datetime
from app.api.v1.auth import get_current_user
from app.database.mongodb import MongoDB
from app.schemas.fulfillment import FulfillmentHubCreate, FulfillmentDecisionResponse, HubTransferCreate, HubConsolidationCreate, HubReceiveRequest, HubDispatchRequest, FulfillmentRatingCreate
from app.services.fulfillment_engine import evaluate_order, distance_km
from app.repositories.delivery_assignment_repository import delivery_assignment_repository

router = APIRouter()

def _manage(user):
    if user.get("role") not in ("admin", "warehouse"):
        raise HTTPException(status_code=403, detail="Only admin or warehouse users can manage fulfillment")

@router.get("/orders/{order_id}/decision", response_model=FulfillmentDecisionResponse)
async def get_decision(order_id: str, current_user: dict = Depends(get_current_user)):
    try:
        oid = ObjectId(order_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid order id")
    order = await MongoDB.get_collection("orders").find_one({"_id": oid})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    role = current_user.get("role")
    if role == "customer" and str(order.get("customerId")) != str(current_user["_id"]):
        raise HTTPException(status_code=403, detail="Access denied")
    if role == "farmer" and str(order.get("farmerId")) != str(current_user["_id"]):
        raise HTTPException(status_code=403, detail="Access denied")
    if role not in ("admin", "warehouse", "farmer", "delivery", "customer"):
        raise HTTPException(status_code=403, detail="Access denied")
    return await evaluate_order(order_id, persist=True)

@router.post("/hubs")
async def create_hub(data: FulfillmentHubCreate, current_user: dict = Depends(get_current_user)):
    _manage(current_user)
    doc = data.model_dump() if hasattr(data, "model_dump") else data.dict()
    doc["availableCapacity"] = doc["storageCapacity"] if doc.get("availableCapacity") is None else doc["availableCapacity"]
    doc.update({"isLocalFulfillmentHub": True, "createdAt": datetime.utcnow(), "updatedAt": datetime.utcnow(), "deletedAt": None})
    result = await MongoDB.get_collection("fulfillment_hubs").insert_one(doc)
    doc["id"] = str(result.inserted_id); doc.pop("_id", None)
    return {"success": True, "data": doc}


@router.post("/hubs/opt-in")
async def farmer_opt_in_hub(data: FulfillmentHubCreate, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can opt in a farm as a local fulfillment hub")
    doc = data.model_dump() if hasattr(data, "model_dump") else data.dict()
    doc["availableCapacity"] = doc["storageCapacity"] if doc.get("availableCapacity") is None else doc["availableCapacity"]
    doc.update({"isLocalFulfillmentHub": True, "ownerFarmerId": ObjectId(current_user["_id"]), "approvalStatus": "pending", "isActive": False, "createdAt": datetime.utcnow(), "updatedAt": datetime.utcnow(), "deletedAt": None})
    result = await MongoDB.get_collection("fulfillment_hubs").insert_one(doc)
    return {"success": True, "data": {"id": str(result.inserted_id), "approvalStatus": "pending"}, "message": "Farm submitted for local fulfillment hub approval"}

@router.get("/hubs/mine")
async def my_hubs(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can view their hub applications")
    docs = await MongoDB.get_collection("fulfillment_hubs").find({"ownerFarmerId": ObjectId(current_user["_id"]), "deletedAt": None}).sort("createdAt", -1).to_list(length=50)
    for d in docs: d["id"] = str(d.pop("_id"))
    return {"success": True, "data": {"hubs": docs}}


@router.put("/hubs/{hub_id}")
async def update_hub(hub_id: str, data: FulfillmentHubCreate, current_user: dict = Depends(get_current_user)):
    try: hid = ObjectId(hub_id)
    except Exception: raise HTTPException(status_code=400, detail="Invalid hub id")
    query = {"_id": hid, "isLocalFulfillmentHub": True, "deletedAt": None}
    if current_user.get("role") == "farmer":
        query["ownerFarmerId"] = ObjectId(current_user["_id"])
    elif current_user.get("role") not in ("admin", "warehouse"):
        raise HTTPException(status_code=403, detail="Access denied")
    existing = await MongoDB.get_collection("fulfillment_hubs").find_one(query)
    if not existing: raise HTTPException(status_code=404, detail="Hub not found")
    doc = data.model_dump() if hasattr(data, "model_dump") else data.dict()
    current_used = float(existing.get("storageCapacity", 0)) - float(existing.get("availableCapacity", 0))
    if float(doc["storageCapacity"]) < current_used:
        raise HTTPException(status_code=400, detail="Storage capacity cannot be below currently occupied capacity")
    doc["availableCapacity"] = max(0.0, float(doc["storageCapacity"]) - current_used)
    if current_user.get("role") == "farmer" and existing.get("approvalStatus") == "approved":
        doc["approvalStatus"] = "pending"
        doc["isActive"] = False
    doc["updatedAt"] = datetime.utcnow()
    await MongoDB.get_collection("fulfillment_hubs").update_one({"_id": hid}, {"$set": doc})
    updated = await MongoDB.get_collection("fulfillment_hubs").find_one({"_id": hid})
    updated["id"] = str(updated.pop("_id"))
    return {"success": True, "data": updated}


@router.post("/hubs/{hub_id}/approve")
async def approve_hub(hub_id: str, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admins can approve local fulfillment hubs")
    try: hid = ObjectId(hub_id)
    except Exception: raise HTTPException(status_code=400, detail="Invalid hub id")
    result = await MongoDB.get_collection("fulfillment_hubs").update_one({"_id": hid, "isLocalFulfillmentHub": True, "deletedAt": None}, {"$set": {"approvalStatus": "approved", "isActive": True, "updatedAt": datetime.utcnow()}})
    if not result.modified_count: raise HTTPException(status_code=404, detail="Hub not found")
    return {"success": True, "message": "Local fulfillment hub approved"}

@router.get("/hubs")
async def list_hubs(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") not in ("admin", "warehouse", "delivery"):
        raise HTTPException(status_code=403, detail="Access denied")
    docs = await MongoDB.get_collection("fulfillment_hubs").find({"isLocalFulfillmentHub": True, "isActive": True, "approvalStatus": "approved", "deletedAt": None}).sort("availableCapacity", -1).to_list(length=200)
    for d in docs: d["id"] = str(d.pop("_id"))
    return {"success": True, "data": {"hubs": docs}}

@router.post("/orders/{order_id}/transfer-to-hub")
async def transfer_to_hub(order_id: str, data: HubTransferCreate, current_user: dict = Depends(get_current_user)):
    _manage(current_user)
    try: oid, hid = ObjectId(order_id), ObjectId(data.hubId)
    except Exception: raise HTTPException(status_code=400, detail="Invalid order or hub id")
    orders, hubs, transfers = (MongoDB.get_collection(x) for x in ("orders","fulfillment_hubs","hub_transfers"))
    order = await orders.find_one({"_id": oid}); hub = await hubs.find_one({"_id": hid, "isLocalFulfillmentHub": True, "isActive": True, "deletedAt": None})
    if not order or not hub: raise HTTPException(status_code=404, detail="Order or hub not found")
    if order.get("fulfillmentSource") != "warehouse" or order.get("nearbyFulfillmentType") != "local_hub":
        raise HTTPException(status_code=400, detail="This order is not approved for warehouse-to-hub fulfillment")
    if order.get("orderStatus") not in ("transfer_pending", "dispatched"):
        raise HTTPException(status_code=400, detail="Warehouse order must be dispatched before hub transfer")
    if data.quantity > float(hub.get("availableCapacity",0)): raise HTTPException(status_code=400, detail="Hub does not have enough available capacity")
    if await transfers.find_one({"orderId": oid, "status": {"$in":["in_transit","received"]}}): raise HTTPException(status_code=409, detail="Order already has a hub transfer")
    source = order.get("currentFulfillmentLocation") or order.get("originLocation") or order.get("farmLocation")
    distance = data.transferDistanceKm if data.transferDistanceKm is not None else distance_km(source, hub.get("location"))
    now = datetime.utcnow()
    transfer={"orderId":oid,"hubId":hid,"quantity":data.quantity,"sourceLocation":source,"destinationLocation":hub.get("location"),"transferDistanceKm":distance,"status":"in_transit","notes":data.notes,"createdAt":now,"updatedAt":now,"farmerId":order.get("farmerId"),"productIds":[i.get("productId") for i in order.get("items",[])],"batchIds":[i.get("batchId") for i in order.get("items",[]) if i.get("batchId")]}
    ins=await transfers.insert_one(transfer)
    await orders.update_one({"_id":oid},{"$set":{"transferStatus":"in_transit","nearbyFulfillmentLocationId":hid,"currentFulfillmentLocation": source,"updatedAt":now}})
    await hubs.update_one({"_id":hid},{"$inc":{"availableCapacity":-data.quantity},"$set":{"updatedAt":now}})
    transfer["id"]=str(ins.inserted_id); transfer.pop("_id",None)
    return {"success":True,"data":transfer}

@router.post("/hubs/{hub_id}/consolidate")
async def consolidate_hub_orders(hub_id: str, data: HubConsolidationCreate, current_user: dict = Depends(get_current_user)):
    """Create one warehouse->hub manifest for multiple compatible orders.

    Orders must already be routed to this approved hub. The manifest is the
    single transfer record; each order keeps its own farmer/product/batch IDs.
    """
    _manage(current_user)
    try:
        hid = ObjectId(hub_id)
        order_oids = [ObjectId(x) for x in data.orderIds]
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid hub or order id")
    hubs = MongoDB.get_collection("fulfillment_hubs")
    orders = MongoDB.get_collection("orders")
    transfers = MongoDB.get_collection("hub_transfers")
    hub = await hubs.find_one({"_id": hid, "isLocalFulfillmentHub": True, "isActive": True, "approvalStatus": "approved", "deletedAt": None})
    if not hub:
        raise HTTPException(status_code=404, detail="Approved local hub not found")
    docs = await orders.find({"_id": {"$in": order_oids}}).to_list(length=50)
    if len(docs) != len(order_oids):
        raise HTTPException(status_code=404, detail="One or more orders not found")
    quantities = {}
    total = 0.0
    source = None
    for order in docs:
        if order.get("fulfillmentSource") != "warehouse" or order.get("nearbyFulfillmentType") != "local_hub":
            raise HTTPException(status_code=400, detail=f"Order {order.get('orderNumber', str(order['_id']))} is not routed to a local hub")
        if str(order.get("nearbyFulfillmentLocationId")) != str(hid):
            raise HTTPException(status_code=400, detail="All orders must target the same local hub")
        if order.get("transferStatus") not in (None, "pending"):
            raise HTTPException(status_code=409, detail="One or more orders already has a transfer")
        src = order.get("currentFulfillmentLocation") or order.get("originLocation") or order.get("farmLocation")
        if source is None:
            source = src
        elif distance_km(source, src) not in (None, 0) and distance_km(source, src) > 0.5:
            raise HTTPException(status_code=400, detail="All consolidated orders must originate from the same warehouse/location")
        # A consolidated manifest cannot mix incompatible cold-chain requirements.
        product_ids = [str(i.get("productId")) for i in order.get("items") or [] if i.get("productId")]
        if product_ids:
            products = await MongoDB.get_collection("products").find({"_id": {"$in": [ObjectId(x) for x in product_ids if ObjectId.is_valid(x)]}}).to_list(length=50)
            requires_cold = any(bool(p.get("coldStorageRequired") or p.get("storageTemperature")) for p in products)
            if requires_cold and not hub.get("coldStorageAvailable"):
                raise HTTPException(status_code=400, detail="Selected hub does not provide required cold storage")
        total += sum(float(i.get("quantity") or 0) for i in order.get("items") or [])
    if total > float(hub.get("availableCapacity", 0) or 0):
        raise HTTPException(status_code=400, detail="Hub does not have enough available capacity for the consolidated manifest")
    now = datetime.utcnow()
    transfer = {
        "hubId": hid, "orderIds": order_oids, "quantity": total,
        "sourceLocation": source, "destinationLocation": hub.get("location"),
        "transferDistanceKm": distance_km(source, hub.get("location")),
        "status": "in_transit", "consolidated": True, "notes": data.notes,
        "createdAt": now, "updatedAt": now,
        "lines": [{"orderId": o["_id"], "farmerId": o.get("farmerId"),
                   "productIds": [i.get("productId") for i in o.get("items", [])],
                   "batchIds": [i.get("batchId") for i in o.get("items", []) if i.get("batchId")],
                   "quantity": sum(float(i.get("quantity") or 0) for i in o.get("items") or [])} for o in docs],
    }
    ins = await transfers.insert_one(transfer)
    await orders.update_many({"_id": {"$in": order_oids}}, {"$set": {
        "transferStatus": "in_transit", "nearbyFulfillmentLocationId": hid,
        "currentFulfillmentLocation": source, "consolidatedTransferId": ins.inserted_id,
        "updatedAt": now,
    }})
    await hubs.update_one({"_id": hid}, {"$inc": {"availableCapacity": -total}, "$set": {"updatedAt": now}})
    transfer["id"] = str(ins.inserted_id); transfer.pop("_id", None)
    return {"success": True, "data": transfer}


@router.post("/transfers/{transfer_id}/receive")
async def receive_transfer_manifest(transfer_id: str, data: HubReceiveRequest, current_user: dict = Depends(get_current_user)):
    _manage(current_user)
    try: tid = ObjectId(transfer_id)
    except Exception: raise HTTPException(status_code=400, detail="Invalid transfer id")
    transfers = MongoDB.get_collection("hub_transfers")
    transfer = await transfers.find_one({"_id": tid, "status": "in_transit"})
    if not transfer: raise HTTPException(status_code=404, detail="Active transfer manifest not found")
    now = datetime.utcnow()
    received = data.qualityCheck == "passed"
    new_status = "received" if received else "rejected"
    await transfers.update_one({"_id": tid}, {"$set": {"status": new_status, "qualityCheck": data.qualityCheck, "qualityNotes": data.notes, "receivedAt": now, "updatedAt": now}})
    order_ids = transfer.get("orderIds") or ([transfer.get("orderId")] if transfer.get("orderId") else [])
    orders = MongoDB.get_collection("orders")
    if order_ids:
        await orders.update_many({"_id": {"$in": order_ids}}, {"$set": {
            "transferStatus": "received" if received else "rejected",
            "hubReceivedAt": now,
            "localInventoryStatus": "available" if received else "rejected",
            "orderStatus": "in_transit" if received else "cancelled",
            "updatedAt": now,
        }})
    if not received:
        await MongoDB.get_collection("fulfillment_hubs").update_one({"_id": transfer["hubId"]}, {"$inc": {"availableCapacity": transfer.get("quantity", 0)}, "$set": {"updatedAt": now}})
    return {"success": True, "message": "Transfer manifest received and verified" if received else "Transfer manifest rejected", "orderCount": len(order_ids)}


@router.post("/transfers/{transfer_id}/dispatch")
async def dispatch_transfer_manifest(transfer_id: str, data: HubDispatchRequest, current_user: dict = Depends(get_current_user)):
    _manage(current_user)
    try: tid = ObjectId(transfer_id)
    except Exception: raise HTTPException(status_code=400, detail="Invalid transfer id")
    transfers = MongoDB.get_collection("hub_transfers")
    transfer = await transfers.find_one({"_id": tid, "status": "received"})
    if not transfer: raise HTTPException(status_code=404, detail="Received transfer manifest not found")
    order_ids = transfer.get("orderIds") or ([transfer.get("orderId")] if transfer.get("orderId") else [])
    if not order_ids: raise HTTPException(status_code=400, detail="Transfer has no orders")
    partner_id = data.deliveryPartnerId
    if partner_id:
        try: partner_oid = ObjectId(partner_id)
        except Exception: raise HTTPException(status_code=400, detail="Invalid delivery partner id")
    else:
        partner = await MongoDB.get_collection("delivery_partners").find_one({"isAvailable": True, "status": "available", "deletedAt": None})
        if not partner: raise HTTPException(status_code=409, detail="No available delivery partner")
        partner_oid, partner_id = partner["_id"], str(partner["_id"])
    now = datetime.utcnow()
    orders = MongoDB.get_collection("orders")
    for oid in order_ids:
        await orders.update_one({"_id": oid}, {"$set": {
            "deliveryPartnerId": partner_oid, "orderStatus": "dispatched",
            "logisticsMode": "hub_to_delivery_partner", "transferStatus": "local_dispatch",
            "localDispatchAt": now, "updatedAt": now,
        }})
        try:
            existing = await delivery_assignment_repository.get_by_order_id(str(oid))
            if not existing:
                await delivery_assignment_repository.create_assignment({"orderId": oid, "deliveryPartnerId": partner_oid, "priority": 1, "source": "local_hub"})
        except Exception:
            pass
    await transfers.update_one({"_id": tid}, {"$set": {"status": "dispatched", "deliveryPartnerId": partner_oid, "dispatchedAt": now, "updatedAt": now}})
    await MongoDB.get_collection("fulfillment_hubs").update_one({"_id": transfer["hubId"]}, {"$inc": {"availableCapacity": transfer.get("quantity", 0)}, "$set": {"updatedAt": now}})
    return {"success": True, "deliveryPartnerId": partner_id, "orderCount": len(order_ids)}


@router.post("/orders/{order_id}/hub-receive")
async def hub_receive(order_id: str, data: HubReceiveRequest, current_user: dict = Depends(get_current_user)):
    _manage(current_user)
    try: oid=ObjectId(order_id)
    except Exception: raise HTTPException(status_code=400, detail="Invalid order id")
    orders, transfers = MongoDB.get_collection("orders"), MongoDB.get_collection("hub_transfers")
    transfer=await transfers.find_one({"orderId":oid,"status":"in_transit"})
    if not transfer: raise HTTPException(status_code=404, detail="Active hub transfer not found")
    now=datetime.utcnow(); received=data.qualityCheck=="passed"
    await transfers.update_one({"_id":transfer["_id"]},{"$set":{"status":"received" if received else "rejected","qualityCheck":data.qualityCheck,"qualityNotes":data.notes,"receivedAt":now,"updatedAt":now}})
    await orders.update_one({"_id":oid},{"$set":{"transferStatus":"received" if received else "rejected","hubReceivedAt":now,"localInventoryStatus":"available" if received else "rejected","orderStatus":"in_transit" if received else "cancelled","updatedAt":now}})
    if not received:
        await MongoDB.get_collection("fulfillment_hubs").update_one({"_id": transfer["hubId"]}, {"$inc": {"availableCapacity": transfer.get("quantity", 0)}, "$set": {"updatedAt": now}})
    return {"success":True,"message":"Hub stock received and verified" if received else "Hub stock rejected"}

@router.post("/orders/{order_id}/hub-dispatch")
async def hub_dispatch(order_id: str, data: HubDispatchRequest, current_user: dict = Depends(get_current_user)):
    _manage(current_user)
    try: oid=ObjectId(order_id)
    except Exception: raise HTTPException(status_code=400, detail="Invalid order id")
    order=await MongoDB.get_collection("orders").find_one({"_id":oid})
    if not order: raise HTTPException(status_code=404, detail="Order not found")
    if order.get("transferStatus") != "received": raise HTTPException(status_code=400, detail="Hub must receive and verify stock before dispatch")
    partner_id=data.deliveryPartnerId
    if partner_id:
        try: partner_oid=ObjectId(partner_id)
        except Exception: raise HTTPException(status_code=400, detail="Invalid delivery partner id")
    else:
        partner=await MongoDB.get_collection("delivery_partners").find_one({"isAvailable":True,"status":"available","deletedAt":None})
        if not partner: raise HTTPException(status_code=409, detail="No available delivery partner")
        partner_oid=partner["_id"]; partner_id=str(partner_oid)
    assignment=await delivery_assignment_repository.get_by_order_id(order_id)
    assignment_id=str(assignment["_id"]) if assignment else await delivery_assignment_repository.create_assignment({"orderId":oid,"deliveryPartnerId":partner_oid,"priority":1})
    now=datetime.utcnow()
    active_transfer = await MongoDB.get_collection("hub_transfers").find_one({"orderId": oid, "status": "received"})
    await MongoDB.get_collection("orders").update_one({"_id":oid},{"$set":{"deliveryPartnerId":partner_oid,"orderStatus":"dispatched","logisticsMode":"hub_to_delivery_partner","transferStatus":"local_dispatch","localDispatchAt":now,"updatedAt":now}})
    if active_transfer:
        await MongoDB.get_collection("fulfillment_hubs").update_one({"_id": active_transfer["hubId"]}, {"$inc": {"availableCapacity": active_transfer.get("quantity", 0)}, "$set": {"updatedAt": now}})
    return {"success":True,"assignmentId":assignment_id,"deliveryPartnerId":partner_id}

@router.post("/ratings")
async def create_fulfillment_rating(data: FulfillmentRatingCreate, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "customer":
        raise HTTPException(status_code=403, detail="Only customers can submit fulfillment ratings")
    try: oid = ObjectId(data.orderId)
    except Exception: raise HTTPException(status_code=400, detail="Invalid order id")
    orders = MongoDB.get_collection("orders"); ratings = MongoDB.get_collection("fulfillment_ratings")
    order = await orders.find_one({"_id": oid, "customerId": ObjectId(current_user["_id"]), "orderStatus": "delivered"})
    if not order: raise HTTPException(status_code=404, detail="Only delivered orders can be rated")
    if await ratings.find_one({"orderId": oid, "customerId": ObjectId(current_user["_id"])}): raise HTTPException(status_code=409, detail="This order has already been rated")
    doc = data.model_dump() if hasattr(data, "model_dump") else data.dict()
    doc.update({"orderId": oid, "customerId": ObjectId(current_user["_id"]), "farmerId": order.get("farmerId"), "deliveryPartnerId": order.get("deliveryPartnerId"), "warehouseId": order.get("warehouseId"), "hubId": order.get("nearbyFulfillmentLocationId"), "createdAt": datetime.utcnow(), "updatedAt": datetime.utcnow()})
    result = await ratings.insert_one(doc)
    doc["id"] = str(result.inserted_id); doc.pop("_id", None)
    return {"success": True, "data": doc}
