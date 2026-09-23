"""Rules-based risk engine.

Evaluates account events and produces a risk score (0-100) plus human-readable
flags. Rules are deliberately simple and explicit so they can be audited.

A high score should trigger additional verification, not a hard block.
"""
from typing import Dict, Any, List, Optional

from app.core.config import settings


class RiskEngine:
    """Stateless rule evaluation for account-risk events."""

    @staticmethod
    def evaluate(event: Dict[str, Any]) -> Dict[str, Any]:
        """Evaluate a single risk event.

        Expected keys (all optional):
          event_type        str   (login | order | withdrawal | bank_change)
          active_sessions   int
          is_new_device     bool
          ip_changed        bool
          failed_otp_attempts int
          high_value_amount float
          account_age_days  float
          recently_reopened bool
          has_mfa           bool
        Returns { score, flags, level }.
        """
        score = 0
        flags: List[str] = []
        event_type = event.get("event_type", "login")

        active_sessions = int(event.get("active_sessions") or 0)
        if active_sessions > settings.MAX_ACTIVE_SESSIONS:
            score += 25
            flags.append("excessive_active_sessions")

        if event.get("is_new_device"):
            score += 20
            flags.append("new_device")

        if event.get("ip_changed") and active_sessions > 0:
            score += 15
            flags.append("ip_changed")

        failed = int(event.get("failed_otp_attempts") or 0)
        if failed >= 3:
            score += 20
            flags.append("repeated_otp_failures")
        elif failed >= 1:
            score += 5

        amount = float(event.get("high_value_amount") or 0)
        if amount >= 10000:
            score += 20
            flags.append("high_value_transaction")
        elif amount >= 2000:
            score += 10

        age_days = float(event.get("account_age_days") or 0)
        if age_days and age_days < 7:
            score += 10
            flags.append("young_account")

        if event.get("recently_reopened"):
            score += 15
            flags.append("account_recently_reopened")

        if event_type == "withdrawal" and not event.get("has_mfa"):
            score += 10
            flags.append("withdrawal_without_mfa")

        score = min(score, 100)
        if score >= 60:
            level = "high"
        elif score >= 30:
            level = "medium"
        else:
            level = "low"

        return {"score": score, "flags": flags, "level": level}


risk_engine = RiskEngine()
