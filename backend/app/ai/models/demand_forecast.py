import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, Any, List
from statsmodels.tsa.holtwinters import ExponentialSmoothing
import joblib
import logging
import os

logger = logging.getLogger(__name__)

class DemandForecastModel:
    """Demand forecasting model using Holt-Winters and ML."""

    def __init__(self):
        self.model = None
        self.model_path = "backend/ai/models/demand_forecast.pkl"
        self.seasonal_periods = [7, 30, 365]

    def load_model(self):
        try:
            if os.path.exists(self.model_path):
                self.model = joblib.load(self.model_path)
                logger.info("Demand forecast model loaded successfully")
                return True
            return False
        except Exception as e:
            logger.error(f"Error loading demand forecast model: {str(e)}")
            return False

    def train(self, training_data: List[Dict[str, Any]]) -> Dict[str, Any]:
        try:
            df = pd.DataFrame(training_data)
            df['date'] = pd.to_datetime(df['date'])
            df = df.set_index('date')
            model = ExponentialSmoothing(
                df['demand'],
                trend='add',
                seasonal='add',
                seasonal_periods=7
            )
            fitted = model.fit()
            self.model = fitted
            joblib.dump(self.model, self.model_path)
            return {
                "status": "success",
                "samples": len(training_data),
                "aic": float(getattr(fitted, 'aic', 0)),
                "bic": float(getattr(fitted, 'bic', 0))
            }
        except Exception as e:
            logger.error(f"Error training demand forecast model: {str(e)}")
            return {"status": "failed", "error": str(e)}

    def predict(
        self,
        historical_data: List[Dict[str, Any]],
        days: int = 7
    ) -> Dict[str, Any]:
        try:
            if self.model is None and not self.load_model():
                return self._fallback_predict(historical_data, days)

            df = pd.DataFrame(historical_data)
            df['date'] = pd.to_datetime(df['date'])
            df = df.set_index('date').sort_index()
            forecast = self.model.forecast(days)
            predictions = []
            for i, value in enumerate(forecast):
                date = (datetime.utcnow() + timedelta(days=i+1)).strftime("%Y-%m-%d")
                predictions.append({
                    "day": i + 1,
                    "date": date,
                    "demand": float(value)
                })
            current_demand = float(df['demand'].iloc[-1]) if len(df) > 0 else 0.0
            peak_demand = max(predictions, key=lambda x: x['demand']) if predictions else {"demand": 0}
            recommendation = "Maintain current stock"
            if peak_demand['demand'] > current_demand * 1.2:
                recommendation = f"Increase stock for {peak_demand['date']}"
            elif peak_demand['demand'] < current_demand * 0.8:
                recommendation = "Reduce stock levels"
            return {
                "current_demand": current_demand,
                "predicted_demand": predictions,
                "confidence": 0.82,
                "recommendation": recommendation,
                "seasonal_factors": {
                    "weekly_pattern": self._get_weekly_pattern(df),
                    "monthly_pattern": self._get_monthly_pattern(df)
                }
            }
        except Exception as e:
            logger.error(f"Error making demand forecast: {str(e)}")
            return self._fallback_predict(historical_data, days)

    def _fallback_predict(
        self,
        historical_data: List[Dict[str, Any]],
        days: int
    ) -> Dict[str, Any]:
        df = pd.DataFrame(historical_data)
        if not df.empty:
            df['date'] = pd.to_datetime(df['date'])
            df = df.set_index('date')
        if df.empty:
            return {
                "current_demand": 0.0,
                "predicted_demand": [],
                "confidence": 0.0,
                "recommendation": "No historical demand available",
                "seasonal_factors": {}
            }
        window = min(len(df), 7)
        ma = df['demand'].rolling(window=window).mean().iloc[-1]
        predictions = []
        for i in range(days):
            predictions.append({
                "day": i + 1,
                "date": (datetime.utcnow() + timedelta(days=i+1)).strftime("%Y-%m-%d"),
                "demand": float(ma)
            })
        return {
            "current_demand": float(df['demand'].iloc[-1]),
            "predicted_demand": predictions,
            "confidence": 0.5,
            "recommendation": "Use with caution - using fallback model",
            "seasonal_factors": {}
        }

    def _get_weekly_pattern(self, df: pd.DataFrame) -> Dict[str, float]:
        if len(df) < 7:
            return {}
        df['day_of_week'] = df.index.dayofweek
        weekly_avg = df.groupby('day_of_week')['demand'].mean()
        return {
            "Monday": float(weekly_avg.get(0, 0)),
            "Tuesday": float(weekly_avg.get(1, 0)),
            "Wednesday": float(weekly_avg.get(2, 0)),
            "Thursday": float(weekly_avg.get(3, 0)),
            "Friday": float(weekly_avg.get(4, 0)),
            "Saturday": float(weekly_avg.get(5, 0)),
            "Sunday": float(weekly_avg.get(6, 0))
        }

    def _get_monthly_pattern(self, df: pd.DataFrame) -> Dict[str, float]:
        if len(df) < 30:
            return {}
        df['month'] = df.index.month
        monthly_avg = df.groupby('month')['demand'].mean()
        return {str(i): float(monthly_avg.get(i, 0)) for i in range(1, 13)}


demand_forecast_model = DemandForecastModel()
