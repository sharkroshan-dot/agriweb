import pytest

from app.services.warehouse_pickup_route_service import select_route_team_assignments, _group_jobs_by_farm, _display_farm_key


def test_auto_assignment_chooses_smallest_suitable_capacity():
    routes = [
        {"totalQuantity": 40, "totalStops": 2},
        {"totalQuantity": 300, "totalStops": 4},
    ]
    teams = [
        {"deliveryPartnerId": "large", "capacity": 750},
        {"deliveryPartnerId": "small", "capacity": 50},
        {"deliveryPartnerId": "medium", "capacity": 350},
    ]

    assignments = select_route_team_assignments(routes, teams)

    assert [item["deliveryPartnerId"] for item in assignments] == ["small", "medium"]


def test_auto_assignment_skips_teams_already_on_active_routes():
    routes = [{"totalQuantity": 200, "totalStops": 3}]
    teams = [
        {"deliveryPartnerId": "busy", "capacity": 750},
        {"deliveryPartnerId": "available", "capacity": 250},
    ]

    assignments = select_route_team_assignments(routes, teams, busy_partner_ids=["busy"])

    assert len(assignments) == 1
    assert assignments[0]["deliveryPartnerId"] == "available"


def test_auto_assignment_fails_when_no_unique_capacity_suitable_team_exists():
    routes = [
        {"totalQuantity": 100, "totalStops": 2},
        {"totalQuantity": 500, "totalStops": 5},
    ]
    teams = [
        {"deliveryPartnerId": "one", "capacity": 750},
    ]

    with pytest.raises(ValueError, match="No unassigned approved pickup team"):
        select_route_team_assignments(routes, teams)


def test_auto_assignment_ignores_missing_or_invalid_capacity():
    routes = [{"totalQuantity": 20, "totalStops": 1}]
    teams = [
        {"deliveryPartnerId": "missing-capacity"},
        {"deliveryPartnerId": "invalid-capacity", "capacity": "unknown"},
    ]

    with pytest.raises(ValueError, match="No unassigned approved pickup team"):
        select_route_team_assignments(routes, teams)



def test_route_builder_groups_multiple_orders_from_one_farm_into_one_stop():
    jobs = [
        {
            "_id": "collection-1",
            "farmerId": "farmer-a",
            "farmerName": "Kumar Farms",
            "productId": "tomato",
            "productName": "Tomato",
            "orderId": "order-1",
            "quantity": 50,
            "pickupLocation": {"coordinates": [77.1, 11.1]},
            "status": "ready_for_pickup",
        },
        {
            "_id": "collection-2",
            "farmerId": "farmer-a",
            "farmerName": "Kumar Farms",
            "productId": "onion",
            "productName": "Onion",
            "orderId": "order-2",
            "quantity": 35,
            "pickupLocation": {"coordinates": [77.1, 11.1]},
            "status": "ready_for_pickup",
        },
        {
            "_id": "collection-3",
            "farmerId": "farmer-a",
            "farmerName": "Kumar Farms",
            "productId": "potato",
            "productName": "Potato",
            "orderId": "order-3",
            "quantity": 10,
            "pickupLocation": {"coordinates": [77.1, 11.1]},
            "status": "ready_for_pickup",
        },
    ]

    stops = _group_jobs_by_farm(jobs)

    assert len(stops) == 1
    assert stops[0]["farmerName"] == "Kumar Farms"
    assert stops[0]["orderCount"] == 3
    assert stops[0]["collectionIds"] == ["collection-1", "collection-2", "collection-3"]
    assert [order["orderId"] for order in stops[0]["orders"]] == ["order-1", "order-2", "order-3"]
    assert stops[0]["quantity"] == 95
    assert stops[0]["productName"] == "3 product types"


def test_route_builder_keeps_different_farms_as_separate_stops():
    jobs = [
        {
            "_id": "collection-1",
            "farmerId": "farmer-a",
            "farmerName": "Kumar Farms",
            "quantity": 50,
            "pickupLocation": {"coordinates": [77.1, 11.1]},
        },
        {
            "_id": "collection-2",
            "farmerId": "farmer-b",
            "farmerName": "Ravi Farms",
            "quantity": 35,
            "pickupLocation": {"coordinates": [77.2, 11.2]},
        },
    ]

    stops = _group_jobs_by_farm(jobs)

    assert len(stops) == 2
    assert {stop["farmerName"] for stop in stops} == {"Kumar Farms", "Ravi Farms"}



def test_legacy_route_stops_with_same_farm_name_and_address_are_grouped():
    first_stop = {
        "farmerId": "legacy-farmer-profile-a",
        "farmerName": "Henry Roshan",
        "pickupAddress": "Trichy Main Road, Trichy",
        "pickupLocation": {"coordinates": [78.6901, 10.7905]},
        "collectionId": "collection-a",
    }
    second_stop = {
        "farmerId": "legacy-farmer-profile-b",
        "farmerName": "henry roshan",
        "pickupAddress": "  Trichy Main Road,   Trichy ",
        "pickupLocation": {"coordinates": [78.6905, 10.7907]},
        "collectionId": "collection-b",
    }

    assert _display_farm_key(first_stop) == _display_farm_key(second_stop)


def test_different_farm_addresses_remain_separate_even_for_same_farmer_name():
    first_stop = {
        "farmerName": "Henry Roshan",
        "pickupAddress": "Trichy Main Road, Trichy",
        "pickupLocation": {"coordinates": [78.6901, 10.7905]},
    }
    second_stop = {
        "farmerName": "Henry Roshan",
        "pickupAddress": "Airport Road, Trichy",
        "pickupLocation": {"coordinates": [78.7000, 10.8000]},
    }

    assert _display_farm_key(first_stop) != _display_farm_key(second_stop)
