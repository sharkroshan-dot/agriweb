import pytest

from app.services.notification_service import NotificationService
from app.core.config import settings


@pytest.mark.asyncio
async def test_send_sms_falls_back_in_development(monkeypatch):
    monkeypatch.setattr("app.services.notification_service.Client", None, raising=False)
    monkeypatch.setattr(settings, "WHATSAPP_ACCESS_TOKEN", "", raising=False)
    monkeypatch.setattr(settings, "WHATSAPP_PHONE_NUMBER_ID", "", raising=False)
    monkeypatch.setattr(settings, "TWILIO_ACCOUNT_SID", "", raising=False)
    monkeypatch.setattr(settings, "TWILIO_AUTH_TOKEN", "", raising=False)
    monkeypatch.setattr(settings, "TWILIO_PHONE_NUMBER", "", raising=False)
    monkeypatch.setattr(settings, "MSG91_AUTH_KEY", "", raising=False)
    monkeypatch.setattr(settings, "MSG91_SENDER_ID", "", raising=False)
    monkeypatch.setattr(settings, "VONAGE_API_KEY", "", raising=False)
    monkeypatch.setattr(settings, "VONAGE_API_SECRET", "", raising=False)
    monkeypatch.setattr(settings, "VONAGE_FROM", "", raising=False)
    monkeypatch.setattr(settings, "SMS_EMAIL_GATEWAY_DOMAIN", "", raising=False)
    monkeypatch.setattr(settings, "ENVIRONMENT", "development", raising=False)
    monkeypatch.setattr(settings, "DEBUG", True, raising=False)

    result = await NotificationService.send_sms("+919999999999", "Test OTP")

    assert result is True


@pytest.mark.asyncio
async def test_send_sms_normalizes_phone_number_before_sending(monkeypatch):
    captured = {}

    class FakeMessages:
        def create(self, **kwargs):
            captured.update(kwargs)
            return type("Response", (), {"sid": "SM123"})()

    class FakeClient:
        def __init__(self, account_sid, auth_token):
            captured["account_sid"] = account_sid
            captured["auth_token"] = auth_token

        @property
        def messages(self):
            return FakeMessages()

    monkeypatch.setattr("app.services.notification_service.Client", FakeClient, raising=False)
    monkeypatch.setattr(settings, "WHATSAPP_ACCESS_TOKEN", "", raising=False)
    monkeypatch.setattr(settings, "WHATSAPP_PHONE_NUMBER_ID", "", raising=False)
    monkeypatch.setattr(settings, "TWILIO_ACCOUNT_SID", "test_sid", raising=False)
    monkeypatch.setattr(settings, "TWILIO_AUTH_TOKEN", "test_token", raising=False)
    monkeypatch.setattr(settings, "TWILIO_PHONE_NUMBER", "+15551234567", raising=False)
    monkeypatch.setattr(settings, "ENVIRONMENT", "production", raising=False)
    monkeypatch.setattr(settings, "DEBUG", False, raising=False)

    result = await NotificationService.send_sms("919999999999", "Test OTP")

    assert result is True
    assert captured["to"] == "+919999999999"


@pytest.mark.asyncio
async def test_send_sms_tries_whatsapp_first_and_returns_on_success(monkeypatch):
    calls = []

    async def fake_whatsapp(to, message):
        calls.append(("whatsapp", to))
        return True

    async def fake_msg91(*args, **kwargs):
        calls.append(("msg91",))
        return True

    monkeypatch.setattr(NotificationService, "send_whatsapp", fake_whatsapp, raising=False)
    monkeypatch.setattr(NotificationService, "_send_msg91", fake_msg91, raising=False)
    monkeypatch.setattr(settings, "WHATSAPP_ACCESS_TOKEN", "token", raising=False)
    monkeypatch.setattr(settings, "WHATSAPP_PHONE_NUMBER_ID", "123", raising=False)

    result = await NotificationService.send_sms("+919999999999", "Test OTP")

    assert result is True
    assert calls == [("whatsapp", "+919999999999")]


@pytest.mark.asyncio
async def test_send_sms_falls_back_to_sms_when_whatsapp_fails(monkeypatch):
    calls = []

    async def fake_whatsapp(to, message):
        calls.append(("whatsapp", to))
        return False

    async def fake_msg91(*args, **kwargs):
        calls.append(("msg91",))
        return True

    monkeypatch.setattr(NotificationService, "send_whatsapp", fake_whatsapp, raising=False)
    monkeypatch.setattr(NotificationService, "_send_msg91", fake_msg91, raising=False)
    monkeypatch.setattr(settings, "WHATSAPP_ACCESS_TOKEN", "token", raising=False)
    monkeypatch.setattr(settings, "WHATSAPP_PHONE_NUMBER_ID", "123", raising=False)
    monkeypatch.setattr(settings, "MSG91_AUTH_KEY", "auth", raising=False)
    monkeypatch.setattr(settings, "MSG91_SENDER_ID", "SENDER", raising=False)
    monkeypatch.setattr(settings, "MSG91_ROUTE", "4", raising=False)

    result = await NotificationService.send_sms("+919999999999", "Test OTP")

    assert result is True
    assert calls == [("whatsapp", "+919999999999"), ("msg91",)]

