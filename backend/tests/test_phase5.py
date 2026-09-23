"""Phase 5 tests: PII stripping, regex escaping, MongoDB URI validation, backup crypto.

No MongoDB / network required - pure functions and monkeypatched dependencies.
"""
import gzip
import json

import pytest

from app.utils.helpers import escape_regex
from app.api.v1 import auth as auth_module
from app.database.mongodb import MongoDB
from scripts.backup_encrypted import encrypt_bytes, decrypt_bytes


# ---------------- PII: passwordHash never leaves get_current_user ----------------

@pytest.mark.asyncio
async def test_get_current_user_strips_password_hash(monkeypatch):
    fake_user = {
        "_id": "507f1f77bcf86cd799439011",
        "email": "a@b.c",
        "phone": "+919999999999",
        "firstName": "Asha",
        "lastName": "Devi",
        "role": "farmer",
        "isActive": True,
        "isVerified": True,
        "passwordHash": "$2b$12$super.secret.hash",
        "passwordResetToken": "secret-token",
        "totpSecret": "keep-me",
        "totpEnabled": False,
    }

    async def fake_not_revoked(token):
        return False

    async def fake_get_user(user_id):
        return dict(fake_user)

    monkeypatch.setattr(auth_module, "_is_token_revoked", fake_not_revoked)
    monkeypatch.setattr(
        auth_module.Security, "decode_token",
        lambda token: {"sub": str(fake_user["_id"]), "role": "farmer"},
    )
    monkeypatch.setattr(auth_module.UserService, "get_user_by_id", fake_get_user)

    result = await auth_module.get_current_user("dummy.token")
    assert "passwordHash" not in result
    assert "passwordResetToken" not in result
    # Needed by the 2FA flow - must be preserved.
    assert result.get("totpSecret") == "keep-me"
    assert result.get("email") == "a@b.c"


# ---------------- Regex escaping (NoSQL injection / ReDoS) ----------------

def test_escape_regex_treats_metachars_as_literal():
    escaped = escape_regex(".*[a-z]")
    assert ".*[a-z]" not in escaped
    assert "\\" in escaped


def test_escape_regex_plain_text_unchanged():
    assert escape_regex("tomato") == "tomato"


def test_escape_regex_empty_is_never_match():
    assert escape_regex("") != ""
    assert escape_regex("   ") != ""


# ---------------- MongoDB URI validation ----------------

def test_validate_uri_accepts_localhost():
    MongoDB._validate_uri("mongodb://localhost:27017")  # should not raise
    MongoDB._validate_uri("mongodb://127.0.0.1:27017")  # should not raise


def test_validate_uri_rejects_bad_scheme():
    with pytest.raises(ValueError):
        MongoDB._validate_uri("http://localhost:27017")


def test_validate_uri_accepts_srv():
    MongoDB._validate_uri("mongodb+srv://cluster.example.mongodb.net")  # should not raise


# ---------------- Backup encryption round-trip ----------------

def test_backup_encrypt_decrypt_round_trip():
    secret = "x" * 40
    doc = json.dumps({"users": [{"name": "Asha", "role": "farmer"}]}).encode()
    blob = encrypt_bytes(doc, secret)
    assert blob != doc
    out = decrypt_bytes(blob, secret)
    assert out == doc


def test_backup_decrypt_fails_with_wrong_key():
    payload = json.dumps({"ok": 1}).encode()
    blob = encrypt_bytes(payload, "a" * 40)
    with pytest.raises(Exception):
        decrypt_bytes(blob, "b" * 40)
