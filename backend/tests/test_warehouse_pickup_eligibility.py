from app.services.delivery_job_service import passes_vehicle_type, passes_capacity, vehicle_type_capacity_kg


def test_vehicle_type_capacity_limits():
    assert vehicle_type_capacity_kg("bike") == 25.0
    assert vehicle_type_capacity_kg("tata ace") == 750.0
    assert vehicle_type_capacity_kg("mini truck") == 1000.0
    assert vehicle_type_capacity_kg("unknown") is None


def test_vehicle_type_rejects_overweight_route():
    assert passes_vehicle_type({"vehicleType": "bike"}, 25)
    assert not passes_vehicle_type({"vehicleType": "bike"}, 25.01)
    assert passes_vehicle_type({"vehicleType": "tata_ace"}, 750)
    assert not passes_vehicle_type({"vehicleType": "tata_ace"}, 750.01)


def test_configured_capacity_is_still_enforced():
    assert passes_capacity({"capacity": 500}, 100, 400)
    assert not passes_capacity({"capacity": 500}, 100, 400.01)
    assert passes_capacity({}, 100, 1000)
