from typing import Optional, Dict, Any, List
from app.services.delivery_priority_service import calculate_order_delivery_priority
from bson import ObjectId
from datetime import datetime
from app.repositories.order_repository import order_repository
from app.repositories.product_repository import product_repository
from app.repositories.inventory_repository import inventory_repository
from app.repositories.address_repository import address_repository
from app.repositories.coupon_repository import coupon_repository
from app.repositories.payment_repository import payment_repository
from app.schemas.order import (
    OrderCreate, OrderUpdate, OrderStatusUpdate,
    OrderFilterParams, OrderStatus, PaymentStatus, DeliveryType,
    FulfillmentMethod, FulfillmentStage, DeliveryResponsibility
)
from app.services.notification_service import NotificationService
from app.services.payment_service import PaymentService
from app.services.inventory_service import inventory_service, broadcast_stock_update, InventoryService
from app.core.config import settings
from app.repositories.reservation_repository import reservation_repository
from app.repositories.base_repository import BaseRepository
from app.services.delivery_availability_service import get_delivery_service_availability, estimate_fastest_eligibility
import httpx
import secrets
import logging

logger = logging.getLogger(__name__)
harvest_preorder_repository = BaseRepository("harvest_preorders")

# Approximate city-centre fallback for legacy orders that contain only text
# addresses. This keeps radius filtering usable when public geocoders throttle
# requests or are unavailable. New addresses should still save exact GeoJSON.
LOCAL_CITY_COORDINATES = {
    "tiruchirapalli": (10.7905, 78.7047),
    "trichirapalli": (10.7905, 78.7047),
    "trichy": (10.7905, 78.7047),
    "manachanallur": (10.9520, 78.7580),
    "perambalur": (11.2342, 78.8807),
    "krishnagiri": (12.5186, 78.2137),
    "salem": (11.6643, 78.1460),
    "namakkal": (11.2194, 78.1677),
    "dharmapuri": (12.1211, 78.1582),
    "coimbatore": (11.0168, 76.9558),
    "kovai": (11.0168, 76.9558),
    "tiruppur": (11.1085, 77.3411),
    "erode": (11.3410, 77.7172),
    "madurai": (9.9252, 78.1198),
    "chennai": (13.0827, 80.2707),
    "tuticorin": (8.7642, 78.1348),
    "thoothukudi": (8.7642, 78.1348),
    "vellore": (12.9165, 79.1325),
    "karur": (10.9601, 78.0766),
    "thanjavur": (10.7870, 79.1378),
    "kumbakonam": (10.9602, 79.3845),
    "cuddalore": (11.7447, 79.7680),
    "villupuram": (11.9417, 79.4924),
    "ranipet": (12.9268, 79.3321),
    "hosur": (12.7409, 77.8253),
    "ooty": (11.4064, 76.6932),
    "udhagamandalam": (11.4064, 76.6932),
    "nagercoil": (8.1772, 77.4351),
    "tirunelveli": (8.7139, 77.7567),
    "puducherry": (11.9416, 79.8083),
    "bangalore": (12.9716, 77.5946),
    "bengaluru": (12.9716, 77.5946),
}


def _local_address_location(query: str) -> Optional[Dict[str, Any]]:
    normalized = query.lower()
    for city, (lat, lng) in LOCAL_CITY_COORDINATES.items():
        if city in normalized:
            return {"type": "Point", "coordinates": [lng, lat], "source": "city-centre-fallback"}
    return None

async def geocode_address(address: Dict[str, str]) -> Optional[Dict[str, Any]]:
    def _query(parts: List[str]) -> str:
        return ", ".join(p for p in parts if p and str(p).strip())

    full_query = _query([
        address.get("address_line1", ""),
        address.get("address_line2", ""),
        address.get("city", ""),
        address.get("state", ""),
        address.get("zip_code", ""),
        address.get("country", ""),
    ])
    if not full_query:
        return None

    city = address.get("city", "")
    state = address.get("state", "")
    zip_code = address.get("zip_code", "")

    # Progressive fallback: typo'd or village addresses often fail at street
    # level but resolve by "city + pincode" or "city" alone. Try shorter and
    # shorter queries so a manual address always lands on real coordinates.
    queries = [
        full_query,
        _query([city, state, zip_code]),
        _query([city, zip_code]),
        city or state,
    ]
    queries = [q for q in queries if q]

    # Real street-level geocoding FIRST (Nominatim), then Photon. The local
    # city-centre table is the last resort.
    for q in queries:
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                resp = await client.get(
                    "https://nominatim.openstreetmap.org/search",
                    params={"q": q, "format": "json", "limit": 1, "addressdetails": 1},
                    headers={"User-Agent": "AgriConnect/1.0"}
                )
                resp.raise_for_status()
                data = resp.json()
                if data:
                    lat = float(data[0]["lat"])
                    lng = float(data[0]["lon"])
                    return {"type": "Point", "coordinates": [lng, lat]}
        except Exception as e:
            logger.warning(f"Geocoding failed for query: {q[:50]}... - {e}")

    # Nominatim is rate-limited. Photon provides a second free fallback so
    # delivery-radius filtering can still resolve older orders.
    for q in queries[:2]:
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                resp = await client.get(
                    "https://photon.komoot.io/api/",
                    params={"q": q, "limit": 1},
                    headers={"User-Agent": "AgriConnect/1.0"},
                )
                resp.raise_for_status()
                features = resp.json().get("features", [])
                if features:
                    coords = features[0].get("geometry", {}).get("coordinates", [])
                    if len(coords) >= 2:
                        return {"type": "Point", "coordinates": [float(coords[0]), float(coords[1])]}
        except Exception as e:
            logger.warning(f"Fallback geocoding failed for query: {q[:50]}... - {e}")

    # Last resort: coarse city-centre coordinates for known cities.
    local_location = _local_address_location(full_query)
    if local_location:
        logger.info("Using local city-centre coordinates for delivery address: %s", full_query[:80])
        return local_location

    return None

def _convert_objectids(obj):
    if isinstance(obj, ObjectId):
        return str(obj)
    if isinstance(obj, dict):
        return {k: _convert_objectids(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_convert_objectids(i) for i in obj]
    return obj


async def _resolve_tracking_origin(order: dict) -> Optional[Dict[str, Any]]:
    """Resolve the origin point for tracking when the partner has no live location.

    Tries in order: pickup/farm location stored on the order, the farmer's
    profile farm location (geocoding the farm address if needed), then the
    product location from the first order item.
    """
    def _normalize(loc):
        if not isinstance(loc, dict):
            return None
        coordinates = loc.get("coordinates")
        if isinstance(coordinates, (list, tuple)) and len(coordinates) >= 2:
            try:
                return {"type": "Point", "coordinates": [float(coordinates[0]), float(coordinates[1])]}
            except (TypeError, ValueError):
                return None
        lat = loc.get("lat", loc.get("latitude"))
        lng = loc.get("lng", loc.get("lon", loc.get("longitude")))
        if lat is not None and lng is not None:
            try:
                return {"type": "Point", "coordinates": [float(lng), float(lat)]}
            except (TypeError, ValueError):
                return None
        return None

    for key in ("pickupLocation", "farmLocation"):
        normalized = _normalize(order.get(key))
        if normalized:
            return normalized

    farmer_id = order.get("farmerId")
    if farmer_id:
        try:
            from app.services.farmer_service import FarmerService
            profile = await FarmerService.get_farmer_profile(str(farmer_id))
        except Exception:
            profile = None
        if profile:
            normalized = _normalize(profile.get("farmLocation") or profile.get("location"))
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
                product = await product_repository.get_by_id(str(product_id))
            except Exception:
                product = None
            if product:
                normalized = _normalize(product.get("location"))
                if normalized:
                    return normalized
                # The product may carry a text farm address even when the farmer
                # profile has no coordinates yet.
                farm_address = product.get("farmAddress") or product.get("farm_address")
                if farm_address:
                    try:
                        geocoded = await geocode_address({
                            "address_line1": farm_address,
                            "address_line2": "",
                            "city": product.get("farmCity") or product.get("city") or "",
                            "state": product.get("farmState") or product.get("state") or "",
                            "zip_code": str(product.get("farmPincode") or product.get("pincode") or ""),
                            "country": "India",
                        })
                    except Exception:
                        geocoded = None
                    if geocoded:
                        return geocoded
    return None


class OrderCreationError(Exception):
    pass

class ProductNotFoundError(OrderCreationError):
    def __init__(self, product_id: str):
        super().__init__(f"Product not found: {product_id}")

class InsufficientStockError(OrderCreationError):
    def __init__(self, product_id: str, requested: int, available: int):
        super().__init__(f"Insufficient stock for product {product_id}: requested {requested}, available {available}")

class AddressNotFoundError(OrderCreationError):
    def __init__(self, address_id: str):
        super().__init__(f"Delivery address not found: {address_id}")

class OrderService:
    """Order service with business logic."""
    
    @staticmethod
    async def create_order(customer_id: str, data: OrderCreate) -> Optional[Dict[str, Any]]:
        """Create a new order with retry-safe idempotency when supplied."""
        if data.idempotencyKey:
            existing = await order_repository.get_by_idempotency_key(customer_id, data.idempotencyKey)
            if existing:
                existing["id"] = str(existing["_id"])
                return existing

        preorder = None
        if data.preorderId:
            try:
                preorder = await harvest_preorder_repository.find_one({
                    "_id": ObjectId(data.preorderId),
                    "customerId": ObjectId(customer_id),
                    "deletedAt": None,
                })
            except Exception:
                preorder = None
            if not preorder:
                raise OrderCreationError("Pre-order not found or does not belong to this customer.")
            if preorder.get("status") not in ("ready_for_confirmation", "confirmed"):
                raise OrderCreationError("This pre-order is not ready for checkout.")
            if not preorder.get("productId"):
                raise OrderCreationError("The harvested product is not available for this pre-order yet.")
            if preorder.get("orderId"):
                raise OrderCreationError("This pre-order has already been converted to an order.")
        items_data = []
        subtotal = 0
        farmer_id = None
        warehouse_id = None
        warehouse_selection = None
        fulfillment_method = (
            data.fulfillmentMethod.value
            if hasattr(data.fulfillmentMethod, "value")
            else str(data.fulfillmentMethod)
            if data.fulfillmentMethod
            else None
        )
        if fulfillment_method not in (FulfillmentMethod.FARM_DIRECT.value, FulfillmentMethod.WAREHOUSE.value):
            fulfillment_method = None
        order_farmer_ids = set()
        is_bulk_order = False
        bulk_discount_applied = 0
        farm_address = None
        pickup_instructions = None
        
        for item in data.items:
            if preorder:
                if str(item.productId) != str(preorder.get("productId")):
                    raise OrderCreationError("A pre-order can only be checked out for its linked harvested product.")
                if float(item.quantity) != float(preorder.get("quantityKg", 0) or 0):
                    raise OrderCreationError(
                        f"Pre-order quantity must be exactly {float(preorder.get('quantityKg', 0) or 0):g} kg."
                    )
            product = await product_repository.get_by_id(item.productId)
            if not product:
                raise ProductNotFoundError(item.productId)
            if preorder and (
                product.get("isActive") is not True
                or product.get("qualityStatus") != "approved"
            ):
                raise OrderCreationError("This pre-order is waiting for final quality approval.")
            
            variant_inventory = None
            if item.variantId:
                variant_inventory = await inventory_repository.get_by_id(item.variantId)
                if (
                    not variant_inventory
                    or str(variant_inventory.get("product_id")) != str(item.productId)
                    or variant_inventory.get("is_active", True) is False
                ):
                    raise OrderCreationError(
                        f"Invalid or inactive variant {item.variantId} for product {item.productId}"
                    )
                available = int(
                    variant_inventory.get("total_stock", variant_inventory.get("quantity", 0)) or 0
                ) - int(variant_inventory.get("reserved_stock", 0) or 0) - int(
                    variant_inventory.get("sold_stock", 0) or 0
                )
            else:
                available = await inventory_service.get_available_stock(item.productId)
            if not preorder and available < item.quantity:
                raise InsufficientStockError(item.productId, item.quantity, available)
            if preorder:
                reserved_stock = float((variant_inventory or {}).get("reserved_stock", 0) or 0) if variant_inventory else float(
                    (await inventory_repository.get_by_product_id(item.productId) or {}).get("reserved_stock", 0) or 0
                )
                if reserved_stock + 0.0001 < float(item.quantity):
                    raise InsufficientStockError(item.productId, item.quantity, reserved_stock)
            
            product_farmer_id = str(product["farmerId"])
            order_farmer_ids.add(product_farmer_id)
            if len(order_farmer_ids) > 1:
                raise OrderCreationError(
                    "Products from different farmers must be checked out separately."
                )
            farmer_id = product_farmer_id
            if fulfillment_method == FulfillmentMethod.WAREHOUSE.value:
                # Select the nearest suitable warehouse from the farm location.
                origin = await _resolve_tracking_origin({
                    "farmerId": farmer_id,
                    "items": [{
                        "productId": str(item.productId),
                        "farmAddress": product.get("farmAddress") or "",
                        "farmCity": product.get("farmCity") or "",
                        "farmState": product.get("farmState") or "",
                        "farmPincode": product.get("farmPincode") or "",
                    }],
                })
                storage_type = product.get("storageType") or product.get("storage_type") or (product.get("attributes") or {}).get("storageType")
                from app.services.warehouse_service import WarehouseService
                selected = await WarehouseService.find_best_warehouse(
                    origin, required_capacity=float(item.quantity or 0), storage_type=storage_type
                ) if origin else None
                if not selected:
                    raise OrderCreationError("Warehouse fulfillment was selected, but no suitable nearby warehouse has enough capacity and compatible storage.")
                warehouse_id = str(selected["_id"])
                warehouse_selection = {
                    "warehouseId": warehouse_id,
                    "warehouseName": selected.get("name"),
                    "distanceKm": selected.get("selectionDistanceKm"),
                    "availableCapacity": selected.get("availableCapacity"),
                    "reason": selected.get("selectionReason"),
                }
            
            min_bulk = product.get("minBulkQty", 0)
            bulk_price = product.get("bulkPrice")
            bulk_discount_pct = product.get("bulkDiscountPercent", 0)

            # Server-side price integrity check. For a harvest pre-order,
            # the originally agreed pre-order price is authoritative.
            catalog_price = float(
                (variant_inventory or {}).get("price")
                or product.get("price")
                or 0
            )
            requested_price = float(item.unitPrice or 0)
            preorder_price = float(preorder.get("unitPricePerKg", 0) or 0) if preorder else 0
            if preorder:
                base_unit_price = preorder_price
            else:
                if catalog_price > 0 and requested_price < catalog_price * 0.99:
                    raise OrderCreationError(
                        f"Price mismatch for product {item.productId}: "
                        f"requested {requested_price}, catalog price {catalog_price}"
                    )
                base_unit_price = catalog_price if catalog_price > 0 else requested_price

            effective_unit_price = base_unit_price
            if min_bulk > 0 and item.quantity >= min_bulk:
                is_bulk_order = True
                if bulk_price and bulk_price > 0:
                    effective_unit_price = bulk_price
                elif bulk_discount_pct > 0:
                    effective_unit_price = base_unit_price * (1 - bulk_discount_pct / 100)
                    bulk_discount_applied += (base_unit_price - effective_unit_price) * item.quantity
            elif requested_price != base_unit_price:
                # Client sent a value equal-to/higher than catalog: use catalog
                # as the authoritative figure so pricing can never drift.
                effective_unit_price = base_unit_price
            
            item_total = effective_unit_price * item.quantity
            subtotal += item_total
            
            items_data.append({
                "productId": ObjectId(item.productId),
                "variantId": ObjectId(item.variantId) if item.variantId else None,
                "productName": product["name"],
                "quantity": item.quantity,
                "unitPrice": effective_unit_price,
                "batchId": str(product.get("batchId")) if product.get("batchId") else None,
                "harvestedAt": product.get("harvestedAt"),
                "harvestDate": product.get("harvestDate"),
                "expectedShelfLifeHours": product.get("expectedShelfLifeHours"),
                "expiryDate": product.get("expiryDate"),
                "expiresAt": product.get("expiresAt"),
                "safeDeliveryDate": product.get("safeDeliveryDate"),
                "shelfLifeDays": product.get("shelfLifeDays"),
                "masterCropId": str(product.get("masterCropId")) if product.get("masterCropId") else None,
                "originalUnitPrice": base_unit_price,
                "totalPrice": item_total,
                "attributes": product.get("attributes", {}),
                "pickupAvailable": product.get("pickupAvailable", False),
                "farmAddress": product.get("farmAddress", ""),
            })
            
            if data.deliveryType == DeliveryType.PICKUP:
                farm_address = product.get("farmAddress") or farm_address
                pickup_instructions = product.get("pickupInstructions") or pickup_instructions
        
        if not farmer_id:
            raise OrderCreationError("No farmer associated with the products in this order")
        
        delivery_address = None
        if data.deliveryType == DeliveryType.DELIVERY:
            if not data.deliveryAddressId:
                raise OrderCreationError("Delivery address is required for delivery orders")
            address = await address_repository.get_address_by_id(
                data.deliveryAddressId,
                customer_id
            )
            if not address:
                raise AddressNotFoundError(data.deliveryAddressId)
            location = address.get("location")
            if not location:
                location = await geocode_address(address)
            delivery_address = {
                "addressLine1": address.get("address_line1") or address.get("addressLine1", ""),
                "addressLine2": address.get("address_line2") or address.get("addressLine2"),
                "city": address.get("city", ""),
                "state": address.get("state", ""),
                "zipCode": address.get("zip_code") or address.get("zipCode", ""),
                "country": address.get("country", ""),
                "location": location
            }
        
        discount = 0
        if data.couponCode:
            coupon = await coupon_repository.get_by_code(data.couponCode)
            if coupon and coupon.get("status") == "active":
                is_valid = await coupon_repository.validate_coupon(
                    data.couponCode,
                    customer_id,
                    subtotal
                )
                if is_valid:
                    discount = await coupon_repository.calculate_discount(
                        data.couponCode,
                        subtotal
                    )
        
        is_pickup = data.deliveryType == DeliveryType.PICKUP
        delivery_charge = 0
        delivery_details = None
        if not is_pickup:
            from app.services.delivery_fee_service import delivery_fee_service
            origin = await _resolve_tracking_origin({
                "farmerId": farmer_id,
                "items": items_data,
            })
            weight_kg = float(sum(it.get("quantity", 0) or 0 for it in items_data))
            # Customer checkout no longer submits a legacy deliveryMethod field.
            # Delivery Partner is a downstream transport option, not a third
            # fulfillment route. Use the selected fulfillment route only to
            # determine the initial delivery-fee schedule.
            delivery_method = "partner" if fulfillment_method == FulfillmentMethod.WAREHOUSE.value else "farmer"
            quote = await delivery_fee_service.calculate_delivery_fee(
                from_location=origin,
                to_location=(delivery_address or {}).get("location"),
                weight_kg=weight_kg,
                method=delivery_method,
                order_amount=subtotal,
            )
            delivery_charge = quote["fee"]
            delivery_details = {
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
            }
        if is_pickup:
            # Farm pickup: the customer pays only the product value. The platform
            # commission (PICKUP_COMMISSION_RATE) is taken out of the farmer's
            # settlement instead of being added on top of the customer's bill.
            platform_fee = 0
            total_amount = subtotal - discount
            platform_commission = round(subtotal * settings.PICKUP_COMMISSION_RATE, 2)
        else:
            platform_fee = subtotal * 0.05
            total_amount = subtotal + delivery_charge + platform_fee - discount
            platform_commission = platform_fee
        
        # Delivery mode is derived from the server-side timing/availability
        # decision. The client may request Fastest, but it can never force a
        # 30-minute promise when the service window, partner availability, or
        # end-to-end ETA does not support it.
        delivery_speed = "standard"
        delivery_availability = None
        fastest = {"eligible": False, "estimatedMinutes": None, "reason": None}
        if not is_pickup:
            delivery_availability = await get_delivery_service_availability(
                destination=(delivery_address or {}).get("location")
            )
            fastest = estimate_fastest_eligibility(
                distance_km=(delivery_details or {}).get("distanceKm") if delivery_details else None
            )

            if (
                delivery_availability.get("status") == "available"
                and delivery_availability.get("partnerAvailable")
                and fastest.get("eligible")
            ):
                # Active window + suitable partner + complete ETA <= 30 min.
                delivery_speed = "fastest_30m"

            if delivery_details is not None:
                delivery_details["serviceAvailable"] = bool(delivery_availability.get("serviceAvailable"))
                delivery_details["partnerAvailable"] = bool(delivery_availability.get("partnerAvailable"))
                delivery_details["availablePartnerCount"] = int(delivery_availability.get("availablePartnerCount", 0) or 0)
                delivery_details["fastestEligible"] = bool(fastest.get("eligible"))
                delivery_details["estimatedDeliveryMinutes"] = fastest.get("estimatedMinutes")
                delivery_details["fastestReason"] = fastest.get("reason")
                delivery_details["availabilityStatus"] = delivery_availability.get("status")
                delivery_details["availabilityMessage"] = delivery_availability.get("message")
                delivery_details["nextDeliveryServiceAt"] = delivery_availability.get("nextServiceAt")
                delivery_details["deliverySpeed"] = delivery_speed

        effective_requested_delivery_date = data.requestedDeliveryDate
        effective_delivery_time_slot = data.deliveryTimeSlot
        if (
            delivery_availability
            and delivery_availability.get("nextServiceAt")
            and delivery_availability.get("status") in (
                "scheduled_for_next_service",
                "waiting_for_delivery_partner",
            )
        ):
            # No partner during the active window still accepts the order, but
            # the requested delivery time is moved to the next available
            # handoff. Outside 21:30–06:00 this is the next 06:00 service start.
            next_available = delivery_availability.get("nextServiceAt")
            effective_requested_delivery_date = next_available
            effective_delivery_time_slot = "next_available"

        order_data = {
            "customerId": ObjectId(customer_id),
            "idempotencyKey": data.idempotencyKey,
            "preorderId": ObjectId(data.preorderId) if data.preorderId else None,
            "farmerId": ObjectId(farmer_id),
            "warehouseId": ObjectId(warehouse_id) if fulfillment_method == FulfillmentMethod.WAREHOUSE.value and warehouse_id else None,
            "warehouseSelection": warehouse_selection,
            "fulfillmentMethod": fulfillment_method,
            "fulfillmentStage": FulfillmentStage.PENDING.value,
            "fulfillmentRouteSelected": False,
            "items": items_data,
            "subtotal": subtotal,
            "deliveryCharge": delivery_charge,
            "platformFee": platform_fee,
            "platformCommission": platform_commission,
            "discount": discount,
            "totalAmount": total_amount,
            "paymentMethod": data.paymentMethod.value,
            "paymentStatus": PaymentStatus.PENDING.value,
            "orderStatus": OrderStatus.PENDING.value,
            "deliveryAddress": delivery_address,
            "specialInstructions": data.specialInstructions,
            "couponCode": data.couponCode,
            "deliveryType": data.deliveryType.value,
            # Keep a derived legacy field for existing order consumers; never
            # read deliveryMethod from OrderCreate because that field was removed.
            "deliveryMethod": delivery_method,
            "pickupDate": data.pickupDate,
            "pickupTimeSlot": data.pickupTimeSlot,
            "requestedDeliveryDate": effective_requested_delivery_date,
            "deliveryTimeSlot": effective_delivery_time_slot,
            "deliverySpeed": delivery_speed,
            "deliveryAvailabilityStatus": (delivery_availability or {}).get("status"),
            "deliveryAvailabilityMessage": (delivery_availability or {}).get("message"),
            "nextDeliveryServiceAt": (delivery_availability or {}).get("nextServiceAt"),
            "estimatedDeliveryMinutes": ((delivery_details or {}).get("estimatedDeliveryMinutes") if delivery_details else None),
            "farmAddress": farm_address,
            "pickupInstructions": pickup_instructions,
            "isBulkOrder": is_bulk_order,
            "bulkDiscountApplied": bulk_discount_applied
        }

        if delivery_details:
            order_data["deliveryDetails"] = delivery_details

        if is_pickup:
            # Persist the farm map location so pickup orders can show the
            # farmer's location on a map - the customer drives to the farm.
            farm_loc = await _resolve_tracking_origin(order_data)
            if farm_loc:
                order_data["farmLocation"] = farm_loc
        
        # Reserve inventory before creating the order so concurrent checkouts cannot
        # oversell the same stock. If order creation fails, release every
        # reservation made in this attempt.
        reserved_items = []
        try:
            for item in data.items:
                if preorder:
                    continue
                if hasattr(item, 'reservationId') and item.reservationId:
                    continue
                reserved = await inventory_repository.atomic_reserve(
                    item.productId,
                    item.quantity,
                    inventory_id=item.variantId if item.variantId else None,
                )
                if not reserved:
                    raise InsufficientStockError(
                        item.productId,
                        item.quantity,
                        await inventory_service.get_available_stock(item.productId),
                    )
                reserved_items.append((item.productId, item.quantity, item.variantId))
        except Exception:
            for product_id, quantity, inventory_id in reserved_items:
                try:
                    await inventory_repository.atomic_release(product_id, quantity, inventory_id=inventory_id)
                except Exception:
                    logger.exception("Failed to release checkout reservation for %s", product_id)
            raise

        order_id = await order_repository.create_order(order_data)
        if not order_id:
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f"Failed to create order in database. order_data keys: {list(order_data.keys())}")
            for product_id, quantity, inventory_id in reserved_items:
                try:
                    await inventory_repository.atomic_release(product_id, quantity, inventory_id=inventory_id)
                except Exception:
                    logger.exception("Failed to release checkout reservation for %s", product_id)
            raise OrderCreationError("Failed to save order to database")

        if data.couponCode and discount > 0:
            try:
                await coupon_repository.record_usage(data.couponCode, customer_id)
            except Exception as exc:
                logger.warning("Order %s created but coupon usage recording failed: %s", order_id, exc)

        # Inventory stays reserved while the order is pending.
        # Farmer confirmation is the authoritative point that converts the
        # reservation into sold stock.
        
        if preorder:
            # The normal order confirmation above consumes the pre-order's
            # existing inventory reservation. We only advance the preorder
            # lifecycle here.
            await harvest_preorder_repository.update(
                {"_id": preorder["_id"]},
                {
                    "status": "order_created",
                    "orderId": ObjectId(order_id),
                    "paymentStatus": PaymentStatus.PENDING.value,
                    "updatedAt": datetime.utcnow(),
                },
            )

        payment_intent = await PaymentService.create_payment_intent(
            order_id,
            total_amount,
            data.paymentMethod
        )

        # Calculate and persist the initial freshness/deadline snapshot. The
        # same service is refreshed again when the order becomes PACKED so the
        # delivery workflow always uses current batch freshness.
        try:
            created_order = await order_repository.get_by_id(order_id)
            if created_order:
                await calculate_order_delivery_priority(created_order, persist=True)
        except Exception:
            logger.exception("Failed to calculate initial delivery priority for order %s", order_id)
        
        await NotificationService.send_new_order_notification(
            farmer_id,
            order_id
        )
        
        order = await order_repository.get_by_id(order_id)
        order["id"] = str(order["_id"])
        order["paymentIntent"] = payment_intent
        
        return order
    
    @staticmethod
    async def get_order(order_id: str, user_id: str, role: str) -> Optional[Dict[str, Any]]:
        """Get order by ID with permission check."""
        order = await order_repository.get_by_id(order_id)
        if not order:
            logger.warning(f"Order not found: {order_id}")
            return None
        
        # Check permissions
        if role == "customer":
            cid = str(order["customerId"])
            if cid != user_id:
                logger.warning(f"Customer mismatch: order customerId={cid} != user_id={user_id}")
                return None
        elif role == "farmer":
            fid = str(order["farmerId"])
            if fid != user_id:
                logger.warning(f"Farmer mismatch: order farmerId={fid} != user_id={user_id}")
                return None
        elif role == "delivery" and str(order.get("deliveryPartnerId")) != user_id:
            return None
        elif role == "admin":
            pass  # Admin can access all
        else:
            return None
        
        # Get customer details
        from app.services.user_service import UserService
        customer = await UserService.get_user_by_id(str(order["customerId"]))
        if customer:
            order["customer"] = {
                "id": str(customer["_id"]),
                "name": f"{customer.get('firstName', '')} {customer.get('lastName', '')}",
                "phone": customer.get("phone"),
                "email": customer.get("email")
            }
        
        # Get farmer details
        farmer = await UserService.get_user_by_id(str(order["farmerId"]))
        if farmer:
            order["farmer"] = {
                "id": str(farmer["_id"]),
                "name": f"{farmer.get('firstName', '')} {farmer.get('lastName', '')}",
                "phone": farmer.get("phone")
            }
        
        if order.get("warehouseId"):
            try:
                from app.repositories.warehouse_repository import warehouse_repository
                warehouse = await warehouse_repository.get_by_id(str(order["warehouseId"]))
                if warehouse:
                    selection = order.get("warehouseSelection") or {}
                    order["warehouse"] = {
                        "id": str(warehouse["_id"]),
                        "name": warehouse.get("name"),
                        "address": warehouse.get("address") or {},
                        "distanceKm": selection.get("distanceKm"),
                        "availableCapacity": selection.get("availableCapacity"),
                        "selectionReason": selection.get("reason"),
                    }
            except Exception:
                logger.warning("Failed to resolve warehouse details for order %s", order_id)

        # Get delivery partner if assigned
        if order.get("deliveryPartnerId"):
            partner = None
            partner_profile = None
            try:
                from app.repositories.delivery_repository import delivery_repository
                partner_profile = await delivery_repository.get_by_id(str(order["deliveryPartnerId"]))
            except Exception:
                partner_profile = None

            if partner_profile:
                partner = await UserService.get_user_by_id(str(partner_profile.get("userId")))
            else:
                # Legacy records may store a user id directly
                partner = await UserService.get_user_by_id(str(order["deliveryPartnerId"]))

            if partner:
                order["deliveryPartner"] = {
                    "id": str(partner["_id"]),
                    "name": f"{partner.get('firstName', '')} {partner.get('lastName', '')}",
                    "phone": partner.get("phone")
                }
        
        # Convert ObjectId fields to strings for response serialization
        order["id"] = str(order["_id"])
        for item in order.get("items", []):
            if isinstance(item.get("productId"), ObjectId):
                item["productId"] = str(item["productId"])
            if item.get("variantId") and isinstance(item["variantId"], ObjectId):
                item["variantId"] = str(item["variantId"])

        # Delivery partner rating state (exposed to the customer only)
        if (
            role == "customer"
            and order.get("orderStatus") == "delivered"
            and order.get("deliveryPartnerId")
        ):
            from app.repositories.delivery_rating_repository import delivery_rating_repository
            rating = await delivery_rating_repository.get_by_order(order_id)
            order["deliveryRating"] = {
                "partnerId": str(order["deliveryPartnerId"]),
                "partnerName": (order.get("deliveryPartner") or {}).get("name", ""),
                "rated": bool(rating),
                "ratingId": str(rating["_id"]) if rating else None,
            }
        elif role == "customer" and order.get("orderStatus") == "delivered":
            order["deliveryRating"] = {
                "partnerId": None,
                "partnerName": "",
                "rated": False,
                "ratingId": None,
            }

        # Get status history
        status_history = order.get("statusHistory", [])
        for entry in status_history:
            changed_by = entry.get("changedBy")
            if changed_by:
                user = await UserService.get_user_by_id(changed_by)
                if user:
                    entry["changedByName"] = f"{user.get('firstName', '')} {user.get('lastName', '')}"

        # Customer delivery hand-off verification is issued once the order is ready
        # for delivery. The customer sees the 6-digit OTP and a QR containing an
        # opaque verification token; farmers/delivery partners never receive the
        # secret in their order payload and must obtain it from the customer.
        if (
            order.get("deliveryType") == DeliveryType.DELIVERY.value
            and order.get("orderStatus") in (
                OrderStatus.READY_FOR_DELIVERY.value,
                OrderStatus.DISPATCHED.value,
                OrderStatus.IN_TRANSIT.value,
            )
            and not order.get("deliveryVerificationCode")
        ):
            from app.core.security import SecurityService
            code = SecurityService.generate_otp(6)
            token = secrets.token_urlsafe(32)
            issued_at = datetime.utcnow()
            try:
                await order_repository.update(
                    {"_id": order["_id"]},
                    {
                        "deliveryVerificationCode": code,
                        "deliveryVerificationToken": token,
                        "deliveryVerificationIssuedAt": issued_at,
                        "deliveryVerificationVerifiedAt": None,
                        "deliveryVerificationMethod": None,
                        "updatedAt": issued_at,
                    },
                )
                order["deliveryVerificationCode"] = code
                order["deliveryVerificationToken"] = token
                order["deliveryVerificationIssuedAt"] = issued_at
            except Exception:
                logger.warning("Failed to issue delivery verification credentials for order %s", order_id)

        # Delivery verification credentials are customer/admin secrets.
        if role not in ("customer", "admin"):
            order.pop("deliveryVerificationCode", None)
            order.pop("deliveryVerificationToken", None)

        # The pickup verification code is shown to the CUSTOMER so they can
        # present it at the farm. Farmers must enter it themselves to confirm
        # the hand-off, so it is hidden from their view.
        if role not in ("customer", "admin"):
            order.pop("pickupCode", None)

        # Farm pickup: expose the farm map location so the customer can
        # navigate to the farm. Resolves and persists it for legacy orders.
        if (
            order.get("deliveryType") == DeliveryType.PICKUP.value
            and not order.get("farmLocation")
        ):
            try:
                farm_loc = await _resolve_tracking_origin(order)
            except Exception:
                farm_loc = None
            if farm_loc:
                order["farmLocation"] = farm_loc
                try:
                    await order_repository.update_order_field(
                        order_id, "farmLocation", farm_loc
                    )
                except Exception:
                    logger.warning("Failed to persist farmLocation for order %s", order_id)

        # Farm pickup: if the order is ready for pickup but has no code (e.g. a
        # legacy order), issue one now so the customer's QR always renders.
        if (
            order.get("deliveryType") == DeliveryType.PICKUP.value
            and order.get("orderStatus") == OrderStatus.READY_FOR_PICKUP.value
            and not order.get("pickupCode")
        ):
            from app.core.security import Security
            code = Security.generate_otp(6)
            try:
                await order_repository.update_order_field(order_id, "pickupCode", code)
                order["pickupCode"] = code
            except Exception:
                logger.warning("Failed to issue pickupCode for order %s", order_id)

        order["id"] = str(order["_id"])
        return order

    @staticmethod
    async def get_orders_by_user(
        user_id: str,
        role: str,
        filter_params: OrderFilterParams
    ) -> Dict[str, Any]:
        """Get orders by user role."""
        if role == "customer":
            filter_params.customerId = user_id
        elif role == "farmer":
            filter_params.farmerId = user_id
        elif role == "delivery":
            filter_params.deliveryPartnerId = user_id
        elif role != "admin":
            return {"orders": [], "total": 0}
        
        orders, total = await order_repository.get_orders_by_filters(filter_params)
        
        if orders:
            from app.repositories.warehouse_repository import warehouse_repository
            for order in orders:
                if order.get("warehouseId"):
                    try:
                        warehouse = await warehouse_repository.get_by_id(str(order["warehouseId"]))
                        if warehouse:
                            selection = order.get("warehouseSelection") or {}
                            order["warehouse"] = {
                                "id": str(warehouse["_id"]),
                                "name": warehouse.get("name"),
                                "address": warehouse.get("address") or {},
                                "distanceKm": selection.get("distanceKm"),
                                "availableCapacity": selection.get("availableCapacity"),
                                "selectionReason": selection.get("reason"),
                            }
                    except Exception:
                        logger.warning("Failed to resolve warehouse for order list item")

        # Convert all ObjectId instances to strings for JSON serialization
        orders = _convert_objectids(orders)
        
        return {
            "orders": orders,
            "total": total,
            "page": filter_params.page,
            "limit": filter_params.limit,
            "totalPages": (total + filter_params.limit - 1) // filter_params.limit
        }
    
    @staticmethod
    async def update_order_status(
        order_id: str,
        user_id: str,
        role: str,
        data: OrderStatusUpdate
    ) -> Optional[Dict[str, Any]]:
        """Update order status with validation."""
        order = await order_repository.get_by_id(order_id)
        if not order:
            return None
        
        # Check permissions based on role and status transition
        current_status = order.get("orderStatus")
        new_status = data.status
        
        # Validate status transition
        if not await OrderService.validate_status_transition(
            current_status,
            new_status,
            role
        ):
            return None
        
        # Check permissions
        if role == "farmer" and str(order["farmerId"]) != user_id:
            return None
        elif role == "delivery":
            try:
                from app.repositories.delivery_repository import delivery_repository
                assigned_id = order.get("deliveryPartnerId")
                if assigned_id:
                    assigned_profile = await delivery_repository.get_by_id(str(assigned_id))
                    if not assigned_profile:
                        return None
                    if str(assigned_profile.get("userId")) != user_id:
                        return None
            except Exception:
                return None
        elif role == "customer" and str(order["customerId"]) != user_id:
            return None
        elif role not in ["admin", "farmer", "delivery", "customer"]:
            return None
        
        fulfillment_method = str(order.get('fulfillmentMethod') or FulfillmentMethod.FARM_DIRECT.value)
        if role == 'farmer':
            if fulfillment_method == FulfillmentMethod.WAREHOUSE.value and new_status in (
                OrderStatus.READY_FOR_DELIVERY, OrderStatus.DISPATCHED,
                OrderStatus.IN_TRANSIT, OrderStatus.DELIVERED,
            ):
                return None
            if fulfillment_method == FulfillmentMethod.FARM_DIRECT.value and new_status in (
                OrderStatus.READY_FOR_DELIVERY, OrderStatus.DISPATCHED,
            ):
                # Farmer Fulfillment can reach delivery only through the
                # Farmer Order Map. Packing alone is not a dispatch decision.
                # The map writes the distance decision and the selected
                # self-delivery/partner route before moving the order onward.
                packed = (
                    str(order.get("fulfillmentStage") or "").lower() == FulfillmentStage.PACKED.value
                    and bool(order.get("packingComplete"))
                )
                delivery_decision = str(order.get("deliveryDecision") or "").lower()
                has_route_decision = delivery_decision in {"self_delivery", "nearby", "long_distance"}
                has_delivery_owner = bool(order.get("selfDelivery") or order.get("deliveryPartnerId"))
                if not (packed and has_route_decision and has_delivery_owner):
                    return None
                # A farmer cannot manually bypass the map into dispatched.
                if new_status == OrderStatus.DISPATCHED:
                    return None

        # Additional validation for customer cancellation
        if role == "customer" and new_status == OrderStatus.CANCELLED:
            # The customer may cancel directly only while the order is in an
            # early state. This mirrors the refund engine's AUTO_CANCEL_STATUSES
            # so the eligibility shown to the customer always matches what the
            # backend will actually do. Later states (ready_for_delivery,
            # dispatched, in_transit) go through the review-based cancellation
            # refund request instead of a direct status change.
            # Customer cancellation policy:
            # pending/confirmed -> always cancellable.
            # processing -> cancellable only until packing starts.
            # Once packing has started/completed, or delivery has begun,
            # customer cancellation is blocked. Later issues use the
            # support/return/refund workflow instead.
            if current_status in (OrderStatus.PENDING, OrderStatus.CONFIRMED):
                pass
            elif current_status == OrderStatus.PROCESSING:
                fulfillment_stage = str(order.get("fulfillmentStage") or "").lower()
                packing_started = bool(
                    order.get("packingStarted")
                    or order.get("packing_started")
                    or order.get("packingStartedAt")
                    or order.get("packing_started_at")
                )
                packing_complete = bool(
                    order.get("packingComplete")
                    or order.get("packing_complete")
                    or order.get("packingCompletedAt")
                    or order.get("packing_completed_at")
                )
                if fulfillment_stage == FulfillmentStage.PACKED.value or packing_started or packing_complete:
                    return None
            else:
                return None
        
        # Customer hand-off verification is mandatory before a delivery order
        # can transition to Delivered. This applies to farmer self-delivery and
        # delivery-partner fulfillment alike; pickup orders use their own code flow.
        if new_status == OrderStatus.DELIVERED and order.get("deliveryType") == DeliveryType.DELIVERY.value:
            if not order.get("deliveryVerificationVerifiedAt"):
                return None

        # Validate self-delivery transition
        self_delivery = order.get("selfDelivery", False)
        if new_status == OrderStatus.DELIVERED and current_status == OrderStatus.READY_FOR_DELIVERY:
            if not self_delivery:
                return None
            if role not in ["farmer", "admin"]:
                return None
        
        # Prevent pickup orders from becoming ready_for_delivery
        if new_status == OrderStatus.READY_FOR_DELIVERY and order.get("deliveryType") == DeliveryType.PICKUP.value:
            return None
        # Prevent delivery orders from becoming ready_for_pickup
        if new_status == OrderStatus.READY_FOR_PICKUP and order.get("deliveryType") != DeliveryType.PICKUP.value:
            return None
        
        committed_inventory: List[tuple[str, float, Optional[str]]] = []
        if role == "farmer" and new_status == OrderStatus.CONFIRMED and not order.get("preorderId"):
            try:
                for item in order.get("items", []):
                    product_id = str(item["productId"])
                    quantity = float(item.get("quantity", 0) or 0)
                    inventory_id = str(item["variantId"]) if item.get("variantId") else None
                    confirmed = await inventory_repository.atomic_confirm(
                        product_id, quantity, inventory_id=inventory_id
                    )
                    if not confirmed:
                        raise InsufficientStockError(
                            product_id,
                            quantity,
                            await inventory_service.get_available_stock(product_id),
                        )
                    committed_inventory.append((product_id, quantity, inventory_id))
            except Exception:
                for product_id, quantity, inventory_id in committed_inventory:
                    try:
                        await inventory_repository.atomic_refund(
                            product_id, quantity, inventory_id=inventory_id
                        )
                    except Exception:
                        logger.exception("Failed to roll back inventory confirmation for order %s", order_id)
                raise

        # Update status
        success = await order_repository.update_order_status(
            order_id,
            new_status,
            user_id,
            data.note,
            data.location
        )
        
        if success:
            try:
                status_title = str(new_status.value if hasattr(new_status, "value") else new_status).replace("_", " ").title()
                await order_repository.append_tracking_event(
                    order_id,
                    f"order_status_{str(new_status.value if hasattr(new_status, 'value') else new_status).lower()}",
                    status_title,
                    data.note or f"Order status updated to {status_title}.",
                    actor_id=user_id,
                    actor_role=role,
                )
            except Exception:
                logger.exception("Failed to append status tracking event for order %s", order_id)

        if not success:
            if committed_inventory:
                for product_id, quantity, inventory_id in committed_inventory:
                    try:
                        await inventory_repository.atomic_refund(
                            product_id, quantity, inventory_id=inventory_id
                        )
                    except Exception:
                        logger.exception("Failed to roll back inventory after status update failure for order %s", order_id)
            return None

        if role == "farmer" and new_status == OrderStatus.CONFIRMED and committed_inventory:
            for product_id, quantity, _inventory_id in committed_inventory:
                try:
                    await product_repository.decrement_quantity(product_id, quantity)
                    stock = await InventoryService.get_stock(product_id)
                    if stock:
                        await broadcast_stock_update(product_id, stock)
                except Exception:
                    logger.exception("Failed to update product stock projection for %s", product_id)

        # Every time the farmer starts Processing, require an explicit
        # fulfillment-route choice. This also repairs legacy orders that were
        # previously auto-defaulted to Farmer Fulfillment.
        if role == "farmer" and new_status == OrderStatus.PROCESSING:
            await order_repository.update(
                {"_id": order["_id"]},
                {
                    "fulfillmentMethod": None,
                    "fulfillmentRouteSelected": False,
                    "fulfillmentRouteVersion": 0,
                    "deliveryResponsibility": None,
                    "fulfillmentStage": FulfillmentStage.PENDING.value,
                    "updatedAt": datetime.utcnow(),
                },
            )

        # Notify the roles affected by every authoritative status transition.
        # The actor is excluded so the user who made the change is not spammed.
        try:
            updated_order = await order_repository.get_by_id(order_id)
            if updated_order:
                await NotificationService.send_order_workflow_update(
                    updated_order,
                    status=str(new_status.value if hasattr(new_status, "value") else new_status),
                    title=f"Order #{updated_order.get('orderNumber') or order_id} status updated",
                    message=(
                        data.note
                        or f"Order #{updated_order.get('orderNumber') or order_id} is now "
                        f"{str(new_status.value if hasattr(new_status, 'value') else new_status).replace('_', ' ').title()}."
                    ),
                    actor_role=role,
                )
        except Exception as e:
            logger.warning("Failed to notify workflow roles for order %s: %s", order_id, e)

        is_pickup = order.get("deliveryType") == DeliveryType.PICKUP.value
        
        if new_status == OrderStatus.CONFIRMED:
            try:
                await NotificationService.send_order_confirmation(
                    str(order["customerId"]),
                    order_id
                )
            except Exception as e:
                logger.warning(f"Failed to send confirmation notification: {e}")
        elif new_status == OrderStatus.READY_FOR_DELIVERY and not is_pickup:
            try:
                await NotificationService.send_order_ready(
                    str(order["customerId"]),
                    order_id
                )
            except Exception as e:
                logger.warning(f"Failed to send ready notification: {e}")
        elif new_status == OrderStatus.READY_FOR_PICKUP and is_pickup:
            try:
                from app.core.security import SecurityService
                code = SecurityService.generate_otp(6)
                await order_repository.update_order_field(order_id, "pickupCode", code)
            except Exception as e:
                logger.warning(f"Failed to generate pickup code: {e}")
            try:
                await NotificationService.send_custom_notification(
                    str(order["customerId"]),
                    f"Your order is ready for pickup at the farm! {order.get('farmAddress', '')}"
                )
            except Exception as e:
                logger.warning(f"Failed to send pickup notification: {e}")
        elif new_status == OrderStatus.IN_TRANSIT and not is_pickup:
            if role == "delivery":
                try:
                    from app.repositories.delivery_repository import delivery_repository
                    partner = await delivery_repository.get_by_user_id(user_id)
                    if partner:
                        if not order.get("deliveryPartnerId"):
                            from bson import ObjectId
                            await order_repository.collection.update_one(
                                {"_id": ObjectId(order_id)},
                                {"$set": {"deliveryPartnerId": ObjectId(str(partner["_id"])), "updatedAt": datetime.utcnow()}}
                            )
                            user = await UserService.get_user_by_id(str(partner.get("userId")))
                            if user:
                                name = f"{user.get('firstName', '')} {user.get('lastName', '')}".strip()
                                await order_repository.update_order_field(order_id, "deliveryPartnerName", name)
                        user = await UserService.get_user_by_id(str(partner.get("userId")))
                        if user:
                            name = f"{user.get('firstName', '')} {user.get('lastName', '')}".strip()
                            await order_repository.update_order_field(order_id, "pickedBy", name)
                except Exception:
                    pass
            try:
                await NotificationService.send_order_in_transit(
                    str(order["customerId"]),
                    order_id
                )
            except Exception as e:
                logger.warning(f"Failed to send in-transit notification: {e}")
        elif new_status == OrderStatus.DELIVERED and not is_pickup:
            if order.get("preorderId"):
                await harvest_preorder_repository.update(
                    {"_id": ObjectId(order["preorderId"])},
                    {"status": "completed", "completedAt": datetime.utcnow(), "updatedAt": datetime.utcnow()},
                )
            try:
                from app.repositories.delivery_assignment_repository import delivery_assignment_repository
                await delivery_assignment_repository.complete_by_order_id(order_id)
            except Exception as e:
                logger.warning(f"Failed to sync assignment for delivered order {order_id}: {e}")
            try:
                payment = await payment_repository.get_by_order_id(order_id)
                if payment and payment.get("status") != PaymentStatus.PAID:
                    await payment_repository.update_payment_status(
                        str(payment["_id"]),
                        PaymentStatus.PAID
                    )
            except Exception as e:
                logger.warning(f"Failed to update payment status: {e}")
            # Inventory is converted from reservation to committed/sold stock
            # during order creation. Do not confirm it again at delivery time.
            try:
                await NotificationService.send_order_delivered(
                    str(order["customerId"]),
                    order_id
                )
            except Exception as e:
                logger.warning(f"Failed to send delivered notification: {e}")
            try:
                await NotificationService.send_order_completed(
                    str(order["farmerId"]),
                    order_id
                )
            except Exception as e:
                logger.warning(f"Failed to send completed notification: {e}")
        elif new_status == OrderStatus.PICKED_UP and is_pickup:
            if order.get("preorderId"):
                await harvest_preorder_repository.update(
                    {"_id": ObjectId(order["preorderId"])},
                    {"status": "completed", "completedAt": datetime.utcnow(), "updatedAt": datetime.utcnow()},
                )
            try:
                payment = await payment_repository.get_by_order_id(order_id)
                if payment and payment.get("status") != PaymentStatus.PAID:
                    await payment_repository.update_payment_status(
                        str(payment["_id"]),
                        PaymentStatus.PAID
                    )
            except Exception as e:
                logger.warning(f"Failed to update payment status: {e}")
            try:
                # Cash-on-pickup: finalise the payment, record the commission
                # the farmer owes the platform (recovered from future sales).
                if order.get("paymentMethod") == "cash":
                    await PaymentService._record_pickup_cod_settlement(order_id)
            except Exception as e:
                logger.warning(f"Failed to record pickup commission: {e}")
            # Inventory is already committed when the order is created.
            # Pickup completion must not increment sold stock a second time.
            try:
                await order_repository.update_order_field(order_id, "pickedUpAt", datetime.utcnow())
            except Exception as e:
                logger.warning(f"Failed to update pickedUpAt: {e}")
            try:
                await NotificationService.send_custom_notification(
                    str(order["customerId"]),
                    "Thank you for picking up your order!"
                )
            except Exception as e:
                logger.warning(f"Failed to send pickup notification: {e}")
            try:
                await NotificationService.send_order_completed(
                    str(order["farmerId"]),
                    order_id
                )
            except Exception as e:
                logger.warning(f"Failed to send completed notification: {e}")
        elif new_status == OrderStatus.CANCELLED:
            try:
                await OrderService.release_inventory(order_id)
            except Exception as e:
                logger.warning(f"Failed to release inventory: {e}")
            if order.get("preorderId"):
                try:
                    await harvest_preorder_repository.update(
                        {"_id": ObjectId(order["preorderId"])},
                        {"status": "cancelled", "cancelledReason": data.note or "Order cancelled", "updatedAt": datetime.utcnow()},
                    )
                except Exception as e:
                    logger.warning(f"Failed to update linked pre-order on cancellation: {e}")
            if order.get("paymentStatus") == PaymentStatus.PAID:
                try:
                    # Route the cancellation through the authoritative refund
                    # engine so the refund request + payout lifecycle is tracked.
                    from app.services.refund_service import RefundService
                    from app.schemas.refund import RefundRequestCreate, RefundType, RefundReason
                    refund_data = RefundRequestCreate(
                        refundType=RefundType.CANCELLATION,
                        reason=RefundReason.OTHER,
                        resolution="full_refund",
                        description=data.note or "Customer cancelled the order",
                    )
                    created = await RefundService.create_refund_request(
                        str(order["customerId"]),
                        order_id,
                        refund_data,
                        order=order,
                    )
                    if not created:
                        logger.error(
                            "Refund engine did not create a refund request for cancelled order %s",
                            order_id,
                        )
                except Exception as e:
                    # Do not fall back to the legacy direct payment refund:
                    # doing so can bypass the refund record/idempotency lifecycle
                    # and issue a duplicate provider payout after a partial
                    # refund-engine failure.
                    logger.error(
                        "Refund engine failed for cancelled order %s: %s",
                        order_id,
                        e,
                    )
            try:
                await NotificationService.send_order_cancelled(
                    str(order["customerId"]),
                    order_id,
                    data.note
                )
            except Exception as e:
                logger.warning(f"Failed to send cancellation notification: {e}")
        
        return await order_repository.get_by_id(order_id)
    
    @staticmethod
    async def get_farmer_order_availability(farmer_id: str) -> Dict[str, Any]:
        """Calculate customer demand against the farmer's current inventory.

        Pending customer orders already hold reservations. Therefore the
        quantity reserved by a specific pending order is included in that
        order's availability, while the remaining unreserved stock is shared
        across the other pending orders in deterministic order-date order.
        """
        pending = await order_repository.find_many({
            "farmerId": ObjectId(farmer_id),
            "orderStatus": OrderStatus.PENDING.value,
            "deletedAt": None,
        }, sort=[("orderDate", 1), ("_id", 1)])

        inventory = await inventory_repository.get_by_farmer(farmer_id)
        stock_by_product = {
            str(row.get("product_id")): row for row in inventory
        }

        product_rows: Dict[str, Dict[str, Any]] = {}
        for order in pending:
            for item in order.get("items", []):
                pid = str(item.get("productId"))
                qty = float(item.get("quantity", 0) or 0)
                row = product_rows.setdefault(pid, {
                    "productId": pid,
                    "productName": item.get("productName") or "Product",
                    "unit": "kg",
                    "availableQuantity": 0.0,
                    "requestedQuantity": 0.0,
                    "orderCount": 0,
                    "fulfillableQuantity": 0.0,
                    "freeQuantity": 0.0,
                    "reservedQuantity": 0.0,
                })
                row["requestedQuantity"] += qty
                row["orderCount"] += 1
                stock = stock_by_product.get(pid, {})
                row["unit"] = stock.get("unit", row["unit"])
                total = float(stock.get("total_stock", 0) or 0)
                reserved = float(stock.get("reserved_stock", 0) or 0)
                sold = float(stock.get("sold_stock", 0) or 0)
                # Pending checkout reservations are already part of the
                # reserved_stock figure. For this screen, "available to
                # pending orders" means stock not already sold; the separate
                # freeQuantity value shows stock that is not reserved at all.
                row["availableQuantity"] = max(0.0, total - sold)
                row["freeQuantity"] = max(0.0, total - reserved - sold)
                row["reservedQuantity"] = max(0.0, reserved)

        # Evaluate pending orders in deterministic creation order against
        # the stock that is actually available to all pending orders.
        # The checkout reservation is already included in total - sold, so do
        # not add pending demand a second time.
        remaining = {
            pid: float(row["availableQuantity"])
            for pid, row in product_rows.items()
        }

        order_results = []
        for order in pending:
            can_fulfill = True
            items = []
            for item in order.get("items", []):
                pid = str(item.get("productId"))
                qty = float(item.get("quantity", 0) or 0)
                available_for_order = remaining.get(pid, 0.0)
                item_ok = available_for_order + 1e-9 >= qty
                can_fulfill = can_fulfill and item_ok
                items.append({
                    "productId": pid,
                    "productName": item.get("productName") or "Product",
                    "requiredQuantity": qty,
                    "availableQuantity": available_for_order,
                    "unit": stock_by_product.get(pid, {}).get("unit", "kg"),
                    "available": item_ok,
                })
                if item_ok:
                    remaining[pid] = max(0.0, remaining.get(pid, 0.0) - qty)
            order_results.append({
                "orderId": str(order["_id"]),
                "orderNumber": order.get("orderNumber"),
                "orderDate": order.get("orderDate"),
                "canFulfill": can_fulfill,
                "items": items,
            })

        for pid, row in product_rows.items():
            row["fulfillableQuantity"] = min(
                row["requestedQuantity"], row["availableQuantity"]
            )
            row["shortageQuantity"] = max(
                0.0, row["requestedQuantity"] - row["availableQuantity"]
            )

        return {
            "products": list(product_rows.values()),
            "orders": order_results,
            "receivedOrders": len(pending),
            "fulfillableOrders": sum(1 for x in order_results if x["canFulfill"]),
            "blockedOrders": sum(1 for x in order_results if not x["canFulfill"]),
        }

    @staticmethod
    async def confirm_available_orders(farmer_id: str) -> Dict[str, Any]:
        """Confirm only pending orders whose reserved inventory is still intact."""
        availability = await OrderService.get_farmer_order_availability(farmer_id)
        confirmed = []
        blocked = []

        for result in availability["orders"]:
            if not result["canFulfill"]:
                blocked.append(result)
                continue
            try:
                updated = await OrderService.update_order_status(
                    result["orderId"],
                    farmer_id,
                    "farmer",
                    OrderStatusUpdate(status=OrderStatus.CONFIRMED),
                )
                if updated:
                    confirmed.append(result)
                else:
                    blocked.append({**result, "reason": "Order could not be confirmed"})
            except Exception as exc:
                logger.warning("Bulk confirmation failed for %s: %s", result["orderId"], exc)
                blocked.append({**result, "reason": "Order could not be confirmed"})

        return {
            "receivedOrders": availability["receivedOrders"],
            "confirmedOrders": len(confirmed),
            "blockedOrders": len(blocked),
            "confirmed": confirmed,
            "blocked": blocked,
            "products": availability["products"],
        }

    @staticmethod
    async def process_available_orders(
        farmer_id: str,
        fulfillment_method: FulfillmentMethod,
        delivery_responsibility: Optional[DeliveryResponsibility] = None,
    ) -> Dict[str, Any]:
        """Confirm eligible orders only; later workflow stages are explicit UI actions."""
        availability = await OrderService.get_farmer_order_availability(farmer_id)
        processed = []
        blocked = list(availability["orders"])

        # Only orders that passed the availability calculation enter this
        # workflow. The same explicit fulfillment decision is applied to the
        # whole batch; the system never guesses a route.
        blocked = [x for x in blocked if not x["canFulfill"]]
        eligible = [x for x in availability["orders"] if x["canFulfill"]]

        # Delivery responsibility may be deferred for Farmer Fulfillment.
        # Last-mile delivery responsibility is chosen from the Order Map after packing and before partner Dispatch.

        # Validate warehouse configuration before confirming any order. This
        # prevents a partial batch where some orders become confirmed and then
        # fail because the farmer has no warehouse configured.
        if fulfillment_method == FulfillmentMethod.WAREHOUSE:
            warehouse_id = await OrderService.get_farmer_warehouse(farmer_id)
            if not warehouse_id:
                raise ValueError("No warehouse is configured for this farmer. Configure the warehouse before processing orders.")

        for result in eligible:
            order_id = result["orderId"]
            try:
                confirmed = await OrderService.update_order_status(
                    order_id, farmer_id, "farmer",
                    OrderStatusUpdate(status=OrderStatus.CONFIRMED),
                )
                if confirmed:
                    processed.append(result)
                else:
                    blocked.append({**result, "reason": "Could not confirm order"})
            except Exception as exc:
                logger.warning("Bulk confirmation failed for %s: %s", order_id, exc)
                blocked.append({**result, "reason": str(exc)})

        return {
            "receivedOrders": availability["receivedOrders"],
            "confirmedOrders": len(processed),
            "processedOrders": len(processed),
            "blockedOrders": len(blocked),
            "processed": processed,
            "blocked": blocked,
            "products": availability["products"],
            "fulfillmentMethod": fulfillment_method.value,
            "deliveryResponsibility": delivery_responsibility.value if delivery_responsibility else None,
        }

    @staticmethod
    async def bulk_advance_farmer_orders(farmer_id: str, action: str) -> Dict[str, Any]:
        """Apply exactly one farmer workflow step to all eligible orders."""
        action = str(action).strip().lower()
        orders = await order_repository.get_by_farmer(farmer_id, 0, 500, None)
        processed, skipped = [], []

        for order in orders:
            oid = str(order["_id"])
            status = str(order.get("orderStatus") or "pending")
            route = str(order.get("fulfillmentMethod") or "")
            stage = str(order.get("fulfillmentStage") or FulfillmentStage.PENDING.value)
            try:
                updated = None
                if action == "confirm" and status == OrderStatus.PENDING.value:
                    updated = await OrderService.update_order_status(
                        oid, farmer_id, "farmer",
                        OrderStatusUpdate(status=OrderStatus.CONFIRMED)
                    )
                elif action == "process" and status == OrderStatus.CONFIRMED.value:
                    updated = await OrderService.update_order_status(
                        oid, farmer_id, "farmer",
                        OrderStatusUpdate(status=OrderStatus.PROCESSING)
                    )
                elif action in ("farmer_fulfillment", "warehouse_fulfillment") and status == OrderStatus.PROCESSING.value:
                    method = FulfillmentMethod.FARM_DIRECT if action == "farmer_fulfillment" else FulfillmentMethod.WAREHOUSE
                    updated = await OrderService.set_fulfillment_route(oid, farmer_id, "farmer", method)
                elif action == "pack" and route == FulfillmentMethod.FARM_DIRECT.value and status == OrderStatus.PROCESSING.value and stage == FulfillmentStage.PENDING.value:
                    # Actual packing quantities must be entered through the final
                    # packing endpoint; never auto-claim the ordered quantity.
                    skipped.append({"orderId": oid, "orderNumber": order.get("orderNumber"), "reason": "Actual packed quantities require the packing form"})
                elif action == "dispatch" and route == FulfillmentMethod.FARM_DIRECT.value and status == OrderStatus.PROCESSING.value and stage == FulfillmentStage.PACKED.value:
                    skipped.append({"orderId": oid, "orderNumber": order.get("orderNumber"), "reason": "Dispatch is selected in the Farmer Order Map after delivery decision"})
                if updated:
                    processed.append({"orderId": oid, "orderNumber": order.get("orderNumber")})
                else:
                    skipped.append({"orderId": oid, "orderNumber": order.get("orderNumber"), "reason": "Not eligible for this step"})
            except Exception as exc:
                logger.warning("Bulk farmer action failed for %s: %s", oid, exc)
                skipped.append({"orderId": oid, "orderNumber": order.get("orderNumber"), "reason": str(exc)})

        return {"action": action, "processedOrders": len(processed), "skippedOrders": len(skipped), "processed": processed, "skipped": skipped}

    @staticmethod
    async def bulk_run_farmer_workflow(farmer_id: str) -> Dict[str, Any]:
        """Safely run every currently eligible farmer-owned workflow step.

        Never guesses a fulfillment route. Warehouse fulfillment stops at the
        warehouse handoff because the farmer must explicitly confirm the bulk
        product is ready for collection. Farmer fulfillment may continue through
        pack and dispatch because those are explicit farmer-owned stages.
        """
        orders = await order_repository.get_by_farmer(farmer_id, 0, 500, None)
        processed, blocked = [], []

        for order in orders:
            oid = str(order["_id"])
            changed = []
            reason = None
            try:
                # Confirm -> Processing.
                if str(order.get("orderStatus")) == OrderStatus.PENDING.value:
                    updated = await OrderService.update_order_status(
                        oid, farmer_id, "farmer",
                        OrderStatusUpdate(status=OrderStatus.CONFIRMED),
                    )
                    if not updated:
                        reason = "Could not confirm order"
                    else:
                        changed.append("confirmed")
                        order = await order_repository.get_by_id(oid)
                if reason is None and str(order.get("orderStatus")) == OrderStatus.CONFIRMED.value:
                    updated = await OrderService.update_order_status(
                        oid, farmer_id, "farmer",
                        OrderStatusUpdate(status=OrderStatus.PROCESSING),
                    )
                    if not updated:
                        reason = "Could not start processing"
                    else:
                        changed.append("processing")
                        order = await order_repository.get_by_id(oid)

                route = str(order.get("fulfillmentMethod") or "")
                status = str(order.get("orderStatus") or "")
                stage = str(order.get("fulfillmentStage") or FulfillmentStage.PENDING.value)

                if reason is None and status == OrderStatus.PROCESSING.value and not route:
                    reason = "Fulfillment method required"
                elif reason is None and route == FulfillmentMethod.FARM_DIRECT.value:
                    if stage == FulfillmentStage.PENDING.value:
                        reason = "Actual packing quantities required"
                    elif stage == FulfillmentStage.PACKED.value:
                        reason = "Open Farmer Order Map for distance and delivery decision"
                    elif stage == FulfillmentStage.DISPATCHED.value:
                        reason = "Delivery route already dispatched"
                elif reason is None and route == FulfillmentMethod.WAREHOUSE.value:
                    warehouse_stage = str(order.get("warehouseFulfillmentStage") or "incoming")
                    if warehouse_stage in ("incoming", "ready_for_pickup"):
                        reason = "Farmer must confirm bulk product is ready for warehouse collection"
                    elif warehouse_stage in ("received", "quality_check", "stored", "ready_for_packing", "packing_team_assigned", "packing", "packed", "ready_for_dispatch", "delivery_decision"):
                        reason = "Warehouse owns the next fulfillment stage"
                    else:
                        reason = "Warehouse fulfillment is awaiting its next stage"
                else:
                    reason = "Order is not eligible for farmer bulk processing"

                if changed:
                    processed.append({
                        "orderId": oid,
                        "orderNumber": order.get("orderNumber"),
                        "steps": changed,
                        "stoppedAt": reason,
                    })
                elif reason:
                    blocked.append({
                        "orderId": oid,
                        "orderNumber": order.get("orderNumber"),
                        "reason": reason,
                    })
            except Exception as exc:
                logger.warning("Bulk run failed for %s: %s", oid, exc)
                blocked.append({
                    "orderId": oid,
                    "orderNumber": order.get("orderNumber"),
                    "reason": str(exc),
                })

        return {
            "processedOrders": len(processed),
            "blockedOrders": len(blocked),
            "processed": processed,
            "blocked": blocked,
        }

    @staticmethod
    async def set_fulfillment_route(
        order_id: str,
        user_id: str,
        role: str,
        fulfillment_method: FulfillmentMethod,
    ) -> Optional[Dict[str, Any]]:
        """Farmer chooses only who fulfills the order: farmer or warehouse.

        Delivery-partner transport is a downstream delivery step. It is never
        a third farmer fulfillment choice.
        """
        if role != "farmer":
            return None
        order = await order_repository.get_by_id(order_id)
        if not order or str(order.get("farmerId")) != user_id:
            return None
        if str(order.get("deliveryType") or "delivery") != DeliveryType.DELIVERY.value:
            return None
        if str(order.get("orderStatus")) != OrderStatus.PROCESSING.value:
            return None

        fm = fulfillment_method.value if hasattr(fulfillment_method, "value") else str(fulfillment_method)
        if fm not in (FulfillmentMethod.FARM_DIRECT.value, FulfillmentMethod.WAREHOUSE.value):
            return None

        update = {
            "fulfillmentMethod": fm,
            "fulfillmentStage": FulfillmentStage.PENDING.value,
            "fulfillmentRouteSelected": True,
            "fulfillmentRouteVersion": 1,
            "deliveryResponsibility": None,
            "updatedAt": datetime.utcnow(),
        }

        try:
            updated_order = await order_repository.get_by_id(order_id)
            if updated_order:
                await NotificationService.send_order_workflow_update(
                    updated_order,
                    stage=update.get("warehouseFulfillmentStage") or update.get("fulfillmentStage"),
                    title=f"Order #{order.get('orderNumber') or order_id}: fulfillment selected",
                    message=(
                        "Warehouse fulfillment selected. The warehouse will receive a collection and packing task."
                        if fm == FulfillmentMethod.WAREHOUSE.value
                        else "Farmer fulfillment selected. The farmer will prepare and pack your order."
                    ),
                    actor_role=role,
                )
        except Exception as e:
            logger.warning("Failed to notify fulfillment selection for %s: %s", order_id, e)

        if fm == FulfillmentMethod.WAREHOUSE.value:
            update["warehouseFulfillmentStage"] = "incoming"
            warehouse_id = await OrderService.get_farmer_warehouse(user_id)
            if not warehouse_id:
                return None
            update["warehouseId"] = ObjectId(warehouse_id)

        await order_repository.update({"_id": order["_id"]}, update)
        try:
            await order_repository.append_tracking_event(
                order_id,
                "fulfillment_selected",
                "Fulfillment method selected",
                "Warehouse fulfillment selected." if fm == FulfillmentMethod.WAREHOUSE.value else "Farmer fulfillment selected.",
                actor_id=user_id,
                actor_role=role,
                metadata={"fulfillmentMethod": fm},
            )
        except Exception:
            logger.exception("Failed to append fulfillment tracking event for %s", order_id)

        if fm == FulfillmentMethod.WAREHOUSE.value:
            try:
                # Create one collection job per product/batch line. The farmer's
                # explicit Ready for Pickup action later changes these shipments
                # from scheduled -> ready_for_pickup; the warehouse never infers
                # readiness from orderStatus alone.
                from app.repositories.incoming_stock_repository import incoming_stock_repository
                from app.services.warehouse_collection_service import ensure_collection_job
                existing = await incoming_stock_repository.get_by_warehouse_id(
                    str(update["warehouseId"]), status=None, skip=0, limit=1000
                )
                existing_keys = {
                    (str(x.get("orderId")), str(x.get("productId")), str(x.get("variantId") or ""))
                    for x in existing if x.get("orderId")
                }
                for item in order.get("items", []):
                    key = (str(order["_id"]), str(item.get("productId")), str(item.get("variantId") or ""))
                    if key in existing_keys:
                        continue
                    incoming_id = await incoming_stock_repository.create_incoming({
                        "warehouseId": update["warehouseId"],
                        "productId": ObjectId(item["productId"]),
                        "variantId": ObjectId(item["variantId"]) if item.get("variantId") else None,
                        "farmerId": ObjectId(user_id),
                        "orderId": order["_id"],
                        "quantity": int(item.get("quantity", 0)),
                        "expectedDate": datetime.utcnow(),
                        "batchId": ObjectId(str(item["batchId"])) if item.get("batchId") else None,
                        "batchNumber": item.get("batchNumber"),
                        "qualityGrade": None,
                        "storageType": "ambient",
                        "packingRequired": True,
                        "sourceMode": "warehouse_fulfillment",
                        "readyForPickup": False,
                    })
                    incoming_doc = await incoming_stock_repository.get_by_id(incoming_id) if incoming_id else None
                    if incoming_doc:
                        # The job exists in scheduled state; it becomes visible
                        # as actionable Ready for Pickup only after farmer confirmation.
                        await ensure_collection_job(incoming_doc, "bulk_harvest", "warehouse_fulfillment")
            except Exception:
                logger.exception("Failed to create warehouse collection work for order %s", order_id)

        return await order_repository.get_by_id(order_id)

    @staticmethod
    async def mark_warehouse_ready_for_pickup(order_id: str, farmer_id: str) -> Optional[Dict[str, Any]]:
        """Farmer confirms warehouse-fulfillment harvest/bulk stock is ready at the farm."""
        order = await order_repository.get_by_id(order_id)
        if not order or str(order.get("farmerId")) != farmer_id:
            return None
        if str(order.get("fulfillmentMethod") or "") != FulfillmentMethod.WAREHOUSE.value:
            return None
        if str(order.get("orderStatus") or "") != OrderStatus.PROCESSING.value:
            return None

        try:
            updated_order = await order_repository.get_by_id(order_id)
            if updated_order:
                await NotificationService.send_order_workflow_update(
                    updated_order,
                    stage="ready_for_pickup",
                    title=f"Order #{order.get('orderNumber') or order_id}: product ready for warehouse collection",
                    message="The farmer has prepared the product. The warehouse collection team can now schedule pickup.",
                    actor_role="farmer",
                )
        except Exception as e:
            logger.warning("Failed to notify warehouse about collection readiness for %s: %s", order_id, e)

        from app.repositories.incoming_stock_repository import incoming_stock_repository
        from app.services.warehouse_collection_service import ensure_collection_job
        incoming_items = await incoming_stock_repository.get_by_warehouse_id(
            str(order.get("warehouseId")), status=None, skip=0, limit=1000
        )
        matching = [x for x in incoming_items if str(x.get("orderId")) == str(order["_id"])]
        if not matching:
            return None

        for incoming in matching:
            if str(incoming.get("status")) not in ("scheduled", "ready_for_pickup"):
                continue
            await incoming_stock_repository.update(
                {"_id": incoming["_id"]},
                {"status": "ready_for_pickup", "readyForPickupAt": datetime.utcnow(), "updatedAt": datetime.utcnow()},
            )
            # Promote the existing warehouse collection job only after the
            # farmer has explicitly confirmed that the shipment is ready.
            from app.repositories.warehouse_collection_repository import warehouse_collection_repository
            collection_job = await warehouse_collection_repository.get_by_incoming(str(incoming["_id"]))
            if collection_job:
                await warehouse_collection_repository.update_job(str(collection_job["_id"]), {
                    "status": "ready_for_pickup",
                    "readyForPickup": True,
                    "readyAt": datetime.utcnow(),
                })
            refreshed = await incoming_stock_repository.get_by_id(str(incoming["_id"]))
            if refreshed:
                await ensure_collection_job(refreshed, "bulk_harvest", "warehouse_fulfillment")

        await order_repository.update(
            {"_id": order["_id"]},
            {
                "warehouseFulfillmentStage": "pickup_requested",
                "warehouseCollectionStatus": "ready_for_pickup",
                "warehouseCollectionRequestedAt": datetime.utcnow(),
                "updatedAt": datetime.utcnow(),
            },
        )
        try:
            await order_repository.append_tracking_event(
                order_id,
                "warehouse_pickup_requested",
                "Product ready for warehouse pickup",
                "The farmer has confirmed that the bulk product is ready for collection.",
                actor_id=farmer_id,
                actor_role="farmer",
            )
        except Exception:
            logger.exception("Failed to append pickup tracking event for %s", order_id)
        return await order_repository.get_by_id(order_id)

    @staticmethod
    async def set_delivery_responsibility(
        order_id: str,
        user_id: str,
        role: str,
        responsibility: DeliveryResponsibility,
    ) -> Optional[Dict[str, Any]]:
        """Record delivery responsibility after packing and before partner Dispatch.

        Packing and dispatch are already complete when this method is used.
        The physical partner route (Nearby or Long Distance) is selected from
        the Farmer Order Map and determines the actual pickup location.
        """
        if role != "farmer":
            return None
        order = await order_repository.get_by_id(order_id)
        if not order or str(order.get("farmerId")) != user_id:
            return None
        if str(order.get("deliveryType") or "delivery") != DeliveryType.DELIVERY.value:
            return None
        if order.get("fulfillmentMethod") != FulfillmentMethod.FARM_DIRECT.value:
            return None
        # Delivery responsibility is a post-dispatch decision only.
        if str(order.get("orderStatus")) != OrderStatus.READY_FOR_DELIVERY.value:
            return None
        if str(order.get("fulfillmentStage") or FulfillmentStage.PENDING.value) != FulfillmentStage.DISPATCHED.value:
            return None
        value = responsibility.value if hasattr(responsibility, "value") else str(responsibility)
        if value not in (
            DeliveryResponsibility.FARMER.value,
            DeliveryResponsibility.DELIVERY_PARTNER.value,
        ):
            return None

        await order_repository.update_order_field(
            order_id, "deliveryResponsibility", value
        )
        return await order_repository.get_by_id(order_id)

    @staticmethod
    @staticmethod
    @staticmethod
    async def cancel_farmer_packing_order(order_id: str, user_id: str, reason: str) -> Optional[Dict[str, Any]]:
        """Cancel a Farmer Fulfillment order during final packing and release its reserved stock."""
        order = await order_repository.get_by_id(order_id)
        if not order or str(order.get("farmerId")) != user_id:
            return None
        if str(order.get("fulfillmentMethod") or "") != FulfillmentMethod.FARM_DIRECT.value:
            return None
        if str(order.get("orderStatus") or "") != OrderStatus.PROCESSING.value:
            return None
        if str(order.get("fulfillmentStage") or FulfillmentStage.PENDING.value) != FulfillmentStage.PENDING.value:
            return None
        if order.get("packingComplete") is True:
            return None

        released = []
        for item in order.get("items") or []:
            product_id = str(item.get("productId"))
            quantity = float(item.get("quantity") or 0)
            inventory_id = str(item.get("variantId")) if item.get("variantId") else None
            if quantity <= 0:
                continue
            try:
                await inventory_repository.atomic_refund(product_id, quantity, inventory_id=inventory_id)
                released.append({"productId": product_id, "variantId": inventory_id, "quantity": quantity})
                stock = await InventoryService.get_stock(product_id)
                if stock:
                    await broadcast_stock_update(product_id, stock)
            except Exception:
                logger.exception("Failed to release reserved stock while cancelling packed order %s", order_id)

        now = datetime.utcnow()
        update = {
            "orderStatus": OrderStatus.CANCELLED.value,
            "fulfillmentStage": FulfillmentStage.PENDING.value,
            "packingComplete": False,
            "packingCancelled": True,
            "packingCancellationReason": reason,
            "cancelledAt": now,
            "cancellationReason": reason,
            "inventoryReleasedForPackingCancellation": released,
            "updatedAt": now,
        }
        payment_status = str(order.get("paymentStatus") or "").lower()
        if payment_status == PaymentStatus.PAID.value:
            update["refundStatus"] = "pending"
            update["refundRequiredAmount"] = float(order.get("totalAmount") or 0)
        await order_repository.update({"_id": order["_id"]}, update)
        updated = await order_repository.get_by_id(order_id)
        if updated:
            try:
                await NotificationService.send_order_workflow_update(
                    updated,
                    stage=OrderStatus.CANCELLED.value,
                    title=f"Order #{updated.get('orderNumber') or order_id}: cancelled during packing",
                    message=reason,
                )
            except Exception:
                logger.exception("Failed to send workflow cancellation notification for order %s", order_id)

            # Explicit customer notification: the existing notification service
            # creates an in-app ORDER notification and sends a push notification.
            customer_id = str(updated.get("customerId") or "")
            if customer_id:
                try:
                    await NotificationService.send_order_cancelled(
                        customer_id,
                        str(updated.get("orderNumber") or order_id),
                        reason,
                    )
                except Exception:
                    logger.exception("Failed to send customer cancellation notification for order %s", order_id)
        return updated
    async def prepare_farmer_delivery_label(order_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        """Return authoritative label data only after Farmer Fulfillment packing is complete."""
        order = await order_repository.get_by_id(order_id)
        if not order or str(order.get("farmerId")) != user_id:
            return None
        if str(order.get("fulfillmentMethod") or "") != FulfillmentMethod.FARM_DIRECT.value:
            return None
        if not bool(order.get("packingComplete")) or str(order.get("fulfillmentStage") or "") not in (FulfillmentStage.PACKED.value, FulfillmentStage.DISPATCHED.value):
            return None
        label_count = int(order.get("deliveryLabelPrintCount") or 0) + 1
        now = datetime.utcnow()
        await order_repository.update({"_id": order["_id"]}, {"deliveryLabelPreparedAt": now, "deliveryLabelPrintCount": label_count, "updatedAt": now})
        latest = await order_repository.get_by_id(order_id) or order
        return {"_id": latest.get("_id"), "orderNumber": latest.get("orderNumber"), "customerName": latest.get("customerName") or (latest.get("customer") or {}).get("name"), "customerPhone": latest.get("customerPhone") or (latest.get("customer") or {}).get("phone"), "deliveryAddress": latest.get("deliveryAddress") or latest.get("shippingAddress") or {}, "paymentMethod": latest.get("paymentMethod"), "totalAmount": latest.get("totalAmount"), "items": latest.get("items") or [], "deliveryLabelPreparedAt": latest.get("deliveryLabelPreparedAt"), "deliveryLabelPrintCount": label_count}
    async def finalize_farmer_packing(
        order_id: str,
        user_id: str,
        role: str,
        packed_items: List[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        """Finalize Farmer Fulfillment packing using the quantities actually packed.

        Shortages are discovered at the end of packing. Available quantity is
        kept on the order; only the unavailable quantity is cancelled. COD
        orders simply receive a lower final payable amount because no refund
        is required before delivery.
        """
        order = await order_repository.get_by_id(order_id)
        if not order or str(order.get("fulfillmentMethod") or "") != FulfillmentMethod.FARM_DIRECT.value:
            return None
        if role == "farmer" and str(order.get("farmerId")) != user_id:
            return None
        if role not in ("farmer", "admin") or order.get("fulfillmentRouteSelected") is not True:
            return None
        if str(order.get("orderStatus")) != OrderStatus.PROCESSING.value:
            return None
        stage = str(order.get("fulfillmentStage") or FulfillmentStage.PENDING.value)
        if stage != FulfillmentStage.PENDING.value:
            return None

        requested = {
            (str(x.get("productId")), str(x.get("variantId") or "")): max(0.0, float(x.get("packedQuantity") or 0))
            for x in packed_items
        }
        items = order.get("items") or []
        if not items:
            return None

        checklist = []
        updated_items = []
        cancelled_items = []
        cancelled_value = 0.0

        for item in items:
            key = (str(item.get("productId")), str(item.get("variantId") or ""))
            required = float(item.get("quantity") or 0)
            actual = min(required, requested.get(key, 0.0))
            shortage = max(0.0, required - actual)
            unit_price = float(item.get("unitPrice") or 0)
            item_copy = dict(item)

            checklist.append({
                "productId": key[0],
                "variantId": key[1] or "",
                "productName": item.get("productName") or "Product",
                "quantityRequired": required,
                "availableQuantity": actual,
                "shortageQuantity": shortage,
                "finalQuantity": actual,
                "packedQuantity": actual,
                "verified": True,
                "resolutionType": "packed" if shortage <= 0 else "shortage_cancelled",
                "resolutionStatus": "resolved",
            })

            # Persist the physical packed quantity for every surviving line.
            # This keeps the packing audit, customer-facing order, label and
            # delivery map consistent with what was actually placed in the parcel.
            item_copy["packedQuantity"] = actual
            item_copy["actualPackedQuantity"] = actual
            item_copy["quantity"] = actual
            item_copy["totalPrice"] = actual * unit_price

            if shortage > 0:
                cancelled_value += shortage * unit_price
                cancelled_items.append({
                    "productId": key[0],
                    "variantId": key[1] or None,
                    "productName": item.get("productName") or "Product",
                    "cancelledQuantity": shortage,
                    "unitPrice": unit_price,
                    "cancelledValue": shortage * unit_price,
                    "reason": "Farmer packing shortage",
                    "cancelledAt": datetime.utcnow(),
                })

            if actual > 0:
                updated_items.append(item_copy)

        # A zero-quantity line is removed from the active order and retained
        # in cancelledItems for a complete audit trail.
        final_subtotal = sum(float(i.get("totalPrice") or 0) for i in updated_items)
        original_subtotal = float(order.get("subtotal") or 0)
        original_discount = float(order.get("discount") or 0)
        final_discount = min(original_discount, final_subtotal)
        final_total = max(
            0.0,
            final_subtotal
            + float(order.get("deliveryCharge") or 0)
            + float(order.get("platformFee") or 0)
            - final_discount,
        )

        payment_method = str(order.get("paymentMethod") or "").lower()
        is_cod = payment_method in ("cash", "cod", "cash_on_delivery")
        update: Dict[str, Any] = {
            "items": updated_items,
            "subtotal": final_subtotal,
            "discount": final_discount,
            "totalAmount": final_total,
            "packingChecklist": checklist,
            "packingComplete": True,
            "packedAt": datetime.utcnow(),
            "shortageDetected": bool(cancelled_items),
            "shortageResolved": True,
            "shortageCancelledItems": cancelled_items,
            "shortageAdjustment": cancelled_value,
            "finalPayableAmount": final_total,
            "updatedAt": datetime.utcnow(),
        }

        if cancelled_items:
            update["shortageResolution"] = "cancel_unavailable_quantity"
            update["shortagePaymentHandling"] = "cod_amount_reduced" if is_cod else "refund_required"
            if not is_cod and str(order.get("paymentStatus") or "").lower() == PaymentStatus.PAID.value:
                update["refundStatus"] = "pending"
                update["refundRequiredAmount"] = cancelled_value
        else:
            update["shortageResolution"] = "none"
            update["shortagePaymentHandling"] = "none"

        # Farmer confirmation previously moved the full ordered quantity into
        # sold stock. If final packing finds a shortage, release only the
        # unavailable quantity back into inventory so stock and the final order
        # agree. This is also correct for COD because payment has not occurred.
        for cancelled in cancelled_items:
            try:
                product_id = str(cancelled["productId"])
                inventory_id = str(cancelled.get("variantId")) if cancelled.get("variantId") else None
                qty = float(cancelled.get("cancelledQuantity") or 0)
                if qty > 0:
                    await inventory_repository.atomic_refund(product_id, qty, inventory_id=inventory_id)
                    stock = await InventoryService.get_stock(product_id)
                    if stock:
                        await broadcast_stock_update(product_id, stock)
            except Exception:
                logger.exception("Failed to release shortage inventory for order %s", order_id)

        if not updated_items:
            update["fulfillmentStage"] = FulfillmentStage.PENDING.value
            update["packingComplete"] = False
            update["orderStatus"] = OrderStatus.CANCELLED.value
            update["cancellationReason"] = "All ordered products were unavailable during final packing."
        else:
            update["fulfillmentStage"] = FulfillmentStage.PACKED.value

        await order_repository.update({"_id": order["_id"]}, update)
        try:
            updated_order = await order_repository.get_by_id(order_id)
            if updated_order:
                await NotificationService.send_order_workflow_update(
                    updated_order,
                    stage=FulfillmentStage.PACKED.value,
                    title=f"Order #{updated_order.get('orderNumber') or order_id}: packing finalized",
                    message=(
                        "A packing shortage was found. Your order needs attention."
                        if cancelled_items else
                        "Your order has been fully packed and verified."
                    ),
                    actor_role=role,
                    priority=NotificationPriority.URGENT if cancelled_items else NotificationPriority.HIGH,
                )
        except Exception as e:
            logger.warning("Failed to notify roles after farmer packing for %s: %s", order_id, e)

        await order_repository.append_tracking_event(
            order_id,
            "fulfillment_shortage_cancelled" if cancelled_items else "fulfillment_packed",
            "Packing shortage resolved" if cancelled_items else "Customer order packed",
            (
                f"{len(cancelled_items)} order line(s) had a packing shortage. "
                + ("COD payable amount was reduced; no customer refund is required." if is_cod
                   else "A refund is required for the cancelled paid quantity.")
            ) if cancelled_items else "Every customer order item was packed and verified.",
            actor_id=user_id,
            actor_role=role,
            metadata={
                "itemCount": len(items),
                "packedItemCount": len(updated_items),
                "shortageLineCount": len(cancelled_items),
                "cancelledValue": cancelled_value,
                "finalPayableAmount": final_total,
                "paymentMethod": payment_method,
            },
        )
        return await order_repository.get_by_id(order_id)

    @staticmethod
    async def resolve_customer_shortage(
        order_id: str,
        user_id: str,
        shortage_id: str,
        resolution_type: str,
        approved_quantity: Optional[float] = None,
        substitute_product_id: Optional[str] = None,
        substitute_variant_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Apply a customer's decision to a warehouse packing shortage."""
        order = await order_repository.get_by_id(order_id)
        if not order or str(order.get("customerId")) != user_id:
            return None
        if str(order.get("fulfillmentMethod") or "") != FulfillmentMethod.WAREHOUSE.value:
            return None

        from app.repositories.warehouse_shortage_repository import warehouse_shortage_repository
        case = await warehouse_shortage_repository.get_by_id(shortage_id)
        if not case or str(case.get("orderId")) != order_id:
            return None
        if case.get("status") in ("resolved", "cancelled"):
            return None
        if case.get("status") not in ("customer_approval_pending", "substitution_pending", "resolution_required"):
            return None

        required = float(case.get("requiredQuantity") or 0)
        packed = float(case.get("availableQuantity") or 0)
        shortage = max(0.0, required - packed)
        if shortage <= 1e-9:
            return None

        items = [dict(x) for x in (order.get("items") or [])]
        target = next(
            (x for x in items
             if str(x.get("productId")) == str(case.get("productId"))
             and str(x.get("variantId") or "") == str(case.get("variantId") or "")),
            None,
        )
        if not target:
            return None

        approved = float(approved_quantity if approved_quantity is not None else packed)
        if approved < packed - 1e-9 or approved > required + 1e-9:
            return None

        original_total = float(order.get("totalAmount") or 0)
        payment_method = str(order.get("paymentMethod") or "").lower()
        is_cod = payment_method in ("cash", "cod", "cash_on_delivery")

        if resolution_type == "customer_approval":
            target["quantity"] = approved
            target["totalPrice"] = approved * float(target.get("unitPrice") or 0)
            items = [x for x in items if float(x.get("quantity") or 0) > 1e-9]

        elif resolution_type == "substitution_approval":
            if not substitute_product_id or not ObjectId.is_valid(substitute_product_id):
                return None
            product = await product_repository.get_by_id(substitute_product_id)
            if not product:
                return None

            # Reserve the approved substitute quantity before changing the
            # order. This prevents approving a substitute that is already out
            # of stock.
            substitute_qty = approved - packed
            if substitute_qty <= 1e-9:
                return None
            inventory_ok = await inventory_repository.atomic_confirm(
                substitute_product_id,
                substitute_qty,
                inventory_id=substitute_variant_id if substitute_variant_id else None,
            )
            if not inventory_ok:
                return None

            target["quantity"] = packed
            target["totalPrice"] = packed * float(target.get("unitPrice") or 0)
            substitute_variant = None
            if substitute_variant_id and ObjectId.is_valid(substitute_variant_id):
                variants = product.get("variants") or []
                substitute_variant = next((v for v in variants if str(v.get("_id")) == substitute_variant_id), None)

            substitute_price = float(
                (substitute_variant or {}).get("price")
                or product.get("price")
                or product.get("sellingPrice")
                or 0
            )
            items.append({
                "productId": ObjectId(substitute_product_id),
                "variantId": ObjectId(substitute_variant_id) if substitute_variant_id and ObjectId.is_valid(substitute_variant_id) else None,
                "productName": product.get("name") or target.get("productName") or "Substitute product",
                "productImage": product.get("image") or product.get("images", [None])[0],
                "quantity": substitute_qty,
                "unitPrice": substitute_price,
                "totalPrice": substitute_qty * substitute_price,
                "isSubstitution": True,
                "substitutedForProductId": ObjectId(str(case.get("productId"))),
                "shortageCaseId": ObjectId(shortage_id),
            })
        else:
            return None

        subtotal = sum(float(x.get("totalPrice") or 0) for x in items)
        discount = min(float(order.get("discount") or 0), subtotal)
        final_total = max(
            0.0,
            subtotal + float(order.get("deliveryCharge") or 0)
            + float(order.get("platformFee") or 0) - discount,
        )

        await warehouse_shortage_repository.update_case(shortage_id, {
            "status": "resolved",
            "resolutionType": resolution_type,
            "approvedQuantity": approved,
            "remainingShortage": 0,
            "resolvedAt": datetime.utcnow(),
            "customerApprovedAt": datetime.utcnow(),
            "customerApprovedBy": ObjectId(user_id),
        })

        active_cases = await warehouse_shortage_repository.get_by_warehouse(
            str(case.get("warehouseId")), status=None, limit=1000
        )
        remaining_cases = [
            x for x in active_cases
            if str(x.get("orderId")) == order_id
            and x.get("status") not in ("resolved", "cancelled")
        ]
        all_resolved = len(remaining_cases) == 0

        await order_repository.update(
            {"_id": order["_id"]},
            {
                "items": items,
                "subtotal": subtotal,
                "discount": discount,
                "totalAmount": final_total,
                "finalPayableAmount": final_total,
                "shortageResolutionRequired": not all_resolved,
                "shortageResolved": all_resolved,
                "warehouseFulfillmentStage": "ready_for_packing" if all_resolved else "shortage_pending",
                "customerShortageDecision": resolution_type,
                "updatedAt": datetime.utcnow(),
            },
        )

        # If a paid order becomes cheaper after the customer's decision,
        # issue only the difference; COD simply uses the new final payable.
        refund_amount = max(0.0, original_total - final_total)
        refund_id = None
        if refund_amount > 0.01 and not is_cod and str(order.get("paymentStatus") or "").lower() == PaymentStatus.PAID.value:
            refund_id = await PaymentService.process_refund(order_id, refund_amount)
            if refund_id:
                await order_repository.update(
                    {"_id": order["_id"]},
                    {"refundStatus": "completed", "refundRequiredAmount": refund_amount, "shortageRefundId": refund_id},
                )
            else:
                await order_repository.update(
                    {"_id": order["_id"]},
                    {"refundStatus": "pending", "refundRequiredAmount": refund_amount},
                )

        try:
            updated_order = await order_repository.get_by_id(order_id)
            if updated_order:
                await NotificationService.send_order_workflow_update(
                    updated_order,
                    stage="ready_for_packing" if all_resolved else "shortage_pending",
                    title=f"Order #{updated_order.get('orderNumber') or order_id}: customer decision received",
                    message=(
                        "The customer resolved the packing shortage. Warehouse packing can continue."
                        if all_resolved
                        else "The customer resolved one shortage, but other shortage decisions are still required."
                    ),
                    actor_role="customer",
                    priority=NotificationPriority.HIGH if all_resolved else NotificationPriority.URGENT,
                )
        except Exception as e:
            logger.warning("Failed to notify roles after customer shortage decision for %s: %s", order_id, e)

        await order_repository.append_tracking_event(
            order_id,
            "customer_shortage_resolved",
            "Customer approved shortage resolution",
            "The customer decision was recorded and the order returned to warehouse packing.",
            actor_id=user_id,
            actor_role="customer",
            metadata={
                "shortageId": shortage_id,
                "resolutionType": resolution_type,
                "approvedQuantity": approved,
                "refundAmount": refund_amount,
                "refundId": refund_id,
            },
        )

        from app.services.warehouse_service import WarehouseService
        await WarehouseService.ensure_order_packing_task(
            order_id, str(case.get("warehouseId"))
        )
        return await order_repository.get_by_id(order_id)

    @staticmethod
    async def update_fulfillment_stage(order_id: str, user_id: str, role: str, stage: FulfillmentStage) -> Optional[Dict[str, Any]]:
        """Farmer-direct packing lifecycle. Partner Dispatch is created by the
        Farmer Order Map after distance-based delivery decision."""
        order = await order_repository.get_by_id(order_id)
        if not order or str(order.get("fulfillmentMethod") or FulfillmentMethod.FARM_DIRECT.value) != FulfillmentMethod.FARM_DIRECT.value:
            return None
        if role == "farmer" and str(order.get("farmerId")) != user_id:
            return None
        if role not in ("farmer", "admin") or order.get("fulfillmentRouteSelected") is not True:
            return None
        current = str(order.get("fulfillmentStage") or FulfillmentStage.PENDING.value)
        target = stage.value
        allowed = {
            FulfillmentStage.PENDING.value: {FulfillmentStage.PACKED.value},
            FulfillmentStage.PACKED.value: set(),
            FulfillmentStage.DISPATCHED.value: set(),
        }
        if target not in allowed.get(current, set()) or str(order.get("orderStatus")) != OrderStatus.PROCESSING.value:
            return None
        items = order.get("items") or []
        if not items:
            return None
        if target == FulfillmentStage.PACKED.value:
            # Packing must now be finalized with actual quantities through
            # finalize_farmer_packing(). Do not silently claim all quantities
            # were packed.
            return None

        # Farmer Dispatch is intentionally NOT a direct fulfillment-stage
        # transition. It is created only after the Farmer Order Map makes the
        # delivery decision and selects a partner route.
        if target == FulfillmentStage.DISPATCHED.value:
            return None

        checklist = order.get("packingChecklist") or []
        complete = bool(order.get("packingComplete")) and len(checklist) == len(items) and all(
            float(x.get("packedQuantity") or 0) >= float(x.get("finalQuantity", x.get("quantityRequired", 0)) or 0)
            and x.get("verified") is True
            for x in checklist
        )
        if not complete or order.get("shortageDetected") and not order.get("shortageResolved"):
            return None
        update = {"fulfillmentStage": target, "updatedAt": datetime.utcnow()}
        if target == FulfillmentStage.DISPATCHED.value:
            update["orderStatus"] = OrderStatus.READY_FOR_DELIVERY.value
            update["dispatchedAt"] = datetime.utcnow()
            update["dispatchReadyChecklistComplete"] = True
        await order_repository.update({"_id": order["_id"]}, update)
        try:
            updated_order = await order_repository.get_by_id(order_id)
            if updated_order:
                await NotificationService.send_order_workflow_update(
                    updated_order,
                    status=OrderStatus.READY_FOR_DELIVERY.value,
                    stage=FulfillmentStage.DISPATCHED.value,
                    title=f"Order #{updated_order.get('orderNumber') or order_id}: dispatched",
                    message="The farmer has completed packing and dispatched your order. Delivery routing can now proceed.",
                    actor_role=role,
                )
        except Exception as e:
            logger.warning("Failed to notify roles after farmer dispatch for %s: %s", order_id, e)
        await order_repository.append_tracking_event(
            order_id,
            "fulfillment_dispatched",
            "Customer order dispatched",
            "The final packed customer order passed the dispatch gate.",
            actor_id=user_id,
            actor_role=role,
            metadata={"itemCount": len(items)},
        )
        return await order_repository.get_by_id(order_id)

    @staticmethod
    async def validate_status_transition(
        current_status: str,
        new_status: str,
        role: str
    ) -> bool:
        """Validate order status transition."""
        transitions = {
            OrderStatus.PENDING: {
                "allowed": [
                    OrderStatus.CONFIRMED,
                    OrderStatus.CANCELLED
                ],
                "allowed_roles": ["farmer", "admin", "customer"]
            },
            OrderStatus.CONFIRMED: {
                "allowed": [
                    OrderStatus.PROCESSING,
                    OrderStatus.CANCELLED
                ],
                "allowed_roles": ["farmer", "admin", "customer"]
            },
            OrderStatus.PROCESSING: {
                "allowed": [
                    OrderStatus.READY_FOR_DELIVERY,
                    OrderStatus.READY_FOR_PICKUP,
                    OrderStatus.CANCELLED
                ],
                "allowed_roles": ["farmer", "admin", "customer"]
            },
            OrderStatus.READY_FOR_DELIVERY: {
                "allowed": [
                    OrderStatus.DISPATCHED,
                    OrderStatus.DELIVERED,
                    OrderStatus.CANCELLED,
                    OrderStatus.IN_TRANSIT
                ],
                "allowed_roles": ["admin", "farmer", "delivery"]
            },
            OrderStatus.READY_FOR_PICKUP: {
                "allowed": [
                    OrderStatus.PICKED_UP,
                    OrderStatus.CANCELLED
                ],
                "allowed_roles": ["customer", "farmer", "admin"]
            },
            OrderStatus.DISPATCHED: {
                "allowed": [
                    OrderStatus.IN_TRANSIT,
                    OrderStatus.DELIVERED
                ],
                "allowed_roles": ["delivery", "admin"]
            },
            OrderStatus.IN_TRANSIT: {
                "allowed": [
                    OrderStatus.DELIVERED
                ],
                "allowed_roles": ["delivery", "admin"]
            },
            OrderStatus.DELIVERED: {
                "allowed": [],
                "allowed_roles": []
            },
            OrderStatus.PICKED_UP: {
                "allowed": [],
                "allowed_roles": []
            },
            OrderStatus.CANCELLED: {
                "allowed": [],
                "allowed_roles": []
            }
        }
        
        # Check if transition is allowed
        transition = transitions.get(current_status)
        if not transition:
            return False
        
        if new_status not in transition["allowed"]:
            return False
        
        # Check role permission
        if role not in transition["allowed_roles"]:
            return False
        
        return True
    
    @staticmethod
    async def assign_delivery_partner(order_id: str):
        order = await order_repository.get_by_id(order_id)
        if not order:
            return None
        
        from app.services.delivery_service import DeliveryService
        partner = await DeliveryService.find_nearest_partner(
            order.get("deliveryAddress", {}).get("location")
        )
        
        if partner:
            success = await order_repository.assign_delivery_partner(
                order_id,
                str(partner["_id"])
            )
            if success:
                try:
                    await NotificationService.send_delivery_assignment(
                        str(partner["_id"]),
                        order_id
                    )
                except Exception:
                    pass
                return str(partner["_id"])
        
        return None
    
    @staticmethod
    async def get_farmer_warehouse(farmer_id: str) -> Optional[str]:
        """Get farmer's preferred warehouse."""
        from app.repositories.warehouse_repository import warehouse_repository
        warehouse = await warehouse_repository.get_by_farmer_id(farmer_id)
        if warehouse:
            return str(warehouse["_id"])
        return None
    
    @staticmethod
    async def update_inventory_after_delivery(order_id: str) -> bool:
        """Update inventory after delivery (reserved → sold)."""
        order = await order_repository.get_by_id(order_id)
        if not order:
            return False
        
        for item in order.get("items", []):
            product_id = str(item["productId"])
            quantity = item["quantity"]
            
            await inventory_repository.atomic_confirm(
                product_id,
                quantity,
                inventory_id=str(item.get("variantId")) if item.get("variantId") else None,
            )
        
        return True
    
    @staticmethod
    async def release_inventory(order_id: str) -> bool:
        """Release reserved stock for pending orders or refund sold stock for confirmed orders."""
        order = await order_repository.get_by_id(order_id)
        if not order:
            return False

        all_ok = True
        for item in order.get("items", []):
            product_id = str(item["productId"])
            quantity = float(item.get("quantity", 0) or 0)
            inventory_id = str(item.get("variantId")) if item.get("variantId") else None
            released = await inventory_repository.atomic_release(
                product_id, quantity, inventory_id=inventory_id
            )
            if not released:
                released = await inventory_repository.atomic_refund(
                    product_id, quantity, inventory_id=inventory_id
                )
            all_ok = all_ok and released

        return all_ok
    
    @staticmethod
    async def get_order_summary(
        user_id: str,
        role: str,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """Get order summary for a user."""
        filter_kwargs = {}
        if role == "farmer":
            filter_kwargs["farmer_id"] = user_id
        elif role == "customer":
            filter_kwargs["customer_id"] = user_id
        else:
            return {}
        
        return await order_repository.get_order_summary(
            **filter_kwargs,
            date_from=date_from,
            date_to=date_to
        )
    
    @staticmethod
    async def track_order(order_id: str, user_id: str, role: str) -> Optional[Dict[str, Any]]:
        """Track order delivery."""
        # Get order with permission check
        order = await OrderService.get_order(order_id, user_id, role)
        if not order:
            return None
        
        # Get tracking info
        tracking = await order_repository.get_order_tracking(order_id)
        if not tracking:
            return None
        
        # Resolve destination coordinates. Legacy orders may have been created
        # without geocoded coordinates, so geocode from the stored address text
        # and persist it back so subsequent calls are instant.
        destination = (order.get("deliveryAddress") or {}).get("location")
        if destination:
            coordinates = destination.get("coordinates")
            if not (isinstance(coordinates, (list, tuple)) and len(coordinates) >= 2):
                lat = destination.get("lat", destination.get("latitude"))
                lng = destination.get("lng", destination.get("lon", destination.get("longitude")))
                if lat is not None and lng is not None:
                    destination = {"type": "Point", "coordinates": [float(lng), float(lat)]}
                else:
                    destination = None
        if not destination:
            address = order.get("deliveryAddress") or {}
            destination = await geocode_address({
                "address_line1": address.get("addressLine1", ""),
                "address_line2": address.get("addressLine2", "") or "",
                "city": address.get("city", ""),
                "state": address.get("state", ""),
                "zip_code": address.get("zipCode", "") or "",
                "country": address.get("country", ""),
            })
            if destination:
                try:
                    updated_delivery_address = dict(order.get("deliveryAddress") or {})
                    updated_delivery_address["location"] = destination
                    await order_repository.update_order_field(
                        order_id, "deliveryAddress", updated_delivery_address
                    )
                except Exception:
                    logger.warning("Failed to persist geocoded delivery address for order %s", order_id)
            else:
                logger.warning("Could not geocode delivery address for order %s", order_id)

        # Origin: prefer the delivery partner's live location, otherwise fall
        # back to the farm/pickup location so ETA still makes sense before dispatch.
        current_location = tracking.get("currentLocation")
        origin = current_location if (current_location and current_location.get("coordinates")) else None
        if not origin:
            origin = await _resolve_tracking_origin(order)

        if destination and destination.get("coordinates") and origin and origin.get("coordinates"):
            from app.repositories.delivery_repository import delivery_repository
            distance = await delivery_repository.calculate_distance(origin, destination)
            tracking["distanceRemaining"] = round(distance, 1)
            # Rough ETA assuming ~30 km/h average delivery speed
            from app.core.constants import format_eta_minutes
            tracking["eta"] = format_eta_minutes(distance * 2)

        tracking["deliveryLocation"] = destination if (destination and destination.get("coordinates")) else None
        # Customer-facing delivery hand-off state. Never expose the OTP/token
        # to delivery partners through the live tracking endpoint.
        if role in ("customer", "admin") and order.get("deliveryType") == DeliveryType.DELIVERY.value:
            tracking["deliveryVerification"] = {
                "required": order.get("orderStatus") not in (OrderStatus.DELIVERED.value, OrderStatus.CANCELLED.value, OrderStatus.REFUNDED.value),
                "verified": bool(order.get("deliveryVerificationVerifiedAt")),
                "verifiedAt": order.get("deliveryVerificationVerifiedAt"),
                "method": order.get("deliveryVerificationMethod"),
                "otp": order.get("deliveryVerificationCode"),
                "qrToken": order.get("deliveryVerificationToken"),
            }
        else:
            tracking["deliveryVerification"] = {
                "required": order.get("orderStatus") not in (OrderStatus.DELIVERED.value, OrderStatus.CANCELLED.value, OrderStatus.REFUNDED.value),
                "verified": bool(order.get("deliveryVerificationVerifiedAt")),
                "verifiedAt": order.get("deliveryVerificationVerifiedAt"),
                "method": order.get("deliveryVerificationMethod"),
            }
        tracking["lastUpdated"] = tracking.get("locationUpdatedAt") or order.get("updatedAt")

        return tracking

    @staticmethod
    async def mark_for_self_delivery(order_id: str, farmer_id: str) -> bool:
        """Mark order for farmer self-delivery."""
        order = await order_repository.get_by_id(order_id)
        if not order:
            return False
        if str(order.get("farmerId")) != farmer_id:
            return False
        if order.get("orderStatus") != OrderStatus.READY_FOR_DELIVERY.value:
            return False
        if order.get("deliveryType") == DeliveryType.PICKUP.value:
            return False
        
        success = await order_repository.update_order_field(order_id, "selfDelivery", True)
        if success:
            await NotificationService.send_custom_notification(
                str(order["customerId"]),
                f"Your order {order.get('orderNumber', '')} will be delivered directly by the farmer!"
            )
        return success
    
    @staticmethod
    async def assign_delivery_partner_to_order(order_id: str, farmer_id: str, partner_id: Optional[str] = None):
        order = await order_repository.get_by_id(order_id)
        if not order:
            return "Order not found."
        if str(order.get("farmerId")) != farmer_id:
            return "This order does not belong to you."
        if order.get("orderStatus") != OrderStatus.READY_FOR_DELIVERY.value:
            return f"Order status must be 'Ready for Delivery' (current: {order.get('orderStatus', 'unknown')})."
        if order.get("deliveryType") == DeliveryType.PICKUP.value:
            return "Only delivery orders can be assigned a partner."
        
        if not partner_id:
            from app.services.delivery_service import DeliveryService
            # Delivery partner pickup must use the route-selected handoff
            # location (local hub for Nearby/Long Distance), never the farm.ent is
            # based on the farm pickup location, not the customer destination.
            if (
                order.get("fulfillmentMethod") == FulfillmentMethod.FARM_DIRECT.value
                and order.get("deliveryResponsibility") == DeliveryResponsibility.DELIVERY_PARTNER.value
            ):
                pickup = order.get("deliveryPickupLocation") or {}
                coordinates = pickup.get("coordinates") if isinstance(pickup, dict) else None
                if not isinstance(coordinates, (list, tuple)) or len(coordinates) < 2:
                    return "Choose Nearby or Long Distance routing before assigning a delivery partner."
                location = {"lat": float(coordinates[1]), "lng": float(coordinates[0])}
            else:
                delivery_address = order.get("deliveryAddress", {})
                location = delivery_address.get("location")
            partner = await DeliveryService.find_nearest_partner(location)
            if not partner:
                await order_repository.update_order_field(order_id, "partnerRequested", True)
                return True
            partner_id = str(partner["_id"])
        
        if not await order_repository.assign_delivery_partner(order_id, partner_id):
            return "Failed to assign the selected delivery partner."
        try:
            from app.repositories.delivery_repository import delivery_repository
            partner = await delivery_repository.get_by_id(partner_id)
            if partner:
                user = await UserService.get_user_by_id(str(partner.get("userId")))
                if user:
                    name = f"{user.get('firstName', '')} {user.get('lastName', '')}".strip()
                    await order_repository.update_order_field(order_id, "deliveryPartnerName", name)
        except Exception:
            pass
        return True
    
    @staticmethod
    async def get_delivery_route_groups(farmer_id: str) -> List[Dict[str, Any]]:
        """Group farmer's pending delivery orders by delivery route/area."""
        return await order_repository.get_delivery_route_groups(farmer_id)


# Singleton instance
order_service = OrderService()
