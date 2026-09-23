from fastapi import APIRouter, HTTPException, Depends, Query, Body
from typing import Optional
from datetime import datetime
from bson import ObjectId
import logging
from app.database.mongodb import MongoDB
from app.api.v1.auth import get_current_user
from app.repositories.base_repository import BaseRepository

logger = logging.getLogger(__name__)
router = APIRouter()

schedule_repo = BaseRepository("community_delivery_schedules")
subscription_repo = BaseRepository("community_subscriptions")
user_repo = BaseRepository("users")


@router.get("/available")
async def get_available_schedules(
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    radius: int = Query(10, ge=2, le=50),
):
    match: dict = {"status": "active", "cutoffTime": {"$gte": datetime.utcnow()}, "deletedAt": None}

    pipeline = [
        {"$match": match},
        {
            "$lookup": {
                "from": "farmer_profiles",
                "localField": "farmerId",
                "foreignField": "userId",
                "as": "farmer"
            }
        },
        {"$unwind": {"path": "$farmer", "preserveNullAndEmptyArrays": True}},
        {
            "$lookup": {
                "from": "users",
                "localField": "farmerId",
                "foreignField": "_id",
                "as": "farmerUser"
            }
        },
        {"$unwind": {"path": "$farmerUser", "preserveNullAndEmptyArrays": True}},
    ]

    if lat and lng:
        pipeline.append({
            "$geoNear": {
                "near": {"type": "Point", "coordinates": [lng, lat]},
                "distanceField": "distance",
                "maxDistance": radius * 1000,
                "spherical": True,
                "query": match
            }
        })
        pipeline = pipeline[1:]

    pipeline.append({"$limit": 50})

    schedules = await schedule_repo.aggregate(pipeline)
    for s in schedules:
        s["id"] = str(s.get("_id"))
        s["farmerId"] = str(s.get("farmerId"))
        if s.get("distance"):
            s["distanceKm"] = round(s["distance"] / 1000, 2)
        farmer_user = s.get("farmerUser", {})
        s["farmerInfo"] = {
            "name": f"{farmer_user.get('firstName', '')} {farmer_user.get('lastName', '')}".strip(),
            "phone": farmer_user.get("phone"),
            "rating": s.get("farmer", {}).get("rating"),
        }

    return {"success": True, "data": {"schedules": schedules, "count": len(schedules)}}


@router.post("/join")
async def join_schedule(
    scheduleId: str = Body(...),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "customer":
        raise HTTPException(status_code=403, detail="Only customers can join community buying schedules")

    schedule = await schedule_repo.find_one({"_id": ObjectId(scheduleId), "deletedAt": None})
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    if schedule.get("cutoffTime") and schedule["cutoffTime"] < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Cutoff time has passed for this schedule")

    existing = await subscription_repo.find_one({
        "scheduleId": ObjectId(scheduleId),
        "customerId": ObjectId(current_user["_id"]),
        "deletedAt": None
    })
    if existing:
        return {"success": True, "data": existing, "message": "Already joined this schedule"}

    subscription = {
        "scheduleId": ObjectId(scheduleId),
        "customerId": ObjectId(current_user["_id"]),
        "farmerId": schedule.get("farmerId"),
        "status": "active",
        "joinedAt": datetime.utcnow(),
    }

    sub_id = await subscription_repo.create(subscription)
    if not sub_id:
        raise HTTPException(status_code=400, detail="Failed to join schedule")

    sub = await subscription_repo.find_one({"_id": ObjectId(sub_id)})
    sub["id"] = str(sub["_id"])
    sub["scheduleId"] = str(sub["scheduleId"])
    sub["customerId"] = str(sub["customerId"])

    return {"success": True, "data": sub, "message": "Joined community delivery schedule successfully"}


@router.get("/my-schedules")
async def get_my_schedules(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "customer":
        raise HTTPException(status_code=403, detail="Only customers can view their schedules")

    pipeline = [
        {"$match": {"customerId": ObjectId(current_user["_id"]), "status": "active", "deletedAt": None}},
        {
            "$lookup": {
                "from": "community_delivery_schedules",
                "localField": "scheduleId",
                "foreignField": "_id",
                "as": "schedule"
            }
        },
        {"$unwind": {"path": "$schedule", "preserveNullAndEmptyArrays": True}},
        {"$sort": {"joinedAt": -1}},
    ]

    subs = await subscription_repo.aggregate(pipeline)
    for s in subs:
        s["id"] = str(s.get("_id"))
        s["scheduleId"] = str(s.get("scheduleId"))
        s["customerId"] = str(s.get("customerId"))
        if s.get("schedule"):
            s["schedule"]["id"] = str(s["schedule"].get("_id"))

    return {"success": True, "data": {"subscriptions": subs, "count": len(subs)}}


@router.post("/notify")
async def notify_subscribers(
    scheduleId: str = Body(...),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can send notifications")

    schedule = await schedule_repo.find_one({"_id": ObjectId(scheduleId), "deletedAt": None})
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    subscribers = await subscription_repo.find_many({
        "scheduleId": ObjectId(scheduleId),
        "status": "active",
        "deletedAt": None
    })

    customer_ids = [ObjectId(s["customerId"]) for s in subscribers if s.get("customerId")]
    customers = await user_repo.find_many({"_id": {"$in": customer_ids}}) if customer_ids else []

    logger.info(f"Notification triggered for schedule {scheduleId}: {len(subscribers)} subscribers notified")
    for c in customers:
        name = f"{c.get('firstName', '')} {c.get('lastName', '')}".strip()
        phone = c.get("phone", "N/A")
        logger.info(f"  -> Notified {name} ({phone})")

    update_result = await subscription_repo.update(
        {"scheduleId": ObjectId(scheduleId), "status": "active"},
        {"lastNotifiedAt": datetime.utcnow()}
    )

    return {
        "success": True,
        "data": {
            "subscriberCount": len(subscribers),
            "notifiedCount": len(customers),
            "scheduleId": scheduleId
        },
        "message": f"Notification sent to {len(customers)} subscribers"
    }


@router.get("/farmer/schedules")
async def get_farmer_schedules_with_subscribers(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can view their schedules")

    schedules = await schedule_repo.find_many(
        {"farmerId": ObjectId(current_user["_id"]), "deletedAt": None},
        sort=[("createdAt", -1)]
    )

    result = []
    for s in schedules:
        s["id"] = str(s["_id"])
        count = await subscription_repo.count({"scheduleId": s["_id"], "status": "active", "deletedAt": None})
        s["subscriberCount"] = count
        result.append(s)

    return {"success": True, "data": {"schedules": result, "count": len(result)}}
