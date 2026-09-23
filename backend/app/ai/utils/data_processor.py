"""Input normalization and validation utilities for AI models."""
from datetime import datetime
from typing import Any, Dict, Iterable, List


def normalize_numeric_features(
    features: Dict[str, Any], names: Iterable[str]
) -> Dict[str, float]:
    result: Dict[str, float] = {}
    for name in names:
        value = features.get(name, 0)
        try:
            result[name] = float(value or 0)
        except (TypeError, ValueError):
            result[name] = 0.0
    return result


def normalize_demand_history(history: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized = []
    for row in history:
        if not row.get("date"):
            continue
        try:
            date = row["date"]
            if not isinstance(date, datetime):
                date = datetime.fromisoformat(str(date).replace("Z", "+00:00"))
            normalized.append({"date": date, "demand": float(row.get("demand", 0) or 0)})
        except (TypeError, ValueError):
            continue
    return sorted(normalized, key=lambda item: item["date"])
