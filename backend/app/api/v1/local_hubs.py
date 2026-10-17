from datetime import datetime, timedelta
from typing import Optional
import secrets
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, EmailStr
from app.api.v1.auth import get_current_user
from app.database.mongodb import MongoDB
from app.repositories.warehouse_repository import warehouse_repository
from app.repositories.user_repository import user_repository
from app.repositories.order_repository import order_repository
from app.repositories.delivery_job_repository import delivery_job_repository, JOB_OPEN
from app.services.delivery_job_service import build_job_document
from app.core.security import Security

router = APIRouter()


class LocalHubCreate(BaseModel):
    name: str = Field(..., min_length=3, max_length=120)
    district: str = Field(..., min_length=2, max_length=100)
    state: str = Field(..., min_length=2, max_length=100)
    address: str = Field(..., min_length=5, max_length=500)
    capacity: float = Field(..., gt=0)
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    managerName: str = Field(..., min_length=2, max_length=120)
    username: str = Field(..., min_length=3, max_length=60, pattern=r"^[a-zA-Z0-9_.-]+$")
    email: EmailStr


def _safe(doc):
    if not doc:
        return doc
    result = dict(doc)
    if result.get("_id") is not None:
        result["id"] = str(result.pop("_id"))
    for key, value in list(result.items()):
        if isinstance(value, ObjectId):
            result[key] = str(value)
        elif isinstance(value, datetime):
            result[key] = value.isoformat()
    return result


def _hub_id(user):
    facility_id = str(user.get("facilityId") or user.get("warehouseId") or "")
    if user.get("facilityType") != "local_hub" or not ObjectId.is_valid(facility_id):
        raise HTTPException(status_code=403, detail="This account is not assigned to a local hub")
    return facility_id


@router.post("/warehouse/me/local-hubs")
async def create_local_hub(payload: LocalHubCreate, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse" or current_user.get("facilityType") == "local_hub":
        raise HTTPException(status_code=403, detail="Only a warehouse manager can create a local hub")
    parent = await warehouse_repository.get_by_manager(str(current_user["_id"]))
    if not parent:
        raise HTTPException(status_code=404, detail="Parent warehouse was not found for this manager")
    users = MongoDB.get_collection("users")
    email = str(payload.email).lower().strip()
    username = payload.username.strip().lower()
    if await users.find_one({"$or": [{"email": email}, {"username": username}], "deletedAt": None}):
        raise HTTPException(status_code=409, detail="Email or username is already registered")
    now = datetime.utcnow()
    temporary_password = secrets.token_urlsafe(12)
    user_doc = {
        "firstName": payload.managerName.strip(),
        "lastName": "",
        "name": payload.managerName.strip(),
        "username": username,
        "email": email,
        "passwordHash": Security.get_password_hash(temporary_password),
        "role": "warehouse",
        "facilityType": "local_hub",
        "facilityId": None,
        "isVerified": True,
        "isActive": True,
        "status": "active",
        "mustChangePassword": True,
        "permissions": ["hub.dashboard", "hub.receive", "hub.inspect", "hub.inventory", "hub.delivery_assignment", "hub.complete_orders"],
        "createdBy": ObjectId(str(current_user["_id"])),
        "deletedAt": None,
        "createdAt": now,
        "updatedAt": now,
    }
    manager_id = await user_repository.create_user(user_doc)
    if not manager_id:
        raise HTTPException(status_code=500, detail="Could not create local hub manager account")
    hub_doc = {
        "name": payload.name.strip(),
        "facilityType": "local_hub",
        "parentWarehouseId": parent["_id"],
        "managerId": ObjectId(manager_id),
        "district": payload.district.strip(),
        "state": payload.state.strip(),
        "address": {"address": payload.address.strip(), "city": payload.district.strip(), "state": payload.state.strip()},
        "capacity": float(payload.capacity),
        "location": {"type": "Point", "coordinates": [float(payload.longitude), float(payload.latitude)]},
        "status": "active",
        "createdBy": ObjectId(str(current_user["_id"])),
        "createdAt": now,
        "updatedAt": now,
        "deletedAt": None,
    }
    hubs = MongoDB.get_collection("warehouses")
    inserted = await hubs.insert_one(hub_doc)
    await users.update_one({"_id": ObjectId(manager_id)}, {"$set": {"facilityId": str(inserted.inserted_id), "warehouseId": str(inserted.inserted_id), "updatedAt": now}})
    return {
        "success": True,
        "data": {"hub": {"id": str(inserted.inserted_id), "name": hub_doc["name"], "district": hub_doc["district"], "state": hub_doc["state"], "status": "active"}, "manager": {"id": manager_id, "username": username, "email": email, "mustChangePassword": True}, "temporaryPassword": temporary_password},
        "message": "Local hub and manager account created. Copy the temporary password now; it will not be shown again."
    }


@router.get("/warehouse/me/local-hubs")
async def list_local_hubs(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse" or current_user.get("facilityType") == "local_hub":
        raise HTTPException(status_code=403, detail="Only warehouse managers can manage local hubs")
    parent = await warehouse_repository.get_by_manager(str(current_user["_id"]))
    if not parent:
        raise HTTPException(status_code=404, detail="Parent warehouse not found")
    rows = await MongoDB.get_collection("warehouses").find({"parentWarehouseId": parent["_id"], "facilityType": "local_hub", "deletedAt": None}).sort("createdAt", -1).to_list(length=200)
    output = []
    for row in rows:
        manager = await user_repository.get_by_id(str(row.get("managerId") or ""))
        item = _safe(row)
        item["manager"] = {"name": (manager or {}).get("name"), "username": (manager or {}).get("username"), "email": (manager or {}).get("email"), "isActive": (manager or {}).get("isActive", False)}
        output.append(item)
    return {"success": True, "data": {"hubs": output}}


@router.get("/hub/me/dashboard")
async def hub_dashboard(current_user: dict = Depends(get_current_user)):
    hub_id = _hub_id(current_user)
    hub = await MongoDB.get_collection("warehouses").find_one({"_id": ObjectId(hub_id), "facilityType": "local_hub", "deletedAt": None})
    if not hub:
        raise HTTPException(status_code=404, detail="Assigned local hub was not found")
    transfers = MongoDB.get_collection("warehouse_order_transfers")
    incoming = await transfers.find({"destinationWarehouseId": {"$in": [ObjectId(hub_id), hub_id]}, "deletedAt": None, "status": {"$in": ["dispatched", "in_transit", "arrived_at_destination", "received", "ready_for_delivery"]}}).sort("updatedAt", -1).to_list(length=300)
    rows = []
    for transfer in incoming:
        order_id = str(transfer.get("orderId") or "")
        order = await order_repository.get_by_id(order_id) if ObjectId.is_valid(order_id) else None
        job = await delivery_job_repository.get_by_order_id(order_id) if order else None
        rows.append({
            "transferId": str(transfer["_id"]),
            "orderId": order_id,
            "orderNumber": (order or {}).get("orderNumber") or transfer.get("orderNumber") or order_id,
            "status": transfer.get("status", "dispatched"),
            "orderStatus": (order or {}).get("orderStatus"),
            "productSummary": ", ".join(str((item.get("productName") or item.get("name") or "Produce")) for item in ((order or {}).get("items") or [])[:3]) or "Order items",
            "quantity": sum(float(item.get("quantity") or 0) for item in ((order or {}).get("items") or [])),
            "deliveryAddress": (order or {}).get("deliveryAddress"),
            "published": bool(job and job.get("status") in (JOB_OPEN, "accepted", "delivered")),
            "jobStatus": (job or {}).get("status"),
        })
    return {"success": True, "data": {"hub": _safe(hub), "orders": rows, "counts": {"incoming": sum(1 for r in rows if r["status"] in ("dispatched", "in_transit", "arrived_at_destination")), "received": sum(1 for r in rows if r["status"] in ("received", "ready_for_delivery")), "published": sum(1 for r in rows if r["published"])}}}


@router.post("/hub/me/transfers/{transfer_id}/receive")
async def receive_hub_transfer(transfer_id: str, current_user: dict = Depends(get_current_user)):
    hub_id = _hub_id(current_user)
    if not ObjectId.is_valid(transfer_id):
        raise HTTPException(status_code=400, detail="Invalid transfer id")
    transfers = MongoDB.get_collection("warehouse_order_transfers")
    transfer = await transfers.find_one({"_id": ObjectId(transfer_id), "destinationWarehouseId": {"$in": [ObjectId(hub_id), hub_id]}, "deletedAt": None})
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not addressed to this hub")
    if transfer.get("status") not in ("dispatched", "in_transit", "arrived_at_destination", "received"):
        raise HTTPException(status_code=409, detail=f"Cannot receive transfer from status {transfer.get('status')}")
    now = datetime.utcnow()
    await transfers.update_one({"_id": transfer["_id"]}, {"$set": {"status": "received", "receivedAt": now, "receivedBy": ObjectId(str(current_user["_id"])), "updatedAt": now}})
    order_id = str(transfer.get("orderId") or "")
    order = await order_repository.get_by_id(order_id) if ObjectId.is_valid(order_id) else None
    if order:
        hub = await MongoDB.get_collection("warehouses").find_one({"_id": ObjectId(hub_id)})
        location = (hub or {}).get("location") or {}
        coords = location.get("coordinates") or []
        await order_repository.update({"_id": ObjectId(order_id)}, {"transferStatus": "hub_received", "nearbyFulfillmentLocationId": ObjectId(hub_id), "nearbyFulfillmentLocation": {"name": (hub or {}).get("name"), "address": (hub or {}).get("address"), "coordinates": coords}, "deliveryPickupLocation": {"name": (hub or {}).get("name"), "address": (hub or {}).get("address"), "coordinates": coords}, "updatedAt": now})
    return {"success": True, "data": {"transferId": transfer_id, "status": "received"}, "message": "Physical receipt recorded. The order can now be published for delivery."}


@router.post("/hub/me/orders/{order_id}/publish")
async def publish_hub_order(order_id: str, current_user: dict = Depends(get_current_user)):
    hub_id = _hub_id(current_user)
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid order id")
    order = await order_repository.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    transfers = MongoDB.get_collection("warehouse_order_transfers")
    transfer = await transfers.find_one({"orderId": {"$in": [ObjectId(order_id), order_id]}, "destinationWarehouseId": {"$in": [ObjectId(hub_id), hub_id]}, "status": "received", "deletedAt": None})
    if not transfer:
        raise HTTPException(status_code=409, detail="Confirm physical receipt at this hub before publishing the order")
    existing = await delivery_job_repository.get_by_order_id(order_id)
    if existing and str(existing.get("localHubId") or "") == hub_id and existing.get("status") in (JOB_OPEN, "accepted", "delivered"):
        return {"success": True, "data": {"jobId": str(existing["_id"]), "status": existing.get("status")}, "message": "Delivery job is already published from this hub"}
    if existing and existing.get("status") in ("accepted", "delivered") and str(existing.get("localHubId") or "") != hub_id:
        raise HTTPException(status_code=409, detail="This order already has a delivery partner or completed delivery from another source")
    hub = await MongoDB.get_collection("warehouses").find_one({"_id": ObjectId(hub_id), "facilityType": "local_hub"})
    if not hub:
        raise HTTPException(status_code=404, detail="Local hub not found")
    order_for_job = dict(order)
    order_for_job["nearbyFulfillmentLocationId"] = ObjectId(hub_id)
    order_for_job["nearbyFulfillmentLocation"] = {"name": hub.get("name"), "address": hub.get("address"), "coordinates": ((hub.get("location") or {}).get("coordinates") or [])}
    order_for_job["deliveryPickupLocation"] = {"name": hub.get("name"), "address": hub.get("address"), "coordinates": ((hub.get("location") or {}).get("coordinates") or [])}
    order_for_job["orderStatus"] = "dispatched"
    hub_coords = ((hub.get("location") or {}).get("coordinates") or [])
    if len(hub_coords) < 2:
        raise HTTPException(status_code=409, detail="Configure the local hub map coordinates before publishing delivery jobs")
    farm = {"name": hub.get("name") or "Local Hub", "address": hub.get("address") or "", "lat": float(hub_coords[1]), "lng": float(hub_coords[0])}
    job = build_job_document(order_for_job, farm, float(order.get("routeDistanceKm") or 0))
    job["jobType"] = "customer_delivery"
    job["localHubId"] = ObjectId(hub_id)
    job["publishedByHubManagerId"] = ObjectId(str(current_user["_id"]))
    job["pickupName"] = hub.get("name") or "Local Hub"
    job["pickupAddress"] = (hub.get("address") or {}).get("address") if isinstance(hub.get("address"), dict) else str(hub.get("address") or "")
    job["status"] = JOB_OPEN
    job_id = await delivery_job_repository.create_job(job)
    if not job_id:
        raise HTTPException(status_code=500, detail="Unable to publish delivery job")
    now = datetime.utcnow()
    await order_repository.update({"_id": ObjectId(order_id)}, {"orderStatus": "dispatched", "transferStatus": "published_to_delivery_partners", "deliveryPickupLocation": order_for_job["deliveryPickupLocation"], "nearbyFulfillmentLocationId": ObjectId(hub_id), "updatedAt": now})
    await transfers.update_one({"_id": transfer["_id"]}, {"$set": {"status": "ready_for_delivery", "deliveryJobId": ObjectId(job_id), "publishedAt": now, "updatedAt": now}})
    return {"success": True, "data": {"jobId": job_id, "status": JOB_OPEN}, "message": "Order published to the delivery-partner marketplace"}


@router.post("/warehouse/me/local-hubs/{hub_id}/orders/{order_id}/dispatch")
async def dispatch_order_to_local_hub(hub_id: str, order_id: str, current_user: dict = Depends(get_current_user)):
    """Dispatch an order from the manager's warehouse to one of its local hubs."""
    if current_user.get("role") != "warehouse" or current_user.get("facilityType") == "local_hub":
        raise HTTPException(status_code=403, detail="Only a warehouse manager can dispatch orders to a local hub")
    if not ObjectId.is_valid(hub_id) or not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid hub or order id")
    parent = await warehouse_repository.get_by_manager(str(current_user["_id"]))
    if not parent:
        raise HTTPException(status_code=404, detail="Source warehouse not found")
    hubs = MongoDB.get_collection("warehouses")
    hub = await hubs.find_one({"_id": ObjectId(hub_id), "parentWarehouseId": parent["_id"], "facilityType": "local_hub", "status": "active", "deletedAt": None})
    if not hub:
        raise HTTPException(status_code=404, detail="Active local hub was not found under this warehouse")
    order = await order_repository.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if str(order.get("sourceWarehouseId") or order.get("warehouseId") or "") not in (str(parent["_id"]), ""):
        raise HTTPException(status_code=403, detail="This order is not assigned to your source warehouse")
    status_value = str(order.get("orderStatus") or "").lower()
    if status_value not in ("packed", "ready_for_delivery", "ready_for_pickup", "dispatched"):
        raise HTTPException(status_code=409, detail=f"Order must be packed before dispatch (current status: {status_value or 'unknown'})")
    transfers = MongoDB.get_collection("warehouse_order_transfers")
    existing = await transfers.find_one({"orderId": {"$in": [ObjectId(order_id), order_id]}, "destinationWarehouseId": {"$in": [ObjectId(hub_id), hub_id]}, "deletedAt": None, "status": {"$in": ["dispatched", "in_transit", "arrived_at_destination", "received", "ready_for_delivery"]}})
    if existing:
        raise HTTPException(status_code=409, detail="This order already has an active transfer to this hub")
    now = datetime.utcnow()
    transfer_doc = {
        "orderId": ObjectId(order_id),
        "orderNumber": order.get("orderNumber"),
        "sourceWarehouseId": parent["_id"],
        "destinationWarehouseId": ObjectId(hub_id),
        "destinationFacilityType": "local_hub",
        "status": "dispatched",
        "dispatchedAt": now,
        "dispatchedBy": ObjectId(str(current_user["_id"])),
        "createdAt": now,
        "updatedAt": now,
        "deletedAt": None,
    }
    inserted = await transfers.insert_one(transfer_doc)
    await order_repository.update({"_id": ObjectId(order_id)}, {
        "orderStatus": "dispatched",
        "transferStatus": "dispatched_to_local_hub",
        "sourceWarehouseId": parent["_id"],
        "destinationWarehouseId": ObjectId(hub_id),
        "nearbyFulfillmentLocationId": ObjectId(hub_id),
        "updatedAt": now,
    })
    return {"success": True, "data": {"transferId": str(inserted.inserted_id), "orderId": order_id, "hubId": hub_id, "status": "dispatched"}, "message": "Order dispatched to local hub"}
