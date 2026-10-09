import pytest

from app.services.logistics_routing_service import is_packed_farmer_order


@pytest.mark.parametrize("stage", ["packed", "PACKED", "dispatched", "DISPATCHED"])
def test_normalized_packed_stage_is_eligible(stage):
    assert is_packed_farmer_order({"fulfillmentStage": stage}) is True


@pytest.mark.parametrize("flag", [True, "true", "TRUE", "1", "yes", "YES"])
def test_legacy_packing_complete_values_are_eligible(flag):
    assert is_packed_farmer_order({"packingComplete": flag}) is True


@pytest.mark.parametrize("flag", [False, "false", "FALSE", "0", "no", "", None])
def test_incomplete_legacy_packing_flags_are_not_eligible(flag):
    assert is_packed_farmer_order({"packingComplete": flag}) is False


def test_missing_packing_fields_are_not_eligible():
    assert is_packed_farmer_order({}) is False


def test_explicit_packed_stage_is_authoritative_over_legacy_flag():
    assert is_packed_farmer_order({
        "fulfillmentStage": "packed",
        "packingComplete": False,
    }) is True
