from app.services.logistics_routing_service import classify_farmer_fulfillment_route


def test_nearby_route_requires_direct_delivery_configuration():
    assert classify_farmer_fulfillment_route(10, 15, "north", "north", True) == "nearby"
    assert classify_farmer_fulfillment_route(10, 15, "north", "north", False) == "route_review"


def test_inter_district_route_uses_delivery_district_even_within_threshold():
    assert classify_farmer_fulfillment_route(10, 15, "north", "south", False) == "inter_district"
    assert classify_farmer_fulfillment_route(10, 15, "north", "south", True) == "inter_district"
    assert classify_farmer_fulfillment_route(None, 15, "north", "south", True) == "inter_district"
    assert classify_farmer_fulfillment_route(30, 15, "north", "south", False) == "inter_district"


def test_same_district_route_requires_distance_beyond_threshold():
    assert classify_farmer_fulfillment_route(20, 15, "north", "north", False) == "same_district"
    assert classify_farmer_fulfillment_route(None, 15, "north", "north", False) == "needs_location"


def test_multi_warehouse_route_is_not_overridden_by_distance_or_delivery_mode():
    assert classify_farmer_fulfillment_route(5, 15, "north", "south", True, True) == "multi_warehouse"
