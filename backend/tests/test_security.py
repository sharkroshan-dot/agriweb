"""Security regression tests for the Phase 1 hardening.

Covers:
- Self-registration role whitelist (privilege escalation)
- OTP hashing / constant-time verification
- Secure file upload validation
- Password-reset token digesting
- Payment confirm hardening (no unverified confirmation)
"""
import pytest
from pydantic import ValidationError

from app.core.security import Security, SELF_REGISTRATION_ROLES
from app.utils.file_security import (
    validate_upload,
    UploadValidationError,
    ALLOWED_EXTENSIONS,
)
from app.schemas.auth import UserRegister


# ---------------- Registration role whitelist ----------------

def _register_payload(**overrides):
    data = {
        "email": "tester@example.com",
        "phone": "+919876543210",
        "password": "StrongPass1!",
        "first_name": "Test",
        "last_name": "User",
        "role": "customer",
    }
    data.update(overrides)
    return data


def test_registration_rejects_admin_role():
    with pytest.raises(ValidationError):
        UserRegister(**_register_payload(role="admin"))


def test_registration_rejects_super_admin_role():
    with pytest.raises(ValidationError):
        UserRegister(**_register_payload(role="super_admin"))


def test_registration_rejects_finance_support_roles():
    for privileged in ("finance", "support", "operations", "security"):
        with pytest.raises(ValidationError):
            UserRegister(**_register_payload(role=privileged))


@pytest.mark.parametrize("role", ["customer", "farmer", "delivery", "warehouse"])
def test_registration_accepts_self_service_roles(role):
    user = UserRegister(**_register_payload(role=role))
    assert user.role == role


def test_role_whitelist_constant_is_stable():
    assert "admin" not in SELF_REGISTRATION_ROLES


# ---------------- OTP security ----------------

def test_otp_hash_is_not_plaintext():
    otp = "482915"
    stored = Security.hash_otp(otp)
    assert stored != otp
    assert otp not in stored
    assert "$" in stored  # salt$digest


def test_otp_verify_accepts_correct_code():
    otp = "482915"
    stored = Security.hash_otp(otp)
    assert Security.verify_otp(otp, stored) is True


def test_otp_verify_rejects_wrong_code():
    stored = Security.hash_otp("482915")
    assert Security.verify_otp("482916", stored) is False


def test_otp_verify_rejects_garbage():
    assert Security.verify_otp("123456", "not-a-hash") is False
    assert Security.verify_otp("123456", "") is False


def test_otp_hash_is_salted():
    otp = "482915"
    assert Security.hash_otp(otp) != Security.hash_otp(otp)


# ---------------- Password reset token digest ----------------

def test_digest_token_is_deterministic():
    token = "abc123token"
    assert Security.digest_token(token) == Security.digest_token(token)
    assert Security.digest_token(token) != Security.digest_token("other")


def test_digest_token_never_contains_raw_token():
    token = "abc123token"
    digest = Security.digest_token(token)
    assert token not in digest


# ---------------- File upload validation ----------------

def test_upload_rejects_html():
    with pytest.raises(UploadValidationError):
        validate_upload("evil.html", b"<html><script>alert(1)</script></html>", "text/html")


def test_upload_rejects_svg():
    with pytest.raises(UploadValidationError):
        validate_upload("image.svg", b'<svg xmlns="http://www.w3.org/2000/svg"></svg>', "image/svg+xml")


def test_upload_accepts_png_by_magic_bytes():
    png = b"\x89PNG\r\n\x1a\n" + b"fakedata"
    ext = validate_upload("photo.png", png, "image/png")
    assert ext == ".png"


def test_upload_accepts_jpeg_even_with_weird_filename():
    jpeg = b"\xff\xd8\xff\xe0" + b"fakedata"
    ext = validate_upload("photo.txt", jpeg, "image/jpeg")
    assert ext == ".jpg"


def test_upload_rejects_oversize_file():
    big = b"A" * (6 * 1024 * 1024)
    with pytest.raises(UploadValidationError):
        validate_upload("big.png", big, "image/png", max_bytes=5 * 1024 * 1024)


def test_upload_rejects_empty_file():
    with pytest.raises(UploadValidationError):
        validate_upload("empty.png", b"", "image/png")


def test_upload_rejects_unknown_extension_with_unknown_magic():
    with pytest.raises(UploadValidationError):
        validate_upload("archive.exe", b"MZ\x90\x00binary", "application/octet-stream")


def test_upload_accepts_mp4_video_by_magic_bytes():
    mp4 = b"\x00\x00\x00\x18ftypisom" + b"fakedata"
    ext = validate_upload("land.mp4", mp4, "video/mp4")
    assert ext == ".mp4"


def test_upload_accepts_quicktime_mov_video():
    mov = b"\x00\x00\x00\x18ftypqt  " + b"fakedata"
    ext = validate_upload("land.mov", mov, "video/quicktime")
    assert ext == ".mov"


def test_upload_accepts_webm_video():
    webm = b"\x1a\x45\xdf\xa3\x9f\x42\x86\x81" + b"fakedata"
    ext = validate_upload("land.webm", webm, "video/webm")
    assert ext == ".webm"


def test_upload_allows_large_video_but_rejects_oversize_image():
    big_video = b"\x00\x00\x00\x18ftypisom" + b"A" * (10 * 1024 * 1024)
    ext = validate_upload("land.mp4", big_video, "video/mp4")
    assert ext == ".mp4"
    with pytest.raises(UploadValidationError):
        validate_upload("big.png", b"\x89PNG\r\n\x1a\n" + b"A" * (10 * 1024 * 1024), "image/png")


# ---------------- Payment confirm hardening ----------------

class DummyPaymentRepository:
    def __init__(self):
        self.payments = {}
        self.updated = []

    async def get_by_id(self, payment_id):
        return self.payments.get(str(payment_id))

    async def get_by_transaction_id(self, tx_id):
        for p in self.payments.values():
            if p.get("transactionId") == tx_id:
                return p
        return None

    async def update_payment_status(self, payment_id, status, gateway_response=None):
        self.updated.append((payment_id, status))
        return True


class DummyOrderRepository:
    async def update(self, query, update_data):
        return True


@pytest.fixture
def payment_env(monkeypatch):
    from app.services import payment_service as ps
    dummy_payments = DummyPaymentRepository()
    monkeypatch.setattr(ps, "payment_repository", dummy_payments)
    monkeypatch.setattr(ps, "order_repository", DummyOrderRepository())

    async def _noop_splits(*args, **kwargs):
        return None

    async def _noop_notify(*args, **kwargs):
        return None

    monkeypatch.setattr(ps.PaymentService, "create_payment_splits", _noop_splits)
    monkeypatch.setattr(ps.NotificationService, "send_payment_success", _noop_notify)
    return dummy_payments


@pytest.mark.asyncio
async def test_confirm_payment_refuses_razorpay_order_id(payment_env, monkeypatch):
    from app.services import payment_service as ps
    payment_env.payments["111111111111111111111111"] = {
        "_id": "111111111111111111111111",
        "userId": "222222222222222222222222",
        "transactionId": "order_abc123",
        "orderId": None,
    }
    result = await ps.PaymentService.confirm_payment("order_abc123", {})
    assert result is None
    assert payment_env.updated == []


@pytest.mark.asyncio
async def test_confirm_payment_simulated_blocked_when_not_debug(payment_env, monkeypatch):
    from app.services import payment_service as ps
    monkeypatch.setattr(ps.settings, "DEBUG", False)
    payment_env.payments["111111111111111111111111"] = {
        "_id": "111111111111111111111111",
        "userId": "222222222222222222222222",
        "transactionId": "pi_simulated_",
    }
    result = await ps.PaymentService.confirm_payment(
        "pi_simulated_111111111111111111111111", {}
    )
    assert result is None
    assert payment_env.updated == []


@pytest.mark.asyncio
async def test_confirm_payment_simulated_allowed_in_debug_for_owner(payment_env, monkeypatch):
    from app.services import payment_service as ps
    monkeypatch.setattr(ps.settings, "DEBUG", True)
    payment_env.payments["111111111111111111111111"] = {
        "_id": "111111111111111111111111",
        "userId": "222222222222222222222222",
        "transactionId": "pi_simulated_111111111111111111111111",
    }
    result = await ps.PaymentService.confirm_payment(
        "pi_simulated_111111111111111111111111",
        {},
        user_id="222222222222222222222222",
    )
    assert result is not None
    assert ("111111111111111111111111", "success") in payment_env.updated


@pytest.mark.asyncio
async def test_confirm_payment_enforces_ownership(payment_env, monkeypatch):
    from app.services import payment_service as ps
    monkeypatch.setattr(ps.settings, "DEBUG", True)
    payment_env.payments["111111111111111111111111"] = {
        "_id": "111111111111111111111111",
        "userId": "222222222222222222222222",
        "transactionId": "pi_simulated_111111111111111111111111",
    }
    result = await ps.PaymentService.confirm_payment(
        "pi_simulated_111111111111111111111111",
        {},
        user_id="999999999999999999999999",  # different user
    )
    assert result is None
    assert payment_env.updated == []


# ---------------- Security helpers ----------------

def test_hash_verify_password_roundtrip():
    hashed = Security.get_password_hash("CorrectHorse1!")
    assert Security.verify_password("CorrectHorse1!", hashed)
    assert not Security.verify_password("wrong", hashed)

