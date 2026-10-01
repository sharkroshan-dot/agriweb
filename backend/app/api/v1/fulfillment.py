from fastapi import APIRouter, Depends, HTTPException
from bson import ObjectId
from datetime import datetime
from app.api.v1.auth import get_current_user
from app.database.mongodb import MongoDB
from app.schemas.fulfillment import FulfillmentHubCreate, FulfillmentDecisionResponse, HubTransferCreate, HubReceiveRequest, HubDispatchRequest
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

@router.post("/hubs/{hub_id}/approve")
async def approve_hub(hub_id: str, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admins can approve local fulfillment hubs")
    try: hid = ObjectId(hub_id)
    except Exception: raise HTTPException(status_code=400, detail="Invalid hub id")
    result = await MongoDB.get_collection("fulfillment_hubs").update_one({"_id": hid, "isLocalFulfillmentHub": True, "deletedAt": None}, {"$set": {"approvalStatus": "approved", "isActive": True, "updatedAt": datetime.utcnow()}})
    if not result.modified_count: raise HTTPException(status_code=404, detail="Hub not found")
    return {"success": True, "message": "Local fulfillment hub approved"}
\n@router.get("/hubs")
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
    if data.quantity > float(hub.get("availableCapacity",0)): raise HTTPException(status_code=400, detail="Hub does not have enough available capacity")
    if await transfers.find_one({"orderId": oid, "status": {"$in":["in_transit","received"]}}): raise HTTPException(status_code=409, detail="Order already has a hub transfer")
    source = order.get("currentFulfillmentLocation") or order.get("originLocation") or order.get("farmLocation")
    distance = data.transferDistanceKm if data.transferDistanceKm is not None else distance_km(source, hub.get("location"))
    now = datetime.utcnow()
    transfer={"orderId":oid,"hubId":hid,"quantity":data.quantity,"sourceLocation":source,"destinationLocation":hub.get("location"),"transferDistanceKm":distance,"status":"in_transit","notes":data.notes,"createdAt":now,"updatedAt":now,"farmerId":order.get("farmerId"),"productIds":[i.get("productId") for i in order.get("items",[])],"batchIds":[i.get("batchId") for i in order.get("items",[]) if i.get("batchId")]}
    ins=await transfers.insert_one(transfer)
    await orders.update_one({"_id":oid},{"$set":{"transferStatus":"in_transit","nearbyFulfillmentLocationId":hid,"currentFulfillmentLocation":hub.get("location"),"updatedAt":now}})
    await hubs.update_one({"_id":hid},{"$inc":{"availableCapacity":-data.quantity},"$set":{"updatedAt":now}})
    transfer["id"]=str(ins.inserted_id); transfer.pop("_id",None)
    return {"success":True,"data":transfer}

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
    await MongoDB.get_collection("orders").update_one({"_id":oid},{"$set":{"deliveryPartnerId":partner_oid,"orderStatus":"dispatched","logisticsMode":"hub_to_delivery_partner","transferStatus":"local_dispatch","localDispatchAt":now,"updatedAt":now}})
    return {"success":True,"assignmentId":assignment_id,"deliveryPartnerId":partner_id}
