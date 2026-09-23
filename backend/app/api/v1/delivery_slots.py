"""Farmer delivery slot marketplace.

Farmers publish planned delivery slots (area, date, time window, radius, max
orders). Customers can see which farmers will deliver to their area and join a
slot before its cutoff, which groups orders into planned delivery batches.

Collections:
  - delivery_slots:        farmer-published delivery slot
  - delivery_slot_bookings: customer joins against a slot
"""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from pydantic import BaseModel, Field
from bson import ObjectId
import logging

from app.api.v1.auth import get_current_user
from app.repositories.base_repository import BaseRepository
from app.repositories.user_repository import user_repository
from app.repositories.farmer_repository import farmer_repository
from app.services.notification_service import NotificationService
from app.schemas.notification import NotificationType, NotificationPriority

logger = logging.getLogger(__name__)
router = APIRouter()

slot_repo = BaseRepository("delivery_slots")
booking_repo = BaseRepository("delivery_slot_bookings")

SLOT_OPEN = "open"
SLOT_FULL = "full"
SLOT_CANCELLED = "cancelled"
SLOT_COMPLETED = "completed"


class DeliverySlotCreate(BaseModel):
    area: str
    date: datetime
    startTime: str
    endTime: str
    radiusKm: int = Field(10, ge=1, le=100)
    maxOrders: int = Field(25, ge=1, le=500)
    cutoffTime: Optional[datetime] = None
    deliveryFee: float = Field(0, ge=0)
    notes: Optional[str] = None


async def _slot_status(slot: dict) -> str:
    """Effective status accounting for cutoff time and booking count."""
    if slot.get("status") == SLOT_CANCELLED:
        return SLOT_CANCELLED
    cutoff = slot.get("cutoffTime")
    if cutoff and cutoff < datetime.utcnow():
        return "closed"
    bookings = await booking_repo.count({
        "slotId": slot["_id"],
        "status": "joined",
        "deletedAt": None,
    })
    if bookings >= int(slot.get("maxOrders", 25)):
        return SLOT_FULL
    return SLOT_OPEN


def _serialize_slot(slot: dict) -> dict:
    slot["id"] = str(slot["_id"])
    slot["farmerId"] = str(slot.get("farmerId"))
    return slot


async def _farmer_brief(farmer_id: str) -> dict:
    user = await user_repository.get_by_id(farmer_id)
    farm = await farmer_repository.find_one({"userId": ObjectId(farmer_id)}) if farmer_id else None
    if not user:
        return {"name": "Farmer", "farmName": None, "rating": None}
    name = f"{user.get('firstName', '')} {user.get('lastName', '')}".strip()
    return {
        "name": name or "Farmer",
        "farmName": farm.get("farmName") if farm else None,
        "rating": farm.get("rating") if farm else None,
        "farmAddress": (farm or {}).get("farmAddress"),
    }


# ================== FARMER ENDPOINTS ==================

@router.post("/slots")
async def create_delivery_slot(
    data: DeliverySlotCreate,
    current_user: dict = Depends(get_current_user),
):
    """Publish a delivery slot (Farmer only)."""
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can publish delivery slots")

    if data.date < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Slot date must be in the future")

    slot = {
        "farmerId": ObjectId(current_user["_id"]),
        "area": data.area.strip(),
        "date": data.date,
        "startTime": data.startTime,
        "endTime": data.endTime,
        "radiusKm": data.radiusKm,
        "maxOrders": data.maxOrders,
        "cutoffTime": data.cutoffTime,
        "deliveryFee": data.deliveryFee,
        "notes": data.notes,
        "status": SLOT_OPEN,
    }
    slot_id = await slot_repo.create(slot)
    if not slot_id:
        raise HTTPException(status_code=400, detail="Failed to create delivery slot")
    slot["_id"] = ObjectId(slot_id)
    return {"success": True, "data": _serialize_slot(slot)}


@router.get("/farmer/slots")
async def get_farmer_slots(
    include_past: bool = Query(False),
    current_user: dict = Depends(get_current_user),
):
    """List the current farmer's delivery slots with booking counts."""
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can view their slots")

    filter = {"farmerId": ObjectId(current_user["_id"]), "deletedAt": None}
    if not include_past:
        filter["date"] = {"$gte": datetime.utcnow()}

    slots = await slot_repo.find_many(filter, sort=[("date", -1)], limit=200)
    for s in slots:
        _serialize_slot(s)
        s["status"] = await _slot_status(s)
        s["bookings"] = await booking_repo.count({"slotId": s["_id"], "status": "joined", "deletedAt": None})
    return {"success": True, "data": {"slots": slots, "count": len(slots)}}


@router.put("/slots/{slot_id}")
async def update_delivery_slot(
    slot_id: str,
    data: DeliverySlotCreate,
    current_user: dict = Depends(get_current_user),
):
    """Update a delivery slot (own farmer only)."""
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can update delivery slots")

    slot = await slot_repo.find_one({"_id": ObjectId(slot_id), "deletedAt": None})
    if not slot:
        raise HTTPException(status_code=404, detail="Delivery slot not found")
    if str(slot.get("farmerId")) != str(current_user["_id"]):
        raise HTTPException(status_code=403, detail="Not your delivery slot")

    updates = {
        "area": data.area.strip(),
        "date": data.date,
        "startTime": data.startTime,
        "endTime": data.endTime,
        "radiusKm": data.radiusKm,
        "maxOrders": data.maxOrders,
        "cutoffTime": data.cutoffTime,
        "deliveryFee": data.deliveryFee,
        "notes": data.notes,
    }
    ok = await slot_repo.update({"_id": ObjectId(slot_id)}, updates)
    if not ok:
        raise HTTPException(status_code=400, detail="Failed to update delivery slot")
    updated = await slot_repo.find_one({"_id": ObjectId(slot_id)})
    return {"success": True, "data": _serialize_slot(updated)}


@router.post("/slots/{slot_id}/cancel")
async def cancel_delivery_slot(
    slot_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Cancel a delivery slot (own farmer only)."""
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can cancel delivery slots")

    slot = await slot_repo.find_one({"_id": ObjectId(slot_id), "deletedAt": None})
    if not slot:
        raise HTTPException(status_code=404, detail="Delivery slot not found")
    if str(slot.get("farmerId")) != str(current_user["_id"]):
        raise HTTPException(status_code=403, detail="Not your delivery slot")

    await slot_repo.update({"_id": ObjectId(slot_id)}, {"status": SLOT_CANCELLED})
    return {"success": True, "message": "Delivery slot cancelled"}


# ================== CUSTOMER ENDPOINTS ==================

@router.get("/reverse-geocode")
async def reverse_geocode(
    lat: float = Query(...),
    lng: float = Query(...),
):
    """Reverse-geocode coordinates into a short area string (customer "Use My Location")."""
    from app.database.mongodb import MongoDB
    import httpx

    key = f"{lat:.4f},{lng:.4f}"
    col = None
    try:
        col = MongoDB.get_collection("geocode_cache")
    except Exception:
        col = None

    if col is not None:
        try:
            cached = await col.find_one({"reverseKey": key})
            if cached and cached.get("area"):
                return {"success": True, "data": {"area": cached["area"]}}
        except Exception:
            pass

    area = None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={"lat": lat, "lon": lng, "format": "json", "zoom": 14},
                headers={"User-Agent": "AgriConnect/1.0"},
            )
            resp.raise_for_status()
            data = resp.json()
            address = data.get("address") or {}
            parts = []
            for k in ("road", "highway", "pedestrian", "footway"):
                if address.get(k):
                    parts.append(address[k])
                    break
            locality = ""
            for k in ("neighbourhood", "suburb", "village", "town", "city_district", "city", "municipality"):
                if address.get(k):
                    locality = address[k]
                    break
            if locality:
                parts.append(locality)
            elif not parts:
                for k in ("district", "county", "state_district"):
                    if address.get(k):
                        parts.append(address[k])
                        break
            for k in ("district", "county", "state_district"):
                if address.get(k) and (locality or not parts) and address.get(k) not in parts:
                    parts.append(address[k])
                    break
            if address.get("state") and address["state"] not in parts:
                parts.append(address["state"])
            if address.get("postcode"):
                parts.append(address["postcode"])
            if parts:
                area = ", ".join(parts)
    except Exception as e:
        logger.warning(f"Reverse geocode (nominatim) failed for {key}: {e}")

    if area and col is not None:
        try:
            await col.update_one(
                {"reverseKey": key},
                {"$set": {"area": area, "updatedAt": datetime.utcnow()}},
                upsert=True,
            )
        except Exception:
            pass

    return {"success": True, "data": {"area": area or f"{lat:.4f}, {lng:.4f}"}}


@router.get("/available")
async def list_available_slots(
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    radius: int = Query(50, ge=2, le=200),
    area: Optional[str] = Query(None),
):
    """List delivery slots customers can join, optionally geo-filtered."""
    now = datetime.utcnow()
    match: dict = {
        "deletedAt": None,
        "status": {"$ne": SLOT_CANCELLED},
        "date": {"$gte": now},
    }
    if area:
        match["area"] = {"$regex": f"^{area}"}

    pipeline = [
        {"$match": match},
        {"$lookup": {
            "from": "farmer_profiles",
            "localField": "farmerId",
            "foreignField": "userId",
            "as": "farm",
        }},
        {"$unwind": {"path": "$farm", "preserveNullAndEmptyArrays": True}},
        {"$addFields": {
            "useLocation": {
                "$cond": {
                    "if": {"$and": [{"$isArray": "$farm.location.coordinates"}, {"$gt": [{"$size": "$farm.location.coordinates"}, 0]}]},
                    "then": "$farm.location",
                    "else": "$farm.location",
                }
            }
        }},
        {"$sort": {"date": 1}},
        {"$limit": 100},
    ]

    if lat and lng:
        pipeline = [
            {"$match": match},
            {"$lookup": {
                "from": "farmer_profiles",
                "localField": "farmerId",
                "foreignField": "userId",
                "as": "farm",
            }},
            {"$unwind": {"path": "$farm", "preserveNullAndEmptyArrays": True}},
            {
                "$geoNear": {
                    "near": {"type": "Point", "coordinates": [lng, lat]},
                    "distanceField": "distance",
                    "maxDistance": radius * 1000,
                    "spherical": True,
                    "query": {"status": {"$ne": SLOT_CANCELLED}, "deletedAt": None, "date": {"$gte": now}},
                }
            },
            {"$sort": {"date": 1}},
            {"$limit": 100},
        ]

    slots = await slot_repo.aggregate(pipeline)
    for s in slots:
        _serialize_slot(s)
        s["status"] = await _slot_status(s)
        s["bookings"] = await booking_repo.count({"slotId": s["_id"], "status": "joined", "deletedAt": None})
        if s.get("distance"):
            s["distanceKm"] = round(s["distance"] / 1000, 2)
        farm = s.pop("farm", None) or {}
        s["farmerInfo"] = {
            "name": farm.get("farmName") or "Farmer",
            "farmName": farm.get("farmName"),
            "rating": farm.get("rating"),
            "farmAddress": farm.get("farmAddress"),
        }
    return {"success": True, "data": {"slots": slots, "count": len(slots)}}


@router.post("/slots/{slot_id}/join")
async def join_delivery_slot(
    slot_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Join a delivery slot so the farmer can batch your order (Customer only)."""
    if current_user.get("role") != "customer":
        raise HTTPException(status_code=403, detail="Only customers can join delivery slots")

    slot = await slot_repo.find_one({"_id": ObjectId(slot_id), "deletedAt": None})
    if not slot:
        raise HTTPException(status_code=404, detail="Delivery slot not found")
    if slot.get("status") == SLOT_CANCELLED:
        raise HTTPException(status_code=400, detail="This delivery slot was cancelled")
    cutoff = slot.get("cutoffTime")
    if cutoff and cutoff < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Cutoff time has passed for this slot")

    bookings = await booking_repo.count({"slotId": ObjectId(slot_id), "status": "joined", "deletedAt": None})
    if bookings >= int(slot.get("maxOrders", 25)):
        raise HTTPException(status_code=400, detail="This delivery slot is full")

    existing = await booking_repo.find_one({
        "slotId": ObjectId(slot_id),
        "customerId": ObjectId(current_user["_id"]),
        "status": "joined",
        "deletedAt": None,
    })
    if existing:
        return {"success": True, "data": {"id": str(existing["_id"])}, "message": "Already joined this slot"}

    booking = {
        "slotId": ObjectId(slot_id),
        "farmerId": slot.get("farmerId"),
        "customerId": ObjectId(current_user["_id"]),
        "status": "joined",
        "deliveryFee": slot.get("deliveryFee", 0),
    }
    booking_id = await booking_repo.create(booking)
    if not booking_id:
        raise HTTPException(status_code=400, detail="Failed to join delivery slot")
    booking["_id"] = ObjectId(booking_id)
    booking["id"] = str(booking_id)
    booking["slotId"] = str(slot_id)

    await NotificationService.create_in_app_notification(
        str(slot.get("farmerId")),
        NotificationType.ORDER,
        "New slot booking 📦",
        f"A customer joined your {slot.get('area')} delivery slot on {slot.get('date').strftime('%d %b')}.",
        {"slotId": slot_id, "type": "slot"},
        NotificationPriority.MEDIUM,
    )

    return {"success": True, "data": booking, "message": "Joined delivery slot"}


@router.delete("/slots/{slot_id}/join")
async def leave_delivery_slot(
    slot_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Leave a delivery slot you joined."""
    ok = await booking_repo.delete({
        "slotId": ObjectId(slot_id),
        "customerId": ObjectId(current_user["_id"]),
        "status": "joined",
    })
    return {"success": True, "message": "Left the delivery slot" if ok else "No active booking"}


@router.get("/my")
async def get_my_slots(current_user: dict = Depends(get_current_user)):
    """List slots the current customer has joined, with slot + farmer info."""
    pipeline = [
        {"$match": {"customerId": ObjectId(current_user["_id"]), "status": "joined", "deletedAt": None}},
        {"$lookup": {
            "from": "delivery_slots",
            "localField": "slotId",
            "foreignField": "_id",
            "as": "slot",
        }},
        {"$unwind": {"path": "$slot", "preserveNullAndEmptyArrays": True}},
        {"$sort": {"createdAt": -1}},
        {"$limit": 100},
    ]
    bookings = await booking_repo.aggregate(pipeline)
    for b in bookings:
        b["id"] = str(b["_id"])
        b["slotId"] = str(b.get("slotId"))
        if b.get("slot"):
            _serialize_slot(b["slot"])
            b["slot"]["status"] = await _slot_status(b["slot"])
            b["slot"]["farmerInfo"] = await _farmer_brief(str(b["slot"].get("farmerId")))
    return {"success": True, "data": {"bookings": bookings, "count": len(bookings)}}
