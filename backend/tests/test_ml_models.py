from app.ai.models.price_prediction import PricePredictionModel
from app.ai.models.demand_forecast import DemandForecastModel
from app.ai.models.delivery_risk import DeliveryRiskModel
from app.ai.models.anomaly_detection import AnomalyDetectionModel

def price_rows(n=60):
    return [{"date":f"2026-01-{(i%28)+1:02d}","price":100+i*.3,"demand_score":1+i*.01,"weather_score":.5,"competition_score":.2} for i in range(n)]

def demand_rows(n=60):
    return [{"date":f"2026-01-{(i%28)+1:02d}","demand":20+(i%7)*2+i*.1} for i in range(n)]

def test_price_requires_enough_data():
    result=PricePredictionModel().train(price_rows(10))
    assert result["status"]=="failed"

def test_demand_requires_enough_data():
    result=DemandForecastModel().train(demand_rows(10))
    assert result["status"]=="failed"

def test_delivery_fallback_has_zero_confidence(tmp_path):
    model = DeliveryRiskModel()
    model.model_path = str(tmp_path / "missing-delivery-model.pkl")
    result = model.predict({"distance_km":20,"time_window_minutes":30,"is_cod":1})
    assert result["confidence"]==0.0
    assert result["model"]=="explainable_rule_fallback"

def test_anomaly_insufficient_history_is_explicit():
    result=AnomalyDetectionModel().detect([10,11],10,"orders","daily_orders")
    assert result["is_anomaly"] is False
    assert "Insufficient" in result["reason"]
