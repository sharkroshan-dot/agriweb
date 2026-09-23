from typing import Optional, Dict, Any
from datetime import datetime
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)


class AuditLogRepository(BaseRepository):
    """Append-only audit log. Entries expire after AUDIT_LOG_RETENTION_DAYS."""

    def __init__(self):
        super().__init__("audit_logs")

    async def ensure_ttl_index(self) -> None:
        """TTL index: drop audit entries older than the retention window."""
        try:
            from app.core.config import settings

            await self.collection.create_index(
                "createdAt",
                expireAfterSeconds=max(settings.AUDIT_LOG_RETENTION_DAYS, 7) * 86400,
            )
        except Exception as e:
            logger.error(f"Audit TTL index error: {e}")

    async def create_log(self, data: Dict[str, Any]) -> Optional[str]:
        data.setdefault("createdAt", datetime.utcnow())
        return await self.create(data)


audit_log_repository = AuditLogRepository()