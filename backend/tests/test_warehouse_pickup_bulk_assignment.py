import pytest

from app.services.warehouse_pickup_route_service import select_route_team_assignments


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
