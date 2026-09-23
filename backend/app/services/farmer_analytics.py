from typing import Optional, Dict, Any, List
from datetime import datetime
from app.repositories.analytics_repository import analytics_repository
import logging

logger = logging.getLogger(__name__)

class FarmerAnalyticsService:
    """Helper service for farmer-specific analytics reports."""

    @staticmethod
    async def get_farmer_report(
        farmer_id: str,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None
    ) -> Dict[str, Any]:
        return await analytics_repository.get_farmer_metrics(
            farmer_id,
            from_date,
            to_date
        )
