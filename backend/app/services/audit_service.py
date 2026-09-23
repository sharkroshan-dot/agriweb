"""Audit logging service.

Records an immutable trail of privileged / security-relevant actions. Writes
are best-effort and never raise so auditing can never break a business flow.
"""
from typing import Optional, Dict, Any
from datetime import datetime
import logging

from app.repositories.audit_log_repository import audit_log_repository

logger = logging.getLogger(__name__)


class AuditService:
    @staticmethod
    async def log(
        *,
        actor_id: Optional[str],
        actor_role: Optional[str],
        action: str,
        resource: Optional[str] = None,
        resource_id: Optional[str] = None,
        outcome: str = "success",  # success | failure
        ip: Optional[str] = None,
        user_agent: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Write an audit entry. Never raises."""
        try:
            await audit_log_repository.create_log({
                "actorId": actor_id,
                "actorRole": actor_role,
                "action": action,
                "resource": resource,
                "resourceId": resource_id,
                "outcome": outcome,
                "ip": ip,
                "userAgent": user_agent,
                "metadata": metadata or {},
                "createdAt": datetime.utcnow(),
            })
        except Exception as e:
            logger.error(f"Audit write failed for {action}: {e}")


audit_service = AuditService()
