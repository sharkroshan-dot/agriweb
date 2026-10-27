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
import httpx

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
from app.repositories.warehouse_pickup_team_repository import warehouse_pickup_team_repository
from app.repositories.warehouse_pickup_route_repository import warehouse_pickup_route_repository
from app.repositories.warehouse_collection_repository import warehouse_collection_repository
from app.services.warehouse_service import WarehouseService
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
contract_repo = BaseRepository("b2b_supply_contracts")
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
    """Return validated (longitude, latitude), correcting legacy India lat/lng arrays."""
    country = str(doc.get("country") or doc.get("countryName") or "").strip().lower()
    state = str(doc.get("state") or doc.get("stateName") or "").strip().lower()
    district = str(doc.get("district") or doc.get("districtName") or "").strip().lower()
    is_india = country in {"india", "in"} or state in {
        "tamil nadu", "andhra pradesh", "telangana", "kerala", "karnataka",
        "maharashtra", "gujarat", "rajasthan", "madhya pradesh", "uttar pradesh",
        "bihar", "west bengal", "odisha", "punjab", "haryana", "assam",
    } or bool(district and doc.get("countryCode") == "IN")

    def normalize(lng: float, lat: float, is_geojson: bool = False) -> Tuple[float, float]:
        # GeoJSON Point is always [longitude, latitude]. Legacy non-GeoJSON
        # arrays are inconsistent across older records and may contain [lat, lng].
        # Infer the swap from the coordinate ranges as well as metadata: warehouse
        # documents often do not have country/state fields populated.
        normal_in_india = 6 <= lat <= 38.5 and 67 <= lng <= 99
        swapped_in_india = 6 <= lng <= 38.5 and 67 <= lat <= 99
        # GeoJSON mandates [longitude, latitude], but some legacy records were
        # saved as [latitude, longitude] even after being labelled Point. Prefer
        # the ordering that places the point inside India's geographic bounds.
        # This range-based check is country-neutral unless one ordering uniquely
        # matches the supported India bounds; all other countries retain the
        # documented coordinate order.
        if swapped_in_india and not normal_in_india:
            lng, lat = lat, lng
        # Reject invalid coordinates instead of letting a malformed pair generate
        # a plausible-looking but wildly incorrect OSRM distance.
        if not (-180 <= lng <= 180 and -90 <= lat <= 90):
            raise ValueError("Coordinates are outside valid longitude/latitude ranges")
        return lng, lat

    for key in ("location", "farmLocation", "coordinates", "geoLocation"):
        value = doc.get(key)
        if isinstance(value, dict):
            coords = value.get("coordinates")
            if isinstance(coords, (list, tuple)) and len(coords) >= 2:
                try:
                    is_geojson = str(value.get("type") or "").lower() == "point"
                    return normalize(float(coords[0]), float(coords[1]), is_geojson)
                except (TypeError, ValueError):
                    continue
            lat = value.get("latitude", value.get("lat"))
            lng = value.get("longitude", value.get("lng", value.get("lon")))
            if lat is not None and lng is not None:
                try:
                    return normalize(float(lng), float(lat))
                except (TypeError, ValueError):
                    continue
        if isinstance(value, (list, tuple)) and len(value) >= 2:
            try:
                return normalize(float(value[0]), float(value[1]))
            except (TypeError, ValueError):
                continue
    lat = doc.get("latitude", doc.get("lat"))
    lng = doc.get("longitude", doc.get("lng", doc.get("lon")))
    if lat is not None and lng is not None:
        try:
            return normalize(float(lng), float(lat))
        except (TypeError, ValueError):
            return None
    return None


async def _road_distance_km_between(
    start: Tuple[float, float], end: Tuple[float, float]
) -> Optional[float]:
    """Return actual driving-road distance from OSRM, or None when unavailable."""
    try:
        url = (
            "https://router.project-osrm.org/route/v1/driving/"
            f"{start[0]},{start[1]};{end[0]},{end[1]}"
        )
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(url, params={"overview": "false"})
            response.raise_for_status()
            routes = response.json().get("routes") or []
            if not routes or routes[0].get("distance") is None:
                return None
            return round(float(routes[0]["distance"]) / 1000.0, 1)
    except Exception as exc:
        logger.warning("B2B road distance lookup failed; using validated straight-line distance: %s", exc)
        return None

async def _geocode_indian_district(district: str) -> Optional[Tuple[float, float]]:
    """Resolve a Tamil Nadu district to (longitude, latitude) as a recovery path."""
    if not district or not district.strip():
        return None
    try:
        async with httpx.AsyncClient(timeout=8.0, headers={"User-Agent": "AgriConnect-B2B-routing/1.0"}) as client:
            response = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": district.strip() + ", Tamil Nadu, India", "format": "jsonv2", "limit": 1, "countrycodes": "in"},
            )
            response.raise_for_status()
            results = response.json()
            if not results:
                return None
            lat, lon = float(results[0]["lat"]), float(results[0]["lon"])
            if not (6 <= lat <= 14.5 and 76 <= lon <= 81.5):
                return None
            return lon, lat
    except Exception as exc:
        logger.warning("B2B district geocoding failed for %s: %s", district, exc)
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
    # requiredDate is commonly a date-only value from the business form.
    # Resolve the chosen morning delivery slot before calculating preparation,
    # pickup and transfer deadlines; treating the date as midnight can reject
    # valid deliveries or incorrectly report them as feasible.
    delivery_deadline = _parse_b2b_delivery_deadline(rfq)
    cross_district_transfer = str(route.get("sourceWarehouseId")) != str(route.get("destinationWarehouseId"))
    if isinstance(delivery_deadline, datetime):
        # Cross-district orders need a two-day lead: farm pickup on D-2,
        # source receiving/processing and transfer on D-1, business delivery on D.
        # Same-district orders can be prepared and collected on D-1.
        preparation_days_before = 2 if cross_district_transfer else 1
        preparation_day = (delivery_deadline - timedelta(days=preparation_days_before)).date()
        preparation_deadline = datetime.combine(preparation_day, datetime.min.time()).replace(hour=16)
        planned_pickup_deadline = datetime.combine(preparation_day, datetime.min.time()).replace(hour=18)
        planned_transfer_dispatch = (delivery_deadline - timedelta(days=1)).date().isoformat() if cross_district_transfer else None
    else:
        preparation_deadline = None
        planned_pickup_deadline = None
        planned_transfer_dispatch = None
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
        "requiredDate": delivery_deadline,
        "deliveryTimeSlot": rfq.get("deliveryTimeSlot"),
        "deliveryDeadline": delivery_deadline,
        # Plan farmer preparation and pickup before the business delivery. For
        # long-distance district transfers, dispatch is planned for the previous
        # calendar day; warehouse staff must bring pickup earlier if route cutoff
        # or estimated transit time requires it.
        "farmerPrepareBy": preparation_deadline,
        "pickupDate": planned_transfer_dispatch,
        "pickupDeadline": planned_pickup_deadline,
        "pickupWindowStart": "18:00",
        "pickupWindowEnd": "23:59",
        "transferDispatchDate": planned_transfer_dispatch if cross_district_transfer else None,
        "transferTimingRule": (
            "Dispatch one day before delivery; warehouse must calculate travel time and move pickup earlier when transit or cutoff requires it."
            if cross_district_transfer and delivery_deadline
            else "Local warehouse delivery; follow the assigned pickup deadline."
        ),
        "schedulePlanningStatus": "pending_route_feasibility" if cross_district_transfer and delivery_deadline else ("scheduled" if delivery_deadline else "delivery_date_missing"),
        "deliveryCity": rfq.get("deliveryCity"),
        "deliveryState": rfq.get("deliveryState"),
        "deliveryAddress": rfq.get("deliveryAddress"),
        "expectedDeliveryDate": offer.get("expectedDeliveryDate"),
        "paymentMode": (accept.paymentMode if accept and accept.paymentMode else "cod"),
        "advanceAmount": float(accept.advanceAmount) if accept and accept.advanceAmount else 0.0,
        "paymentStatus": PAYMENT_PENDING,
        "status": ORDER_READY_FOR_PICKUP,
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

class RFQProductLine(BaseModel):
    productName: str = Field(..., min_length=1, max_length=120)
    category: Optional[str] = None
    quantityKg: Optional[float] = Field(None, gt=0)
    quantityPerDeliveryKg: Optional[float] = Field(None, gt=0)
    unit: str = "kg"
    qualityGrade: Optional[str] = None
    priceCeilingPerKg: Optional[float] = Field(None, gt=0)
    budgetMinPerKg: Optional[float] = Field(None, ge=0)
    budgetMaxPerKg: Optional[float] = Field(None, gt=0)
    notes: Optional[str] = None


class RFQCreate(BaseModel):
    productName: Optional[str] = None
    products: Optional[List[RFQProductLine]] = None
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
    recurring: bool = False
    recurrenceFrequency: Optional[str] = None
    recurrenceInterval: int = Field(1, ge=1, le=12)
    scheduleStartDate: Optional[datetime] = None
    scheduleEndDate: Optional[datetime] = None
    contractRequired: bool = False
    paymentTerms: Optional[str] = None
    cancellationTerms: Optional[str] = None
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

    product_lines = [item.model_dump() for item in (data.products or [])]
    if not product_lines and data.productName:
        product_lines = [{
            "productName": data.productName,
            "category": data.category,
            "quantityKg": data.quantityKg,
            "quantityPerDeliveryKg": data.quantityPerWeekKg if data.recurring else None,
            "unit": "kg",
            "qualityGrade": data.qualityGrade,
            "priceCeilingPerKg": data.priceCeilingPerKg,
            "budgetMinPerKg": data.budgetMinPerKg,
            "budgetMaxPerKg": data.budgetMaxPerKg,
            "notes": None,
        }]
    if not product_lines:
        raise HTTPException(status_code=400, detail="Add at least one product to the RFQ")
    normalized_names = [str(line.get("productName") or "").strip().casefold() for line in product_lines]
    if any(not name for name in normalized_names):
        raise HTTPException(status_code=400, detail="Every product must have a name")
    if len(set(normalized_names)) != len(normalized_names):
        raise HTTPException(status_code=400, detail="Remove duplicate product names from this RFQ")
    for line in product_lines:
        quantity = line.get("quantityPerDeliveryKg") if data.recurring else line.get("quantityKg")
        if not quantity or float(quantity) <= 0:
            raise HTTPException(status_code=400, detail=f"Enter a valid {'per-delivery' if data.recurring else 'one-off'} quantity for {line['productName']}")
    primary_product = product_lines[0]
    if not data.productName:
        data.productName = str(primary_product["productName"]).strip()
    if data.category is None:
        data.category = primary_product.get("category")
    if data.qualityGrade is None:
        data.qualityGrade = primary_product.get("qualityGrade")
    if not data.priceCeilingPerKg:
        data.priceCeilingPerKg = primary_product.get("priceCeilingPerKg")
    if data.budgetMinPerKg is None:
        data.budgetMinPerKg = primary_product.get("budgetMinPerKg")
    if data.budgetMaxPerKg is None:
        data.budgetMaxPerKg = primary_product.get("budgetMaxPerKg")
    if data.recurring and not data.quantityPerWeekKg:
        data.quantityPerWeekKg = float(primary_product.get("quantityPerDeliveryKg") or 0)
    if not data.recurring and not data.quantityKg:
        data.quantityKg = float(primary_product.get("quantityKg") or 0)

    if data.recurring and not data.quantityPerWeekKg:
        raise HTTPException(status_code=400, detail="quantityPerWeekKg is required for recurring RFQs")
    if data.recurring and (not data.recurrenceFrequency or not data.scheduleStartDate or not data.scheduleEndDate):
        raise HTTPException(status_code=400, detail="Recurring RFQs require frequency, schedule start date and schedule end date")
    if data.recurring and data.recurrenceFrequency not in ("daily", "weekly", "monthly"):
        raise HTTPException(status_code=400, detail="recurrenceFrequency must be daily, weekly or monthly")
    if data.recurring and data.scheduleStartDate and data.scheduleEndDate:
        start_date = data.scheduleStartDate.replace(tzinfo=None)
        end_date = data.scheduleEndDate.replace(tzinfo=None)
        if end_date < start_date:
            raise HTTPException(status_code=400, detail="Schedule end date must be on or after the start date")
        if start_date < datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0):
            raise HTTPException(status_code=400, detail="Schedule start date cannot be in the past")
    if data.paymentTerms and data.paymentTerms not in ("advance", "cod", "net_7", "net_15", "net_30"):
        raise HTTPException(status_code=400, detail="Unsupported payment terms")
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
        "products": product_lines,
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
        "recurrenceFrequency": data.recurrenceFrequency if data.recurring else None,
        "recurrenceInterval": data.recurrenceInterval if data.recurring else None,
        "scheduleStartDate": data.scheduleStartDate if data.recurring else None,
        "scheduleEndDate": data.scheduleEndDate if data.recurring else None,
        "contractRequired": bool(data.recurring and data.contractRequired),
        "paymentTerms": data.paymentTerms if data.recurring else None,
        "cancellationTerms": data.cancellationTerms if data.recurring else None,
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
    # A recurring RFQ creates a contract, not an immediate fulfillment order.
    # The first B2B order must be created only by the schedule generator when due;
    # otherwise the accepted quote and the first schedule would create duplicate deliveries.
    order_docs = []
    if not rfq.get("recurring"):
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
                if order_docs:
                    await order_repo.collection.insert_many(order_docs, ordered=True, session=session)
                # A recurring RFQ creates one pending supply agreement per accepted farmer quote.
                # The farmer must accept the contract before the scheduled-order generator can run.
                if live_rfq.get("recurring"):
                    for accepted_offer, accepted_qty, _ in order_specs:
                        existing_contract = await contract_repo.collection.find_one(
                            {"rfqId": rfq_id, "offerId": accepted_offer["_id"], "deletedAt": None},
                            session=session,
                        )
                        if not existing_contract:
                            schedule_start = live_rfq.get("scheduleStartDate") or live_rfq.get("requiredDate") or now
                            schedule_end = live_rfq.get("scheduleEndDate")
                            await contract_repo.collection.insert_one({
                                "contractNumber": await _next_number("CTR", contract_repo),
                                "businessUserId": ObjectId(current_user["_id"]),
                                "farmerId": accepted_offer["farmerId"],
                                "farmerName": accepted_offer.get("farmName") or accepted_offer.get("farmerName") or "Farmer",
                                "businessName": ((await profile_repo.find_one({"userId": ObjectId(current_user["_id"]), "deletedAt": None})) or {}).get("companyName") or current_user.get("name") or "Business",
                                "rfqId": rfq_id,
                                "rfqNumber": live_rfq.get("rfqNumber"),
                                "offerId": accepted_offer["_id"],
                                "cropName": live_rfq.get("productName"),
                                "quantityPerDeliveryKg": float(accepted_qty),
                                "quantityPerMonthKg": float(accepted_qty),
                                "pricePerKg": float(accepted_offer.get("pricePerKg") or 0),
                                "frequency": live_rfq.get("recurrenceFrequency") or "weekly",
                                "recurrenceInterval": int(live_rfq.get("recurrenceInterval") or 1),
                                "startDate": schedule_start,
                                "endDate": schedule_end,
                                "durationMonths": max(1, int(((schedule_end - schedule_start).days / 30) if isinstance(schedule_end, datetime) and isinstance(schedule_start, datetime) else 1)),
                                "nextDeliveryAt": schedule_start,
                                "paymentTerms": live_rfq.get("paymentTerms") or "net_7",
                                "cancellationTerms": live_rfq.get("cancellationTerms"),
                                "deliveryAddress": live_rfq.get("deliveryAddress"),
                                "deliveryCity": live_rfq.get("deliveryCity"),
                                "deliveryState": live_rfq.get("deliveryState"),
                                "deliveryDistrict": live_rfq.get("deliveryDistrict"),
                                "deliveryLocation": live_rfq.get("deliveryLocation"),
                                "deliveryTimeSlot": live_rfq.get("deliveryTimeSlot"),
                                "status": "pending",
                                "generatedScheduleKeys": [],
                                "createdAt": now,
                                "updatedAt": now,
                                "deletedAt": None,
                            }, session=session)
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

    event_time = datetime.utcnow()
    update: Dict[str, Any] = {"status": data.status, "updatedAt": event_time}
    # Persist a customer-visible audit trail on the original B2B order. Every
    # role action adds a timeline event so the business buyer can track the
    # whole process without depending on separate pickup/transfer collections.
    actor_id = str(current_user.get("_id") or current_user.get("id") or "")
    def add_status_history(target: Dict[str, Any], *, event_status: Optional[str] = None, details: Optional[str] = None) -> None:
        history = list(order.get("statusHistory") or [])
        history.append({
            "status": event_status or data.status,
            "previousStatus": current,
            "actorRole": str(role or "unknown"),
            "actorId": actor_id,
            "details": details or data.qualityNotes or "",
            "timestamp": event_time,
        })
        target["statusHistory"] = history

    if data.status == ORDER_CANCELLED:
        if current != ORDER_CONFIRMED:
            raise HTTPException(status_code=400, detail="Only confirmed orders can be cancelled")
        update["cancelledAt"] = event_time
        add_status_history(update, details="Order cancelled")
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
            add_status_history(update, event_status="quality_check", details=f"Quality check {data.qualityCheck}" + (f": {data.qualityNotes}" if data.qualityNotes else ""))
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
        if data.status == ORDER_READY_FOR_PICKUP:
            if order.get("qualityCheck") != "passed":
                raise HTTPException(status_code=400, detail="Pass the quality check before marking this order ready for pickup.")
            # Never let a one-time B2B order with a shortage enter pickup as if
            # the full contracted quantity were packed. Partial delivery requires
            # an explicit business-side resolution before warehouse collection.
            required_quantity = float(order.get("quantityKg") or 0)
            packed_quantity = float(order.get("packedQuantityKg") or 0)
            if required_quantity > 0 and packed_quantity + 1e-6 < required_quantity:
                raise HTTPException(
                    status_code=409,
                    detail=f"Packed quantity is {packed_quantity:g} kg but the order requires {required_quantity:g} kg. Record and resolve the shortage with the business before marking ready for pickup.",
                )
            # Orders may enter the claimable pickup queue before a warehouse
            # is selected. The warehouse that assigns the registered pickup team
            # becomes the operational source warehouse. If a warehouse is already
            # specified, validate it rather than silently accepting a stale ID.
            pickup_warehouse_id = str(
                order.get("pickupWarehouseId")
                or order.get("assignedWarehouseId")
                or order.get("sourceWarehouseId")
                or order.get("warehouseId")
                or order.get("receivingWarehouseId")
                or ""
            )
            if pickup_warehouse_id:
                if not ObjectId.is_valid(pickup_warehouse_id):
                    raise HTTPException(
                        status_code=409,
                        detail="The configured pickup warehouse ID is invalid. Clear or correct the warehouse assignment before continuing.",
                    )
                pickup_warehouse = await warehouse_repo.find_one({
                    "_id": ObjectId(pickup_warehouse_id), "deletedAt": None
                })
                if not pickup_warehouse:
                    raise HTTPException(
                        status_code=409,
                        detail="The configured pickup warehouse is not registered. Correct the warehouse assignment or let a warehouse claim this order from the pickup queue.",
                    )
                update["pickupWarehouseId"] = pickup_warehouse_id
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
            update["deliveredAt"] = event_time
        add_status_history(update, details=data.qualityNotes or "")
        await order_repo.update({"_id": order["_id"]}, update)

        # Publish a farmer-marked B2B order to the existing delivery-partner
        # pickup-route queue. That queue reads warehouse_pickup_routes, so merely
        # changing b2b_orders.status leaves the order invisible to pickup partners.
        if data.status == ORDER_READY_FOR_PICKUP:
            pickup_warehouse_id = str(
                order.get("pickupWarehouseId")
                or order.get("assignedWarehouseId")
                or order.get("sourceWarehouseId")
                or order.get("warehouseId")
                or order.get("receivingWarehouseId")
                or ""
            )
            if pickup_warehouse_id and ObjectId.is_valid(pickup_warehouse_id):
                pickup_warehouse = await warehouse_repo.find_one({
                    "_id": ObjectId(pickup_warehouse_id), "deletedAt": None
                })
                if pickup_warehouse:
                    existing_route = await warehouse_pickup_route_repository.find_one({
                        "b2bOrderId": str(order["_id"]), "deletedAt": None,
                        "status": {"$nin": ["cancelled", "closed", "archived"]},
                    })
                    if not existing_route:
                        now = datetime.utcnow()
                        farmer_doc = None
                        farmer_id = str(order.get("farmerId") or "")
                        if ObjectId.is_valid(farmer_id):
                            farmer_doc = await farmer_repository.find_one({"_id": ObjectId(farmer_id), "deletedAt": None})
                        farmer_location = (
                            (farmer_doc or {}).get("location")
                            or (farmer_doc or {}).get("farmLocation")
                            or (farmer_doc or {}).get("address")
                            or {}
                        )
                        if isinstance(farmer_location, str):
                            farmer_location = {"formattedAddress": farmer_location}
                        farmer_name = (
                            (farmer_doc or {}).get("farmName")
                            or (farmer_doc or {}).get("ownerName")
                            or (farmer_doc or {}).get("name")
                            or order.get("farmerName")
                            or "Farmer"
                        )
                        quantity = float(order.get("packedQuantityKg") or order.get("quantityKg") or order.get("quantity") or 0)
                        order_number = str(order.get("orderNumber") or order.get("orderNo") or f"B2B-{str(order['_id'])[-6:]}")
                        # The warehouse Farm Collection queue reads warehouse_collections,
                        # while the partner route page reads warehouse_pickup_routes.
                        # Create one collection job so the same B2B order appears in both.
                        collection_jobs = await warehouse_collection_repository.get_by_order(str(order["_id"]), "b2b")
                        collection_job = next(
                            (job for job in collection_jobs if str(job.get("status") or "") not in
                             ("collected", "departed_farm", "arrived_warehouse", "cancelled")),
                            None,
                        )
                        collection_id = str(collection_job.get("_id")) if collection_job else None
                        if not collection_job:
                            collection_id = await warehouse_collection_repository.create_job({
                                "warehouseId": ObjectId(pickup_warehouse_id),
                                "orderId": order["_id"],
                                "b2bOrderId": str(order["_id"]),
                                "orderNumber": order_number,
                                "farmerId": ObjectId(farmer_id) if ObjectId.is_valid(farmer_id) else None,
                                "farmerName": farmer_name,
                                "productName": order.get("productName") or "B2B produce",
                                "quantity": quantity,
                                "pickupLocation": farmer_location if isinstance(farmer_location, dict) else {},
                                "pickupAddress": (
                                    (farmer_doc or {}).get("farmAddress")
                                    or (farmer_doc or {}).get("address")
                                    or order.get("farmAddress")
                                    or "Farm address not provided"
                                ),
                                "collectionType": "b2b",
                                "status": "ready_for_pickup",
                                "createdFrom": "b2b_order",
                            })
                        await warehouse_pickup_route_repository.create_route({
                            "routeNumber": order_number + "-PICKUP",
                            "routeDate": now.strftime("%Y-%m-%d"),
                            "warehouseId": ObjectId(pickup_warehouse_id),
                            "status": "offered",
                            "routeType": "b2b_farm_pickup",
                            "isB2BPickup": True,
                            "b2bOrderId": str(order["_id"]),
                            "orderIds": [str(order["_id"])],
                            "totalStops": 1,
                            "totalOrders": 1,
                            "totalQuantity": quantity,
                            "stops": [{
                                "sequence": 1,
                                "farmKey": f"b2b:{str(order['_id'])}",
                                "b2bOrderId": str(order["_id"]),
                                "collectionId": collection_id,
                                "orderId": str(order["_id"]),
                                "orderNumber": order_number,
                                "farmerId": farmer_id or None,
                                "farmerName": farmer_name,
                                "productName": order.get("productName") or "B2B produce",
                                "quantity": quantity,
                                "status": "ready_for_pickup",
                                "pickupAddress": (
                                    (farmer_doc or {}).get("farmAddress")
                                    or (farmer_doc or {}).get("address")
                                    or order.get("farmAddress")
                                    or "Farm address not provided"
                                ),
                                "pickupLocation": farmer_location if isinstance(farmer_location, dict) else {},
                                "orders": [{
                                    "b2bOrderId": str(order["_id"]),
                                    "collectionId": collection_id,
                                    "orderId": str(order["_id"]),
                                    "orderNumber": order_number,
                                    "farmerId": farmer_id or None,
                                    "farmerName": farmer_name,
                                    "productName": order.get("productName") or "B2B produce",
                                    "quantity": quantity,
                                    "status": "ready_for_pickup",
                                    "pickupAddress": (
                                        (farmer_doc or {}).get("farmAddress")
                                        or (farmer_doc or {}).get("address")
                                        or order.get("farmAddress")
                                        or "Farm address not provided"
                                    ),
                                    "pickupLocation": farmer_location if isinstance(farmer_location, dict) else {},
                                }],
                            }],
                            "createdBy": ObjectId(str(current_user["_id"])) if ObjectId.is_valid(str(current_user.get("_id") or "")) else None,
                            "createdAt": now,
                        })
            else:
                logger.warning(
                    "B2B order %s is ready for pickup but has no valid assigned/source warehouse; "
                    "it cannot be offered on the warehouse pickup routes page until a warehouse is assigned.",
                    str(order.get("_id")),
                )

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
    # Both fields are accepted because older UI forms use qualityNotes while
    # the current B2B fulfillment page submits notes.
    notes: Optional[str] = None
    qualityNotes: Optional[str] = None
    pickupTeam: Optional[str] = None
    transferTeam: Optional[str] = None
    transferTeamName: Optional[str] = None
    transferVehicle: Optional[str] = None
    vehicle: Optional[str] = None
    receivedQuantityKg: Optional[float] = Field(None, ge=0)
    qualityCheck: Optional[str] = None
    destinationWarehouseId: Optional[str] = None
    fulfillmentRoute: Optional[str] = None
    deliveryPartner: Optional[str] = None
    estimatedTransferHours: Optional[float] = Field(None, gt=0)
    transferDispatchCutoff: Optional[str] = None
    newDeliveryDeadline: Optional[str] = None
    newDeliveryTimeSlot: Optional[str] = None
    rescheduleReason: Optional[str] = None
    notes: Optional[str] = None


def _b2b_warehouse_workflow_is_complete(order: Dict[str, Any]) -> bool:
    """Whether this order has reached its terminal warehouse-workflow stage.

    Long-distance orders finish the warehouse workflow when the destination
    warehouse has received and passed inspection. Direct orders finish only
    after delivery and business receipt confirmation.
    """
    route = str(order.get("fulfillmentRoute") or "").strip().lower()
    source_id = str(order.get("sourceWarehouseId") or order.get("warehouseId") or "")
    destination_id = str(order.get("destinationWarehouseId") or "")
    different_warehouse = bool(source_id and destination_id and source_id != destination_id)
    long_distance = route in ("long_distance", "inter_warehouse", "transfer") or different_warehouse
    if long_distance:
        return bool(
            order.get("destinationReceivedAt")
            and str(order.get("destinationQualityCheck") or "").strip().lower() == "passed"
            and order.get("destinationReceivedQuantityKg") is not None
        )
    return bool(
        order.get("status") == ORDER_COMPLETED
        and order.get("deliveredAt")
        and order.get("completedAt")
    )


@router.get("/warehouse/fulfillment/completed")
async def list_b2b_completed_warehouse_fulfillment(current_user: dict = Depends(get_current_user)):
    """Read-only archive only after the business buyer confirms receipt."""
    role = str(current_user.get("role") or "").lower()
    allowed = ("warehouse", "warehouse_manager", "warehouse_staff", "admin", "super_admin")
    if role not in allowed:
        raise HTTPException(status_code=403, detail="Warehouse role required")

    # Include legacy rows with stale status values, then decide completion from
    # terminal workflow evidence rather than status alone.
    # Query all non-deleted B2B orders in the bounded archive window. Legacy
    # rows can have a status reset to warehouse_received, while the decisive
    # destination receipt/inspection fields remain populated.
    candidates = await order_repo.find_many(
        {"deletedAt": None},
        sort=[("updatedAt", -1)],
        limit=2000,
    )
    archived = [order for order in candidates if _b2b_warehouse_workflow_is_complete(order)]

    warehouse_id = await _resolve_b2b_current_warehouse_id(current_user) if role not in ("admin", "super_admin") else ""
    if role not in ("admin", "super_admin"):
        if not ObjectId.is_valid(warehouse_id):
            raise HTTPException(status_code=409, detail="Your warehouse account is not linked to a registered warehouse.")
        warehouse_doc = await warehouse_repo.get_by_id(warehouse_id)
        warehouse_names = {
            str((warehouse_doc or {}).get(key) or "").strip().casefold()
            for key in ("name", "warehouseName", "displayName", "code")
            if (warehouse_doc or {}).get(key)
        }
        filtered = []
        for order in archived:
            related_warehouses = {
                str(order.get(key) or "")
                for key in ("sourceWarehouseId", "assignedWarehouseId", "warehouseId", "pickupWarehouseId", "receivedAtWarehouseId", "destinationWarehouseId")
            }
            related_names = {
                str(order.get(key) or "").strip().casefold()
                for key in ("sourceWarehouseName", "assignedWarehouseName", "warehouseName", "pickupWarehouseName", "destinationWarehouseName")
                if order.get(key)
            }
            if warehouse_id in related_warehouses or bool(warehouse_names & related_names):
                filtered.append(order)
        archived = filtered

    for order in archived:
        await _enrich_order(order)
        order["id"] = str(order.get("_id") or order.get("id") or "")
        for key in ("_id", "businessUserId", "farmerId", "rfqId", "offerId", "sourceWarehouseId", "destinationWarehouseId", "pickupAssignedBy", "warehouseReceivedBy", "destinationReceivedBy", "finalDeliveryAssignedBy", "deliveredBy"):
            if order.get(key) is not None:
                order[key] = str(order[key])
    return {"success": True, "data": {"orders": archived, "count": len(archived)}}


@router.get("/warehouse/fulfillment")
async def list_b2b_warehouse_fulfillment(current_user: dict = Depends(get_current_user)):
    """Warehouse-facing queue for B2B orders ready for pickup through final delivery."""
    role = str(current_user.get("role") or "").lower()
    if role not in ("warehouse", "warehouse_manager", "warehouse_staff", "admin", "super_admin", "delivery", "delivery_partner", "delivery_manager"):
        raise HTTPException(status_code=403, detail="Warehouse or delivery role required")
    statuses = [ORDER_READY_FOR_PICKUP, ORDER_PICKED_UP, ORDER_WAREHOUSE_RECEIVED, ORDER_TRANSFER_IN_TRANSIT, ORDER_DESTINATION_RECEIVED, ORDER_IN_TRANSIT, ORDER_DELIVERED]
    orders = await order_repo.find_many({
        "$and": [
            {"deletedAt": None},
            {"$or": [
                {"status": {"$in": statuses}},
                {"warehouseCollectionStatus": {"$in": ["collected", "departed_farm", "arrived_warehouse", "warehouse_arrived"]}},
                {"warehouseFulfillmentStage": {"$in": ["collected", "collection_departed", "warehouse_arrived"]}},
            ]},
        ]
    }, sort=[("updatedAt", -1)], limit=500)
    current_warehouse_id = str(current_user.get("warehouseId") or current_user.get("assignedWarehouseId") or "")
    # Resolve warehouse accounts that store the association on the warehouse
    # document instead of the user/session. Without this, every warehouse login
    # receives the same global B2B queue and can see another warehouse's actions.
    if role in ("warehouse", "warehouse_manager", "warehouse_staff") and not ObjectId.is_valid(current_warehouse_id):
        user_id = str(current_user.get("_id") or current_user.get("id") or "")
        user_values: List[Any] = [user_id]
        if ObjectId.is_valid(user_id):
            user_values.append(ObjectId(user_id))
        user_email = str(current_user.get("email") or "").strip().lower()
        warehouse_links = [
            {"userId": {"$in": user_values}},
            {"user_id": {"$in": user_values}},
            {"managerId": {"$in": user_values}},
            {"managerUserId": {"$in": user_values}},
            {"ownerId": {"$in": user_values}},
            {"warehouseManagerId": {"$in": user_values}},
            {"accountId": {"$in": user_values}},
            {"createdBy": {"$in": user_values}},
            {"staffUserIds": {"$in": user_values}},
            {"staffIds": {"$in": user_values}},
            {"members.userId": {"$in": user_values}},
            {"members.user_id": {"$in": user_values}},
            {"users.userId": {"$in": user_values}},
        ]
        if user_email:
            warehouse_links.extend([
                {"managerEmail": user_email},
                {"contactEmail": user_email},
                {"email": user_email},
                {"staffEmails": user_email},
                {"members.email": user_email},
                {"users.email": user_email},
            ])
        linked_warehouse = await warehouse_repo.find_one({
            "$and": [
                {"deletedAt": None},
                {"$or": warehouse_links},
            ]
        })
        if linked_warehouse:
            current_warehouse_id = str(linked_warehouse.get("_id") or "")


    # Reconcile legacy B2B orders from their authoritative farm-collection and
    # pickup-route records. Older jobs may not have written status to b2b_orders,
    # even though the pickup partner has already returned the route to warehouse.
    # This makes the warehouse queue self-healing when it is opened/refreshed.
    for order in orders:
        order_id = str(order.get("_id") or "")
        if order.get("status") == ORDER_READY_FOR_PICKUP and ObjectId.is_valid(order_id):
            collection_job = await warehouse_collection_repository.find_one({
                "$and": [
                    {"deletedAt": None},
                    {"$or": [
                        {"b2bOrderId": order_id},
                        {"b2bOrderId": ObjectId(order_id)},
                        {"orderId": order_id},
                        {"orderId": ObjectId(order_id)},
                        {"orderNumber": order.get("orderNumber")} if order.get("orderNumber") else {"_id": {"$exists": False}},
                        {"b2bOrderNumber": order.get("orderNumber")} if order.get("orderNumber") else {"_id": {"$exists": False}},
                    ]},
                    {"status": {"$in": ["collected", "departed_farm", "arrived_warehouse"]}},
                ]
            })
            if collection_job:
                route_id = str(collection_job.get("pickupRouteId") or "")
                route = await warehouse_pickup_route_repository.get_by_id(route_id) if ObjectId.is_valid(route_id) else None
                route_status = str((route or {}).get("status") or "").lower()
                collection_status = str(collection_job.get("status") or "").lower()
                if collection_status in ("collected", "departed_farm", "arrived_warehouse") or route_status in ("completed", "returned_to_warehouse"):
                    next_status = ORDER_WAREHOUSE_RECEIVED if collection_status == "arrived_warehouse" and collection_job.get("warehouseReceivedAt") else ORDER_PICKED_UP
                    sync_update = {
                        "status": next_status,
                        "warehouseCollectionStatus": collection_status or ("arrived_warehouse" if route_status == "returned_to_warehouse" else "departed_farm"),
                        "warehouseFulfillmentStage": "warehouse_arrived" if route_status == "returned_to_warehouse" else ("collection_departed" if collection_status == "departed_farm" else collection_status),
                        "updatedAt": datetime.utcnow(),
                    }
                    if next_status == ORDER_PICKED_UP:
                        sync_update["pickedUpAt"] = collection_job.get("collectedAt") or collection_job.get("departedFarmAt") or datetime.utcnow()
                    await order_repo.update({"_id": ObjectId(order_id)}, sync_update)
                    order.update(sync_update)

        await _enrich_order(order)
        # Expose the number of distinct farmer portions for the B2B-only UI.
        # The frontend uses this to show consolidation controls only when needed.
        order["b2bFarmerCount"] = 1
        if order.get("rfqId") is not None and order.get("businessUserId") is not None:
            sibling_rows = await order_repo.find_many({
                "rfqId": order.get("rfqId"),
                "businessUserId": order.get("businessUserId"),
                "deletedAt": None,
            }, limit=500)
            farmer_keys = {
                str(p.get("farmerId") or p.get("farmerUserId") or (p.get("farmerInfo") or {}).get("id") or (p.get("farmer") or {}).get("id") or p.get("_id"))
                for p in sibling_rows
            }
            order["b2bFarmerCount"] = max(1, len(farmer_keys))
        # Expose a stable frontend identifier while retaining the Mongo ID as a string.
        order["id"] = str(order.get("_id"))
        source_id = str(order.get("sourceWarehouseId") or order.get("warehouseId") or order.get("receivedAtWarehouseId") or "")
        destination_id = str(order.get("destinationWarehouseId") or "")
        # A transfer remains the same B2B order, but is visible in both warehouse
        # work queues with an explicit side label: source = outbound, destination = inbound.
        if current_warehouse_id and destination_id and current_warehouse_id == destination_id and source_id and source_id != destination_id:
            # Destination warehouse must see only the inbound/receipt workflow,
            # even if an older record still carries a stale source-stage status.
            order["warehouseTransferSide"] = "destination_received" if order.get("status") == ORDER_DESTINATION_RECEIVED else "destination_incoming"
        elif current_warehouse_id and source_id and current_warehouse_id == source_id and destination_id and source_id != destination_id and order.get("status") in (ORDER_TRANSFER_IN_TRANSIT, ORDER_DESTINATION_RECEIVED):
            order["warehouseTransferSide"] = "source_outgoing"
        elif order.get("status") == ORDER_TRANSFER_IN_TRANSIT:
            order["warehouseTransferSide"] = "transfer_in_transit"
        else:
            order["warehouseTransferSide"] = None
        for key in ("_id", "businessUserId", "farmerId", "rfqId", "offerId", "sourceWarehouseId", "destinationWarehouseId", "pickupAssignedBy", "warehouseReceivedBy", "destinationReceivedBy", "finalDeliveryAssignedBy", "deliveredBy"):
            if order.get(key) is not None:
                order[key] = str(order[key])

    # Warehouse managers should only see actionable stages for the warehouse
    # they are signed into. Source warehouses handle farm receipt and dispatch;
    # destination warehouses see a transfer only after it has been dispatched.
    # Admins retain the global oversight queue.
    if role in ("warehouse", "warehouse_manager", "warehouse_staff") and ObjectId.is_valid(current_warehouse_id):
        scoped_orders = []
        for order in orders:
            source_id = str(order.get("sourceWarehouseId") or order.get("warehouseId") or order.get("receivedAtWarehouseId") or order.get("pickupWarehouseId") or "")
            destination_id = str(order.get("destinationWarehouseId") or "")
            status = str(order.get("status") or "")
            if status == ORDER_TRANSFER_IN_TRANSIT:
                if current_warehouse_id in (source_id, destination_id):
                    scoped_orders.append(order)
            elif status == ORDER_DESTINATION_RECEIVED:
                if current_warehouse_id == destination_id:
                    scoped_orders.append(order)
            elif status in (ORDER_IN_TRANSIT, ORDER_DELIVERED):
                # Keep completed/read-only tracking visible only to the warehouse
                # that last handled the stock or the destination warehouse.
                if current_warehouse_id in (source_id, destination_id):
                    scoped_orders.append(order)
            elif status == ORDER_READY_FOR_PICKUP and not str(order.get("pickupTeam") or "").strip():
                # Any warehouse may see an unclaimed pickup order. The assigning
                # warehouse becomes its source/pickup warehouse at claim time;
                # _build_order may have prefilled a route suggestion that must
                # not hide the order from the warehouse operator who can collect it.
                scoped_orders.append(order)
            elif current_warehouse_id == source_id:
                scoped_orders.append(order)
        orders = scoped_orders

    # Always hydrate the claimable farm-pickup queue independently of the
    # general logistics query/scoping. The summary is database-wide by design,
    # but a stale/legacy warehouse assignment must never make an unassigned
    # ready_for_pickup order disappear from the actionable list.
    ready_pickup_orders = await order_repo.find_many({
        "$and": [
            {"deletedAt": None},
            {"status": ORDER_READY_FOR_PICKUP},
            {"$or": [
                {"pickupTeam": {"$exists": False}},
                {"pickupTeam": None},
                {"pickupTeam": ""},
            ]},
        ]
    }, sort=[("updatedAt", -1)], limit=500)
    existing_order_ids = {str(item.get("_id") or item.get("id") or "") for item in orders}
    for pickup_order in ready_pickup_orders:
        pickup_id = str(pickup_order.get("_id") or pickup_order.get("id") or "")
        if not pickup_id or pickup_id in existing_order_ids:
            continue
        await _enrich_order(pickup_order)
        pickup_order["id"] = pickup_id
        pickup_order["b2bFarmerCount"] = 1
        for key in ("_id", "businessUserId", "farmerId", "rfqId", "offerId", "sourceWarehouseId", "destinationWarehouseId", "pickupAssignedBy", "warehouseReceivedBy", "destinationReceivedBy", "finalDeliveryAssignedBy", "deliveredBy"):
            if pickup_order.get(key) is not None:
                pickup_order[key] = str(pickup_order[key])
        pickup_order["warehouseTransferSide"] = None
        orders.append(pickup_order)
        existing_order_ids.add(pickup_id)

    # Terminal workflow records belong only in the archive. This also hides
    # legacy orders whose status was accidentally reset to warehouse_received
    # after destination receipt or business-confirmed delivery.
    orders = [order for order in orders if not _b2b_warehouse_workflow_is_complete(order)]

    # Counts are computed from persisted database queries, not the capped list
    # returned for rendering. Derived workflow stages use server-side predicates.
    base = {"deletedAt": None}
    async def count_status(status: str, extra: Optional[Dict[str, Any]] = None) -> int:
        criteria: Dict[str, Any] = {**base, "status": status}
        if extra:
            criteria.update(extra)
        return await order_repo.count(criteria)

    # Keep source and destination warehouse actions separated. A transfer in
    # transit may be visible to both ends; once received, only the destination
    # warehouse should own the remaining fulfillment actions.
    if role in ("warehouse", "warehouse_manager", "warehouse_staff") and ObjectId.is_valid(current_warehouse_id):
        scoped_orders = []
        for item in orders:
            status = str(item.get("status") or "")
            source_id = str(item.get("sourceWarehouseId") or item.get("receivedAtWarehouseId") or item.get("warehouseId") or "")
            destination_id = str(item.get("destinationWarehouseId") or "")
            if status == ORDER_DESTINATION_RECEIVED:
                if destination_id == current_warehouse_id:
                    scoped_orders.append(item)
                continue
            if status == ORDER_TRANSFER_IN_TRANSIT:
                if source_id == current_warehouse_id or destination_id == current_warehouse_id:
                    scoped_orders.append(item)
                continue
            # A ready-for-pickup order is a claimable work item until a
            # warehouse assigns its approved pickup team. Do not hide it just
            # because an order template contains a suggested/stale source ID.
            if status == ORDER_READY_FOR_PICKUP and not str(item.get("pickupTeam") or "").strip():
                scoped_orders.append(item)
                continue
            if source_id and source_id != current_warehouse_id:
                continue
            scoped_orders.append(item)
        orders = scoped_orders

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

def _parse_b2b_delivery_deadline(order: Dict[str, Any]) -> Optional[datetime]:
    """Return the business delivery deadline as a naive UTC datetime.

    Date-only values are interpreted in India Standard Time and combined with
    the start of the requested delivery slot (for example, "6–9 AM"). Full
    timestamp values retain their explicit timezone when supplied.
    """
    raw = order.get("deliveryDeadline") or order.get("requiredDate") or order.get("scheduledDeliveryDate") or order.get("nextDeliveryAt")
    slot = str(order.get("deliveryTimeSlot") or "").strip()
    parsed: Optional[datetime] = None
    date_only = False
    if isinstance(raw, datetime):
        parsed = raw
        date_only = parsed.hour == 0 and parsed.minute == 0 and parsed.second == 0 and parsed.tzinfo is None
    elif isinstance(raw, str) and raw.strip():
        token = raw.strip()
        try:
            parsed = datetime.fromisoformat(token.replace("Z", "+00:00"))
            date_only = len(token) <= 10 or (
                parsed.hour == 0 and parsed.minute == 0 and parsed.second == 0 and parsed.tzinfo is None
            )
        except (TypeError, ValueError):
            try:
                parsed = datetime.strptime(token[:10], "%Y-%m-%d")
                date_only = True
            except (TypeError, ValueError):
                return None
    if parsed is None:
        return None

    # When the form supplies a date plus a morning slot, the slot's START is
    # the delivery deadline. Common values include "6–9 AM", "7:00 AM - 9:00 AM",
    # and "06:00-09:00". A missing AM/PM on the first time inherits the slot's
    # final AM/PM marker (e.g. 6–9 AM).
    if date_only and slot:
        matches = list(re.finditer(r"(?<!\d)(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?", slot, re.IGNORECASE))
        if matches:
            first = matches[0]
            meridiem = first.group(3) or next(
                (m.group(3) for m in reversed(matches) if m.group(3)), None
            )
            hour = int(first.group(1))
            minute = int(first.group(2) or 0)
            if meridiem:
                if hour < 1 or hour > 12 or minute > 59:
                    return None
                hour = hour % 12 + (12 if meridiem.upper() == "PM" else 0)
            elif hour > 23 or minute > 59:
                return None
            parsed = parsed.replace(hour=hour, minute=minute, second=0, microsecond=0)

    # Naive date-only business schedules are local India time. Convert them to
    # UTC-naive so comparisons against datetime.utcnow() are consistent.
    ist = timezone(timedelta(hours=5, minutes=30))
    if parsed.tzinfo is not None:
        return parsed.astimezone(timezone.utc).replace(tzinfo=None)
    if date_only:
        return parsed.replace(tzinfo=ist).astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _normalized_b2b_business_district(order: Dict[str, Any]) -> str:
    """Read only the B2B buyer's delivery district, never the farmer/order source district."""
    explicit = [
        order.get("deliveryDistrict"),
        order.get("businessDeliveryDistrict"),
        order.get("shippingDistrict"),
    ]
    for key in ("deliveryLocation", "deliveryAddress", "businessAddress", "shippingAddress"):
        value = order.get(key)
        if isinstance(value, dict):
            explicit.extend(value.get(k) for k in ("deliveryDistrict", "district", "districtName", "administrativeDistrict"))
    for value in explicit:
        token = re.sub(r"[^a-z0-9]", "", str(value or "").lower())
        if token:
            return token
    # A string address can be used only as a fallback when a district field was
    # not stored. Remove state/country-like trailing values; never use order.district.
    for key in ("deliveryAddress", "businessAddress", "shippingAddress"):
        value = order.get(key)
        if isinstance(value, str) and value.strip():
            parts = [re.sub(r"[^a-z0-9]", "", p.lower()) for p in value.split(",")]
            parts = [p for p in parts if p and p not in {"india", "tamilnadu", "tn"}]
            if len(parts) >= 2:
                return parts[-1]
    return ""


def _normalized_district(doc: Optional[Dict[str, Any]]) -> str:
    """Return a verified district/locality token from common warehouse/address schemas.

    Explicit administrative district fields win. City/town is a fallback for older
    records that only store the destination as 'locality, district'; state/country
    are deliberately never used as district guesses.
    """
    if not isinstance(doc, dict):
        return ""
    nested_values = []
    for key in ("deliveryLocation", "location", "address", "deliveryAddress", "shippingAddress"):
        value = doc.get(key)
        if isinstance(value, dict):
            nested_values.append(value)
    explicit_keys = ("deliveryDistrict", "district", "districtName", "administrativeDistrict")
    for source in [doc, *nested_values]:
        for key in explicit_keys:
            value = source.get(key)
            token = re.sub(r"[^a-z0-9]", "", str(value or "").lower())
            if token:
                return token
    # Legacy warehouse records often have only city/town. This allows a registered
    # warehouse with city=Perambalur to match a business address ending in Perambalur.
    locality_keys = ("city", "town", "municipality", "locality", "deliveryCity")
    for source in [doc, *nested_values]:
        for key in locality_keys:
            value = source.get(key)
            token = re.sub(r"[^a-z0-9]", "", str(value or "").lower())
            if token:
                return token
    raw_values = []
    for key in ("deliveryAddress", "businessAddress", "shippingAddress", "address", "deliveryLocation", "formattedAddress"):
        value = doc.get(key)
        if isinstance(value, str) and value.strip():
            raw_values.append(value)
        elif isinstance(value, dict):
            for address_key in ("formattedAddress", "addressLine1", "address_line1", "street", "city", "town", "municipality", "locality"):
                part = value.get(address_key)
                if isinstance(part, str) and part.strip():
                    raw_values.append(part)
    for raw in raw_values:
        parts = [re.sub(r"[^a-z0-9]", "", part.lower()) for part in raw.split(",")]
        parts = [part for part in parts if part and part not in {"india", "tamilnadu"}]
        if len(parts) >= 2:
            return parts[-1]
    return ""


@router.get("/warehouse/fulfillment/{order_id}/route-recommendation")
async def recommend_b2b_fulfillment_route(
    order_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Recommend B2B routing strictly by district, never by a kilometre threshold."""
    role = str(current_user.get("role") or "").lower()
    if role not in ("warehouse", "warehouse_manager", "warehouse_staff", "admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Only warehouse staff can request B2B fulfillment routing")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid B2B order ID")
    order = await order_repo.find_one({"_id": ObjectId(order_id), "deletedAt": None})
    if not order:
        raise HTTPException(status_code=404, detail="B2B order not found")
    if order.get("status") != ORDER_WAREHOUSE_RECEIVED:
        raise HTTPException(status_code=400, detail="Routing is available only after warehouse receipt")
    if order.get("warehouseQualityCheck") != "passed":
        raise HTTPException(status_code=400, detail="Quality must pass before route recommendation")

    source_id = str(order.get("sourceWarehouseId") or order.get("receivedAtWarehouseId") or order.get("warehouseId") or "")
    if not ObjectId.is_valid(source_id):
        return {"success": True, "data": {"available": False, "reason": "The warehouse that physically received this B2B order is not recorded. Confirm the source warehouse before routing."}}
    source = await warehouse_repo.find_one({"_id": ObjectId(source_id), "deletedAt": None})
    if not source:
        return {"success": True, "data": {"available": False, "reason": "The recorded source warehouse is not registered or has been deactivated."}}
    source_status = str(source.get("status") or source.get("operationalStatus") or "active").lower()
    if source_status not in ("active", "operational", "enabled", "open"):
        return {"success": True, "data": {"available": False, "reason": "The source warehouse is not active."}}

    # District fields are authoritative. _normalized_district supports legacy
    # nested address fields; no geocoding or distance calculation is needed.
    buyer_district = _normalized_b2b_business_district(order)
    if not buyer_district:
        delivery = order.get("deliveryLocation") or order.get("deliveryAddress") or order.get("businessAddress") or order.get("shippingAddress")
        if isinstance(delivery, dict):
            for key in ("deliveryDistrict", "district", "districtName", "administrativeDistrict"):
                value = delivery.get(key)
                if value:
                    buyer_district = re.sub(r"[^a-z0-9]", "", str(value).lower())
                    break
    source_district = _normalized_district(source)
    if not buyer_district:
        return {"success": True, "data": {"available": False, "reason": "The B2B business delivery district is missing. Add the district to the business delivery address before routing."}}
    if not source_district:
        return {"success": True, "data": {"available": False, "reason": "The source warehouse has no configured district. Add its official district before routing."}}

    warehouses = await warehouse_repo.find_many({"deletedAt": None}, limit=1000)
    def is_active_warehouse(w: Dict[str, Any]) -> bool:
        # Support the status variants used by older warehouse records while
        # still excluding explicitly disabled/deleted warehouses.
        if w.get("deletedAt") not in (None, ""):
            return False
        if w.get("isActive") is False or w.get("active") is False or w.get("isOperational") is False:
            return False
        status_values = [
            str(w.get("status") or "").strip().lower(),
            str(w.get("operationalStatus") or "").strip().lower(),
        ]
        status_values = [value for value in status_values if value]
        return not status_values or any(value in ("active", "operational", "enabled", "open", "approved", "verified") for value in status_values)

    active = [w for w in warehouses if is_active_warehouse(w)]

    # Warehouse records in this project have used several schemas over time.
    # Match the buyer district against administrative fields, legacy city/town
    # fields, nested addresses and explicitly configured service-district lists.
    # Compare normalized whole tokens; do not use substring matching.
    def district_tokens(doc: Dict[str, Any]) -> set:
        tokens = set()
        sources = [doc]
        for key in ("address", "location", "deliveryLocation", "shippingAddress", "serviceArea", "warehouseAddress"):
            value = doc.get(key)
            if isinstance(value, dict):
                sources.append(value)

        district_keys = (
            "district", "districtName", "administrativeDistrict", "deliveryDistrict",
            "city", "cityName", "town", "municipality", "locality", "deliveryCity",
        )
        for item in sources:
            for key in district_keys:
                value = item.get(key)
                if isinstance(value, str) and value.strip():
                    token = re.sub(r"[^a-z0-9]", "", value.lower())
                    if token:
                        tokens.add(token)
            # A few legacy address records only contain a formatted address.
            for key in ("formattedAddress", "fullAddress", "addressLine1", "address_line1", "address", "street"):
                value = item.get(key)
                if isinstance(value, str) and value.strip():
                    for part in value.split(","):
                        token = re.sub(r"[^a-z0-9]", "", part.lower())
                        if token and token not in {"india", "tamilnadu", "tn"}:
                            tokens.add(token)

        for key in ("serviceAreas", "serviceDistricts", "supportedDistricts", "districts", "operatingDistricts"):
            values = doc.get(key)
            if isinstance(values, str):
                values = [values]
            if isinstance(values, (list, tuple, set)):
                for value in values:
                    if isinstance(value, dict):
                        value = value.get("district") or value.get("districtName") or value.get("name") or value.get("city")
                    token = re.sub(r"[^a-z0-9]", "", str(value or "").lower())
                    if token:
                        tokens.add(token)
        return tokens

    # A source warehouse must never be selected as the destination for
    # a different business district, even if its service-area list includes it.
    destination_matches = [
        w for w in active
        if buyer_district in district_tokens(w)
        and str(w.get("_id") or "") != source_id
    ]
    # If the business is in the source district, the stock stays in the warehouse
    # that received it. It must not be transferred to another warehouse in that district.
    same_district = source_district == buyer_district
    if same_district:
        destination = source
        route = "nearby_single_farmer"  # finalized after farmer portions are counted below
        destination_id = source_id
        destination_name = source.get("name") or source.get("warehouseName") or source.get("code") or "Source District Warehouse"
        reason = f"Business district ({buyer_district}) matches the source warehouse district. Keep the stock at the source district warehouse."
    else:
        # Each district must have one designated active warehouse. Do not guess
        # between duplicates or fall back to nearest-by-distance.
        unique_matches = {str(w.get("_id")): w for w in destination_matches if w.get("_id")}
        if not unique_matches:
            return {"success": True, "data": {"available": False, "fulfillmentRoute": "long_distance", "sourceWarehouseId": source_id, "sourceWarehouseName": source.get("name") or source.get("warehouseName") or "Source Warehouse", "sourceDistrict": source_district, "businessDistrict": buyer_district, "reason": f"No active designated warehouse is configured for business district '{buyer_district}'. Configure that district's warehouse before dispatch."}}
        if len(unique_matches) > 1:
            # Legacy data can contain multiple active warehouse records for a
            # district. Prefer an explicitly designated district warehouse.
            # If none is configured, select deterministically rather than
            # blocking fulfillment; prefer capacity sufficient for this order.
            designated = [
                w for w in unique_matches.values()
                if w.get("isDistrictPrimary") is True
                or w.get("isPrimaryForDistrict") is True
                or w.get("districtWarehouse") is True
            ]
            candidates = designated or list(unique_matches.values())
            required_kg = float(order.get("receivedQuantityKg") or order.get("packedQuantityKg") or order.get("quantityKg") or order.get("quantity") or 0)

            def destination_rank(warehouse: Dict[str, Any]) -> Tuple[int, int, str]:
                try:
                    total = float(warehouse.get("totalCapacity", warehouse.get("capacity")))
                    used = float(warehouse.get("usedCapacity", warehouse.get("occupiedCapacity", 0)) or 0)
                    has_capacity = int(total - used >= required_kg)
                except (TypeError, ValueError):
                    has_capacity = 0
                explicit_district = re.sub(r"[^a-z0-9]", "", str(warehouse.get("district") or warehouse.get("districtName") or "").lower())
                exact_district = int(explicit_district == buyer_district)
                return (-has_capacity, -exact_district, str(warehouse.get("_id") or ""))

            destination = sorted(candidates, key=destination_rank)[0]
        else:
            destination = next(iter(unique_matches.values()))
        destination_id = str(destination.get("_id"))
        destination_name = destination.get("name") or destination.get("warehouseName") or destination.get("code") or "Destination District Warehouse"
    # Warehouse names may be duplicated in legacy records. Show the destination
    # district alongside the name so the UI cannot misleadingly show the source
    # and destination as the same warehouse.
    destination_district_label = _normalized_district(destination) or buyer_district
    source_name_label = source.get("name") or source.get("warehouseName") or source.get("code") or "Source Warehouse"
    if not same_district:
        # Every cross-district order must be routed to the destination district
        # warehouse regardless of whether warehouse names happen to match.
        route = "long_distance"
        reason = f"Business district ({buyer_district}) differs from source district ({source_district}). Transfer to the designated warehouse for {buyer_district}; distance is not used for routing."
        if str(destination_name).strip().casefold() == str(source_name_label).strip().casefold():
            destination_name = f"{destination_name} — {destination_district_label.title()} District"

    required_kg = float(order.get("receivedQuantityKg") or order.get("packedQuantityKg") or order.get("quantityKg") or order.get("quantity") or 0)
    try:
        available_capacity = float(destination.get("totalCapacity", destination.get("capacity"))) - float(destination.get("usedCapacity", destination.get("occupiedCapacity", 0)) or 0)
    except (TypeError, ValueError):
        available_capacity = None
    if required_kg <= 0:
        return {"success": True, "data": {"available": False, "reason": "The B2B order has no valid positive received quantity."}}
    if available_capacity is None or available_capacity < required_kg:
        return {"success": True, "data": {"available": False, "fulfillmentRoute": route, "sourceWarehouseId": source_id, "sourceWarehouseName": source.get("name") or source.get("warehouseName") or "Source Warehouse", "destinationWarehouseId": destination_id, "destinationWarehouseName": destination_name, "sourceDistrict": source_district, "businessDistrict": buyer_district, "requiredCapacityKg": round(required_kg, 2), "destinationAvailableCapacityKg": round(available_capacity, 2) if available_capacity is not None else None, "reason": f"The designated warehouse for district '{buyer_district}' does not have enough recorded available capacity. Increase capacity or resolve capacity usage before routing."}}

    siblings_query: Dict[str, Any] = {"deletedAt": None}
    if order.get("rfqId") is not None:
        siblings_query["rfqId"] = order.get("rfqId")
    if order.get("businessUserId") is not None:
        siblings_query["businessUserId"] = order.get("businessUserId")
    siblings = await order_repo.find_many(siblings_query, limit=500) if "rfqId" in siblings_query and "businessUserId" in siblings_query else [order]
    portions = [p for p in siblings if p.get("farmerId") or p.get("farmerUserId") or p.get("farmerInfo") or p.get("farmer")]
    multi_farmer = len({str(p.get("farmerId") or p.get("farmerUserId") or (p.get("farmerInfo") or {}).get("id") or (p.get("farmer") or {}).get("id") or p.get("_id")) for p in portions}) > 1
    if same_district:
        route = "nearby_multi_farmer" if multi_farmer else "nearby_single_farmer"

    # Delivery planning is separate from district routing. Calculate the
    # source-to-destination distance when coordinates exist, then evaluate the
    # deadline using only configured transit/cutoff values. If operational data
    # is missing, show "needs_review" instead of falsely promising on-time delivery.
    delivery_deadline = _parse_b2b_delivery_deadline(order)

    source_coords = _location_coords_from_doc(source)
    destination_coords = _location_coords_from_doc(destination)
    transfer_distance_km = None
    used_road_distance = False
    if source_coords and destination_coords:
        # Prefer real driving-road distance for dispatch planning. The straight-
        # line fallback is only used when the road-routing service is unavailable.
        transfer_distance_km = await _road_distance_km_between(source_coords, destination_coords)
        used_road_distance = transfer_distance_km is not None
        if transfer_distance_km is None:
            transfer_distance_km = round(
                haversine_km(source_coords[1], source_coords[0], destination_coords[1], destination_coords[0]), 1
            )
        # Do not present a multi-thousand-kilometre route for two warehouses
        # registered in Indian districts unless the route can be independently
        # validated. This catches coordinates still corrupted in the database
        # and prevents a false urgent/late classification based on bad geometry.
        india_states = {
            "tamil nadu", "andhra pradesh", "telangana", "kerala", "karnataka",
            "maharashtra", "gujarat", "rajasthan", "madhya pradesh", "uttar pradesh",
            "bihar", "west bengal", "odisha", "punjab", "haryana", "assam",
        }
        source_state = str(source.get("state") or source.get("stateName") or "").strip().lower()
        destination_state = str(destination.get("state") or destination.get("stateName") or "").strip().lower()
        source_country = str(source.get("country") or source.get("countryName") or "").strip().lower()
        destination_country = str(destination.get("country") or destination.get("countryName") or "").strip().lower()
        india_route = (
            source_country in {"india", "in"} or destination_country in {"india", "in"}
            or source_state in india_states or destination_state in india_states
            or (source_state and destination_state and source_state == destination_state and source_state in india_states)
        )
        source_district_token = re.sub(r"[^a-z0-9]", "", source_district.lower())
        destination_district_token = re.sub(r"[^a-z0-9]", "", buyer_district.lower())
        tamil_nadu_district_tokens = {
            # Include common spellings used by older warehouse records.
            "trichy", "trichirapalli", "tiruchirapalli", "tiruchirappalli",
            "thiruchirapalli", "thiruchirappalli", "perambalur", "ariyalur",
            "karur", "pudukkottai", "thanjavur", "thiruvarur", "nagapattinam",
            "mayiladuthurai", "salem", "namakkal", "erode", "coimbatore", "tiruppur",
            "dindigul", "madurai", "theni", "virudhunagar", "sivaganga",
            "ramanathapuram", "tirunelveli", "thoothukudi", "kanniyakumari", "tenkasi",
            "chengalpattu", "chennai", "kancheepuram", "tiruvallur", "thiruvallur",
            "vellore", "ranipet", "tirupattur", "krishnagiri", "dharmapuri",
            "villupuram", "kallakurichi", "cuddalore", "tiruvannamalai", "nilgiris",
        }
        inferred_tamil_nadu_route = source_district_token in tamil_nadu_district_tokens and destination_district_token in tamil_nadu_district_tokens
        if (india_route or inferred_tamil_nadu_route) and transfer_distance_km is not None and transfer_distance_km > 1500:
            logger.error(
                "B2B warehouse route distance rejected as implausible for Indian warehouses: "
                "source_id=%s source_coords=%s destination_id=%s destination_coords=%s distance_km=%s",
                source_id, source_coords, destination_id, destination_coords, transfer_distance_km,
            )
            transfer_distance_km = None
            used_road_distance = False
            if inferred_tamil_nadu_route:
                geocoded_source = await _geocode_indian_district(source_district)
                geocoded_destination = await _geocode_indian_district(buyer_district)
                if geocoded_source and geocoded_destination:
                    recovered_distance = await _road_distance_km_between(geocoded_source, geocoded_destination)
                    # District-centre routing is a recovery path for corrupted
                    # warehouse coordinates, not a reason to accept another
                    # implausible result. For Tamil Nadu districts, reject any
                    # recovered distance that is still clearly outside the region.
                    if recovered_distance is not None and 0 < recovered_distance <= 1500:
                        transfer_distance_km = recovered_distance
                        used_road_distance = True
            # Never return a multi-thousand-kilometre distance for a known
            # Tamil Nadu district pair. If coordinates cannot be recovered,
            # fall back to an explicitly configured lead time or needs_review.
            if inferred_tamil_nadu_route and transfer_distance_km is not None and transfer_distance_km > 1500:
                logger.error(
                    "B2B route remains implausible after district geocoding; suppressing distance: "
                    "source_district=%s destination_district=%s distance_km=%s",
                    source_district, buyer_district, transfer_distance_km,
                )
                transfer_distance_km = None
                used_road_distance = False

    # If warehouse coordinates are missing (not just corrupted), recover a
    # useful regional estimate from the source and business district centres.
    # This is explicitly a district-to-district planning estimate, not a claim
    # that the exact warehouse pins were located. It prevents the UI getting
    # stuck at NEEDS REVIEW solely because older warehouse records lack GPS.
    if transfer_distance_km is None and inferred_tamil_nadu_route:
        geocoded_source = await _geocode_indian_district(source_district)
        geocoded_destination = await _geocode_indian_district(buyer_district)
        if geocoded_source and geocoded_destination:
            recovered_distance = await _road_distance_km_between(geocoded_source, geocoded_destination)
            if recovered_distance is not None and 0 < recovered_distance <= 1500:
                transfer_distance_km = recovered_distance
                used_road_distance = True
                transit_estimate_basis = "district_centre_road_estimate_plus_2h_handling_buffer"
            else:
                # If the road router is unavailable, use the geocoded district
                # centres' straight-line distance with a road detour factor.
                straight_line_km = haversine_km(
                    geocoded_source[1], geocoded_source[0],
                    geocoded_destination[1], geocoded_destination[0],
                )
                if 0 < straight_line_km <= 1200:
                    transfer_distance_km = round(straight_line_km, 1)
                    used_road_distance = False
                    transit_estimate_basis = "district_centre_straight_line_fallback_plus_road_factor_and_2h_buffer"

    # Do not trust per-order lead times here: older orders may contain an ETA
    # persisted from malformed/swapped coordinates (for example, hundreds of
    # hours for a short regional transfer). Recalculate from the current validated
    # warehouse-to-warehouse route every time the recommendation is requested.
    # Prefer road distance; when OSRM is unavailable, the fallback is straight-line
    # distance, so apply a road factor before estimating travel and handling time.
    estimated_transit_hours = None
    transit_estimate_basis = "needs_review"
    if transfer_distance_km is not None and transfer_distance_km >= 0:
        road_distance_for_eta = transfer_distance_km
        if not used_road_distance:
            road_distance_for_eta = transfer_distance_km * 1.25
            transit_estimate_basis = "straight_line_fallback_road_factor_plus_2h_handling_buffer"
        else:
            transit_estimate_basis = "road_distance_plus_2h_handling_buffer"
        estimated_transit_hours = round((road_distance_for_eta / 35.0) + 2.0, 1)
    else:
        # If valid coordinates are unavailable, only use an explicit warehouse
        # operational lead time. Ignore stale order-level values.
        for configured in (
            source.get("estimatedTransferHours"),
            source.get("transferLeadTimeHours"),
            destination.get("estimatedTransferHours"),
            destination.get("transferLeadTimeHours"),
        ):
            try:
                parsed = float(configured) if configured is not None else None
                if parsed is not None and 0 < parsed <= 168:
                    estimated_transit_hours = parsed
                    transit_estimate_basis = "warehouse_configured_lead_time_coordinates_unavailable"
                    break
            except (TypeError, ValueError):
                continue

    dispatch_cutoff = (
        order.get("transferDispatchCutoff")
        or source.get("transferDispatchCutoff")
        or source.get("dispatchCutoff")
        or destination.get("transferDispatchCutoff")
        or destination.get("dispatchCutoff")
    )
    if isinstance(dispatch_cutoff, str):
        try:
            dispatch_cutoff = datetime.fromisoformat(dispatch_cutoff.replace("Z", "+00:00"))
            if dispatch_cutoff.tzinfo is not None:
                dispatch_cutoff = dispatch_cutoff.astimezone(timezone.utc).replace(tzinfo=None)
        except (TypeError, ValueError):
            dispatch_cutoff = None

    if same_district and not delivery_deadline:
        schedule_status = "needs_review"
        schedule_reason = "Local delivery cannot be scheduled until the business delivery date and morning time slot are confirmed."
    elif same_district:
        schedule_status = "local_delivery"
        schedule_reason = "No inter-warehouse transfer is required. Assign a local delivery team and stage the order before the confirmed morning slot."
    elif not delivery_deadline:
        schedule_status = "needs_review"
        schedule_reason = "Delivery date/time is missing or invalid; confirm a business delivery date and morning time slot before dispatch."
    elif estimated_transit_hours is None:
        schedule_status = "needs_review"
        schedule_reason = "Transfer travel-time estimate is not configured. Set estimatedTransferHours/transferLeadTimeHours before confirming on-time feasibility."
    else:
        now_for_plan = datetime.utcnow()
        required_arrival = delivery_deadline
        planned_arrival = now_for_plan + timedelta(hours=estimated_transit_hours)
        # Warehouse transfer timing is based on whether stock can reach the
        # destination warehouse before the business deadline. A previous-day
        # dispatch rule or farmer pickup window must not independently make a
        # transfer urgent; the destination warehouse handles last-mile delivery.
        if planned_arrival > required_arrival:
            schedule_status = "urgent"
            schedule_reason = "Estimated arrival at the destination warehouse is after the business delivery deadline. Mark this order urgent so the destination warehouse can coordinate recovery and final delivery."
        else:
            schedule_status = "feasible"
            schedule_reason = "Estimated arrival at the destination warehouse is before the business delivery deadline. The destination warehouse has time to process the order and complete final delivery."

    return {"success": True, "data": {
        "available": True,
        "fulfillmentRoute": route,
        "routingBasis": "district",
        "sourceWarehouseId": source_id,
        "sourceWarehouseName": source.get("name") or source.get("warehouseName") or source.get("code") or "Source Warehouse",
        "destinationWarehouseId": destination_id,
        "destinationWarehouseName": destination_name,
        "sourceDistrict": source_district,
        "destinationDistrict": _normalized_district(destination),
        "businessDistrict": buyer_district,
        "farmerCount": len({str(p.get("farmerId") or p.get("farmerUserId") or (p.get("farmerInfo") or {}).get("id") or (p.get("farmer") or {}).get("id") or p.get("_id")) for p in portions}) or 1,
        "portionCount": max(1, len(portions)),
        "destinationAvailableCapacityKg": round(available_capacity, 2),
        "schedulePlan": {
            "status": schedule_status,
            "currentTime": now_for_plan.isoformat() if not same_district and isinstance(delivery_deadline, datetime) and estimated_transit_hours is not None else None,
            "estimatedArrivalAt": planned_arrival.isoformat() if not same_district and isinstance(delivery_deadline, datetime) and estimated_transit_hours is not None else None,
            "deliveryDeadline": delivery_deadline.isoformat() if isinstance(delivery_deadline, datetime) else None,
            "arrivalComparison": (
                "after_deadline" if planned_arrival > delivery_deadline else "before_deadline"
            ) if not same_district and isinstance(delivery_deadline, datetime) and estimated_transit_hours is not None else None,
            "transferDistanceKm": transfer_distance_km,
            "estimatedTransitHours": estimated_transit_hours,
            "transitEstimateBasis": transit_estimate_basis if not same_district else "not_required",
            "dispatchCutoff": dispatch_cutoff.isoformat() if isinstance(dispatch_cutoff, datetime) else None,
            "recommendedDispatchDate": (delivery_deadline.date() - timedelta(days=1)).isoformat() if isinstance(delivery_deadline, datetime) and not same_district else None,
            "reason": schedule_reason,
        },
        "reason": reason,
    }}


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
    known_districts = {_normalized_district(row) for row in warehouses if _normalized_district(row)}
    delivery_location = order.get("deliveryLocation")
    district_values = [
        order.get("deliveryDistrict"), order.get("district"), order.get("districtName"),
        delivery_location.get("district") if isinstance(delivery_location, dict) else None,
        delivery_location.get("deliveryDistrict") if isinstance(delivery_location, dict) else None,
    ]
    buyer_district = next((re.sub(r"[^a-z0-9]", "", str(value).lower()) for value in district_values if str(value or "").strip()), "")
    address_values = [order.get("deliveryAddress"), order.get("businessAddress"), order.get("shippingAddress"), delivery_location]
    address_tokens = set()
    for value in address_values:
        if isinstance(value, str):
            address_tokens.update(re.sub(r"[^a-z0-9]", "", part.lower()) for part in value.split(","))
        elif isinstance(value, dict):
            for key in ("formattedAddress", "addressLine1", "address_line1", "city", "district", "state", "country"):
                part = value.get(key)
                if isinstance(part, str):
                    address_tokens.update(re.sub(r"[^a-z0-9]", "", token.lower()) for token in part.split(","))
    matching_districts = address_tokens.intersection(known_districts)
    if matching_districts:
        buyer_district = next(iter(matching_districts))
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
        warehouse_district = _normalized_district(warehouse)
        if not buyer_district or not warehouse_district or warehouse_district != buyer_district:
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
            "district": warehouse.get("district") or warehouse.get("districtName"),
            "city": warehouse.get("city"),
            "availableCapacityKg": round(spare, 2),
            "requiredCapacityKg": round(required_kg, 2),
            "distanceToBusinessKm": distance,
        })
    options.sort(key=lambda item: item["distanceToBusinessKm"])
    return {"success": True, "data": {"warehouses": options, "requiredCapacityKg": round(required_kg, 2)}}


async def _resolve_b2b_current_warehouse_id(current_user: Dict[str, Any]) -> str:
    """Resolve the warehouse attached to the signed-in warehouse account."""
    direct = str(current_user.get("warehouseId") or current_user.get("assignedWarehouseId") or "").strip()
    if ObjectId.is_valid(direct):
        registered = await warehouse_repo.find_one({"_id": ObjectId(direct), "deletedAt": None})
        if registered:
            return direct
    user_id = str(current_user.get("_id") or current_user.get("id") or "").strip()
    user_values: List[Any] = [user_id]
    if ObjectId.is_valid(user_id):
        user_values.append(ObjectId(user_id))
    links: List[Dict[str, Any]] = [
        {"userId": {"$in": user_values}},
        {"user_id": {"$in": user_values}},
        {"managerId": {"$in": user_values}},
        {"managerUserId": {"$in": user_values}},
        {"ownerId": {"$in": user_values}},
        {"warehouseManagerId": {"$in": user_values}},
        {"accountId": {"$in": user_values}},
        {"createdBy": {"$in": user_values}},
        {"staffUserIds": {"$in": user_values}},
        {"staffIds": {"$in": user_values}},
        {"members.userId": {"$in": user_values}},
        {"members.user_id": {"$in": user_values}},
        {"users.userId": {"$in": user_values}},
    ]
    email = str(current_user.get("email") or "").strip().lower()
    if email:
        links.extend([
            {"managerEmail": email}, {"contactEmail": email}, {"email": email},
            {"staffEmails": email}, {"members.email": email}, {"users.email": email},
        ])
    warehouse = await warehouse_repo.find_one({"deletedAt": None, "$or": links})
    if warehouse and warehouse.get("_id") is not None:
        return str(warehouse["_id"])
    return ""


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

    # Once the warehouse workflow reaches its terminal stage, reject every
    # repeated logistics action even if a stale status field was later changed.
    if _b2b_warehouse_workflow_is_complete(order):
        raise HTTPException(status_code=409, detail="This B2B order has completed its warehouse workflow and cannot be processed again.")

    if action == "assign_pickup":
        if role not in allowed_warehouse:
            raise HTTPException(status_code=403, detail="Only warehouse staff can assign farm pickup")
        if current != ORDER_READY_FOR_PICKUP:
            raise HTTPException(status_code=400, detail="Only orders marked Ready for Pickup can be assigned")
        if not data.pickupTeam or not data.vehicle:
            raise HTTPException(status_code=400, detail="Pickup team and vehicle are required")
        pickup_partner_id = data.pickupTeam.strip()
        if not ObjectId.is_valid(pickup_partner_id):
            raise HTTPException(status_code=400, detail="Select a registered pickup partner from the approved team list.")
        # Claim the unassigned pickup using the warehouse account performing
        # the assignment. Route estimates may pre-populate sourceWarehouseId;
        # they must not override the actual operational pickup warehouse.
        acting_warehouse_id = await _resolve_b2b_current_warehouse_id(current_user)
        pickup_warehouse_id = str(
            acting_warehouse_id
            or order.get("assignedWarehouseId")
            or order.get("sourceWarehouseId")
            or order.get("warehouseId")
            or order.get("receivingWarehouseId")
            or ""
        )
        if not ObjectId.is_valid(pickup_warehouse_id):
            raise HTTPException(status_code=409, detail="This B2B order has no valid source warehouse. Assign its actual pickup warehouse before assigning a pickup partner.")
        pickup_warehouse = await warehouse_repo.find_one({"_id": ObjectId(pickup_warehouse_id), "deletedAt": None})
        if not pickup_warehouse:
            raise HTTPException(status_code=409, detail="The source warehouse assigned to this B2B order is not registered.")
        membership = await warehouse_pickup_team_repository.get_membership(pickup_warehouse_id, pickup_partner_id)
        if not membership:
            raise HTTPException(status_code=403, detail="The selected delivery partner is not an approved pickup-team member of this order's source warehouse.")
        update.update({
            # Claim an unassigned recurring pickup order for the warehouse that
            # assigns the approved team; subsequent refreshes scope it correctly.
            "sourceWarehouseId": pickup_warehouse_id,
            "assignedWarehouseId": pickup_warehouse_id,
            "pickupWarehouseId": pickup_warehouse_id,
            "pickupTeam": pickup_partner_id,
            "pickupTeamName": membership.get("name") or membership.get("partnerName") or membership.get("displayName") or "Assigned pickup partner",
            "pickupVehicle": data.vehicle.strip(),
            "pickupAssignedAt": datetime.utcnow(),
            "pickupAssignedBy": str(current_user.get("_id")),
            "pickupWarehouseId": pickup_warehouse_id,
        })
        # Assignment must be reflected in the delivery partner's /me/pickup-routes
        # queue, which only returns routes assigned to that partner. A route left
        # in 'offered' is visible under pickup offers, not the assigned route page.
        route = await warehouse_pickup_route_repository.find_one({
            "b2bOrderId": str(order["_id"]), "deletedAt": None,
            "status": {"$nin": ["cancelled", "closed", "archived", "returned_to_warehouse"]},
        })
        route_payload = {
            "warehouseId": ObjectId(pickup_warehouse_id),
            "deliveryPartnerId": ObjectId(pickup_partner_id),
            "deliveryPartnerName": update["pickupTeamName"],
            "deliveryPartnerVehicleType": membership.get("vehicleType"),
            "deliveryPartnerVehicleNumber": data.vehicle.strip(),
            "status": "assigned",
            "assignedAt": datetime.utcnow(),
            "assignedBy": ObjectId(str(current_user["_id"])) if ObjectId.is_valid(str(current_user.get("_id") or "")) else None,
            "b2bOrderId": str(order["_id"]),
            "orderIds": [str(order["_id"])],
            "updatedAt": datetime.utcnow(),
        }
        if route:
            await warehouse_pickup_route_repository.update_route(str(route["_id"]), route_payload)
        else:
            now = datetime.utcnow()
            farmer_id = str(order.get("farmerId") or "")
            farmer_doc = await farmer_repository.find_one({"_id": ObjectId(farmer_id), "deletedAt": None}) if ObjectId.is_valid(farmer_id) else None
            location = (farmer_doc or {}).get("location") or (farmer_doc or {}).get("farmLocation") or (farmer_doc or {}).get("address") or {}
            if isinstance(location, str):
                location = {"formattedAddress": location}
            farmer_name = (farmer_doc or {}).get("farmName") or (farmer_doc or {}).get("ownerName") or (farmer_doc or {}).get("name") or "Farmer"
            quantity = float(order.get("packedQuantityKg") or order.get("quantityKg") or order.get("quantity") or 0)
            order_number = str(order.get("orderNumber") or order.get("orderNo") or f"B2B-{str(order['_id'])[-6:]}")
            collection_jobs = await warehouse_collection_repository.get_by_order(str(order["_id"]), "b2b")
            collection_job = next((job for job in collection_jobs if str(job.get("status") or "") not in ("collected", "departed_farm", "arrived_warehouse", "cancelled")), None)
            collection_id = str(collection_job.get("_id")) if collection_job else None
            if not collection_job:
                collection_id = await warehouse_collection_repository.create_job({
                    "warehouseId": ObjectId(pickup_warehouse_id), "orderId": order["_id"],
                    "b2bOrderId": str(order["_id"]), "orderNumber": order_number,
                    "farmerId": ObjectId(farmer_id) if ObjectId.is_valid(farmer_id) else None,
                    "farmerName": farmer_name, "productName": order.get("productName") or "B2B produce",
                    "quantity": quantity, "pickupLocation": location if isinstance(location, dict) else {},
                    "pickupAddress": (farmer_doc or {}).get("farmAddress") or (farmer_doc or {}).get("address") or order.get("farmAddress") or "Farm address not provided",
                    "collectionType": "b2b", "status": "ready_for_pickup", "createdFrom": "b2b_order",
                })
            pickup_address = (farmer_doc or {}).get("farmAddress") or (farmer_doc or {}).get("address") or order.get("farmAddress") or "Farm address not provided"
            route_payload.update({
                "routeNumber": order_number + "-PICKUP", "routeDate": now.strftime("%Y-%m-%d"),
                "routeType": "b2b_farm_pickup", "isB2BPickup": True, "status": "assigned",
                "totalStops": 1, "totalOrders": 1, "totalQuantity": quantity,
                "stops": [{
                    "sequence": 1, "farmKey": f"b2b:{str(order['_id'])}", "b2bOrderId": str(order["_id"]),
                    "collectionId": collection_id, "orderId": str(order["_id"]), "orderNumber": order_number,
                    "farmerId": farmer_id or None, "farmerName": farmer_name, "productName": order.get("productName") or "B2B produce",
                    "quantity": quantity, "status": "ready_for_pickup", "pickupAddress": pickup_address,
                    "pickupLocation": location if isinstance(location, dict) else {},
                    "orders": [{
                        "b2bOrderId": str(order["_id"]), "collectionId": collection_id,
                        "orderId": str(order["_id"]), "orderNumber": order_number, "farmerId": farmer_id or None,
                        "farmerName": farmer_name, "productName": order.get("productName") or "B2B produce",
                        "quantity": quantity, "status": "ready_for_pickup", "pickupAddress": pickup_address,
                        "pickupLocation": location if isinstance(location, dict) else {},
                    }],
                }],
                "createdBy": ObjectId(str(current_user["_id"])) if ObjectId.is_valid(str(current_user.get("_id") or "")) else None,
                "createdAt": now,
            })
            await warehouse_pickup_route_repository.create_route(route_payload)
    elif action == "confirm_pickup":
        if role not in ("pickup_team", "pickup", "warehouse", "warehouse_manager", "warehouse_staff", "admin", "super_admin"):
            raise HTTPException(status_code=403, detail="Only the assigned pickup team or warehouse can confirm collection")
        if current != ORDER_READY_FOR_PICKUP or not order.get("pickupTeam") or not order.get("pickupVehicle"):
            raise HTTPException(status_code=400, detail="Assign a pickup team and vehicle before confirming collection")
        update.update({"status": ORDER_PICKED_UP, "pickedUpAt": datetime.utcnow(), "pickupNotes": data.notes})
    elif action == "receive_stock":
        if role not in allowed_warehouse:
            raise HTTPException(status_code=403, detail="Only warehouse staff can receive B2B stock")
        # Never let a stale collection record roll a delivered/completed order
        # back into warehouse_received. Completed orders belong in the archive.
        if current in (ORDER_WAREHOUSE_RECEIVED, ORDER_TRANSFER_IN_TRANSIT, ORDER_DESTINATION_RECEIVED, ORDER_IN_TRANSIT, ORDER_DELIVERED, ORDER_COMPLETED) or order.get("warehouseReceivedAt") or order.get("destinationReceivedAt") or order.get("deliveredAt") or order.get("completedAt"):
            raise HTTPException(status_code=409, detail="Warehouse receipt has already been recorded for this B2B order. Continue with routing, transfer, destination receipt, or delivery; do not receive it again.")
        collection_stage = str(order.get("warehouseCollectionStatus") or order.get("warehouseFulfillmentStage") or "").strip().lower()
        if current != ORDER_PICKED_UP and collection_stage not in ("collected", "departed_farm", "arrived_warehouse", "warehouse_arrived", "collection_departed"):
            raise HTTPException(status_code=400, detail="Stock can be received only after the pickup partner has collected the order and returned to the warehouse")
        if data.receivedQuantityKg is None or data.receivedQuantityKg <= 0:
            raise HTTPException(status_code=400, detail="Enter the received quantity in kg")
        if data.qualityCheck not in ("passed", "failed"):
            raise HTTPException(status_code=400, detail="Record a passed or failed quality inspection")
        receiving_warehouse_id = await _resolve_b2b_current_warehouse_id(current_user)
        if not receiving_warehouse_id:
            raise HTTPException(status_code=409, detail="Your warehouse account is not linked to a registered warehouse. Link this account to the warehouse that physically receives the stock before confirming receipt.")
        expected_source_id = str(order.get("sourceWarehouseId") or order.get("assignedWarehouseId") or order.get("warehouseId") or "")
        if expected_source_id and receiving_warehouse_id != expected_source_id and role not in ("admin", "super_admin"):
            raise HTTPException(status_code=403, detail="Only the order's assigned source warehouse can confirm farm-pickup stock receipt.")
        if receiving_warehouse_id:
            if not ObjectId.is_valid(receiving_warehouse_id):
                raise HTTPException(status_code=400, detail="The receiving warehouse assignment is invalid; select/configure the actual warehouse before receiving stock")
            receiving_warehouse = await warehouse_repo.find_one({"_id": ObjectId(receiving_warehouse_id), "deletedAt": None})
            if not receiving_warehouse:
                raise HTTPException(status_code=400, detail="The receiving warehouse is not registered")
            receiving_status = str(receiving_warehouse.get("status") or receiving_warehouse.get("operationalStatus") or "active").lower()
            if receiving_status not in ("active", "operational", "enabled", "open"):
                raise HTTPException(status_code=400, detail="The receiving warehouse is not active")
            update["sourceWarehouseId"] = receiving_warehouse_id
            update["sourceWarehouseName"] = receiving_warehouse.get("name") or receiving_warehouse.get("warehouseName") or receiving_warehouse.get("code")
        update.update({"status": ORDER_WAREHOUSE_RECEIVED, "receivedQuantityKg": round(data.receivedQuantityKg, 2), "warehouseQualityCheck": data.qualityCheck, "warehouseReceivedAt": datetime.utcnow(), "warehouseReceivedBy": str(current_user.get("_id")), "warehouseNotes": data.notes})
    elif action == "set_fulfillment_route":
        if role not in allowed_warehouse:
            raise HTTPException(status_code=403, detail="Only warehouse staff can plan B2B fulfillment")
        if current != ORDER_WAREHOUSE_RECEIVED or order.get("warehouseQualityCheck") != "passed":
            raise HTTPException(status_code=400, detail="Warehouse receipt and passed quality inspection are required before routing")
        if data.fulfillmentRoute not in ("nearby_single_farmer", "nearby_multi_farmer", "long_distance"):
            raise HTTPException(status_code=400, detail="Choose a valid fulfillment route")
        source_id_for_route = str(order.get("sourceWarehouseId") or order.get("warehouseId") or order.get("receivedAtWarehouseId") or "")
        if not ObjectId.is_valid(source_id_for_route):
            raise HTTPException(status_code=400, detail="Actual receiving warehouse is missing. Record the warehouse that physically received the stock before confirming a route.")
        source_for_route = await warehouse_repo.find_one({"_id": ObjectId(source_id_for_route), "deletedAt": None})
        if not source_for_route:
            raise HTTPException(status_code=400, detail="Actual source warehouse is not registered.")
        source_district_for_route = _normalized_district(source_for_route)
        business_district_for_route = _normalized_b2b_business_district(order)
        if not business_district_for_route:
            delivery_doc = order.get("deliveryLocation") or order.get("deliveryAddress") or order.get("businessAddress") or order.get("shippingAddress")
            if isinstance(delivery_doc, dict):
                for district_key in ("deliveryDistrict", "district", "districtName", "administrativeDistrict"):
                    if delivery_doc.get(district_key):
                        business_district_for_route = re.sub(r"[^a-z0-9]", "", str(delivery_doc[district_key]).lower())
                        break
        if not source_district_for_route or not business_district_for_route:
            raise HTTPException(status_code=409, detail="Source warehouse district and business delivery district must both be configured before routing.")
        same_district_for_route = source_district_for_route == business_district_for_route
        if same_district_for_route and data.fulfillmentRoute == "long_distance":
            raise HTTPException(status_code=409, detail="The business and source warehouse are in the same district. Select the same-district delivery/consolidation route.")
        if not same_district_for_route and data.fulfillmentRoute in ("nearby_single_farmer", "nearby_multi_farmer"):
            raise HTTPException(status_code=409, detail="The business is in a different district. Use the district warehouse transfer route.")
        if data.fulfillmentRoute == "long_distance":
            if not data.destinationWarehouseId or str(data.destinationWarehouseId) == source_id_for_route:
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
            destination_district = _normalized_district(destination)
            business_district = _normalized_b2b_business_district(order)
            if not business_district:
                delivery_doc = order.get("deliveryLocation") or order.get("deliveryAddress") or order.get("businessAddress") or order.get("shippingAddress")
                if isinstance(delivery_doc, dict):
                    for district_key in ("deliveryDistrict", "district", "districtName", "administrativeDistrict"):
                        if delivery_doc.get(district_key):
                            business_district = re.sub(r"[^a-z0-9]", "", str(delivery_doc[district_key]).lower())
                            break
            if not business_district or not destination_district or destination_district != business_district:
                raise HTTPException(status_code=409, detail="Destination warehouse must be the designated warehouse in the business delivery district. Verify the district fields on the business address and warehouse record.")
            update["destinationWarehouseId"] = str(data.destinationWarehouseId)
        else:
            update["destinationWarehouseId"] = str(order.get("sourceWarehouseId") or "")
        # Persist the same schedule inputs used by the recommendation so that
        # later dispatch validation evaluates the plan the operator confirmed.
        if data.estimatedTransferHours is not None:
            if data.estimatedTransferHours <= 0:
                raise HTTPException(status_code=400, detail="Estimated transfer lead time must be greater than zero")
            update["estimatedTransferHours"] = data.estimatedTransferHours
        if data.transferDispatchCutoff:
            try:
                cutoff = datetime.fromisoformat(data.transferDispatchCutoff.replace("Z", "+00:00"))
                if cutoff.tzinfo is not None:
                    cutoff = cutoff.astimezone(timezone.utc).replace(tzinfo=None)
                update["transferDispatchCutoff"] = cutoff
            except ValueError:
                raise HTTPException(status_code=400, detail="Transfer dispatch cutoff must be a valid ISO date/time")
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
        actual_source_id = str(order.get("sourceWarehouseId") or order.get("receivedAtWarehouseId") or order.get("warehouseId") or "")
        destination_id = str(order.get("destinationWarehouseId") or "")
        if not actual_source_id or not ObjectId.is_valid(actual_source_id):
            raise HTTPException(status_code=400, detail="The actual receiving/source warehouse is missing. Record the warehouse that holds this stock before dispatch.")
        if not destination_id or not ObjectId.is_valid(destination_id):
            raise HTTPException(status_code=400, detail="Select a valid registered destination warehouse before dispatch")
        if destination_id == actual_source_id:
            raise HTTPException(status_code=409, detail="The selected destination is the same warehouse that holds the stock. Select a different eligible destination warehouse.")
        source_record = await warehouse_repo.find_one({"_id": ObjectId(actual_source_id), "deletedAt": None})
        destination_record = await warehouse_repo.find_one({"_id": ObjectId(destination_id), "deletedAt": None})
        if not source_record or not destination_record:
            raise HTTPException(status_code=400, detail="Source or destination warehouse record could not be found. Refresh warehouse records before dispatch.")

        # Enforce schedule feasibility on the server as well as in the UI. A
        # client-side disabled button alone is not a safe deadline control.
        delivery_deadline = _parse_b2b_delivery_deadline(order)
        if not isinstance(delivery_deadline, datetime):
            raise HTTPException(status_code=409, detail="Delivery deadline is missing or invalid. Confirm a feasible business delivery date/time before dispatch.")
        transit_value = (
            order.get("estimatedTransferHours")
            or order.get("transferLeadTimeHours")
            or destination_record.get("estimatedTransferHours")
            or destination_record.get("transferLeadTimeHours")
            or source_record.get("estimatedTransferHours")
            or source_record.get("transferLeadTimeHours")
        )
        try:
            transit_hours = float(transit_value) if transit_value is not None else None
        except (TypeError, ValueError):
            transit_hours = None
        if (transit_hours is None or transit_hours <= 0):
            source_coords = _location_coords_from_doc(source_record)
            destination_coords = _location_coords_from_doc(destination_record)
            if source_coords and destination_coords:
                distance_km = haversine_km(source_coords[1], source_coords[0], destination_coords[1], destination_coords[0])
                transit_hours = round((distance_km / 35.0) + 2.0, 1)
                update["estimatedTransferHours"] = transit_hours
                update["transferEstimateBasis"] = "distance_estimate_35_kmh_plus_2h_handling_buffer"
        if transit_hours is None or transit_hours <= 0:
            raise HTTPException(status_code=409, detail="Transfer lead time cannot be calculated because warehouse coordinates and configured lead time are missing. Add coordinates or configure estimatedTransferHours before dispatch.")
        now_for_transfer = datetime.utcnow()
        estimated_destination_arrival = now_for_transfer + timedelta(hours=transit_hours)
        if estimated_destination_arrival > delivery_deadline:
            # Late arrival is an urgency signal, not a reason to strand stock at
            # the source warehouse. Dispatch is allowed; destination operations
            # must prioritize receipt, processing and final delivery recovery.
            update["deliveryPriority"] = "urgent"
            update["scheduleRisk"] = "destination_arrival_after_business_deadline"
        else:
            update["deliveryPriority"] = order.get("deliveryPriority") or "normal"
            update["scheduleRisk"] = None

        if not data.transferTeam or not ObjectId.is_valid(str(data.transferTeam)):
            raise HTTPException(status_code=400, detail="Select a registered transfer team before dispatch")
        if not data.transferVehicle or not str(data.transferVehicle).strip():
            raise HTTPException(status_code=400, detail="The selected transfer team's registered vehicle is required before dispatch")
        # The roster's deliveryPartnerId is the member's user ID; it is not
        # necessarily the pickup-team membership document ID. Validate membership
        # against the source warehouse's approved roster instead of treating it as
        # a standalone user/document ID.
        warehouse_id = str(current_user.get("warehouseId") or current_user.get("assignedWarehouseId") or "")
        source_warehouse = None
        if not warehouse_id:
            source_warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user.get("_id")))
            warehouse_id = str((source_warehouse or {}).get("_id") or "")
        if not warehouse_id:
            raise HTTPException(status_code=400, detail="Your account is not linked to the source warehouse. Link the warehouse account before assigning a transfer team.")
        membership = await warehouse_pickup_team_repository.get_membership(warehouse_id, str(data.transferTeam))
        if not membership:
            raise HTTPException(status_code=400, detail="The selected team is not an approved member of this source warehouse. Refresh the registered transfer-team list.")
        team_user_id = str(membership.get("userId") or membership.get("deliveryPartnerId") or data.transferTeam)
        team_user = await user_repository.get_by_id(team_user_id)
        if not team_user:
            raise HTTPException(status_code=400, detail="The approved transfer team member has no valid user account. Update the team registration before dispatch.")
        registered_vehicle = " · ".join(str(membership.get(key) or team_user.get(key)) for key in ("vehicleNumber", "vehicleRegistrationNumber", "registrationNumber", "vehicleType") if membership.get(key) or team_user.get(key))
        if registered_vehicle and str(data.transferVehicle).strip() not in registered_vehicle and str(data.transferVehicle).strip() not in [str(membership.get(key) or team_user.get(key) or "") for key in ("vehicleNumber", "vehicleRegistrationNumber", "registrationNumber", "vehicleType")]:
            raise HTTPException(status_code=400, detail="Selected vehicle does not match the registered vehicle for this approved team member.")
        update.update({
            "status": ORDER_TRANSFER_IN_TRANSIT,
            "transferTeam": team_user_id,
            "transferTeamMembershipId": str(membership.get("_id") or membership.get("id") or ""),
            "transferTeamName": str(data.transferTeamName or membership.get("name") or team_user.get("name") or team_user.get("fullName") or team_user.get("email") or "Registered transfer team"),
            "transferVehicle": str(data.transferVehicle).strip(),
            "transferDispatchedAt": datetime.utcnow(),
            "transferDispatchedBy": str(current_user.get("_id")),
            "sourceWarehouseId": actual_source_id,
            "sourceWarehouseName": source_record.get("name") or source_record.get("warehouseName") or source_record.get("city") or "Source warehouse",
            "destinationWarehouseId": destination_id,
            "destinationWarehouseName": destination_record.get("name") or destination_record.get("warehouseName") or destination_record.get("city") or "Destination warehouse",
            "transferNotes": data.notes,
        })
    elif action == "receive_at_destination":
        if role not in allowed_warehouse:
            raise HTTPException(status_code=403, detail="Only destination warehouse staff can receive a transfer")
        if current != ORDER_TRANSFER_IN_TRANSIT:
            raise HTTPException(status_code=400, detail="No warehouse transfer is in transit")
        transfer_source_id = str(order.get("sourceWarehouseId") or order.get("receivedAtWarehouseId") or order.get("warehouseId") or "")
        transfer_destination_id = str(order.get("destinationWarehouseId") or "")
        if not transfer_source_id or not transfer_destination_id or transfer_source_id == transfer_destination_id:
            raise HTTPException(status_code=409, detail="Invalid transfer record: source and destination must be different registered warehouses. Correct the destination warehouse assignment before receiving this transfer.")
        receiving_warehouse_id = await _resolve_b2b_current_warehouse_id(current_user)
        if role not in ("admin", "super_admin") and not receiving_warehouse_id:
            raise HTTPException(status_code=409, detail="Your warehouse account is not linked to a registered warehouse. Configure the destination warehouse assignment before receiving this transfer.")
        if role not in ("admin", "super_admin") and receiving_warehouse_id != transfer_destination_id:
            raise HTTPException(status_code=403, detail="Only the designated destination warehouse can receive this transfer.")
        if data.receivedQuantityKg is None or data.receivedQuantityKg <= 0:
            raise HTTPException(status_code=400, detail="Enter destination received quantity")
        if data.qualityCheck not in ("passed", "failed"):
            raise HTTPException(status_code=400, detail="Destination quality inspection must be explicitly marked passed or failed")
        update.update({"status": ORDER_DESTINATION_RECEIVED, "destinationReceivedQuantityKg": round(data.receivedQuantityKg, 2), "destinationReceivedAt": datetime.utcnow(), "destinationReceivedBy": str(current_user.get("_id")), "destinationQualityCheck": data.qualityCheck, "destinationWarehouseNotes": data.notes})
    elif action == "complete_consolidation":
        if role not in allowed_warehouse:
            raise HTTPException(status_code=403, detail="Only warehouse staff can complete B2B consolidation")
        route = str(order.get("fulfillmentRoute") or "")
        is_same_district = route == "nearby_multi_farmer" and current == ORDER_WAREHOUSE_RECEIVED and order.get("warehouseQualityCheck") == "passed"
        is_inter_district = route == "long_distance" and current == ORDER_DESTINATION_RECEIVED and order.get("destinationQualityCheck") == "passed"
        if not (is_same_district or is_inter_district):
            raise HTTPException(status_code=400, detail="Consolidation is allowed only after all required portions reach the correct district warehouse and pass quality inspection")
        rfq_id = order.get("rfqId")
        business_id = order.get("businessUserId")
        if not rfq_id or not business_id:
            raise HTTPException(status_code=400, detail="The original RFQ and business buyer are required to identify all portions")
        portions = await order_repo.find_many({"rfqId": rfq_id, "businessUserId": business_id, "deletedAt": None}, limit=500)
        distinct_farmers = {
            str(p.get("farmerId") or p.get("farmerUserId") or (p.get("farmerInfo") or {}).get("id") or (p.get("farmer") or {}).get("id") or p.get("_id"))
            for p in portions
        }
        if len(distinct_farmers) < 2:
            raise HTTPException(status_code=400, detail="This B2B order contains fewer than two distinct farmers; consolidation is not required")
        if is_same_district:
            outstanding = [
                p for p in portions
                if p.get("status") != ORDER_WAREHOUSE_RECEIVED
                or p.get("warehouseQualityCheck") != "passed"
                or p.get("fulfillmentRoute") != "nearby_multi_farmer"
            ]
        else:
            destination_id = str(order.get("destinationWarehouseId") or "")
            outstanding = [
                p for p in portions
                if p.get("status") != ORDER_DESTINATION_RECEIVED
                or p.get("destinationQualityCheck") != "passed"
                or p.get("fulfillmentRoute") != "long_distance"
                or str(p.get("destinationWarehouseId") or "") != destination_id
            ]
        if outstanding:
            raise HTTPException(status_code=409, detail=f"Consolidation blocked: {len(outstanding)} farmer portion(s) have not reached the required warehouse or have not passed quality inspection")
        now = datetime.utcnow()
        for portion in portions:
            await order_repo.update({"_id": portion["_id"]}, {
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
        if route == "long_distance" and order.get("rfqId") and order.get("businessUserId") and not order.get("consolidationCompletedAt"):
            sibling_portions = await order_repo.find_many({"rfqId": order.get("rfqId"), "businessUserId": order.get("businessUserId"), "deletedAt": None}, limit=500)
            distinct_farmers = {str(p.get("farmerId") or p.get("farmerUserId") or (p.get("farmerInfo") or {}).get("id") or (p.get("farmer") or {}).get("id") or p.get("_id")) for p in sibling_portions}
            if len(distinct_farmers) > 1:
                raise HTTPException(status_code=400, detail="Final delivery is blocked until all farmer portions arrive at the destination district warehouse and consolidation is completed")
        if route == "long_distance" and current == ORDER_WAREHOUSE_RECEIVED:
            if not order.get("destinationWarehouseId") or str(order.get("destinationWarehouseId")) == str(order.get("sourceWarehouseId")):
                raise HTTPException(status_code=400, detail="An eligible destination warehouse must be selected before transfer dispatch")
        if not valid_current or quality != "passed":
            raise HTTPException(status_code=400, detail="The correct warehouse must receive and pass quality inspection before final delivery")
        if not data.deliveryPartner or not str(data.deliveryPartner).strip():
            raise HTTPException(status_code=400, detail="Select a registered delivery team before dispatch")
        delivery_deadline = _parse_b2b_delivery_deadline(order)
        if not isinstance(delivery_deadline, datetime):
            raise HTTPException(status_code=409, detail="Business delivery date and morning time slot are required before final-mile dispatch")
        if datetime.utcnow() >= delivery_deadline:
            raise HTTPException(status_code=409, detail="The scheduled business delivery slot has passed. Agree on a new delivery schedule before dispatch")
        if route == "long_distance" and current == ORDER_DESTINATION_RECEIVED and not order.get("destinationReceivedAt"):
            raise HTTPException(status_code=400, detail="Destination warehouse receipt must be recorded before final delivery")
        update.update({"status": ORDER_IN_TRANSIT, "finalDeliveryPartner": data.deliveryPartner, "finalDeliveryAssignedAt": datetime.utcnow(), "finalDeliveryAssignedBy": str(current_user.get("_id")), "deliveryNotes": data.notes})
    elif action == "reschedule_delivery":
        if role not in allowed_warehouse and role not in ("admin", "super_admin"):
            raise HTTPException(status_code=403, detail="Only warehouse staff can request a revised B2B delivery schedule")
        if current in (ORDER_DELIVERED, ORDER_COMPLETED, "cancelled"):
            raise HTTPException(status_code=409, detail="A delivered, completed or cancelled order cannot be rescheduled")
        if not data.newDeliveryDeadline or not data.newDeliveryTimeSlot or not data.rescheduleReason or not data.rescheduleReason.strip():
            raise HTTPException(status_code=400, detail="New delivery date, morning time slot and reason are required")
        try:
            proposed = datetime.fromisoformat(data.newDeliveryDeadline.replace("Z", "+00:00"))
        except (TypeError, ValueError):
            try:
                proposed = datetime.strptime(data.newDeliveryDeadline[:10], "%Y-%m-%d")
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Enter a valid new delivery date")
        if proposed.tzinfo is not None:
            proposed = proposed.astimezone(timezone.utc).replace(tzinfo=None)
        if proposed <= datetime.utcnow():
            raise HTTPException(status_code=400, detail="The new delivery date/time must be in the future")
        old_deadline = _parse_b2b_delivery_deadline(order)
        update.update({
            "requiredDate": data.newDeliveryDeadline,
            "deliveryDeadline": proposed,
            "deliveryTimeSlot": data.newDeliveryTimeSlot.strip(),
            "scheduleRecoveryStatus": "rescheduled",
            "scheduleRecoveryReason": data.rescheduleReason.strip(),
            "previousDeliveryDeadline": old_deadline,
            "rescheduledAt": datetime.utcnow(),
            "rescheduledBy": str(current_user.get("_id") or ""),
        })
        update["statusHistory"] = list(order.get("statusHistory") or []) + [{
            "status": str(current or "updated"),
            "previousStatus": current,
            "action": "reschedule_delivery",
            "actorRole": role,
            "actorId": str(current_user.get("_id") or ""),
            "details": data.rescheduleReason.strip(),
            "timestamp": datetime.utcnow(),
        }]
        await order_repo.update({"_id": order["_id"]}, update)
        business_id = str(order.get("businessUserId") or "")
        if ObjectId.is_valid(business_id):
            await NotificationService.create_in_app_notification(
                business_id, NotificationType.ORDER,
                "B2B delivery schedule revised",
                f"Order {order.get('orderNumber') or order_id} was rescheduled to {data.newDeliveryDeadline} ({data.newDeliveryTimeSlot}). Reason: {data.rescheduleReason.strip()}",
                {"orderId": order_id, "type": "b2b", "action": "reschedule_delivery"},
                NotificationPriority.HIGH,
            )
        return {"success": True, "message": "Delivery schedule updated and business buyer notified", "status": current, "orderId": str(order["_id"])}
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

    # Append an audit event for every warehouse/pickup/transfer/final-mile
    # action, including actions that do not change the top-level order status.
    history = list(order.get("statusHistory") or [])
    history.append({
        "status": str(update.get("status") or current or "updated"),
        "previousStatus": current,
        "action": action,
        "actorRole": role,
        "actorId": str(current_user.get("_id") or current_user.get("id") or ""),
        "details": str(data.notes or data.qualityNotes or ""),
        "timestamp": datetime.utcnow(),
    })
    update["statusHistory"] = history
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

# ================== RECURRING SUPPLY CONTRACTS ==================

class SupplyContractCreate(BaseModel):
    farmerName: Optional[str] = None
    farmerId: Optional[str] = None
    rfqId: Optional[str] = None
    offerId: Optional[str] = None
    cropName: str
    quantityPerMonthKg: Optional[float] = Field(None, gt=0)
    quantityPerDeliveryKg: Optional[float] = Field(None, gt=0)
    pricePerKg: float = Field(..., gt=0)
    durationMonths: int = Field(1, ge=1, le=36)
    startDate: datetime
    frequency: Optional[str] = None
    recurrenceInterval: int = Field(1, ge=1, le=12)
    endDate: Optional[datetime] = None
    paymentTerms: Optional[str] = None
    cancellationTerms: Optional[str] = None


class SupplyContractStatusUpdate(BaseModel):
    status: str


def _contract_public(row: Dict[str, Any]) -> Dict[str, Any]:
    result = dict(row)
    if result.get("_id") is not None:
        result["id"] = str(result["_id"])
        result["_id"] = str(result["_id"])
    for key in ("businessUserId", "farmerId", "rfqId", "offerId"):
        if result.get(key) is not None:
            result[key] = str(result[key])
    # Expose each scheduled delivery as a JSON-safe, date-sorted history.
    confirmations = result.get("deliveryConfirmations") or {}
    history = []
    if isinstance(confirmations, dict):
        for schedule_key, raw in confirmations.items():
            if not isinstance(raw, dict):
                continue
            item = dict(raw)
            item.setdefault("scheduledDate", schedule_key)
            for date_key in ("confirmedAt", "updatedAt", "resolvedAt", "rescheduledTo"):
                value = item.get(date_key)
                if isinstance(value, datetime):
                    item[date_key] = value.isoformat()
            if item.get("confirmedBy") is not None:
                item["confirmedBy"] = str(item["confirmedBy"])
            history.append(item)
    result["deliveryHistory"] = sorted(history, key=lambda item: str(item.get("scheduledDate") or ""), reverse=True)
    result.pop("deliveryConfirmations", None)
    return result


@router.get("/contracts")
async def list_business_supply_contracts(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "business":
        raise HTTPException(status_code=403, detail="Only business accounts can view their supply contracts")
    rows = await contract_repo.find_many({
        "businessUserId": ObjectId(current_user["_id"]), "deletedAt": None
    }, sort=[("createdAt", -1)], limit=500) or []
    return {"success": True, "data": {"contracts": [_contract_public(row) for row in rows]}}


@router.get("/contracts/me")
async def list_farmer_supply_contracts(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can view their supply contracts")
    rows = await contract_repo.find_many({
        "farmerId": ObjectId(current_user["_id"]), "deletedAt": None
    }, sort=[("createdAt", -1)], limit=500) or []
    return {"success": True, "data": {"contracts": [_contract_public(row) for row in rows]}}


@router.post("/contracts")
async def create_supply_contract(data: SupplyContractCreate, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "business":
        raise HTTPException(status_code=403, detail="Only business accounts can create supply contracts")

    rfq = None
    offer = None
    farmer_id = data.farmerId
    farmer_name = (data.farmerName or "").strip()
    if data.rfqId:
        try:
            rfq = await rfq_repo.find_one({"_id": ObjectId(data.rfqId), "deletedAt": None})
        except Exception:
            rfq = None
        if not rfq or str(rfq.get("businessUserId")) != str(current_user["_id"]):
            raise HTTPException(status_code=404, detail="Recurring RFQ not found")
        if not rfq.get("recurring"):
            raise HTTPException(status_code=400, detail="Supply contracts can only be created from recurring RFQs")
        if data.offerId:
            try:
                offer = await offer_repo.find_one({"_id": ObjectId(data.offerId), "rfqId": rfq["_id"], "deletedAt": None})
            except Exception:
                offer = None
            if not offer:
                raise HTTPException(status_code=404, detail="Farmer quote not found for this RFQ")
            farmer_id = str(offer.get("farmerId"))
            farmer_name = farmer_name or offer.get("farmName") or offer.get("farmerName") or ""
    if not farmer_id and farmer_name:
        name_filter = {"$regex": re.escape(farmer_name), "$options": "i"}
        farmer_doc = await farmer_profile_repo.find_one({"$or": [{"farmName": name_filter}, {"name": name_filter}], "deletedAt": None})
        if farmer_doc and farmer_doc.get("userId"):
            farmer_id = str(farmer_doc["userId"])
    try:
        farmer_oid = ObjectId(farmer_id) if farmer_id else None
    except Exception:
        farmer_oid = None
    if farmer_oid is None:
        raise HTTPException(status_code=400, detail="Select a registered farmer from a recurring RFQ quote; a free-text farmer name is not sufficient")

    now = datetime.utcnow()
    frequency = (data.frequency or (rfq or {}).get("recurrenceFrequency") or "monthly").lower()
    if frequency not in ("daily", "weekly", "monthly"):
        raise HTTPException(status_code=400, detail="Frequency must be daily, weekly or monthly")
    quantity = float(data.quantityPerDeliveryKg or data.quantityPerMonthKg or (rfq or {}).get("quantityPerWeekKg") or 0)
    if quantity <= 0:
        raise HTTPException(status_code=400, detail="Quantity per scheduled delivery is required")
    if data.startDate.replace(tzinfo=None) < now - timedelta(days=1):
        raise HTTPException(status_code=400, detail="Contract start date cannot be in the past")
    existing = await contract_repo.find_one({
        "businessUserId": ObjectId(current_user["_id"]),
        "rfqId": rfq["_id"] if rfq else None,
        "offerId": offer["_id"] if offer else None,
        "deletedAt": None,
        "status": {"$nin": ["cancelled", "completed"]},
    }) if rfq and offer else None
    if existing:
        return {"success": True, "data": _contract_public(existing), "message": "Contract already exists for this quote"}

    end_date = data.endDate or (rfq or {}).get("scheduleEndDate")
    contract = {
        "contractNumber": await _next_number("CTR", contract_repo),
        "businessUserId": ObjectId(current_user["_id"]),
        "farmerId": farmer_oid,
        "farmerName": farmer_name or "Farmer",
        "businessName": ((await profile_repo.find_one({"userId": ObjectId(current_user["_id"]), "deletedAt": None})) or {}).get("companyName") or current_user.get("name") or "Business",
        "rfqId": rfq["_id"] if rfq else None,
        "rfqNumber": (rfq or {}).get("rfqNumber"),
        "offerId": offer["_id"] if offer else None,
        "cropName": (rfq or {}).get("productName") or data.cropName,
        "deliveryAddress": (rfq or {}).get("deliveryAddress"),
        "deliveryCity": (rfq or {}).get("deliveryCity"),
        "deliveryState": (rfq or {}).get("deliveryState"),
        "deliveryDistrict": (rfq or {}).get("deliveryDistrict"),
        "deliveryLocation": (rfq or {}).get("deliveryLocation"),
        "deliveryTimeSlot": (rfq or {}).get("deliveryTimeSlot"),
        "quantityPerDeliveryKg": quantity,
        "quantityPerMonthKg": float(data.quantityPerMonthKg or quantity),
        "pricePerKg": float(data.pricePerKg),
        "frequency": frequency,
        "recurrenceInterval": int(data.recurrenceInterval or 1),
        "durationMonths": int(data.durationMonths),
        "startDate": data.startDate,
        "endDate": end_date,
        "nextDeliveryAt": data.startDate,
        "paymentTerms": data.paymentTerms or (rfq or {}).get("paymentTerms") or "net_7",
        "cancellationTerms": data.cancellationTerms or (rfq or {}).get("cancellationTerms"),
        "status": "pending",
        "generatedScheduleKeys": [],
        "createdAt": now,
        "updatedAt": now,
        "deletedAt": None,
    }
    created_id = await contract_repo.create(contract)
    if not created_id:
        raise HTTPException(status_code=500, detail="Could not create supply contract")
    contract["_id"] = ObjectId(created_id)
    return {"success": True, "data": _contract_public(contract), "message": "Contract sent to farmer for confirmation"}


@router.put("/contracts/{contract_id}/status")
async def update_supply_contract_status(contract_id: str, data: SupplyContractStatusUpdate, current_user: dict = Depends(get_current_user)):
    if data.status not in ("active", "paused", "completed", "cancelled"):
        raise HTTPException(status_code=400, detail="Unsupported contract status")
    try:
        oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Supply contract not found")
    contract = await contract_repo.find_one({"_id": oid, "deletedAt": None})
    if not contract:
        raise HTTPException(status_code=404, detail="Supply contract not found")
    role = current_user.get("role")
    is_business = role == "business" and str(contract.get("businessUserId")) == str(current_user["_id"])
    is_farmer = role == "farmer" and str(contract.get("farmerId")) == str(current_user["_id"])
    if not (is_business or is_farmer):
        raise HTTPException(status_code=403, detail="You cannot change this contract")
    current_status = contract.get("status")
    if current_status in ("completed", "cancelled"):
        raise HTTPException(status_code=409, detail="A completed or cancelled contract cannot be changed")
    if is_farmer:
        if data.status not in ("active", "cancelled"):
            raise HTTPException(status_code=403, detail="Farmers can only accept or decline a pending contract")
        if current_status != "pending":
            raise HTTPException(status_code=409, detail="Only pending contracts can be accepted or declined")
    if is_business:
        allowed_transitions = {
            "pending": {"cancelled"},
            "active": {"paused", "cancelled"},
            "paused": {"active", "cancelled"},
        }
        if data.status not in allowed_transitions.get(current_status, set()):
            raise HTTPException(
                status_code=409,
                detail="Invalid contract transition. The assigned farmer must accept a pending contract before scheduled orders can be generated.",
            )
    await contract_repo.update({"_id": oid}, {"status": data.status, "acceptedAt": datetime.utcnow() if is_farmer and data.status == "active" else contract.get("acceptedAt"), "updatedAt": datetime.utcnow()})
    updated = await contract_repo.find_one({"_id": oid})
    return {"success": True, "data": _contract_public(updated or {**contract, "status": data.status}), "message": "Contract status updated"}


class DeliveryStockConfirmation(BaseModel):
    availableQuantityKg: float = Field(..., ge=0)
    packedQuantityKg: Optional[float] = Field(None, ge=0)
    readyForPickup: bool = True
    scheduledDate: Optional[str] = None
    notes: Optional[str] = None


class DeliveryShortageResolution(BaseModel):
    action: str
    scheduledDate: Optional[str] = None
    newDeliveryDate: Optional[datetime] = None
    approvedQuantityKg: Optional[float] = Field(None, gt=0)
    replacementOfferId: Optional[str] = None
    notes: Optional[str] = None


@router.post("/contracts/{contract_id}/delivery-confirmation")
async def confirm_contract_delivery_stock(
    contract_id: str,
    data: DeliveryStockConfirmation,
    current_user: dict = Depends(get_current_user),
):
    """Farmer confirms actual quantity for the next scheduled contract delivery."""
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only the contracted farmer can confirm delivery stock")
    try:
        oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Supply contract not found")
    contract = await contract_repo.find_one({"_id": oid, "deletedAt": None})
    if not contract or str(contract.get("farmerId")) != str(current_user["_id"]):
        raise HTTPException(status_code=404, detail="Supply contract not found")
    if contract.get("status") != "active":
        raise HTTPException(status_code=409, detail="Only active contracts can confirm scheduled stock")
    next_at = contract.get("nextDeliveryAt")
    if isinstance(next_at, str):
        try:
            next_at = datetime.fromisoformat(next_at.replace("Z", "+00:00")).replace(tzinfo=None)
        except Exception:
            raise HTTPException(status_code=409, detail="Contract has an invalid next delivery date")
    if not isinstance(next_at, datetime):
        raise HTTPException(status_code=409, detail="Contract has no valid next delivery date")
    schedule_key = (data.scheduledDate or next_at.strftime("%Y-%m-%d")).strip()
    try:
        scheduled_day = datetime.strptime(schedule_key, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="scheduledDate must use YYYY-MM-DD")
    if scheduled_day < next_at.date() and schedule_key not in (contract.get("deliveryConfirmations") or {}):
        raise HTTPException(status_code=409, detail="This date is not an open scheduled delivery for the contract")
    requested = float(contract.get("quantityPerDeliveryKg") or contract.get("quantityPerMonthKg") or 0)
    available = float(data.availableQuantityKg)
    packed = float(data.packedQuantityKg if data.packedQuantityKg is not None else available)
    status = "confirmed" if available >= requested and packed >= requested and data.readyForPickup else "shortage"
    confirmations = dict(contract.get("deliveryConfirmations") or {})
    confirmations[schedule_key] = {
        "scheduledDate": schedule_key,
        "requestedQuantityKg": requested,
        "availableQuantityKg": available,
        "packedQuantityKg": packed,
        "readyForPickup": bool(data.readyForPickup and packed >= requested),
        "status": status,
        "notes": (data.notes or "").strip() or None,
        "confirmedBy": ObjectId(current_user["_id"]),
        "confirmedAt": datetime.utcnow(),
        "updatedAt": datetime.utcnow(),
    }
    await contract_repo.update({"_id": oid}, {
        "deliveryConfirmations": confirmations,
        "latestDeliveryStatus": status,
        "latestDeliveryDate": schedule_key,
        "updatedAt": datetime.utcnow(),
    })

    # A full, packed confirmation must create the actual B2B order immediately.
    # The warehouse queue reads b2b_orders, not contract deliveryConfirmations;
    # previously the farmer could confirm stock and the business page would update
    # while no warehouse-visible order existed until a separate generation action.
    created_order_id = None
    # The farmer UI submits the actual delivery date. Do not silently skip order
    # creation just because nextDeliveryAt was advanced or stored with a different
    # date than the submitted occurrence; the scheduled-date validation above is
    # the guard against invalid dates.
    if status == "confirmed":
        db = MongoDB.db
        if db is None:
            raise HTTPException(status_code=503, detail="Database is not ready")
        orders_collection = db["b2b_orders"]
        existing_order = await orders_collection.find_one({
            "contractId": oid,
            "scheduledDeliveryDate": schedule_key,
            "deletedAt": None,
        })
        if existing_order:
            created_order_id = str(existing_order.get("_id"))
        else:
            rfq = await rfq_repo.find_one({"_id": contract.get("rfqId"), "deletedAt": None}) if contract.get("rfqId") else None
            offer = await offer_repo.find_one({"_id": contract.get("offerId"), "deletedAt": None}) if contract.get("offerId") else None
            if not rfq or not offer:
                raise HTTPException(
                    status_code=409,
                    detail=f"Contract {contract.get('contractNumber') or oid} is missing its original RFQ or accepted farmer quote; warehouse order could not be created.",
                )
            order = await _build_order(rfq, offer, requested, None)
            # Keep recurring occurrences grouped under the first B2B order number.
            # First occurrence keeps its normal number (for example B2B-00011);
            # the next is B2B-00011-1A, then -1B, etc.
            prior_occurrences = await orders_collection.find({
                "contractId": oid,
                "deletedAt": None,
                "scheduledDeliveryDate": {"$ne": schedule_key},
            }).sort("createdAt", 1).to_list(length=500)
            if prior_occurrences:
                root_order = next(
                    (row for row in prior_occurrences
                     if not re.search(r"-1[A-Z]$", str(row.get("orderNumber") or ""))),
                    prior_occurrences[0],
                )
                root_number = str(root_order.get("orderNumber") or order.get("orderNumber") or f"B2B-{str(root_order.get('_id'))[-6:]}")
                occurrence_index = len(prior_occurrences) - 1
                suffix = chr(ord("A") + (occurrence_index % 26))
                order["orderNumber"] = f"{root_number}-1{suffix}"
            order.update({
                # This recurring order is initially unassigned to a warehouse.
                # The warehouse queue exposes unassigned pickup orders so a
                # warehouse can claim one during pickup-team assignment.
                "sourceWarehouseId": order.get("sourceWarehouseId"),
                "assignedWarehouseId": order.get("assignedWarehouseId"),
                "pickupWarehouseId": order.get("pickupWarehouseId"),
                "contractId": oid,
                "contractNumber": contract.get("contractNumber"),
                "scheduledDeliveryDate": schedule_key,
                "farmerPrepareBy": order.get("farmerPrepareBy") or datetime.combine(scheduled_day - timedelta(days=1), datetime.min.time()).replace(hour=16),
                "pickupDate": order.get("pickupDate") or (scheduled_day - timedelta(days=1)).isoformat(),
                "pickupWindowStart": "18:00",
                "pickupWindowEnd": "23:59",
                "transferDispatchDate": order.get("transferDispatchDate"),
                "transferTimingRule": "Cross-district: pickup D-2, source processing and transfer by D-1. Same-district: pickup D-1. Dispatch must meet receiving, inspection and final-delivery cutoffs.",
                # Use the occurrence the farmer actually confirmed, not the
                # contract's potentially advanced nextDeliveryAt value. Store a
                # date-only deadline; the route planner interprets it with the
                # configured business delivery time slot.
                "deliveryDeadline": datetime.combine(scheduled_day, datetime.min.time()),
                "businessUserId": contract["businessUserId"],
                "farmerId": contract["farmerId"],
                "rfqId": contract.get("rfqId"),
                "offerId": contract.get("offerId"),
                "productName": contract.get("cropName") or order.get("productName"),
                "deliveryAddress": contract.get("deliveryAddress") or order.get("deliveryAddress") or {},
                "deliveryCity": contract.get("deliveryCity") or order.get("deliveryCity"),
                "deliveryState": contract.get("deliveryState") or order.get("deliveryState"),
                "deliveryDistrict": contract.get("deliveryDistrict") or order.get("deliveryDistrict"),
                "deliveryLocation": contract.get("deliveryLocation") or order.get("deliveryLocation"),
                "deliveryTimeSlot": contract.get("deliveryTimeSlot") or order.get("deliveryTimeSlot"),
                "quantityKg": requested,
                "packedQuantityKg": packed,
                "availableQuantityKg": available,
                "pricePerKg": float(contract.get("pricePerKg") or offer.get("pricePerKg") or 0),
                "productSubtotal": round(requested * float(contract.get("pricePerKg") or offer.get("pricePerKg") or 0), 2),
                "totalAmount": round(requested * float(contract.get("pricePerKg") or offer.get("pricePerKg") or 0) + float(order.get("deliveryCharge") or 0) + float(order.get("taxAmount") or 0) + float(order.get("otherCharges") or 0), 2),
                "status": ORDER_READY_FOR_PICKUP,
                "paymentStatus": PAYMENT_PENDING,
                "deliveryMethod": "dedicated_transport",
                "startedAt": datetime.utcnow(),
                "createdAt": datetime.utcnow(),
                "updatedAt": datetime.utcnow(),
                "deletedAt": None,
            })
            inserted = await orders_collection.insert_one(order)
            created_order_id = str(inserted.inserted_id)

        # Advance only after this occurrence is safely represented by a B2B order.
        # Keep the schedule key as an idempotency guard for the legacy generator.
        frequency = contract.get("frequency") or "monthly"
        interval = int(contract.get("recurrenceInterval") or 1)
        if schedule_key not in (contract.get("generatedScheduleKeys") or []):
            if frequency == "daily":
                next_at = next_at + timedelta(days=interval)
            elif frequency == "weekly":
                next_at = next_at + timedelta(weeks=interval)
            else:
                import calendar
                month = next_at.month - 1 + interval
                year = next_at.year + month // 12
                month = month % 12 + 1
                next_at = next_at.replace(year=year, month=month, day=min(next_at.day, calendar.monthrange(year, month)[1]))
            await contract_repo.update({"_id": oid}, {
                "nextDeliveryAt": next_at,
                "generatedScheduleKeys": list(set((contract.get("generatedScheduleKeys") or []) + [schedule_key])),
                "updatedAt": datetime.utcnow(),
            })

    # Notify the business for both positive confirmations and shortages.
    try:
        shortage_kg = max(0, requested - min(available, packed))
        if status == "confirmed":
            title = "Recurring supply update: full supply confirmed"
            message = f"{contract.get('farmerName') or 'Your farmer'} confirmed {packed:g} kg of {contract.get('cropName') or 'produce'} for {schedule_key} (required {requested:g} kg)."
        else:
            title = "Recurring supply update: shortage reported"
            message = f"{contract.get('farmerName') or 'Your farmer'} reports {shortage_kg:g} kg shortage for {contract.get('cropName') or 'produce'} on {schedule_key}. Available: {available:g} kg; packed: {packed:g} kg. Please review the contract."
        await NotificationService.create_in_app_notification(
            str(contract.get("businessUserId")),
            NotificationType.PROMOTION,
            title,
            message,
            {"type": "b2b_recurring_delivery", "contractId": str(oid), "scheduledDate": schedule_key, "status": status},
            NotificationPriority.HIGH if status == "shortage" else NotificationPriority.MEDIUM,
        )
    except Exception as exc:
        logger.warning("Recurring supply business notification failed for contract %s: %s", oid, exc)
    return {
        "success": True,
        "data": {"contractId": str(oid), "scheduledDeliveryDate": schedule_key,
                 "requestedQuantityKg": requested, "availableQuantityKg": available,
                 "packedQuantityKg": packed, "readyForPickup": bool(data.readyForPickup and packed >= requested),
                 "status": status, "warehouseOrderId": created_order_id,
                 "shortageKg": max(0, round(requested - min(available, packed), 2))},
        "message": (f"Stock confirmed for {schedule_key}. B2B warehouse order {created_order_id} is ready for farm pickup."
                    if status == "confirmed" and created_order_id else
                    "Stock and packing confirmed. The warehouse order will be available after the scheduled delivery enters the planning window."
                    if status == "confirmed" else
                    "A stock or packing shortage was recorded. No full-quantity pickup will be scheduled until the business approves a resolution."),
    }


@router.get("/contracts/{contract_id}/replacement-offers")
async def list_contract_replacement_offers(contract_id: str, current_user: dict = Depends(get_current_user)):
    """Return quotes from other farmers on the same RFQ that could cover a recurring shortage."""
    if current_user.get("role") != "business":
        raise HTTPException(status_code=403, detail="Only the business buyer can source replacement farmers")
    try:
        oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Supply contract not found")
    contract = await contract_repo.find_one({"_id": oid, "businessUserId": ObjectId(current_user["_id"]), "deletedAt": None})
    if not contract:
        raise HTTPException(status_code=404, detail="Supply contract not found")
    if not contract.get("rfqId"):
        return {"success": True, "data": {"offers": []}}
    offers = await offer_repo.find_many({"rfqId": contract["rfqId"], "deletedAt": None}, limit=200) or []
    result = []
    for offer in offers:
        farmer_id = str(offer.get("farmerId") or "")
        if not farmer_id or farmer_id == str(contract.get("farmerId")):
            continue
        qty = float(offer.get("availableQuantityKg") or offer.get("minOrderKg") or 0)
        result.append({
            "id": str(offer.get("_id")),
            "farmerId": farmer_id,
            "farmerName": offer.get("farmerName") or offer.get("farmName") or "Replacement farmer",
            "availableQuantityKg": qty,
            "pricePerKg": float(offer.get("pricePerKg") or 0),
            "status": offer.get("status") or "submitted",
        })
    return {"success": True, "data": {"offers": result}}


@router.post("/contracts/{contract_id}/delivery-resolution")
async def resolve_contract_delivery_shortage(
    contract_id: str,
    data: DeliveryShortageResolution,
    current_user: dict = Depends(get_current_user),
):
    """Business approves a partial delivery, reschedule, or marks backup sourcing as required."""
    if current_user.get("role") != "business":
        raise HTTPException(status_code=403, detail="Only the business buyer can resolve a delivery shortage")
    try:
        oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Supply contract not found")
    contract = await contract_repo.find_one({"_id": oid, "deletedAt": None})
    if not contract or str(contract.get("businessUserId")) != str(current_user["_id"]):
        raise HTTPException(status_code=404, detail="Supply contract not found")
    next_at = contract.get("nextDeliveryAt")
    if isinstance(next_at, str):
        try:
            next_at = datetime.fromisoformat(next_at.replace("Z", "+00:00")).replace(tzinfo=None)
        except Exception:
            raise HTTPException(status_code=409, detail="Contract has an invalid next delivery date")
    if not isinstance(next_at, datetime):
        raise HTTPException(status_code=409, detail="Contract has no valid next delivery date")
    schedule_key = (data.scheduledDate or next_at.strftime("%Y-%m-%d")).strip()
    try:
        datetime.strptime(schedule_key, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="scheduledDate must use YYYY-MM-DD")
    confirmations = dict(contract.get("deliveryConfirmations") or {})
    confirmation = confirmations.get(schedule_key)
    if not confirmation or confirmation.get("status") not in ("shortage", "backup_required", "partial_approved"):
        raise HTTPException(status_code=409, detail=f"No unresolved shortage exists for scheduled delivery {schedule_key}")
    action = data.action.strip().lower()
    now = datetime.utcnow()
    if action == "partial":
        quantity = float(data.approvedQuantityKg or 0)
        available = float(confirmation.get("availableQuantityKg") or 0)
        if quantity <= 0 or quantity > available:
            raise HTTPException(status_code=400, detail="Approved partial quantity must be greater than zero and no more than the farmer's confirmed stock")
        confirmation.update({"status": "partial_approved", "approvedQuantityKg": quantity,
                             "readyForPickup": float(confirmation.get("packedQuantityKg") or 0) >= quantity,
                             "resolution": "partial", "resolutionNotes": data.notes, "resolvedAt": now})
        confirmations[schedule_key] = confirmation
        await contract_repo.update({"_id": oid}, {"deliveryConfirmations": confirmations,
            "latestDeliveryStatus": "partial_approved", "latestDeliveryDate": schedule_key, "updatedAt": now})
        try:
            await NotificationService.create_in_app_notification(
                str(contract.get("farmerId")), NotificationType.PROMOTION,
                "Business approved partial recurring supply",
                f"The business approved {quantity:g} kg for {schedule_key}. Review the updated pickup quantity.",
                {"type": "b2b_recurring_delivery", "contractId": str(oid), "scheduledDate": schedule_key, "status": "partial_approved"},
                NotificationPriority.HIGH,
            )
        except Exception as exc:
            logger.warning("Recurring supply farmer notification failed for contract %s: %s", oid, exc)
        return {"success": True, "data": {"status": "partial_approved", "scheduledDeliveryDate": schedule_key,
            "approvedQuantityKg": quantity}, "message": "Partial delivery approved; order generation will use the approved quantity."}
    if action == "reschedule":
        new_date = data.newDeliveryDate
        if not new_date:
            raise HTTPException(status_code=400, detail="newDeliveryDate is required for rescheduling")
        new_date = new_date.replace(tzinfo=None)
        if new_date.date() <= datetime.utcnow().date():
            raise HTTPException(status_code=400, detail="Choose a future delivery date")
        confirmation.update({"status": "rescheduled", "resolution": "reschedule",
                             "resolutionNotes": data.notes, "resolvedAt": now, "rescheduledTo": new_date})
        confirmations[schedule_key] = confirmation
        # Rescheduling one occurrence must not shift every future occurrence of the recurring contract.
        await contract_repo.update({"_id": oid}, {"deliveryConfirmations": confirmations,
            "latestDeliveryStatus": "rescheduled", "latestDeliveryDate": schedule_key, "updatedAt": now})
        try:
            await NotificationService.create_in_app_notification(
                str(contract.get("farmerId")), NotificationType.PROMOTION,
                "Recurring supply delivery rescheduled",
                f"The business rescheduled the delivery originally planned for {schedule_key} to {new_date:%Y-%m-%d}.",
                {"type": "b2b_recurring_delivery", "contractId": str(oid), "scheduledDate": schedule_key, "status": "rescheduled"},
                NotificationPriority.HIGH,
            )
        except Exception as exc:
            logger.warning("Recurring supply farmer notification failed for contract %s: %s", oid, exc)
        return {"success": True, "data": {"status": "rescheduled", "nextDeliveryAt": new_date.isoformat()},
                "message": "Delivery rescheduled with business approval; the contract remains active."}
    if action == "assign_replacement":
        if not data.replacementOfferId:
            raise HTTPException(status_code=400, detail="Choose an eligible replacement farmer quote")
        try:
            replacement_offer_id = ObjectId(data.replacementOfferId)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid replacement quote")
        rfq_id = contract.get("rfqId")
        if not rfq_id:
            raise HTTPException(status_code=409, detail="This contract has no originating recurring RFQ for replacement sourcing")
        replacement_offer = await offer_repo.find_one({"_id": replacement_offer_id, "rfqId": rfq_id, "deletedAt": None})
        if not replacement_offer:
            raise HTTPException(status_code=404, detail="Replacement quote not found for this recurring RFQ")
        replacement_farmer_id = str(replacement_offer.get("farmerId") or "")
        if not replacement_farmer_id or replacement_farmer_id == str(contract.get("farmerId")):
            raise HTTPException(status_code=400, detail="Replacement must be a different registered farmer")
        requested = float(confirmation.get("requestedQuantityKg") or contract.get("quantityPerDeliveryKg") or 0)
        available = float(confirmation.get("availableQuantityKg") or 0)
        packed = float(confirmation.get("packedQuantityKg") or 0)
        original_approved = float(confirmation.get("approvedQuantityKg") or min(available, packed))
        missing = max(0.0, requested - original_approved)
        if missing <= 0:
            raise HTTPException(status_code=409, detail="There is no remaining shortage to source")
        replacement_available = float(replacement_offer.get("availableQuantityKg") or replacement_offer.get("minOrderKg") or 0)
        if replacement_available < missing:
            raise HTTPException(status_code=409, detail=f"Replacement farmer has only {replacement_available:g} kg available; {missing:g} kg is required")
        rfq = await rfq_repo.find_one({"_id": rfq_id, "deletedAt": None})
        if not rfq:
            raise HTTPException(status_code=409, detail="Original recurring RFQ is unavailable")
        replacement_order = await _build_order(rfq, replacement_offer, missing, None)
        db = MongoDB.db
        if db is None:
            raise HTTPException(status_code=503, detail="Database is not ready")
        existing_replacement = await db["b2b_orders"].find_one({
            "contractId": oid, "scheduledDeliveryDate": schedule_key,
            "replacementForFarmerId": contract.get("farmerId"), "deletedAt": None,
        })
        if existing_replacement:
            raise HTTPException(status_code=409, detail="A replacement order already exists for this scheduled delivery")
        replacement_order.update({
            "contractId": oid, "contractNumber": contract.get("contractNumber"),
            "scheduledDeliveryDate": schedule_key, "replacementForFarmerId": contract.get("farmerId"),
            "replacementForShortageKg": missing, "isReplacementSupply": True,
            "farmerId": replacement_offer.get("farmerId"), "businessUserId": contract.get("businessUserId"),
            "productName": contract.get("cropName") or replacement_order.get("productName"),
            "quantityKg": missing, "status": ORDER_READY_FOR_PICKUP,
            "farmerPrepareBy": datetime.strptime(schedule_key, "%Y-%m-%d") - timedelta(days=1) + timedelta(hours=16),
            "pickupDate": (datetime.strptime(schedule_key, "%Y-%m-%d").date() - timedelta(days=1)).isoformat(),
            "pickupWindowStart": "18:00", "pickupWindowEnd": "23:59",
            "deliveryDeadline": datetime.strptime(schedule_key, "%Y-%m-%d"),
            "createdAt": now, "updatedAt": now, "deletedAt": None,
        })
        inserted = await db["b2b_orders"].insert_one(replacement_order)
        confirmation.update({
            "status": "replacement_assigned", "approvedQuantityKg": original_approved,
            "readyForPickup": original_approved > 0 and packed >= original_approved,
            "resolution": "replacement_supplier",
            "resolutionNotes": data.notes, "replacementOfferId": str(replacement_offer_id),
            "replacementFarmerId": replacement_farmer_id, "replacementOrderId": str(inserted.inserted_id),
            "replacementQuantityKg": missing, "resolvedAt": now,
        })
        confirmations[schedule_key] = confirmation
        await contract_repo.update({"_id": oid}, {
            "deliveryConfirmations": confirmations, "latestDeliveryStatus": "replacement_assigned",
            "latestDeliveryDate": schedule_key, "updatedAt": now,
        })
        try:
            await NotificationService.create_in_app_notification(
                str(contract.get("businessUserId")), NotificationType.PROMOTION,
                "Replacement supplier assigned",
                f"A replacement farmer was assigned {missing:g} kg for {contract.get('cropName') or 'produce'} on {schedule_key}.",
                {"type": "b2b_recurring_delivery", "contractId": str(oid), "scheduledDate": schedule_key, "replacementOrderId": str(inserted.inserted_id)},
                NotificationPriority.HIGH,
            )
        except Exception as exc:
            logger.warning("Replacement supplier business notification failed for contract %s: %s", oid, exc)
        return {"success": True, "data": {"status": "replacement_assigned", "scheduledDeliveryDate": schedule_key,
            "replacementOrderId": str(inserted.inserted_id), "replacementQuantityKg": missing},
            "message": f"Replacement order created for {missing:g} kg. It will follow the existing B2B warehouse fulfillment workflow."}
    if action == "backup_required":
        confirmation.update({"status": "backup_required", "resolution": "backup_required",
                             "resolutionNotes": data.notes, "resolvedAt": now})
        confirmations[schedule_key] = confirmation
        await contract_repo.update({"_id": oid}, {"deliveryConfirmations": confirmations,
            "latestDeliveryStatus": "backup_required", "latestDeliveryDate": schedule_key, "updatedAt": now})
        try:
            await NotificationService.create_in_app_notification(
                str(contract.get("farmerId")), NotificationType.PROMOTION,
                "Business requested replacement sourcing",
                f"The business requested backup sourcing for the recurring delivery on {schedule_key}. Do not treat the original quantity as fulfilled.",
                {"type": "b2b_recurring_delivery", "contractId": str(oid), "scheduledDate": schedule_key, "status": "backup_required"},
                NotificationPriority.HIGH,
            )
        except Exception as exc:
            logger.warning("Recurring supply farmer notification failed for contract %s: %s", oid, exc)
        return {"success": True, "data": {"status": "backup_required", "scheduledDeliveryDate": schedule_key},
                "message": "Backup sourcing required. The delivery is blocked until an approved replacement supplier is assigned."}
    raise HTTPException(status_code=400, detail="action must be partial, reschedule, or backup_required")


@router.post("/contracts/generate-due-orders")
async def generate_due_supply_orders(current_user: dict = Depends(get_current_user)):
    """Idempotently generate confirmed scheduled B2B orders ahead of the delivery date.

    The scheduler looks ahead so farmers and warehouse teams have time to prepare.
    A batch is only created after the farmer confirms both available and packed stock.
    """
    if current_user.get("role") not in ("admin", "super_admin", "business"):
        raise HTTPException(status_code=403, detail="Not permitted to run recurring order generation")
    now = datetime.utcnow()
    # Generate up to 48 hours ahead. This is essential for night pickup and
    # cross-district transfers that must depart one day before morning delivery.
    planning_horizon = now + timedelta(days=2)
    query = {"status": "active", "nextDeliveryAt": {"$lte": planning_horizon}, "deletedAt": None}
    if current_user.get("role") == "business":
        query["businessUserId"] = ObjectId(current_user["_id"])
    contracts = await contract_repo.find_many(query, limit=500) or []
    generated = []
    for contract in contracts:
        next_at = contract.get("nextDeliveryAt")
        if isinstance(next_at, str):
            try:
                next_at = datetime.fromisoformat(next_at.replace("Z", "+00:00")).replace(tzinfo=None)
            except Exception:
                continue
        if not isinstance(next_at, datetime):
            continue
        schedule_key = next_at.strftime("%Y-%m-%d")
        if schedule_key in (contract.get("generatedScheduleKeys") or []):
            continue
        # Do not generate an order until the farmer confirms the real quantity
        # for this delivery, and the business has approved any partial supply.
        confirmations = contract.get("deliveryConfirmations") or {}
        confirmation = confirmations.get(schedule_key) if isinstance(confirmations, dict) else None
        if not confirmation or confirmation.get("status") not in ("confirmed", "partial_approved", "replacement_assigned"):
            continue
        confirmed_quantity = float(
            confirmation.get("approvedQuantityKg")
            or confirmation.get("requestedQuantityKg")
            or 0
        )
        available_quantity = float(confirmation.get("availableQuantityKg") or 0)
        packed_quantity = float(confirmation.get("packedQuantityKg", available_quantity) or 0)
        if (
            confirmed_quantity <= 0
            or available_quantity < confirmed_quantity
            or packed_quantity < confirmed_quantity
            or confirmation.get("readyForPickup", True) is not True
        ):
            continue
        end_at = contract.get("endDate")
        if isinstance(end_at, datetime) and next_at > end_at:
            await contract_repo.update({"_id": contract["_id"]}, {"status": "completed", "updatedAt": now})
            continue
        db = MongoDB.db
        if db is None:
            raise HTTPException(status_code=503, detail="Database is not ready")
        orders_collection = db["b2b_orders"]
        exists = await orders_collection.find_one({"contractId": contract["_id"], "scheduledDeliveryDate": schedule_key, "deletedAt": None})
        if exists:
            pass
        else:
            # Build scheduled orders through the same warehouse-route calculation as
            # one-off orders. A recurring order without a source warehouse cannot
            # be assigned to a pickup team, so do not create an unusable order.
            rfq = await rfq_repo.find_one({"_id": contract.get("rfqId"), "deletedAt": None}) if contract.get("rfqId") else None
            offer = await offer_repo.find_one({"_id": contract.get("offerId"), "deletedAt": None}) if contract.get("offerId") else None
            if not rfq or not offer:
                raise HTTPException(status_code=409, detail=f"Contract {contract.get('contractNumber') or contract['_id']} is missing its original RFQ or accepted farmer quote; scheduled order was not created.")
            quantity = confirmed_quantity
            if quantity <= 0:
                raise HTTPException(status_code=409, detail=f"Contract {contract.get('contractNumber') or contract['_id']} has no valid scheduled delivery quantity.")
            order = await _build_order(rfq, offer, quantity, None)
            order.update({
                "contractId": contract["_id"],
                "contractNumber": contract.get("contractNumber"),
                "scheduledDeliveryDate": schedule_key,
                # Keep the route-aware backward plan from _build_order. For
                # cross-district deliveries this means pickup D-2 and transfer D-1.
                "farmerPrepareBy": order.get("farmerPrepareBy") or datetime.combine(next_at.date() - timedelta(days=1), datetime.min.time()).replace(hour=16),
                "pickupDate": order.get("pickupDate") or (next_at.date() - timedelta(days=1)).isoformat(),
                "pickupWindowStart": "18:00",
                "pickupWindowEnd": "23:59",
                "transferDispatchDate": order.get("transferDispatchDate"),
                "transferTimingRule": "Cross-district: pickup D-2, source processing and transfer by D-1. Same-district: pickup D-1. Dispatch must meet receiving, inspection and final-delivery cutoffs.",
                "deliveryDeadline": next_at,
                "businessUserId": contract["businessUserId"],
                "farmerId": contract["farmerId"],
                "rfqId": contract.get("rfqId"),
                "offerId": contract.get("offerId"),
                "productName": contract.get("cropName") or order.get("productName"),
                "deliveryAddress": contract.get("deliveryAddress") or order.get("deliveryAddress") or {},
                "deliveryCity": contract.get("deliveryCity") or order.get("deliveryCity"),
                "deliveryState": contract.get("deliveryState") or order.get("deliveryState"),
                "deliveryDistrict": contract.get("deliveryDistrict") or order.get("deliveryDistrict"),
                "deliveryLocation": contract.get("deliveryLocation") or order.get("deliveryLocation"),
                "deliveryTimeSlot": contract.get("deliveryTimeSlot") or order.get("deliveryTimeSlot"),
                "quantityKg": quantity,
                "pricePerKg": float(contract.get("pricePerKg") or offer.get("pricePerKg") or 0),
                "productSubtotal": round(quantity * float(contract.get("pricePerKg") or offer.get("pricePerKg") or 0), 2),
                "totalAmount": round(quantity * float(contract.get("pricePerKg") or offer.get("pricePerKg") or 0) + float(order.get("deliveryCharge") or 0) + float(order.get("taxAmount") or 0) + float(order.get("otherCharges") or 0), 2),
                "status": ORDER_READY_FOR_PICKUP,
                "paymentStatus": PAYMENT_PENDING,
                "deliveryMethod": "dedicated_transport",
                "startedAt": now,
                "createdAt": now,
                "updatedAt": now,
                "deletedAt": None,
            })
            result = await orders_collection.insert_one(order)
            generated.append({"orderId": str(result.inserted_id), "contractId": str(contract["_id"]), "scheduledDeliveryDate": schedule_key})
        frequency = contract.get("frequency") or "monthly"
        interval = int(contract.get("recurrenceInterval") or 1)
        if frequency == "daily":
            next_at = next_at + timedelta(days=interval)
        elif frequency == "weekly":
            next_at = next_at + timedelta(weeks=interval)
        else:
            # Calendar-month arithmetic avoids drifting on 29th-31st.
            month = next_at.month - 1 + interval
            year = next_at.year + month // 12
            month = month % 12 + 1
            import calendar
            next_at = next_at.replace(year=year, month=month, day=min(next_at.day, calendar.monthrange(year, month)[1]))
        await contract_repo.update({"_id": contract["_id"]}, {"nextDeliveryAt": next_at, "generatedScheduleKeys": list(set((contract.get("generatedScheduleKeys") or []) + [schedule_key])), "updatedAt": now})
    return {"success": True, "data": {"generated": generated, "count": len(generated)}}
