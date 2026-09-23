from typing import Optional, Dict, Any, List
import logging

logger = logging.getLogger(__name__)

# Reduced default pricing rules. The fee is purely distance-based:
# fee = base fee + distance fee, floored at a minimum and capped at a maximum.
# Admins can override every value via the platform settings (fees section)
# without code changes.
DEFAULT_FEE_RULES: Dict[str, Any] = {
    # Farmer self-delivery
    "farmer": {
        "baseFee": 10.0,       # reduced from 20
        "freeRadiusKm": 5.0,   # unchanged
        "perKmRate": 4.0,      # reduced from 8
        "maxRadiusKm": 20.0,   # unchanged
    },
    # Delivery partner
    "partner": {
        "baseFee": 15.0,       # reduced from 30
        "perKmRate": 5.0,      # reduced from 10
    },
    # Bulk / event delivery: base + per-km + per-kg (weight-based).
    # All-zero defaults keep bulk delivery free until an admin sets rates.
    "bulk": {
        "baseFee": 0.0,
        "perKmRate": 0.0,
        "perKgRate": 0.0,
    },
    "minimumFee": 15.0,        # reduced from 30
    "maxFee": 0.0,             # safety cap; 0 = no cap (fee is the true distance rate)
    # Platform-funded free delivery tier. order_amount >= freeDeliveryMinOrderAmount
    # AND distance <= freeDeliveryMaxDistanceKm  =>  fee = 0, original fee recorded
    # as a subsidy. freeDeliveryMinOrderAmount = 0 disables the tier entirely.
    "freeDeliveryMinOrderAmount": 0.0,
    "freeDeliveryMaxDistanceKm": 5.0,
}


def _number(value: Any, default: float) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _coords(location: Optional[Dict[str, Any]]) -> Optional[List[float]]:
    """Extract [lng, lat] from a GeoJSON-style location dict."""
    if not isinstance(location, dict):
        return None
    coordinates = location.get("coordinates")
    if isinstance(coordinates, (list, tuple)) and len(coordinates) >= 2:
        try:
            return [float(coordinates[0]), float(coordinates[1])]
        except (TypeError, ValueError):
            return None
    lat = location.get("lat", location.get("latitude"))
    lng = location.get("lng", location.get("lon", location.get("longitude")))
    if lat is not None and lng is not None:
        try:
            return [float(lng), float(lat)]
        except (TypeError, ValueError):
            return None
    return None


class DeliveryFeeService:
    """Delivery fee engine.

    fee = base fee + distance fee, floored at the minimum fee (only when the
    distance portion is chargeable). Farm pickup is always free. Weight does not
    affect the fee for normal orders; the "bulk" method also adds a per-kg fee.
    The fee is the true distance-based rate with no cap by default (an admin can
    set a safety cap > 0). A platform-funded free delivery tier can zero out the
    fee (recording the original fee as a subsidy).
    """

    @staticmethod
    def get_rules() -> Dict[str, Any]:
        """Return the default fee rules (deep-copied so callers can mutate)."""
        return {
            "farmer": dict(DEFAULT_FEE_RULES["farmer"]),
            "partner": dict(DEFAULT_FEE_RULES["partner"]),
            "bulk": dict(DEFAULT_FEE_RULES["bulk"]),
            "minimumFee": DEFAULT_FEE_RULES["minimumFee"],
            "maxFee": DEFAULT_FEE_RULES["maxFee"],
            "freeDeliveryMinOrderAmount": DEFAULT_FEE_RULES["freeDeliveryMinOrderAmount"],
            "freeDeliveryMaxDistanceKm": DEFAULT_FEE_RULES["freeDeliveryMaxDistanceKm"],
        }

    @staticmethod
    async def load_rules() -> Dict[str, Any]:
        """Async variant that reads admin-configured platform fee settings."""
        rules = DeliveryFeeService.get_rules()
        try:
            from app.repositories.settings_repository import platform_settings_repository
            doc = await platform_settings_repository.get_single()
        except Exception as e:
            logger.warning("Could not load platform settings, using default fee rules: %s", e)
            return rules

        data = (doc or {}).get("data") or {}
        fees = data.get("fees") or {}
        if not isinstance(fees, dict):
            return rules

        farmer = rules["farmer"]
        partner = rules["partner"]
        bulk = rules["bulk"]
        farmer["baseFee"] = _number(fees.get("farmerBaseFee"), farmer["baseFee"])
        farmer["freeRadiusKm"] = _number(fees.get("freeDeliveryRadiusKm"), farmer["freeRadiusKm"])
        farmer["perKmRate"] = _number(fees.get("farmerPerKmRate"), farmer["perKmRate"])
        farmer["maxRadiusKm"] = _number(fees.get("maxDeliveryRadiusKm"), farmer["maxRadiusKm"])
        partner["baseFee"] = _number(fees.get("partnerBaseFee"), partner["baseFee"])
        partner["perKmRate"] = _number(fees.get("partnerPerKmRate"), partner["perKmRate"])
        bulk["baseFee"] = _number(fees.get("bulkBaseFee"), bulk["baseFee"])
        bulk["perKmRate"] = _number(fees.get("bulkPerKmRate"), bulk["perKmRate"])
        bulk["perKgRate"] = _number(fees.get("bulkPerKgRate"), bulk["perKgRate"])
        rules["minimumFee"] = _number(fees.get("minimumDeliveryFee"), rules["minimumFee"])
        rules["maxFee"] = _number(fees.get("maxDeliveryFee"), rules["maxFee"])
        rules["freeDeliveryMinOrderAmount"] = _number(
            fees.get("freeDeliveryMinOrderAmount"), rules["freeDeliveryMinOrderAmount"]
        )
        rules["freeDeliveryMaxDistanceKm"] = _number(
            fees.get("freeDeliveryMaxDistanceKm"), rules["freeDeliveryMaxDistanceKm"]
        )

        return rules

    @staticmethod
    async def calculate_delivery_fee(
        from_location: Optional[Dict[str, Any]] = None,
        to_location: Optional[Dict[str, Any]] = None,
        weight_kg: float = 0.0,
        method: str = "farmer",
        order_amount: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Compute the delivery fee and its breakdown.

        method: "pickup" (always free), "farmer" (self-delivery rules),
                "partner" (delivery-partner rules) or "bulk" (base + km + kg).

        order_amount: optional basket subtotal used by the platform-funded free
                delivery tier. If the tier is enabled and the amount qualifies,
                the fee becomes 0 and the original fee is recorded as a subsidy
                so it never disappears from the ledger.
        """
        method = (method or "farmer").lower()
        if method == "pickup":
            return {
                "method": "pickup",
                "distanceKm": 0.0,
                "weightKg": round(max(0.0, weight_kg), 2),
                "baseFee": 0.0,
                "distanceFee": 0.0,
                "weightFee": 0.0,
                "minimumApplied": False,
                "fee": 0.0,
                "freeDelivery": False,
                "subsidy": 0.0,
                "distanceAvailable": True,
            }

        rules = await DeliveryFeeService.load_rules()
        is_bulk = method == "bulk"
        method_rules = rules.get("bulk" if is_bulk else ("farmer" if method == "farmer" else "partner"), {})

        distance_km = None
        distance_available = False
        from_coords = _coords(from_location)
        to_coords = _coords(to_location)
        if from_coords and to_coords:
            distance_available = True
            if from_coords != to_coords:
                try:
                    from app.repositories.delivery_repository import delivery_repository
                    distance_km = await delivery_repository.calculate_distance(
                        {"type": "Point", "coordinates": from_coords},
                        {"type": "Point", "coordinates": to_coords},
                    )
                except Exception as e:
                    logger.warning("Distance calculation failed, using base fee only: %s", e)
                    distance_km = None
            else:
                # Same coordinates (e.g. farm and customer at the same point):
                # a valid zero distance, not "unknown".
                distance_km = 0.0

        base_fee = 0.0
        distance_fee = 0.0
        weight_fee = 0.0
        chargeable_distance = False

        if is_bulk:
            # Bulk / event pricing: vehicle base + distance + weight/load.
            base_fee = _number(method_rules.get("baseFee"), 0.0)
            if distance_km is not None:
                distance_fee = distance_km * _number(method_rules.get("perKmRate"), 0.0)
                weight_fee = max(0.0, weight_kg) * _number(method_rules.get("perKgRate"), 0.0)
                chargeable_distance = True
            else:
                chargeable_distance = True
        elif distance_km is not None:
            if method == "farmer":
                free_radius = _number(method_rules.get("freeRadiusKm"), 5.0)
                if distance_km > free_radius:
                    base_fee = _number(method_rules.get("baseFee"), 10.0)
                    distance_fee = (distance_km - free_radius) * _number(method_rules.get("perKmRate"), 4.0)
                    chargeable_distance = True
            else:
                base_fee = _number(method_rules.get("baseFee"), 15.0)
                distance_fee = distance_km * _number(method_rules.get("perKmRate"), 5.0)
                chargeable_distance = True
        else:
            # No GPS coords available: charge the base fee only so delivery is
            # never silently free.
            base_fee = _number(method_rules.get("baseFee"), 10.0)
            chargeable_distance = True

        total = base_fee + distance_fee + weight_fee
        minimum_applied = False
        if chargeable_distance:
            minimum_fee = _number(rules.get("minimumFee"), 15.0)
            if total < minimum_fee:
                total = minimum_fee
                minimum_applied = True

        # The safety cap guards the per-order (farmer/partner) fee; 0 = no cap.
        # Bulk/event rates are admin-set and can legitimately exceed it.
        if not is_bulk:
            max_fee = _number(rules.get("maxFee"), 0.0)
            if max_fee > 0 and total > max_fee:
                total = max_fee

        # Platform-funded free delivery tier (farmer self-delivery / partner only).
        free_delivery = False
        subsidy = 0.0
        if method in ("farmer", "partner"):
            free_min = _number(rules.get("freeDeliveryMinOrderAmount"), 0.0)
            free_max_km = _number(rules.get("freeDeliveryMaxDistanceKm"), 5.0)
            qualifies_amount = free_min > 0 and order_amount is not None and float(order_amount) >= free_min
            qualifies_distance = distance_km is None or distance_km <= free_max_km
            if qualifies_amount and qualifies_distance:
                free_delivery = True
                subsidy = round(total, 2)
                total = 0.0
                minimum_applied = False

        return {
            "method": method,
            "distanceKm": round(distance_km or 0.0, 2),
            "weightKg": round(max(0.0, weight_kg), 2),
            "baseFee": round(base_fee, 2),
            "distanceFee": round(distance_fee, 2),
            "weightFee": round(weight_fee, 2),
            "minimumApplied": minimum_applied,
            "fee": round(total, 2),
            "freeDelivery": free_delivery,
            "subsidy": round(subsidy, 2),
            "distanceAvailable": distance_available,
        }


delivery_fee_service = DeliveryFeeService()


async def get_partner_earning_rate() -> Optional[float]:
    """Partner's share of the delivery fee as a fraction (0..1).

    Returns None when the admin has not configured ``partnerDeliveryEarningRate``
    (percentage), in which case callers keep their existing behaviour.
    """
    try:
        from app.repositories.settings_repository import platform_settings_repository
        doc = await platform_settings_repository.get_single()
        data = (doc or {}).get("data") or {}
        fees = data.get("fees") or {}
        rate = fees.get("partnerDeliveryEarningRate")
        if rate is None:
            return None
        rate = float(rate) / 100.0
        return max(0.0, min(1.0, rate))
    except Exception as e:
        logger.warning("Could not load partner earning rate: %s", e)
        return None