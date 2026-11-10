"""RFC 6238 TOTP implementation using only the standard library.

Provides secret generation, code verification and otpauth:// URI building
for administrator two-factor authentication. No third-party dependencies.
"""
import base64
import hashlib
import hmac
import struct
import time
import os
from cryptography.fernet import Fernet, InvalidToken
from app.core.config import settings
from typing import Optional

_STEP = 30  # seconds
_DIGITS = 6

def _secret_cipher() -> Fernet:
    """Derive a stable Fernet key; configure TOTP_ENCRYPTION_KEY separately in production."""
    configured = getattr(settings, "TOTP_ENCRYPTION_KEY", None)
    material = (configured or settings.JWT_SECRET).encode("utf-8")
    key = base64.urlsafe_b64encode(hashlib.sha256(material).digest())
    return Fernet(key)


def encrypt_secret(secret: str) -> str:
    if not secret:
        return ""
    return "enc:v1:" + _secret_cipher().encrypt(secret.encode("utf-8")).decode("ascii")


def decrypt_secret(value: str) -> str:
    if not value:
        return ""
    if not value.startswith("enc:v1:"):
        # Backward compatibility for TOTP secrets created before encryption.
        return value
    try:
        return _secret_cipher().decrypt(value[7:].encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        raise ValueError("Unable to decrypt the saved authenticator secret. Check TOTP_ENCRYPTION_KEY.")


def generate_secret() -> str:
    """Generate a base32 TOTP secret (20 random bytes)."""
    return base64.b32encode(__import__("os").urandom(20)).decode("ascii")


def _hmac_sha1(key: bytes, counter: int) -> bytes:
    return hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()


def _hotp(secret: str, counter: int, digits: int = _DIGITS) -> str:
    key = base64.b32decode(secret.upper().replace(" ", ""), casefold=True)
    digest = _hmac_sha1(key, counter)
    offset = digest[-1] & 0x0F
    binary = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(binary % (10**digits)).zfill(digits)


def _time_code(timestamp: Optional[float] = None) -> int:
    return int((timestamp if timestamp is not None else time.time()) // _STEP)


def verify_code(secret: str, code: str, window: int = 2) -> bool:
    """Verify a TOTP code allowing `window` steps of clock drift on each side.

    Defaults to a 2-step window (±60s) so codes rotated while a user types, or
    phones with slight clock drift, still validate.
    """
    if not code or not secret:
        return False
    code = code.strip()
    current = _time_code()
    for offset in range(-window, window + 1):
        if hmac.compare_digest(_hotp(secret, current + offset), code):
            return True
    return False


def otpauth_uri(secret: str, account: str, issuer: str = "AgriConnect AI") -> str:
    """Build an otpauth:// provisioning URI for QR code apps."""
    from urllib.parse import quote

    base = f"otpauth://totp/{quote(issuer)}:{quote(account)}"
    params = (
        f"secret={secret}&issuer={quote(issuer)}"
        "&algorithm=SHA1&digits=6&period=30"
    )
    return f"{base}?{params}"