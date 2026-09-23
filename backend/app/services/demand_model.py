"""
Demand forecasting model for the AgriConnect AI demand heatmap.

Two tiers:
  1. Gradient-boosted model (sklearn HistGradientBoostingRegressor) when the
     ML stack is installed. Features are built in pure Python so pandas is
     never required.
  2. A transparent statistical baseline (recent daily rate x momentum x
     seasonality) used on cold start or when sklearn is unavailable.

Nothing heavy is imported at module import time, so the rest of the app loads
even in environments without pandas/sklearn.
"""

import logging
import math
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

_MODEL_NAME = "statistical baseline"
_MODEL_CACHE: Dict[str, Any] = {}
_TRAINED = False

# Rough month multipliers used only for the seasonal component of the
# statistical baseline. Kept conservative so we never over-claim.
_SEASONAL_HINT = {
    1: 1.05, 2: 1.02, 3: 1.08, 4: 1.0, 5: 0.98, 6: 0.95,
    7: 0.95, 8: 0.98, 9: 1.0, 10: 1.05, 11: 1.1, 12: 1.08,
}


def _available() -> bool:
    """True when sklearn is importable (the optional ML stack)."""
    try:
        import sklearn  # noqa: F401
        import numpy  # noqa: F401
        return True
    except Exception:
        return False


def build_features(history: List[Dict[str, Any]]) -> Tuple[List[List[float]], List[float]]:
    """
    Pure-Python feature builder for the daily demand series.

    Each history item: {"date": datetime, "qty": float}
    Features per day: day-of-week, month, day index, lag 1, lag 7, lag 14,
    rolling 7-day mean, rolling 30-day mean, growth vs 7 days ago.
    """
    history = sorted(history, key=lambda h: h["date"])
    n = len(history)
    X: List[List[float]] = []
    y: List[float] = []
    for i in range(n):
        d = history[i]["date"]
        qty = float(history[i]["qty"] or 0)
        feats = [float(d.weekday()), float(d.month), float(i)]
        for lag in (1, 7, 14):
            if i >= lag:
                feats.append(float(history[i - lag]["qty"] or 0))
            else:
                feats.append(0.0)
        win7 = [history[j]["qty"] or 0 for j in range(max(0, i - 6), i + 1)]
        win30 = [history[j]["qty"] or 0 for j in range(max(0, i - 29), i + 1)]
        feats.append(float(sum(win7) / max(1, len(win7))))
        feats.append(float(sum(win30) / max(1, len(win30))))
        if i >= 7:
            prev7 = sum(history[j]["qty"] or 0 for j in range(max(0, i - 14), i - 6))
            feats.append(float((qty - prev7) / max(1.0, prev7)))
        else:
            feats.append(0.0)
        X.append(feats)
        y.append(qty)
    return X, y


def train_if_available(history: List[Dict[str, Any]], key: str) -> Optional[Any]:
    """Fit a gradient-boosted regressor when sklearn is present and data is enough."""
    global _TRAINED, _MODEL_NAME
    if not _available():
        _MODEL_NAME = "statistical baseline"
        return None
    try:
        if len(history) < 30:
            _MODEL_NAME = "statistical baseline (limited history)"
            return None
        from sklearn.ensemble import HistGradientBoostingRegressor
        X, y = build_features(history)
        if len(X) < 30:
            _MODEL_NAME = "statistical baseline (limited history)"
            return None
        model = HistGradientBoostingRegressor(
            max_iter=200, learning_rate=0.08, max_depth=5, random_state=42
        )
        model.fit(X, y)
        _TRAINED = True
        _MODEL_NAME = "gradient-boosted forecast"
        return model
    except Exception as e:
        logger.warning(f"Demand model training failed, using statistical baseline: {e}")
        _TRAINED = False
        _MODEL_NAME = "statistical baseline"
        return None


def forecast_demand(
    history: List[Dict[str, Any]],
    period_days: int,
    growth_pct: float = 0.0,
    target_month: Optional[int] = None,
) -> Tuple[float, float, float, str]:
    """
    Forecast total demand (kg) over the next ``period_days`` days.

    Returns (predicted, low, high, model_name). Tries the gradient-boosted
    model first; otherwise falls back to the transparent statistical baseline.
    """
    if not history:
        return 0.0, 0.0, 0.0, "early estimate"

    model = _MODEL_CACHE.get("gradient")
    if model is None:
        model = train_if_available(history, "gradient")
        if model is not None:
            _MODEL_CACHE["gradient"] = model

    if model is not None:
        try:
            X, _ = build_features(history)
            future = list(X[-1])
            future[0] = float((history[-1]["date"] + timedelta(days=1)).weekday())
            future[1] = float((history[-1]["date"] + timedelta(days=1)).month)
            future[2] = float(len(X))
            daily_pred = float(model.predict([future])[0])
            predicted = max(0.0, daily_pred * period_days)
            spread = 0.10 if len(history) >= 45 else 0.20
            return predicted, predicted * (1 - spread), predicted * (1 + spread), _MODEL_NAME
        except Exception as e:
            logger.warning(f"Demand model prediction failed: {e}")

    # Statistical baseline ------------------------------------------------
    hist = sorted(history, key=lambda h: h["date"])
    recent = hist[-min(len(hist), max(14, period_days * 2)):]
    daily_rate = sum(float(h["qty"] or 0) for h in recent) / max(1, len(recent))
    momentum = 1.0 + (float(growth_pct) / 100.0) * 0.5
    momentum = max(0.7, min(1.4, momentum))
    month = target_month or (datetime.utcnow().month if history else 1)
    season = _SEASONAL_HINT.get(month, 1.0)
    if len(history) >= 60:
        by_month: Dict[int, float] = {}
        for h in hist:
            by_month[h["date"].month] = by_month.get(h["date"].month, 0.0) + float(h["qty"] or 0)
        total = sum(by_month.values()) or 1.0
        observed = by_month.get(month, 0.0)
        if total > 0 and len(by_month) >= 3:
            season = (observed * 12.0 / max(1, len(by_month))) / total
            season = max(0.6, min(1.6, season))

    predicted = daily_rate * period_days * momentum * season
    predicted = max(0.0, predicted)
    spread = 0.15 if len(history) >= 30 else 0.30
    return predicted, predicted * (1 - spread), predicted * (1 + spread), _MODEL_NAME


def model_name() -> str:
    return _MODEL_NAME


def model_available() -> bool:
    return _available()