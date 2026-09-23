"""Shared utility helpers."""

from __future__ import annotations

import re


def escape_regex(text: str) -> str:
    """Escape user-supplied search text for use in a Mongo $regex.

    Prevents regex injection and catastrophic-backtracking (ReDoS) attacks by
    treating all metacharacters as literals. Empty/whitespace input yields an
    impossible (never-match) pattern.
    """
    cleaned = (text or "").strip()
    if not cleaned:
        return r"\A\A"  # impossible match: never matches anything
    return re.escape(cleaned)


def normalize_phone_number(phone: str, default_country_code: str = "+91") -> str:
    """
    Normalize a phone number to E.164-like format.

    Accepts local 10-digit Indian numbers and numbers already in international format.
    """
    if not phone:
        raise ValueError("Phone number is required")

    cleaned = re.sub(r"[\s\-\(\)]", "", phone.strip())

    if cleaned.startswith("00"):
        cleaned = f"+{cleaned[2:]}"

    if cleaned.startswith("+"):
        digits = re.sub(r"\D", "", cleaned[1:])
        if 2 <= len(digits) <= 15:
            return f"+{digits}"
        raise ValueError("Phone number must contain between 2 and 15 digits after the country code")

    digits = re.sub(r"\D", "", cleaned)

    if len(digits) == 10:
        return f"{default_country_code}{digits}"

    if 2 <= len(digits) <= 15:
        return f"+{digits}"

    raise ValueError("Phone number must be a valid local number or include a country code")
