from app.api.v1.b2b import (
    ORDER_DESTINATION_RECEIVED,
    ORDER_IN_TRANSIT,
    ORDER_QUALITY_CHECK,
    ORDER_READY_FOR_PICKUP,
    ORDER_TRANSFER_IN_TRANSIT,
    _b2b_farm_district_in_coverage,
    _district_from_doc,
    _b2b_order_visible_to_warehouse,
    _ensure_b2b_order_activity_history,
    _reconcile_legacy_one_off_ready_order,
    _build_recurring_ready_history,
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



def test_legacy_one_off_order_without_passed_quality_check_returns_to_confirmed():
    from datetime import datetime

    created_at = datetime(2026, 10, 31, 10, 30)
    order = {
        "status": ORDER_READY_FOR_PICKUP,
        "qualityCheck": "pending",
        "createdAt": created_at,
    }

    history = _ensure_b2b_order_activity_history(order)

    assert order["status"] == "confirmed"
    assert order["qualityCheck"] == "pending"
    assert len(history) == 2
    assert history[0]["status"] == "confirmed"
    assert history[0]["action"] == "order_created"
    assert history[0]["timestamp"] == created_at
    assert history[1]["status"] == "confirmed"
    assert history[1]["previousStatus"] == ORDER_READY_FOR_PICKUP
    assert history[1]["action"] == "confirmed"
    assert "no successful farmer quality-check approval" in history[1]["details"]


def test_existing_b2b_order_activity_history_is_preserved_and_creation_is_added():
    from datetime import datetime

    created_at = datetime(2026, 10, 31, 9, 0)
    existing_event = {
        "status": "quality_check",
        "action": "quality_check",
        "actorRole": "farmer",
        "details": "Quality check passed",
    }
    order = {
        "status": ORDER_READY_FOR_PICKUP,
        "qualityCheck": "pending",
        "createdAt": created_at,
        "statusHistory": [existing_event],
    }

    history = _ensure_b2b_order_activity_history(order)

    assert len(history) == 3
    assert history[0]["action"] == "order_created"
    assert history[0]["status"] == "confirmed"
    assert history[0]["timestamp"] == created_at
    assert history[1] is existing_event
    assert history[2]["status"] == ORDER_READY_FOR_PICKUP
    assert history[2]["isDerived"] is True
    assert order["status"] == ORDER_READY_FOR_PICKUP
    assert order["qualityCheck"] == "passed"


def test_confirmed_order_without_history_gets_truthful_creation_event_only():
    order = {
        "status": "confirmed",
        "createdAt": "2026-10-31T10:30:00",
    }

    history = _ensure_b2b_order_activity_history(order)

    assert len(history) == 1
    assert history[0]["status"] == "confirmed"
    assert history[0]["action"] == "order_created"
    assert history[0]["isDerived"] is True



def test_recurring_ready_occurrence_is_not_rewound_and_shows_farmer_confirmation():
    from datetime import datetime

    created_at = datetime(2026, 10, 30, 8, 0)
    confirmed_at = datetime(2026, 10, 31, 17, 45)
    order = {
        "status": ORDER_READY_FOR_PICKUP,
        "qualityCheck": "pending",
        "contractId": "contract-123",
        "scheduledDeliveryDate": "2026-11-01",
        "quantityKg": 25,
        "createdAt": created_at,
    }
    confirmation = {
        "scheduledDate": "2026-11-01",
        "availableQuantityKg": 30,
        "packedQuantityKg": 25,
        "readyForPickup": True,
        "confirmedBy": "farmer-123",
        "confirmedAt": confirmed_at,
    }

    assert _reconcile_legacy_one_off_ready_order(order) is False
    history = _build_recurring_ready_history(order, confirmation)
    order["statusHistory"] = history
    _ensure_b2b_order_activity_history(order)

    assert order["status"] == ORDER_READY_FOR_PICKUP
    assert len(history) == 2
    assert history[0]["status"] == "confirmed"
    assert history[1]["status"] == ORDER_READY_FOR_PICKUP
    assert history[1]["action"] == "farmer_confirmed_ready_for_pickup"
    assert history[1]["actorRole"] == "farmer"
    assert history[1]["actorId"] == "farmer-123"
    assert history[1]["timestamp"] == confirmed_at
    assert "25 kg packed from 30 kg available" in history[1]["details"]


def test_one_off_order_with_real_quality_pass_history_remains_ready():
    order = {
        "status": ORDER_READY_FOR_PICKUP,
        "qualityCheck": "pending",
        "statusHistory": [{
            "status": ORDER_QUALITY_CHECK,
            "action": "quality_check",
            "actorRole": "farmer",
            "details": "Quality check passed",
        }],
    }

    assert _reconcile_legacy_one_off_ready_order(order) is False
    assert order["status"] == ORDER_READY_FOR_PICKUP
    assert order["qualityCheck"] == "passed"



def test_legacy_preparing_order_gets_a_current_stage_event_without_fake_quality_pass():
    order = {
        "status": "preparing",
        "qualityCheck": "pending",
        "createdAt": "2026-10-31T10:30:00",
    }

    history = _ensure_b2b_order_activity_history(order)

    assert [event["status"] for event in history] == ["confirmed", "preparing"]
    assert history[-1]["action"] == "preparing"
    assert history[-1]["isDerived"] is True
    assert order["qualityCheck"] == "pending"



def test_legacy_one_off_failed_quality_check_returns_to_quality_check_not_confirmed():
    order = {
        "status": ORDER_READY_FOR_PICKUP,
        "qualityCheck": "failed",
        "packedQuantityKg": 5,
        "statusHistory": [{
            "status": ORDER_QUALITY_CHECK,
            "action": "quality_check",
            "actorRole": "farmer",
            "details": "Quality check failed; reinspection required",
        }],
    }

    history = _ensure_b2b_order_activity_history(order)

    assert order["status"] == ORDER_QUALITY_CHECK
    assert order["qualityCheck"] == "failed"
    assert history[-1]["action"] == ORDER_QUALITY_CHECK
    assert history[-1]["status"] == ORDER_QUALITY_CHECK



def test_legacy_ready_order_with_pickup_history_is_never_rewound():
    order = {
        "status": ORDER_READY_FOR_PICKUP,
        "qualityCheck": "pending",
        "statusHistory": [{
            "status": "picked_up",
            "actorRole": "pickup_team",
            "details": "Collected from farm",
        }],
    }

    assert _reconcile_legacy_one_off_ready_order(order) is False
    assert order["status"] == ORDER_READY_FOR_PICKUP
