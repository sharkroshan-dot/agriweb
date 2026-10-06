"""Timing-aware planned event sourcing.

Planned events (>24h) use smart sourcing to identify eligible farmers first.
Quotes are submitted through the existing bulk-offer engine, then this router
atomically reserves the selected live inventory and creates event fulfillments.
"""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Body
from bson import ObjectId

from app.api.v1.auth import get_current_user
from app.repositories.base_repository import BaseRepository
from app.repositories.farmer_repository import farmer_repository
from app.repositories.product_repository import product_repository
from app.repositories.inventory_repository import inventory_repository
from app.services.inventory_service import InventoryService
from app.services.bulk_order_service import (
    BulkOrderService,
    request_repo,
    offer_repo,
    REQUEST_AWARDED,
    OFFER_PENDING,
    OFFER_ACCEPTED,
)
from app.services.notification_service import NotificationService
from app.schemas.notification import NotificationType, NotificationPriority

router = APIRouter()
event_fulfillment_repo = BaseRepository("event_fulfillments")


def _deadline(request: dict) -> Optional[datetime]:
    raw = request.get("requestedDeliveryDate") or request.get("eventDate")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def _destination(request: dict):
    return (request.get("deliveryAddress") or {}).get("location")


def _distance(request: dict, farmer: dict) -> float:
    dest = _destination(request)
    origin = (farmer or {}).get("farmLocation") or (farmer or {}).get("location")
    try:
        dc = (dest or {}).get("coordinates")
        oc = (origin or {}).get("coordinates")
        if dc and oc and len(dc) >= 2 and len(oc) >= 2:
            return round(BulkOrderService.haversine_km(dc[1], dc[0], oc[1], oc[0]), 1)
    except Exception:
        pass
    return 999.0


async def _planned_candidates(request: dict) -> dict:
    farmers = await farmer_repository.find_many({"deletedAt": None}, limit=1000)
    rows = []
    for requested in request.get("items", []):
        required = float(requested.get("quantityKg") or 0)
        wanted = BulkOrderService._normalize(requested.get("name"))
        candidates = []
        for farmer in farmers:
            farmer_id = farmer.get("userId")
            if not farmer_id:
                continue
            for product in await product_repository.get_by_farmer(str(farmer_id), limit=500):
                product_name = BulkOrderService._normalize(product.get("name"))
                if product_name != wanted and wanted not in product_name and product_name not in wanted:
                    continue
                try:
                    available = float(await InventoryService.get_available_stock(str(product["_id"])))
                except Exception:
                    available = 0.0
                if available <= 0:
                    continue
                distance = _distance(request, farmer)
                coverage = min(available, required) / required * 100 if required else 0
                rating = float(farmer.get("rating") or 0)
                distance_score = max(0.0, 100.0 - min(distance, 100.0))
                # Planned sourcing: distance is useful, but never a hard filter.
                score = (
                    distance_score * 0.25
                    + min(coverage, 100.0) * 0.40
                    + (rating / 5.0) * 100 * 0.20
                    + (100.0 if available >= required else 50.0) * 0.15
                )
                candidates.append({
                    "farmerId": str(farmer_id),
                    "farmName": farmer.get("farmName") or farmer.get("name") or "Farmer",
                    "productId": str(product["_id"]),
                    "productName": product.get("name"),
                    "availableKg": round(available, 2),
                    "distanceKm": distance,
                    "rating": rating,
                    "score": round(score, 1),
                })
        candidates.sort(key=lambda x: (x["score"], -x["distanceKm"]), reverse=True)
        rows.append({
            "productName": requested.get("name"),
            "requiredKg": required,
            "candidates": candidates[:20],
        })
    return rows


@router.post("/requests/{request_id}/planned-source")
async def planned_source(request_id: str, current_user: dict = Depends(get_current_user)):
    request = await request_repo.find_one({"_id": ObjectId(request_id), "deletedAt": None})
    if not request or str(request.get("buyerUserId")) != str(current_user["_id"]):
        raise HTTPException(status_code=404, detail="Event request not found")
    if request.get("requestType") != "bulk_event" or request.get("purchaseMode") == "family_weekly":
        raise HTTPException(status_code=400, detail="Planned RFQ sourcing is only for event requests")

    deadline = _deadline(request)
    hours_left = round((deadline - datetime.utcnow()).total_seconds() / 3600, 1) if deadline else None
    if hours_left is not None and hours_left <= 24:
        raise HTTPException(status_code=400, detail="This event is urgent; use smart sourcing instead")

    destination = _destination(request)
    if not destination:
        try:
            from app.services.order_service import geocode_address
            addr = request.get("deliveryAddress") or {}
            destination = await geocode_address({
                "address_line1": addr.get("addressLine1") or "",
                "address_line2": addr.get("addressLine2") or "",
                "city": addr.get("city") or request.get("deliveryCity") or "",
                "state": addr.get("state") or "",
                "zip_code": addr.get("zipCode") or "",
                "country": "India",
            })
        except Exception:
            destination = None
        if destination:
            addr = request.get("deliveryAddress") or {}
            await request_repo.update({"_id": request["_id"]}, {
                "deliveryAddress": {**addr, "location": destination},
                "updatedAt": datetime.utcnow(),
            })
            request["deliveryAddress"] = {**addr, "location": destination}

    plan = await _planned_candidates(request)
    eligible = sorted({
        c["farmerId"]
        for row in plan
        for c in row.get("candidates", [])
    })
    sourcing = {
        "urgent": False,
        "hoursUntilDelivery": hours_left,
        "sourcingMode": "planned_rfq",
        "searchStrategy": "balanced",
        "plan": plan,
        "eligibleFarmerIds": eligible,
    }
    first_rfq_open = request.get("eventSourcingStatus") != "rfq_open"
    await request_repo.update({"_id": request["_id"]}, {
        "eventFulfillmentMode": "planned_rfq",
        "eventSourcingMode": "planned_rfq",
        "eventSourcingPlan": sourcing,
        "eventSourcingStatus": "rfq_open",
        "eventSourcingUpdatedAt": datetime.utcnow(),
    })

    if first_rfq_open:
        for farmer_id in eligible:
            await NotificationService.create_in_app_notification(
                farmer_id,
                NotificationType.PROMOTION,
                "New planned event RFQ 📋",
                f"{request.get('purpose') or 'Event'} {request.get('requestNumber')} needs your quote.",
                {"requestId": request_id, "type": "planned_event_rfq"},
                NotificationPriority.HIGH,
            )

    return {"success": True, "data": sourcing, "message": "Smart sourcing completed; RFQ opened for eligible farmers"}


@router.post("/requests/{request_id}/planned-confirm")
async def planned_confirm(request_id: str, data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    if current_user.get("role") not in ("customer", "business"):
        raise HTTPException(status_code=403, detail="Only buyers can confirm planned event sourcing")
    request = await request_repo.find_one({"_id": ObjectId(request_id), "deletedAt": None})
    if not request or str(request.get("buyerUserId")) != str(current_user["_id"]):
        raise HTTPException(status_code=404, detail="Event request not found")
    sourcing = request.get("eventSourcingPlan") or {}
    if sourcing.get("sourcingMode") != "planned_rfq":
        raise HTTPException(status_code=400, detail="Run planned smart sourcing first")
    if request.get("eventSourcingStatus") == "confirmed":
        raise HTTPException(status_code=400, detail="Event sourcing is already confirmed")

    offer_ids = [str(x) for x in (data.get("offerIds") or [])]
    if not offer_ids:
        raise HTTPException(status_code=400, detail="Select at least one farmer quote")

    offers = []
    for offer_id in offer_ids:
        try:
            oid = ObjectId(offer_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid quote selection")
        offer = await offer_repo.find_one({
            "_id": oid,
            "requestId": request["_id"],
            "status": OFFER_PENDING,
            "deletedAt": None,
        })
        if not offer:
            raise HTTPException(status_code=400, detail="One or more selected quotes are no longer available")
        if str(offer.get("farmerId")) not in set(sourcing.get("eligibleFarmerIds") or []):
            raise HTTPException(status_code=400, detail="Selected farmer is outside the smart-sourcing eligibility set")
        offers.append(offer)

    required = {
        str(i.get("name")).strip().lower(): float(i.get("quantityKg") or 0)
        for i in request.get("items", [])
    }
    covered = {}
    allocations = []
    for offer in offers:
        farmer_id = str(offer["farmerId"])
        for item in offer.get("items", []):
            key = str(item.get("name")).strip().lower()
            qty = float(item.get("quantityKg") or 0)
            covered[key] = covered.get(key, 0) + qty
            candidates = [
                c
                for row in sourcing.get("plan", [])
                for c in row.get("candidates", [])
                if str(c.get("farmerId")) == farmer_id
                and str(c.get("productName") or "").strip().lower() == key
            ]
            if not candidates:
                raise HTTPException(status_code=400, detail=f"No smart-sourced product match for {item.get('name')}")
            candidate = max(candidates, key=lambda c: float(c.get("availableKg") or 0))
            if qty > float(candidate.get("availableKg") or 0) + 1e-6:
                raise HTTPException(status_code=409, detail=f"Live stock changed for {item.get('name')}; run smart sourcing again")
            allocations.append((offer, item, candidate))

    shortages = [
        {
            "productName": name,
            "requiredKg": qty,
            "selectedKg": round(covered.get(name, 0), 2),
            "shortageKg": round(max(0, qty - covered.get(name, 0)), 2),
        }
        for name, qty in required.items()
        if covered.get(name, 0) + 1e-6 < qty
    ]
    if shortages:
        raise HTTPException(status_code=400, detail={"message": "Selected quotes do not cover the complete event", "shortages": shortages})

    reserved = []
    created = []
    try:
        for offer, item, candidate in allocations:
            quantity = float(item.get("quantityKg") or 0)
            ok = await inventory_repository.atomic_reserve(str(candidate["productId"]), quantity)
            if not ok:
                raise HTTPException(status_code=409, detail=f"Stock changed for {item.get('name')}; run smart sourcing again")
            reserved.append((str(candidate["productId"]), quantity))

            fulfillment = {
                "requestId": request["_id"],
                "requestNumber": request.get("requestNumber"),
                "buyerUserId": request.get("buyerUserId"),
                "farmerId": ObjectId(offer["farmerId"]),
                "productId": ObjectId(candidate["productId"]),
                "productName": item.get("name"),
                "requiredQuantityKg": required.get(str(item.get("name")).strip().lower(), quantity),
                "allocatedQuantityKg": quantity,
                "quotedPricePerKg": float(item.get("pricePerKg") or 0),
                "quotedTotal": round(quantity * float(item.get("pricePerKg") or 0), 2),
                "offerId": offer["_id"],
                "source": "planned_quote",
                "status": "pending_farmer_confirmation",
                "packingStatus": "not_started",
                "collectionStatus": "pending",
                "deliveryStatus": "pending_consolidation",
                "distanceKm": candidate.get("distanceKm"),
                "farmName": candidate.get("farmName"),
            }
            fid = await event_fulfillment_repo.create(fulfillment)
            if not fid:
                raise RuntimeError("Failed to create event fulfillment")
            fulfillment["_id"] = ObjectId(fid)
            created.append(fulfillment)

        await offer_repo.collection.update_many(
            {"_id": {"$in": [o["_id"] for o in offers]}},
            {"$set": {"status": OFFER_ACCEPTED, "acceptedAt": datetime.utcnow()}},
        )
        await request_repo.update({"_id": request["_id"]}, {
            "status": REQUEST_AWARDED,
            "eventSourcingStatus": "confirmed",
            "eventFulfillmentMode": "planned_rfq",
            "eventDeliveryStatus": "awaiting_farmer_confirmation",
            "eventConsolidationStatus": "pending_collection",
            "eventFulfillmentIds": [x["_id"] for x in created],
            "updatedAt": datetime.utcnow(),
        })
    except HTTPException:
        for product_id, qty in reserved:
            await inventory_repository.atomic_release(product_id, qty)
        raise
    except Exception as exc:
        for product_id, qty in reserved:
            await inventory_repository.atomic_release(product_id, qty)
        raise HTTPException(status_code=500, detail=f"Failed to confirm planned event: {exc}")

    for fulfillment in created:
        await NotificationService.create_in_app_notification(
            str(fulfillment["farmerId"]),
            NotificationType.ORDER,
            "Planned event quote accepted 🎉",
            f"{fulfillment['productName']} {fulfillment['allocatedQuantityKg']} kg for {request.get('purpose') or 'event'} • {request.get('requestNumber')}.",
            {"requestId": request_id, "type": "event_fulfillment"},
            NotificationPriority.HIGH,
        )

    return {
        "success": True,
        "data": {
            "requestId": request_id,
            "fulfillments": [
                {
                    **f,
                    "id": str(f["_id"]),
                    "requestId": str(f["requestId"]),
                    "farmerId": str(f["farmerId"]),
                    "productId": str(f["productId"]),
                }
                for f in created
            ],
        },
        "message": "Planned event confirmed, inventory reserved, and farmer fulfillments created",
    }