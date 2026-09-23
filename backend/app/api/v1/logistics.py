from fastapi import APIRouter, HTTPException, Depends, Query, Body
from typing import Optional, List
from datetime import datetime
from bson import ObjectId
import logging
from app.database.mongodb import MongoDB
from app.api.v1.auth import get_current_user
from app.repositories.base_repository import BaseRepository

logger = logging.getLogger(__name__)
router = APIRouter()

shipment_repo = BaseRepository("logistics_shipments")
carrier_repo = BaseRepository("logistics_carriers")

CARRIERS = [
    {"name": "India Post", "type": "government", "serviceableStates": "all", "baseRate": 50, "perKgRate": 10},
    {"name": "Delhivery", "type": "private", "serviceableStates": "all", "baseRate": 80, "perKgRate": 15},
    {"name": "Bluedart", "type": "private", "serviceableStates": "all", "baseRate": 100, "perKgRate": 20},
    {"name": "DTDC", "type": "private", "serviceableStates": "all", "baseRate": 70, "perKgRate": 12},
    {"name": "Ecom Express", "type": "private", "serviceableStates": "all", "baseRate": 90, "perKgRate": 18},
    {"name": "XpressBees", "type": "private", "serviceableStates": "all", "baseRate": 85, "perKgRate": 14},
    {"name": "Shadowfax", "type": "private", "serviceableStates": "all", "baseRate": 75, "perKgRate": 13},
]


@router.post("/shipments")
async def create_shipment(
    orderId: str = Body(...),
    fromState: str = Body(...),
    toState: str = Body(...),
    fromDistrict: str = Body(...),
    toDistrict: str = Body(...),
    weightKg: float = Body(...),
    deliveryType: str = Body("state", description="state or national"),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") not in ("farmer", "admin"):
        raise HTTPException(status_code=403, detail="Only farmers or admins can create shipments")

    shipment = {
        "orderId": ObjectId(orderId) if ObjectId.is_valid(orderId) else orderId,
        "farmerId": ObjectId(current_user["_id"]),
        "fromState": fromState,
        "toState": toState,
        "fromDistrict": fromDistrict,
        "toDistrict": toDistrict,
        "weightKg": weightKg,
        "deliveryType": deliveryType,
        "status": "pending",
        "carrierId": None,
        "trackingNumber": None,
        "estimatedCost": None,
        "bookedAt": None,
        "deliveredAt": None,
    }

    shipment_id = await shipment_repo.create(shipment)
    if not shipment_id:
        raise HTTPException(status_code=400, detail="Failed to create shipment")

    created = await shipment_repo.find_one({"_id": ObjectId(shipment_id)})
    created["id"] = str(created["_id"])
    created["orderId"] = str(created["orderId"])
    created["farmerId"] = str(created["farmerId"])

    return {"success": True, "data": created, "message": "Shipment created successfully"}


@router.get("/shipments")
async def list_shipments(
    status: Optional[str] = Query(None),
    delivery_type: Optional[str] = Query(None, alias="deliveryType"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user)
):
    filter_dict: dict = {"deletedAt": None}
    if current_user.get("role") == "farmer":
        filter_dict["farmerId"] = ObjectId(current_user["_id"])
    if status:
        filter_dict["status"] = status
    if delivery_type:
        filter_dict["deliveryType"] = delivery_type

    skip = (page - 1) * limit
    shipments = await shipment_repo.find_many(filter_dict, skip=skip, limit=limit, sort=[("createdAt", -1)])
    total = await shipment_repo.count(filter_dict)

    for s in shipments:
        s["id"] = str(s["_id"])
        s["orderId"] = str(s["orderId"])
        s["farmerId"] = str(s["farmerId"])
        if s.get("carrierId"):
            s["carrierId"] = str(s["carrierId"])

    return {
        "success": True,
        "data": {
            "shipments": shipments,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": max(1, (total + limit - 1) // limit)
            }
        }
    }


@router.get("/shipments/{shipment_id}")
async def get_shipment(
    shipment_id: str,
    current_user: dict = Depends(get_current_user)
):
    shipment = await shipment_repo.find_one({"_id": ObjectId(shipment_id), "deletedAt": None})
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")

    shipment["id"] = str(shipment["_id"])
    shipment["orderId"] = str(shipment["orderId"])
    shipment["farmerId"] = str(shipment["farmerId"])
    if shipment.get("carrierId"):
        shipment["carrierId"] = str(shipment["carrierId"])

    return {"success": True, "data": shipment}


@router.put("/shipments/{shipment_id}/status")
async def update_shipment_status(
    shipment_id: str,
    status: str = Body(...),
    tracking_number: Optional[str] = Body(None, alias="trackingNumber"),
    current_user: dict = Depends(get_current_user)
):
    shipment = await shipment_repo.find_one({"_id": ObjectId(shipment_id), "deletedAt": None})
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")

    update_data = {"status": status}
    if tracking_number:
        update_data["trackingNumber"] = tracking_number
    if status == "delivered":
        update_data["deliveredAt"] = datetime.utcnow()

    success = await shipment_repo.update({"_id": ObjectId(shipment_id)}, update_data)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to update shipment status")

    updated = await shipment_repo.find_one({"_id": ObjectId(shipment_id)})
    updated["id"] = str(updated["_id"])
    updated["orderId"] = str(updated["orderId"])
    updated["farmerId"] = str(updated["farmerId"])

    return {"success": True, "data": updated, "message": f"Shipment status updated to {status}"}


@router.get("/carriers")
async def list_carriers(current_user: dict = Depends(get_current_user)):
    existing = await carrier_repo.find_many({"deletedAt": None})
    if not existing:
        for c in CARRIERS:
            await carrier_repo.create(c)
        existing = await carrier_repo.find_many({"deletedAt": None})

    for c in existing:
        c["id"] = str(c["_id"])

    return {"success": True, "data": {"carriers": existing, "count": len(existing)}}


@router.post("/book")
async def book_carrier(
    shipment_id: str = Body(..., alias="shipmentId"),
    carrier_id: str = Body(..., alias="carrierId"),
    current_user: dict = Depends(get_current_user)
):
    shipment = await shipment_repo.find_one({"_id": ObjectId(shipment_id), "deletedAt": None})
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")

    carrier = await carrier_repo.find_one({"_id": ObjectId(carrier_id), "deletedAt": None})
    if not carrier:
        raise HTTPException(status_code=404, detail="Carrier not found")

    weight = shipment.get("weightKg", 1)
    base = carrier.get("baseRate", 50)
    per_kg = carrier.get("perKgRate", 10)
    estimated_cost = base + (per_kg * weight)

    tracking = f"AGRI-{ObjectId().generation_time.strftime('%y%m%d')}-{str(ObjectId())[:6].upper()}"

    update_data = {
        "carrierId": ObjectId(carrier_id),
        "trackingNumber": tracking,
        "estimatedCost": estimated_cost,
        "status": "booked",
        "bookedAt": datetime.utcnow(),
    }

    success = await shipment_repo.update({"_id": ObjectId(shipment_id)}, update_data)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to book carrier")

    updated = await shipment_repo.find_one({"_id": ObjectId(shipment_id)})
    updated["id"] = str(updated["_id"])
    updated["orderId"] = str(updated["orderId"])
    updated["farmerId"] = str(updated["farmerId"])
    updated["carrierId"] = str(updated["carrierId"])

    return {
        "success": True,
        "data": updated,
        "message": f"Carrier booked successfully. Tracking: {tracking}, Estimated cost: ₹{estimated_cost}"
    }
