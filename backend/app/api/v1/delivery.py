from fastapi import APIRouter, Depends, HTTPException, status, Query, Body, UploadFile, File
from typing import List, Optional
from datetime import datetime, timedelta
from uuid import uuid4
import os
from bson import ObjectId
from pydantic import BaseModel
from app.core.config import settings
from app.database.mongodb import MongoDB
from app.api.v1.auth import get_current_user
from app.schemas.delivery import (
    DeliveryPartnerResponse, DeliveryPartnerCreate, DeliveryPartnerUpdate,
    DeliveryLocationUpdate, RouteOptimizationRequest,
    RouteOptimizationResponse, DeliveryTrackingResponse,
    DeliveryStatus, DeliveryPartnerStatus, VehicleType
)
from app.schemas.order import OrderStatus
from app.services.delivery_service import DeliveryService
from app.services.order_service import geocode_address
from app.services.user_service import UserService
from app.services.farmer_service import FarmerService
from app.services.payment_service import PaymentService
from app.repositories.delivery_assignment_repository import delivery_assignment_repository
from app.repositories.order_repository import order_repository
from app.repositories.product_repository import product_repository
from app.repositories.delivery_repository import delivery_repository
from app.repositories.wallet_repository import wallet_repository, wallet_transaction_repository
from app.repositories.withdrawal_repository import withdrawal_repository
from app.repositories.cash_settlement_repository import cash_settlement_repository
from app.repositories.base_repository import BaseRepository
from app.services.delivery_job_service import (
    delivery_job_repository,
    serialize_job_for_partner,
    partner_commitment,
    passes_capacity,
    ACCEPTABLE_ORDER_STATUSES,
    build_job_document,
    eligible_partners_for_job,
    JOB_DEFAULT_EXPIRY_MINUTES,
)
from app.repositories.delivery_job_repository import JOB_OPEN
from app.services.notification_service import NotificationService
import logging

logger = logging.getLogger(__name__)

# ---------- Feature helpers ----------

class PODSubmit(BaseModel):
    recipientName: Optional[str] = None
    note: Optional[str] = None

class SupportMessageSend(BaseModel):
    conversationId: str
    content: str

class WithdrawEarningsRequest(BaseModel):
    amount: Optional[float] = None
    bankAccount: Optional[dict] = None

class ShareLinkResponse(BaseModel):
    shareToken: str
    shareUrl: str


class DeliveryFeeEstimateItem(BaseModel):
    productId: str
    quantity: float = 1.0


class DeliveryFeeEstimateRequest(BaseModel):
    items: List[DeliveryFeeEstimateItem]
    deliveryAddressId: Optional[str] = None
    coordinates: Optional[dict] = None
    method: Optional[str] = "farmer"
    orderAmount: Optional[float] = None


def _partner_user_id(current_user: dict) -> str:
    return str(current_user["_id"])


def _normalize_location(value) -> Optional[dict]:
    """Normalize legacy address coordinate formats to GeoJSON Point."""
    if not isinstance(value, dict):
        return None
    coordinates = value.get("coordinates")
    if isinstance(coordinates, (list, tuple)) and len(coordinates) >= 2:
        try:
            return {"type": "Point", "coordinates": [float(coordinates[0]), float(coordinates[1])]}
        except (TypeError, ValueError):
            return None
    lat = value.get("lat", value.get("latitude"))
    lng = value.get("lng", value.get("lon", value.get("longitude")))
    if lat is not None and lng is not None:
        try:
            return {"type": "Point", "coordinates": [float(lng), float(lat)]}
        except (TypeError, ValueError):
            return None
    return None


async def _get_partner_profile(partner_id: str) -> dict:
    return await delivery_repository.get_by_id(partner_id)


async def _resolve_pickup_location(order: dict) -> Optional[dict]:
    """Resolve the order's pickup (farm) location as a GeoJSON Point.

    Tries in order: pickup/farm location stored on the order, the farmer's
    profile farm location (geocoding the farm address if needed), then the
    product location from the first order item.
    """
    for key in ("pickupLocation", "farmLocation"):
        loc = order.get(key)
        if loc:
            normalized = _normalize_location(loc)
            if normalized:
                return normalized

    farmer_id = order.get("farmerId")
    profile = None
    if farmer_id:
        try:
            profile = await FarmerService.get_farmer_profile(str(farmer_id))
        except Exception:
            profile = None
        if profile:
            loc = profile.get("farmLocation") or profile.get("location")
            if loc:
                normalized = _normalize_location(loc)
                if normalized:
                    return normalized
            farm_address = profile.get("farmAddress")
            if farm_address:
                try:
                    geocoded = await geocode_address({
                        "address_line1": farm_address,
                        "address_line2": "",
                        "city": profile.get("farmCity", ""),
                        "state": profile.get("farmState", ""),
                        "zip_code": str(profile.get("farmPincode", "") or ""),
                        "country": "India",
                    })
                except Exception:
                    geocoded = None
                if geocoded:
                    return geocoded

    items = order.get("items") or []
    if items:
        product_id = items[0].get("productId")
        if product_id:
            try:
                from app.repositories.product_repository import product_repository
                product = await product_repository.get_by_id(str(product_id))
            except Exception:
                product = None
            if product:
                loc = product.get("location")
                if loc:
                    normalized = _normalize_location(loc)
                    if normalized:
                        return normalized
    return None


async def _resolve_pickup_info(order: dict) -> dict:
    """Pickup (farm) summary for an order: name, address and GeoJSON location."""
    farm_name = "Farm"
    farm_address = order.get("farmAddress") or ""
    farmer_id = order.get("farmerId")
    if farmer_id:
        try:
            profile = await FarmerService.get_farmer_profile(str(farmer_id))
        except Exception:
            profile = None
        if profile:
            farm_name = profile.get("farmName") or profile.get("ownerName") or "Farm"
            farm_address = profile.get("farmAddress") or farm_address
    return {
        "name": farm_name,
        "address": farm_address,
        "location": await _resolve_pickup_location(order),
    }


async def _enrich_assignment(assignment: dict) -> dict:
    """Add order + customer details to an assignment, shaped for the mobile UI."""
    assignment["id"] = str(assignment["_id"])
    oid = str(assignment["orderId"])
    order = await order_repository.get_by_id(oid)
    if not order:
        assignment["status"] = assignment.get("status")
        assignment["orderId"] = oid
        return assignment
    address = order.get("deliveryAddress") or {}
    normalized_location = (
        _normalize_location(address.get("location"))
        or _normalize_location(address.get("deliveryLocation"))
        or _normalize_location(address)
    )
    if normalized_location:
        address["location"] = normalized_location
    elif address:
        address_location = await geocode_address({
            "address_line1": address.get("addressLine1") or address.get("address_line1", ""),
            "address_line2": address.get("addressLine2") or address.get("address_line2", ""),
            "city": address.get("city", ""),
            "state": address.get("state", ""),
            "zip_code": address.get("zipCode") or address.get("zip_code", ""),
            "country": address.get("country", "India"),
        })
        if address_location:
            address["location"] = address_location
    assignment["orderNumber"] = order.get("orderNumber")
    assignment["totalAmount"] = order.get("totalAmount")
    assignment["paymentMethod"] = (
        order.get("paymentMethod")
        or (order.get("payment") or {}).get("method")
        or "cash"
    )
    assignment["address"] = address
    assignment["deliveryAddress"] = address
    assignment["pickup"] = await _resolve_pickup_info(order)
    assignment["items"] = order.get("items", [])
    assignment["customerName"] = order.get("customerName") or "Customer"
    assignment["earnings"] = order.get("deliveryCharge", 0)
    assignment["status"] = assignment.get("status") or order.get("orderStatus")
    assignment["orderId"] = oid
    customer = None
    if order.get("customerId"):
        customer = await UserService.get_user_by_id(str(order["customerId"]))
    if customer:
        assignment["customerName"] = f"{customer.get('firstName', '')} {customer.get('lastName', '')}".strip()
        assignment["customerPhone"] = customer.get("phone")
    return assignment


async def _delivery_charge(order_id: str) -> float:
    """Delivery fee earned for an order."""
    try:
        order = await order_repository.get_by_id(order_id)
    except Exception:
        return 0.0
    return float(order.get("deliveryCharge", 0)) if order else 0.0


async def _partner_completed_deliveries(partner_id: str, user_id: str, limit: int = 1000) -> List[dict]:
    """Every delivered delivery for a partner.

    Merges delivered assignment records keyed by either the delivery profile id
    or the login user id, plus orders delivered directly without an assignment
    record, deduplicated by order id.
    """
    completed = []
    seen_order_ids = set()
    for key in dict.fromkeys((partner_id, user_id)):
        for a in await delivery_assignment_repository.get_by_delivery_partner(
            key, status=DeliveryStatus.DELIVERED, limit=limit
        ):
            order_id = str(a.get("orderId"))
            if not order_id or order_id in seen_order_ids:
                continue
            seen_order_ids.add(order_id)
            completed.append(a)
        for order in await order_repository.get_by_delivery_partner(
            key, status=OrderStatus.DELIVERED.value, limit=limit
        ):
            order_id = str(order["_id"])
            if order_id in seen_order_ids:
                continue
            seen_order_ids.add(order_id)
            order["orderId"] = order_id
            completed.append(order)
    return completed


def _delivery_completed_at(item: dict) -> Optional[datetime]:
    """Best-known completion timestamp for an assignment or order record."""
    if "deliveredAt" in item:
        return item.get("deliveredAt") or item.get("updatedAt")
    return item.get("completedAt") or item.get("updatedAt") or item.get("assignedAt")


async def _available_delivery_balance(partner_id: str, user_id: str) -> float:
    """Withdrawable balance = lifetime earned delivery fees minus withdrawals."""
    completed = await _partner_completed_deliveries(partner_id, user_id)
    total_earned = 0.0
    for item in completed:
        total_earned += await _delivery_charge(item.get("orderId"))
    total_withdrawn = 0.0
    for w in await withdrawal_repository.get_by_user_id(user_id, limit=1000):
        if w.get("status") not in ("failed", "cancelled"):
            total_withdrawn += float(w.get("amount", 0))
    return max(0.0, total_earned - total_withdrawn)

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/fee-estimate", response_model=dict)
async def delivery_fee_estimate(
    request: DeliveryFeeEstimateRequest,
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Estimate the delivery fee for a set of items before checkout.

    Resolves the farmer origin from the product / farmer profile (geocoding the
    farm address if needed) and the destination from the saved delivery address
    or supplied coordinates (geocoding the address if needed). Every address
    therefore produces its own distance-based rate. The value shown here is
    re-computed and locked when the order is placed.
    """
    from app.services.delivery_fee_service import delivery_fee_service
    from app.services.order_service import _resolve_tracking_origin

    destination = _normalize_location(request.coordinates) if request.coordinates else None
    address = None
    if not destination and request.deliveryAddressId:
        try:
            from app.repositories.address_repository import address_repository
            address = await address_repository.get_address_by_id(
                request.deliveryAddressId, str(current_user["_id"])
            )
            destination = _normalize_location((address or {}).get("location"))
        except Exception:
            address = None
            destination = None
    if not destination and address:
        try:
            destination = await geocode_address({
                "address_line1": address.get("address_line1") or address.get("addressLine1", ""),
                "address_line2": address.get("address_line2") or address.get("addressLine2"),
                "city": address.get("city", ""),
                "state": address.get("state", ""),
                "zip_code": address.get("zip_code") or address.get("zipCode", ""),
                "country": address.get("country", ""),
            })
        except Exception:
            destination = None

    farmer_id = None
    weight_kg = 0.0
    order_amount = None
    product_ids = []
    for item in request.items:
        try:
            product = await product_repository.get_by_id(item.productId)
        except Exception:
            product = None
        if not product:
            continue
        farmer_id = farmer_id or product.get("farmerId")
        product_ids.append(item.productId)
        qty = float(item.quantity or 0)
        weight_kg += qty
        price = product.get("price") or product.get("salePrice") or product.get("pricePerKg")
        if price is not None:
            order_amount = (order_amount or 0.0) + float(price) * qty

    if request.orderAmount is not None:
        order_amount = float(request.orderAmount)

    origin = None
    if farmer_id or product_ids:
        try:
            origin = await _resolve_tracking_origin({
                "farmerId": farmer_id,
                "items": [{"productId": pid} for pid in product_ids],
            })
        except Exception:
            origin = None

    method = (request.method or "farmer").lower()
    if method not in ("farmer", "partner", "pickup", "bulk"):
        method = "farmer"

    quote = await delivery_fee_service.calculate_delivery_fee(
        from_location=origin,
        to_location=destination,
        weight_kg=weight_kg,
        method=method,
        order_amount=order_amount,
    )
    return {
        "success": True,
        "data": {
            "method": quote["method"],
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
        },
    }


def _serialize_delivery_data(value):
    """Convert MongoDB values before returning delivery data as JSON."""
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, dict):
        return {key: _serialize_delivery_data(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_serialize_delivery_data(item) for item in value]
    return value

async def _get_or_create_partner(user_id: str) -> dict:
    profile = await DeliveryService.get_delivery_partner(user_id)
    if profile:
        return profile
    dummy = DeliveryPartnerCreate(
        userId=user_id,
        vehicleType=VehicleType.BIKE,
        vehicleNumber="PENDING"
    )
    created = await DeliveryService.create_delivery_partner(user_id, dummy)
    if created:
        return created
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Failed to create delivery partner profile"
    )

@router.get("/me", response_model=DeliveryPartnerResponse)
async def get_my_delivery_profile(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "delivery":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only delivery partners can access this endpoint"
        )
    
    profile = await _get_or_create_partner(str(current_user["_id"]))
    
    user = await UserService.get_user_by_id(str(current_user["_id"]))
    if user:
        profile["name"] = f"{user.get('firstName', '')} {user.get('lastName', '')}"
        profile["phone"] = user.get("phone")
        profile["email"] = user.get("email")

    profile["id"] = str(profile["_id"])
    # Normalize legacy MongoDB profile documents before response validation.
    # Older records store userId as ObjectId and createdAt instead of joinedDate.
    if profile.get("userId") is not None:
        profile["userId"] = str(profile["userId"])
    if not profile.get("joinedDate"):
        profile["joinedDate"] = profile.get("createdAt") or datetime.utcnow()
    
    # Add verification status from driving license document
    driving_license = profile.get("drivingLicense") or {}
    profile["isVerified"] = driving_license.get("status") == "verified"
    profile["verificationStatus"] = driving_license.get("status", "submitted")
    
    return profile

@router.put("/me", response_model=DeliveryPartnerResponse)
async def update_my_delivery_profile(
    data: DeliveryPartnerUpdate,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "delivery":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only delivery partners can update their profile"
        )
    
    profile = await _get_or_create_partner(str(current_user["_id"]))
    
    updated = await DeliveryService.update_delivery_partner(
        str(profile["_id"]),
        data
    )
    
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to update profile"
        )
    
    updated["id"] = str(updated["_id"])
    return updated

@router.put("/me/location")
async def update_my_location(
    location: DeliveryLocationUpdate,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "delivery":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only delivery partners can update location"
        )
    
    profile = await _get_or_create_partner(str(current_user["_id"]))
    
    success = await DeliveryService.update_location(
        str(profile["_id"]),
        location.latitude,
        location.longitude
    )
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to update location"
        )
    
    return {
        "success": True,
        "message": "Location updated successfully"
    }

@router.put("/me/status")
async def update_my_status(
    status: DeliveryStatus = Body(..., embed=True),
    is_available: bool = Body(True, embed=True),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "delivery":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only delivery partners can update status"
        )
    
    profile = await _get_or_create_partner(str(current_user["_id"]))
    
    success = await DeliveryService.update_status(
        str(profile["_id"]),
        status,
        is_available
    )
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to update status"
        )
    
    return {
        "success": True,
        "message": f"Status updated to {status}"
    }

@router.get("/me/dashboard")
async def get_my_dashboard(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "delivery":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only delivery partners can access dashboard"
        )
    
    profile = await _get_or_create_partner(str(current_user["_id"]))
    partner_id = str(profile["_id"])
    user_id = str(current_user["_id"])
    
    today = datetime.utcnow()

    async def _fetch_all(key: str) -> list:
        seen = set()
        result = []
        assignments = await DeliveryService.get_partner_deliveries(key)
        for a in assignments:
            oid = str(a["orderId"])
            seen.add(oid)
            a["id"] = str(a["_id"])
            result.append(a)
        orders = await order_repository.get_by_delivery_partner(key)
        for o in orders:
            oid = str(o["_id"])
            if oid in seen:
                continue
            seen.add(oid)
            o["id"] = oid
            o["orderId"] = oid
            o["status"] = o.get("orderStatus")
            result.append(o)
        return result

    all_deliveries = await _fetch_all(partner_id)
    if not all_deliveries:
        all_deliveries = await _fetch_all(user_id)
    if not all_deliveries:
        unassigned = await order_repository.find_many({"deliveryPartnerId": None, "deletedAt": None})
        for o in unassigned:
            o["id"] = str(o["_id"])
            o["orderId"] = str(o["_id"])
            o["status"] = o.get("orderStatus", "pending")
            all_deliveries.append(o)

    stats = await DeliveryService.get_delivery_stats(partner_id)
    route = await DeliveryService.get_partner_route(partner_id, today)

    user = await UserService.get_user_by_id(user_id)
    name = ""
    if user:
        name = f"{user.get('firstName', '')} {user.get('lastName', '')}".strip()
        last_login = user.get("lastLoginAt")
    else:
        last_login = None

    completed_count = len([d for d in all_deliveries if d.get("status") in ("delivered", "completed")])
    pending_count = len([d for d in all_deliveries if d.get("status") not in ("delivered", "completed", "cancelled")])

    return {
        "success": True,
        "data": {
            "id": partner_id,
            "name": name,
            "todayEarnings": stats.get("todayEarnings", 0),
            "weekEarnings": stats.get("weekEarnings", 0),
            "onTimeRate": stats.get("onTimeDelivery", 95),
            "pendingDeliveries": pending_count,
            "completedDeliveries": completed_count,
            "rating": stats.get("averageRating", profile.get("rating", 0)),
            "ratingCount": stats.get("ratingCount", profile.get("ratingCount", 0)),
            "ratingSummary": stats.get("ratingSummary", {}),
            "isAvailable": profile.get("isAvailable", True),
            "status": profile.get("status"),
            "totalDeliveries": stats.get("totalDeliveries", 0),
            "todayDeliveries": all_deliveries[:20],
            "lastLoginAt": last_login
        }
    }

@router.get("/me/today")
async def get_my_today_deliveries(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "delivery":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only delivery partners can access this endpoint"
        )

    profile = await _get_or_create_partner(str(current_user["_id"]))
    partner_id = str(profile["_id"])
    user_id = str(current_user["_id"])

    async def _fetch_and_enrich(delivery_partner_key: str) -> list:
        seen = set()
        result = []

        assignments = await DeliveryService.get_partner_deliveries(delivery_partner_key)
        for a in assignments:
            oid = str(a["orderId"])
            if oid in seen:
                continue
            seen.add(oid)
            result.append(await _enrich_assignment(a))

        orders = await order_repository.get_by_delivery_partner(delivery_partner_key)
        for o in orders:
            oid = str(o["_id"])
            if oid in seen:
                continue
            seen.add(oid)
            o["orderId"] = oid
            result.append(await _enrich_assignment(o))

        return result

    enriched = await _fetch_and_enrich(partner_id)
    if not enriched:
        enriched = await _fetch_and_enrich(user_id)

    seen_ids = {item.get("id") or str(item.get("_id")) for item in enriched if item.get("id") or item.get("_id")}
    unassigned = await order_repository.find_many({
        "deliveryPartnerId": None,
        "orderStatus": "ready_for_delivery",
        "deletedAt": None
    })
    for o in unassigned:
        oid = str(o["_id"])
        if oid in seen_ids:
            continue
        seen_ids.add(oid)
        o["orderId"] = oid
        enriched.append(await _enrich_assignment(o))

    return _serialize_delivery_data({
        "success": True,
        "data": {
            "deliveries": enriched,
            "count": len(enriched)
        }
    })

@router.get("/me/history")
async def get_my_delivery_history(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "delivery":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only delivery partners can access this endpoint"
        )

    profile = await _get_or_create_partner(str(current_user["_id"]))
    partner_id = str(profile["_id"])
    user_id = str(current_user["_id"])

    skip = (page - 1) * limit

    async def _fetch_history(key: str) -> list:
        seen = set()
        result = []

        assignments = await DeliveryService.get_partner_deliveries(key, status=DeliveryStatus.DELIVERED, skip=skip, limit=limit)
        for a in assignments:
            a["id"] = str(a["_id"])
            oid = str(a["orderId"])
            seen.add(oid)
            order = await order_repository.get_by_id(oid)
            if order:
                a["orderNumber"] = order.get("orderNumber")
                a["totalAmount"] = order.get("totalAmount")
                a["deliveryAddress"] = order.get("deliveryAddress")
                a["items"] = order.get("items", [])
                customer = await UserService.get_user_by_id(str(order["customerId"]))
                if customer:
                    a["customerName"] = f"{customer.get('firstName', '')} {customer.get('lastName', '')}".strip()
                    a["customerPhone"] = customer.get("phone")
            result.append(a)

        orders = await order_repository.get_by_delivery_partner(key, status="delivered")
        for o in orders:
            oid = str(o["_id"])
            if oid in seen:
                continue
            seen.add(oid)
            o["id"] = oid
            o["orderId"] = oid
            o["orderNumber"] = o.get("orderNumber")
            o["totalAmount"] = o.get("totalAmount")
            o["deliveryAddress"] = o.get("deliveryAddress")
            o["items"] = o.get("items", [])
            customer = await UserService.get_user_by_id(str(o["customerId"]))
            if customer:
                o["customerName"] = f"{customer.get('firstName', '')} {customer.get('lastName', '')}".strip()
                o["customerPhone"] = customer.get("phone")
            result.append(o)

        return result

    enriched = await _fetch_history(partner_id)
    if not enriched:
        enriched = await _fetch_history(user_id)

    return {
        "success": True,
        "data": {
            "deliveries": enriched,
            "count": len(enriched),
            "page": page,
            "limit": limit
        }
    }

@router.get("/me/profile")
async def get_my_profile(current_user: dict = Depends(get_current_user)):
    """Returns the delivery partner profile shaped for the mobile app."""
    if current_user.get("role") != "delivery":
        raise HTTPException(status_code=403, detail="Only delivery partners can access this endpoint")

    profile = await _get_or_create_partner(str(current_user["_id"]))
    partner_id = str(profile["_id"])
    user_id = str(current_user["_id"])

    user = await UserService.get_user_by_id(user_id)
    name = ""
    email = ""
    phone = ""
    if user:
        name = f"{user.get('firstName', '')} {user.get('lastName', '')}".strip()
        email = user.get("email") or ""
        phone = user.get("phone") or ""

    stats = await delivery_repository.get_partner_stats(partner_id)

    return {
        "success": True,
        "data": {
            "id": partner_id,
            "name": name,
            "email": email,
            "phone": phone,
            "isAvailable": profile.get("isAvailable", True),
            "status": profile.get("status", "offline"),
            "rating": profile.get("rating", 0),
            "totalDeliveries": stats.get("totalDeliveries", 0),
            "totalEarnings": stats.get("totalEarnings", 0),
            "onTimeDelivery": stats.get("onTimeDelivery", 0),
            "vehicle": {
                "type": (profile.get("vehicleType") or "bike").title(),
                "registrationNo": profile.get("vehicleNumber") or "N/A",
                "model": profile.get("vehicleModel") or "N/A",
            },
            "drivingLicense": _serialize_delivery_data(profile.get("drivingLicense")),
            "isVerified": profile.get("isVerified", False),
            "verificationStatus": profile.get("verificationStatus", "submitted")
        }
    }


# ---------- Driving licence document (security verification) ----------

@router.post("/me/documents/driving-license")
async def upload_driving_license(
    photo: UploadFile = File(...),
    licenseNumber: str = Body("", embed=True),
    expiryDate: str = Body("", embed=True),
    current_user: dict = Depends(get_current_user)
):
    """Upload a delivery partner's driving licence photocopy for verification.

    Multipart form fields: `photo` (required image), optional `licenseNumber`
    and `expiryDate` (ISO date string). The document is stored on the partner's
    delivery profile with `status: "submitted"` until an admin reviews it.
    """
    if current_user.get("role") != "delivery":
        raise HTTPException(status_code=403, detail="Only delivery partners can upload documents")

    from app.utils.file_security import validate_upload, UploadValidationError

    profile = await _get_or_create_partner(str(current_user["_id"]))
    partner_id = str(profile["_id"])

    upload_dir = settings.UPLOAD_DIR
    os.makedirs(upload_dir, exist_ok=True)
    content = await photo.read()
    try:
        ext = validate_upload(
            photo.filename or "dl",
            content,
            content_type=photo.content_type,
            max_bytes=settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
        )
    except UploadValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    filename = f"dl-{uuid4().hex}{ext}"
    filepath = os.path.join(upload_dir, filename)
    with open(filepath, "wb") as f:
        f.write(content)

    driving_license = {
        "photoUrl": f"/uploads/{filename}",
        "licenseNumber": licenseNumber.strip() or None,
        "expiryDate": expiryDate.strip() or None,
        "status": "submitted",
        "uploadedAt": datetime.utcnow(),
    }
    success = await delivery_repository.update(
        {"_id": ObjectId(partner_id)},
        {"drivingLicense": driving_license}
    )
    if not success:
        raise HTTPException(status_code=400, detail="Failed to save driving licence")

    return {
        "success": True,
        "data": _serialize_delivery_data(driving_license),
        "message": "Driving licence submitted for verification"
    }


@router.get("/admin/documents")
async def get_driver_documents(
    status: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    """List delivery partners who submitted a driving licence, newest first."""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admins can access this endpoint")

    partners = await delivery_repository.find_many(
        {"drivingLicense": {"$exists": True}, "deletedAt": None},
        limit=200,
        sort=[("drivingLicense.uploadedAt", -1)]
    )

    documents = []
    for partner in partners:
        doc = partner.get("drivingLicense") or {}
        if status and doc.get("status") != status:
            continue
        user = await UserService.get_user_by_id(str(partner.get("userId")))
        documents.append({
            "id": str(partner["_id"]),
            "userId": str(partner.get("userId")),
            "name": f"{user.get('firstName', '')} {user.get('lastName', '')}".strip() if user else "Delivery partner",
            "phone": user.get("phone") if user else None,
            "vehicleNumber": partner.get("vehicleNumber"),
            "isVerified": partner.get("isVerified", False),
            "drivingLicense": _serialize_delivery_data(doc),
        })

    return {"success": True, "data": {"documents": documents, "count": len(documents)}}


@router.put("/admin/documents/{partner_id}/verify")
async def verify_driver_document(
    partner_id: str,
    remark: Optional[str] = Body(None, embed=True),
    current_user: dict = Depends(get_current_user)
):
    """Approve a delivery partner's driving licence document."""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admins can verify documents")

    partner = await delivery_repository.get_by_id(partner_id)
    if not partner or not partner.get("drivingLicense"):
        raise HTTPException(status_code=404, detail="Document not found")

    doc = partner["drivingLicense"]
    doc["status"] = "verified"
    doc["verifiedAt"] = datetime.utcnow()
    if remark:
        doc["remark"] = remark
    success = await delivery_repository.update(
        {"_id": ObjectId(partner_id)},
        {"drivingLicense": doc, "isVerified": True}
    )
    if not success:
        raise HTTPException(status_code=400, detail="Failed to update document")

    return {"success": True, "data": _serialize_delivery_data(doc), "message": "Driving licence verified"}


@router.put("/admin/documents/{partner_id}/reject")
async def reject_driver_document(
    partner_id: str,
    remark: Optional[str] = Body(None, embed=True),
    current_user: dict = Depends(get_current_user)
):
    """Reject a delivery partner's driving licence document."""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admins can reject documents")

    partner = await delivery_repository.get_by_id(partner_id)
    if not partner or not partner.get("drivingLicense"):
        raise HTTPException(status_code=404, detail="Document not found")

    doc = partner["drivingLicense"]
    doc["status"] = "rejected"
    if remark:
        doc["remark"] = remark
    success = await delivery_repository.update(
        {"_id": ObjectId(partner_id)},
        {"drivingLicense": doc}
    )
    if not success:
        raise HTTPException(status_code=400, detail="Failed to update document")

    return {"success": True, "data": _serialize_delivery_data(doc), "message": "Driving licence rejected"}


@router.get("/assignments")
async def get_my_assignments(
    status: str = Query("assigned"),
    limit: int = Query(50, ge=1, le=100),
    lat: Optional[float] = Query(None, ge=-90, le=90),
    lng: Optional[float] = Query(None, ge=-180, le=180),
    current_user: dict = Depends(get_current_user)
):
    """List the partner's assignments, optionally filtered by status (comma-separated).

    Pass `lat` and `lng` (the partner's current location) to also compute
    `pickupDistance` (current location -> farm) and `deliveryDistance`
    (farm -> delivery address).
    """
    if current_user.get("role") != "delivery":
        raise HTTPException(status_code=403, detail="Only delivery partners can access this endpoint")

    profile = await _get_or_create_partner(str(current_user["_id"]))
    partner_id = str(profile["_id"])
    user_id = str(current_user["_id"])

    statuses = [s.strip().lower() for s in status.split(",") if s.strip()]

    # Older records may store either the delivery-profile id or the login
    # user's id. Read both keys and merge them so assigned orders are not
    # silently missing from the delivery workbench.
    assignments = []
    seen_assignment_ids = set()
    for key in dict.fromkeys((partner_id, user_id)):
        for assignment in await delivery_assignment_repository.get_by_delivery_partner(key, limit=limit):
            assignment_id = str(assignment.get("_id"))
            if assignment_id not in seen_assignment_ids:
                seen_assignment_ids.add(assignment_id)
                assignments.append(assignment)

    # Some orders are assigned directly without a delivery_assignments record.
    seen_order_ids = {str(a.get("orderId")) for a in assignments if a.get("orderId")}
    for key in dict.fromkeys((partner_id, user_id)):
        for order in await order_repository.get_by_delivery_partner(key, limit=limit):
            order_id = str(order["_id"])
            if order_id in seen_order_ids:
                continue
            seen_order_ids.add(order_id)
            order["id"] = order_id
            order["orderId"] = order_id
            order["status"] = order.get("orderStatus")
            assignments.append(order)
            if len(assignments) >= limit:
                break
        if len(assignments) >= limit:
            break

    results = []
    origin = (
        {"type": "Point", "coordinates": [lng, lat]}
        if lat is not None and lng is not None
        else None
    )
    for a in assignments:
        a_status = (a.get("status") or "").lower()
        if statuses and statuses != ["all"]:
            matched = any(
                s in a_status or a_status in s
                for s in statuses
            )
            if not matched:
                continue
        enriched = await _enrich_assignment(a)
        if origin:
            pickup_loc = (enriched.get("pickup") or {}).get("location")
            delivery_loc = (enriched.get("address") or {}).get("location")
            if pickup_loc:
                enriched["pickupDistance"] = round(
                    await delivery_repository.calculate_distance(origin, pickup_loc), 1
                )
                if delivery_loc:
                    enriched["deliveryDistance"] = round(
                        await delivery_repository.calculate_distance(pickup_loc, delivery_loc), 1
                    )
        results.append(enriched)

    return _serialize_delivery_data({"success": True, "data": results})


@router.get("/nearby-orders")
async def get_nearby_orders(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    radius: int = Query(5, ge=0, le=100000),
    limit: int = Query(100, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    """List this driver's assigned orders and available ready orders nearby.

    Pass radius=0 to disable the distance filter and return every active
    order (the "All" view on the delivery order map).
    """
    if current_user.get("role") != "delivery":
        raise HTTPException(status_code=403, detail="Only delivery partners can access this endpoint")
    if radius != 0 and radius not in (5, 10, 20, 25, 50):
        raise HTTPException(status_code=400, detail="Radius must be 0 (all), 5, 10, 20, 25, or 50 km")

    profile = await _get_or_create_partner(str(current_user["_id"]))
    partner_id = str(profile["_id"])
    user_id = str(current_user["_id"])
    candidates = []
    seen_order_ids = set()

    # Include assignment documents, including legacy records keyed by either
    # the delivery profile id or the login user id.
    for key in dict.fromkeys((partner_id, user_id)):
        for assignment in await delivery_assignment_repository.get_by_delivery_partner(key, limit=limit):
            order_id = str(assignment.get("orderId"))
            if order_id and order_id not in seen_order_ids:
                seen_order_ids.add(order_id)
                candidates.append(assignment)

    # Include orders assigned directly without a delivery_assignments record.
    for key in dict.fromkeys((partner_id, user_id)):
        for order in await order_repository.get_by_delivery_partner(key, limit=limit):
            order_id = str(order["_id"])
            if order_id not in seen_order_ids:
                seen_order_ids.add(order_id)
                candidates.append(order)

    # Also include farmer-available orders that have not been assigned yet.
    for order in await order_repository.get_ready_for_delivery(limit=limit):
        order_id = str(order["_id"])
        if order_id not in seen_order_ids:
            seen_order_ids.add(order_id)
            candidates.append(order)

    origin = {"type": "Point", "coordinates": [lng, lat]}
    results = []
    for candidate in candidates:
        candidate["id"] = str(candidate["_id"])
        candidate["orderId"] = str(candidate.get("orderId") or candidate["_id"])
        candidate["status"] = candidate.get("status") or candidate.get("orderStatus") or "ready_for_delivery"
        if str(candidate["status"]).lower() in ("delivered", "completed", "cancelled", "failed"):
            continue
        enriched = await _enrich_assignment(candidate)
        pickup_loc = (enriched.get("pickup") or {}).get("location")
        delivery_loc = (enriched.get("address") or {}).get("location")
        # pickupDistance = current location (partner's home) -> farm.
        # deliveryDistance = farm -> customer delivery address.
        if pickup_loc:
            enriched["pickupDistance"] = round(
                await delivery_repository.calculate_distance(origin, pickup_loc), 1
            )
            if delivery_loc:
                enriched["deliveryDistance"] = round(
                    await delivery_repository.calculate_distance(pickup_loc, delivery_loc), 1
                )
        if radius == 0:
            results.append(enriched)
            continue
        if delivery_loc:
            distance = await delivery_repository.calculate_distance(origin, delivery_loc)
            if distance <= radius:
                enriched["distance"] = round(distance, 1)
                results.append(enriched)

    results.sort(key=lambda item: item.get("distance", float("inf")))

    return _serialize_delivery_data({"success": True, "data": results[:limit], "radius": radius})


@router.put("/assignments/{assignment_id}/complete")
async def complete_assignment(
    assignment_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Mark an assignment as delivered/completed (mobile completion flow, no OTP)."""
    if current_user.get("role") != "delivery":
        raise HTTPException(status_code=403, detail="Only delivery partners can complete deliveries")

    assignment = await delivery_assignment_repository.get_by_id(assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    proof = assignment.get("proofOfDelivery") or {}
    if not proof.get("photoUrl"):
        raise HTTPException(
            status_code=400,
            detail="Proof of delivery photo is required to complete a delivery"
        )

    delivery_partner_id = str(assignment.get("deliveryPartnerId"))
    profile = await _get_or_create_partner(str(current_user["_id"]))
    partner_profile_id = str(profile["_id"])

    if delivery_partner_id != partner_profile_id:
        raise HTTPException(status_code=403, detail="You can only complete your own deliveries")

    assignment = await DeliveryService.complete_assignment(
        assignment_id,
        partner_profile_id,
        delivery_photo=None,
        location=None
    )

    if not assignment:
        raise HTTPException(status_code=400, detail="Failed to complete delivery")

    return {"success": True, "data": await _enrich_assignment(assignment), "message": "Delivery completed!"}


# ---------- Proof of Delivery (POD) ----------

@router.post("/assignments/{assignment_id}/pod")
async def upload_proof_of_delivery(
    assignment_id: str,
    photo: UploadFile = File(...),
    recipientName: str = Body("", embed=True),
    signature: str = Body("", embed=True),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "delivery":
        raise HTTPException(status_code=403, detail="Only delivery partners can upload POD")

    from app.utils.file_security import validate_upload, UploadValidationError

    # Ownership check: only the assigned partner may upload the POD.
    profile = await _get_or_create_partner(str(current_user["_id"]))
    partner_id = str(profile["_id"])

    assignment = await delivery_assignment_repository.get_by_id(assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if str(assignment.get("deliveryPartnerId")) != partner_id:
        raise HTTPException(status_code=403, detail="This delivery is not assigned to you")

    upload_dir = settings.UPLOAD_DIR
    os.makedirs(upload_dir, exist_ok=True)
    content = await photo.read()
    try:
        ext = validate_upload(
            photo.filename or "pod",
            content,
            content_type=photo.content_type,
            max_bytes=settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
        )
    except UploadValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    filename = f"pod-{uuid4().hex}{ext}"
    filepath = os.path.join(upload_dir, filename)
    with open(filepath, "wb") as f:
        f.write(content)

    url = f"/uploads/{filename}"
    success = await delivery_assignment_repository.update_status(
        assignment_id,
        DeliveryStatus.DELIVERED,
        {"proofOfDelivery": {"photoUrl": url, "recipientName": recipientName, "signature": signature, "uploadedAt": datetime.utcnow()}}
    )

    if not success:
        raise HTTPException(status_code=400, detail="Failed to save POD")

    completed = await DeliveryService.complete_assignment(
        assignment_id,
        partner_id,
        delivery_photo=url,
        location=None,
    )
    if not completed:
        raise HTTPException(status_code=400, detail="Failed to complete delivery after saving proof")

    return {
        "success": True,
        "data": {"photoUrl": url, "completed": True},
        "message": "Proof of delivery saved and delivery completed",
    }


# ---------- Shareable live tracking link ----------

@router.post("/orders/{order_id}/share")
async def create_share_link(
    order_id: str,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "delivery":
        raise HTTPException(status_code=403, detail="Only delivery partners can generate share links")

    order = await order_repository.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Ownership check: only the partner assigned to this order may share it.
    profile = await _get_or_create_partner(str(current_user["_id"]))
    if str(order.get("deliveryPartnerId")) != str(profile["_id"]):
        raise HTTPException(status_code=403, detail="This order is not assigned to you")

    order_update = await order_repository.update_order_field(
        order_id, "shareToken", uuid4().hex + uuid4().hex
    )
    updated = await order_repository.get_by_id(order_id)
    token = updated.get("shareToken")
    if not token:
        raise HTTPException(status_code=500, detail="Failed to generate share link")

    base = settings.PUBLIC_BASE_URL or "http://localhost:8000"
    return {
        "success": True,
        "data": {
            "shareToken": token,
            "shareUrl": f"{base}/api/v1/delivery/track/share/{token}"
        }
    }


@router.get("/track/share/{token}")
async def public_tracking_by_share_token(
    token: str,
    current_user: dict = Depends(get_current_user)
):
    """Public tracking lookup via a share token (any authenticated user)."""
    order = await order_repository.find_one({"shareToken": token, "deletedAt": None})
    if not order:
        raise HTTPException(status_code=404, detail="Tracking link not found or expired")

    tracking = await DeliveryService.track_delivery(str(order["_id"]))
    return {
        "success": True,
        "data": tracking or {
            "orderId": str(order["_id"]),
            "orderStatus": order.get("orderStatus"),
            "status": order.get("orderStatus"),
            "message": "Delivery in progress"
        }
    }


# ---------- Delivery partner support chat ----------

class _SupportRepo(BaseRepository):
    def __init__(self):
        super().__init__("delivery_support_threads")

    async def get_by_id(self, thread_id: str) -> Optional[dict]:
        """Get a support thread by ID."""
        try:
            return await self.find_one({"_id": ObjectId(thread_id), "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting support thread: {str(e)}")
            return None

support_repo = _SupportRepo()


@router.get("/support/conversations")
async def get_support_conversations(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "delivery":
        raise HTTPException(status_code=403, detail="Only delivery partners can access support")

    convos = await support_repo.find_many(
        {"partnerId": str(current_user["_id"]), "deletedAt": None},
        sort=[("updatedAt", -1)]
    )
    for c in convos:
        c["id"] = str(c["_id"])
    return {"success": True, "data": convos}


@router.post("/support/conversations")
async def create_support_conversation(
    subject: str = Body("Support request", embed=True),
    initialMessage: str = Body("", embed=True),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "delivery":
        raise HTTPException(status_code=403, detail="Only delivery partners can access")

    convo_id = await support_repo.create({
        "partnerId": str(current_user["_id"]),
        "subject": subject,
        "status": "open",
        "messages": [{
            "senderRole": "delivery",
            "senderName": "You",
            "content": initialMessage,
            "createdAt": datetime.utcnow()
        }]
    })
    convo = await support_repo.get_by_id(convo_id)
    convo["id"] = str(convo["_id"])
    return {"success": True, "data": convo, "message": "Support request created"}


@router.get("/support/conversations/{conversation_id}")
async def get_support_conversation(
    conversation_id: str,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "delivery":
        raise HTTPException(status_code=403, detail="Only delivery partners can access support")

    convo = await support_repo.get_by_id(conversation_id)
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if str(convo.get("partnerId")) != str(current_user["_id"]):
        raise HTTPException(status_code=403, detail="Access denied")
    convo["id"] = str(convo["_id"])
    return {"success": True, "data": convo}


@router.post("/support/conversations/{conversation_id}/messages", status_code=201)
async def send_support_message(
    conversation_id: str,
    body: SupportMessageSend,
    current_user: dict = Depends(get_current_user)
):
    convo = await support_repo.get_by_id(conversation_id)
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if str(convo.get("partnerId")) != str(current_user["_id"]):
        raise HTTPException(status_code=403, detail="Access denied")

    msg = {
        "senderRole": "delivery",
        "senderName": "You",
        "content": body.content,
        "createdAt": datetime.utcnow()
    }
    success = await support_repo.update(
        {"_id": convo["_id"]},
        {"messages": convo.get("messages", []) + [msg], "status": "open", "updatedAt": datetime.utcnow()}
    )
    return {"success": True, "data": msg}


# ---------- Earnings & payout ----------

@router.get("/me/earnings")
async def get_my_earnings(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "delivery":
        raise HTTPException(status_code=403, detail="Only delivery partners can access this endpoint")

    profile = await _get_or_create_partner(str(current_user["_id"]))
    partner_id = str(profile["_id"])
    user_id = str(current_user["_id"])

    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1, microsecond=0)

    completed = await _partner_completed_deliveries(partner_id, user_id)

    today_earnings = 0
    week_earnings = 0
    month_earnings = 0
    transactions = []

    for item in completed:
        amt = await _delivery_charge(item.get("orderId"))
        completed_at = _delivery_completed_at(item)
        transactions.append({
            "amount": amt,
            "type": "earnings",
            "description": f"Delivery {item.get('orderNumber', '') or str(item.get('orderId', ''))[-6:]}",
            "createdAt": completed_at,
        })
        if completed_at and completed_at >= today:
            today_earnings += amt
        if completed_at and completed_at >= week_start:
            week_earnings += amt
        if completed_at and completed_at >= month_start:
            month_earnings += amt

    weekly_change = 0
    prev_week_ear = 0
    prev_week_end = week_start - timedelta(days=7)
    for item in completed:
        completed_at = _delivery_completed_at(item)
        if completed_at and completed_at < week_start and completed_at >= prev_week_end:
            prev_week_ear += await _delivery_charge(item.get("orderId"))
    if prev_week_ear > 0:
        weekly_change = round((week_earnings - prev_week_ear) / prev_week_ear * 100)

    available_balance = await _available_delivery_balance(partner_id, user_id)

    cash_totals = await cash_settlement_repository.get_partner_totals(user_id)
    cash_today = await cash_settlement_repository.get_today_total(user_id)
    cod_status = await _cod_eligibility(user_id)

    return {
        "success": True,
        "data": {
            "todayEarnings": today_earnings,
            "weekEarnings": week_earnings,
            "monthEarnings": month_earnings,
            "pendingPayouts": available_balance,
            "walletBalance": available_balance,
            "weeklyChange": weekly_change,
            "recentTransactions": transactions[:20],
            "cashCollectedToday": cash_today,
            "cashCollected": cash_totals["cashCollected"],
            "cashToRemit": cash_totals["pendingRemit"],
            "cashPendingSubmission": cash_totals["pendingSubmission"],
            "cashInVerification": cash_totals["inVerification"],
            "cashDeposited": cash_totals["alreadyDeposited"],
            "codBlocked": cod_status["codBlocked"],
            "codBlockReason": cod_status["reason"],
        }
    }


@router.post("/me/earnings/withdraw")
async def withdraw_earnings(
    data: Optional[WithdrawEarningsRequest] = Body(None),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "delivery":
        raise HTTPException(status_code=403, detail="Only delivery partners can withdraw earnings")

    profile = await _get_or_create_partner(str(current_user["_id"]))
    partner_id = str(profile["_id"])
    user_id = str(current_user["_id"])

    available = await _available_delivery_balance(partner_id, user_id)
    amount = data.amount if data and data.amount and data.amount > 0 else available

    if amount <= 0:
        raise HTTPException(status_code=400, detail="No eligible balance to withdraw yet")
    if amount > available + 1e-9:
        raise HTTPException(status_code=400, detail="Insufficient balance")

    # Anti-fraud: block withdrawals to a newly-changed bank account within the
    # configured cooldown window.
    if data and data.bankAccount:
        blocked = await PaymentService._bank_change_cooldown_blocked(user_id, data.bankAccount)
        if blocked:
            raise HTTPException(status_code=400, detail=blocked)

    withdrawal_data = {
        "userId": ObjectId(user_id),
        "deliveryPartnerId": ObjectId(partner_id),
        "amount": round(amount, 2),
        "status": "pending",
        "bankAccount": data.bankAccount if data else None,
        "createdAt": datetime.utcnow(),
    }
    withdrawal_id = await withdrawal_repository.create(withdrawal_data)
    if not withdrawal_id:
        raise HTTPException(status_code=400, detail="Failed to create withdrawal request")

    from app.services.ledger_service import ledger_service
    await ledger_service.record(
        amount=round(amount, 2),
        direction="debit",
        entry_type="withdrawal",
        user_id=user_id,
        reference=withdrawal_id,
    )

    wallet = await wallet_repository.get_by_user_id(user_id)
    if not wallet:
        wallet_id = await wallet_repository.create_wallet({"userId": ObjectId(user_id)})
        wallet = await wallet_repository.get_by_id(wallet_id)
    if wallet:
        await wallet_repository.update_balance(str(wallet["_id"]), amount, "debit")
        wallet_after = await wallet_repository.get_by_id(str(wallet["_id"]))
        await wallet_transaction_repository.create_transaction({
            "walletId": wallet["_id"],
            "userId": wallet["userId"],
            "amount": amount,
            "type": "debit",
            "description": "Delivery earnings withdrawal",
            "referenceId": ObjectId(withdrawal_id),
            "referenceType": "withdrawal",
            "balanceAfter": float(wallet_after.get("balance", 0)) if wallet_after else 0,
        })

    return {
        "success": True,
        "data": {
            "withdrawalId": withdrawal_id,
            "amount": round(amount, 2),
            "status": "pending",
            "availableBalance": round(available - amount, 2),
        },
        "message": f"Withdrawal request of Rs {round(amount, 2)} submitted. Funds will be transferred to your account.",
    }


# ---------- COD cash settlement ----------

async def _cod_eligibility(user_id: str) -> Dict[str, Any]:
    """Return COD blocking state for a delivery partner.

    A partner is blocked from new COD deliveries when they have overdue
    settlements or their outstanding cash exceeds the platform limit.
    """
    totals = await cash_settlement_repository.get_partner_totals(user_id)
    overdue_count = await cash_settlement_repository.count_overdue(user_id)
    max_outstanding = settings.COD_MAX_OUTSTANDING
    blocked = overdue_count > 0 or totals["pendingRemit"] > max_outstanding
    reason = None
    if overdue_count > 0:
        reason = (
            "You have overdue COD settlements that must be cleared before "
            "receiving new cash-on-delivery orders."
        )
    elif totals["pendingRemit"] > max_outstanding:
        reason = (
            "Your outstanding COD cash exceeds the platform limit. Settle your "
            "collections before accepting more cash-on-delivery orders."
        )
    return {
        "codBlocked": blocked,
        "reason": reason,
        "overdueCount": overdue_count,
        "outstanding": round(totals["pendingRemit"], 2),
        "maxOutstanding": round(max_outstanding, 2),
    }

@router.get("/me/cash-wallet")
async def get_my_cash_wallet(current_user: dict = Depends(get_current_user)):
    """COD cash wallet for the delivery partner.

    Shows today's cash collected, what is still outstanding, what is awaiting
    verification, and what has already been settled. Also returns the platform
    collection account the partner should pay into and their COD eligibility
    (blocked when overdue or over the outstanding limit).
    """
    if current_user.get("role") != "delivery":
        raise HTTPException(status_code=403, detail="Only delivery partners can access this endpoint")

    user_id = str(current_user["_id"])
    totals = await cash_settlement_repository.get_partner_totals(user_id)
    today = await cash_settlement_repository.get_today_total(user_id)
    overdue_count = await cash_settlement_repository.count_overdue(user_id)

    max_outstanding = settings.COD_MAX_OUTSTANDING
    blocked = (
        overdue_count > 0
        or totals["pendingRemit"] > max_outstanding
    )

    return {
        "success": True,
        "data": {
            "todayCash": round(today, 2),
            "cashCollected": round(totals["cashCollected"], 2),
            "deliveryFees": round(totals["deliveryFees"], 2),
            "toSettle": round(totals["pendingSubmission"], 2),
            "pendingRemit": round(totals["pendingRemit"], 2),
            "inVerification": round(totals["inVerification"], 2),
            "alreadyDeposited": round(totals["alreadyDeposited"], 2),
            "overdueCount": overdue_count,
            "maxOutstanding": round(max_outstanding, 2),
            "codBlocked": blocked,
            "blockReason": (
                "You have overdue COD settlements that must be cleared before new COD deliveries."
                if overdue_count > 0
                else "Your outstanding COD cash exceeds the platform limit. Settle before receiving more COD orders."
                if totals["pendingRemit"] > max_outstanding
                else None
            ),
            "collectionAccount": {
                "upiId": settings.COD_COLLECTION_UPI_ID,
                "accountNumber": settings.COD_COLLECTION_ACCOUNT_NUMBER,
                "accountName": settings.COD_COLLECTION_ACCOUNT_NAME,
                "ifsc": settings.COD_COLLECTION_ACCOUNT_IFSC,
            },
        },
    }


@router.get("/me/cash-settlements")
async def get_my_cash_settlements(
    status: Optional[str] = Query(None, description="pending_remit, submitted, verified, rejected"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user)
):
    """List the cash a delivery partner collected on COD orders.

    ``amountToRemit`` = cash collected minus the partner's delivery fee. This is
    the amount they must hand back to the platform; the farmer is paid from it.
    """
    if current_user.get("role") != "delivery":
        raise HTTPException(status_code=403, detail="Only delivery partners can access this endpoint")

    user_id = str(current_user["_id"])
    skip = (page - 1) * limit
    settlements = await cash_settlement_repository.get_by_delivery_partner(
        user_id, status=status, skip=skip, limit=limit
    )
    filter = {"deletedAt": None}
    try:
        filter["deliveryPartnerId"] = {"$in": [user_id, ObjectId(user_id)]}
    except Exception:
        filter["deliveryPartnerId"] = user_id
    if status:
        filter["status"] = status
    total = await cash_settlement_repository.count(filter)

    for s in settlements:
        s["id"] = str(s["_id"])
        s["orderId"] = str(s["orderId"])

    totals = await cash_settlement_repository.get_partner_totals(user_id)

    return {
        "success": True,
        "data": {
            "settlements": settlements,
            "totals": totals,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit if total else 0,
            },
        },
    }


def _is_cod_order(order: dict) -> bool:
    """True when an order is paid by cash on delivery."""
    payment = order.get("payment") or {}
    methods = [
        str(order.get("paymentMethod", "")).lower(),
        str(order.get("paymentType", "")).lower(),
        str(payment.get("method", "")).lower(),
        str(payment.get("paymentMethod", "")).lower(),
    ]
    return "cash" in methods or "cod" in methods


@router.get("/me/cash-settlements/summary")
async def get_my_cash_settlement_summary(current_user: dict = Depends(get_current_user)):
    """Delivery partner settlement section (mirrors the admin finance view).

    Returns:
    - ``today``: today's delivered orders split into COD vs online payment
      (order count + amount for each), so the partner can see exactly how much
      cash-on-delivery they delivered today.
    - ``todaySettlements``: detailed list of today's COD orders with the full
      split (cash collected, delivery fee, farmer share, platform share,
      amount to remit, settlement status).
    - ``totals``: lifetime cash collected / to settle / in verification /
      already deposited.
    - ``collectionAccount``: the agriConnect account to transfer COD cash into.
    """
    if current_user.get("role") != "delivery":
        raise HTTPException(status_code=403, detail="Only delivery partners can access this endpoint")

    profile = await _get_or_create_partner(str(current_user["_id"]))
    partner_id = str(profile["_id"])
    user_id = str(current_user["_id"])

    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    completed = await _partner_completed_deliveries(partner_id, user_id)
    seen_order_ids = set()
    cod_count = 0
    cod_amount = 0.0
    online_count = 0
    online_amount = 0.0
    today_delivered = []
    for item in completed:
        completed_at = _delivery_completed_at(item)
        if not completed_at or completed_at < today_start:
            continue
        order_id = item.get("orderId")
        if not order_id or order_id in seen_order_ids:
            continue
        seen_order_ids.add(order_id)
        order = await order_repository.get_by_id(order_id)
        if not order:
            continue
        amount = float(order.get("totalAmount", 0) or 0)
        is_cod = _is_cod_order(order)
        today_delivered.append({
            "orderId": order_id,
            "orderNumber": order.get("orderNumber"),
            "amount": round(amount, 2),
            "paymentMethod": order.get("paymentMethod") or (order.get("payment") or {}).get("method") or "cash",
            "cod": is_cod,
        })
        if is_cod:
            cod_count += 1
            cod_amount += amount
        else:
            online_count += 1
            online_amount += amount

    today_settlements = await cash_settlement_repository.get_today_settlements(user_id)
    for s in today_settlements:
        s["id"] = str(s["_id"])
        if s.get("orderId"):
            s["orderId"] = str(s["orderId"])

    totals = await cash_settlement_repository.get_partner_totals(user_id)
    today = await cash_settlement_repository.get_today_total(user_id)
    overdue_count = await cash_settlement_repository.count_overdue(user_id)
    max_outstanding = settings.COD_MAX_OUTSTANDING
    blocked = overdue_count > 0 or totals["pendingRemit"] > max_outstanding

    return _serialize_delivery_data({
        "success": True,
        "data": {
            "today": {
                "codOrders": cod_count,
                "codAmount": round(cod_amount, 2),
                "onlineOrders": online_count,
                "onlineAmount": round(online_amount, 2),
                "totalOrders": cod_count + online_count,
                "totalAmount": round(cod_amount + online_amount, 2),
                "deliveredOrders": today_delivered,
            },
            "todaySettlements": today_settlements,
            "todayCash": round(today, 2),
            "todayCodOrders": len(today_settlements),
            "totals": totals,
            "pendingRemit": round(totals["pendingRemit"], 2),
            "pendingSubmission": round(totals["pendingSubmission"], 2),
            "inVerification": round(totals["inVerification"], 2),
            "alreadyDeposited": round(totals["alreadyDeposited"], 2),
            "overdueCount": overdue_count,
            "maxOutstanding": round(max_outstanding, 2),
            "codBlocked": blocked,
            "blockReason": (
                "You have overdue COD settlements that must be cleared before new COD deliveries."
                if overdue_count > 0
                else "Your outstanding COD cash exceeds the platform limit. Settle before receiving more COD orders."
                if totals["pendingRemit"] > max_outstanding
                else None
            ),
            "collectionAccount": {
                "upiId": settings.COD_COLLECTION_UPI_ID,
                "accountNumber": settings.COD_COLLECTION_ACCOUNT_NUMBER,
                "accountName": settings.COD_COLLECTION_ACCOUNT_NAME,
                "ifsc": settings.COD_COLLECTION_ACCOUNT_IFSC,
            },
        },
    })


class SubmitSettlementRequest(BaseModel):
    settlementIds: List[str]
    method: str = "upi"  # upi | bank_transfer | collection_center
    reference: str  # UTR / transaction reference
    notes: Optional[str] = None


@router.post("/me/cash-settlements/submit")
async def submit_cash_settlement(
    data: SubmitSettlementRequest,
    current_user: dict = Depends(get_current_user)
):
    """File a COD cash settlement for verification.

    The partner transfers the outstanding cash to the platform collection
    account, then submits the transfer's UTR/reference. This does NOT settle
    the debt - finance must verify the reference against the bank statement
    first (status becomes ``submitted`` -> ``verified``).
    """
    if current_user.get("role") != "delivery":
        raise HTTPException(status_code=403, detail="Only delivery partners can access this endpoint")
    if not data.settlementIds:
        raise HTTPException(status_code=400, detail="Provide at least one settlementId")
    if data.method not in ("upi", "bank_transfer", "collection_center"):
        raise HTTPException(status_code=400, detail="method must be upi, bank_transfer or collection_center")
    if data.method != "collection_center" and not data.reference.strip():
        raise HTTPException(status_code=400, detail="Provide the transaction reference / UTR number")

    user_id = str(current_user["_id"])
    submitted = 0.0
    count = 0
    for sid in data.settlementIds:
        settlement = await cash_settlement_repository.get_by_id(sid)
        if not settlement:
            continue
        # Ensure the settlement belongs to this partner and is still owing.
        owner = settlement.get("deliveryPartnerId")
        owner_str = str(owner) if owner else None
        if owner_str and owner_str != user_id:
            continue
        if settlement.get("status") not in ("pending_remit", "rejected"):
            continue
        ok = await cash_settlement_repository.submit_settlement(
            sid, data.method, data.reference.strip(), user_id
        )
        if ok:
            submitted += float(settlement.get("amountToRemit", 0))
            count += 1

    remaining = await cash_settlement_repository.get_partner_totals(user_id)
    return {
        "success": True,
        "data": {
            "submittedCount": count,
            "submittedAmount": round(submitted, 2),
            "remainingToSettle": round(remaining["pendingRemit"], 2),
            "status": "submitted",
            "message": "Settlement submitted. Finance will verify the reference before it is marked settled.",
        },
        "message": f"Settlement of Rs {round(submitted, 2)} submitted for verification.",
    }


@router.get("/me/stats")
async def get_my_stats(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "delivery":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only delivery partners can access this endpoint"
        )

    profile = await _get_or_create_partner(str(current_user["_id"]))

    stats = await DeliveryService.get_delivery_stats(str(profile["_id"]))
    return {
        "success": True,
        "data": stats
    }

@router.put("/me/availability")
async def update_my_availability(
    isAvailable: bool = Body(..., embed=True),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "delivery":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only delivery partners can update availability"
        )

    profile = await _get_or_create_partner(str(current_user["_id"]))

    status_value = DeliveryPartnerStatus.AVAILABLE if isAvailable else DeliveryPartnerStatus.OFFLINE
    success = await DeliveryService.update_status(
        str(profile["_id"]),
        status_value,
        isAvailable
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to update availability"
        )

    return {
        "success": True,
        "data": {
            "isAvailable": isAvailable,
            "status": status_value
        },
        "message": "Availability updated successfully"
    }

@router.get("/assignments/pending")
async def get_pending_assignments(
    limit: int = Query(10, ge=1, le=50),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "delivery":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only delivery partners can access this endpoint"
        )
    
    profile = await _get_or_create_partner(str(current_user["_id"]))
    
    assignments = await delivery_assignment_repository.get_by_delivery_partner(
        str(profile["_id"]),
        status=DeliveryStatus.ASSIGNED,
        limit=limit
    )
    
    for assignment in assignments:
        assignment["id"] = str(assignment["_id"])
        order = await order_repository.get_by_id(str(assignment["orderId"]))
        if order:
            assignment["order"] = {
                "id": str(order["_id"]),
                "orderNumber": order.get("orderNumber"),
                "totalAmount": order.get("totalAmount"),
                "items": order.get("items", [])
            }
            customer = await UserService.get_user_by_id(str(order["customerId"]))
            if customer:
                assignment["customer"] = {
                    "name": f"{customer.get('firstName', '')} {customer.get('lastName', '')}",
                    "phone": customer.get("phone"),
                    "address": order.get("deliveryAddress")
                }
    
    return {
        "success": True,
        "data": assignments
    }

@router.put("/assignments/{assignment_id}/accept")
async def accept_delivery(
    assignment_id: str,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "delivery":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only delivery partners can accept assignments"
        )
    
    profile = await _get_or_create_partner(str(current_user["_id"]))
    assignment = await DeliveryService.accept_delivery(
        assignment_id,
        str(profile["_id"])
    )
    
    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to accept delivery"
        )
    
    return {
        "success": True,
        "data": assignment,
        "message": "Delivery accepted successfully"
    }


@router.put("/orders/{order_id}/accept")
async def accept_available_order(
    order_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Let a delivery partner accept an available ready order from nearby orders."""
    if current_user.get("role") != "delivery":
        raise HTTPException(status_code=403, detail="Only delivery partners can accept orders")

    profile = await _get_or_create_partner(str(current_user["_id"]))
    partner_id = str(profile["_id"])
    order = await order_repository.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    existing_partner = order.get("deliveryPartnerId")
    if existing_partner and str(existing_partner) != partner_id:
        raise HTTPException(status_code=400, detail="Order is already assigned to another partner")

    if order.get("orderStatus") not in ("ready_for_delivery", "dispatched", "assigned", "accepted"):
        raise HTTPException(status_code=400, detail="Order is not ready for delivery")

    is_cod = (
        str(order.get("paymentMethod", "")).lower() == "cash"
        or str(order.get("paymentType", "")).lower() == "cod"
        or (order.get("payment") or {}).get("method") == "cash"
    )
    if is_cod:
        eligibility = await _cod_eligibility(str(current_user["_id"]))
        if eligibility["codBlocked"]:
            raise HTTPException(
                status_code=400,
                detail=eligibility["reason"] or "COD deliveries currently blocked",
            )

    assignment = await delivery_assignment_repository.get_by_order_id(order_id)
    if assignment and str(assignment.get("deliveryPartnerId")) != partner_id:
        raise HTTPException(status_code=400, detail="Order is already assigned to another partner")

    if not assignment:
        assignment_id = await delivery_assignment_repository.create_assignment({
            "orderId": ObjectId(order_id),
            "deliveryPartnerId": ObjectId(partner_id),
            "status": DeliveryStatus.ASSIGNED,
        })
        if not assignment_id:
            raise HTTPException(status_code=400, detail="Failed to create delivery assignment")
    else:
        assignment_id = str(assignment["_id"])

    success = await delivery_assignment_repository.update_status(assignment_id, DeliveryStatus.IN_TRANSIT)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to accept order")

    await order_repository.update(
        {"_id": ObjectId(order_id)},
        {
            "deliveryPartnerId": ObjectId(partner_id),
            "orderStatus": "in_transit",
            "assignedAt": order.get("assignedAt") or datetime.utcnow(),
            "acceptedAt": datetime.utcnow(),
            "updatedAt": datetime.utcnow(),
        }
    )
    await delivery_repository.update_status(partner_id, DeliveryPartnerStatus.BUSY, is_available=False)
    accepted = await delivery_assignment_repository.get_by_id(assignment_id)

    return {
        "success": True,
        "data": await _enrich_assignment(accepted),
        "message": "Order accepted successfully"
    }

@router.put("/assignments/{assignment_id}/cancel")
async def cancel_assignment_and_reopen(
    assignment_id: str,
    reason: Optional[str] = Body(None, embed=True),
    current_user: dict = Depends(get_current_user),
):
    """Partner (or admin) cancels an assignment — the order falls back automatically.

    The assignment is marked cancelled, the order returns to the unassigned
    pool and a fresh marketplace job is opened so every eligible partner sees
    it again. The farmer is notified immediately, so the order never gets
    stuck with a partner who bailed.
    """
    role = current_user.get("role")
    if role not in ("delivery", "admin"):
        raise HTTPException(status_code=403, detail="Only delivery partners or admins can cancel assignments")

    assignment = await delivery_assignment_repository.get_by_id(assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    if role == "delivery":
        profile = await _get_or_create_partner(str(current_user["_id"]))
        if str(assignment.get("deliveryPartnerId")) != str(profile["_id"]):
            raise HTTPException(status_code=403, detail="This assignment belongs to another partner")

    current_status = str(assignment.get("status") or "").lower()
    if current_status in ("delivered", "completed", "picked_up", "cancelled", "failed"):
        raise HTTPException(
            status_code=400,
            detail=f"Assignment cannot be cancelled at stage '{current_status or 'unknown'}'",
        )

    order_id = str(assignment.get("orderId"))
    order = await order_repository.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    ok = await delivery_assignment_repository.update_status(assignment_id, DeliveryStatus.CANCELLED)
    if not ok:
        raise HTTPException(status_code=400, detail="Failed to cancel the assignment")

    # Return the order to the unassigned pool so it can be re-claimed.
    reverted_status = (
        "ready_for_delivery"
        if order.get("orderStatus") in ("dispatched", "in_transit", "assigned", "accepted")
        else order.get("orderStatus")
    )
    await order_repository.update(
        {"_id": ObjectId(order_id)},
        {
            "deliveryPartnerId": None,
            "partnerRequested": False,
            "selfDelivery": False,
            "partnerAssignmentOpen": True,
            "orderStatus": reverted_status,
            "assignmentCancelReason": (reason or "").strip() or None,
            "updatedAt": datetime.utcnow(),
        },
    )

    # Re-open a marketplace job so other partners can pick it up.
    job_opened = False
    try:
        farmer_id = str(order.get("farmerId"))
        farm = {"name": "Farm", "lat": None, "lng": None, "address": ""}
        try:
            from app.api.v1.farmers import _get_farm_origin, _haversine_km

            farm = await _get_farm_origin(farmer_id)
        except Exception:
            logger.warning("Could not resolve farm origin for cancelled assignment %s", assignment_id)

        distance_km = None
        coords = ((order.get("deliveryAddress") or {}).get("location") or {}).get("coordinates") or []
        if farm.get("lat") is not None and len(coords) == 2:
            distance_km = round(_haversine_km(farm["lat"], farm["lng"], coords[1], coords[0]), 2)

        eligible = []
        try:
            eligible = await eligible_partners_for_job(farm.get("lat") or 0.0, farm.get("lng") or 0.0, 0.0)
        except Exception:
            eligible = []

        job_doc = build_job_document(
            order,
            farm,
            distance_km,
            expires_in_minutes=JOB_DEFAULT_EXPIRY_MINUTES,
            eligible_partner_ids=[p["id"] for p in eligible],
        )
        job_id = await delivery_job_repository.create_job(job_doc)
        if job_id:
            job_opened = True
            for p in eligible:
                try:
                    if p.get("userId"):
                        await NotificationService.send_custom_notification(
                            p["userId"],
                            f"Delivery re-opened near you: order {order.get('orderNumber', '')} ({job_doc['weightKg']} kg, ₹{job_doc['earnings']}).",
                        )
                except Exception:
                    pass
    except Exception:
        logger.warning("Failed to reopen marketplace job after cancellation of %s", assignment_id, exc_info=True)

    try:
        await NotificationService.send_custom_notification(
            str(order.get("farmerId")),
            f"Delivery partner cancelled order {order.get('orderNumber', '')}. It has been reopened to the delivery marketplace.",
        )
    except Exception:
        pass

    return {
        "success": True,
        "data": {
            "assignmentId": assignment_id,
            "orderId": order_id,
            "orderStatus": reverted_status,
            "marketplaceReopened": job_opened,
        },
        "message": "Assignment cancelled and order reopened to the delivery marketplace",
    }


@router.put("/assignments/{assignment_id}/pickup")
async def pickup_delivery(
    assignment_id: str,
    location: Optional[DeliveryLocationUpdate] = None,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "delivery":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only delivery partners can update delivery status"
        )
    
    location_data = None
    if location:
        location_data = {
            "type": "Point",
            "coordinates": [location.longitude, location.latitude]
        }
    
    assignment = await DeliveryService.pick_up_delivery(
        assignment_id,
        str(current_user["_id"]),
        location_data
    )
    
    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to update delivery status"
        )
    
    return {
        "success": True,
        "data": assignment,
        "message": "Delivery picked up successfully"
    }

@router.put("/assignments/{assignment_id}/deliver")
async def deliver_order(
    assignment_id: str,
    otp: str = Body(..., embed=True),
    delivery_photo: Optional[str] = Body(None, embed=True),
    location: Optional[DeliveryLocationUpdate] = None,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "delivery":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only delivery partners can complete deliveries"
        )
    
    location_data = None
    if location:
        location_data = {
            "type": "Point",
            "coordinates": [location.longitude, location.latitude]
        }
    
    assignment = await DeliveryService.deliver_order(
        assignment_id,
        str(current_user["_id"]),
        otp,
        delivery_photo,
        location_data
    )
    
    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to complete delivery. Check OTP or delivery status."
        )
    
    return {
        "success": True,
        "data": assignment,
        "message": "Order delivered successfully!"
    }

@router.get("/track/{order_id}", response_model=DeliveryTrackingResponse)
async def track_delivery(
    order_id: str,
    current_user: dict = Depends(get_current_user)
):
    order = await order_repository.get_by_id(order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
        )
    
    user_id = str(current_user["_id"])
    role = current_user.get("role")
    
    if role == "customer" and str(order["customerId"]) != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only track your own orders"
        )
    elif role == "delivery" and str(order.get("deliveryPartnerId")) != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only track deliveries assigned to you"
        )
    elif role not in ["customer", "delivery", "admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    tracking = await DeliveryService.track_delivery(order_id)
    if not tracking:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Delivery not found or not in transit"
        )
    
    return tracking

@router.post("/route/optimize", response_model=RouteOptimizationResponse)
async def optimize_route(
    request: RouteOptimizationRequest,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") not in ["delivery", "admin", "farmer"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    route = await DeliveryService.optimize_route(request)
    return route

@router.get("/route/me")
async def get_my_route(
    date: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "delivery":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only delivery partners can access this endpoint"
        )
    
    profile = await _get_or_create_partner(str(current_user["_id"]))
    
    route_date = None
    if date:
        try:
            route_date = datetime.fromisoformat(date.replace('Z', '+00:00'))
        except Exception:
            pass
    
    route = await DeliveryService.get_partner_route(str(profile["_id"]), route_date)
    
    if not route:
        return {
            "success": True,
            "data": None,
            "message": "No route assigned for this date"
        }
    
    route["id"] = str(route["_id"])
    if route.get("waypoints"):
        for waypoint in route["waypoints"]:
            order = await order_repository.get_by_id(waypoint.get("orderId"))
            if order:
                waypoint["order"] = {
                    "orderNumber": order.get("orderNumber"),
                    "customerName": order.get("customerName", "Customer"),
                    "address": order.get("deliveryAddress")
                }
    
    return {
        "success": True,
        "data": route
    }

@router.get("/me/route")
async def get_my_route_compat(
    date: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    try:
        return await get_my_route(date=date, current_user=current_user)
    except Exception as e:
        return {"success": True, "data": None, "message": "No route data available"}

@router.get("/partners/available")
async def get_available_partners(current_user: dict = Depends(get_current_user)):
    partners = await delivery_repository.get_available_partners(limit=50)
    result = []
    for p in partners:
        user = await UserService.get_user_by_id(str(p.get("userId")))
        result.append({
            "id": str(p["_id"]),
            "name": f"{user.get('firstName', '')} {user.get('lastName', '')}".strip() if user else "Unknown",
            "phone": user.get("phone", "") if user else "",
            "vehicleType": p.get("vehicleType", ""),
            "vehicleNumber": p.get("vehicleNumber", ""),
            "rating": p.get("rating", 0),
            "totalDeliveries": p.get("totalDeliveries", 0),
            "isAvailable": p.get("isAvailable", True)
        })
    return {"success": True, "data": result}

@router.get("/admin/partners")
async def get_all_partners(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can access this endpoint"
        )
    
    filter = {"deletedAt": None}
    if status:
        filter["status"] = status
    
    skip = (page - 1) * limit
    partners = await delivery_repository.find_many(
        filter,
        skip=skip,
        limit=limit,
        sort=[("createdAt", -1)]
    )
    
    total = await delivery_repository.count(filter)
    
    for partner in partners:
        partner["id"] = str(partner["_id"])
        user = await UserService.get_user_by_id(str(partner["userId"]))
        if user:
            partner["user"] = {
                "name": f"{user.get('firstName', '')} {user.get('lastName', '')}",
                "email": user.get("email"),
                "phone": user.get("phone")
            }
    
    return {
        "success": True,
        "data": {
            "partners": partners,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit
            }
        }
    }

@router.post("/admin/assign/{order_id}")
async def admin_assign_delivery(
    order_id: str,
    partner_id: Optional[str] = Body(None, embed=True),
    auto_assign: bool = Body(True, embed=True),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can assign deliveries"
        )
    
    assignment = await DeliveryService.assign_delivery(
        order_id,
        partner_id,
        auto_assign
    )
    
    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to assign delivery. Check order status or partner availability."
        )
    
    return {
        "success": True,
        "data": assignment,
        "message": "Delivery assigned successfully"
    }

@router.get("/admin/stats")
async def get_delivery_stats(
    period: str = Query("week", description="day, week, month"),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can access this endpoint"
        )
    
    now = datetime.utcnow()
    if period == "day":
        start_date = datetime(now.year, now.month, now.day)
    elif period == "week":
        start_date = now - timedelta(days=7)
    elif period == "month":
        start_date = now - timedelta(days=30)
    else:
        start_date = now - timedelta(days=7)
    
    assignments = await delivery_assignment_repository.find_many({
        "assignedAt": {"$gte": start_date, "$lte": now},
        "deletedAt": None
    })
    
    total = len(assignments)
    completed = len([a for a in assignments if a.get("status") == DeliveryStatus.DELIVERED])
    failed = len([a for a in assignments if a.get("status") == DeliveryStatus.FAILED])
    cancelled = len([a for a in assignments if a.get("status") == DeliveryStatus.CANCELLED])
    in_progress = len([a for a in assignments if a.get("status") in [
        DeliveryStatus.ASSIGNED,
        DeliveryStatus.ACCEPTED,
        DeliveryStatus.PICKED_UP,
        DeliveryStatus.IN_TRANSIT
    ]])
    
    partners = await delivery_repository.find_many({"deletedAt": None})
    available_partners = len([p for p in partners if p.get("isAvailable")])
    
    # ----- Active delivery routes -----
    active_statuses = [
        DeliveryStatus.ASSIGNED,
        DeliveryStatus.ACCEPTED,
        DeliveryStatus.PICKED_UP,
        DeliveryStatus.IN_TRANSIT
    ]
    active_assignments = await delivery_assignment_repository.find_many({
        "status": {"$in": [s.value for s in active_statuses]},
        "deletedAt": None
    })

    routes = []
    if active_assignments:
        by_partner = {}
        for assignment in active_assignments:
            pid = str(assignment.get("deliveryPartnerId"))
            by_partner.setdefault(pid, []).append(assignment)

        order_map = {}
        customer_ids = []
        order_ids = [a.get("orderId") for a in active_assignments if a.get("orderId")]
        if order_ids:
            orders_coll = MongoDB.get_collection("orders")
            orders = await orders_coll.find({"_id": {"$in": order_ids}}).to_list(length=len(order_ids))
            for order in orders:
                order_map[str(order["_id"])] = order
                if order.get("customerId"):
                    customer_ids.append(order["customerId"])

        partner_ids = []
        for pid in by_partner.keys():
            try:
                partner_ids.append(ObjectId(pid))
            except Exception:
                continue
        users_coll = MongoDB.get_collection("users")
        profiles = await delivery_repository.find_many({"_id": {"$in": partner_ids}}) if partner_ids else []
        user_lookup_ids = [p.get("userId") for p in profiles if p.get("userId")]
        user_lookup_ids.extend(customer_ids)
        user_lookup_ids.extend(partner_ids)
        name_by_id = {}
        if user_lookup_ids:
            users = await users_coll.find(
                {"_id": {"$in": user_lookup_ids}}
            ).to_list(length=len(user_lookup_ids))
            for user in users:
                full_name = f"{user.get('firstName', '')} {user.get('lastName', '')}".strip()
                name_by_id[str(user["_id"])] = full_name

        profile_user_by_id = {
            str(p["_id"]): str(p["userId"])
            for p in profiles
            if p.get("userId")
        }

        status_rank = {
            DeliveryStatus.IN_TRANSIT: 4,
            DeliveryStatus.PICKED_UP: 3,
            DeliveryStatus.ACCEPTED: 2,
            DeliveryStatus.ASSIGNED: 1
        }

        for pid, assignments in by_partner.items():
            assignments.sort(key=lambda a: a.get("assignedAt") or datetime.min)
            first = assignments[0]
            current_status = max(
                assignments,
                key=lambda a: status_rank.get(a.get("status"), 0)
            ).get("status", DeliveryStatus.ASSIGNED)

            user_id = profile_user_by_id.get(pid)
            partner_name = name_by_id.get(user_id) or name_by_id.get(pid) or "Delivery partner"

            first_order = order_map.get(str(first.get("orderId"))) if first.get("orderId") else None
            customer_name = ""
            if first_order and first_order.get("customerId"):
                customer_name = name_by_id.get(str(first_order["customerId"])) or ""
            area = (first_order or {}).get("deliveryAddress", {}).get("city") or ""

            routes.append({
                "farmer": customer_name or "Customer delivery",
                "partner": partner_name,
                "area": area,
                "orders": len(assignments),
                "status": current_status,
                "startTime": (first.get("assignedAt") or now).strftime("%H:%M")
            })

        routes.sort(key=lambda r: r["orders"], reverse=True)
    
    return {
        "success": True,
        "data": {
            "period": period,
            "summary": {
                "totalAssignments": total,
                "completed": completed,
                "failed": failed,
                "cancelled": cancelled,
                "inProgress": in_progress,
                "completionRate": round((completed / total * 100) if total > 0 else 0, 1)
            },
            "partners": {
                "total": len(partners),
                "available": available_partners,
                "busy": len(partners) - available_partners
            },
            "routes": routes,
            "trend": []
        }
    }


# ---------- Delivery job marketplace (partner side) ----------

def _haversine_km(lat1, lng1, lat2, lng2) -> Optional[float]:
    if lat1 is None or lng1 is None or lat2 is None or lng2 is None:
        return None
    import math
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    )
    return 2 * R * math.asin(math.sqrt(a))


def _partner_current_point(profile: dict) -> Optional[dict]:
    loc = profile.get("currentLocation") or profile.get("location")
    coords = (loc or {}).get("coordinates")
    if coords and len(coords) >= 2:
        return {"lat": float(coords[1]), "lng": float(coords[0])}
    return None


@router.get("/me/jobs")
async def get_my_delivery_jobs(
    lat: Optional[float] = Query(None, ge=-90, le=90),
    lng: Optional[float] = Query(None, ge=-180, le=180),
    radius: int = Query(60, ge=5, le=200),
    current_user: dict = Depends(get_current_user),
):
    """Open marketplace jobs near the partner plus their accepted jobs.

    ``lat``/``lng`` are the driver's current position; when omitted the
    delivery profile's ``currentLocation`` is used. Open jobs are privacy-safe
    (customer address/phone hidden) until accepted.
    """
    if current_user.get("role") != "delivery":
        raise HTTPException(status_code=403, detail="Only delivery partners can access this endpoint")

    profile = await _get_or_create_partner(str(current_user["_id"]))
    partner_id = str(profile["_id"])

    point = None
    if lat is not None and lng is not None:
        point = {"lat": float(lat), "lng": float(lng)}
    if point is None:
        point = _partner_current_point(profile)
    if point is None:
        raise HTTPException(
            status_code=400,
            detail="Current location is not set. Share your location to see nearby delivery jobs.",
        )

    open_jobs = await delivery_job_repository.find_open_jobs_near(
        point["lng"], point["lat"], radius, limit=100
    )
    open_list = []
    for job in open_jobs or []:
        coords = (job.get("pickupLocation") or {}).get("coordinates")
        dist = None
        if coords and len(coords) >= 2:
            dist = _haversine_km(point["lat"], point["lng"], coords[1], coords[0])
        open_list.append(serialize_job_for_partner(job, distance_from_partner=dist, reveal=False))

    accepted_jobs = await delivery_job_repository.get_jobs_for_partner(partner_id)
    accepted_list = []
    for job in accepted_jobs or []:
        accepted_list.append(serialize_job_for_partner(job, reveal=True))

    open_list.sort(key=lambda j: (j.get("distanceFromPartner") if j.get("distanceFromPartner") is not None else 1e9))

    return {
        "success": True,
        "data": {
            "openJobs": open_list,
            "acceptedJobs": accepted_list,
            "radius": radius,
        },
    }


@router.post("/jobs/{job_id}/accept")
async def accept_delivery_job(
    job_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Atomically accept an open delivery job (first come, first served)."""
    if current_user.get("role") != "delivery":
        raise HTTPException(status_code=403, detail="Only delivery partners can accept jobs")

    profile = await _get_or_create_partner(str(current_user["_id"]))
    partner_id = str(profile["_id"])

    job = await delivery_job_repository.get_by_id(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Delivery job not found")
    if job.get("status") != JOB_OPEN:
        raise HTTPException(status_code=400, detail="This delivery job is no longer available")
    if (job.get("expiresAt") or datetime.utcnow()) <= datetime.utcnow():
        await delivery_job_repository.mark_no_partner_found(job_id)
        raise HTTPException(status_code=400, detail="This delivery job has expired")

    # Verify the partner is still eligible (available, verified, capacity).
    count, committed = await partner_commitment(partner_id)
    is_available = bool(profile.get("isAvailable")) and profile.get("status") in ("available", None)
    if not (is_available and bool(profile.get("isVerified"))):
        raise HTTPException(
            status_code=400,
            detail="Your profile must be available and verified to accept delivery jobs.",
        )
    if not passes_capacity(profile, committed, float(job.get("weightKg") or 0)):
        raise HTTPException(
            status_code=400,
            detail="Your vehicle capacity cannot fit this job. Complete or drop other deliveries first.",
        )

    if not await delivery_job_repository.claim_job(job_id, partner_id):
        raise HTTPException(status_code=409, detail="Another partner claimed this job first")

    # Wire the order + assignment so the existing delivery flow takes over.
    order_id = str(job["orderId"])
    order = await order_repository.get_by_id(order_id)
    if not order:
        await delivery_job_repository.release_job(job_id)
        raise HTTPException(status_code=404, detail="Order for this job no longer exists")

    # The order must have reached the pickup-ready stage of the pipeline
    # (the farmer has processed it and marked it ready for delivery).
    order_status = str(order.get("orderStatus") or "")
    if order_status not in ACCEPTABLE_ORDER_STATUSES:
        await delivery_job_repository.release_job(job_id)
        raise HTTPException(
            status_code=400,
            detail=(
                f"This order is not ready for pickup yet (status: '{order_status or 'unknown'}'). "
                "The farmer will process it and mark it ready for delivery first."
            ),
        )

    farmer_id = str(order.get("farmerId") or "")
    partner_name = profile.get("name") or ""
    try:
        partner_user = await UserService.get_user_by_id(str(profile.get("userId") or str(current_user["_id"])))
        if partner_user:
            partner_name = (
                f"{partner_user.get('firstName', '')} {partner_user.get('lastName', '')}".strip()
                or partner_user.get("name")
                or partner_name
            )
    except Exception:
        pass
    await order_repository.update_order_field(order_id, "deliveryPartnerId", ObjectId(partner_id))
    await order_repository.update_order_field(order_id, "deliveryPartnerName", partner_name)
    await order_repository.update_order_field(order_id, "partnerAssignmentOpen", False)
    await order_repository.update_order_field(order_id, "partnerRequested", False)

    # Advance the order through the pipeline like the order map: once a partner
    # picks up a ready job the order moves ready_for_delivery -> in_transit.
    if order_status in ("ready_for_delivery", "dispatched"):
        try:
            await order_repository.update_order_status(
                order_id, "in_transit", str(current_user["_id"]), "Delivery partner accepted job"
            )
            order_status = "in_transit"
        except Exception as e:
            logger.warning(f"Job accept: failed to advance order {order_id} to in_transit: {e}")
    await delivery_job_repository.sync_order_status(job_id, order_status)

    try:
        existing = await delivery_assignment_repository.get_by_order_id(order_id)
        if existing:
            await delivery_assignment_repository.reassign_open_assignment(order_id, partner_id)
        else:
            await delivery_assignment_repository.create_assignment({
                "orderId": ObjectId(order_id),
                "deliveryPartnerId": ObjectId(partner_id),
                "farmerId": ObjectId(farmer_id) if farmer_id else None,
                "status": DeliveryStatus.IN_TRANSIT,
                "priority": 1,
                "source": "job_marketplace",
                "assignee": "partner",
                "assignmentMethod": "self_service",
            })
    except Exception as e:
        logger.warning(f"Job accept: assignment record error for {order_id}: {e}")

    try:
        if farmer_id:
            from app.services.notification_service import NotificationService
            await NotificationService.send_custom_notification(
                farmer_id,
                f"A delivery partner accepted order {job.get('orderNumber', '')}.",
            )
    except Exception:
        pass

    refreshed = await delivery_job_repository.get_by_id(job_id)
    return {
        "success": True,
        "data": serialize_job_for_partner(refreshed, reveal=True),
        "message": "Delivery job accepted",
    }
