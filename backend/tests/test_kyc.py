"""Tests for the KYC trust/verification feature."""
import pytest
from pydantic import ValidationError

from app.api.v1.kyc import _trust_score
from app.schemas.delivery_kyc import DeliveryKYCSubmission


def test_trust_score_zero_with_no_flags():
    assert _trust_score({"mobile": False, "identity": False, "bank": False, "farm": False}) == 0


def test_trust_score_full_farmer():
    score = _trust_score({"mobile": True, "identity": True, "bank": True, "farm": True})
    assert score == 100


def test_trust_score_partial():
    score = _trust_score({"mobile": True, "identity": True, "bank": False, "farm": False, "vehicle": False})
    assert score == 55  # 30 + 25


def test_trust_score_vehicle_partner():
    score = _trust_score({"mobile": True, "identity": True, "bank": True, "vehicle": True})
    assert score == 100


def test_delivery_kyc_normalizes_phone():
    sub = DeliveryKYCSubmission(fullName="Arun Kumar", phone="9876543210")
    assert sub.phone.startswith("+91")


def test_delivery_kyc_rejects_invalid_phone():
    with pytest.raises(ValidationError):
        DeliveryKYCSubmission(fullName="Arun Kumar", phone="not-a-phone")
