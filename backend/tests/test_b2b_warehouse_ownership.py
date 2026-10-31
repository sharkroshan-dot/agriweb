from app.api.v1.b2b import (
    ORDER_DESTINATION_RECEIVED,
    ORDER_IN_TRANSIT,
    ORDER_READY_FOR_PICKUP,
    ORDER_TRANSFER_IN_TRANSIT,
    _b2b_farm_district_in_coverage,
    _district_from_doc,
    _b2b_order_visible_to_warehouse,
)


SOURCE = "source-warehouse"
DESTINATION = "destination-warehouse"


def test_ready_pickup_is_visible_only_to_farm_district_warehouse():
    order = {
        "status": ORDER_READY_FOR_PICKUP,
        "sourceWarehouseId": "stale-source",
    }

    assert _b2b_order_visible_to_warehouse(order, SOURCE, "Tiruchirappalli", "Manachanallur")
    assert not _b2b_order_visible_to_warehouse(order, DESTINATION, "Perambalur", "Tiruchirappalli")
    assert not _b2b_order_visible_to_warehouse(order, SOURCE, "Tiruchirappalli", "")


def test_ready_pickup_uses_configured_farm_collection_districts():
    order = {"status": ORDER_READY_FOR_PICKUP}

    assert _b2b_order_visible_to_warehouse(
        order,
        SOURCE,
        "Perambalur",
        "Tiruchirappalli",
        {"tiruchirappalli"},
    )
    assert not _b2b_order_visible_to_warehouse(
        order,
        DESTINATION,
        "Tiruchirappalli",
        "Tiruchirappalli",
        {"perambalur"},
    )


def test_ready_pickup_suggested_warehouse_does_not_hide_matching_district_orders():
    order = {
        "status": ORDER_READY_FOR_PICKUP,
        "pickupWarehouseId": DESTINATION,
        "sourceWarehouseId": DESTINATION,
    }

    assert _b2b_order_visible_to_warehouse(order, SOURCE, "Tiruchirappalli", "Manachanallur")
    assert not _b2b_order_visible_to_warehouse(order, DESTINATION, "Perambalur", "Tiruchirappalli")


def test_ready_pickup_resolves_string_addresses_for_multiple_farmers():
    coverage = {"perambalur", "tiruchirappalli"}
    farmer_profiles = [
        {"farmAddress": "Near Chettikulam, Perambalur, Tamil Nadu"},
        {"address": {"formattedAddress": "Manachanallur, Trichy"}},
        {"profile": {"farmAddress": "Perambalur District"}},
    ]

    districts = [
        _b2b_farm_district_in_coverage(profile, coverage)
        for profile in farmer_profiles
    ]

    assert districts == ["perambalur", "tiruchirappalli", "perambalur"]


def test_ready_pickup_uses_nested_route_source_when_farmer_location_is_missing():
    order = {
        "status": ORDER_READY_FOR_PICKUP,
        "sourceWarehouseId": "stale-source",
        "deliveryPricing": {
            "route": {"sourceWarehouseId": SOURCE},
        },
    }

    assert _b2b_order_visible_to_warehouse(order, SOURCE)
    assert not _b2b_order_visible_to_warehouse(order, DESTINATION)


def test_farm_city_localities_resolve_to_their_actual_district():
    assert _district_from_doc({"farmCity": "Manachanallur"}) == "Tiruchirappalli"
    assert _district_from_doc({"farmCity": "Tiruchirappalli"}) == "Tiruchirappalli"


def test_assigned_pickup_and_source_receipt_remain_with_source_warehouse():
    assert _b2b_order_visible_to_warehouse(
        {"status": ORDER_READY_FOR_PICKUP, "pickupTeam": "partner", "sourceWarehouseId": SOURCE},
        SOURCE,
        "Tiruchirappalli",
    )
    assert not _b2b_order_visible_to_warehouse(
        {"status": ORDER_READY_FOR_PICKUP, "pickupTeam": "partner", "sourceWarehouseId": SOURCE},
        DESTINATION,
        "Perambalur",
    )


def test_transfer_destination_gets_action_only_after_partner_arrival():
    order = {
        "status": ORDER_TRANSFER_IN_TRANSIT,
        "sourceWarehouseId": SOURCE,
        "destinationWarehouseId": DESTINATION,
    }

    assert _b2b_order_visible_to_warehouse(order, SOURCE, "Tiruchirappalli")
    assert not _b2b_order_visible_to_warehouse(order, DESTINATION, "Perambalur")

    order["transferPartnerStatus"] = "arrived_at_destination"
    assert not _b2b_order_visible_to_warehouse(order, SOURCE, "Tiruchirappalli")
    assert _b2b_order_visible_to_warehouse(order, DESTINATION, "Perambalur")


def test_destination_owns_receipt_and_final_delivery_after_transfer():
    transferred_order = {
        "status": ORDER_DESTINATION_RECEIVED,
        "sourceWarehouseId": SOURCE,
        "destinationWarehouseId": DESTINATION,
        "fulfillmentRoute": "long_distance",
    }
    assert not _b2b_order_visible_to_warehouse(transferred_order, SOURCE, "Tiruchirappalli")
    assert _b2b_order_visible_to_warehouse(transferred_order, DESTINATION, "Perambalur")

    transferred_order["status"] = ORDER_IN_TRANSIT
    assert not _b2b_order_visible_to_warehouse(transferred_order, SOURCE, "Tiruchirappalli")
    assert _b2b_order_visible_to_warehouse(transferred_order, DESTINATION, "Perambalur")
