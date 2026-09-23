"""Auth regression tests for login and credential normalization."""

from unittest.mock import AsyncMock

import pytest

from app.api.v1 import auth as auth_module


@pytest.mark.asyncio
async def test_authenticate_user_accepts_phone_variants(monkeypatch):
    stored_user = {
        "_id": "64d1d6a7d9cea7f7d43d4f9a",
        "email": "user@example.com",
        "phone": "+919876543210",
        "passwordHash": "$pbkdf2-sha256$260000$dummy$hash",
        "isVerified": True,
        "isActive": True,
        "role": "customer",
    }

    async def fake_get_by_email(email):
        return None

    async def fake_get_by_phone(phone):
        return stored_user if phone == "+919876543210" else None

    monkeypatch.setattr(auth_module.user_repository, "get_by_email", fake_get_by_email)
    monkeypatch.setattr(auth_module.user_repository, "get_by_phone", fake_get_by_phone)
    monkeypatch.setattr(auth_module.Security, "verify_password", lambda plain, hashed: plain == "StrongPass1!")

    user = await auth_module.AuthService.authenticate_user("9876543210", "StrongPass1!")

    assert user is not None
    assert user["email"] == "user@example.com"


@pytest.mark.asyncio
async def test_login_uses_user_id_for_device_tracking(monkeypatch):
    user = {
        "_id": "64d1d6a7d9cea7f7d43d4f9a",
        "email": "user@example.com",
        "phone": "+919876543210",
        "role": "customer",
        "isVerified": True,
        "isActive": True,
    }

    monkeypatch.setattr(auth_module.AuthService, "authenticate_user", AsyncMock(return_value=user))
    monkeypatch.setattr(auth_module.AuditService, "log", AsyncMock(return_value=None))
    monkeypatch.setattr(auth_module.RedisClient, "get_cache", AsyncMock(return_value={}))
    monkeypatch.setattr(auth_module.RedisClient, "set_cache", AsyncMock(return_value=True))
    monkeypatch.setattr(auth_module.UserService, "update_last_login", AsyncMock(return_value=True))
    monkeypatch.setattr(auth_module.session_repository, "create_session", AsyncMock(return_value=None))
    monkeypatch.setattr(auth_module.Security, "create_access_token", staticmethod(lambda data, expires_delta=None: "access-token"))
    monkeypatch.setattr(auth_module.Security, "create_refresh_token", staticmethod(lambda data: "refresh-token"))

    form = auth_module.LoginForm(username="user@example.com", password="StrongPass1!")
    result = await auth_module.login(form_data=form, request=None)

    assert result.access_token == "access-token"
    assert result.refresh_token == "refresh-token"
    assert result.user.email == "user@example.com"
