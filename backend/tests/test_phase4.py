"""Phase 4 tests: TOTP MFA, risk engine, sessions, audit service.

Uses pure functions and monkeypatched repositories - no MongoDB required.
"""
import pytest

from app.utils.totp import generate_secret, verify_code, otpauth_uri, _hotp, _time_code
from app.services.risk_engine import risk_engine
from app.repositories.session_repository import session_repository
from app.services.audit_service import audit_service


# ---------------- TOTP ----------------

def test_totp_secret_is_base32_and_unique():
    assert len(generate_secret()) >= 32
    assert generate_secret() != generate_secret()


def test_totp_verify_rejects_wrong_code():
    secret = generate_secret()
    now = _time_code()
    good = _hotp(secret, now)
    stale = _hotp(secret, now - 2)  # still inside the default 2-step window
    bad = _hotp(secret, now - 3)  # outside window
    assert verify_code(secret, good) is True
    assert verify_code(secret, stale) is True
    assert verify_code(secret, bad) is False


def test_totp_verify_rejects_garbage():
    assert verify_code("", "123456") is False
    assert verify_code(generate_secret(), "") is False
    assert verify_code(generate_secret(), "abcdef") is False


def test_totp_otpauth_uri_shape():
    secret = generate_secret()
    uri = otpauth_uri(secret, "admin@agri.example")
    assert uri.startswith("otpauth://totp/")
    assert "secret=" in uri
    assert "issuer=" in uri


# ---------------- Risk engine ----------------

def test_risk_engine_low_baseline():
    result = risk_engine.evaluate({"event_type": "login", "active_sessions": 1})
    assert result["level"] == "low"
    assert result["score"] == 0


def test_risk_engine_flags_new_device_and_high_value():
    result = risk_engine.evaluate({
        "event_type": "order",
        "active_sessions": 1,
        "is_new_device": True,
        "high_value_amount": 12000,
    })
    assert "new_device" in result["flags"]
    assert "high_value_transaction" in result["flags"]
    assert result["score"] >= 40


def test_risk_engine_high_level_with_many_signals():
    result = risk_engine.evaluate({
        "event_type": "login",
        "active_sessions": 25,
        "is_new_device": True,
        "ip_changed": True,
        "failed_otp_attempts": 4,
        "account_age_days": 2,
    })
    assert result["level"] == "high"
    assert result["score"] == 90


def test_risk_engine_score_capped_at_100():
    result = risk_engine.evaluate({
        "event_type": "withdrawal",
        "active_sessions": 50,
        "is_new_device": True,
        "ip_changed": True,
        "failed_otp_attempts": 9,
        "high_value_amount": 50000,
        "recently_reopened": True,
    })
    assert result["score"] <= 100


# ---------------- Sessions ----------------

@pytest.mark.asyncio
async def test_session_revoke_all_except_current(monkeypatch):
    class FakeCollection:
        def __init__(self):
            self.updated = []

        async def update_many(self, query, update):
            self.updated.append((query, update))
            return type("R", (), {"modified_count": 3})()

    fake = FakeCollection()
    monkeypatch.setattr(session_repository, "_collection", fake)
    count = await session_repository.revoke_all_for_user("507f1f77bcf86cd799439011", except_jti="current")
    assert count == 3
    query, update = fake.updated[0]
    assert query["jti"] == {"$ne": "current"}
    assert query["revoked"] is False


@pytest.mark.asyncio
async def test_session_touch_last_seen_is_quiet_on_error(monkeypatch):
    class Broken:
        async def update_one(self, *a, **k):
            raise RuntimeError("db down")

    monkeypatch.setattr(session_repository, "_collection", Broken())
    # Should not raise.
    await session_repository.touch_last_seen("some-jti")


# ---------------- Audit service ----------------

@pytest.mark.asyncio
async def test_audit_log_write_never_raises(monkeypatch):
    class BrokenRepo:
        async def create_log(self, data):
            raise RuntimeError("db down")

    monkeypatch.setattr("app.repositories.audit_log_repository.audit_log_repository", BrokenRepo())
    await audit_service.log(
        actor_id="u1", actor_role="admin", action="test", resource="auth", outcome="success"
    )


@pytest.mark.asyncio
async def test_audit_log_persists_entry(monkeypatch):
    captured = {}

    async def fake_create_log(data):
        captured.update(data)
        return "audit_id"

    monkeypatch.setattr("app.repositories.audit_log_repository.audit_log_repository.create_log", fake_create_log)
    await audit_service.log(
        actor_id="u1", actor_role="finance", action="settlement_verify",
        resource="cash_settlement", resource_id="s1", outcome="success",
        ip="1.2.3.4", metadata={"amount": 100.0},
    )
    assert captured["action"] == "settlement_verify"
    assert captured["actorRole"] == "finance"
    assert captured["metadata"] == {"amount": 100.0}
    assert captured["outcome"] == "success"
