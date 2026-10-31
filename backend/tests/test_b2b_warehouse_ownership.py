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

def test_recurring_confirmation_is_recovered_when_order_history_is_only_partial():
    from datetime import datetime

    created_at = datetime(2026, 10, 31, 9, 0)
    confirmed_at = datetime(2026, 10, 31, 17, 45)
    creation_event = {
        "status": "confirmed",
        "action": "order_created",
        "actorRole": "system",
        "timestamp": created_at,
    }
    order = {
        "status": ORDER_READY_FOR_PICKUP,
        "qualityCheck": "pending",
        "contractId": "contract-456",
        "scheduledDeliveryDate": "2026-11-01",
        "quantityKg": 25,
        "createdAt": created_at,
        "statusHistory": [creation_event],
    }
    confirmation = {
        "scheduledDate": "2026-11-01",
        "availableQuantityKg": 30,
        "packedQuantityKg": 25,
        "readyForPickup": True,
        "confirmedBy": "farmer-456",
        "confirmedAt": confirmed_at,
    }

    history = _build_recurring_ready_history(order, confirmation)

    assert len(history) == 2
    assert history[0] is creation_event
    assert history[1]["action"] == "farmer_confirmed_ready_for_pickup"
    assert history[1]["actorId"] == "farmer-456"
    assert history[1]["timestamp"] == confirmed_at
    assert "25 kg packed from 30 kg available" in history[1]["details"]

def test_legacy_one_off_ready_order_recovers_preparation_when_packed_quantity_exists():
    order = {
        "status": ORDER_READY_FOR_PICKUP,
        "qualityCheck": "passed",
        "packedQuantityKg": 12,
        "quantityKg": 12,
        "createdAt": "2026-10-31T08:00:00",
        "updatedAt": "2026-10-31T10:00:00",
        "statusHistory": [{
            "status": "confirmed",
            "action": "order_created",
            "actorRole": "system",
            "timestamp": "2026-10-31T08:00:00",
        }],
    }

    history = _ensure_b2b_order_activity_history(order)

    stages = [event.get("status") for event in history if event.get("action") in {
        "order_created", "preparing", "quality_check", "ready_for_pickup"
    }]
    assert stages == ["confirmed", "preparing", "quality_check", "ready_for_pickup"]
    preparing = next(event for event in history if event.get("action") == "preparing")
    assert preparing["isDerived"] is True
    assert "12 kg" in preparing["details"]


def test_legacy_recurring_order_does_not_receive_one_off_preparing_or_quality_events():
    order = {
        "status": ORDER_READY_FOR_PICKUP,
        "qualityCheck": "pending",
        "contractId": "contract-789",
        "scheduledDeliveryDate": "2026-11-01",
        "packedQuantityKg": 10,
        "createdAt": "2026-10-31T08:00:00",
        "statusHistory": [{
            "status": "confirmed",
            "action": "order_created",
            "actorRole": "system",
            "timestamp": "2026-10-31T08:00:00",
        }],
    }

    history = _ensure_b2b_order_activity_history(order)

    actions = [event.get("action") for event in history]
    assert "preparing" not in actions
    assert "quality_check" not in actions
    assert actions.count("ready_for_pickup") == 1

def test_tracking_snapshot_does_not_hide_missing_current_stage_transition():
    order = {
        "status": ORDER_READY_FOR_PICKUP,
        "qualityCheck": "pending",
        "createdAt": "2026-10-31T08:00:00",
        "statusHistory": [
            {
                "status": "confirmed",
                "action": "order_created",
                "actorRole": "system",
                "timestamp": "2026-10-31T08:00:00",
            },
            {
                "status": ORDER_READY_FOR_PICKUP,
                "eventType": "collection_en_route",
                "title": "Collection partner en route",
                "description": "The pickup partner started travelling to the farm.",
                "actorRole": "delivery",
                "timestamp": "2026-10-31T10:00:00",
            },
        ],
    }

    history = _ensure_b2b_order_activity_history(order)

    assert order["status"] == ORDER_READY_FOR_PICKUP
    assert any(
        event.get("action") == ORDER_READY_FOR_PICKUP and event.get("isDerived") is True
        for event in history
    )
    assert any(event.get("eventType") == "collection_en_route" for event in history)

def test_real_recurring_confirmation_replaces_derived_ready_placeholder():
    from datetime import datetime

    created_at = datetime(2026, 10, 30, 8, 0)
    confirmed_at = datetime(2026, 10, 31, 17, 45)
    order = {
        "status": ORDER_READY_FOR_PICKUP,
        "contractId": "contract-derived",
        "scheduledDeliveryDate": "2026-11-01",
        "quantityKg": 3,
        "createdAt": created_at,
        "statusHistory": [
            {
                "status": "confirmed",
                "action": "order_created",
                "actorRole": "system",
                "timestamp": created_at,
            },
            {
                "status": ORDER_READY_FOR_PICKUP,
                "action": ORDER_READY_FOR_PICKUP,
                "actorRole": "system",
                "details": "Legacy derived current-stage placeholder",
                "timestamp": confirmed_at,
                "isDerived": True,
            },
        ],
    }
    confirmation = {
        "scheduledDate": "2026-11-01",
        "availableQuantityKg": 4,
        "packedQuantityKg": 3,
        "readyForPickup": True,
        "confirmedBy": "farmer-789",
        "confirmedAt": confirmed_at,
    }

    history = _build_recurring_ready_history(order, confirmation)

    ready_events = [
        event for event in history
        if event.get("status") == ORDER_READY_FOR_PICKUP
    ]
    assert len(ready_events) == 1
    assert ready_events[0]["action"] == "farmer_confirmed_ready_for_pickup"
    assert ready_events[0]["actorRole"] == "farmer"
    assert ready_events[0]["actorId"] == "farmer-789"

def test_replacement_order_does_not_inherit_original_contract_farmer_confirmation():
    contract = {"farmerId": "original-farmer"}
    replacement_order = {
        "contractId": "contract-1",
        "scheduledDeliveryDate": "2026-10-30",
        "farmerId": "replacement-farmer",
        "isReplacementSupply": True,
    }
    original_order = {
        "contractId": "contract-1",
        "scheduledDeliveryDate": "2026-10-30",
        "farmerId": "original-farmer",
    }

    from app.api.v1.b2b import _is_primary_recurring_occurrence

    assert not _is_primary_recurring_occurrence(replacement_order, contract)
    assert _is_primary_recurring_occurrence(original_order, contract)


def test_receive_stock_snapshot_is_recognized_as_real_warehouse_received_transition():
    order = {
        "status": ORDER_WAREHOUSE_RECEIVED,
        "qualityCheck": "passed",
        "createdAt": "2026-10-27T08:00:00",
        "warehouseReceivedAt": "2026-10-27T11:57:27",
        "statusHistory": [
            {
                "status": "confirmed",
                "action": "order_created",
                "timestamp": "2026-10-27T08:00:00",
            },
            {
                "status": ORDER_WAREHOUSE_RECEIVED,
                "previousStatus": ORDER_PICKED_UP,
                "action": "receive_stock",
                "actorRole": "warehouse",
                "timestamp": "2026-10-27T11:57:27",
            },
        ],
    }

    history = _ensure_b2b_order_activity_history(order)

    assert not any(
        event.get("isDerived") is True
        and event.get("action") == ORDER_WAREHOUSE_RECEIVED
        and str(event.get("details") or "").startswith("The order's stored current stage is")
        for event in history
    )


def test_completed_order_cannot_be_reopened_by_legacy_receive_stock_event():
    order = {
        "status": ORDER_WAREHOUSE_RECEIVED,
        "completedAt": "2026-10-28T14:40:52",
        "qualityCheck": "passed",
        "statusHistory": [
            {
                "status": ORDER_WAREHOUSE_RECEIVED,
                "previousStatus": ORDER_COMPLETED,
                "action": "receive_stock",
                "actorRole": "warehouse",
                "timestamp": "2026-10-29T09:00:00",
            },
        ],
    }

    history = _ensure_b2b_order_activity_history(order)

    assert order["status"] == ORDER_COMPLETED
    invalid = next(event for event in history if event.get("action") == "receive_stock")
    assert invalid["isInvalidTransition"] is True
    assert invalid["isIgnoredForLifecycle"] is True
    assert any(
        event.get("action") == "complete_order" and event.get("isDerived") is True
        for event in history
    )


def test_completed_at_reconstructs_specific_business_completion_event():
    order = {
        "status": ORDER_COMPLETED,
        "completedAt": "2026-10-28T14:40:52",
        "createdAt": "2026-10-27T12:00:00",
        "statusHistory": [
            {
                "status": "confirmed",
                "action": "order_created",
                "timestamp": "2026-10-27T12:00:00",
            },
        ],
    }

    history = _ensure_b2b_order_activity_history(order)

    completion = next(event for event in history if event.get("action") == "complete_order")
    assert completion["timestamp"] == "2026-10-28T14:40:52"
    assert completion["previousStatus"] == ORDER_DELIVERED
    assert completion["isDerived"] is True


def test_delivered_at_reconstructs_delivery_handover_event_with_proof():
    order = {
        "status": ORDER_DELIVERED,
        "deliveredAt": "2026-10-27T20:25:11",
        "deliveredBy": "delivery-user",
        "deliveryProof": "Received by business manager",
        "createdAt": "2026-10-27T08:00:00",
        "statusHistory": [
            {
                "status": "confirmed",
                "action": "order_created",
                "timestamp": "2026-10-27T08:00:00",
            },
        ],
    }

    history = _ensure_b2b_order_activity_history(order)

    delivered = next(event for event in history if event.get("action") == "confirm_delivery")
    assert delivered["timestamp"] == "2026-10-27T20:25:11"
    assert delivered["actorRole"] == "delivery"
    assert delivered["actorId"] == "delivery-user"
    assert delivered["details"] == "Received by business manager"

