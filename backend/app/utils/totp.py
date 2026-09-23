"""RFC 6238 TOTP implementation using only the standard library.

Provides secret generation, code verification and otpauth:// URI building
for administrator two-factor authentication. No third-party dependencies.
"""
import base64
import hashlib
import hmac
import struct
import time
from typing import Optional

_STEP = 30  # seconds
_DIGITS = 6


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