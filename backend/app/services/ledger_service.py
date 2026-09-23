"""Financial ledger service.

Every money movement on the platform is recorded as an immutable ledger entry
with a unique transaction id, direction, amount, type, timestamps and a
reference chain (order / payment / user). Corrections are posted as reversal
entries linked to the original; entries are never edited in place.

The ledger is advisory for real gateway balances (the payment provider remains
the system of record), but it is the platform's own trail for reconciliation,
audits and dispute resolution.
"""
from typing import Optional, Dict, Any
from datetime import datetime
import secrets
import logging

from bson import ObjectId
from app.repositories.ledger_repository import ledger_repository

logger = logging.getLogger(__name__)


def _safe_object_id(value) -> Any:
    """Convert to ObjectId when possible, else keep the raw value. Keeps the
    ledger write-through resilient so a bad id can never block a payment."""
    try:
        return ObjectId(value)
    except Exception:
        return value

ENTRY_TYPES = {
    "payment_received",      # customer paid for an order
    "refund",                # money returned to customer
    "platform_commission",   # platform fee on an order
    "farmer_settlement",     # farmer's share
    "partner_earning",       # delivery partner's share
    "wallet_topup",          # wallet funded
    "wallet_debit",          # wallet used for payment
    "withdrawal",            # money moved out to a bank
    "cod_collected",         # COD cash collected by partner
    "cod_settled",           # COD cash remitted / reconciled
}


class LedgerService:
    """Write-through helper for the financial ledger."""

    @staticmethod
    async def record(
        *,
        amount: float,
        direction: str,  # "credit" | "debit"
        entry_type: str,
        user_id: Optional[str] = None,
        order_id: Optional[str] = None,
        payment_id: Optional[str] = None,
        reference: Optional[str] = None,
        created_by: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        reverses: Optional[str] = None,
    ) -> Optional[str]:
        """Record a ledger entry. Never raises - failures are logged so the
        ledger can never block a financial operation."""
        if entry_type not in ENTRY_TYPES:
            logger.warning("Ledger entry type %r not in known set", entry_type)
        if direction not in ("credit", "debit"):
            logger.error("Invalid ledger direction %r", direction)
            return None

        entry = {
            "txId": f"ledger_{secrets.token_hex(8)}",
            "amount": round(float(amount), 2),
            "direction": direction,
            "type": entry_type,
            "status": "posted",
            "createdAt": datetime.utcnow(),
            "createdBy": created_by or "system",
            "reference": reference,
            "reverses": reverses,
        }
        if user_id:
            entry["userId"] = _safe_object_id(user_id)
        if order_id:
            entry["orderId"] = _safe_object_id(order_id)
        if payment_id:
            entry["paymentId"] = _safe_object_id(payment_id)
        if metadata:
            entry["metadata"] = metadata

        try:
            return await ledger_repository.create_entry(entry)
        except Exception as e:
            logger.error(f"Ledger write failed: {e}")
            return None

    @staticmethod
    async def balance_for_user(user_id: str) -> float:
        try:
            return await ledger_repository.get_balance_for_user(user_id)
        except Exception as e:
            logger.error(f"Ledger balance lookup failed: {e}")
            return 0.0


ledger_service = LedgerService()
