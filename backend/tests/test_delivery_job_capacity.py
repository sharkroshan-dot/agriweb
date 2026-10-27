import pytest

from app.services.delivery_job_service import (
    job_weight_kg,
    passes_capacity,
    passes_vehicle_type,
)


@pytest.mark.parametrize(
    ("vehicle_type", "weight", "expected"),
    [
        ("bike", 25, True),
        ("bike", 25.01, False),
        ("van", 100, True),
        ("unknown_vehicle", 1, False),
        (None, 1, False),
    ],
)
def test_vehicle_type_limits(vehicle_type, weight, expected):
    assert passes_vehicle_type({"vehicleType": vehicle_type}, weight) is expected


def test_capacity_requires_a_declared_positive_capacity():
    assert passes_capacity({}, 0, 1) is False
    assert passes_capacity({"capacity": 0}, 0, 1) is False


def test_capacity_checks_remaining_capacity_after_existing_jobs():
    partner = {"capacity": 20}
    assert passes_capacity(partner, committed_weight=12, job_weight=8) is True
    assert passes_capacity(partner, committed_weight=12, job_weight=8.01) is False


def test_fractional_produce_quantity_is_not_truncated():
    assert job_weight_kg({"items": [{"quantity": 0.5}, {"quantity": 1.25}]}) == 1.75
