"""Tests for the reduced-rate delivery fee engine.

The fee model is: base fee + distance fee + weight fee, floored at a minimum
(only when the distance portion is chargeable) and capped at a max. Farm pickup
is always free. These tests pin the reduced numbers so they can't drift.
"""
import pytest

from app.services.delivery_fee_service import DeliveryFeeService
from app.repositories.delivery_repository import vincenty_distance_km, _haversine_km

FARM = {"type": "Point", "coordinates": [76.9558, 11.0168]}

# Roughly 4.2 km away from FARM (coordinates from the design doc).
CUSTOMER_4KM = {"type": "Point", "coordinates": [76.9640, 11.0460]}

# ~8 km due east (1 deg longitude ~= 109 km at this latitude).
FAR_8KM = {"type": "Point", "coordinates": [77.029, 11.0168]}
# ~7 km due east.
PARTNER_7KM = {"type": "Point", "coordinates": [77.02, 11.0168]}
# ~7.5 km due east.
WEIGHT_7_5KM = {"type": "Point", "coordinates": [77.0244, 11.0168]}
# ~5.5 km due east (just past the 5 km free radius).
NEAR_5_5KM = {"type": "Point", "coordinates": [77.006, 11.0168]}


@pytest.mark.asyncio
async def test_pickup_is_free():
    quote = await DeliveryFeeService.calculate_delivery_fee(
        from_location=FARM, to_location=CUSTOMER_4KM, weight_kg=5, method="pickup"
    )
    assert quote["fee"] == 0.0
    assert quote["method"] == "pickup"


@pytest.mark.asyncio
async def test_farmer_within_free_radius_is_free():
    quote = await DeliveryFeeService.calculate_delivery_fee(
        from_location=FARM, to_location=CUSTOMER_4KM, weight_kg=0, method="farmer"
    )
    assert quote["fee"] == 0.0
    assert quote["baseFee"] == 0.0
    assert quote["distanceFee"] == 0.0


@pytest.mark.asyncio
async def test_farmer_past_free_radius_base_plus_per_km():
    # ~8 km: base 10 + (8-5)*4 = 10 + 12 = 22
    quote = await DeliveryFeeService.calculate_delivery_fee(
        from_location=FARM, to_location=FAR_8KM, weight_kg=0, method="farmer"
    )
    assert quote["baseFee"] == 10.0
    assert quote["distanceFee"] == pytest.approx(12.0, abs=1.0)
    assert quote["fee"] == pytest.approx(22.0, abs=1.0)


@pytest.mark.asyncio
async def test_minimum_fee_applied_just_past_free_radius():
    # Barely past the 5 km free radius: base 10 + 1*4 = 14 -> floored to 15.
    quote = await DeliveryFeeService.calculate_delivery_fee(
        from_location=FARM, to_location=NEAR_5_5KM, weight_kg=0, method="farmer"
    )
    assert quote["fee"] == 15.0
    assert quote["minimumApplied"] is True


@pytest.mark.asyncio
async def test_partner_distance_rate():
    # ~7 km: base 15 + 7*5 = 50
    quote = await DeliveryFeeService.calculate_delivery_fee(
        from_location=FARM, to_location=PARTNER_7KM, weight_kg=0, method="partner"
    )
    assert quote["baseFee"] == 15.0
    assert quote["distanceFee"] == pytest.approx(35.0, abs=1.0)
    assert quote["fee"] == pytest.approx(50.0, abs=1.0)


@pytest.mark.asyncio
async def test_weight_does_not_affect_fee():
    # 7.5 km / 10 kg farmer: fee is distance-only -> base 10 + (2.5*4)=10 = 20
    quote = await DeliveryFeeService.calculate_delivery_fee(
        from_location=FARM, to_location=WEIGHT_7_5KM, weight_kg=10, method="farmer"
    )
    assert quote["weightFee"] == 0.0
    assert quote["weightKg"] == 10.0
    assert quote["fee"] == pytest.approx(20.0, abs=1.0)


@pytest.mark.asyncio
async def test_weight_is_ignored_for_heavy_orders():
    # Same distance as above but much heavier -> identical fee.
    light = await DeliveryFeeService.calculate_delivery_fee(
        from_location=FARM, to_location=WEIGHT_7_5KM, weight_kg=5, method="farmer"
    )
    heavy = await DeliveryFeeService.calculate_delivery_fee(
        from_location=FARM, to_location=WEIGHT_7_5KM, weight_kg=60, method="farmer"
    )
    assert light["fee"] == heavy["fee"]


@pytest.mark.asyncio
async def test_no_coords_falls_back_to_base_fee():
    quote = await DeliveryFeeService.calculate_delivery_fee(
        from_location=None, to_location=None, weight_kg=0, method="farmer"
    )
    assert quote["fee"] == 15.0  # base 10 -> floored to minimum 15
    assert quote["distanceKm"] == 0.0
    assert quote["distanceAvailable"] is False


@pytest.mark.asyncio
async def test_same_coordinates_is_zero_distance_not_unknown():
    # Farm and customer at the same point -> valid 0 km, free within the radius,
    # flagged as available (not "Distance not available yet").
    quote = await DeliveryFeeService.calculate_delivery_fee(
        from_location=FARM, to_location=FARM, weight_kg=0, method="farmer"
    )
    assert quote["distanceKm"] == 0.0
    assert quote["distanceAvailable"] is True
    assert quote["fee"] == 0.0


@pytest.mark.asyncio
async def test_no_cap_by_default_different_distances_differ():
    # The user's bug: two very different distances both showed ₹200 because the
    # old ₹200 cap clamped them. With no cap the fee must reflect the distance.
    far_53 = {"type": "Point", "coordinates": [77.443, 11.0168]}  # ~53 km east
    far_199 = {"type": "Point", "coordinates": [78.784, 11.0168]}  # ~199 km east

    q53 = await DeliveryFeeService.calculate_delivery_fee(
        from_location=FARM, to_location=far_53, weight_kg=0, method="partner"
    )
    q199 = await DeliveryFeeService.calculate_delivery_fee(
        from_location=FARM, to_location=far_199, weight_kg=0, method="partner"
    )

    # Partner: 15 + distance*5. 53km -> ~280, 199km -> ~1011. Both differ, neither is 200.
    assert q53["distanceKm"] > 50
    assert q53["fee"] > 200
    assert q199["fee"] > q53["fee"]
    assert q53["fee"] == pytest.approx(15 + q53["distanceKm"] * 5, abs=1.0)
    assert q199["fee"] == pytest.approx(15 + q199["distanceKm"] * 5, abs=1.0)


@pytest.mark.asyncio
async def test_farmer_fee_is_linear_beyond_max_radius():
    # Farmer: base 10 + (distance - 5)*4 for ALL distances beyond the free radius
    # (no extra penalty beyond the max radius). 53km -> 10 + 48*4 = 202.
    far_53 = {"type": "Point", "coordinates": [77.443, 11.0168]}
    quote = await DeliveryFeeService.calculate_delivery_fee(
        from_location=FARM, to_location=far_53, weight_kg=0, method="farmer"
    )
    assert quote["distanceKm"] > 50
    assert quote["fee"] == pytest.approx(10 + (quote["distanceKm"] - 5) * 4, abs=1.0)
    assert quote["fee"] < 300  # linear rate, not the old 2x penalty


@pytest.mark.asyncio
async def test_cap_applies_only_when_configured(monkeypatch):
    rules = DeliveryFeeService.get_rules()
    rules["maxFee"] = 200.0

    async def fake_load_rules():
        return rules

    monkeypatch.setattr(DeliveryFeeService, "load_rules", fake_load_rules)

    very_far = {"type": "Point", "coordinates": [78.0, 12.0]}
    quote = await DeliveryFeeService.calculate_delivery_fee(
        from_location=FARM, to_location=very_far, weight_kg=50, method="partner"
    )
    assert quote["fee"] == 200.0


# ---------- Free delivery tier ----------

def _rules_with_free_delivery(min_amount: float, max_km: float):
    rules = DeliveryFeeService.get_rules()
    rules["freeDeliveryMinOrderAmount"] = min_amount
    rules["freeDeliveryMaxDistanceKm"] = max_km
    return rules


@pytest.mark.asyncio
async def test_free_delivery_disabled_by_default():
    # Tier disabled (min amount 0) even for a large basket.
    quote = await DeliveryFeeService.calculate_delivery_fee(
        from_location=FARM, to_location=FAR_8KM, weight_kg=0, method="farmer", order_amount=2000
    )
    assert quote["freeDelivery"] is False
    assert quote["fee"] > 0
    assert quote["subsidy"] == 0.0


@pytest.mark.asyncio
async def test_free_delivery_applies_within_radius(monkeypatch):
    async def fake_load_rules():
        return _rules_with_free_delivery(min_amount=999, max_km=10)

    monkeypatch.setattr(DeliveryFeeService, "load_rules", fake_load_rules)

    # Beyond the farmer's own 5 km radius but within the free-delivery max
    # distance and above the order amount -> free, subsidy recorded.
    quote = await DeliveryFeeService.calculate_delivery_fee(
        from_location=FARM, to_location=NEAR_5_5KM, weight_kg=0, method="farmer", order_amount=1200
    )
    assert quote["freeDelivery"] is True
    assert quote["fee"] == 0.0
    assert quote["subsidy"] > 0


@pytest.mark.asyncio
async def test_free_delivery_does_not_apply_below_amount(monkeypatch):
    async def fake_load_rules():
        return _rules_with_free_delivery(min_amount=999, max_km=5)

    monkeypatch.setattr(DeliveryFeeService, "load_rules", fake_load_rules)

    quote = await DeliveryFeeService.calculate_delivery_fee(
        from_location=FARM, to_location=CUSTOMER_4KM, weight_kg=0, method="farmer", order_amount=500
    )
    assert quote["freeDelivery"] is False
    assert quote["fee"] == 0.0  # still free (within the farmer's own 5 km radius)


@pytest.mark.asyncio
async def test_free_delivery_not_applied_beyond_max_distance(monkeypatch):
    async def fake_load_rules():
        return _rules_with_free_delivery(min_amount=0, max_km=5)

    monkeypatch.setattr(DeliveryFeeService, "load_rules", fake_load_rules)

    # min 0 means the tier is disabled -> no free delivery even close by.
    quote = await DeliveryFeeService.calculate_delivery_fee(
        from_location=FARM, to_location=FAR_8KM, weight_kg=0, method="farmer", order_amount=2000
    )
    assert quote["freeDelivery"] is False


# ---------- Bulk / event pricing ----------

@pytest.mark.asyncio
async def test_bulk_method_charges_base_km_and_kg():
    # All-zero defaults -> only the minimum fee applies until an admin sets rates.
    quote = await DeliveryFeeService.calculate_delivery_fee(
        from_location=FARM, to_location=FAR_8KM, weight_kg=250, method="bulk"
    )
    assert quote["method"] == "bulk"
    assert quote["fee"] == 15.0
    assert quote["weightFee"] == 0.0


@pytest.mark.asyncio
async def test_bulk_rates_apply_when_configured(monkeypatch):
    rules = DeliveryFeeService.get_rules()
    rules["bulk"]["baseFee"] = 100.0
    rules["bulk"]["perKmRate"] = 10.0
    rules["bulk"]["perKgRate"] = 1.0

    async def fake_load_rules():
        return rules

    monkeypatch.setattr(DeliveryFeeService, "load_rules", fake_load_rules)

    # ~8 km, 250 kg: 100 + 8*10 + 250*1 = 430
    quote = await DeliveryFeeService.calculate_delivery_fee(
        from_location=FARM, to_location=FAR_8KM, weight_kg=250, method="bulk"
    )
    assert quote["weightFee"] > 0
    assert quote["fee"] == pytest.approx(430.0, abs=2.0)


# ---------- Distance engine (Vincenty geodesic) ----------

@pytest.mark.asyncio
async def test_vincenty_matches_doc_distance():
    # FARM (11.0168,76.9558) -> CUSTOMER_4KM (11.0460,76.9640) is ~3.35 km.
    km = vincenty_distance_km(11.0168, 76.9558, 11.0460, 76.9640)
    assert km == pytest.approx(3.35, abs=0.1)


def test_vincenty_consistent_with_haversine_short_range():
    for lat1, lon1, lat2, lon2 in [
        (11.0168, 76.9558, 11.0460, 76.9640),  # ~4 km
        (11.0168, 76.9558, 11.0168, 77.029),   # ~8 km
        (11.0168, 76.9558, 11.0168, 77.443),   # ~53 km
    ]:
        v = vincenty_distance_km(lat1, lon1, lat2, lon2)
        h = _haversine_km(lat1, lon1, lat2, lon2)
        assert v > 0
        # Vincenty (ellipsoid) and haversine (sphere) agree closely.
        assert v == pytest.approx(h, rel=0.01)


def test_vincenty_handles_same_point():
    assert vincenty_distance_km(11.0168, 76.9558, 11.0168, 76.9558) == 0.0