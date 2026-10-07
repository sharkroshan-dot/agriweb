"""Bulk / Event order engine - purchase requests, farmer offers, and bulk orders.

One common "request -> offer -> selection -> order" engine for BOTH:
  - customer event orders (weddings/functions/festivals)  buyer_type=CUSTOMER
  - business RFQs (restaurants/hotels/wholesalers)         buyer_type=BUSINESS

Farmers see a unified "Purchase Requests" inbox; buyers compare farmer offers
(optionally split across several farmers) and accept to create bulk orders.

Collections:
  - bulk_requests:  the buyer's purchase request (event or RFQ)
  - bulk_offers:    a farmer's supply offer against a request
  - bulk_orders:    an accepted offer -> one order allocation per farmer
"""
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from pydantic import BaseModel, Field
from bson import ObjectId
import logging

from app.api.v1.auth import get_current_user
from app.database.mongodb import MongoDB
from app.repositories.base_repository import BaseRepository
from app.repositories.farmer_repository import farmer_repository
from app.repositories.address_repository import address_repository
from app.services.notification_service import NotificationService
from app.services.delivery_job_service import eligible_partners_for_job, JOB_DEFAULT_EXPIRY_MINUTES
from app.repositories.delivery_job_repository import delivery_job_repository
from app.schemas.notification import NotificationType, NotificationPriority
from app.services.bulk_order_service import (
    BulkOrderService,
    request_repo,
    offer_repo,
    order_repo,
    REQUEST_OPEN,
    REQUEST_OFFERS,
    REQUEST_AWARDED,
    REQUEST_CANCELLED,
    OFFER_PENDING,
    OFFER_ACCEPTED,
    OFFER_DECLINED,
    ORDER_CONFIRMED,
    ORDER_DELIVERED,
    ORDER_CANCELLED,
    VALID_ORDER_FLOW,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ================== SCHEMAS ==================

class BulkLocation(BaseModel):
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class BulkAddress(BaseModel):
    addressLine1: Optional[str] = None
    address_line1: Optional[str] = None
    addressLine2: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zipCode: Optional[str] = None
    zip_code: Optional[str] = None
    location: Optional[BulkLocation] = None


class BulkItemCreate(BaseModel):
    name: str = Field(..., min_length=1)
    category: Optional[str] = None
    quantityKg: float = Field(..., gt=0)
    qualityGrade: Optional[str] = None
    notes: Optional[str] = None


class BulkRequestCreate(BaseModel):
    requestType: str = Field(..., description="bulk_event | b2b")
    purpose: str = Field(..., description="wedding/birthday/function/festival/family_event/other or business purpose")
    eventDate: Optional[str] = None
    guestCount: Optional[int] = Field(None, gt=0)
    purchaseMode: Optional[str] = Field("event", description="event | family_weekly")
    requestedDeliveryDate: str
    requestedDeliveryTime: Optional[str] = None
    deliveryCity: Optional[str] = None
    deliveryAddressId: Optional[str] = None
    deliveryAddress: Optional[BulkAddress] = None
    items: List[BulkItemCreate] = Field(..., min_length=1)
    budget: Optional[float] = Field(None, gt=0)
    notes: Optional[str] = None


class BulkOfferItem(BaseModel):
    name: str = Field(..., min_length=1)
    quantityKg: float = Field(..., gt=0)
    pricePerKg: float = Field(..., gt=0)


class BulkOfferCreate(BaseModel):
    items: List[BulkOfferItem] = Field(..., min_length=1)
    deliveryAvailable: bool = True
    deliveryNote: Optional[str] = None


class OfferAccept(BaseModel):
    deliveryMethod: str = Field("farmer_delivery", description="farmer_delivery | delivery_partner | farm_pickup")
    paymentMethod: str = Field("cod", description="online | cod")


class BulkOrderStatusUpdate(BaseModel):
    status: str


# ================== HELPERS ==================

def _buyer_label(user: dict) -> str:
    name = f"{user.get('firstName') or ''} {user.get('lastName') or ''}".strip()
    return name or user.get("phone") or "Buyer"


def _coerce_address(data: BulkAddress) -> dict:
    line1 = data.addressLine1 or data.address_line1
    line2 = data.addressLine2 or data.address_line2
    loc = None
    if data.location and data.location.latitude is not None and data.location.longitude is not None:
        loc = {"type": "Point", "coordinates": [data.location.longitude, data.location.latitude]}
    return {
        "addressLine1": line1,
        "addressLine2": line2,
        "city": data.city,
        "state": data.state,
        "zipCode": data.zipCode or data.zip_code,
        "location": loc,
    }


async def _resolve_delivery_address(user_id: str, data: BulkRequestCreate) -> dict:
    if data.deliveryAddressId:
        addr = await address_repository.get_address_by_id(data.deliveryAddressId, str(user_id))
        if addr:
            loc = None
            loc_raw = addr.get("location")
            if isinstance(loc_raw, dict):
                loc = loc_raw
            return {
                "addressLine1": addr.get("address_line1") or addr.get("addressLine1"),
                "addressLine2": addr.get("address_line2") or addr.get("addressLine2"),
                "city": addr.get("city"),
                "state": addr.get("state"),
                "zipCode": addr.get("zip_code") or addr.get("zipCode"),
                "location": loc,
            }
    if data.deliveryAddress:
        return _coerce_address(data.deliveryAddress)
    return {}


def _stringify_request(r: dict) -> dict:
    r["id"] = str(r["_id"])
    r["buyerUserId"] = str(r.get("buyerUserId"))
    if r.get("deliveryAddressId"):
        r["deliveryAddressId"] = str(r["deliveryAddressId"])
    return r


async def _stringify_offer(o: dict) -> dict:
    o["id"] = str(o["_id"])
    o["requestId"] = str(o.get("requestId"))
    o["farmerId"] = str(o.get("farmerId"))
    farmer = await farmer_repository.find_one({"userId": ObjectId(o["farmerId"])})
    o["farmerInfo"] = {
        "farmName": (farmer or {}).get("farmName"),
        "rating": (farmer or {}).get("rating"),
        "city": (farmer or {}).get("farmCity") or (farmer or {}).get("city"),
        "isVerified": bool((farmer or {}).get("isVerified")),
    }
    return o


async def _stringify_order(o: dict) -> dict:
    o["id"] = str(o["_id"])
    o["requestId"] = str(o.get("requestId"))
    o["buyerUserId"] = str(o.get("buyerUserId"))
    o["farmerId"] = str(o.get("farmerId"))
    farmer = await farmer_repository.find_one({"userId": ObjectId(o["farmerId"])})
    o["farmerInfo"] = {"farmName": (farmer or {}).get("farmName"), "rating": (farmer or {}).get("rating")}
    return o


# ================== REQUESTS ==================

@router.post("/requests")
async def create_request(
    data: BulkRequestCreate,
    current_user: dict = Depends(get_current_user),
):
    """Publish a bulk / event purchase request (Customer or Business)."""
    role = current_user.get("role")
    if role not in ("customer", "business"):
        raise HTTPException(status_code=403, detail="Only customers and business accounts can create requests")

    buyer_type = "business" if role == "business" else "customer"
    request_type = data.requestType or ("b2b" if role == "business" else "bulk_event")

    delivery_address = await _resolve_delivery_address(str(current_user["_id"]), data)
    if not delivery_address.get("addressLine1") and not data.deliveryCity:
        raise HTTPException(status_code=400, detail="A delivery location (address or city) is required")

    req = {
        "buyerType": buyer_type,
        "requestType": request_type,
        "buyerUserId": ObjectId(current_user["_id"]),
        "buyerName": _buyer_label(current_user),
        "purpose": data.purpose.strip(),
        "eventDate": data.eventDate,
        "guestCount": data.guestCount,
        "purchaseMode": data.purchaseMode or "event",
        "isManualWeeklyFamilyBasket": (data.purchaseMode or "event") == "family_weekly",
        "requestedDeliveryDate": data.requestedDeliveryDate,
        "requestedDeliveryTime": data.requestedDeliveryTime,
        "deliveryCity": data.deliveryCity,
        "deliveryAddress": delivery_address,
        "items": [i.model_dump() for i in data.items],
        "budget": data.budget,
        "notes": data.notes,
        "requestNumber": BulkOrderService.request_number(),
        "status": REQUEST_OPEN,
    }
    req_id = await request_repo.create(req)
    if not req_id:
        raise HTTPException(status_code=400, detail="Failed to create request")
    req["_id"] = ObjectId(req_id)

    return {
        "success": True,
        "data": _stringify_request(req),
        "message": "Request published; farmers can now submit offers",
    }


@router.get("/requests")
async def list_requests(
    scope: str = Query("mine", description="mine | open"),
    status: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
):
    """List purchase requests. Buyers see their own; farmers see open, matched ones."""
    role = current_user.get("role")

    if role in ("customer", "business"):
        match = {"buyerUserId": ObjectId(current_user["_id"]), "deletedAt": None}
        if status and status != "all":
            match["status"] = status
    elif role == "farmer":
        if scope == "mine":
            offered = await offer_repo.find_many({"farmerId": ObjectId(current_user["_id"]), "deletedAt": None}, limit=limit)
            ids = [o.get("requestId") for o in offered]
            match = {"_id": {"$in": ids}, "deletedAt": None} if ids else {"_id": {"$in": []}}
        else:
            match = {"status": {"$in": [REQUEST_OPEN, REQUEST_OFFERS]}, "deletedAt": None}
    elif role in ("admin", "super_admin"):
        match = {"deletedAt": None}
        if status and status != "all":
            match["status"] = status
    else:
        raise HTTPException(status_code=403, detail="Not allowed to browse requests")

    requests = await request_repo.find_many(match, sort=[("createdAt", -1)], limit=limit)
    results = []
    for r in requests:
        r = _stringify_request(r)
        if role == "farmer":
            m = await BulkOrderService.match_request_for_farmer(r, str(current_user["_id"]))
            if scope == "mine":
                r["myMatch"] = m
            else:
                if not m["canSupply"]:
                    continue
                r["matchInfo"] = m
            my_offer = await offer_repo.find_one({
                "requestId": ObjectId(r["id"]),
                "farmerId": ObjectId(current_user["_id"]),
                "deletedAt": None,
            })
            r["myOfferStatus"] = (my_offer or {}).get("status")
            r["myOfferId"] = str(my_offer["_id"]) if my_offer else None
        r["offerCount"] = await offer_repo.count({"requestId": ObjectId(r["id"]), "deletedAt": None})
        results.append(r)

    return {"success": True, "data": {"requests": results, "count": len(results)}}


@router.get("/requests/{request_id}")
async def get_request(
    request_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Request detail with offers (buyer also gets the AI recommendation)."""
    request = await request_repo.find_one({"_id": ObjectId(request_id), "deletedAt": None})
    if not request:
        raise HTTPException(status_code=404, detail="Request not found")

    role = current_user.get("role")
    is_buyer = str(request.get("buyerUserId")) == str(current_user["_id"])
    is_farmer = role == "farmer"
    is_admin = role in ("admin", "super_admin")
    if not (is_buyer or is_farmer or is_admin):
        raise HTTPException(status_code=403, detail="Not allowed to view this request")

    request = _stringify_request(request)

    offers = await offer_repo.find_many(
        {"requestId": ObjectId(request_id), "deletedAt": None},
        sort=[("createdAt", -1)],
    )
    enriched = []
    for o in offers:
        enriched.append(await _stringify_offer(o))
    request["offers"] = enriched

    if is_buyer or is_admin:
        request["recommendation"] = await BulkOrderService.recommend(request, enriched)
    if is_farmer:
        request["matchInfo"] = await BulkOrderService.match_request_for_farmer(request, str(current_user["_id"]))

    return {"success": True, "data": request}


@router.post("/requests/{request_id}/cancel")
async def cancel_request(
    request_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Buyer cancels their open request."""
    request = await request_repo.find_one({"_id": ObjectId(request_id), "deletedAt": None})
    if not request:
        raise HTTPException(status_code=404, detail="Request not found")
    if str(request.get("buyerUserId")) != str(current_user["_id"]):
        raise HTTPException(status_code=403, detail="Not your request")
    if request.get("status") == REQUEST_AWARDED:
        raise HTTPException(status_code=400, detail="Awarded requests cannot be cancelled")

    await request_repo.update({"_id": request["_id"]}, {"status": REQUEST_CANCELLED})
    await offer_repo.collection.update_many(
        {"requestId": request["_id"], "status": OFFER_PENDING},
        {"$set": {"status": OFFER_DECLINED, "updatedAt": datetime.utcnow()}},
    )
    return {"success": True, "data": {"id": request_id}, "message": "Request cancelled"}


# ================== OFFERS ==================

@router.post("/requests/{request_id}/offers")
async def submit_offer(
    request_id: str,
    data: BulkOfferCreate,
    current_user: dict = Depends(get_current_user),
):
    """Submit a supply offer against a request (Farmer)."""
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can submit offers")

    farmer = await farmer_repository.find_one({"userId": ObjectId(current_user["_id"])})
    if farmer and farmer.get("isVerified") is False:
        raise HTTPException(status_code=403, detail="Your farmer account must be verified to submit offers")

    request = await request_repo.find_one({"_id": ObjectId(request_id), "deletedAt": None})
    if not request:
        raise HTTPException(status_code=404, detail="Request not found")
    if request.get("status") not in (REQUEST_OPEN, REQUEST_OFFERS):
        raise HTTPException(status_code=400, detail="This request is no longer accepting offers")

    existing = await offer_repo.find_one({
        "requestId": ObjectId(request_id),
        "farmerId": ObjectId(current_user["_id"]),
        "status": {"$ne": OFFER_DECLINED},
        "deletedAt": None,
    })
    if existing:
        raise HTTPException(status_code=400, detail="You already have an offer on this request")

    request_items = {item.get("name", "").strip().lower(): float(item.get("quantityKg") or 0) for item in request.get("items", [])}
    normalized = []
    for item in data.items:
        key = item.name.strip().lower()
        if key not in request_items:
            raise HTTPException(status_code=400, detail=f"'{item.name}' is not in the request")
        normalized.append({
            "name": item.name.strip(),
            "quantityKg": item.quantityKg,
            "pricePerKg": item.pricePerKg,
        })

    total_price = sum(float(i["quantityKg"]) * float(i["pricePerKg"]) for i in normalized)
    covered = sum(request_items.get(i["name"].lower(), 0) for i in normalized)
    total_qty = sum(request_items.values())
    coverage = (covered / total_qty * 100.0) if total_qty else 0.0

    offer = {
        "requestId": ObjectId(request_id),
        "buyerUserId": request.get("buyerUserId"),
        "farmerId": ObjectId(current_user["_id"]),
        "items": normalized,
        "deliveryAvailable": bool(data.deliveryAvailable),
        "deliveryNote": data.deliveryNote,
        "totalPrice": round(total_price, 2),
        "coveragePercent": round(coverage, 1),
        "status": OFFER_PENDING,
    }
    offer_id = await offer_repo.create(offer)
    if not offer_id:
        raise HTTPException(status_code=400, detail="Failed to submit offer")
    offer["_id"] = ObjectId(offer_id)

    await request_repo.update({"_id": request["_id"]}, {"status": REQUEST_OFFERS})
    await NotificationService.create_in_app_notification(
        str(request.get("buyerUserId")),
        NotificationType.PROMOTION,
        "New offer on your bulk request 🎉",
        f"{(farmer or {}).get('farmName') or 'A farmer'} offered an estimate of Rs {offer['totalPrice']:.0f} for {request.get('requestNumber')}.",
        {"requestId": request_id, "offerId": str(offer_id), "type": "bulk"},
        NotificationPriority.HIGH,
    )

    return {
        "success": True,
        "data": await _stringify_offer(offer),
        "message": "Offer submitted",
    }


@router.get("/requests/{request_id}/offers")
async def list_offers(
    request_id: str,
    current_user: dict = Depends(get_current_user),
):
    """List offers on a request (its buyer, or farmers, or admins)."""
    request = await request_repo.find_one({"_id": ObjectId(request_id), "deletedAt": None})
    if not request:
        raise HTTPException(status_code=404, detail="Request not found")
    can_view = (
        current_user.get("role") in ("admin", "super_admin")
        or str(request.get("buyerUserId")) == str(current_user["_id"])
        or current_user.get("role") == "farmer"
    )
    if not can_view:
        raise HTTPException(status_code=403, detail="Not allowed to view offers")

    offers = await offer_repo.find_many({"requestId": ObjectId(request_id), "deletedAt": None}, sort=[("createdAt", -1)])
    results = [await _stringify_offer(o) for o in offers]
    return {"success": True, "data": {"offers": results, "count": len(results)}}


# ================== ACCEPT -> ORDER (supports split) ==================

@router.post("/offers/{offer_id}/accept")
async def accept_offer(
    offer_id: str,
    data: OfferAccept = Body(default=OfferAccept()),
    current_user: dict = Depends(get_current_user),
):
    """Buyer accepts a farmer offer, creating a bulk order. Split supported: multiple offers on the same request can be accepted (coverage accumulates until the request is awarded)."""
    role = current_user.get("role")
    if role not in ("customer", "business"):
        raise HTTPException(status_code=403, detail="Only buyers can accept offers")

    offer = await offer_repo.find_one({"_id": ObjectId(offer_id), "deletedAt": None})
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found")
    request = await request_repo.find_one({"_id": offer.get("requestId"), "deletedAt": None})
    if not request:
        raise HTTPException(status_code=404, detail="Request not found")
    if str(request.get("buyerUserId")) != str(current_user["_id"]):
        raise HTTPException(status_code=403, detail="Not your request")
    if request.get("status") == REQUEST_CANCELLED:
        raise HTTPException(status_code=400, detail="Request was cancelled")
    if offer.get("status") != OFFER_PENDING:
        raise HTTPException(status_code=400, detail="Offer is no longer pending")

    await offer_repo.update({"_id": offer["_id"]}, {"status": OFFER_ACCEPTED, "acceptedAt": datetime.utcnow()})

    total_amount = float(offer.get("totalPrice") or 0)
    delivery_charge = 0.0
    delivery_details = None
    delivery_method = (data.deliveryMethod or "farmer_delivery").lower()
    if delivery_method not in ("farm_pickup", "buyer_pickup"):
        # Bulk / event delivery pricing: vehicle base + distance + weight/load.
        from app.services.delivery_fee_service import delivery_fee_service
        from app.services.order_service import geocode_address

        weight_kg = sum(float(i.get("quantityKg") or 0) for i in offer.get("items", []))
        farmer_profile = await farmer_repository.find_one({"userId": ObjectId(offer.get("farmerId"))})
        origin = None
        farm_loc = (farmer_profile or {}).get("farmLocation") or (farmer_profile or {}).get("location")
        if farm_loc:
            origin = farm_loc
        elif (farmer_profile or {}).get("farmAddress"):
            try:
                origin = await geocode_address({
                    "address_line1": farmer_profile.get("farmAddress") or "",
                    "city": farmer_profile.get("farmCity") or "",
                    "country": "India",
                })
            except Exception:
                origin = None

        dest = (request.get("deliveryAddress") or {}).get("location")
        if not dest:
            addr = request.get("deliveryAddress") or {}
            try:
                dest = await geocode_address({
                    "address_line1": addr.get("addressLine1") or addr.get("address_line1") or "",
                    "address_line2": addr.get("addressLine2") or "",
                    "city": addr.get("city") or request.get("deliveryCity") or "",
                    "state": addr.get("state") or "",
                    "zip_code": addr.get("zipCode") or addr.get("zip_code") or "",
                    "country": addr.get("country") or "India",
                })
            except Exception:
                dest = None

        quote = await delivery_fee_service.calculate_delivery_fee(
            from_location=origin,
            to_location=dest,
            weight_kg=weight_kg,
            method="bulk",
        )
        delivery_charge = quote["fee"]
        delivery_details = {
            "method": "bulk",
            "distanceKm": quote["distanceKm"],
            "weightKg": quote["weightKg"],
            "baseFee": quote["baseFee"],
            "distanceFee": quote["distanceFee"],
            "weightFee": quote["weightFee"],
            "minimumApplied": quote["minimumApplied"],
            "fee": quote["fee"],
            "freeDelivery": quote["freeDelivery"],
            "subsidy": quote["subsidy"],
            "distanceAvailable": quote["distanceAvailable"],
        }
        total_amount = round(total_amount + delivery_charge, 2)

    order = {
        "requestId": offer.get("requestId"),
        "requestNumber": request.get("requestNumber"),
        "orderNumber": BulkOrderService.order_number(),
        "buyerUserId": request.get("buyerUserId"),
        "buyerType": request.get("buyerType"),
        "buyerName": request.get("buyerName"),
        "farmerId": offer.get("farmerId"),
        "items": offer.get("items", []),
        "totalAmount": total_amount,
        "deliveryCharge": delivery_charge,
        "deliveryDetails": delivery_details,
        "deliveryMethod": data.deliveryMethod,
        "paymentMethod": data.paymentMethod,
        "purpose": request.get("purpose"),
        "eventDate": request.get("eventDate"),
        "requestedDeliveryDate": request.get("requestedDeliveryDate"),
        "requestedDeliveryTime": request.get("requestedDeliveryTime"),
        "deliveryAddress": request.get("deliveryAddress"),
        "status": ORDER_CONFIRMED,
        "statusHistory": [{"status": ORDER_CONFIRMED, "at": datetime.utcnow()}],
    }
    order_id = await order_repo.create(order)
    order["_id"] = ObjectId(order_id)

    # Accumulate coverage across accepted offers; award when fully covered.
    accepted = await offer_repo.find_many({
        "requestId": offer.get("requestId"),
        "status": OFFER_ACCEPTED,
        "deletedAt": None,
    })
    request_items = {item.get("name", "").strip().lower(): float(item.get("quantityKg") or 0) for item in request.get("items", [])}
    covered = sum(
        float(i["quantityKg"])
        for o in accepted
        for i in o.get("items", [])
        if i.get("name", "").strip().lower() in request_items
    )
    total_qty = sum(request_items.values())
    fully_covered = total_qty > 0 and covered >= total_qty

    if fully_covered:
        await request_repo.update({"_id": request["_id"]}, {"status": REQUEST_AWARDED})
        await offer_repo.collection.update_many(
            {"requestId": offer.get("requestId"), "status": OFFER_PENDING},
            {"$set": {"status": OFFER_DECLINED, "updatedAt": datetime.utcnow()}},
        )

    await NotificationService.create_in_app_notification(
        str(offer.get("farmerId")),
        NotificationType.ORDER,
        "Your offer was accepted! 🎉",
        f"Offer accepted for {request.get('requestNumber')}. Deliver {offer.get('coveragePercent', 0)}% of the requested quantity.",
        {"requestId": str(request["_id"]), "orderId": order_id, "type": "bulk"},
        NotificationPriority.HIGH,
    )

    return {
        "success": True,
        "data": {"order": await _stringify_order(order), "offerId": offer_id, "requestStatus": request.get("status")},
        "message": "Offer accepted; bulk order created",
    }


# ================== ORDERS ==================

@router.get("/orders")
async def list_bulk_orders(current_user: dict = Depends(get_current_user)):
    """List bulk orders for the current buyer or farmer."""
    role = current_user.get("role")
    if role in ("customer", "business"):
        match = {"buyerUserId": ObjectId(current_user["_id"]), "deletedAt": None}
    elif role == "farmer":
        match = {"farmerId": ObjectId(current_user["_id"]), "deletedAt": None}
    elif role in ("admin", "super_admin"):
        match = {"deletedAt": None}
    else:
        raise HTTPException(status_code=403, detail="Only buyers and farmers can view bulk orders")

    orders = await order_repo.find_many(match, sort=[("createdAt", -1)], limit=200)
    results = [await _stringify_order(o) for o in orders]
    return {"success": True, "data": {"orders": results, "count": len(results)}}


@router.put("/orders/{order_id}/status")
async def update_order_status(
    order_id: str,
    data: BulkOrderStatusUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Advance a bulk order status. Farmers move it along the delivery pipeline; buyers can cancel while confirmed."""
    order = await order_repo.find_one({"_id": ObjectId(order_id), "deletedAt": None})
    if not order:
        raise HTTPException(status_code=404, detail="Bulk order not found")

    role = current_user.get("role")
    is_farmer = role == "farmer" and str(order.get("farmerId")) == str(current_user["_id"])
    is_buyer = role in ("customer", "business") and str(order.get("buyerUserId")) == str(current_user["_id"])
    is_admin = role in ("admin", "super_admin")
    if not (is_farmer or is_buyer or is_admin):
        raise HTTPException(status_code=403, detail="Not allowed to update this order")

    new_status = data.status
    current_status = order.get("status", ORDER_CONFIRMED)

    if new_status == ORDER_CANCELLED and current_status == ORDER_CONFIRMED and (is_buyer or is_admin):
        pass
    elif new_status == ORDER_DELIVERED and (is_farmer or is_admin):
        if new_status not in VALID_ORDER_FLOW:
            raise HTTPException(status_code=400, detail="Invalid status")
    elif is_farmer or is_admin:
        if new_status not in VALID_ORDER_FLOW:
            raise HTTPException(status_code=400, detail="Invalid status")
        try:
            current_idx = VALID_ORDER_FLOW.index(current_status)
            new_idx = VALID_ORDER_FLOW.index(new_status)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid status")
        if new_idx <= current_idx:
            raise HTTPException(status_code=400, detail="Cannot move the order backwards")
    else:
        raise HTTPException(status_code=403, detail="Not allowed to make this status change")

    history = list(order.get("statusHistory") or [])
    history.append({"status": new_status, "at": datetime.utcnow()})
    await order_repo.update({"_id": order["_id"]}, {"status": new_status, "statusHistory": history})
    order["status"] = new_status
    order["statusHistory"] = history

    return {
        "success": True,
        "data": await _stringify_order(order),
        "message": f"Bulk order status updated to {new_status}",
    }


# ================== EVENT SMART SOURCING ==================

event_fulfillment_repo = BaseRepository("event_fulfillments")


class EventSourceConfirm(BaseModel):
    allocations: List[dict] = Field(..., min_length=1)


class EventFulfillmentStatusUpdate(BaseModel):
    status: str


def _event_deadline(request: dict) -> Optional[datetime]:
    raw = request.get("requestedDeliveryDate") or request.get("eventDate")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def _event_location(request: dict):
    return ((request.get("deliveryAddress") or {}).get("location"))


def _distance_for_farmer(request: dict, farmer: dict) -> float:
    dest = _event_location(request)
    origin = (farmer or {}).get("farmLocation") or (farmer or {}).get("location")
    try:
        dc = (dest or {}).get("coordinates")
        oc = (origin or {}).get("coordinates")
        if dc and oc and len(dc) >= 2 and len(oc) >= 2:
            return round(BulkOrderService.haversine_km(dc[1], dc[0], oc[1], oc[0]), 1)
    except Exception:
        pass
    return 999.0


async def _event_candidates(request: dict) -> dict:
    """Build a product-by-product nearby sourcing plan from live farmer inventory."""
    farmers = await farmer_repository.find_many({"deletedAt": None}, limit=1000)
    deadline = _event_deadline(request)
    hours_left = None
    if deadline:
        hours_left = round((deadline - datetime.utcnow()).total_seconds() / 3600, 1)
    urgent = hours_left is not None and hours_left <= 24

    plan = []
    missing = []

    for requested in request.get("items", []):
        required = float(requested.get("quantityKg") or 0)
        name = BulkOrderService._normalize(requested.get("name"))
        candidates = []

        for farmer in farmers:
            farmer_id = farmer.get("userId")
            if not farmer_id:
                continue
            products = await product_repository.get_by_farmer(str(farmer_id), limit=500)
            for product in products:
                product_name = BulkOrderService._normalize(product.get("name"))
                if product_name != name and name not in product_name and product_name not in name:
                    continue
                try:
                    available = float(await InventoryService.get_available_stock(str(product["_id"])))
                except Exception:
                    available = 0.0
                if available <= 0:
                    continue

                distance = _distance_for_farmer(request, farmer)
                coverage = min(available, required) / required * 100 if required else 0
                rating = float(farmer.get("rating") or 0)
                distance_score = max(0.0, 100.0 - min(distance, 100.0))
                if urgent:
                    score = distance_score * 0.55 + min(coverage, 100.0) * 0.30 + (rating / 5.0) * 100 * 0.15
                else:
                    score = distance_score * 0.35 + min(coverage, 100.0) * 0.35 + (rating / 5.0) * 100 * 0.20 + (100.0 if available >= required else 50.0) * 0.10

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
        remaining = required
        selected = []
        for candidate in candidates:
            if remaining <= 0:
                break
            qty = min(remaining, candidate["availableKg"])
            if qty <= 0:
                continue
            selected.append({
                **candidate,
                "quantityKg": round(qty, 2),
            })
            remaining -= qty

        plan.append({
            "productName": requested.get("name"),
            "requiredKg": required,
            "selectedKg": round(required - remaining, 2),
            "shortageKg": round(max(0.0, remaining), 2),
            "allocations": selected,
            "candidates": candidates[:10],
        })
        if remaining > 0:
            missing.append({
                "productName": requested.get("name"),
                "requiredKg": required,
                "availableKg": round(required - remaining, 2),
                "shortageKg": round(remaining, 2),
            })

    return {
        "urgent": urgent,
        "hoursUntilDelivery": hours_left,
        "searchStrategy": "nearby_first" if urgent else "balanced",
        "plan": plan,
        "missing": missing,
        "canFulfill": len(missing) == 0,
    }


@router.post("/requests/{request_id}/smart-source")
async def smart_source_event(
    request_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Find nearby live inventory and split an event requirement across farmers."""
    request = await request_repo.find_one({"_id": ObjectId(request_id), "deletedAt": None})
    if not request:
        raise HTTPException(status_code=404, detail="Event request not found")
    if str(request.get("buyerUserId")) != str(current_user["_id"]):
        raise HTTPException(status_code=403, detail="Not your event request")
    if request.get("requestType") != "bulk_event":
        raise HTTPException(status_code=400, detail="Smart event sourcing is only for event requests")

    # City/address-only event requests are geocoded once so nearby sourcing still
    # works when the customer did not provide GPS coordinates.
    destination = _event_location(request)
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
            if destination:
                await request_repo.update({"_id": request["_id"]}, {
                    "deliveryAddress": {**addr, "location": destination},
                    "updatedAt": datetime.utcnow(),
                })
                request["deliveryAddress"] = {**addr, "location": destination}
        except Exception:
            pass

    sourcing = await _event_candidates(request)
    await request_repo.update({
        "_id": request["_id"]
    }, {
        "eventFulfillmentMode": "urgent_nearby" if sourcing["urgent"] else "planned",
        "eventSourcingPlan": sourcing,
        "eventSourcingStatus": "plan_ready",
        "eventSourcingUpdatedAt": datetime.utcnow(),
    })
    return {"success": True, "data": sourcing}


@router.post("/requests/{request_id}/confirm-source")
async def confirm_event_source(
    request_id: str,
    data: EventSourceConfirm,
    current_user: dict = Depends(get_current_user),
):
    """Atomically reserve selected live stock and create one fulfillment per farmer allocation."""
    request = await request_repo.find_one({"_id": ObjectId(request_id), "deletedAt": None})
    if not request:
        raise HTTPException(status_code=404, detail="Event request not found")
    if str(request.get("buyerUserId")) != str(current_user["_id"]):
        raise HTTPException(status_code=403, detail="Not your event request")
    if request.get("eventSourcingStatus") in ("confirmed", "cancelled"):
        raise HTTPException(status_code=400, detail="Event sourcing is already finalized")

    sourcing = request.get("eventSourcingPlan") or {}
    if not sourcing:
        raise HTTPException(status_code=400, detail="Run smart sourcing before confirming")

    plan_lookup = {}
    for row in sourcing.get("plan", []):
        for a in row.get("allocations", []):
            plan_lookup[(str(row["productName"]).strip().lower(), str(a["farmerId"]), str(a["productId"]))] = a

    normalized = []
    for raw in data.allocations:
        key = (
            str(raw.get("productName") or "").strip().lower(),
            str(raw.get("farmerId") or ""),
            str(raw.get("productId") or ""),
        )
        allowed = plan_lookup.get(key)
        qty = float(raw.get("quantityKg") or 0)
        if not allowed or qty <= 0 or qty > float(allowed.get("quantityKg") or 0) + 1e-6:
            raise HTTPException(status_code=400, detail=f"Invalid allocation for {key[0] or 'product'}")
        normalized.append({
            "productName": raw.get("productName"),
            "productId": str(raw.get("productId")),
            "farmerId": str(raw.get("farmerId")),
            "quantityKg": qty,
            "farmName": allowed.get("farmName"),
            "distanceKm": allowed.get("distanceKm"),
        })

    selected_by_key = {}
    for a in normalized:
        key = (a["productName"].strip().lower(), a["farmerId"], a["productId"])
        selected_by_key[key] = selected_by_key.get(key, 0) + a["quantityKg"]
    for key, qty in selected_by_key.items():
        allowed = plan_lookup[key]
        if qty > float(allowed.get("quantityKg") or 0) + 1e-6:
            raise HTTPException(status_code=400, detail=f"Allocation exceeds the smart-sourcing plan for {key[0]}")

    required = {
        str(i.get("name")).strip().lower(): float(i.get("quantityKg") or 0)
        for i in request.get("items", [])
    }
    covered = {}
    for a in normalized:
        covered[a["productName"].strip().lower()] = covered.get(a["productName"].strip().lower(), 0) + a["quantityKg"]
    shortages = [
        {"productName": name, "requiredKg": qty, "selectedKg": round(covered.get(name, 0), 2), "shortageKg": round(max(0, qty - covered.get(name, 0)), 2)}
        for name, qty in required.items()
        if covered.get(name, 0) + 1e-6 < qty
    ]
    if shortages:
        raise HTTPException(status_code=400, detail={"message": "Every event requirement must be fully sourced", "shortages": shortages})

    created = []
    reserved = []
    try:
        for a in normalized:
            ok = await __import__("app.repositories.inventory_repository", fromlist=["inventory_repository"]).inventory_repository.atomic_reserve(
                a["productId"], a["quantityKg"]
            )
            if not ok:
                raise HTTPException(status_code=409, detail=f"Stock changed for {a['productName']} at {a['farmName']}; run sourcing again")
            reserved.append(a)

            fulfillment = {
                "requestId": request["_id"],
                "requestNumber": request.get("requestNumber"),
                "buyerUserId": request.get("buyerUserId"),
                "farmerId": ObjectId(a["farmerId"]),
                "productId": ObjectId(a["productId"]),
                "productName": a["productName"],
                "requiredQuantityKg": next((x["quantityKg"] for x in request.get("items", []) if str(x.get("name")).strip().lower() == a["productName"].strip().lower()), a["quantityKg"]),
                "allocatedQuantityKg": a["quantityKg"],
                "status": "pending_farmer_confirmation",
                "packingStatus": "not_started",
                "collectionStatus": "pending",
                "deliveryStatus": "pending_consolidation",
                "distanceKm": a.get("distanceKm"),
                "farmName": a.get("farmName"),
            }
            fid = await event_fulfillment_repo.create(fulfillment)
            if not fid:
                raise RuntimeError("Failed to create event fulfillment")
            fulfillment["_id"] = ObjectId(fid)
            created.append(fulfillment)

        await request_repo.update({"_id": request["_id"]}, {
            "status": REQUEST_AWARDED,
            "eventSourcingStatus": "confirmed",
            "eventFulfillmentMode": "urgent_nearby" if sourcing.get("urgent") else "planned",
            "eventDeliveryStatus": "awaiting_farmer_confirmation",
            "eventConsolidationStatus": "pending_collection",
            "eventFulfillmentIds": [x["_id"] for x in created],
            "updatedAt": datetime.utcnow(),
        })
    except HTTPException:
        from app.repositories.inventory_repository import inventory_repository
        for a in reserved:
            await inventory_repository.atomic_release(a["productId"], a["quantityKg"])
        raise
    except Exception as exc:
        from app.repositories.inventory_repository import inventory_repository
        for a in reserved:
            await inventory_repository.atomic_release(a["productId"], a["quantityKg"])
        raise HTTPException(status_code=500, detail=f"Failed to confirm event sourcing: {exc}")

    for a in created:
        await NotificationService.create_in_app_notification(
            str(a["farmerId"]),
            NotificationType.ORDER,
            "New event fulfillment request 🎉",
            f"{a['productName']} {a['allocatedQuantityKg']} kg for {request.get('purpose') or 'event'} • {request.get('requestNumber')}.",
            {"requestId": request_id, "type": "event_fulfillment"},
            NotificationPriority.HIGH,
        )

    return {"success": True, "data": {"requestId": request_id, "fulfillments": [await _stringify_event_fulfillment(x) for x in created]}, "message": "Event sourcing confirmed and stock reserved"}


async def _create_event_delivery_job(request: dict, fulfillments: list) -> Optional[str]:
    """Create one final consolidated delivery job after every farmer is collected."""
    if not fulfillments:
        return None
    destination = ((request.get("deliveryAddress") or {}).get("location") or {})
    destination_coords = destination.get("coordinates") or []
    if len(destination_coords) < 2:
        return None
    hubs = await MongoDB.get_collection("fulfillment_hubs").find({"deletedAt": None, "isActive": True, "approvalStatus": {"$in": ["approved", "active"]}}).to_list(length=200)
    if not hubs:
        return None
    def hub_distance(hub: dict) -> float:
        coords = (hub.get("location") or {}).get("coordinates") or []
        if len(coords) < 2: return 1e9
        try: return BulkOrderService.haversine_km(float(destination_coords[1]), float(destination_coords[0]), float(coords[1]), float(coords[0]))
        except Exception: return 1e9
    hubs.sort(key=hub_distance)
    hub = hubs[0]
    hub_coords = (hub.get("location") or {}).get("coordinates") or []
    if len(hub_coords) < 2: return None
    total_weight = round(sum(float(f.get("allocatedQuantityKg") or 0) for f in fulfillments), 2)
    delivery_repo = BaseRepository("delivery_jobs")
    existing = await delivery_repo.find_one({"eventRequestId": request["_id"], "jobType": "event_consolidated_delivery", "deletedAt": None})
    if existing: return str(existing["_id"])
    pickup_lat, pickup_lng = float(hub_coords[1]), float(hub_coords[0])
    delivery_lat, delivery_lng = float(destination_coords[1]), float(destination_coords[0])
    distance = round(BulkOrderService.haversine_km(pickup_lat, pickup_lng, delivery_lat, delivery_lng), 2)
    partners = await eligible_partners_for_job(pickup_lat, pickup_lng, total_weight, job_type="customer_delivery")
    now = datetime.utcnow()
    job = {
        "jobType": "event_consolidated_delivery", "eventRequestId": request["_id"],
        "requestNumber": request.get("requestNumber"), "orderId": request["_id"],
        "orderNumber": request.get("requestNumber") or "EVENT", "status": "open",
        "openedAt": now, "expiresAt": now + timedelta(minutes=JOB_DEFAULT_EXPIRY_MINUTES),
        "acceptedBy": None, "acceptedAt": None,
        "eligiblePartnerIds": [str(p.get("id")) for p in partners if p.get("id")],
        "pickupLocation": {"type": "Point", "coordinates": [pickup_lng, pickup_lat]},
        "pickupName": hub.get("name") or "Event Consolidation Hub", "pickupAddress": hub.get("address") or "",
        "deliveryLocation": {"type": "Point", "coordinates": [delivery_lng, delivery_lat]},
        "deliveryArea": (request.get("deliveryAddress") or {}).get("area") or request.get("deliveryCity") or "",
        "deliveryCity": (request.get("deliveryAddress") or {}).get("city") or request.get("deliveryCity") or "",
        "deliveryAddress": (request.get("deliveryAddress") or {}).get("addressLine1") or (request.get("deliveryAddress") or {}).get("address") or "",
        "customerName": request.get("buyerName") or "Customer", "customerPhone": request.get("buyerPhone") or "",
        "distanceKm": distance, "weightKg": total_weight, "itemCount": len(fulfillments),
        "eventDelivery": True, "eventFulfillmentIds": [f["_id"] for f in fulfillments],
        "deliveryDay": request.get("requestedDeliveryDate"), "timeSlot": request.get("requestedDeliveryTime") or "Event delivery",
        "priority": 3 if str(request.get("eventFulfillmentMode") or "").startswith("urgent") else 2,
        "priorityLabel": "Urgent" if str(request.get("eventFulfillmentMode") or "").startswith("urgent") else "High",
        "orderStatus": "ready_for_delivery", "createdAt": now, "updatedAt": now, "deletedAt": None,
    }
    job_id = await delivery_job_repository.create_job(job)
    if not job_id: return None
    await request_repo.update({"_id": request["_id"]}, {"eventDeliveryJobId": ObjectId(job_id), "eventDeliveryStatus": "delivery_partner_assignment", "eventConsolidationStatus": "consolidated", "consolidationHubId": hub["_id"], "consolidationHubName": hub.get("name"), "updatedAt": datetime.utcnow()})
    for partner in partners:
        try:
            message = str(request.get("requestNumber") or "Event order") + " is consolidated and ready for delivery."
            await NotificationService.create_in_app_notification(str(partner.get("userId") or partner.get("id")), NotificationType.ORDER, "New event delivery job", message, {"requestId": str(request["_id"]), "deliveryJobId": str(job_id), "type": "event_delivery_job"}, NotificationPriority.HIGH)
        except Exception:
            continue
    return str(job_id)

async def _stringify_event_fulfillment(f: dict) -> dict:
    f["id"] = str(f["_id"])
    f["requestId"] = str(f.get("requestId"))
    f["farmerId"] = str(f.get("farmerId"))
    f["productId"] = str(f.get("productId"))
    return f


@router.get("/event-orders/fulfillments")
async def list_event_fulfillments(
    request_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    role = current_user.get("role")
    match = {"deletedAt": None}
    if request_id:
        match["requestId"] = ObjectId(request_id)
    if role == "farmer":
        match["farmerId"] = ObjectId(current_user["_id"])
    elif role in ("customer", "business"):
        match["buyerUserId"] = ObjectId(current_user["_id"])
    elif role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Not allowed")

    rows = await event_fulfillment_repo.find_many(match, sort=[("createdAt", -1)], limit=500)
    return {"success": True, "data": {"fulfillments": [await _stringify_event_fulfillment(x) for x in rows]}}


@router.put("/event-orders/fulfillments/{fulfillment_id}/status")
async def update_event_fulfillment_status(
    fulfillment_id: str,
    data: EventFulfillmentStatusUpdate,
    current_user: dict = Depends(get_current_user),
):
    fulfillment = await event_fulfillment_repo.find_one({"_id": ObjectId(fulfillment_id), "deletedAt": None})
    if not fulfillment:
        raise HTTPException(status_code=404, detail="Event fulfillment not found")

    role = current_user.get("role")
    farmer_ok = role == "farmer" and str(fulfillment.get("farmerId")) == str(current_user["_id"])
    admin_ok = role in ("admin", "super_admin")
    if not (farmer_ok or admin_ok):
        raise HTTPException(status_code=403, detail="Only the assigned farmer can update this fulfillment")

    allowed = [
        "pending_farmer_confirmation",
        "accepted",
        "packing",
        "packed",
        "ready_for_collection",
        "collected",
        "cancelled",
    ]
    new_status = data.status
    current = fulfillment.get("status") or allowed[0]
    if new_status not in allowed:
        raise HTTPException(status_code=400, detail="Invalid event fulfillment status")

    if new_status == "cancelled":
        if current not in ("pending_farmer_confirmation", "accepted"):
            raise HTTPException(status_code=400, detail="Event fulfillment can only be declined before packing starts")
        from app.repositories.inventory_repository import inventory_repository
        released = await inventory_repository.atomic_release(str(fulfillment["productId"]), float(fulfillment["allocatedQuantityKg"]))
        if not released:
            raise HTTPException(status_code=409, detail="Reserved stock could not be released safely")
    elif new_status != "pending_farmer_confirmation":
        try:
            if allowed.index(new_status) <= allowed.index(current):
                raise HTTPException(status_code=400, detail="Fulfillment cannot move backwards")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid fulfillment state")

    await event_fulfillment_repo.update({"_id": fulfillment["_id"]}, {
        "status": new_status,
        "updatedAt": datetime.utcnow(),
        "packingStatus": "started" if new_status in ("packing", "packed", "ready_for_collection", "collected") else fulfillment.get("packingStatus", "not_started"),
        "collectionStatus": "ready" if new_status == "ready_for_collection" else ("collected" if new_status == "collected" else fulfillment.get("collectionStatus", "pending")),
    })

    siblings = await event_fulfillment_repo.find_many({"requestId": fulfillment["requestId"], "deletedAt": None}, limit=500)
    statuses = [s.get("status") for s in siblings]
    if new_status == "cancelled":
        await request_repo.update({"_id": fulfillment["requestId"]}, {
            "eventSourcingStatus": "replacement_required",
            "eventDeliveryStatus": "replacement_required",
            "updatedAt": datetime.utcnow(),
        })
    elif statuses and all(s == "collected" for s in statuses):
        request_for_job = await request_repo.find_one({"_id": fulfillment["requestId"], "deletedAt": None})
        job_id = await _create_event_delivery_job(request_for_job, siblings)
        if job_id:
            await request_repo.update({"_id": fulfillment["requestId"]}, {
                "eventDeliveryStatus": "delivery_partner_assignment",
                "eventConsolidationStatus": "consolidated",
                "eventDeliveryJobId": ObjectId(job_id),
                "updatedAt": datetime.utcnow(),
            })
        else:
            await request_repo.update({"_id": fulfillment["requestId"]}, {
                "eventDeliveryStatus": "ready_for_event_delivery",
                "eventConsolidationStatus": "consolidation_ready",
                "updatedAt": datetime.utcnow(),
            })
    elif any(s == "ready_for_collection" for s in statuses):
        await request_repo.update({"_id": fulfillment["requestId"]}, {
            "eventDeliveryStatus": "collection_in_progress",
        })

    updated = await event_fulfillment_repo.find_one({"_id": fulfillment["_id"]})
    return {"success": True, "data": await _stringify_event_fulfillment(updated), "message": f"Event fulfillment updated to {new_status}"}


@router.get("/event-orders/{request_id}/summary")
async def event_order_summary(
    request_id: str,
    current_user: dict = Depends(get_current_user),
):
    request = await request_repo.find_one({"_id": ObjectId(request_id), "deletedAt": None})
    if not request:
        raise HTTPException(status_code=404, detail="Event order not found")
    if str(request.get("buyerUserId")) != str(current_user["_id"]) and current_user.get("role") not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Not allowed")

    rows = await event_fulfillment_repo.find_many({"requestId": request["_id"], "deletedAt": None}, limit=500)
    required_by_product = {
        str(item.get("name")): float(item.get("quantityKg") or 0)
        for item in request.get("items", [])
    }
    grouped = {}
    for row in rows:
        key = str(row.get("productName"))
        grouped.setdefault(key, {"requiredKg": required_by_product.get(key, 0), "allocatedKg": 0, "status": []})
        grouped[key]["allocatedKg"] += float(row.get("allocatedQuantityKg") or 0)
        grouped[key]["status"].append(row.get("status"))
    request = _stringify_request(request)
    request["fulfillmentSummary"] = grouped
    request["fulfillmentCount"] = len(rows)
    request["eventDeliveryStatus"] = request.get("eventDeliveryStatus", "not_started")
    request["eventSourcingStatus"] = request.get("eventSourcingStatus", "not_started")
    return {"success": True, "data": request}


@router.get("/event-orders/{request_id}/tracking")
async def bulk_order_tracking(
    request_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Unified customer tracking for event and one-time weekly bulk purchases."""
    try:
        oid = ObjectId(request_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid bulk request id")

    request = await request_repo.find_one({"_id": oid, "deletedAt": None})
    if not request:
        raise HTTPException(status_code=404, detail="Bulk order not found")
    role = current_user.get("role")
    if str(request.get("buyerUserId")) != str(current_user["_id"]) and role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Not allowed")

    fulfillments = await event_fulfillment_repo.find_many(
        {"requestId": oid, "deletedAt": None},
        sort=[("createdAt", 1)],
        limit=500,
    )

    # Legacy/generic bulk orders are also linked to the same request. They are
    # included so the tracker works for older quote -> order records as well.
    bulk_orders = await order_repo.find_many(
        {"requestId": oid, "deletedAt": None},
        sort=[("createdAt", 1)],
        limit=500,
    )
    order_ids = [o.get("_id") for o in bulk_orders if o.get("_id")]

    delivery_repo = BaseRepository("delivery_jobs")
    delivery_jobs = await delivery_repo.find_many(
        {"$or": [{"orderId": {"$in": order_ids}} if order_ids else {"orderId": {"$exists": False}}, {"eventRequestId": oid}], "deletedAt": None},
        sort=[("createdAt", -1)],
        limit=200,
    )

    fulfillment_statuses = [str(f.get("status") or "") for f in fulfillments]
    job_statuses = [str(j.get("status") or "") for j in delivery_jobs]
    order_statuses = [str(o.get("status") or "") for o in bulk_orders]
    sourcing_status = str(request.get("eventSourcingStatus") or "")
    delivery_status = str(request.get("eventDeliveryStatus") or "")
    consolidation_status = str(request.get("eventConsolidationStatus") or "")

    if request.get("status") == REQUEST_CANCELLED or "cancelled" in fulfillment_statuses:
        current_stage = "cancelled"
    elif any(s in ("delivered", "completed") for s in job_statuses + order_statuses):
        current_stage = "delivered"
    elif any(s in ("in_transit", "out_for_delivery", "picked_up") for s in job_statuses) or "out_for_delivery" in order_statuses:
        current_stage = "out_for_delivery"
    elif any(s in ("accepted", "confirmed") for s in job_statuses) or delivery_status == "delivery_partner_assignment":
        current_stage = "delivery_partner"
    elif any(s in ("dispatched", "ready_for_delivery") for s in job_statuses) or delivery_status == "ready_for_event_delivery":
        current_stage = "ready_for_delivery"
    elif consolidation_status in ("consolidated", "consolidation_ready") or (fulfillment_statuses and all(s == "collected" for s in fulfillment_statuses)):
        current_stage = "consolidation"
    elif any(s == "ready_for_collection" for s in fulfillment_statuses) or delivery_status == "collection_in_progress":
        current_stage = "collection"
    elif any(s in ("packing", "packed") for s in fulfillment_statuses):
        current_stage = "packing"
    elif any(s == "accepted" for s in fulfillment_statuses) or delivery_status == "awaiting_farmer_confirmation":
        current_stage = "farmer_confirmation"
    elif sourcing_status == "confirmed":
        current_stage = "stock_reserved"
    elif sourcing_status in ("rfq_open", "plan_ready"):
        current_stage = "sourcing"
    else:
        current_stage = "order_created"

    def serialize_job(job):
        def convert(value):
            if isinstance(value, ObjectId):
                return str(value)
            if isinstance(value, dict):
                return {k: convert(v) for k, v in value.items()}
            if isinstance(value, list):
                return [convert(v) for v in value]
            return value
        result = convert(dict(job))
        result["id"] = str(result.pop("_id", ""))
        return result

    return {
        "success": True,
        "data": {
            "request": _stringify_request(dict(request)),
            "purchaseMode": request.get("purchaseMode") or "event",
            "fulfillments": [await _stringify_event_fulfillment(dict(f)) for f in fulfillments],
            "orders": [await _stringify_order(dict(o)) for o in bulk_orders],
            "deliveryJobs": [serialize_job(j) for j in delivery_jobs],
            "currentStage": current_stage,
            "isActive": current_stage not in ("delivered", "cancelled"),
        },
    }

# ================== AI RECOMMENDATION ==================

@router.post("/requests/{request_id}/ai-recommend")
async def ai_recommend(
    request_id: str,
    current_user: dict = Depends(get_current_user),
):
    """AI-assisted offer recommendation for the buyer (deterministic scoring)."""
    request = await request_repo.find_one({"_id": ObjectId(request_id), "deletedAt": None})
    if not request:
        raise HTTPException(status_code=404, detail="Request not found")
    if str(request.get("buyerUserId")) != str(current_user["_id"]) and current_user.get("role") not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Not allowed")

    offers = await offer_repo.find_many({"requestId": ObjectId(request_id), "deletedAt": None})
    enriched = [await _stringify_offer(o) for o in offers]
    request = _stringify_request(request)
    return {"success": True, "data": await BulkOrderService.recommend(request, enriched)}