"""Shelf-life rules for crop/batch freshness."""
from __future__ import annotations
from datetime import datetime, timedelta
from typing import Any, Optional

def effective_shelf_life_days(master_crop: Optional[dict], storage_type: str, actual_days: Any = None) -> int:
    if actual_days is not None:
        try:
            value = int(actual_days)
            if value > 0:
                return value
        except (TypeError, ValueError):
            pass
    master = master_crop or {}
    storage = master.get("storageShelfLifeDays") or {}
    value = storage.get(storage_type) or master.get("defaultShelfLifeDays")
    if value:
        return int(value)
    return {"normal": 3, "refrigerated": 5, "cold_storage": 7, "frozen": 30}.get(storage_type, 3)

def safe_delivery_date(harvest_date: datetime, shelf_life_days: int, buffer_hours: int = 24) -> datetime:
    return harvest_date + timedelta(days=int(shelf_life_days)) - timedelta(hours=max(0, int(buffer_hours)))

def expiry_date(harvest_date: datetime, shelf_life_days: int) -> datetime:
    return harvest_date + timedelta(days=int(shelf_life_days))
