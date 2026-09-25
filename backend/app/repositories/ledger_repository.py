from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)


class LedgerRepository(BaseRepository):
    """Immutable financial ledger repository (append-only entries)."""

    def __init__(self):
        super().__init__("ledger_entries")

    async def create_entry(self, entry: Dict[str, Any]) -> Optional[str]:
        """Create an immutable ledger entry."""
        entry.setdefault("createdAt", datetime.utcnow())
        # Entries are never soft-deleted or mutated; a correction is a new entry
        # linked to the original via `reverses`. Stable references make webhook
        # and worker retries idempotent.
        if entry.get("reference"):
            try:
                existing = await self.find_one({
                    "reference": entry["reference"],
                    "type": entry.get("type"),
                    "direction": entry.get("direction"),
                    "amount": entry.get("amount"),
                    "deletedAt": None,
                })
                if existing:
                    return str(existing["_id"])
            except Exception as e:
                logger.warning("Ledger idempotency lookup failed: %s", e)
        return await self.create(entry)

    async def get_by_reference(self, ref_type: str, ref_id: str) -> List[Dict[str, Any]]:
        """Get all entries referencing a business object (order, payment, user)."""
        try:
            return await self.find_many(
                {f"{ref_type}Id": ObjectId(ref_id), "deletedAt": None},
                sort=[("createdAt", 1)],
            )
        except Exception as e:
            logger.error(f"Ledger lookup error: {e}")
            return []

    async def get_balance_for_user(self, user_id: str) -> float:
        """Net amount for a user across all entries (credits - debits)."""
        try:
            pipeline = [
                {"$match": {"userId": ObjectId(user_id), "deletedAt": None}},
                {
                    "$group": {
                        "_id": None,
                        "credits": {"$sum": {"$cond": [{"$eq": ["$direction", "credit"]}, "$amount", 0]}},
                        "debits": {"$sum": {"$cond": [{"$eq": ["$direction", "debit"]}, "$amount", 0]}},
                    }
                },
            ]
            result = await self.aggregate(pipeline)
            if not result:
                return 0.0
            return round(float(result[0].get("credits", 0)) - float(result[0].get("debits", 0)), 2)
        except Exception as e:
            logger.error(f"Ledger balance error: {e}")
            return 0.0


ledger_repository = LedgerRepository()
