from typing import Any, Dict, Optional
from app.repositories.settings_repository import user_settings_repository
import logging

logger = logging.getLogger(__name__)

DEFAULT_FARMER_SETTINGS: Dict[str, Dict[str, bool]] = {
    "ai": {
        "pricePrediction": True,
        "demandForecast": True,
        "weatherIntegration": True,
        "smartRecommendations": True,
        "dailyReport": True,
        "weeklyReport": False,
        "monthlyReport": False,
    },
    "alerts": {
        "newOrderAlert": True,
        "orderCancelled": True,
        "paymentReceived": True,
        "lowStockAlerts": True,
        "autoAcceptSmallOrders": False,
    },
}


class FarmerSettingsService:
    """Reads a farmer's saved settings (from /settings/mine) with defaults."""

    @staticmethod
    async def get_settings(farmer_id: str) -> Dict[str, Any]:
        doc = await user_settings_repository.get_by_user(farmer_id, "farmer")
        saved = doc.get("data", {}) if doc else {}
        merged: Dict[str, Any] = {}
        for section, defaults in DEFAULT_FARMER_SETTINGS.items():
            merged[section] = {**defaults, **(saved.get(section) or {})}
        return merged

    @staticmethod
    async def flag_enabled(farmer_id: str, section: str, key: str, default: bool = True) -> bool:
        try:
            settings = await FarmerSettingsService.get_settings(farmer_id)
            return bool(settings.get(section, {}).get(key, default))
        except Exception as exc:
            logger.debug(f"Farmer settings lookup failed ({farmer_id}, {section}.{key}): {exc}")
            return default

    @staticmethod
    async def ai_enabled(farmer_id: str, key: str, default: bool = True) -> bool:
        return await FarmerSettingsService.flag_enabled(farmer_id, "ai", key, default)

    @staticmethod
    async def alert_enabled(farmer_id: str, key: str, default: bool = True) -> bool:
        return await FarmerSettingsService.flag_enabled(farmer_id, "alerts", key, default)


farmer_settings_service = FarmerSettingsService()