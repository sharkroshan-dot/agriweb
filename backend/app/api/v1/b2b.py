"""B2B marketplace - verified business buyers procure bulk produce from farmers.

The B2B flow is different from the customer marketplace:
    business needs produce -> publishes an RFQ -> farmers submit quotes ->
    business compares (with AI ranking) -> selects one or more farmers
    (split procurement) -> B2B order -> farmer prepares/dispatches ->
    business receives -> payment/settlement -> invoice + two-way rating.

Collections:
  - business_profiles:   buyer business profile
  - b2b_rfqs:            request for quote from a business buyer
  - b2b_offers:          farmer quote against an RFQ
  - b2b_orders:          accepted quote -> fulfillment order (one per farmer)
  - b2b_ratings:         two-way ratings after delivery
"""
import random
import re
from datetime import datetime, timezone, timedelta
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from bson import ObjectId
import logging

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.api.v1.auth import get_current_user
from app.repositories.base_repository import BaseRepository
from app.repositories.user_repository import user_repository
from app.repositories.farmer_repository import farmer_repository
from app.repositories.product_repository import product_repository
from app.services.inventory_service import InventoryService
from app.services.notification_service import NotificationService
from app.schemas.notification import NotificationType, NotificationPriority
from app.services.bulk_order_service import haversine_km, _coords, _farmer_location

logger = logging.getLogger(__name__)
router = APIRouter()

profile_repo = BaseRepository("business_profiles")
rfq_repo = BaseRepository("b2b_rfqs")
offer_repo = BaseRepository("b2b_offers")
order_repo = BaseRepository("b2b_orders")
rating_repo = BaseRepository("b2b_ratings")
farmer_profile_repo = BaseRepository("farmer_profiles")

RFQ_OPEN = "open"
RFQ_AWARDED = "awarded"
RFQ_CLOSED = "closed"
RFQ_CANCELLED = "cancelled"
OFFER_PENDING = "pending"
OFFER_ACCEPTED = "accepted"
OFFER_DECLINED = "declined"

ORDER_CONFIRMED = "confirmed"
ORDER_PREPARING = "preparing"
ORDER_QUALITY_CHECK = "quality_check"
ORDER_DISPATCHED = "dispatched"
ORDER_IN_TRANSIT = "in_transit"
ORDER_DELIVERED = "delivered"
ORDER_COMPLETED = "completed"
ORDER_CANCELLED = "cancelled"
ORDER_FLOW = [
    ORDER_CONFIRMED,
    ORDER_PREPARING,
    ORDER_QUALITY_CHECK,
    ORDER_DISPATCHED,
    ORDER_IN_TRANSIT,
    ORDER_DELIVERED,
    ORDER_COMPLETED,
]
ACTIVE_ORDER_STATUSES = [ORDER_CONFIRMED, ORDER_PREPARING, ORDER_QUALITY_CHECK, ORDER_DISPATCHED, ORDER_IN_TRANSIT]

PAYMENT_PENDING = "pending"
PAYMENT_PAID = "paid"
PAYMENT_ADVANCE = "advance"
DELIVERY_METHODS = ["farmer_delivery", "delivery_partner", "dedicated_transport", "buyer_pickup"]
VISIBILITY = ["nearby", "district", "state", "national"]
QUALITY_GRADES = ["Grade A", "Grade B", "Grade C", "Premium", "Organic", "Standard"]


async def _next_number(prefix: str, repo: BaseRepository) -> str:
    count = await repo.count({"deletedAt": None})
    return f"{prefix}-{count + 1 + random.randint(0, 9):05d}"


def _naive_utc(value: Any) -> Optional[datetime]:
    """Return a naive UTC datetime (as stored/compared everywhere in this module)."""
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _closing_in(deadline: Any) -> Optional[str]:
    deadline = _naive_utc(deadline)
    if not deadline:
        return None
    delta = deadline - datetime.utcnow()
    if delta.total_seconds() <= 0:
        return "Closed"
    hours = int(delta.total_seconds() // 3600)
    minutes = int((delta.total_seconds() % 3600) // 60)
    return f"{hours:02d}h {minutes:02d}m"


async def _maybe_close_rfq(rfq: Dict[str, Any]) -> None:
    """Auto-close RFQs whose deadline has passed."""
    if rfq.get("status") != RFQ_OPEN:
        return
    deadline = _naive_utc(rfq.get("deadline"))
    if deadline and deadline < datetime.utcnow():
        await rfq_repo.update({"_id": rfq["_id"]}, {
            "status": RFQ_CLOSED,
            "closedAt": datetime.utcnow(),
            "updatedAt": datetime.utcnow(),
        })
        rfq["status"] = RFQ_CLOSED


def _rfq_quantity(rfq: Dict[str, Any]) -> float:
    qty = rfq.get("quantityKg") if not rfq.get("recurring") else None
    if qty is None:
        qty = rfq.get("quantityPerWeekKg") or 0
    return float(qty)


def _distance_km(farmer: Optional[Dict[str, Any]], rfq: Dict[str, Any]) -> Optional[float]:
    f_loc = _farmer_location(farmer or {})
    r_loc = _coords(rfq.get("deliveryLocation"))
    if f_loc and r_loc:
        return round(haversine_km(r_loc[1], r_loc[0], f_loc[1], f_loc[0]), 1)
    return None


def _visibility_match(rfq: Dict[str, Any], farmer: Dict[str, Any], distance_km: Optional[float]) -> bool:
    """Whether an open RFQ should be shown to a farmer.

    Permissive filter: an RFQ is hidden only when there is positive evidence
    the farmer is outside its visibility scope. When the farmer's location
    data (text or coordinates) is incomplete, we can't prove a mismatch, so
    the RFQ stays visible.
    """
    vis = (rfq.get("visibility") or "state")
    if vis == "national":
        return True
    f_city = (farmer.get("city") or "").strip().lower()
    r_city = (rfq.get("deliveryCity") or "").strip().lower()
    f_state = (farmer.get("state") or "").strip().lower()
    f_district = (farmer.get("district") or "").strip().lower()
    r_state = (rfq.get("deliveryState") or "").strip().lower()
    r_district = (rfq.get("deliveryDistrict") or "").strip().lower()
    same_city = bool(f_city and r_city and (f_city == r_city or f_city in r_city or r_city in f_city))
    if vis == "nearby":
        if distance_km is not None:
            return distance_km <= 50 or same_city
        if same_city:
            return True
        return not (f_city and r_city and f_city != r_city and r_city not in f_city and f_city not in r_city)
    if vis == "district":
        if f_district and r_district and (f_district == r_district or f_district in r_district or r_district in f_district):
            return True
        if same_city:
            return True
        if distance_km is not None and distance_km <= 50:
            return True
        return not bool(f_district and r_district and f_district != r_district)
    if f_state and r_state and (f_state == r_state or f_state in r_state or r_state in f_state):
        return True
    if same_city:
        return True
    return not bool(f_state and r_state and f_state != r_state)


async def _farmer_can_supply(farmer_user_id: str, product_name: str) -> Dict[str, Any]:
    """Best available stock a farmer holds for a product name (fuzzy match)."""
    name_key = (product_name or "").strip().lower()
    products = await product_repository.get_by_farmer(farmer_user_id, limit=500)
    best: Optional[Dict[str, Any]] = None
    for p in products:
        k = (p.get("name") or "").strip().lower()
        if k == name_key or (name_key and (name_key in k or k in name_key)):
            stock = await InventoryService.get_available_stock(str(p["_id"]))
            if best is None or stock > best["availableKg"]:
                best = {
                    "productId": str(p["_id"]),
                    "availableKg": stock,
                    "pricePerKg": float(p.get("bulkPrice") or p.get("price") or 0),
                }
    return {
        "canSupply": best is not None,
        "availableKg": best["availableKg"] if best else 0,
        "pricePerKg": best["pricePerKg"] if best else 0,
    }


async def _enrich_business_info(rfq: Dict[str, Any]) -> None:
    if not rfq.get("businessProfileId"):
        rfq["businessInfo"] = {}
        return
    profile = await profile_repo.find_one({"_id": rfq.get("businessProfileId")})
    rfq["businessInfo"] = {
        "businessName": (profile or {}).get("businessName"),
        "businessType": (profile or {}).get("businessType"),
        "city": (profile or {}).get("city"),
        "state": (profile or {}).get("state"),
        "isVerified": bool((profile or {}).get("isVerified")),
    }


async def _stringify_rfq(rfq: Dict[str, Any]) -> Dict[str, Any]:
    rfq["id"] = str(rfq["_id"])
    rfq["businessUserId"] = str(rfq.get("businessUserId"))
    if rfq.get("businessProfileId"):
        rfq["businessProfileId"] = str(rfq["businessProfileId"])
    await _enrich_business_info(rfq)
    rfq["offerCount"] = await offer_repo.count({
        "rfqId": rfq["_id"],
        "status": {"$ne": OFFER_DECLINED},
        "deletedAt": None,
    })
    rfq["remainingQuantityKg"] = round(max(0.0, _rfq_quantity(rfq) - float(rfq.get("acceptedQuantityKg") or 0)), 2)
    rfq["closingIn"] = _closing_in(rfq.get("deadline"))
    if rfq.get("rfqNumber") is None:
        rfq["rfqNumber"] = f"RFQ-{str(rfq['_id'])[-6:]}"
    return rfq


async def _build_order(rfq: Dict[str, Any], offer: Dict[str, Any], qty: float, accept: Optional["OfferAccept"]) -> Dict[str, Any]:
    delivery_charge = 0.0
    if accept and accept.deliveryCharge is not None:
        delivery_charge = float(accept.deliveryCharge)
    elif offer.get("deliveryCharge") is not None:
        delivery_charge = float(offer.get("deliveryCharge") or 0)
    total = round(float(qty) * float(offer.get("pricePerKg") or 0) + delivery_charge, 2)
    order = {
        "orderNumber": await _next_number("B2B", order_repo),
        "rfqId": rfq["_id"],
        "businessUserId": rfq.get("businessUserId"),
        "businessProfileId": rfq.get("businessProfileId"),
        "farmerId": offer.get("farmerId"),
        "offerId": offer["_id"],
        "productName": offer.get("productName"),
        "category": rfq.get("category"),
        "qualityGrade": rfq.get("qualityGrade"),
        "quantityKg": round(float(qty), 2),
        "pricePerKg": float(offer.get("pricePerKg") or 0),
        "deliveryCharge": round(delivery_charge, 2),
        "totalAmount": total,
        "recurring": bool(rfq.get("recurring")),
        "deliveryMethod": (accept.deliveryMethod if accept and accept.deliveryMethod else (offer.get("deliveryMethod") or DELIVERY_METHODS[0])),
        "requiredDate": rfq.get("requiredDate"),
        "deliveryTimeSlot": rfq.get("deliveryTimeSlot"),
        "deliveryCity": rfq.get("deliveryCity"),
        "deliveryState": rfq.get("deliveryState"),
        "deliveryAddress": rfq.get("deliveryAddress"),
        "expectedDeliveryDate": offer.get("expectedDeliveryDate"),
        "paymentMode": (accept.paymentMode if accept and accept.paymentMode else "cod"),
        "advanceAmount": float(accept.advanceAmount) if accept and accept.advanceAmount else 0.0,
        "paymentStatus": PAYMENT_PENDING,
        "status": ORDER_CONFIRMED,
        "qualityCheck": "pending",
        "notes": (accept.notes if accept else None) or offer.get("message"),
        "startedAt": datetime.utcnow(),
        "deliveredAt": None,
        "completedAt": None,
        "createdAt": datetime.utcnow(),
    }
    return order


# ================== BUSINESS PROFILE ==================

class BusinessProfileCreate(BaseModel):
    businessName: str
    businessType: str = Field(..., description="restaurant, hotel, canteen, supermarket, caterer, processor, wholesaler, cafe")
    gstin: Optional[str] = None
    contactPerson: Optional[str] = None
    phone: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    district: Optional[str] = None
    address: Optional[str] = None
    location: Optional[dict] = None


@router.post("/business/profile")
async def create_business_profile(
    data: BusinessProfileCreate,
    current_user: dict = Depends(get_current_user),
):
    """Create/update the caller's business buyer profile."""
    if current_user.get("role") != "business":
        raise HTTPException(status_code=403, detail="Only business accounts can create a business profile")

    existing = await profile_repo.find_one({"userId": ObjectId(current_user["_id"]), "deletedAt": None})
    payload = {
        "userId": ObjectId(current_user["_id"]),
        "businessName": data.businessName.strip(),
        "businessType": data.businessType,
        "gstin": data.gstin,
        "contactPerson": data.contactPerson,
        "phone": data.phone or current_user.get("phone"),
        "city": data.city,
        "state": data.state,
        "district": data.district,
        "address": data.address,
        "location": data.location,
        "isVerified": existing.get("isVerified", False) if existing else False,
        "updatedAt": datetime.utcnow(),
    }
    if existing:
        ok = await profile_repo.update({"_id": existing["_id"]}, payload)
        if not ok:
            raise HTTPException(status_code=400, detail="Failed to update profile")
        profile = await profile_repo.find_one({"_id": existing["_id"]})
    else:
        payload["createdAt"] = datetime.utcnow()
        profile_id = await profile_repo.create(payload)
        if not profile_id:
            raise HTTPException(status_code=400, detail="Failed to create profile")
        profile = await profile_repo.find_one({"_id": ObjectId(profile_id)})

    profile["id"] = str(profile["_id"])
    profile["userId"] = str(profile["userId"])
    return {"success": True, "data": profile}


@router.get("/business/profile")
async def get_business_profile(current_user: dict = Depends(get_current_user)):
    """Get the caller's business profile."""
    profile = await profile_repo.find_one({"userId": ObjectId(current_user["_id"]), "deletedAt": None})
    if not profile:
        raise HTTPException(status_code=404, detail="Business profile not found")
    profile["id"] = str(profile["_id"])
    profile["userId"] = str(profile["userId"])
    return {"success": True, "data": profile}


# ================== REQUESTS FOR QUOTE ==================

class RFQCreate(BaseModel):
    productName: str
    category: Optional[str] = None
    quantityPerWeekKg: Optional[float] = Field(None, gt=0)
    quantityKg: Optional[float] = Field(None, gt=0)
    qualityGrade: Optional[str] = None
    priceCeilingPerKg: Optional[float] = Field(None, gt=0)
    budgetMinPerKg: Optional[float] = Field(None, ge=0)
    budgetMaxPerKg: Optional[float] = Field(None, gt=0)
    requiredDate: Optional[str] = None
    deliveryTimeSlot: Optional[str] = None
    deliveryCity: Optional[str] = None
    deliveryState: Optional[str] = None
    deliveryDistrict: Optional[str] = None
    deliveryAddress: Optional[str] = None
    deliveryLocation: Optional[dict] = None
    deliveryDays: Optional[str] = None
    recurring: bool = True
    deadline: Optional[datetime] = None
    visibility: str = "state"
    notes: Optional[str] = None


@router.post("/rfqs")
async def create_rfq(
    data: RFQCreate,
    current_user: dict = Depends(get_current_user),
):
    """Publish a request for quote (Business buyer)."""
    if current_user.get("role") != "business":
        raise HTTPException(status_code=403, detail="Only business accounts can create RFQs")

    if data.recurring and not data.quantityPerWeekKg:
        raise HTTPException(status_code=400, detail="quantityPerWeekKg is required for recurring RFQs")
    if not data.recurring and not data.quantityKg:
        raise HTTPException(status_code=400, detail="quantityKg is required for one-off RFQs")
    if data.visibility not in VISIBILITY:
        raise HTTPException(status_code=400, detail="visibility must be nearby, district, state or national")

    deadline = data.deadline
    if deadline is not None:
        if deadline.tzinfo is not None:
            deadline = deadline.astimezone(timezone.utc).replace(tzinfo=None)
        if deadline < datetime.utcnow():
            raise HTTPException(status_code=400, detail="RFQ deadline must be in the future")

    profile = await profile_repo.find_one({"userId": ObjectId(current_user["_id"]), "deletedAt": None})
    rfq = {
        "rfqNumber": await _next_number("RFQ", rfq_repo),
        "businessUserId": ObjectId(current_user["_id"]),
        "businessProfileId": profile["_id"] if profile else None,
        "productName": data.productName.strip(),
        "category": data.category,
        "recurring": bool(data.recurring),
        "quantityPerWeekKg": data.quantityPerWeekKg if data.recurring else None,
        "quantityKg": data.quantityKg if not data.recurring else None,
        "qualityGrade": data.qualityGrade,
        "priceCeilingPerKg": data.priceCeilingPerKg,
        "budgetMinPerKg": data.budgetMinPerKg,
        "budgetMaxPerKg": data.budgetMaxPerKg,
        "requiredDate": data.requiredDate,
        "deliveryTimeSlot": data.deliveryTimeSlot,
        "deliveryCity": data.deliveryCity,
        "deliveryState": data.deliveryState,
        "deliveryDistrict": data.deliveryDistrict,
        "deliveryAddress": data.deliveryAddress,
        "deliveryLocation": data.deliveryLocation,
        "deliveryDays": data.deliveryDays,
        "deadline": deadline,
        "visibility": data.visibility,
        "notes": data.notes,
        "status": RFQ_OPEN,
        "acceptedQuantityKg": 0.0,
        "awardedOfferIds": [],
        "createdAt": datetime.utcnow(),
    }
    rfq_id = await rfq_repo.create(rfq)
    if not rfq_id:
        raise HTTPException(status_code=400, detail="Failed to create RFQ")
    rfq["_id"] = ObjectId(rfq_id)
    rfq["id"] = str(rfq_id)

    farmer_docs = await farmer_profile_repo.find_many({"deletedAt": None}, limit=20)
    for fdoc in farmer_docs:
        try:
            await NotificationService.create_in_app_notification(
                str(fdoc.get("userId")),
                NotificationType.PROMOTION,
                "New B2B opportunity 💼",
                f"{rfq.get('productName')} {rfq.get('quantityKg') or rfq.get('quantityPerWeekKg')} kg needed near {rfq.get('deliveryCity') or 'you'}.",
                {"rfqId": str(rfq_id), "type": "b2b"},
                NotificationPriority.HIGH,
            )
        except Exception as exc:  # broadcast must never block RFQ creation
            logger.warning("B2B RFQ broadcast failed: %s", exc)
    return {"success": True, "data": rfq, "message": "RFQ published"}


@router.get("/rfqs")
async def list_rfqs(
    status: Optional[str] = Query(RFQ_OPEN),
    scope: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
):
    """List RFQs. Farmers see open + visible ones; business buyers see their own."""
    role = current_user.get("role")
    if role == "business":
        match: Dict[str, Any] = {"businessUserId": ObjectId(current_user["_id"]), "deletedAt": None}
        if status:
            match["status"] = status
    elif role == "farmer":
        match = {"status": RFQ_OPEN, "deletedAt": None}
    else:
        raise HTTPException(status_code=403, detail="Only business buyers and farmers can browse RFQs")

    rfqs = await rfq_repo.find_many(match, sort=[("createdAt", -1)], limit=limit)

    farmer: Optional[Dict[str, Any]] = None
    if role == "farmer":
        farmer = await farmer_repository.get_by_user_id(str(current_user["_id"]))

    results: List[Dict[str, Any]] = []
    for r in rfqs:
        await _maybe_close_rfq(r)
        await _stringify_rfq(r)
        if role == "farmer":
            if farmer:
                distance = _distance_km(farmer, r)
                if not _visibility_match(r, farmer, distance):
                    continue
                r["distanceKm"] = distance
                supply = await _farmer_can_supply(str(current_user["_id"]), r.get("productName"))
                r["canSupply"] = supply["canSupply"]
                r["availableKg"] = supply["availableKg"]
            my = await offer_repo.find_one({
                "rfqId": r["_id"],
                "farmerId": ObjectId(current_user["_id"]),
                "deletedAt": None,
            })
            r["myOfferId"] = str(my["_id"]) if my else None
            r["myOfferStatus"] = my.get("status") if my else None
        results.append(r)
    return {"success": True, "data": {"rfqs": results, "count": len(results)}}


@router.get("/rfqs/{rfq_id}")
async def get_rfq(
    rfq_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Full RFQ detail for a farmer (quote form) or its business buyer."""
    rfq = await rfq_repo.find_one({"_id": ObjectId(rfq_id), "deletedAt": None})
    if not rfq:
        raise HTTPException(status_code=404, detail="RFQ not found")

    role = current_user.get("role")
    is_owner = str(rfq.get("businessUserId")) == str(current_user["_id"])
    if role not in ("admin", "super_admin") and not is_owner and role != "farmer":
        raise HTTPException(status_code=403, detail="Not allowed to view this RFQ")

    await _maybe_close_rfq(rfq)
    await _stringify_rfq(rfq)
    if role == "farmer":
        farmer = await farmer_repository.get_by_user_id(str(current_user["_id"]))
        rfq["distanceKm"] = _distance_km(farmer, rfq) if farmer else None
        supply = await _farmer_can_supply(str(current_user["_id"]), rfq.get("productName"))
        rfq["canSupply"] = supply["canSupply"]
        rfq["availableKg"] = supply["availableKg"]
        my = await offer_repo.find_one({
            "rfqId": rfq["_id"],
            "farmerId": ObjectId(current_user["_id"]),
            "deletedAt": None,
        })
        rfq["myOfferId"] = str(my["_id"]) if my else None
        rfq["myOfferStatus"] = my.get("status") if my else None
    return {"success": True, "data": rfq}


# ================== FARMER OFFERS ==================

class OfferCreate(BaseModel):
    pricePerKg: float = Field(..., gt=0)
    availableQuantityKg: Optional[float] = Field(None, gt=0)
    minOrderKg: Optional[float] = Field(0, ge=0)
    deliveryCharge: Optional[float] = Field(0, ge=0)
    deliveryMethod: Optional[str] = None
    expectedDeliveryDate: Optional[str] = None
    message: Optional[str] = None
    deliveryNote: Optional[str] = None


@router.post("/rfqs/{rfq_id}/offers")
async def submit_offer(
    rfq_id: str,
    data: OfferCreate,
    current_user: dict = Depends(get_current_user),
):
    """Submit a supply quote against an RFQ (Farmer)."""
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can submit offers")

    rfq = await rfq_repo.find_one({"_id": ObjectId(rfq_id), "deletedAt": None})
    if not rfq:
        raise HTTPException(status_code=404, detail="RFQ not found")
    await _maybe_close_rfq(rfq)
    if rfq.get("status") != RFQ_OPEN:
        raise HTTPException(status_code=400, detail="RFQ is no longer open (deadline passed or already awarded)")

    if data.deliveryMethod and data.deliveryMethod not in DELIVERY_METHODS:
        raise HTTPException(status_code=400, detail="Invalid delivery method")

    existing = await offer_repo.find_one({
        "rfqId": ObjectId(rfq_id),
        "farmerId": ObjectId(current_user["_id"]),
        "status": {"$ne": OFFER_DECLINED},
        "deletedAt": None,
    })
    if existing:
        raise HTTPException(status_code=400, detail="You already have an offer on this RFQ")

    qty = data.availableQuantityKg or data.minOrderKg or _rfq_quantity(rfq)
    ceiling = rfq.get("priceCeilingPerKg") or rfq.get("budgetMaxPerKg")
    offer = {
        "rfqId": ObjectId(rfq_id),
        "rfqNumber": rfq.get("rfqNumber"),
        "businessUserId": rfq.get("businessUserId"),
        "farmerId": ObjectId(current_user["_id"]),
        "productName": rfq.get("productName"),
        "pricePerKg": data.pricePerKg,
        "availableQuantityKg": float(data.availableQuantityKg) if data.availableQuantityKg else float(qty),
        "minOrderKg": data.minOrderKg,
        "deliveryCharge": float(data.deliveryCharge or 0),
        "deliveryMethod": data.deliveryMethod or DELIVERY_METHODS[0],
        "expectedDeliveryDate": data.expectedDeliveryDate,
        "message": data.message,
        "deliveryNote": data.deliveryNote,
        "aboveBudget": bool(ceiling and data.pricePerKg > ceiling),
        "status": OFFER_PENDING,
        "createdAt": datetime.utcnow(),
    }
    offer_id = await offer_repo.create(offer)
    if not offer_id:
        raise HTTPException(status_code=400, detail="Failed to submit offer")
    offer["_id"] = ObjectId(offer_id)
    offer["id"] = str(offer_id)

    farmer = await farmer_repository.find_one({"userId": ObjectId(current_user["_id"])})
    await NotificationService.create_in_app_notification(
        str(rfq.get("businessUserId")),
        NotificationType.PROMOTION,
        "New quote on your RFQ 💼",
        f"A farmer quoted ₹{data.pricePerKg}/kg for {rfq.get('productName')} (RFQ {rfq.get('rfqNumber')}).",
        {"rfqId": rfq_id, "offerId": str(offer_id), "type": "b2b"},
        NotificationPriority.HIGH,
    )

    return {
        "success": True,
        "data": offer,
        "message": f"Quote submitted - {(farmer or {}).get('farmName') or 'Farm'} @ ₹{data.pricePerKg}/kg",
    }


@router.get("/rfqs/{rfq_id}/offers")
async def list_offers_for_rfq(
    rfq_id: str,
    current_user: dict = Depends(get_current_user),
):
    """List quotes on an RFQ (its business buyer, or the offering farmer)."""
    rfq = await rfq_repo.find_one({"_id": ObjectId(rfq_id), "deletedAt": None})
    if not rfq:
        raise HTTPException(status_code=404, detail="RFQ not found")

    can_view = (
        current_user.get("role") in ("admin", "super_admin")
        or str(rfq.get("businessUserId")) == str(current_user["_id"])
        or current_user.get("role") == "farmer"
    )
    if not can_view:
        raise HTTPException(status_code=403, detail="Not allowed to view offers")

    offers = await offer_repo.find_many(
        {"rfqId": ObjectId(rfq_id), "deletedAt": None},
        sort=[("pricePerKg", 1)],
    )
    for o in offers:
        o["id"] = str(o["_id"])
        o["farmerId"] = str(o.get("farmerId"))
        if o.get("rfqId"):
            o["rfqId"] = str(o["rfqId"])
        farmer = await farmer_repository.find_one({"userId": o["farmerId"]})
        qty = float(o.get("availableQuantityKg") or o.get("minOrderKg") or 0)
        o["totalPrice"] = round(float(o.get("pricePerKg") or 0) * qty + float(o.get("deliveryCharge") or 0), 2)
        o["farmerInfo"] = {
            "farmName": (farmer or {}).get("farmName"),
            "rating": (farmer or {}).get("rating"),
            "ratingCount": (farmer or {}).get("ratingCount") or 0,
            "isVerified": bool((farmer or {}).get("isVerified")),
            "city": (farmer or {}).get("city"),
        }
    return {"success": True, "data": {"offers": offers, "count": len(offers)}}


# ================== AWARD / ORDER ==================

class OfferAccept(BaseModel):
    quantityKg: Optional[float] = Field(None, gt=0)
    deliveryMethod: Optional[str] = None
    paymentMode: Optional[str] = None
    advanceAmount: Optional[float] = Field(None, ge=0)
    deliveryCharge: Optional[float] = Field(None, ge=0)
    notes: Optional[str] = None


@router.post("/offers/{offer_id}/accept")
async def accept_offer(
    offer_id: str,
    data: OfferAccept = Body(default=None),
    current_user: dict = Depends(get_current_user),
):
    """Accept a farmer quote -> B2B order. Split procurement supported:
    several farmers can each cover part of the RFQ quantity."""
    if current_user.get("role") != "business":
        raise HTTPException(status_code=403, detail="Only business accounts can accept offers")

    offer = await offer_repo.find_one({"_id": ObjectId(offer_id), "deletedAt": None})
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found")

    rfq = await rfq_repo.find_one({"_id": offer.get("rfqId"), "deletedAt": None})
    if not rfq:
        raise HTTPException(status_code=404, detail="RFQ not found")
    if str(rfq.get("businessUserId")) != str(current_user["_id"]):
        raise HTTPException(status_code=403, detail="Not your RFQ")
    await _maybe_close_rfq(rfq)
    if rfq.get("status") not in (RFQ_OPEN, RFQ_AWARDED):
        raise HTTPException(status_code=400, detail="RFQ is closed or cancelled")
    if offer.get("status") != OFFER_PENDING:
        raise HTTPException(status_code=400, detail="This offer is no longer pending")

    if rfq.get("recurring"):
        # Recurring supply: award in full, decline the rest, close the RFQ.
        qty = _rfq_quantity(rfq)
        await offer_repo.update({"_id": offer["_id"]}, {
            "status": OFFER_ACCEPTED,
            "acceptedAt": datetime.utcnow(),
            "acceptedQuantityKg": qty,
        })
        await offer_repo.collection.update_many(
            {"rfqId": rfq["_id"], "_id": {"$ne": offer["_id"]}, "status": OFFER_PENDING},
            {"$set": {"status": OFFER_DECLINED, "updatedAt": datetime.utcnow()}},
        )
        await rfq_repo.update({"_id": rfq["_id"]}, {
            "status": RFQ_AWARDED,
            "awardedOfferIds": [offer["_id"]],
            "acceptedQuantityKg": qty,
        })
    else:
        total_qty = _rfq_quantity(rfq)
        remaining = total_qty - float(rfq.get("acceptedQuantityKg") or 0)
        offer_qty = float(offer.get("availableQuantityKg") or offer.get("minOrderKg") or total_qty)
        requested = float(data.quantityKg) if data and data.quantityKg else offer_qty
        qty = min(requested, offer_qty, remaining)
        if qty <= 0:
            raise HTTPException(status_code=400, detail="RFQ quantity is already fully covered by other farmers")

        await offer_repo.update({"_id": offer["_id"]}, {
            "status": OFFER_ACCEPTED,
            "acceptedAt": datetime.utcnow(),
            "acceptedQuantityKg": round(qty, 2),
        })
        accepted_now = float(rfq.get("acceptedQuantityKg") or 0) + qty
        update: Dict[str, Any] = {
            "acceptedQuantityKg": round(accepted_now, 2),
            "awardedOfferIds": (rfq.get("awardedOfferIds") or []) + [offer["_id"]],
        }
        if accepted_now >= total_qty - 1e-9:
            update["status"] = RFQ_AWARDED
            await offer_repo.collection.update_many(
                {"rfqId": rfq["_id"], "_id": {"$ne": offer["_id"]}, "status": OFFER_PENDING},
                {"$set": {"status": OFFER_DECLINED, "updatedAt": datetime.utcnow()}},
            )
        await rfq_repo.update({"_id": rfq["_id"]}, update)

    order = await _build_order(rfq, offer, qty, data)
    order_id = await order_repo.create(order)
    order["_id"] = ObjectId(order_id)
    order["id"] = str(order_id)

    await NotificationService.create_in_app_notification(
        str(offer.get("farmerId")),
        NotificationType.ORDER,
        "Offer accepted! 🎉",
        f"Your quote for {offer.get('productName')} @ ₹{offer.get('pricePerKg')}/kg was accepted (order {order.get('orderNumber')}).",
        {"rfqId": str(rfq["_id"]), "orderId": order_id, "type": "b2b"},
        NotificationPriority.HIGH,
    )

    return {
        "success": True,
        "data": {"order": order, "offerId": offer_id, "remainingQuantityKg": round(max(0.0, _rfq_quantity(rfq) - float(order.get("quantityKg"))), 2)},
        "message": "Quote accepted; B2B order created",
    }


# ================== ORDERS ==================

async def _enrich_order(o: Dict[str, Any]) -> None:
    o["id"] = str(o["_id"])
    o["farmerId"] = str(o.get("farmerId"))
    if o.get("businessUserId"):
        o["businessUserId"] = str(o["businessUserId"])
    if o.get("rfqId"):
        o["rfqId"] = str(o["rfqId"])
    if o.get("offerId"):
        o["offerId"] = str(o["offerId"])
    farmer = await farmer_repository.find_one({"userId": o["farmerId"]})
    o["farmerInfo"] = {
        "farmName": (farmer or {}).get("farmName"),
        "rating": (farmer or {}).get("rating"),
        "isVerified": bool((farmer or {}).get("isVerified")),
        "city": (farmer or {}).get("city"),
    }
    if o.get("businessProfileId"):
        profile = await profile_repo.find_one({"_id": o["businessProfileId"]})
        o["businessProfileId"] = str(o["businessProfileId"])
        o["businessInfo"] = {
            "businessName": (profile or {}).get("businessName"),
            "businessType": (profile or {}).get("businessType"),
            "city": (profile or {}).get("city"),
            "gstin": (profile or {}).get("gstin"),
            "isVerified": bool((profile or {}).get("isVerified")),
        }
    else:
        o["businessInfo"] = {}


@router.get("/orders")
async def list_b2b_orders(current_user: dict = Depends(get_current_user)):
    """List B2B purchase orders for the current business buyer or farmer."""
    role = current_user.get("role")
    if role == "business":
        match = {"businessUserId": ObjectId(current_user["_id"]), "deletedAt": None}
    elif role == "farmer":
        match = {"farmerId": ObjectId(current_user["_id"]), "deletedAt": None}
    else:
        raise HTTPException(status_code=403, detail="Only business buyers and farmers can view B2B orders")

    orders = await order_repo.find_many(match, sort=[("startedAt", -1)], limit=200)
    for o in orders:
        await _enrich_order(o)
    return {"success": True, "data": {"orders": orders, "count": len(orders)}}


class OrderStatusUpdate(BaseModel):
    status: str
    qualityCheck: Optional[str] = None
    paymentStatus: Optional[str] = None


@router.put("/orders/{order_id}/status")
async def update_order_status(
    order_id: str,
    data: OrderStatusUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Advance a B2B order along its lifecycle. Farmers prepare/dispatch/deliver;
    the business buyer confirms receipt (completed) and may cancel while confirmed."""
    order = await order_repo.find_one({"_id": ObjectId(order_id), "deletedAt": None})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    role = current_user.get("role")
    if role == "farmer" and str(order.get("farmerId")) != str(current_user["_id"]):
        raise HTTPException(status_code=403, detail="Not your order")
    if role == "business" and str(order.get("businessUserId")) != str(current_user["_id"]):
        raise HTTPException(status_code=403, detail="Not your order")
    if role not in ("farmer", "business"):
        raise HTTPException(status_code=403, detail="Only the farmer or business buyer can update this order")

    current = order.get("status")
    if current == ORDER_CANCELLED:
        raise HTTPException(status_code=400, detail="Order is already cancelled")
    if current == ORDER_COMPLETED:
        raise HTTPException(status_code=400, detail="Order is already completed")

    update: Dict[str, Any] = {"status": data.status, "updatedAt": datetime.utcnow()}

    if data.status == ORDER_CANCELLED:
        if current != ORDER_CONFIRMED:
            raise HTTPException(status_code=400, detail="Only confirmed orders can be cancelled")
        update["cancelledAt"] = datetime.utcnow()
        await order_repo.update({"_id": order["_id"]}, update)
        other = str(order.get("businessUserId")) if role == "farmer" else str(order.get("farmerId"))
        await NotificationService.create_in_app_notification(
            other, NotificationType.ORDER, "B2B order cancelled",
            f"Order {order.get('orderNumber')} ({order.get('productName')}) was cancelled.",
            {"orderId": order_id, "type": "b2b"}, NotificationPriority.HIGH,
        )
        return {"success": True, "message": "Order cancelled"}

    if role == "farmer":
        if current not in ORDER_FLOW or data.status not in ORDER_FLOW:
            raise HTTPException(status_code=400, detail="Invalid status")
        nxt = ORDER_FLOW[ORDER_FLOW.index(current) + 1] if current in ORDER_FLOW else None
        if data.status != nxt:
            raise HTTPException(status_code=400, detail=f"Invalid transition from {current} to {data.status}")
        if data.status == ORDER_QUALITY_CHECK and data.qualityCheck in ("passed", "failed"):
            update["qualityCheck"] = data.qualityCheck
        if data.status == ORDER_DELIVERED:
            update["deliveredAt"] = datetime.utcnow()
        await order_repo.update({"_id": order["_id"]}, update)
        if data.status in (ORDER_DISPATCHED, ORDER_DELIVERED):
            await NotificationService.create_in_app_notification(
                str(order.get("businessUserId")), NotificationType.ORDER,
                f"B2B order {data.status.replace('_', ' ')} 🚚",
                f"Order {order.get('orderNumber')} ({order.get('productName')}) is now {data.status.replace('_', ' ')}.",
                {"orderId": order_id, "type": "b2b"}, NotificationPriority.HIGH,
            )
        return {"success": True, "message": f"Order updated to {data.status}"}

    # business role
    if data.status == ORDER_COMPLETED:
        if current != ORDER_DELIVERED:
            raise HTTPException(status_code=400, detail="You can mark the order completed only after delivery")
        update["completedAt"] = datetime.utcnow()
        if data.paymentStatus in (PAYMENT_PAID, PAYMENT_ADVANCE):
            update["paymentStatus"] = data.paymentStatus
        else:
            update["paymentStatus"] = PAYMENT_PAID
        await order_repo.update({"_id": order["_id"]}, update)
        await NotificationService.create_in_app_notification(
            str(order.get("farmerId")), NotificationType.ORDER, "Order completed & settled ✅",
            f"Order {order.get('orderNumber')} was received and settled (₹{order.get('totalAmount')}).",
            {"orderId": order_id, "type": "b2b"}, NotificationPriority.HIGH,
        )
        return {"success": True, "message": "Order completed"}

    raise HTTPException(status_code=400, detail="Business buyers can only complete or cancel orders")


@router.get("/orders/{order_id}/invoice")
async def get_order_invoice(
    order_id: str,
    current_user: dict = Depends(get_current_user),
):
    """B2B invoice for procurement records."""
    order = await order_repo.find_one({"_id": ObjectId(order_id), "deletedAt": None})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    role = current_user.get("role")
    if role not in ("admin", "super_admin") and str(order.get("businessUserId")) != str(current_user["_id"]) and str(order.get("farmerId")) != str(current_user["_id"]):
        raise HTTPException(status_code=403, detail="Not allowed to view this invoice")

    profile = await profile_repo.find_one({"_id": order.get("businessProfileId")}) if order.get("businessProfileId") else None
    farmer = await farmer_repository.find_one({"userId": str(order.get("farmerId"))})

    qty = float(order.get("quantityKg") or 0)
    rate = float(order.get("pricePerKg") or 0)
    subtotal = round(qty * rate, 2)
    delivery = float(order.get("deliveryCharge") or 0)
    order_no = order.get("orderNumber") or f"B2B-{str(order['_id'])[-6:]}"
    invoice = {
        "invoiceNumber": f"INV-{order_no.split('-')[-1]}",
        "orderNumber": order_no,
        "issuedAt": datetime.utcnow().isoformat(),
        "buyer": {
            "name": (profile or {}).get("businessName"),
            "type": (profile or {}).get("businessType"),
            "gstin": (profile or {}).get("gstin"),
            "city": (profile or {}).get("city"),
            "address": (profile or {}).get("address"),
        },
        "seller": {
            "name": (farmer or {}).get("farmName"),
            "phone": (farmer or {}).get("phone"),
            "city": (farmer or {}).get("city"),
            "rating": (farmer or {}).get("rating"),
        },
        "items": [{
            "product": order.get("productName"),
            "quality": order.get("qualityGrade"),
            "quantityKg": qty,
            "ratePerKg": rate,
            "amount": subtotal,
        }],
        "subtotal": subtotal,
        "deliveryCharge": delivery,
        "taxes": 0.0,
        "total": round(subtotal + delivery, 2),
        "paymentStatus": order.get("paymentStatus"),
        "paymentMode": order.get("paymentMode"),
        "advanceAmount": float(order.get("advanceAmount") or 0),
        "status": order.get("status"),
    }
    return {"success": True, "data": {"invoice": invoice}}


# ================== TWO-WAY RATINGS ==================

class B2BRatingCreate(BaseModel):
    direction: str  # business_to_farmer | farmer_to_business
    quality: Optional[float] = Field(None, ge=1, le=5)
    quantityAccuracy: Optional[float] = Field(None, ge=1, le=5)
    delivery: Optional[float] = Field(None, ge=1, le=5)
    communication: Optional[float] = Field(None, ge=1, le=5)
    paymentReliability: Optional[float] = Field(None, ge=1, le=5)
    orderAccuracy: Optional[float] = Field(None, ge=1, le=5)
    comment: Optional[str] = None


@router.post("/orders/{order_id}/rate")
async def rate_order(
    order_id: str,
    data: B2BRatingCreate,
    current_user: dict = Depends(get_current_user),
):
    """Rate the counterparty after a delivered/completed B2B order."""
    order = await order_repo.find_one({"_id": ObjectId(order_id), "deletedAt": None})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("status") not in (ORDER_DELIVERED, ORDER_COMPLETED):
        raise HTTPException(status_code=400, detail="Ratings open after the order is delivered/completed")

    role = current_user.get("role")
    if data.direction == "business_to_farmer":
        if role != "business" or str(order.get("businessUserId")) != str(current_user["_id"]):
            raise HTTPException(status_code=403, detail="Only this order's business buyer can rate the farmer")
        target_id = str(order.get("farmerId"))
    elif data.direction == "farmer_to_business":
        if role != "farmer" or str(order.get("farmerId")) != str(current_user["_id"]):
            raise HTTPException(status_code=403, detail="Only this order's farmer can rate the business")
        target_id = str(order.get("businessUserId"))
    else:
        raise HTTPException(status_code=400, detail="direction must be business_to_farmer or farmer_to_business")

    existing = await rating_repo.find_one({"orderId": ObjectId(order_id), "direction": data.direction, "deletedAt": None})
    if existing:
        raise HTTPException(status_code=400, detail="You already rated this order")

    rating = {
        "orderId": ObjectId(order_id),
        "orderNumber": order.get("orderNumber"),
        "rfqId": order.get("rfqId"),
        "direction": data.direction,
        "businessUserId": order.get("businessUserId"),
        "farmerId": order.get("farmerId"),
        "targetUserId": ObjectId(target_id) if ObjectId.is_valid(target_id) else target_id,
        "quality": data.quality,
        "quantityAccuracy": data.quantityAccuracy,
        "delivery": data.delivery,
        "communication": data.communication,
        "paymentReliability": data.paymentReliability,
        "orderAccuracy": data.orderAccuracy,
        "comment": data.comment,
        "createdAt": datetime.utcnow(),
    }
    rating_id = await rating_repo.create(rating)
    if not rating_id:
        raise HTTPException(status_code=400, detail="Failed to save rating")

    await NotificationService.create_in_app_notification(
        target_id, NotificationType.PROMOTION, "New B2B rating ⭐",
        "You received a rating for a completed B2B order.",
        {"orderId": order_id, "type": "b2b"}, NotificationPriority.HIGH,
    )
    return {"success": True, "data": {"id": str(rating_id)}, "message": "Rating submitted"}


@router.get("/ratings/me")
async def my_ratings(current_user: dict = Depends(get_current_user)):
    """Ratings received by the caller, with per-dimension averages."""
    role = current_user.get("role")
    if role == "business":
        match = {"businessUserId": ObjectId(current_user["_id"]), "direction": "farmer_to_business", "deletedAt": None}
    elif role == "farmer":
        match = {"farmerId": ObjectId(current_user["_id"]), "direction": "business_to_farmer", "deletedAt": None}
    else:
        raise HTTPException(status_code=403, detail="Not allowed")

    ratings = await rating_repo.find_many(match, sort=[("createdAt", -1)], limit=100)
    dims = ["quality", "quantityAccuracy", "delivery", "communication", "paymentReliability", "orderAccuracy"]
    values: Dict[str, List[float]] = {d: [] for d in dims}
    for r in ratings:
        r["id"] = str(r["_id"])
        for d in dims:
            v = r.get(d)
            if isinstance(v, (int, float)):
                values[d].append(float(v))
    averages = {d: round(sum(v) / len(v), 2) if v else None for d, v in values.items()}
    return {"success": True, "data": {"ratings": ratings, "count": len(ratings), "averages": averages}}


# ================== ANALYTICS ==================

@router.get("/analytics/me")
async def b2b_analytics(current_user: dict = Depends(get_current_user)):
    """B2B performance for the current farmer (sales) or business (procurement)."""
    role = current_user.get("role")
    if role == "farmer":
        orders = await order_repo.find_many({"farmerId": ObjectId(current_user["_id"]), "deletedAt": None}, limit=500)
        settled = [o for o in orders if o.get("status") in (ORDER_DELIVERED, ORDER_COMPLETED)]
        total_sales = sum(float(o.get("totalAmount") or 0) for o in settled)
        order_count = len(settled)
        active = [o for o in orders if o.get("status") in ACTIVE_ORDER_STATUSES]
        top_products: Dict[str, float] = {}
        top_buyers: Dict[str, Dict[str, Any]] = {}
        for o in settled:
            top_products[o.get("productName") or "Unknown"] = top_products.get(o.get("productName") or "Unknown", 0) + float(o.get("totalAmount") or 0)
            if o.get("businessProfileId"):
                p = await profile_repo.find_one({"_id": o["businessProfileId"]})
                name = (p or {}).get("businessName") or "Business"
            else:
                name = "Business"
            entry = top_buyers.setdefault(name, {"total": 0.0, "orders": 0})
            entry["total"] += float(o.get("totalAmount") or 0)
            entry["orders"] += 1

        open_rfqs = await rfq_repo.count({"status": RFQ_OPEN, "deletedAt": None})
        farmer_doc = await farmer_repository.get_by_user_id(str(current_user["_id"]))
        if farmer_doc:
            visible = 0
            for r in await rfq_repo.find_many({"status": RFQ_OPEN, "deletedAt": None}, limit=200):
                distance = _distance_km(farmer_doc, r)
                if _visibility_match(r, farmer_doc, distance):
                    visible += 1
            open_rfqs = visible
        my_quotes = await offer_repo.count({"farmerId": ObjectId(current_user["_id"]), "status": OFFER_PENDING, "deletedAt": None})
        won = await offer_repo.count({"farmerId": ObjectId(current_user["_id"]), "status": OFFER_ACCEPTED, "deletedAt": None})

        return {"success": True, "data": {
            "totalSales": round(total_sales, 2),
            "orderCount": order_count,
            "avgOrder": round(total_sales / order_count, 2) if order_count else 0,
            "activeOrders": len(active),
            "openRfqs": open_rfqs,
            "myQuotes": my_quotes,
            "wonOffers": won,
            "topProducts": [{"name": k, "value": round(v, 2)} for k, v in sorted(top_products.items(), key=lambda x: -x[1])[:5]],
            "topBuyers": [{"name": k, "total": round(v["total"], 2), "orders": v["orders"]} for k, v in sorted(top_buyers.items(), key=lambda x: -x[1]["total"])[:5]],
        }}

    if role == "business":
        orders = await order_repo.find_many({"businessUserId": ObjectId(current_user["_id"]), "deletedAt": None}, limit=500)
        settled = [o for o in orders if o.get("status") in (ORDER_DELIVERED, ORDER_COMPLETED)]
        spend = sum(float(o.get("totalAmount") or 0) for o in settled)
        open_rfqs = await rfq_repo.count({"businessUserId": ObjectId(current_user["_id"]), "status": RFQ_OPEN, "deletedAt": None})
        my_rfqs = await rfq_repo.count({"businessUserId": ObjectId(current_user["_id"]), "deletedAt": None})
        offers_received = 0
        my_rfq_docs = await rfq_repo.find_many({"businessUserId": ObjectId(current_user["_id"]), "deletedAt": None}, limit=200)
        for r in my_rfq_docs:
            offers_received += await offer_repo.count({"rfqId": r["_id"], "status": {"$ne": OFFER_DECLINED}, "deletedAt": None})
        suppliers: Dict[str, Dict[str, Any]] = {}
        top_products: Dict[str, float] = {}
        for o in settled:
            f = await farmer_repository.find_one({"userId": str(o.get("farmerId"))})
            name = (f or {}).get("farmName") or "Farmer"
            entry = suppliers.setdefault(name, {"total": 0.0, "orders": 0, "rating": (f or {}).get("rating")})
            entry["total"] += float(o.get("totalAmount") or 0)
            entry["orders"] += 1
            top_products[o.get("productName") or "Unknown"] = top_products.get(o.get("productName") or "Unknown", 0) + float(o.get("totalAmount") or 0)

        # monthly procurement trend (bucket by year-month string)
        months: Dict[str, Dict[str, Any]] = {}
        for o in orders:
            if not o.get("startedAt"):
                continue
            key = o["startedAt"].strftime("%b %Y") if isinstance(o["startedAt"], datetime) else None
            if not key:
                continue
            bucket = months.setdefault(key, {"name": key, "spend": 0.0, "orders": 0})
            bucket["orders"] += 1
            if o.get("status") in (ORDER_DELIVERED, ORDER_COMPLETED):
                bucket["spend"] += float(o.get("totalAmount") or 0)

        paid_amount = sum(float(o.get("totalAmount") or 0) for o in orders if (o.get("paymentStatus") or PAYMENT_PENDING) == PAYMENT_PAID)
        pending_amount = sum(float(o.get("totalAmount") or 0) for o in orders if (o.get("paymentStatus") or PAYMENT_PENDING) != PAYMENT_PAID)
        recent_orders = sorted(orders, key=lambda x: x.get("startedAt") or datetime.min, reverse=True)[:6]

        return {"success": True, "data": {
            "totalSpend": round(spend, 2),
            "rfqCount": my_rfqs,
            "openRfqCount": open_rfqs,
            "offerCount": offers_received,
            "avgOrderValue": round(spend / len(settled), 2) if settled else 0,
            "completedOrders": len(settled),
            "activeOrders": sum(1 for o in orders if o.get("status") in ACTIVE_ORDER_STATUSES),
            "topSuppliers": [{"name": k, "total": round(v["total"], 2), "orders": v["orders"], "rating": v["rating"]} for k, v in sorted(suppliers.items(), key=lambda x: -x[1]["total"])[:5]],
            "topProducts": [{"name": k, "value": round(v, 2)} for k, v in sorted(top_products.items(), key=lambda x: -x[1])[:5]],
            "monthlyTrend": [months[k] for k in sorted(months.keys())][-7:],
            "paidAmount": round(paid_amount, 2),
            "pendingAmount": round(pending_amount, 2),
            "recentOrders": recent_orders,
        }}

    raise HTTPException(status_code=403, detail="Only business buyers and farmers have B2B analytics")


# ================== AI SUPPLIER RANKING (comparison) ==================

async def _farmer_on_time_rate(farmer_id: str) -> float:
    """Approximate on-time delivery rate from a farmer's completed B2B orders."""
    orders = await order_repo.find_many({"farmerId": ObjectId(farmer_id), "deletedAt": None}, limit=200)
    closed = [o for o in orders if o.get("status") in (ORDER_DELIVERED, ORDER_COMPLETED)]
    if not closed:
        return 90.0
    late = sum(1 for o in closed if o.get("deliveredAt") and o.get("expectedDeliveryDate")
               and o.get("deliveredAt") > _parse_delivery_date(o.get("expectedDeliveryDate")))
    return round(max(0.0, min(100.0, 100.0 - (late / len(closed)) * 100.0)), 1)


def _parse_delivery_date(value: Any) -> datetime:
    for fmt in ("%Y-%m-%d", "%d %b %Y", "%d/%m/%Y", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(str(value).strip(), fmt)
        except Exception:
            continue
    return datetime.utcnow()


async def _offer_ai_scores(rfq: Dict[str, Any], offers: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Deterministic AI ranking of pending farmer quotes for one RFQ.

    Blends price, quantity coverage, quality grade, farmer rating, distance,
    on-time delivery history, verification and delivery method into a 0-100 score.
    """
    required = _rfq_quantity(rfq)
    ceiling = rfq.get("priceCeilingPerKg") or rfq.get("budgetMaxPerKg")

    pending = [o for o in offers if o.get("status") == OFFER_PENDING]
    if not pending:
        return {"scores": [], "best": None, "recommendedOfferIds": [], "reason": "No pending quotes to compare."}

    prices = [float(o.get("pricePerKg") or 0) for o in pending if o.get("pricePerKg")]
    lowest_price = min(prices) if prices else 0.0

    scores: List[Dict[str, Any]] = []
    for o in pending:
        farmer = await farmer_repository.find_one({"userId": str(o.get("farmerId"))})
        farm_name = (farmer or {}).get("farmName") or "Farm"
        rating = float((farmer or {}).get("rating") or 0)
        verified = bool((farmer or {}).get("isVerified"))
        distance = _distance_km(farmer, rfq)

        price = float(o.get("pricePerKg") or 0)
        price_score = 100.0 if (not lowest_price or price <= 0) else max(0.0, min(100.0, (lowest_price / price) * 100))
        if ceiling and price > float(ceiling):
            price_score *= 0.6  # above the buyer's ceiling is penalised heavily

        avail = float(o.get("availableQuantityKg") or o.get("minOrderKg") or required or 0)
        coverage = 100.0 if not required else max(0.0, min(100.0, (avail / required) * 100))

        qg = (o.get("qualityGrade") or rfq.get("qualityGrade") or "").strip().lower()
        quality_score = 90.0
        if qg:
            quality_score = 100.0 if "premium" in qg or "organic" in qg else (95.0 if qg == "grade a" else 80.0)

        rating_score = (rating / 5.0) * 100.0 if rating else 55.0
        distance_score = 100.0 if distance is None else max(0.0, min(100.0, 100.0 - distance * 1.2))
        on_time = await _farmer_on_time_rate(str(o.get("farmerId")))
        delivery_score = 100.0 if on_time >= 95 else (60.0 if on_time >= 80 else 40.0)
        method_score = 100.0 if (o.get("deliveryMethod") or "farmer_delivery") in ("farmer_delivery", "dedicated_transport") else 90.0
        verified_score = 100.0 if verified else 70.0

        total = (
            price_score * 0.30
            + coverage * 0.20
            + quality_score * 0.12
            + rating_score * 0.12
            + distance_score * 0.10
            + delivery_score * 0.08
            + verified_score * 0.05
            + method_score * 0.03
        )
        scores.append({
            "offerId": str(o["_id"]),
            "farmerId": str(o.get("farmerId")),
            "farmName": farm_name,
            "rating": round(rating, 1),
            "pricePerKg": round(price, 2),
            "availableQuantityKg": round(avail, 2),
            "qualityGrade": o.get("qualityGrade") or rfq.get("qualityGrade"),
            "distanceKm": distance,
            "onTimeRate": on_time,
            "isVerified": verified,
            "deliveryMethod": o.get("deliveryMethod") or "farmer_delivery",
            "expectedDeliveryDate": o.get("expectedDeliveryDate"),
            "deliveryCharge": float(o.get("deliveryCharge") or 0),
            "totalPrice": round(float(price) * min(avail, required or avail) + float(o.get("deliveryCharge") or 0), 2) if required else None,
            "aboveBudget": bool(o.get("aboveBudget")),
            "aiScore": round(total, 1),
            "dimensions": {
                "price": round(price_score, 1),
                "coverage": round(coverage, 1),
                "quality": round(quality_score, 1),
                "rating": round(rating_score, 1),
                "distance": round(distance_score, 1),
                "delivery": round(delivery_score, 1),
                "verified": round(verified_score, 1),
            },
        })

    scores.sort(key=lambda s: s["aiScore"], reverse=True)
    best = scores[0] if scores else None

    reason = None
    if best:
        cheapest = min(scores, key=lambda s: s["pricePerKg"])
        if cheapest["offerId"] == best["offerId"]:
            reason = f"{best['farmName']} offers the lowest price AND the strongest all-round score."
        else:
            diff = round(float(cheapest["pricePerKg"]) - float(best["pricePerKg"]), 2)
            reason = (
                f"{cheapest['farmName']} is ₹{diff}/kg cheaper, but {best['farmName']} "
                f"wins on {', '.join(k for k, v in best['dimensions'].items() if v >= 95) or 'overall balance'} "
                f"({best['aiScore']} vs {cheapest['aiScore']} AI score)."
            )

    return {
        "scores": scores,
        "best": best,
        "recommendedOfferIds": [best["offerId"]] if best else [],
        "reason": reason,
        "requiredQuantityKg": required,
    }


@router.post("/rfqs/{rfq_id}/ai-rank")
async def ai_rank_rfq_offers(
    rfq_id: str,
    current_user: dict = Depends(get_current_user),
):
    """AI supplier comparison & ranking for one RFQ (business buyer)."""
    rfq = await rfq_repo.find_one({"_id": ObjectId(rfq_id), "deletedAt": None})
    if not rfq:
        raise HTTPException(status_code=404, detail="RFQ not found")
    if current_user.get("role") not in ("admin", "super_admin") and str(rfq.get("businessUserId")) != str(current_user["_id"]):
        raise HTTPException(status_code=403, detail="Only this RFQ's buyer can rank quotes")

    offers = await offer_repo.find_many({"rfqId": rfq["_id"], "deletedAt": None}, sort=[("createdAt", 1)])
    ranking = await _offer_ai_scores(rfq, offers)
    return {"success": True, "data": ranking}


# ================== AI SPLIT PROCUREMENT ==================

@router.post("/rfqs/{rfq_id}/ai-split")
async def ai_split_procurement(
    rfq_id: str,
    current_user: dict = Depends(get_current_user),
):
    """AI-suggested split of an RFQ quantity across multiple farmers when no
    single farmer can cover the full requirement."""
    rfq = await rfq_repo.find_one({"_id": ObjectId(rfq_id), "deletedAt": None})
    if not rfq:
        raise HTTPException(status_code=404, detail="RFQ not found")
    if current_user.get("role") not in ("admin", "super_admin") and str(rfq.get("businessUserId")) != str(current_user["_id"]):
        raise HTTPException(status_code=403, detail="Only this RFQ's buyer can get split suggestions")

    offers = await offer_repo.find_many({"rfqId": rfq["_id"], "status": OFFER_PENDING, "deletedAt": None})
    ranking = await _offer_ai_scores(rfq, offers)
    scores = ranking["scores"]
    required = _rfq_quantity(rfq)
    remaining = float(rfq.get("acceptedQuantityKg") or 0)

    if not required or not scores:
        return {"success": True, "data": {"possible": False, "reason": "No quotes to split yet.", "rows": [], "totalQuantityKg": 0, "estimatedTotal": 0}}

    target = required - remaining
    if target <= 0:
        return {"success": True, "data": {"possible": True, "reason": "RFQ quantity already fully covered.", "rows": [], "totalQuantityKg": target, "estimatedTotal": 0}}

    rows: List[Dict[str, Any]] = []
    covered = 0.0
    total_cost = 0.0
    for s in scores:
        if covered >= target - 1e-9:
            break
        take = min(float(s["availableQuantityKg"]), target - covered)
        if take <= 0:
            continue
        covered += take
        total_cost += take * float(s["pricePerKg"])
        rows.append({
            "offerId": s["offerId"],
            "farmerId": s["farmerId"],
            "farmName": s["farmName"],
            "quantityKg": round(take, 2),
            "pricePerKg": s["pricePerKg"],
            "amount": round(take * float(s["pricePerKg"]), 2),
            "deliveryCharge": s["deliveryCharge"],
        })

    possible = covered >= target - 1e-9
    return {"success": True, "data": {
        "possible": possible,
        "reason": "AI split suggestion by best-ranked suppliers." if possible else f"Quoted availability covers only {round(covered, 2)} of {round(target, 2)} kg.",
        "rows": rows,
        "totalQuantityKg": round(covered, 2),
        "targetQuantityKg": round(target, 2),
        "estimatedTotal": round(total_cost, 2),
    }}


# ================== SUPPLIERS ==================

@router.get("/suppliers")
async def list_b2b_suppliers(current_user: dict = Depends(get_current_user)):
    """Procurement suppliers for the current business buyer, with performance."""
    if current_user.get("role") != "business":
        raise HTTPException(status_code=403, detail="Only business buyers have suppliers")

    orders = await order_repo.find_many({"businessUserId": ObjectId(current_user["_id"]), "deletedAt": None}, limit=500)
    suppliers: Dict[str, Dict[str, Any]] = {}
    for o in orders:
        fid = str(o.get("farmerId"))
        entry = suppliers.setdefault(fid, {"farmerId": fid, "orders": 0, "totalSpend": 0.0, "onTime": 0, "products": set(), "lastOrder": None})
        entry["orders"] += 1
        entry["products"].add(o.get("productName") or "Unknown")
        if o.get("status") in (ORDER_DELIVERED, ORDER_COMPLETED):
            entry["totalSpend"] += float(o.get("totalAmount") or 0)
        if o.get("status") in (ORDER_DELIVERED, ORDER_COMPLETED):
            entry["onTime"] += 1
        if o.get("startedAt") and (entry["lastOrder"] is None or o.get("startedAt") > entry["lastOrder"]):
            entry["lastOrder"] = o.get("startedAt")

    results: List[Dict[str, Any]] = []
    for fid, entry in suppliers.items():
        farmer = await farmer_repository.find_one({"userId": fid})
        entry["farmName"] = (farmer or {}).get("farmName") or "Farm"
        entry["rating"] = (farmer or {}).get("rating")
        entry["ratingCount"] = (farmer or {}).get("ratingCount") or 0
        entry["isVerified"] = bool((farmer or {}).get("isVerified"))
        entry["city"] = (farmer or {}).get("city")
        entry["state"] = (farmer or {}).get("state")
        entry["products"] = sorted(entry["products"])
        entry["totalSpend"] = round(entry["totalSpend"], 2)
        entry["onTimeRate"] = round(entry["onTime"] / entry["orders"] * 100, 1) if entry["orders"] else 100.0
        entry.pop("onTime", None)
        entry["lastOrderDate"] = entry["lastOrder"].isoformat() if entry.get("lastOrder") else None
        entry.pop("lastOrder", None)
        results.append(entry)

    results.sort(key=lambda s: (-s["totalSpend"], -s["orders"]))
    return {"success": True, "data": {"suppliers": results, "count": len(results)}}


# ================== PAYMENTS & INVOICES ==================

@router.get("/payments")
async def list_b2b_payments(current_user: dict = Depends(get_current_user)):
    """Payment summary + history for the current business buyer."""
    if current_user.get("role") != "business":
        raise HTTPException(status_code=403, detail="Only business buyers have B2B payments")

    orders = await order_repo.find_many({"businessUserId": ObjectId(current_user["_id"]), "deletedAt": None}, sort=[("startedAt", -1)], limit=500)
    now = datetime.utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    total_month = 0.0
    paid = 0.0
    pending = 0.0
    payments: List[Dict[str, Any]] = []
    for o in orders:
        total = float(o.get("totalAmount") or 0)
        ps = o.get("paymentStatus") or PAYMENT_PENDING
        if o.get("startedAt") and o["startedAt"] >= month_start:
            total_month += total
        if ps == PAYMENT_PAID:
            paid += total
        elif ps == PAYMENT_ADVANCE:
            paid += float(o.get("advanceAmount") or 0)
            pending += total - float(o.get("advanceAmount") or 0)
        else:
            pending += total
        farmer = await farmer_repository.find_one({"userId": str(o.get("farmerId"))})
        payments.append({
            "orderId": str(o["_id"]),
            "orderNumber": o.get("orderNumber"),
            "productName": o.get("productName"),
            "quantityKg": o.get("quantityKg"),
            "totalAmount": round(total, 2),
            "paymentStatus": ps,
            "paymentMode": o.get("paymentMode"),
            "advanceAmount": round(float(o.get("advanceAmount") or 0), 2),
            "farmName": (farmer or {}).get("farmName") or "Farm",
            "startedAt": o.get("startedAt").isoformat() if o.get("startedAt") else None,
        })

    return {"success": True, "data": {
        "totalMonth": round(total_month, 2),
        "paid": round(paid, 2),
        "pending": round(pending, 2),
        "payments": payments,
    }}


@router.get("/invoices")
async def list_b2b_invoices(current_user: dict = Depends(get_current_user)):
    """All invoices for the current business buyer's orders."""
    if current_user.get("role") != "business":
        raise HTTPException(status_code=403, detail="Only business buyers have B2B invoices")

    orders = await order_repo.find_many({"businessUserId": ObjectId(current_user["_id"]), "deletedAt": None}, sort=[("startedAt", -1)], limit=500)
    invoices: List[Dict[str, Any]] = []
    for o in orders:
        farmer = await farmer_repository.find_one({"userId": str(o.get("farmerId"))})
        qty = float(o.get("quantityKg") or 0)
        rate = float(o.get("pricePerKg") or 0)
        subtotal = round(qty * rate, 2)
        delivery = float(o.get("deliveryCharge") or 0)
        order_no = o.get("orderNumber") or f"B2B-{str(o['_id'])[-6:]}"
        invoices.append({
            "orderId": str(o["_id"]),
            "invoiceNumber": f"INV-{order_no.split('-')[-1]}",
            "orderNumber": order_no,
            "productName": o.get("productName"),
            "quantityKg": qty,
            "subtotal": subtotal,
            "deliveryCharge": round(delivery, 2),
            "total": round(subtotal + delivery, 2),
            "paymentStatus": o.get("paymentStatus") or PAYMENT_PENDING,
            "paymentMode": o.get("paymentMode"),
            "farmName": (farmer or {}).get("farmName") or "Farm",
            "status": o.get("status"),
            "issuedAt": o.get("completedAt") or o.get("startedAt"),
        })

    return {"success": True, "data": {"invoices": invoices, "count": len(invoices)}}


def _build_invoice_pdf(inv: Dict[str, Any]) -> BytesIO:
    """Render a B2B procurement invoice as a PDF with all order details."""
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm)
    styles = getSampleStyleSheet()

    brand = ParagraphStyle("brand", parent=styles["Normal"], fontSize=20, textColor=colors.HexColor("#059669"), spaceAfter=2)
    title = ParagraphStyle("title", parent=styles["Normal"], fontSize=13, textColor=colors.HexColor("#334155"), spaceAfter=2, tracking=2)
    label = ParagraphStyle("label", parent=styles["Normal"], fontSize=7.5, textColor=colors.HexColor("#94a3b8"), spaceAfter=1)
    body = ParagraphStyle("body", parent=styles["Normal"], fontSize=10, leading=14)
    body_sm = ParagraphStyle("body_sm", parent=body, fontSize=9, leading=13)
    right = ParagraphStyle("right", parent=body, alignment=TA_RIGHT)
    right_sm = ParagraphStyle("right_sm", parent=body_sm, alignment=TA_RIGHT)
    small = ParagraphStyle("small", parent=styles["Normal"], fontSize=8, textColor=colors.HexColor("#94a3b8"), leading=11)

    esc = lambda v: str(v or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    num = lambda v: f"₹{float(v or 0):,.2f}"
    dstr = lambda v: v.strftime("%d %b %Y") if isinstance(v, datetime) else (str(v or "—"))

    qty = float(inv.get("quantityKg") or 0)
    subtotal = float(inv.get("subtotal") or 0)
    delivery = float(inv.get("deliveryCharge") or 0)
    total = float(inv.get("total") or 0)
    rate = round(subtotal / qty, 2) if qty else 0
    paid = (inv.get("paymentStatus") or "").lower() == PAYMENT_PAID
    addr = inv.get("deliveryAddress") or {}
    if not isinstance(addr, dict):
        addr = {"address": addr}
    addr_text = ", ".join([
        str(addr.get(k)) for k in ("addressLine1", "addressLine2", "locality", "landmark")
        if str(addr.get(k) or "").strip()
    ]) or str(addr.get("address") or "—")
    city = f"{addr.get('city') or inv.get('deliveryCity') or '—'}"
    state_pin = " ".join([str(addr.get("state") or inv.get("deliveryState") or "—"),
                          str(addr.get("pincode") or "").strip()]).strip()

    flow: List[Any] = []

    # --- Header band ---
    head = Table([
        [
            Paragraph("AgriConnect", brand),
            Paragraph(
                f"{esc(inv.get('invoiceNumber') or '')}<br/>"
                f"<font size=9>{esc(inv.get('orderNumber') or '')}</font>",
                ParagraphStyle("hdr_r", parent=title, alignment=TA_RIGHT)),
        ],
    ], colWidths=[90 * mm, 84 * mm])
    head.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, 0), 1, colors.HexColor("#059669")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    flow.append(head)
    flow.append(Spacer(1, 2 * mm))
    flow.append(Paragraph(
        f"<font size=8>ISSUED: {esc(dstr(inv.get('issuedAt')))} &nbsp;&nbsp;|&nbsp;&nbsp; "
        f"ORDER STATUS: {esc((inv.get('status') or '—').replace('_', ' ').upper())}</font> &nbsp;&nbsp;",
        ParagraphStyle("subhead", parent=small, fontSize=8)))
    flow.append(Paragraph(
        "PAID" if paid else "UNPAID",
        ParagraphStyle("badge", parent=body, fontSize=9,
            textColor=colors.HexColor("#166534") if paid else colors.HexColor("#92400e"),
            backColor=colors.HexColor("#dcfce7") if paid else colors.HexColor("#fef3c7"))))
    flow.append(Spacer(1, 4 * mm))

    # --- Parties: Supplier | Buyer ---
    parties = Table([
        [Paragraph("SUPPLIER", label), Paragraph("BILL TO", label)],
        [Paragraph(f"<b>{esc(inv.get('farmName') or 'Farm')}</b>", body),
         Paragraph(f"<b>{esc(inv.get('buyerName') or 'Business')}</b>", body)],
        [Paragraph(esc(inv.get("farmerContact") or ""), body_sm),
         Paragraph(esc(inv.get("buyerContact") or ""), body_sm)],
        [Paragraph(esc(inv.get("farmerLocation") or ""), body_sm),
         Paragraph(esc(inv.get("buyerLocation") or ""), body_sm)],
    ], colWidths=[87 * mm, 87 * mm])
    parties.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
        ("BACKGROUND", (0, 0), (0, 0), colors.HexColor("#f0fdf4")),
        ("BACKGROUND", (1, 0), (1, 0), colors.HexColor("#f0fdf4")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    flow.append(parties)
    flow.append(Spacer(1, 5 * mm))

    # --- Order details ---
    flow.append(Paragraph("ORDER DETAILS", ParagraphStyle("sect", parent=label, textColor=colors.HexColor("#059669"), fontSize=9, spaceAfter=2)))
    detail_rows = [
        [Paragraph("Product", label), Paragraph(f"<b>{esc(inv.get('productName') or '—')}</b>", body),
         Paragraph("Quality Grade", label), Paragraph(f"<b>{esc(inv.get('qualityGrade') or '—')}</b>", body)],
        [Paragraph("Quantity", label), Paragraph(f"<b>{qty:g} kg</b>", body),
         Paragraph("Rate", label), Paragraph(f"<b>{num(rate)}/kg</b>", body)],
        [Paragraph("Delivery Method", label), Paragraph(f"<b>{esc((inv.get('deliveryMethod') or '—').replace('_', ' ').upper())}</b>", body),
         Paragraph("Payment Mode", label), Paragraph(f"<b>{esc(inv.get('paymentMode') or '—').upper()}</b>", body)],
        [Paragraph("Delivery City", label), Paragraph(f"<b>{esc(city)}</b>", body),
         Paragraph("Delivery State", label), Paragraph(f"<b>{esc(state_pin)}</b>", body)],
    ]
    details = Table(detail_rows, colWidths=[32 * mm, 55 * mm, 32 * mm, 55 * mm])
    details.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -2), 0.3, colors.HexColor("#e2e8f0")),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    flow.append(details)
    flow.append(Spacer(1, 2 * mm))
    flow.append(Paragraph("DELIVERY ADDRESS", label))
    flow.append(Paragraph(f"<b>{esc(addr_text)}</b>, <b>{esc(city)}</b> {esc(state_pin)}", body_sm))
    flow.append(Spacer(1, 5 * mm))

    # --- Line item ---
    items = Table([
        [Paragraph("<b>Product</b>", label), Paragraph("<b>Quality</b>", label),
         Paragraph("<b>Qty</b>", label), Paragraph("<b>Rate/kg</b>", label), Paragraph("<b>Amount</b>", label)],
        [esc(inv.get("productName") or "—"), esc(inv.get("qualityGrade") or "—"),
         f"{qty:g} kg", num(rate), num(subtotal)],
    ], colWidths=[50 * mm, 34 * mm, 26 * mm, 32 * mm, 32 * mm])
    items.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e2e8f0")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
        ("ALIGN", (2, 0), (2, -1), "RIGHT"),
        ("ALIGN", (3, 0), (4, -1), "RIGHT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    flow.append(items)
    flow.append(Spacer(1, 4 * mm))

    # --- Totals (right aligned, fixed width) ---
    totals = Table([
        [Paragraph("Subtotal", right), Paragraph(num(subtotal), right)],
        [Paragraph("Delivery charge", right), Paragraph(num(delivery), right)],
        [Paragraph("Taxes", right), Paragraph("₹0.00", right)],
        [Paragraph("<b>Total</b>", ParagraphStyle("gt", parent=right, fontSize=12, textColor=colors.HexColor("#059669"))),
         Paragraph(f"<b>{num(total)}</b>", ParagraphStyle("gtn", parent=right, fontSize=12, textColor=colors.HexColor("#059669")))],
    ], colWidths=[126 * mm, 48 * mm], hAlign="RIGHT")
    totals.setStyle(TableStyle([
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("LINEABOVE", (0, 3), (-1, 3), 1, colors.HexColor("#059669")),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    flow.append(totals)
    flow.append(Spacer(1, 6 * mm))

    # --- Notes ---
    notes = inv.get("notes")
    if notes:
        flow.append(Paragraph("NOTES", label))
        flow.append(Paragraph(esc(notes), body_sm))
        flow.append(Spacer(1, 5 * mm))

    flow.append(Paragraph(
        "This is a system-generated procurement invoice for record and accounting purposes. "
        "For queries contact support via the AgriConnect platform.",
        small))
    doc.build(flow)
    buf.seek(0)
    return buf


@router.get("/invoices/{order_id}/pdf")
async def download_b2b_invoice_pdf(order_id: str, current_user: dict = Depends(get_current_user)):
    """Download a B2B procurement invoice as a PDF."""
    if current_user.get("role") != "business":
        raise HTTPException(status_code=403, detail="Only business buyers have B2B invoices")

    try:
        oid = ObjectId(order_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Order not found")

    order = await order_repo.find_one({"_id": oid, "businessUserId": ObjectId(current_user["_id"]), "deletedAt": None})
    if not order:
        raise HTTPException(status_code=404, detail="Invoice not found")

    farmer = await farmer_repository.find_one({"userId": str(order.get("farmerId"))})
    farmer_user = await user_repository.get_by_id(str(order.get("farmerId")))
    business = await profile_repo.find_one({"userId": str(current_user["_id"])})
    qty = float(order.get("quantityKg") or 0)
    rate = float(order.get("pricePerKg") or 0)
    subtotal = round(qty * rate, 2)
    delivery = float(order.get("deliveryCharge") or 0)
    order_no = order.get("orderNumber") or f"B2B-{str(order['_id'])[-6:]}"
    inv = {
        "invoiceNumber": f"INV-{order_no.split('-')[-1]}",
        "orderNumber": order_no,
        "productName": order.get("productName"),
        "quantityKg": qty,
        "qualityGrade": order.get("qualityGrade"),
        "subtotal": subtotal,
        "deliveryCharge": round(delivery, 2),
        "total": round(subtotal + delivery, 2),
        "paymentStatus": order.get("paymentStatus") or PAYMENT_PENDING,
        "paymentMode": order.get("paymentMode"),
        "farmName": (farmer or {}).get("farmName") or "Farm",
        "farmerContact": (farmer_user or {}).get("phone") or (farmer or {}).get("contactNumber") or "",
        "farmerLocation": " · ".join(filter(None, [
            (farmer or {}).get("village") or (farmer or {}).get("addressLine1"),
            (farmer or {}).get("city") or (farmer or {}).get("district"),
        ])),
        "buyerName": (business or {}).get("companyName") or (current_user or {}).get("name") or "Business",
        "buyerContact": (current_user or {}).get("phone") or (current_user or {}).get("email") or "",
        "buyerLocation": " · ".join(filter(None, [
            (business or {}).get("city"),
            (business or {}).get("state"),
        ])),
        "deliveryAddress": order.get("deliveryAddress") or {},
        "deliveryCity": order.get("deliveryCity"),
        "deliveryState": order.get("deliveryState"),
        "deliveryMethod": order.get("deliveryMethod"),
        "status": order.get("status"),
        "notes": order.get("notes"),
        "issuedAt": order.get("completedAt") or order.get("startedAt"),
    }

    pdf = _build_invoice_pdf(inv)
    filename = f"{inv['invoiceNumber']}.pdf"
    return StreamingResponse(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ================== AI #1 - PRICE INTELLIGENCE ==================

class PriceRecommendationRequest(BaseModel):
    productName: str
    city: Optional[str] = None
    qualityGrade: Optional[str] = None


QUALITY_FACTORS = {
    "premium": 1.15,
    "organic": 1.10,
    "grade a": 1.0,
    "grade b": 0.90,
    "grade c": 0.85,
    "standard": 1.0,
}


def _quality_factor(grade: Optional[str]) -> float:
    return QUALITY_FACTORS.get((grade or "").strip().lower(), 1.0)


def _normalize_name(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-zA-Z0-9 ]", " ", (value or "").lower())).strip()


def _name_regex(value: str) -> List[Dict[str, Any]]:
    """Word-boundary regex per token so 'tomato' also matches 'tomatoes'."""
    patterns: List[Dict[str, Any]] = []
    for tok in _normalize_name(value).split():
        base = re.escape(tok)
        patterns.append({"$regex": rf"(^|[^a-z]){base}s?([^a-z]|$)", "$options": "i"})
    return patterns


def _match_filter(key: str, regexes: List[Dict[str, Any]]) -> Dict[str, Any]:
    if len(regexes) == 1:
        return {key: regexes[0]}
    return {key: {"$and": regexes}}


def _ts(value: Any) -> float:
    if isinstance(value, datetime):
        return value.timestamp()
    if value:
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
        except Exception:
            return 0
    return 0


def _percentile(sorted_values: List[float], q: float) -> float:
    if not sorted_values:
        return 0.0
    idx = (len(sorted_values) - 1) * q
    lo = int(idx)
    hi = min(lo + 1, len(sorted_values) - 1)
    frac = idx - lo
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * frac


def _iqr_bounds(prices: List[float]) -> Tuple[float, float]:
    """1.5x IQR outlier bounds; falls back to min/max for tiny samples."""
    if len(prices) < 4:
        return (min(prices), max(prices)) if prices else (0.0, 0.0)
    s = sorted(prices)
    q1, q3 = _percentile(s, 0.25), _percentile(s, 0.75)
    iqr = q3 - q1
    return (q1 - 1.5 * iqr, q3 + 1.5 * iqr)


def _weighted_percentile(pairs: List[Tuple[float, float]], q: float) -> float:
    """pairs = [(price, weight)] sorted ascending by price."""
    if not pairs:
        return 0.0
    total = sum(w for _, w in pairs)
    if total <= 0:
        return pairs[0][0]
    target = q * total
    acc = 0.0
    for price, w in pairs:
        acc += w
        if acc >= target:
            return price
    return pairs[-1][0]


def _time_weight(ts: float, now: float, half_life_days: float = 30.0) -> float:
    if ts <= 0:
        return 0.5  # unknown date -> neutral weight
    age_days = max(0.0, (now - ts) / 86400.0)
    return max(0.1, 0.5 ** (age_days / half_life_days))


def _price_trend(rows: List[Dict[str, Any]]) -> str:
    if len(rows) < 4:
        return "n/a"
    s = sorted(rows, key=lambda r: r["ts"])
    mid = len(s) // 2
    older = [r["price"] for r in s[:mid]]
    newer = [r["price"] for r in s[mid:]]
    if not older or not newer:
        return "n/a"
    avg_older = sum(older) / len(older)
    avg_newer = sum(newer) / len(newer)
    if avg_newer > avg_older * 1.05:
        return "rising"
    if avg_newer < avg_older * 0.95:
        return "falling"
    return "stable"


def _confidence_label(count: int, has_orders: bool) -> Tuple[str, int]:
    if count >= 10 and has_orders:
        return ("high", 87)
    if count >= 4:
        return ("medium", 64)
    if count > 0:
        return ("low", 42)
    return ("none", 0)


def _empty_price_summary(name: str, city_matched: bool) -> Dict[str, Any]:
    return {
        "productName": name,
        "source": "none",
        "count": 0,
        "sampleSize": 0,
        "minPerKg": None, "maxPerKg": None, "avgPerKg": None,
        "medianPerKg": None, "p25PerKg": None, "p75PerKg": None,
        "recommendedMin": None, "recommendedMax": None,
        "suggestedPricePerKg": None,
        "confidence": "none",
        "confidenceScore": 0,
        "trend": "n/a",
        "cityMatched": city_matched,
        "sourcesUsed": {"orders": 0, "quotes": 0, "marketplace": 0},
        "reasons": [],
        "notes": "Not enough price data yet. Publish a budget range and farmers will bid.",
    }


@router.post("/ai/price-recommendation")
async def price_recommendation(
    data: PriceRecommendationRequest,
    current_user: dict = Depends(get_current_user),
):
    """AI #1 - weighted multi-source price intelligence.

    Blends settled B2B orders (authoritative, quantity-weighted), farmer quotes
    (recency-weighted) and marketplace listings (lowest trust) into a recommended
    RFQ price band, adjusted for quality grade, location and outliers.
    """
    name = (data.productName or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="productName is required")
    city_key = (data.city or "").strip().lower()
    req_factor = _quality_factor(data.qualityGrade)
    now = datetime.utcnow().timestamp()
    regexes = _name_regex(name)

    orders: List[Dict[str, Any]] = []
    offers: List[Dict[str, Any]] = []
    products: List[Dict[str, Any]] = []
    rfqs_by_id: Dict[str, Dict[str, Any]] = {}
    if regexes:
        orders = await order_repo.find_many(
            {**_match_filter("productName", regexes), "deletedAt": None, "status": {"$ne": ORDER_CANCELLED}},
            sort=[("startedAt", -1)],
            limit=200,
        ) or []
        offers = await offer_repo.find_many(
            {**_match_filter("productName", regexes), "deletedAt": None},
            sort=[("createdAt", -1)],
            limit=200,
        ) or []
        rfq_ids = [o.get("rfqId") for o in offers if o.get("rfqId")]
        if rfq_ids:
            for rfq in await rfq_repo.find_many({"_id": {"$in": rfq_ids}}, limit=200) or []:
                rfqs_by_id[str(rfq["_id"])] = rfq
        products = await product_repository.find_many(
            {**_match_filter("name", regexes), "isActive": True, "deletedAt": None},
            limit=200,
        ) or []

    def _loc_weight(r_city: str, r_state: str) -> Tuple[float, bool]:
        if not city_key:
            return 1.0, False
        if city_key in r_city or r_city in city_key or (r_state and city_key in r_state):
            return 1.0, True
        return 0.5, False

    order_rows: List[Dict[str, Any]] = []
    quote_rows: List[Dict[str, Any]] = []
    prod_rows: List[Dict[str, Any]] = []

    for o in orders:
        price = float(o.get("pricePerKg") or 0)
        if price <= 0:
            continue
        grade = _quality_factor(o.get("qualityGrade") or "standard")
        adj = price * req_factor / grade
        w, matched = _loc_weight((o.get("deliveryCity") or "").lower(), (o.get("deliveryState") or "").lower())
        weight = float(o.get("quantityKg") or 1) * _time_weight(_ts(o.get("startedAt")), now) * w
        order_rows.append({"price": adj, "weight": weight, "ts": _ts(o.get("startedAt")), "loc_match": matched})

    for o in offers:
        price = float(o.get("pricePerKg") or 0)
        if price <= 0:
            continue
        rfq = rfqs_by_id.get(str(o.get("rfqId")))
        grade = _quality_factor((rfq or {}).get("qualityGrade") or "standard")
        adj = price * req_factor / grade
        w, matched = _loc_weight(((rfq or {}).get("deliveryCity") or "").lower(), ((rfq or {}).get("deliveryState") or "").lower())
        weight = 0.6 * _time_weight(_ts(o.get("createdAt")), now) * w
        quote_rows.append({"price": adj, "weight": weight, "ts": _ts(o.get("createdAt")), "loc_match": matched})

    for p in products:
        price = float(p.get("bulkPrice") or p.get("price") or 0)
        if price <= 0:
            continue
        adj = price * req_factor  # marketplace treated as Standard grade
        w, matched = _loc_weight((p.get("city") or "").lower(), (p.get("state") or "").lower())
        prod_rows.append({"price": adj, "weight": 0.3 * w, "ts": 0, "loc_match": matched})

    all_rows = order_rows + quote_rows + prod_rows
    if not all_rows:
        return {"success": True, "data": _empty_price_summary(name, False)}

    # Remove IQR outliers so one extreme quote cannot skew the band.
    lo_b, hi_b = _iqr_bounds([r["price"] for r in all_rows])
    kept = [r for r in all_rows if lo_b <= r["price"] <= hi_b] or all_rows

    city_matched = bool(city_key) and any(r["loc_match"] for r in kept)
    pairs = sorted((r["price"], r["weight"]) for r in kept)

    weighted_median = _weighted_percentile(pairs, 0.5)
    weighted_p25 = _weighted_percentile(pairs, 0.25)
    weighted_p75 = _weighted_percentile(pairs, 0.75)
    total_weight = sum(w for _, w in pairs) or 1.0
    avg = sum(p * w for p, w in pairs) / total_weight
    low, high = pairs[0][0], pairs[-1][0]

    rec_min = round(max(weighted_p25, weighted_median * 0.9), 2)
    rec_max = round(min(weighted_p75, weighted_median * 1.1), 2)
    if rec_min > rec_max:
        rec_min, rec_max = round(weighted_median * 0.95, 2), round(weighted_median * 1.05, 2)

    sources_used = {"orders": len(order_rows), "quotes": len(quote_rows), "marketplace": len(prod_rows)}
    n_sources = sum(1 for v in sources_used.values() if v > 0)
    if n_sources > 1:
        source = "blended"
    elif order_rows:
        source = "orders"
    elif quote_rows:
        source = "quotes"
    else:
        source = "marketplace"

    confidence, confidence_score = _confidence_label(len(kept), bool(order_rows))
    trend = _price_trend([{"price": r["price"], "ts": r["ts"]} for r in order_rows + quote_rows])

    if source == "blended":
        notes = (
            f"Blend of {sources_used['orders']} settled order(s), {sources_used['quotes']} quote(s) "
            f"and {sources_used['marketplace']} marketplace listing(s). Aim for the ₹{rec_min}–₹{rec_max}/kg band."
        )
    elif source == "orders":
        notes = f"Based on {sources_used['orders']} settled B2B order(s) — real negotiated prices. Aim for the ₹{rec_min}–₹{rec_max}/kg band."
    elif source == "quotes":
        notes = f"Based on {sources_used['quotes']} farmer quote(s). Quotes are asking prices, so expect final deals slightly below the band."
    else:
        notes = f"Based on {sources_used['marketplace']} active marketplace listing(s). Listings reflect asking price, not negotiated rates."

    reasons = [
        f"Market range ₹{round(low, 2)}–₹{round(high, 2)}/kg",
        f"Recent price trend: {trend}",
        f"Quality: {(data.qualityGrade or 'Standard')}",
        "Weighted by quantity and recency",
    ]
    if city_matched:
        reasons.append("Local market (your city) weighted higher")
    if source == "orders":
        reasons.append("Based on settled order prices")
    elif source == "blended":
        reasons.append("Settled orders dominate the estimate")

    return {"success": True, "data": {
        "productName": name,
        "source": source,
        "count": len(all_rows),
        "sampleSize": len(kept),
        "minPerKg": round(low, 2),
        "maxPerKg": round(high, 2),
        "avgPerKg": round(avg, 2),
        "medianPerKg": round(weighted_median, 2),
        "p25PerKg": round(weighted_p25, 2),
        "p75PerKg": round(weighted_p75, 2),
        "recommendedMin": rec_min,
        "recommendedMax": rec_max,
        "suggestedPricePerKg": round(weighted_median, 1),
        "confidence": confidence,
        "confidenceScore": confidence_score,
        "trend": trend,
        "cityMatched": city_matched,
        "sourcesUsed": sources_used,
        "reasons": reasons,
        "notes": notes,
    }}


# ================== AI DEMAND FORECAST (business buyer) ==================

@router.get("/ai/demand-forecast")
async def demand_forecast(current_user: dict = Depends(get_current_user)):
    """Expected weekly demand for the buyer's products from recent B2B orders."""
    if current_user.get("role") != "business":
        raise HTTPException(status_code=403, detail="Only business buyers can view demand forecasts")

    orders = await order_repo.find_many(
        {"businessUserId": ObjectId(current_user["_id"]), "deletedAt": None},
        sort=[("startedAt", -1)],
        limit=500,
    )
    orders = orders or []

    cutoff = datetime.utcnow() - timedelta(days=60)
    by_product: Dict[str, List[float]] = {}
    for o in orders:
        started = o.get("startedAt")
        if started:
            try:
                if isinstance(started, datetime):
                    ts = started
                else:
                    ts = datetime.fromisoformat(str(started).replace("Z", "+00:00"))
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                if ts < cutoff.replace(tzinfo=timezone.utc):
                    continue
            except Exception:
                pass
        name = (o.get("productName") or "").strip()
        qty = float(o.get("quantityKg") or 0)
        if name and qty > 0:
            by_product.setdefault(name, []).append(qty)

    items = []
    for name, qtys in by_product.items():
        total = sum(qtys)
        weekly = round(total / 8.57, 1)  # ~60 days ≈ 8.57 weeks
        avg_order = round(total / len(qtys), 1)
        level = "HIGH" if total >= 100 else ("MEDIUM" if total >= 40 else "LOW")
        if len(qtys) >= 2 and qtys[-1] > qtys[0] * 1.1:
            trend = "rising"
        elif len(qtys) >= 2 and qtys[-1] < qtys[0] * 0.9:
            trend = "falling"
        else:
            trend = "stable"
        rec = {
            "HIGH": "Lock in recurring supply contracts early to avoid shortages.",
            "MEDIUM": "Maintain current supply arrangement and review monthly.",
            "LOW": "Keep flexible spot purchasing; avoid long-term commitments.",
        }[level]
        items.append({
            "productName": name,
            "orderCount": len(qtys),
            "totalKg": round(total, 1),
            "avgKgPerOrder": avg_order,
            "expectedKgPerWeek": weekly,
            "level": level,
            "trend": trend,
            "recommendation": rec,
        })
    items.sort(key=lambda x: x["expectedKgPerWeek"], reverse=True)
    return {"success": True, "data": {"items": items, "count": len(items)}}