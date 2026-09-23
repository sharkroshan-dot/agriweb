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
from app.repositories.base_repository import BaseRepository
from app.repositories.farmer_repository import farmer_repository
from app.repositories.address_repository import address_repository
from app.services.notification_service import NotificationService
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