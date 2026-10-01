from app.services.fulfillment_engine import distance_km, eta_minutes, _risk

def test_distance_and_eta():
    a = {"type": "Point", "coordinates": [78.7047, 10.7905]}
    b = {"type": "Point", "coordinates": [78.7580, 10.9520]}
    distance = distance_km(a, b)
    assert distance is not None
    assert 18 <= distance <= 20
    assert eta_minutes(distance) is not None

def test_perishability_risk_uses_remaining_shelf_life():
    assert _risk(10, 120, "high") == "high"
    assert _risk(2, 180, "high") == "critical"
    assert _risk(72, 60, "low") == "low"

def test_farmer_nearby_is_delivery_partner_not_hub():
    from app.services.fulfillment_engine import _farmer_needs_partner
    assert _farmer_needs_partner(30, 50, "low") is True
