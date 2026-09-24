"""Reusable prediction orchestration helpers for AgriConnect AI."""
from typing import Any, Dict, List

from app.ai.models.price_prediction import price_prediction_model
from app.ai.models.demand_forecast import demand_forecast_model
from app.ai.models.delivery_risk import delivery_risk_model
from app.ai.models.anomaly_detection import anomaly_detection_model


def predict_price(product_data: Dict[str, Any], days: int = 7) -> Dict[str, Any]:
    return price_prediction_model.predict(dict(product_data), days)


def forecast_demand(history: List[Dict[str, Any]], days: int = 7) -> Dict[str, Any]:
    return demand_forecast_model.predict(history, days)


def predict_delivery_risk(features: Dict[str, Any]) -> Dict[str, Any]:
    return delivery_risk_model.predict(features)


def detect_anomaly(history: List[float], current: float, entity: str = "entity", metric: str = "value") -> Dict[str, Any]:
    return anomaly_detection_model.detect(history, current, entity=entity, metric=metric)

from app.ai.models.crop_recommendation import crop_recommendation_model
from app.ai.models.yield_prediction import yield_prediction_model
from app.ai.models.harvest_planning import harvest_planning_model
from app.ai.models.inventory_forecast import inventory_forecast_model
from app.ai.models.quality_assessment import quality_assessment_model


def recommend_crop(features: Dict[str, Any], limit: int = 5) -> Dict[str, Any]:
    return crop_recommendation_model.recommend(features, limit)


def predict_yield(features: Dict[str, Any]) -> Dict[str, Any]:
    return yield_prediction_model.predict(features)


def plan_harvest(crop: str, expected_yield_kg: float, demand_forecast: float, predicted_price: float, current_inventory: float = 0, days_to_maturity: int = 0) -> Dict[str, Any]:
    return harvest_planning_model.plan(crop, expected_yield_kg, demand_forecast, predicted_price, current_inventory, days_to_maturity)


def forecast_inventory(current_stock: float, historical_daily_demand: List[float], days: int = 7) -> Dict[str, Any]:
    return inventory_forecast_model.predict(current_stock, historical_daily_demand, days)


def assess_quality(image_features: Dict[str, Any]) -> Dict[str, Any]:
    return quality_assessment_model.predict(image_features)
