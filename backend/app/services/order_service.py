from typing import Optional, Dict, Any, List
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
    OrderFilterParams, OrderStatus, PaymentStatus, DeliveryType
)
from app.services.notification_service import NotificationService
from app.services.payment_service import PaymentService
from app.services.inventory_service import inventory_service, broadcast_stock_update, InventoryService
from app.core.config import settings
from app.repositories.reservation_repository import reservation_repository
import httpx
import logging

logger = logging.getLogger(__name__)

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

        items_data = []
        subtotal = 0
        farmer_id = None
        warehouse_id = None
        order_farmer_ids = set()
        is_bulk_order = False
        bulk_discount_applied = 0
        farm_address = None
        pickup_instructions = None
        
        for item in data.items:
            product = await product_repository.get_by_id(item.productId)
            if not product:
                raise ProductNotFoundError(item.productId)
            
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
            if available < item.quantity:
                raise InsufficientStockError(item.productId, item.quantity, available)
            
            product_farmer_id = str(product["farmerId"])
            order_farmer_ids.add(product_farmer_id)
            if len(order_farmer_ids) > 1:
                raise OrderCreationError(
                    "Products from different farmers must be checked out separately."
                )
            farmer_id = product_farmer_id
            warehouse_id = await OrderService.get_farmer_warehouse(farmer_id)
            
            min_bulk = product.get("minBulkQty", 0)
            bulk_price = product.get("bulkPrice")
            bulk_discount_pct = product.get("bulkDiscountPercent", 0)

            # Server-side price integrity check: never trust the client's price.
            # The catalog price is the floor; a client claiming a materially
            # lower unit price is tampering and the order is rejected.
            catalog_price = float(
                (variant_inventory or {}).get("price")
                or product.get("price")
                or 0
            )
            requested_price = float(item.unitPrice or 0)
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
            delivery_method = (data.deliveryMethod or "farmer").lower()
            if delivery_method not in ("farmer", "partner", "pickup"):
                delivery_method = "farmer"
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
        
        order_data = {
            "customerId": ObjectId(customer_id),
            "idempotencyKey": data.idempotencyKey,
            "farmerId": ObjectId(farmer_id),
            "warehouseId": ObjectId(warehouse_id) if warehouse_id else None,
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
            "deliveryMethod": (data.deliveryMethod or "farmer").lower(),
            "pickupDate": data.pickupDate,
            "pickupTimeSlot": data.pickupTimeSlot,
            "requestedDeliveryDate": data.requestedDeliveryDate,
            "deliveryTimeSlot": data.deliveryTimeSlot,
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

        for item in data.items:
            if hasattr(item, 'reservationId') and item.reservationId:
                await inventory_service.confirm_reservation(
                    item.reservationId, order_id
                )
            else:
                confirmed = await inventory_repository.atomic_confirm(
                    item.productId,
                    item.quantity,
                    inventory_id=item.variantId if item.variantId else None,
                )
                if not confirmed:
                    logger.error(
                        "Inventory confirmation failed for order %s, product %s",
                        order_id,
                        item.productId,
                    )
                    raise OrderCreationError(
                        f"Inventory confirmation failed for product {item.productId}"
                    )
                await product_repository.decrement_quantity(item.productId, item.quantity)
                stock = await InventoryService.get_stock(item.productId)
                if stock:
                    await broadcast_stock_update(item.productId, stock)
        
        payment_intent = await PaymentService.create_payment_intent(
            order_id,
            total_amount,
            data.paymentMethod
        )
        
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
        
        # Additional validation for customer cancellation
        if role == "customer" and new_status == OrderStatus.CANCELLED:
            # The customer may cancel directly only while the order is in an
            # early state. This mirrors the refund engine's AUTO_CANCEL_STATUSES
            # so the eligibility shown to the customer always matches what the
            # backend will actually do. Later states (ready_for_delivery,
            # dispatched, in_transit) go through the review-based cancellation
            # refund request instead of a direct status change.
            if current_status not in [
                OrderStatus.PENDING,
                OrderStatus.CONFIRMED,
                OrderStatus.PROCESSING,
                OrderStatus.READY_FOR_PICKUP,
            ]:
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
        
        # Update status
        success = await order_repository.update_order_status(
            order_id,
            new_status,
            user_id,
            data.note,
            data.location
        )
        
        if not success:
            return None
        
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
            try:
                from app.repositories.delivery_assignment_repository import delivery_assignment_repository
                await delivery_assignment_repository.complete_by_order_id(order_id)
            except Exception as e:
                logger.warning(f"Failed to sync assignment for delivered order {order_id}: {e}")
            try:
                await payment_repository.update_payment_status(
                    order_id,
                    PaymentStatus.PAID
                )
            except Exception as e:
                logger.warning(f"Failed to update payment status: {e}")
            try:
                await OrderService.update_inventory_after_delivery(order_id)
            except Exception as e:
                logger.warning(f"Failed to update inventory: {e}")
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
            try:
                await payment_repository.update_payment_status(
                    order_id,
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
            try:
                await OrderService.update_inventory_after_delivery(order_id)
            except Exception as e:
                logger.warning(f"Failed to update inventory: {e}")
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
        """Release inventory for cancelled order."""
        order = await order_repository.get_by_id(order_id)
        if not order:
            return False
        
        for item in order.get("items", []):
            product_id = str(item["productId"])
            quantity = item["quantity"]
            
            await inventory_repository.atomic_refund(
                product_id,
                quantity,
                inventory_id=str(item.get("variantId")) if item.get("variantId") else None,
            )
        
        return True
    
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
