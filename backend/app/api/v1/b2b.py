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
import os

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
from app.services.payment_service import PaymentService
from app.services.order_service import geocode_address
from app.services.notification_service import NotificationService
from app.schemas.notification import NotificationType, NotificationPriority
from app.services.bulk_order_service import haversine_km, _coords, _farmer_location
from app.database.mongodb import MongoDB

logger = logging.getLogger(__name__)
router = APIRouter()

profile_repo = BaseRepository("business_profiles")
rfq_repo = BaseRepository("b2b_rfqs")
offer_repo = BaseRepository("b2b_offers")
order_repo = BaseRepository("b2b_orders")
rating_repo = BaseRepository("b2b_ratings")
farmer_profile_repo = BaseRepository("farmer_profiles")
warehouse_repo = BaseRepository("warehouses")

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
ORDER_READY_FOR_PICKUP = "ready_for_pickup"
ORDER_PICKED_UP = "picked_up"
ORDER_WAREHOUSE_RECEIVED = "warehouse_received"
ORDER_TRANSFER_IN_TRANSIT = "transfer_in_transit"
ORDER_DESTINATION_RECEIVED = "destination_warehouse_received"
ORDER_FLOW = [
    ORDER_CONFIRMED,
    ORDER_PREPARING,
    ORDER_QUALITY_CHECK,
    ORDER_READY_FOR_PICKUP,
    ORDER_PICKED_UP,
    ORDER_WAREHOUSE_RECEIVED,
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


# Configurable B2B delivery pricing (INR). Override with backend environment variables.
B2B_DELIVERY_BASE_FEE = max(0.0, float(os.getenv("B2B_DELIVERY_BASE_FEE", "40")))
B2B_DELIVERY_RATE_PER_KM = max(0.0, float(os.getenv("B2B_DELIVERY_RATE_PER_KM", "8")))
B2B_DELIVERY_RATE_PER_KG = max(0.0, float(os.getenv("B2B_DELIVERY_RATE_PER_KG", "1.5")))


def _calculate_b2b_delivery_fee(distance_km: float, quantity_kg: float) -> float:
    """Distance + shipment-weight pricing, in INR, rounded to paise."""
    distance_component = max(0.0, distance_km) * B2B_DELIVERY_RATE_PER_KM
    weight_component = max(0.0, quantity_kg) * B2B_DELIVERY_RATE_PER_KG
    return round(B2B_DELIVERY_BASE_FEE + distance_component + weight_component, 2)


def _distance_km(farmer: Optional[Dict[str, Any]], rfq: Dict[str, Any]) -> Optional[float]:
    f_loc = _farmer_location(farmer or {})
    r_loc = _coords(rfq.get("deliveryLocation"))
    if f_loc and r_loc:
        return round(haversine_km(r_loc[1], r_loc[0], f_loc[1], f_loc[0]), 1)
    return None


def _location_coords_from_doc(doc: Dict[str, Any]) -> Optional[Tuple[float, float]]:
    """Return (longitude, latitude) from supported GeoJSON-like location fields."""
    for key in ("location", "farmLocation", "coordinates", "geoLocation"):
        value = doc.get(key)
        if isinstance(value, dict):
            coords = value.get("coordinates")
            if isinstance(coords, (list, tuple)) and len(coords) >= 2:
                try:
                    return float(coords[0]), float(coords[1])
                except (TypeError, ValueError):
                    continue
            lat = value.get("latitude", value.get("lat"))
            lng = value.get("longitude", value.get("lng", value.get("lon")))
            if lat is not None and lng is not None:
                try:
                    return float(lng), float(lat)
                except (TypeError, ValueError):
                    continue
        if isinstance(value, (list, tuple)) and len(value) >= 2:
            try:
                return float(value[0]), float(value[1])
            except (TypeError, ValueError):
                continue
    lat = doc.get("latitude", doc.get("lat"))
    lng = doc.get("longitude", doc.get("lng", doc.get("lon")))
    if lat is not None and lng is not None:
        try:
            return float(lng), float(lat)
        except (TypeError, ValueError):
            return None
    return None


async def _warehouse_route_for_b2b(
    farmer: Optional[Dict[str, Any]], rfq: Dict[str, Any]
) -> Dict[str, Any]:
    """Select nearest active source/destination warehouses and price each route leg."""
    farm_coords = _location_coords_from_doc(farmer or {})
    buyer_coords = _location_coords_from_doc({"location": rfq.get("deliveryLocation")}) or _location_coords_from_doc(rfq)
    if not farm_coords or not buyer_coords:
        return {"available": False, "reason": "Farm or business delivery coordinates are missing."}

    warehouses = await warehouse_repo.find_many({"deletedAt": None}, limit=500)
    candidates = []
    for warehouse in warehouses:
        status = str(warehouse.get("status") or warehouse.get("operationalStatus") or "active").lower()
        if status not in ("active", "operational", "enabled", "open"):
            continue
        coords = _location_coords_from_doc(warehouse)
        if not coords:
            continue
        candidates.append((warehouse, coords))
    if not candidates:
        return {"available": False, "reason": "No active warehouse with valid coordinates is configured."}

    source = min(candidates, key=lambda row: haversine_km(farm_coords[1], farm_coords[0], row[1][1], row[1][0]))
    destination = min(candidates, key=lambda row: haversine_km(buyer_coords[1], buyer_coords[0], row[1][1], row[1][0]))
    source_doc, source_coords = source
    destination_doc, destination_coords = destination

    farm_to_source = round(haversine_km(farm_coords[1], farm_coords[0], source_coords[1], source_coords[0]), 2)
    source_to_destination = round(haversine_km(source_coords[1], source_coords[0], destination_coords[1], destination_coords[0]), 2)
    destination_to_buyer = round(haversine_km(destination_coords[1], destination_coords[0], buyer_coords[1], buyer_coords[0]), 2)
    # Do not charge a warehouse-to-warehouse leg when both route endpoints select the same warehouse.
    if str(source_doc.get("_id")) == str(destination_doc.get("_id")):
        source_to_destination = 0.0
    return {
        "available": True,
        "sourceWarehouseId": str(source_doc.get("_id")),
        "sourceWarehouseName": source_doc.get("name") or source_doc.get("warehouseName") or source_doc.get("code") or "Source Warehouse",
        "destinationWarehouseId": str(destination_doc.get("_id")),
        "destinationWarehouseName": destination_doc.get("name") or destination_doc.get("warehouseName") or destination_doc.get("code") or "Destination Warehouse",
        "farmToSourceKm": farm_to_source,
        "warehouseTransferKm": source_to_destination,
        "destinationToBuyerKm": destination_to_buyer,
    }


def _calculate_warehouse_delivery_fee(route: Dict[str, Any], quantity_kg: float) -> Dict[str, Any]:
    """Price the three warehouse-based legs using configurable INR rates."""
    pickup = round(route["farmToSourceKm"] * B2B_DELIVERY_RATE_PER_KM, 2)
    transfer = round(route["warehouseTransferKm"] * B2B_DELIVERY_RATE_PER_KM, 2)
    final_delivery = round(route["destinationToBuyerKm"] * B2B_DELIVERY_RATE_PER_KM, 2)
    weight = round(max(0.0, quantity_kg) * B2B_DELIVERY_RATE_PER_KG, 2)
    handling = B2B_DELIVERY_BASE_FEE
    total = round(pickup + transfer + final_delivery + weight + handling, 2)
    return {
        "farmPickupFee": pickup,
        "warehouseTransferFee": transfer,
        "finalDeliveryFee": final_delivery,
        "weightCharge": weight,
        "handlingFee": handling,
        "total": total,
    }


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



async def _cooperative_context(user_id: str) -> Optional[Dict[str, Any]]:
    coop_repo = BaseRepository("cooperatives")
    member_repo = BaseRepository("cooperative_members")
    membership = await member_repo.find_one({"userId": ObjectId(user_id), "role": "manager", "status": "active", "deletedAt": None})
    if not membership:
        return None
    return await coop_repo.find_one({"_id": membership.get("cooperativeId"), "status": "active", "deletedAt": None})


async def _cooperative_can_supply(coop_id: ObjectId, product_name: str) -> Dict[str, Any]:
    member_repo = BaseRepository("cooperative_members")
    members = await member_repo.find_many({"cooperativeId": coop_id, "status": "active", "deletedAt": None}, limit=500)
    name_key = (product_name or "").strip().lower()
    rows = []
    total = 0.0
    for member in members:
        farmer_id = member.get("userId")
        if not farmer_id:
            continue
        products = await product_repository.get_by_farmer(str(farmer_id), limit=500)
        for product in products:
            product_name_key = (product.get("name") or "").strip().lower()
            if not name_key or not (product_name_key == name_key or name_key in product_name_key or product_name_key in name_key):
                continue
            stock = await InventoryService.get_available_stock(str(product["_id"]))
            if stock > 0:
                rows.append({"farmerId": str(farmer_id), "productId": str(product["_id"]), "productName": product.get("name"), "availableKg": float(stock)})
                total += float(stock)
    return {"canSupply": total > 0, "availableKg": round(total, 2), "rows": rows}


def _build_cooperative_allocations(rows: List[Dict[str, Any]], quantity: float) -> List[Dict[str, Any]]:
    remaining = float(quantity)
    allocations = []
    for row in sorted(rows, key=lambda x: -float(x.get("availableKg") or 0)):
        if remaining <= 0:
            break
        take = min(remaining, float(row.get("availableKg") or 0))
        if take > 0:
            allocations.append({"farmerId": row["farmerId"], "productId": row["productId"], "productName": row.get("productName"), "quantityKg": round(take, 2)})
            remaining -= take
    return allocations if remaining <= 0.001 else []

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
    # Calculate delivery using Farm -> Source Warehouse -> Destination Warehouse -> Business.
    # Never silently revert to the incorrect direct farm-to-business distance.
    farmer = await farmer_repository.find_one({"userId": offer.get("farmerId")})
    if not farmer:
        farmer = await farmer_repository.find_one({"userId": ObjectId(str(offer.get("farmerId")))})
    route = await _warehouse_route_for_b2b(farmer, rfq)
    if not route.get("available"):
        raise HTTPException(status_code=400, detail=f"Cannot calculate warehouse-based delivery fee: {route.get('reason')}")
    distance_km = round(
        float(route["farmToSourceKm"]) + float(route["warehouseTransferKm"]) + float(route["destinationToBuyerKm"]), 2
    )
    fee_breakdown = _calculate_warehouse_delivery_fee(route, qty)
    delivery_charge = fee_breakdown["total"]
    product_subtotal = round(float(qty) * float(offer.get("pricePerKg") or 0), 2)
    # Only apply tax/other charges when explicitly configured.
    configured_tax_rate = offer.get("taxRate")
    if configured_tax_rate is None:
        configured_tax_rate = offer.get("taxPercent")
    if configured_tax_rate is None:
        configured_tax_rate = rfq.get("taxRate")
    if configured_tax_rate is None:
        configured_tax_rate = rfq.get("taxPercent", 0)
    tax_rate = max(0.0, float(configured_tax_rate or 0))
    tax_amount = round(product_subtotal * tax_rate / 100, 2)
    other_charges = max(0.0, float(offer.get("otherCharges", rfq.get("otherCharges", 0)) or 0))
    total = round(product_subtotal + delivery_charge + tax_amount + other_charges, 2)
    order = {
        "orderNumber": await _next_number("B2B", order_repo),
        "rfqId": rfq["_id"],
        "businessUserId": rfq.get("businessUserId"),
        "businessProfileId": rfq.get("businessProfileId"),
        "farmerId": offer.get("farmerId"),
        "offerId": offer["_id"],
        "productName": offer.get("productName"),
        "category": rfq.get("category"),
        "qualityGrade": offer.get("qualityGrade") or rfq.get("qualityGrade"),
        "quantityKg": round(float(qty), 2),
        "pricePerKg": float(offer.get("pricePerKg") or 0),
        "productSubtotal": product_subtotal,
        "deliveryCharge": delivery_charge,
        "deliveryDistanceKm": distance_km,
        "deliveryPricing": {
            "baseFee": B2B_DELIVERY_BASE_FEE,
            "ratePerKm": B2B_DELIVERY_RATE_PER_KM,
            "ratePerKg": B2B_DELIVERY_RATE_PER_KG,
            "distanceComponent": round(distance_km * B2B_DELIVERY_RATE_PER_KM, 2),
            "weightComponent": round(float(qty) * B2B_DELIVERY_RATE_PER_KG, 2),
            "route": route,
            "breakdown": fee_breakdown,
        },
        "sourceWarehouseId": route["sourceWarehouseId"],
        "sourceWarehouseName": route["sourceWarehouseName"],
        "destinationWarehouseId": route["destinationWarehouseId"],
        "destinationWarehouseName": route["destinationWarehouseName"],
        "taxRate": tax_rate,
        "taxAmount": tax_amount,
        "otherCharges": round(other_charges, 2),
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
        # Match open status case-insensitively in MongoDB so legacy values like
        # "Open" / "OPEN" are included without fetching closed RFQs first.
        match = {
            "status": {"$regex": f"^{RFQ_OPEN}$", "$options": "i"},
            "deletedAt": None,
        }
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
            # Farmers should only bid on open requests, but compare normalized
            # values so legacy records with OPEN/Open status remain visible.
            if str(r.get("status") or "").strip().lower() != str(RFQ_OPEN).strip().lower():
                continue
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
    qualityGrade: Optional[str] = None
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
    cooperative = await _cooperative_context(str(current_user["_id"]))
    cooperative_supply = await _cooperative_can_supply(cooperative["_id"], rfq.get("productName")) if cooperative else {"canSupply": False, "availableKg": 0, "rows": []}
    if cooperative and cooperative_supply["availableKg"] >= float(qty):
        supply_allocations = _build_cooperative_allocations(cooperative_supply["rows"], float(qty))
    else:
        individual_supply = await _farmer_can_supply(str(current_user["_id"]), rfq.get("productName"))
        if float(qty) > float(individual_supply["availableKg"]):
            raise HTTPException(status_code=400, detail="Requested offer quantity exceeds your available supply")
        supply_allocations = [{"farmerId": str(current_user["_id"]), "productId": individual_supply.get("productId"), "productName": rfq.get("productName"), "quantityKg": float(qty)}]
    if not supply_allocations:
        raise HTTPException(status_code=400, detail="Unable to allocate the requested quantity from available supply")
    offer = {
        "rfqId": ObjectId(rfq_id),
        "rfqNumber": rfq.get("rfqNumber"),
        "businessUserId": rfq.get("businessUserId"),
        "farmerId": ObjectId(current_user["_id"]),
        "cooperativeId": cooperative["_id"] if cooperative and len(supply_allocations) > 1 else None,
        "supplyAllocations": supply_allocations,
        "productName": rfq.get("productName"),
        "pricePerKg": data.pricePerKg,
        "qualityGrade": (data.qualityGrade or "").strip() or None,
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
        if not farmer:
            try:
                farmer = await farmer_repository.find_one({"userId": ObjectId(o["farmerId"])})
            except Exception:
                farmer = None
        qty = float(o.get("availableQuantityKg") or o.get("minOrderKg") or 0)
        route = await _warehouse_route_for_b2b(farmer, rfq)
        distance_km = None
        fee_breakdown = None
        if route.get("available"):
            distance_km = round(
                float(route["farmToSourceKm"]) + float(route["warehouseTransferKm"]) + float(route["destinationToBuyerKm"]), 2
            )
            fee_breakdown = _calculate_warehouse_delivery_fee(route, qty)
        o["deliveryDistanceKm"] = distance_km
        o["deliveryFeeEstimate"] = fee_breakdown["total"] if fee_breakdown else None
        o["deliveryPricing"] = {
            "baseFee": B2B_DELIVERY_BASE_FEE,
            "ratePerKm": B2B_DELIVERY_RATE_PER_KM,
            "ratePerKg": B2B_DELIVERY_RATE_PER_KG,
            "route": route if route.get("available") else None,
            "breakdown": fee_breakdown,
        }
        o["deliveryFeeRequiresLocation"] = not route.get("available")
        o["deliveryFeeUnavailableReason"] = route.get("reason") if not route.get("available") else None
        o["totalPrice"] = round(
            float(o.get("pricePerKg") or 0) * qty + float(o["deliveryFeeEstimate"] or 0), 2
        ) if fee_breakdown else None
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


class OfferBatchItem(BaseModel):
    offerId: str
    quantityKg: float = Field(..., gt=0)


class OfferBatchAccept(BaseModel):
    items: List[OfferBatchItem] = Field(..., min_length=1, max_length=50)
    idempotencyKey: str = Field(..., min_length=8, max_length=128)
    deliveryMethod: Optional[str] = "dedicated_transport"
    paymentMode: Optional[str] = "cod"
    advanceAmount: Optional[float] = Field(0, ge=0)
    deliveryCharge: Optional[float] = Field(None, ge=0)
    notes: Optional[str] = None


@router.post("/offers/accept-batch")
async def accept_offer_batch(
    data: OfferBatchAccept,
    current_user: dict = Depends(get_current_user),
):
    """Atomically accept multiple offers for a single RFQ.

    Every write (RFQ quantity reservation, offer status changes, orders and
    idempotency record) runs in one MongoDB transaction. A retry with the same
    key returns the committed result rather than creating duplicate orders.
    Requires MongoDB replica set/sharded-cluster transaction support.
    """
    if current_user.get("role") != "business":
        raise HTTPException(status_code=403, detail="Only business accounts can accept offers")
    if len({item.offerId for item in data.items}) != len(data.items):
        raise HTTPException(status_code=400, detail="Each offer can only appear once in a batch")
    try:
        offer_ids = [ObjectId(item.offerId) for item in data.items]
    except Exception:
        raise HTTPException(status_code=404, detail="One or more offer IDs are invalid")

    db = MongoDB.db
    client = MongoDB.client
    if db is None or client is None:
        raise HTTPException(status_code=503, detail="Database is not ready")
    batches = db["b2b_acceptance_batches"]
    existing_batch = await batches.find_one({
        "businessUserId": ObjectId(current_user["_id"]),
        "idempotencyKey": data.idempotencyKey,
    })
    if existing_batch:
        prior_items = sorted(
            [(str(row.get("offerId")), round(float(row.get("quantityKg") or 0), 2)) for row in existing_batch.get("items", [])]
        )
        incoming_items = sorted([(item.offerId, round(float(item.quantityKg), 2)) for item in data.items])
        if prior_items != incoming_items:
            raise HTTPException(status_code=409, detail="This idempotency key was already used for a different selection. Keep the original selection to retry, or change the selection and submit again.")
        stored_orders = await order_repo.collection.find({"_id": {"$in": existing_batch.get("orderIds", [])}}).to_list(length=50)
        for order in stored_orders:
            order["id"] = str(order["_id"])
            order["offerId"] = str(order.get("offerId"))
        return {"success": True, "data": {"orders": stored_orders, "batchId": str(existing_batch["_id"]), "replayed": True}, "message": "Previously committed batch returned"}

    # All offers must belong to the same RFQ so the balance is reserved as one unit.
    offers = await offer_repo.collection.find({"_id": {"$in": offer_ids}, "deletedAt": None}).to_list(length=50)
    if len(offers) != len(offer_ids):
        raise HTTPException(status_code=404, detail="One or more offers no longer exist")
    rfq_ids = {str(offer.get("rfqId")) for offer in offers}
    if len(rfq_ids) != 1:
        raise HTTPException(status_code=400, detail="All selected offers must belong to the same RFQ")
    rfq_id = offers[0]["rfqId"]
    rfq = await rfq_repo.find_one({"_id": rfq_id, "deletedAt": None})
    if not rfq:
        raise HTTPException(status_code=404, detail="RFQ not found")
    if str(rfq.get("businessUserId")) != str(current_user["_id"]):
        raise HTTPException(status_code=403, detail="Not your RFQ")
    await _maybe_close_rfq(rfq)
    if rfq.get("status") not in (RFQ_OPEN, RFQ_AWARDED):
        raise HTTPException(status_code=409, detail="RFQ is closed or cancelled")
    offers_by_id = {str(offer["_id"]): offer for offer in offers}
    requested_total = 0.0
    order_specs = []
    for item in data.items:
        offer = offers_by_id[item.offerId]
        if offer.get("status") != OFFER_PENDING:
            raise HTTPException(status_code=409, detail=f"Offer {item.offerId} is no longer pending")
        available = float(offer.get("availableQuantityKg") or offer.get("minOrderKg") or _rfq_quantity(rfq))
        qty = round(float(item.quantityKg), 2)
        if qty <= 0 or qty - available > 0.001:
            raise HTTPException(status_code=400, detail=f"Requested quantity exceeds offer availability for {item.offerId} (maximum {available:g} kg)")
        requested_total += qty
        accept_data = OfferAccept(
            quantityKg=qty,
            deliveryMethod=data.deliveryMethod,
            paymentMode=data.paymentMode,
            advanceAmount=data.advanceAmount,
            deliveryCharge=data.deliveryCharge,
            notes=data.notes,
        )
        order_specs.append((offer, qty, accept_data))
    total_qty = _rfq_quantity(rfq)
    if rfq.get("recurring") and len(order_specs) != 1:
        raise HTTPException(status_code=400, detail="Recurring RFQs can only be accepted from one offer at a time")
    if requested_total <= 0:
        raise HTTPException(status_code=400, detail="Batch quantity must be greater than zero")

    now = datetime.utcnow()
    order_docs = []
    for offer, qty, accept_data in order_specs:
        order = await _build_order(rfq, offer, qty, accept_data)
        order["batchIdempotencyKey"] = data.idempotencyKey
        order["createdAt"] = now
        order_docs.append(order)

    # MongoDB multi-document transactions require a replica set. Detect a standalone
    # deployment early and return a precise setup message instead of the misleading
    # generic "batch outcome could not be confirmed" error.
    try:
        hello = await db.command("hello")
    except Exception as exc:
        logger.exception("Could not inspect MongoDB transaction capability")
        raise HTTPException(status_code=503, detail="Could not verify MongoDB transaction support. Check the MongoDB connection and logs.") from exc
    if not hello.get("setName") and not hello.get("msg") == "isdbgrid":
        raise HTTPException(
            status_code=503,
            detail=(
                "B2B offer acceptance requires MongoDB transactions, but this MongoDB "
                "server is running standalone. Configure MongoDB as a single-node replica "
                "set (for local development) or connect to a replica set/sharded cluster, "
                "then restart the backend. No batch acceptance was started."
            ),
        )

    session = await client.start_session()
    try:
        async with session:
            async with session.start_transaction():
                # Recheck ownership, RFQ status, and available balance inside the transaction.
                live_rfq = await rfq_repo.collection.find_one(
                    {"_id": rfq_id, "businessUserId": ObjectId(current_user["_id"]), "status": {"$in": [RFQ_OPEN, RFQ_AWARDED]}, "deletedAt": None},
                    session=session,
                )
                if not live_rfq:
                    raise HTTPException(status_code=409, detail="RFQ is no longer open for acceptance")
                live_accepted = float(live_rfq.get("acceptedQuantityKg") or 0)
                if live_accepted + requested_total > total_qty + 1e-9:
                    raise HTTPException(status_code=409, detail=f"RFQ balance changed. Remaining quantity: {max(0, total_qty-live_accepted):g} kg")
                reserve = await rfq_repo.collection.update_one(
                    {"_id": rfq_id, "businessUserId": ObjectId(current_user["_id"]), "status": {"$in": [RFQ_OPEN, RFQ_AWARDED]},
                     "$expr": {"$lte": [{"$add": [{"$ifNull": ["$acceptedQuantityKg", 0]}, requested_total]}, total_qty]}},
                    {"$inc": {"acceptedQuantityKg": requested_total},
                     "$push": {"awardedOfferIds": {"$each": offer_ids}},
                     "$set": {"updatedAt": now}},
                    session=session,
                )
                if reserve.modified_count != 1:
                    raise HTTPException(status_code=409, detail="RFQ balance was claimed by another request; no orders were created")
                for offer, qty, _ in order_specs:
                    claim = await offer_repo.collection.update_one(
                        {"_id": offer["_id"], "status": OFFER_PENDING, "deletedAt": None},
                        {"$set": {"status": OFFER_ACCEPTED, "acceptedAt": now, "acceptedQuantityKg": qty, "updatedAt": now}},
                        session=session,
                    )
                    if claim.modified_count != 1:
                        raise HTTPException(status_code=409, detail="An offer was accepted concurrently; the whole batch was rolled back")
                await order_repo.collection.insert_many(order_docs, ordered=True, session=session)
                accepted_now = live_accepted + requested_total
                if accepted_now >= total_qty - 1e-9 or live_rfq.get("recurring"):
                    await rfq_repo.collection.update_one({"_id": rfq_id}, {"$set": {"status": RFQ_AWARDED, "updatedAt": now}}, session=session)
                    await offer_repo.collection.update_many(
                        {"rfqId": rfq_id, "_id": {"$nin": offer_ids}, "status": OFFER_PENDING},
                        {"$set": {"status": OFFER_DECLINED, "updatedAt": now}},
                        session=session,
                    )
                batch_doc = {
                    "businessUserId": ObjectId(current_user["_id"]),
                    "rfqId": rfq_id,
                    "idempotencyKey": data.idempotencyKey,
                    "orderIds": [order["_id"] for order in order_docs],
                    "offerIds": offer_ids,
                    "items": [{"offerId": offer["_id"], "quantityKg": qty} for offer, qty, _ in order_specs],
                    "quantityKg": requested_total,
                    "createdAt": now,
                }
                await batches.insert_one(batch_doc, session=session)
        for order in order_docs:
            order["id"] = str(order["_id"])
            order["offerId"] = str(order.get("offerId"))
        # Notifications are deliberately outside the transaction; notification failure
        # must not undo a committed procurement batch.
        for offer, qty, _ in order_specs:
            try:
                await NotificationService.create_in_app_notification(
                    str(offer.get("farmerId")), NotificationType.ORDER, "Offer accepted! 🎉",
                    f"Your quote for {offer.get('productName')} @ ₹{offer.get('pricePerKg')}/kg was accepted.",
                    {"rfqId": str(rfq_id), "type": "b2b", "batchKey": data.idempotencyKey},
                    NotificationPriority.HIGH,
                )
            except Exception:
                logger.exception("Batch committed but notification failed for offer %s", offer.get("_id"))
        return {"success": True, "data": {"orders": order_docs, "batchId": str(batch_doc["_id"]), "acceptedQuantityKg": round(requested_total, 2), "remainingQuantityKg": round(max(0.0, total_qty-accepted_now), 2), "replayed": False}, "message": "All selected offers accepted atomically"}
    except HTTPException:
        raise
    except Exception as exc:
        # A transaction can commit successfully while the HTTP response is lost,
        # or a concurrent retry can hit the unique idempotency index. Before
        # reporting failure, reconcile against the durable batch record. The
        # batch record and its orders are written in the same transaction, so a
        # visible record is proof that the whole batch committed.
        try:
            committed = await batches.find_one({
                "businessUserId": ObjectId(current_user["_id"]),
                "idempotencyKey": data.idempotencyKey,
            })
            if committed:
                committed_items = sorted(
                    (str(row.get("offerId")), round(float(row.get("quantityKg") or 0), 2))
                    for row in committed.get("items", [])
                )
                requested_items = sorted(
                    (item.offerId, round(float(item.quantityKg), 2))
                    for item in data.items
                )
                if committed_items != requested_items:
                    raise HTTPException(
                        status_code=409,
                        detail="This idempotency key belongs to a different batch selection.",
                    )
                recovered_orders = await order_repo.collection.find(
                    {"_id": {"$in": committed.get("orderIds", [])}}
                ).to_list(length=50)
                for recovered_order in recovered_orders:
                    recovered_order["id"] = str(recovered_order["_id"])
                    recovered_order["offerId"] = str(recovered_order.get("offerId"))
                if len(recovered_orders) == len(committed.get("orderIds", [])):
                    logger.warning(
                        "Recovered committed B2B acceptance batch after an ambiguous transaction response: %s",
                        data.idempotencyKey,
                    )
                    return {
                        "success": True,
                        "data": {
                            "orders": recovered_orders,
                            "batchId": str(committed["_id"]),
                            "acceptedQuantityKg": round(float(committed.get("quantityKg") or 0), 2),
                            "replayed": True,
                        },
                        "message": "Recovered previously committed batch; no duplicate orders were created",
                    }
        except HTTPException:
            raise
        except Exception:
            logger.exception("Could not reconcile B2B batch after transaction error")
        logger.exception("Atomic B2B offer batch failed; transaction should roll back")
        raise HTTPException(
            status_code=503,
            detail="Batch outcome could not be confirmed. Retry the exact same selection with the same idempotency key; committed batches are recovered without creating duplicate orders. MongoDB transactions require a replica set or sharded cluster.",
        ) from exc
    finally:
        await session.end_session()


@router.post("/offers/{offer_id}/accept")
async def accept_offer(
    offer_id: str,
    data: OfferAccept = Body(default=None),
    current_user: dict = Depends(get_current_user),
):
    """Compatibility endpoint routed through the atomic transaction path."""
    if current_user.get("role") != "business":
        raise HTTPException(status_code=403, detail="Only business accounts can accept offers")
    try:
        offer_oid = ObjectId(offer_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Offer not found")
    offer = await offer_repo.find_one({"_id": offer_oid, "deletedAt": None})
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found")
    rfq = await rfq_repo.find_one({"_id": offer.get("rfqId"), "deletedAt": None})
    if not rfq:
        raise HTTPException(status_code=404, detail="RFQ not found")
    if str(rfq.get("businessUserId")) != str(current_user["_id"]):
        raise HTTPException(status_code=403, detail="Not your RFQ")
    default_quantity = _rfq_quantity(rfq) if rfq.get("recurring") else float(
        offer.get("availableQuantityKg") or offer.get("minOrderKg") or _rfq_quantity(rfq)
    )
    quantity = float(data.quantityKg) if data and data.quantityKg is not None else default_quantity
    stable_key = f"single-{offer_id}-{quantity:.2f}"
    batch_request = OfferBatchAccept(
        items=[OfferBatchItem(offerId=offer_id, quantityKg=quantity)],
        idempotencyKey=stable_key,
        deliveryMethod=(data.deliveryMethod if data and data.deliveryMethod else "dedicated_transport"),
        paymentMode=(data.paymentMode if data and data.paymentMode else "cod"),
        advanceAmount=(data.advanceAmount if data and data.advanceAmount is not None else 0),
        deliveryCharge=(data.deliveryCharge if data else None),
        notes=(data.notes if data else None),
    )
    result = await accept_offer_batch(batch_request, current_user)
    orders = result.get("data", {}).get("orders") or []
    order = orders[0] if orders else None
    if order:
        return {
            "success": True,
            "data": {
                "order": order,
                "offerId": offer_id,
                "remainingQuantityKg": result["data"].get("remainingQuantityKg"),
                "acceptedQuantityKg": result["data"].get("acceptedQuantityKg"),
                "replayed": result["data"].get("replayed", False),
            },
            "message": result.get("message", "Quote accepted; B2B order created"),
        }
    # Idempotent replay of older batches still returns their persisted order IDs.
    return result


@router.post("/orders/{order_id}/payment-intent")
async def create_b2b_payment_intent(
    order_id: str,
    payment_method: str = Body("razorpay", embed=True),
    current_user: dict = Depends(get_current_user),
):
    """Start payment for a B2B order through the shared verified payment pipeline."""
    if current_user.get("role") != "business":
        raise HTTPException(status_code=403, detail="Only business buyers can pay B2B orders")
    order = await order_repo.get_by_id(order_id)
    if not order or str(order.get("businessUserId")) != str(current_user["_id"]):
        raise HTTPException(status_code=404, detail="B2B order not found")
    if order.get("paymentStatus") == PAYMENT_PAID:
        raise HTTPException(status_code=400, detail="B2B order is already paid")
    if order.get("status") == ORDER_CANCELLED:
        raise HTTPException(status_code=400, detail="Cancelled orders cannot be paid")
    result = await PaymentService.create_payment_intent(
        order_id, float(order.get("totalAmount") or 0), payment_method
    )
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    return {"success": True, "data": result}


@router.post("/orders/{order_id}/verify-payment")
async def verify_b2b_payment(
    order_id: str,
    payment_id: str = Body(..., embed=True),
    razorpay_order_id: str = Body(..., embed=True),
    razorpay_payment_id: str = Body(..., embed=True),
    razorpay_signature: str = Body(..., embed=True),
    current_user: dict = Depends(get_current_user),
):
    """Verify B2B Razorpay payment and move the order to confirmed/fulfillment."""
    if current_user.get("role") != "business":
        raise HTTPException(status_code=403, detail="Only business buyers can verify B2B payments")
    order = await order_repo.get_by_id(order_id)
    if not order or str(order.get("businessUserId")) != str(current_user["_id"]):
        raise HTTPException(status_code=404, detail="B2B order not found")
    payment = await payment_repo_for_b2b().get_by_id(payment_id)
    if not payment or str(payment.get("userId")) != str(current_user["_id"]):
        raise HTTPException(status_code=400, detail="Payment verification failed")
    verified = await PaymentService.verify_razorpay_payment(
        payment_id, razorpay_order_id, razorpay_payment_id, razorpay_signature
    )
    if not verified:
        raise HTTPException(status_code=400, detail="Payment verification failed")
    return {"success": True, "data": verified}


def payment_repo_for_b2b():
    from app.repositories.payment_repository import payment_repository
    return payment_repository


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
    packedQuantityKg: Optional[float] = Field(None, ge=0)
    qualityNotes: Optional[str] = None


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

        # Quality approval is a decision within the quality_check stage, not a
        # status transition. Keep the order there until the farmer explicitly
        # marks it ready_for_pickup.
        if current == ORDER_QUALITY_CHECK and data.status == ORDER_QUALITY_CHECK:
            if data.qualityCheck not in ("passed", "failed"):
                raise HTTPException(status_code=400, detail="Choose passed or failed for the quality check.")
            update["qualityCheck"] = data.qualityCheck
            if data.qualityNotes:
                update["qualityNotes"] = data.qualityNotes
            await order_repo.update({"_id": order["_id"]}, update)
            return {"success": True, "message": f"Quality check marked {data.qualityCheck}"}

        nxt = ORDER_FLOW[ORDER_FLOW.index(current) + 1] if current in ORDER_FLOW and ORDER_FLOW.index(current) < len(ORDER_FLOW) - 1 else None
        if data.status != nxt:
            raise HTTPException(status_code=400, detail=f"Invalid transition from {current} to {data.status}")
        if data.status == ORDER_QUALITY_CHECK:
            # Accept camelCase and snake_case payloads. Older frontend builds may
            # send the snake_case form; when no explicit quantity arrives, use the
            # accepted order quantity as the default packed quantity shown in UI.
            raw_packed_quantity = (
                data.packedQuantityKg
                if data.packedQuantityKg is not None
                else order.get("packedQuantityKg", order.get("quantityKg"))
            )
            if raw_packed_quantity is None:
                raise HTTPException(
                    status_code=400,
                    detail="Packed quantity is missing. Enter the actual packed quantity and try again.",
                )
            if float(raw_packed_quantity) <= 0:
                raise HTTPException(status_code=400, detail="Packed quantity must be greater than zero.")
            update["packedQuantityKg"] = round(float(raw_packed_quantity), 2)
            update["qualityCheck"] = "pending"
            if data.qualityNotes:
                update["qualityNotes"] = data.qualityNotes
        if data.status == ORDER_READY_FOR_PICKUP and order.get("qualityCheck") != "passed":
            raise HTTPException(status_code=400, detail="Pass the quality check before marking this order ready for pickup.")
        if data.status == ORDER_PICKED_UP:
            update["pickedUpAt"] = datetime.utcnow()
        if data.status == ORDER_WAREHOUSE_RECEIVED:
            update["warehouseReceivedAt"] = datetime.utcnow()
        if data.status == ORDER_DISPATCHED:
            if data.qualityCheck != "passed":
                raise HTTPException(status_code=400, detail="Pass the quality check before dispatching this B2B order.")
            update["qualityCheck"] = "passed"
            if data.qualityNotes:
                update["qualityNotes"] = data.qualityNotes
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




class B2BLogisticsAction(BaseModel):
    action: str
    pickupTeam: Optional[str] = None
    vehicle: Optional[str] = None
    receivedQuantityKg: Optional[float] = Field(None, ge=0)
    qualityCheck: Optional[str] = None
    destinationWarehouseId: Optional[str] = None
    fulfillmentRoute: Optional[str] = None
    deliveryPartner: Optional[str] = None
    notes: Optional[str] = None


@router.get("/warehouse/fulfillment")
async def list_b2b_warehouse_fulfillment(current_user: dict = Depends(get_current_user)):
    """Warehouse-facing queue for B2B orders ready for pickup through final delivery."""
    role = str(current_user.get("role") or "").lower()
    if role not in ("warehouse", "warehouse_manager", "warehouse_staff", "admin", "super_admin", "delivery", "delivery_partner", "delivery_manager"):
        raise HTTPException(status_code=403, detail="Warehouse or delivery role required")
    statuses = [ORDER_READY_FOR_PICKUP, ORDER_PICKED_UP, ORDER_WAREHOUSE_RECEIVED, ORDER_TRANSFER_IN_TRANSIT, ORDER_DESTINATION_RECEIVED, ORDER_IN_TRANSIT, ORDER_DELIVERED]
    orders = await order_repo.find_many({"status": {"$in": statuses}, "deletedAt": None}, sort=[("updatedAt", -1)], limit=500)
    for order in orders:
        await _enrich_order(order)
        # Expose a stable frontend identifier while retaining the Mongo ID as a string.
        order["id"] = str(order.get("_id"))
        for key in ("_id", "businessUserId", "farmerId", "rfqId", "offerId", "sourceWarehouseId", "destinationWarehouseId", "pickupAssignedBy", "warehouseReceivedBy", "destinationReceivedBy", "finalDeliveryAssignedBy", "deliveredBy"):
            if order.get(key) is not None:
                order[key] = str(order[key])

    # Counts are computed from persisted database queries, not the capped list
    # returned for rendering. Derived workflow stages use server-side predicates.
    base = {"deletedAt": None}
    async def count_status(status: str, extra: Optional[Dict[str, Any]] = None) -> int:
        criteria: Dict[str, Any] = {**base, "status": status}
        if extra:
            criteria.update(extra)
        return await order_repo.count(criteria)

    summary = {
        "readyForFarmPickup": await count_status(ORDER_READY_FOR_PICKUP, {"pickupTeam": {"$in": [None, ""]}}),
        "pickupAssigned": await count_status(ORDER_READY_FOR_PICKUP, {"pickupTeam": {"$nin": [None, ""]}}),
        "collectedFromFarm": await count_status(ORDER_PICKED_UP),
        "warehouseReceived": await count_status(ORDER_WAREHOUSE_RECEIVED),
        "routingRequired": await order_repo.count({**base, "status": ORDER_WAREHOUSE_RECEIVED, "$or": [{"fulfillmentRoute": {"$exists": False}}, {"fulfillmentRoute": None}, {"fulfillmentRoute": ""}]}),
        "awaitingConsolidation": await order_repo.count({**base, "fulfillmentRoute": "nearby_multi_farmer", "status": {"$in": [ORDER_WAREHOUSE_RECEIVED, ORDER_DESTINATION_RECEIVED]}, "consolidationCompletedAt": {"$in": [None, ""]}}),
        "warehouseTransferInTransit": await count_status(ORDER_TRANSFER_IN_TRANSIT),
        "readyForDirectDelivery": await order_repo.count({**base, "$or": [{"status": ORDER_WAREHOUSE_RECEIVED, "warehouseQualityCheck": "passed", "fulfillmentRoute": "nearby_single_farmer"}, {"status": ORDER_WAREHOUSE_RECEIVED, "warehouseQualityCheck": "passed", "fulfillmentRoute": "nearby_multi_farmer", "consolidationCompletedAt": {"$nin": [None, ""]}}, {"status": ORDER_DESTINATION_RECEIVED, "destinationQualityCheck": "passed", "fulfillmentRoute": "long_distance"}]}),
        "directDeliveryInTransit": await count_status(ORDER_IN_TRANSIT),
        "deliveredToBusiness": await order_repo.count({**base, "status": {"$in": [ORDER_DELIVERED, ORDER_COMPLETED]}}),
    }
    return {"success": True, "data": {"orders": orders, "count": len(orders), "summary": summary}}


@router.post("/warehouse/fulfillment/{order_id}/route-recommendation")
async def recommend_b2b_fulfillment_route_post(
    order_id: str,
    body: Dict[str, Any],
    current_user: dict = Depends(get_current_user),
):
    """POST-compatible route recommendation for clients using body-validating API middleware."""
    # The order ID is taken from the path; require an explicit JSON object to avoid
    # the middleware's "body field required" validation error on this action.
    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail="A JSON object body is required")
    return await recommend_b2b_fulfillment_route(order_id=order_id, current_user=current_user)


@router.get("/warehouse/fulfillment/{order_id}/route-recommendation")
async def _resolve_b2b_delivery_location(order: Dict[str, Any]) -> Tuple[Optional[Tuple[float, float]], Optional[Dict[str, Any]]]:
    """Resolve legacy B2B delivery addresses to coordinates and persist the result."""
    candidates: List[Dict[str, Any]] = []
    for key in ("deliveryLocation", "deliveryAddress", "businessAddress", "shippingAddress", "address"):
        value = order.get(key)
        if isinstance(value, dict):
            candidates.append(value)
        elif isinstance(value, str) and value.strip():
            candidates.append({"address_line1": value.strip()})
    for key, target in (("deliveryCity", "city"), ("deliveryDistrict", "district"), ("deliveryState", "state"), ("deliveryPostalCode", "zip_code"), ("deliveryPincode", "zip_code"), ("deliveryCountry", "country")):
        if order.get(key):
            if not candidates:
                candidates.append({})
            candidates[0][target] = str(order[key])
    for address in candidates:
        coords = _location_coords_from_doc({"location": address}) or _location_coords_from_doc(address)
        if coords:
            return coords, {"type": "Point", "coordinates": [coords[0], coords[1]]}
    raw_address = next((order.get(k) for k in ("deliveryAddress", "businessAddress", "shippingAddress", "address", "deliveryLocation") if isinstance(order.get(k), str) and order.get(k).strip()), "")
    if not raw_address:
        for key in ("deliveryLocation", "deliveryAddress", "businessAddress", "shippingAddress", "address"):
            value = order.get(key)
            if isinstance(value, dict):
                raw_address = ", ".join(str(value.get(part) or "").strip() for part in ("formattedAddress", "addressLine1", "address_line1", "street", "line1", "addressLine2", "address_line2") if str(value.get(part) or "").strip())
                if raw_address:
                    break
    city = order.get("deliveryCity") or order.get("city") or order.get("deliveryDistrict") or order.get("district") or ""
    state = order.get("deliveryState") or order.get("state") or "Tamil Nadu"
    country = order.get("deliveryCountry") or order.get("country") or "India"
    try:
        geocoded = await geocode_address({"address_line1": str(raw_address or ""), "address_line2": str(order.get("deliveryAddressLine2") or ""), "city": str(city), "state": str(state), "zip_code": str(order.get("deliveryPostalCode") or order.get("deliveryPincode") or order.get("pincode") or ""), "country": str(country)})
        coords = _location_coords_from_doc({"location": geocoded or {}})
        if coords:
            return coords, geocoded
    except Exception:
        logger.exception("Failed to geocode B2B delivery address for order %s", order.get("_id"))
    return None, None

def _normalized_district(doc: Optional[Dict[str, Any]]) -> str:
    """Normalize explicit district fields and legacy comma-separated addresses."""
    if not isinstance(doc, dict):
        return ""
    location = doc.get("deliveryLocation") or doc.get("location") or doc.get("address")
    nested = location if isinstance(location, dict) else {}
    for value in (
        doc.get("deliveryDistrict"), doc.get("district"), doc.get("districtName"),
        doc.get("administrativeDistrict"), nested.get("deliveryDistrict"),
        nested.get("district"), nested.get("districtName"),
        nested.get("administrativeDistrict"),
    ):
        normalized = re.sub(r"[^a-z0-9]", "", str(value or "").lower())
        if normalized:
            return normalized
    raw_address = next((doc.get(key) for key in ("deliveryAddress", "businessAddress", "shippingAddress", "address", "deliveryLocation") if isinstance(doc.get(key), str) and doc.get(key).strip()), "")
    if not raw_address and isinstance(location, dict):
        raw_address = location.get("formattedAddress") or location.get("addressLine1") or location.get("address_line1") or ""
    parts = [re.sub(r"[^a-z0-9]", "", part.lower()) for part in str(raw_address).split(",")]
    parts = [part for part in parts if part]
    return parts[-1] if len(parts) >= 2 else ""


@router.get("/warehouse/fulfillment/{order_id}/route-recommendation")
async def recommend_b2b_fulfillment_route(
    order_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Recommend route using the farmer's actual location and business delivery district."""
    role = str(current_user.get("role") or "").lower()
    if role not in ("warehouse", "warehouse_manager", "warehouse_staff", "admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Only warehouse staff can request fulfillment routing")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid B2B order ID")
    order = await order_repo.find_one({"_id": ObjectId(order_id), "deletedAt": None})
    if not order:
        raise HTTPException(status_code=404, detail="B2B order not found")
    if order.get("status") != ORDER_WAREHOUSE_RECEIVED:
        raise HTTPException(status_code=400, detail="Automatic routing is available after warehouse receipt")
    if order.get("warehouseQualityCheck") != "passed":
        raise HTTPException(status_code=400, detail="Quality must pass before route recommendation")

    buyer_coords, geocoded_location = await _resolve_b2b_delivery_location(order)
    if not buyer_coords:
        return {"success": True, "data": {"available": False, "reason": "The business delivery address could not be geocoded. Add a complete address with city, district and PIN code, then refresh automatic routing."}}
    if geocoded_location and not _location_coords_from_doc({"location": order.get("deliveryLocation")}) and not _location_coords_from_doc(order):
        await order_repo.update({"_id": order["_id"]}, {"deliveryLocation": geocoded_location, "deliveryCoordinatesResolvedAt": datetime.utcnow(), "updatedAt": datetime.utcnow()})
        order["deliveryLocation"] = geocoded_location

    # Stock has already been received by a warehouse. For an inter-warehouse transfer,
    # the actual receiving/source warehouse is authoritative; do not re-route the stock
    # backwards to whichever warehouse happens to be closest to the farm.
    recorded_source_id = str(order.get("sourceWarehouseId") or order.get("warehouseId") or order.get("receivedAtWarehouseId") or "")
    recorded_source = await warehouse_repo.find_one({"_id": ObjectId(recorded_source_id), "deletedAt": None}) if ObjectId.is_valid(recorded_source_id) else None
    if recorded_source:
        source_status = str(recorded_source.get("status") or recorded_source.get("operationalStatus") or "active").lower()
        source_coords_existing = _location_coords_from_doc(recorded_source)
        if source_status not in ("active", "operational", "enabled", "open") or not source_coords_existing:
            return {"success": True, "data": {"available": False, "reason": "The warehouse that received this stock is inactive or has no valid coordinates. Fix its warehouse record before transferring."}}
        source_district_existing = _normalized_district(recorded_source)
        source_id_existing = str(recorded_source.get("_id"))
        source_name_existing = recorded_source.get("name") or recorded_source.get("warehouseName") or recorded_source.get("code") or "Source Warehouse"
    else:
        source_coords_existing = None
        source_district_existing = ""
        source_id_existing = ""
        source_name_existing = ""

    # Farmer profile is used only as a fallback when this order has no persisted source
    # warehouse. It must never override the warehouse that has already received the stock.
    farmer_doc = order.get("farmerInfo") if isinstance(order.get("farmerInfo"), dict) else order.get("farmer") if isinstance(order.get("farmer"), dict) else {}
    farmer_id = str(order.get("farmerId") or order.get("farmerUserId") or order.get("sellerId") or "")
    if farmer_id and ObjectId.is_valid(farmer_id):
        try:
            fetched_farmer = await farmer_repository.get_by_id(farmer_id)
            if fetched_farmer:
                farmer_doc = {**farmer_doc, **fetched_farmer}
        except Exception:
            logger.exception("Could not load B2B farmer profile for order %s", order_id)
    if not _location_coords_from_doc(farmer_doc) and farmer_id:
        try:
            fetched_farmer = await farmer_repository.get_by_user_id(farmer_id)
            if fetched_farmer:
                farmer_doc = {**farmer_doc, **fetched_farmer}
        except Exception:
            logger.exception("Could not load B2B farmer by user ID for order %s", order_id)
    farmer_coords = _location_coords_from_doc(farmer_doc)
    if not recorded_source and not farmer_coords:
        farmer_address = farmer_doc.get("farmLocation") or farmer_doc.get("location") or farmer_doc.get("address") or farmer_doc.get("farmAddress")
        if isinstance(farmer_address, str) and farmer_address.strip():
            try:
                farmer_geocoded = await geocode_address({"address_line1": farmer_address, "city": str(farmer_doc.get("city") or ""), "state": str(farmer_doc.get("state") or "Tamil Nadu"), "zip_code": str(farmer_doc.get("pincode") or farmer_doc.get("zipCode") or ""), "country": "India"})
                farmer_coords = _location_coords_from_doc({"location": farmer_geocoded or {}})
                if farmer_coords:
                    farmer_doc = {**farmer_doc, "location": farmer_geocoded}
            except Exception:
                logger.exception("Could not geocode farm location for B2B order %s", order_id)
    if not recorded_source and not farmer_coords:
        return {"success": True, "data": {"available": False, "reason": "This order has no recorded source/receiving warehouse and the farmer location is missing. Set the actual warehouse that received the stock before calculating an inter-warehouse transfer."}}

    warehouses = await warehouse_repo.find_many({"deletedAt": None}, limit=500)
    active = []
    for warehouse in warehouses:
        state = str(warehouse.get("status") or warehouse.get("operationalStatus") or "active").lower()
        coords = _location_coords_from_doc(warehouse)
        if state in ("active", "operational", "enabled", "open") and coords:
            active.append((warehouse, coords))
    if not active:
        return {"success": True, "data": {"available": False, "reason": "No active warehouse with valid coordinates is configured."}}

    farm_district = _normalized_district(farmer_doc)
    buyer_district = _normalized_district(order)
    if not buyer_district:
        raw_buyer_address = order.get("deliveryAddress") or order.get("businessAddress") or order.get("shippingAddress")
        if not raw_buyer_address and isinstance(order.get("deliveryLocation"), str):
            raw_buyer_address = order.get("deliveryLocation")
        if not raw_buyer_address and isinstance(order.get("deliveryLocation"), dict):
            raw_buyer_address = order["deliveryLocation"].get("formattedAddress") or order["deliveryLocation"].get("addressLine1") or order["deliveryLocation"].get("address_line1")
        buyer_district = _normalized_district({"deliveryAddress": raw_buyer_address})
    if not buyer_district:
        buyer_district = _normalized_district({"deliveryLocation": geocoded_location or order.get("deliveryLocation"), "deliveryAddress": order.get("deliveryAddress") or order.get("businessAddress")})
    known_districts = {_normalized_district(row[0]) for row in active}
    known_districts.discard("")
    if buyer_district and known_districts and buyer_district not in known_districts:
        raw_delivery = order.get("deliveryAddress") or order.get("businessAddress") or order.get("deliveryLocation")
        raw_parts = [re.sub(r"[^a-z0-9]", "", part.lower()) for part in str(raw_delivery or "").split(",")]
        matches = [part for part in raw_parts if part in known_districts]
        buyer_district = matches[-1] if matches else ""
    # Prefer a warehouse in the farmer's district; within that group choose the nearest to the farm.
    if recorded_source:
        source = recorded_source
        source_coords = source_coords_existing
        source_id = source_id_existing
        source_name = source_name_existing
        farm_to_source_km = None
    else:
        source_pool = [row for row in active if farm_district and _normalized_district(row[0]) == farm_district]
        if not source_pool:
            source_pool = active
        source, source_coords = min(source_pool, key=lambda row: haversine_km(farmer_coords[1], farmer_coords[0], row[1][1], row[1][0]))
        source_id = str(source.get("_id"))
        source_name = source.get("name") or source.get("warehouseName") or source.get("code") or "Source Warehouse"
        farm_to_source_km = round(haversine_km(farmer_coords[1], farmer_coords[0], source_coords[1], source_coords[0]), 2)
    distance_km = round(haversine_km(source_coords[1], source_coords[0], buyer_coords[1], buyer_coords[0]), 2)

    sibling_query = {"deletedAt": None}
    if order.get("rfqId") is not None:
        sibling_query["rfqId"] = order.get("rfqId")
    if order.get("businessUserId") is not None:
        sibling_query["businessUserId"] = order.get("businessUserId")
    siblings = await order_repo.find_many(sibling_query, limit=500) if "rfqId" in sibling_query and "businessUserId" in sibling_query else [order]
    portions = [p for p in siblings if p.get("farmerId") or p.get("farmerUserId") or p.get("farmerInfo") or p.get("farmer")]
    multi_farmer = len(portions) > 1
    if distance_km <= 15:
        route = "nearby_multi_farmer" if multi_farmer else "nearby_single_farmer"
        return {"success": True, "data": {"available": True, "fulfillmentRoute": route, "distanceKm": distance_km, "farmToSourceKm": farm_to_source_km, "thresholdKm": 15, "sourceWarehouseId": source_id, "sourceWarehouseName": source_name, "destinationWarehouseId": source_id, "destinationWarehouseName": source_name, "farmerDistrict": farm_district or None, "businessDistrict": buyer_district or None, "portionCount": max(1, len(portions)), "reason": "Delivery is within 15 km of the source warehouse; direct delivery stays at the source warehouse."}}

    required_kg = float(order.get("receivedQuantityKg") or order.get("packedQuantityKg") or order.get("quantityKg") or 0)
    candidates = []
    for warehouse, coords in active:
        wid = str(warehouse.get("_id") or "")
        if not wid or wid == source_id:
            continue
        # Filter by district only when the address/warehouse contains an explicit
        # administrative district. A village or town (e.g. Chettikulam) is not a
        # district; when district is unknown, compare eligible warehouses across
        # every district using geocoded distance instead of falsely rejecting all.
        warehouse_district = _normalized_district(warehouse)
        if buyer_district and (not warehouse_district or warehouse_district != buyer_district):
            # A known business district must match exactly; unknown-district warehouses
            # cannot be assumed suitable just because they have spare capacity.
            continue
        total = warehouse.get("totalCapacity", warehouse.get("capacity"))
        used = warehouse.get("usedCapacity", warehouse.get("occupiedCapacity", 0))
        try:
            available_capacity = float(total) - float(used or 0)
        except (TypeError, ValueError):
            continue
        if required_kg <= 0 or available_capacity < required_kg:
            continue
        distance_to_buyer = round(haversine_km(buyer_coords[1], buyer_coords[0], coords[1], coords[0]), 2)
        candidates.append((distance_to_buyer, warehouse, coords, available_capacity))
    if not candidates:
        return {"success": True, "data": {"available": False, "fulfillmentRoute": "long_distance", "distanceKm": distance_km, "farmToSourceKm": farm_to_source_km, "thresholdKm": 15, "sourceWarehouseId": source_id, "sourceWarehouseName": source_name, "farmerDistrict": farm_district or None, "businessDistrict": buyer_district or None, "reason": (f"No active destination warehouse with sufficient capacity was found in the explicitly identified business district ({buyer_district})." if buyer_district else "No active destination warehouse with sufficient capacity and valid coordinates was found across the configured districts. The address locality was not treated as a district.")}}
    distance_to_buyer, destination, destination_coords, available_capacity = min(candidates, key=lambda row: row[0])
    return {"success": True, "data": {"available": True, "fulfillmentRoute": "long_distance", "distanceKm": distance_km, "farmToSourceKm": farm_to_source_km, "thresholdKm": 15, "sourceWarehouseId": source_id, "sourceWarehouseName": source_name, "destinationWarehouseId": str(destination.get("_id")), "destinationWarehouseName": destination.get("name") or destination.get("warehouseName") or destination.get("code") or "Destination Warehouse", "destinationDistrict": _normalized_district(destination), "farmerDistrict": farm_district or None, "businessDistrict": buyer_district or None, "destinationAvailableCapacityKg": round(available_capacity, 2), "distanceToBusinessKm": distance_to_buyer, "portionCount": max(1, len(portions)), "reason": (f"Delivery is over 15 km from the source. Selected the nearest active, capacity-eligible warehouse in the business delivery district ({buyer_district})." if buyer_district else "Delivery is over 15 km from the source. No administrative district was explicitly identified, so the nearest active warehouse with sufficient capacity was selected across configured districts using geographic coordinates.")}}


@router.get("/warehouse/fulfillment/destination-warehouses")
async def list_b2b_destination_warehouses(
    orderId: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    """Return active destination warehouses with known spare capacity for this B2B order."""
    role = str(current_user.get("role") or "").lower()
    if role not in ("warehouse", "warehouse_manager", "warehouse_staff", "admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Only warehouse staff can select a destination warehouse")
    if not ObjectId.is_valid(orderId):
        raise HTTPException(status_code=400, detail="Invalid B2B order ID")
    order = await order_repo.find_one({"_id": ObjectId(orderId), "deletedAt": None})
    if not order:
        raise HTTPException(status_code=404, detail="B2B order not found")
    if order.get("status") != ORDER_WAREHOUSE_RECEIVED or order.get("warehouseQualityCheck") != "passed":
        raise HTTPException(status_code=400, detail="Source warehouse receipt and passed quality inspection are required")
    required_kg = float(order.get("receivedQuantityKg") or order.get("packedQuantityKg") or order.get("quantityKg") or 0)
    if required_kg <= 0:
        raise HTTPException(status_code=400, detail="Order quantity is required before selecting a destination")
    buyer_coords = _location_coords_from_doc({"location": order.get("deliveryLocation")}) or _location_coords_from_doc(order)
    warehouses = await warehouse_repo.find_many({"deletedAt": None}, limit=500)
    options = []
    for warehouse in warehouses:
        wid = str(warehouse.get("_id") or warehouse.get("id") or "")
        if not wid or wid == str(order.get("sourceWarehouseId") or ""):
            continue
        state = str(warehouse.get("status") or warehouse.get("operationalStatus") or "active").lower()
        if state not in ("active", "operational", "enabled", "open"):
            continue
        total = warehouse.get("totalCapacity", warehouse.get("capacity"))
        used = warehouse.get("usedCapacity", warehouse.get("occupiedCapacity", 0))
        try:
            spare = float(total) - float(used or 0)
        except (TypeError, ValueError):
            # Never treat an unknown capacity as available capacity.
            continue
        if spare < required_kg:
            continue
        coords = _location_coords_from_doc(warehouse)
        distance = None
        if buyer_coords and coords:
            distance = round(haversine_km(buyer_coords[1], buyer_coords[0], coords[1], coords[0]), 1)
        # Require known destination and buyer locations for route suitability.
        if distance is None:
            continue
        options.append({
            "id": wid,
            "name": warehouse.get("name") or warehouse.get("warehouseName") or warehouse.get("code") or f"Warehouse {wid[-6:]}",
            "district": warehouse.get("district"),
            "city": warehouse.get("city"),
            "availableCapacityKg": round(spare, 2),
            "requiredCapacityKg": round(required_kg, 2),
            "distanceToBusinessKm": distance,
        })
    options.sort(key=lambda item: item["distanceToBusinessKm"])
    return {"success": True, "data": {"warehouses": options, "requiredCapacityKg": round(required_kg, 2)}}


@router.put("/warehouse/fulfillment/{order_id}")
async def update_b2b_warehouse_fulfillment(
    order_id: str,
    data: B2BLogisticsAction,
    current_user: dict = Depends(get_current_user),
):
    """Role-checked pickup, warehouse receiving, transfer, and final-delivery actions."""
    role = str(current_user.get("role") or "").lower()
    allowed_warehouse = ("warehouse", "warehouse_manager", "warehouse_staff", "admin", "super_admin")
    allowed_delivery = ("delivery", "delivery_partner", "delivery_manager", "admin", "super_admin")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid B2B order ID")
    order = await order_repo.find_one({"_id": ObjectId(order_id), "deletedAt": None})
    if not order:
        raise HTTPException(status_code=404, detail="B2B order not found")
    current = order.get("status")
    update: Dict[str, Any] = {"updatedAt": datetime.utcnow()}
    action = data.action

    if action == "assign_pickup":
        if role not in allowed_warehouse:
            raise HTTPException(status_code=403, detail="Only warehouse staff can assign farm pickup")
        if current != ORDER_READY_FOR_PICKUP:
            raise HTTPException(status_code=400, detail="Only orders marked Ready for Pickup can be assigned")
        if not data.pickupTeam or not data.vehicle:
            raise HTTPException(status_code=400, detail="Pickup team and vehicle are required")
        update.update({"pickupTeam": data.pickupTeam.strip(), "pickupVehicle": data.vehicle.strip(), "pickupAssignedAt": datetime.utcnow(), "pickupAssignedBy": str(current_user.get("_id"))})
    elif action == "confirm_pickup":
        if role not in ("pickup_team", "pickup", "warehouse", "warehouse_manager", "warehouse_staff", "admin", "super_admin"):
            raise HTTPException(status_code=403, detail="Only the assigned pickup team or warehouse can confirm collection")
        if current != ORDER_READY_FOR_PICKUP or not order.get("pickupTeam") or not order.get("pickupVehicle"):
            raise HTTPException(status_code=400, detail="Assign a pickup team and vehicle before confirming collection")
        update.update({"status": ORDER_PICKED_UP, "pickedUpAt": datetime.utcnow(), "pickupNotes": data.notes})
    elif action == "receive_stock":
        if role not in allowed_warehouse:
            raise HTTPException(status_code=403, detail="Only warehouse staff can receive B2B stock")
        if current != ORDER_PICKED_UP:
            raise HTTPException(status_code=400, detail="Stock can be received only after pickup is confirmed")
        if data.receivedQuantityKg is None or data.receivedQuantityKg <= 0:
            raise HTTPException(status_code=400, detail="Enter the received quantity in kg")
        if data.qualityCheck not in ("passed", "failed"):
            raise HTTPException(status_code=400, detail="Record a passed or failed quality inspection")
        update.update({"status": ORDER_WAREHOUSE_RECEIVED, "receivedQuantityKg": round(data.receivedQuantityKg, 2), "warehouseQualityCheck": data.qualityCheck, "warehouseReceivedAt": datetime.utcnow(), "warehouseReceivedBy": str(current_user.get("_id")), "warehouseNotes": data.notes})
    elif action == "set_fulfillment_route":
        if role not in allowed_warehouse:
            raise HTTPException(status_code=403, detail="Only warehouse staff can plan B2B fulfillment")
        if current != ORDER_WAREHOUSE_RECEIVED or order.get("warehouseQualityCheck") != "passed":
            raise HTTPException(status_code=400, detail="Warehouse receipt and passed quality inspection are required before routing")
        if data.fulfillmentRoute not in ("nearby_single_farmer", "nearby_multi_farmer", "long_distance"):
            raise HTTPException(status_code=400, detail="Choose a valid fulfillment route")
        if data.fulfillmentRoute == "long_distance":
            if not data.destinationWarehouseId or str(data.destinationWarehouseId) == str(order.get("sourceWarehouseId") or ""):
                raise HTTPException(status_code=400, detail="Select a different eligible destination warehouse for long-distance fulfillment")
            if not ObjectId.is_valid(str(data.destinationWarehouseId)):
                raise HTTPException(status_code=400, detail="Invalid destination warehouse ID")
            destination = await warehouse_repo.find_one({"_id": ObjectId(str(data.destinationWarehouseId)), "deletedAt": None})
            if not destination:
                raise HTTPException(status_code=400, detail="Destination warehouse is not registered")
            destination_status = str(destination.get("status") or destination.get("operationalStatus") or "active").lower()
            if destination_status not in ("active", "operational", "enabled", "open"):
                raise HTTPException(status_code=400, detail="Destination warehouse is not active")
            required_kg = float(order.get("receivedQuantityKg") or order.get("packedQuantityKg") or order.get("quantityKg") or 0)
            try:
                available_kg = float(destination.get("totalCapacity", destination.get("capacity"))) - float(destination.get("usedCapacity", destination.get("occupiedCapacity", 0)) or 0)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Destination warehouse capacity is missing or invalid")
            if required_kg <= 0 or available_kg < required_kg:
                raise HTTPException(status_code=409, detail="Destination warehouse does not have enough available capacity")
            buyer_coords = _location_coords_from_doc({"location": order.get("deliveryLocation")}) or _location_coords_from_doc(order)
            destination_coords = _location_coords_from_doc(destination)
            if not buyer_coords or not destination_coords:
                raise HTTPException(status_code=400, detail="Destination and business delivery coordinates are required to validate route suitability")
            update["destinationWarehouseId"] = str(data.destinationWarehouseId)
        else:
            update["destinationWarehouseId"] = str(order.get("sourceWarehouseId") or "")
        update.update({
            "fulfillmentRoute": data.fulfillmentRoute,
            "fulfillmentRoutePlannedAt": datetime.utcnow(),
            "fulfillmentRoutePlannedBy": str(current_user.get("_id")),
            "updatedAt": datetime.utcnow(),
        })
    elif action == "dispatch_to_destination":
        if role not in allowed_warehouse:
            raise HTTPException(status_code=403, detail="Only warehouse staff can dispatch a warehouse transfer")
        if current != ORDER_WAREHOUSE_RECEIVED or order.get("warehouseQualityCheck") != "passed":
            raise HTTPException(status_code=400, detail="Source warehouse must receive and pass quality inspection before transfer")
        if order.get("fulfillmentRoute") != "long_distance":
            raise HTTPException(status_code=400, detail="Save the Long Distance route before dispatching a warehouse transfer")
        if not order.get("destinationWarehouseId") or str(order.get("destinationWarehouseId")) == str(order.get("sourceWarehouseId")):
            raise HTTPException(status_code=400, detail="A different destination warehouse must be configured for this transfer")
        update.update({"status": ORDER_TRANSFER_IN_TRANSIT, "transferDispatchedAt": datetime.utcnow(), "transferDispatchedBy": str(current_user.get("_id")), "destinationWarehouseId": str(order.get("destinationWarehouseId")), "transferNotes": data.notes})
    elif action == "receive_at_destination":
        if role not in allowed_warehouse:
            raise HTTPException(status_code=403, detail="Only destination warehouse staff can receive a transfer")
        if current != ORDER_TRANSFER_IN_TRANSIT:
            raise HTTPException(status_code=400, detail="No warehouse transfer is in transit")
        if str(current_user.get("warehouseId") or current_user.get("assignedWarehouseId") or "") and str(current_user.get("warehouseId") or current_user.get("assignedWarehouseId") or "") != str(order.get("destinationWarehouseId") or "") and role not in ("admin", "super_admin"):
            raise HTTPException(status_code=403, detail="Only the destination warehouse can receive this transfer")
        if data.receivedQuantityKg is None or data.receivedQuantityKg <= 0:
            raise HTTPException(status_code=400, detail="Enter destination received quantity")
        if data.qualityCheck not in ("passed", "failed"):
            raise HTTPException(status_code=400, detail="Destination quality inspection must be explicitly marked passed or failed")
        update.update({"status": ORDER_DESTINATION_RECEIVED, "destinationReceivedQuantityKg": round(data.receivedQuantityKg, 2), "destinationReceivedAt": datetime.utcnow(), "destinationReceivedBy": str(current_user.get("_id")), "destinationQualityCheck": data.qualityCheck, "destinationWarehouseNotes": data.notes})
    elif action == "complete_consolidation":
        if role not in allowed_warehouse:
            raise HTTPException(status_code=403, detail="Only warehouse staff can complete B2B consolidation")
        if current != ORDER_WAREHOUSE_RECEIVED or order.get("warehouseQualityCheck") != "passed" or order.get("fulfillmentRoute") != "nearby_multi_farmer":
            raise HTTPException(status_code=400, detail="This portion must be received, quality-passed, and routed to Nearby — Multiple Farmers")
        rfq_id = order.get("rfqId")
        business_id = order.get("businessUserId")
        if not rfq_id or not business_id:
            raise HTTPException(status_code=400, detail="The original RFQ and business buyer are required to identify all portions")
        portions = await order_repo.find_many({"rfqId": rfq_id, "businessUserId": business_id, "deletedAt": None}, limit=500)
        if len(portions) < 2:
            raise HTTPException(status_code=400, detail="This RFQ has fewer than two farmer portions; use Nearby — Single Farmer")
        outstanding = [
            p for p in portions
            if p.get("status") != ORDER_WAREHOUSE_RECEIVED
            or p.get("warehouseQualityCheck") != "passed"
            or p.get("fulfillmentRoute") != "nearby_multi_farmer"
        ]
        if outstanding:
            raise HTTPException(status_code=409, detail=f"Consolidation blocked: {len(outstanding)} farmer portion(s) are not yet received, quality-passed, and routed for consolidation")
        now = datetime.utcnow()
        for portion in portions:
            await order_repo.update({"_id": portion["_id"]}, {
                "fulfillmentRoute": "nearby_multi_farmer",
                "consolidationCompletedAt": now,
                "consolidationCompletedBy": str(current_user.get("_id")),
                "consolidationStatus": "completed",
                "updatedAt": now,
            })
        return {"success": True, "message": "All required B2B farmer portions are received and quality-passed; consolidation completed", "orderId": str(order["_id"]), "portionCount": len(portions)}
    elif action == "dispatch_to_buyer":
        if role not in allowed_warehouse:
            raise HTTPException(status_code=403, detail="Only warehouse staff can dispatch B2B orders")
        valid_current = current == ORDER_WAREHOUSE_RECEIVED and str(order.get("sourceWarehouseId") or "") == str(order.get("destinationWarehouseId") or "") or current == ORDER_DESTINATION_RECEIVED
        quality = order.get("destinationQualityCheck") if current == ORDER_DESTINATION_RECEIVED else order.get("warehouseQualityCheck")
        route = order.get("fulfillmentRoute")
        if current == ORDER_WAREHOUSE_RECEIVED and not (route == "nearby_single_farmer" or (route == "nearby_multi_farmer" and order.get("consolidationCompletedAt"))):
            raise HTTPException(status_code=400, detail="Choose and complete the required fulfillment route before final delivery")
        if current == ORDER_DESTINATION_RECEIVED and route != "long_distance":
            raise HTTPException(status_code=400, detail="Destination receipt is only valid for a long-distance route")
        if route == "nearby_multi_farmer" and not order.get("consolidationCompletedAt"):
            raise HTTPException(status_code=400, detail="Direct delivery is blocked until every required farmer portion is received, inspected, and consolidation is completed")
        if route == "long_distance" and current == ORDER_WAREHOUSE_RECEIVED:
            if not order.get("destinationWarehouseId") or str(order.get("destinationWarehouseId")) == str(order.get("sourceWarehouseId")):
                raise HTTPException(status_code=400, detail="An eligible destination warehouse must be selected before transfer dispatch")
        if not valid_current or quality != "passed":
            raise HTTPException(status_code=400, detail="The correct warehouse must receive and pass quality inspection before final delivery")
        if not data.deliveryPartner or not str(data.deliveryPartner).strip():
            raise HTTPException(status_code=400, detail="Select a registered delivery team before dispatch")
        if route == "long_distance" and current == ORDER_DESTINATION_RECEIVED and not order.get("destinationReceivedAt"):
            raise HTTPException(status_code=400, detail="Destination warehouse receipt must be recorded before final delivery")
        update.update({"status": ORDER_IN_TRANSIT, "finalDeliveryPartner": data.deliveryPartner, "finalDeliveryAssignedAt": datetime.utcnow(), "finalDeliveryAssignedBy": str(current_user.get("_id")), "deliveryNotes": data.notes})
    elif action == "confirm_delivery":
        if role not in allowed_delivery:
            raise HTTPException(status_code=403, detail="Only delivery staff can confirm business delivery")
        if current != ORDER_IN_TRANSIT:
            raise HTTPException(status_code=400, detail="Order must be in transit before delivery confirmation")
        if not data.notes or not data.notes.strip():
            raise HTTPException(status_code=400, detail="Delivery proof / handoff notes are required")
        assigned_partner = str(order.get("finalDeliveryPartner") or "")
        current_user_id = str(current_user.get("_id") or "")
        if role not in ("admin", "super_admin") and assigned_partner and assigned_partner != current_user_id:
            raise HTTPException(status_code=403, detail="Only the assigned delivery team member can confirm this delivery")
        update.update({"status": ORDER_DELIVERED, "deliveredAt": datetime.utcnow(), "deliveredBy": current_user_id, "deliveryProof": data.notes.strip(), "deliveryNotes": data.notes.strip()})
    else:
        raise HTTPException(status_code=400, detail="Unknown B2B logistics action")

    await order_repo.update({"_id": order["_id"]}, update)
    return {"success": True, "message": "B2B fulfillment updated", "status": update.get("status", current), "orderId": str(order["_id"])}


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