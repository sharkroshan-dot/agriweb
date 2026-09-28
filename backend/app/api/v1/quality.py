"""Quality inspection records for farmer harvest lots.

Farmers record a declared grade, size, freshness %, damaged %, verified weight
and photo proof against a harvest lot (batch). A farmer's declared grade is
never trusted as-is: a non-farmer actor (admin, warehouse QC or an independent
inspector) must verify it before it becomes the customer-visible grade.

Verification propagates automatically: inspection -> batch -> product.

Collections:
  - quality_inspections: one inspection per lot / inspection event
"""
from datetime import datetime
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from bson import ObjectId
import logging

from app.api.v1.auth import get_current_user
from app.repositories.base_repository import BaseRepository
from app.repositories.product_repository import product_repository
from app.services.quality_ai import assess_quality
from app.core.quality import (
    VERIFICATION_STATUS_DECLARED,
    VERIFICATION_STATUS_EVIDENCE,
    VERIFICATION_STATUS_VERIFIED,
    VERIFICATION_STATUS_BUYER,
    VERIFICATION_STATUS_REJECTED,
    VERIFICATION_METHOD_MANUAL,
    VERIFICATION_METHOD_WAREHOUSE_QC,
    VERIFICATION_METHOD_BUYER,
    VERIFICATION_METHOD_AI,
    VERIFICATION_STATUSES,
    VERIFICATION_METHODS,
    base_verification_fields,
    effective_grade,
)

logger = logging.getLogger(__name__)
router = APIRouter()

inspection_repo = BaseRepository("quality_inspections")
batch_repo = BaseRepository("batches")

VALID_GRADES = ("A", "B", "C")

STATUS_PASSED = "passed"
STATUS_REVIEW = "review"
STATUS_FAILED = "failed"

# Only authorized non-farmer actors can perform or verify inspections.
VERIFIER_ROLES = ("admin", "warehouse")

INSPECTION_SLA_HOURS = {
    "normal": 6,
    "refrigerated": 8,
    "cold_storage": 12,
    "frozen": 24,
}

def _inspection_priority(expires_at: Optional[datetime], urgent: bool = False) -> str:
    if urgent:
        return "critical"
    if not expires_at:
        return "normal"
    hours_left = (expires_at - datetime.utcnow()).total_seconds() / 3600
    if hours_left <= 24:
        return "critical"
    if hours_left <= 48:
        return "urgent"
    return "normal"}