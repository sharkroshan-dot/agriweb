import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, Any, List
from statsmodels.tsa.holtwinters import ExponentialSmoothing
import joblib
import logging
import os

logger = logging.getLogger(__name__)

class DemandForecastModel:
    """Demand forecasting using Holt-Winters with persisted model artifacts."""
    def __init__(self):
        self.model = None
        self.model_path = os.getenv("AGRICONNECT_DEMAND_MODEL_PATH", "backend/app/ai/models/weights/demand_forecast.pkl")
    def load_model(self):
        try:
            if os.path.exists(self.model_path):
                self.model = joblib.load(self.model_path)
                return True
            return False
        except Exception as e:
            logger.error("Error loading demand forecast model: %s", e)
            return False
    def train(self, training_data: List[Dict[str, Any]]) -> Dict[str, Any]:
        if len(training_data) < 14:
            return {"status": "failed", "error": "At least 14 training samples are required"}
        try:
            df = pd.DataFrame(training_data)
            df["date"] = pd.to_datetime(df["date"], errors="coerce")
            df["demand"] = pd.to_numeric(df["demand"], errors="coerce")
            df = df.dropna(subset=["date", "demand"]).sort_values("date").set_index("date")
            if len(df) < 14:
                return {"status": "failed", "error": "At least 14 valid demand samples are required"}
            model = ExponentialSmoothing(df["demand"], trend="add", seasonal="add", seasonal_periods=7).fit()
            os.makedirs(os.path.dirname(self.model_path), exist_ok=True)
            joblib.dump(model, self.model_path)
            self.model = model
            return {"status": "success", "samples": len(df), "aic": float(getattr(model, "aic", 0)), "bic": float(getattr(model, "bic", 0))}
        except Exception as e:
            logger.error("Error training demand forecast model: %s", e)
            return {"status": "failed", "error": str(e)}
    def predict(self, historical_data: List[Dict[str, Any]], days: int = 7) -> Dict[str, Any]:
        days = max(1, min(int(days), 30))
        try:
            df = pd.DataFrame(historical_data)
            df["date"] = pd.to_datetime(df["date"], errors="coerce")
            df["demand"] = pd.to_numeric(df["demand"], errors="coerce")
            df = df.dropna(subset=["date", "demand"]).sort_values("date").set_index("date")
            if len(df) < 2:
                return self._fallback_predict(historical_data, days)
            if self.model is None and not self.load_model():
                return self._fallback_predict(historical_data, days)
            forecast = self.model.forecast(days)
            predictions = [{"day": i + 1, "date": (datetime.utcnow() + timedelta(days=i + 1)).strftime("%Y-%m-%d"), "demand": max(0.0, float(value))} for i, value in enumerate(forecast)]
            current = float(df["demand"].iloc[-1])
            peak = max(predictions, key=lambda x: x["demand"])
            return {"current_demand": current, "predicted_demand": predictions, "confidence": 0.82,
                    "recommendation": f"Increase stock for {peak['date']}" if peak["demand"] > current * 1.2 else ("Reduce stock levels" if peak["demand"] < current * 0.8 else "Maintain current stock"),
                    "seasonal_factors": {"weekly_pattern": self._get_weekly_pattern(df), "monthly_pattern": self._get_monthly_pattern(df)}}
        except Exception as e:
            logger.error("Error making demand forecast: %s", e)
            return self._fallback_predict(historical_data, days)
    def _fallback_predict(self, historical_data: List[Dict[str, Any]], days: int) -> Dict[str, Any]:
        df = pd.DataFrame(historical_data)
        demand = pd.to_numeric(df.get("demand", pd.Series(dtype=float)), errors="coerce").dropna()
        if demand.empty:
            return {"current_demand": 0.0, "predicted_demand": [], "confidence": 0.0, "recommendation": "No valid demand history available", "seasonal_factors": {}}
        average = float(demand.tail(min(7, len(demand))).mean())
        return {"current_demand": float(demand.iloc[-1]), "predicted_demand": [{"day": i + 1, "date": (datetime.utcnow() + timedelta(days=i + 1)).strftime("%Y-%m-%d"), "demand": average} for i in range(days)], "confidence": 0.0, "recommendation": "Insufficient model data; using recent average", "seasonal_factors": {}}
    def _get_weekly_pattern(self, df):
        if len(df) < 7: return {}
        work = df.copy(); work["day_of_week"] = work.index.dayofweek; averages = work.groupby("day_of_week")["demand"].mean()
        return {name: float(averages.get(i, 0)) for i, name in enumerate(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"])}
    def _get_monthly_pattern(self, df):
        if len(df) < 30: return {}
        work = df.copy(); work["month"] = work.index.month; averages = work.groupby("month")["demand"].mean()
        return {str(i): float(averages.get(i, 0)) for i in range(1, 13)}

demand_forecast_model = DemandForecastModel()
