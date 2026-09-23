"""Reusable prediction orchestration helpers for AgriConnect AI."""
from typing import Any, Dict, List

from app.ai.models.price_prediction import price_prediction_model
from app.ai.models.demand_forecast import demand_forecast_model
from app.ai.models.delivery_risk import delivery_risk_model


def predict_price(product_data: Dict[str, Any], days: int = 7) -> Dict[str, Any]:
    return price_prediction_model.predict(dict(product_data), days)


def forecast_demand(history: List[Dict[str, Any]], days: int = 7) -> Dict[str, Any]:
    return demand_forecast_model.predict(history, days)


def predict_delivery_risk(features: Dict[str, Any]) -> Dict[str, Any]:
    return delivery_risk_model.predict(features)
