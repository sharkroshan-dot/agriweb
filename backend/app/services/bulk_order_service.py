"""Business logic for the Bulk / Event order engine.

One common "purchase request -> farmer offer -> selection -> order" engine used
by both customer event requests (weddings/functions) and business RFQs. The
buyer type and order type are stored on each document so the farmer's unified
"Purchase Requests" inbox can show both sources in one place.

Matching and the AI recommendation are deterministic, explainable heuristics
(no external model calls) so the platform is predictable and offline-safe.
"""
import math
from datetime import datetime
from typing import Any, Dict, List, Optional

from app.repositories.base_repository import BaseRepository
from app.repositories.product_repository import product_repository
from app.repositories.farmer_repository import farmer_repository
from app.services.inventory_service import InventoryService

request_repo = BaseRepository("bulk_requests")
offer_repo = BaseRepository("bulk_offers")
order_repo = BaseRepository("bulk_orders")

REQUEST_OPEN = "open"
REQUEST_OFFERS = "offers_received"
REQUEST_AWARDED = "awarded"
REQUEST_CANCELLED = "cancelled"

OFFER_PENDING = "pending"
OFFER_ACCEPTED = "accepted"
OFFER_DECLINED = "declined"

ORDER_CONFIRMED = "confirmed"
ORDER_PREPARING = "preparing"
ORDER_PICKED_UP = "picked_up"
ORDER_OUT_FOR_DELIVERY = "out_for_delivery"
ORDER_DELIVERED = "delivered"
ORDER_CANCELLED = "cancelled"

VALID_ORDER_FLOW = [
    ORDER_CONFIRMED,
    ORDER_PREPARING,
    ORDER_PICKED_UP,
    ORDER_OUT_FOR_DELIVERY,
    ORDER_DELIVERED,
]


def haversine_km(lat1: Optional[float], lng1: Optional[float], lat2: Optional[float], lng2: Optional[float]) -> float:
    """Great-circle distance between two coordinates in km (0.0 if unknown)."""
    if lat1 is None or lng1 is None or lat2 is None or lng2 is None:
        return 0.0
    r = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    )
    return 2 * r * math.asin(math.sqrt(a))


def _coords(location: Any) -> Optional[List[float]]:
    if isinstance(location, dict):
        coords = location.get("coordinates")
        if isinstance(coords, list) and len(coords) >= 2:
            return coords
    return None


def _farmer_location(farmer: Dict[str, Any]) -> Optional[List[float]]:
    for key in ("location", "farmLocation"):
        loc = farmer.get(key)
        coords = _coords(loc)
        if coords:
            return coords
    return None


class BulkOrderService:
    @staticmethod
    def _normalize(name: Optional[str]) -> str:
        return (name or "").strip().lower()

    @staticmethod
    async def _farmer_supply_map(farmer_user_id: str) -> Dict[str, Dict[str, Any]]:
        """Map normalized product name -> available stock for a farmer."""
        products = await product_repository.get_by_farmer(farmer_user_id, limit=500)
        supply: Dict[str, Dict[str, Any]] = {}
        for p in products:
            key = BulkOrderService._normalize(p.get("name"))
            if not key:
                continue
            stock = await InventoryService.get_available_stock(str(p["_id"]))
            supply[key] = {
                "productId": str(p["_id"]),
                "productName": p.get("name"),
                "availableKg": stock,
                "pricePerKg": float(p.get("bulkPrice") or p.get("price") or 0),
                "qualityGrade": p.get("qualityGrade"),
            }
        return supply

    @staticmethod
    async def match_request_for_farmer(request: Dict[str, Any], farmer_user_id: str) -> Dict[str, Any]:
        """How this request matches a specific farmer's catalogue + location."""
        supply = await BulkOrderService._farmer_supply_map(farmer_user_id)
        matched_items = []
        for item in request.get("items", []):
            name_key = BulkOrderService._normalize(item.get("name"))
            match = supply.get(name_key)
            if not match:
                match = next(
                    (v for k, v in supply.items() if name_key and (name_key in k or k in name_key)),
                    None,
                )
            if match:
                matched_items.append({
                    "name": item.get("name"),
                    "quantityKg": float(item.get("quantityKg") or 0),
                    "availableKg": match["availableKg"],
                    "productId": match["productId"],
                    "productName": match["productName"],
                    "pricePerKg": match["pricePerKg"],
                    "qualityGrade": match.get("qualityGrade"),
                })

        distance_km = 0.0
        farmer = await farmer_repository.get_by_user_id(farmer_user_id)
        if farmer:
            f_loc = _farmer_location(farmer)
            r_loc = _coords((request.get("deliveryAddress") or {}).get("location"))
            if f_loc and r_loc:
                distance_km = haversine_km(r_loc[1], r_loc[0], f_loc[1], f_loc[0])

        return {
            "matchedItems": matched_items,
            "matchedItemCount": len(matched_items),
            "distanceKm": round(distance_km, 1),
            "canSupply": len(matched_items) > 0,
        }

    @staticmethod
    async def recommend(request: Dict[str, Any], offers: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Score pending offers and recommend the best single offer.

        Score (0-100) blends price competitiveness, coverage of the requested
        quantity, farmer rating, distance, and delivery availability. The buyer
        always keeps the final decision.
        """
        total_qty = sum(float((i.get("quantityKg")) or 0) for i in request.get("items", []))
        pending = [o for o in offers if o.get("status") == OFFER_PENDING]
        priced = [o for o in pending if o.get("totalPrice")]
        if not pending or total_qty <= 0:
            return {"recommendedOfferIds": [], "reason": "No offers yet", "scores": []}

        best_price = min(float(o.get("totalPrice") or 0) for o in priced) if priced else 0.0

        scores = []
        for o in pending:
            price = float(o.get("totalPrice") or 0)
            price_score = 100.0 if best_price <= 0 else max(0.0, min(100.0, (best_price / price) * 100)) if price > 0 else 0.0
            coverage = float(o.get("coveragePercent") or 0)
            farmer = await farmer_repository.get_by_user_id(str(o.get("farmerId")))
            rating = float((farmer or {}).get("rating") or 0)
            rating_score = (rating / 5.0) * 100.0
            delivery_score = 100.0 if o.get("deliveryAvailable") else 40.0
            total = (
                price_score * 0.4
                + coverage * 0.25
                + rating_score * 0.2
                + delivery_score * 0.15
            )
            scores.append({
                "offerId": str(o["_id"]),
                "farmName": (farmer or {}).get("farmName") or "Farm",
                "priceScore": round(price_score, 1),
                "coverage": round(coverage, 1),
                "ratingScore": round(rating_score, 1),
                "deliveryScore": round(delivery_score, 1),
                "totalScore": round(total, 1),
            })

        scores.sort(key=lambda s: s["totalScore"], reverse=True)
        recommended = scores[0]["offerId"] if scores else None
        reason = "Best overall offer across price, availability, rating and delivery."
        if not recommended:
            reason = "No offers available to compare."
        return {
            "recommendedOfferIds": [recommended] if recommended else [],
            "reason": reason,
            "scores": scores,
        }

    @staticmethod
    def request_number() -> str:
        return f"BR-{datetime.utcnow().strftime('%Y%m%d')}-{datetime.utcnow().microsecond % 100000:05d}"

    @staticmethod
    def order_number() -> str:
        return f"BO-{datetime.utcnow().strftime('%Y%m%d')}-{datetime.utcnow().microsecond % 100000:05d}"