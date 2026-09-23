import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, Any, List
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
import joblib
import logging
import os

logger = logging.getLogger(__name__)

class PricePredictionModel:
    """Price prediction model using Random Forest with persisted scaler."""

    def __init__(self):
        self.model = None
        self.scaler = StandardScaler()
        self.model_path = os.getenv(
            "AGRICONNECT_PRICE_MODEL_PATH",
            "backend/app/ai/models/weights/price_prediction.pkl",
        )
        self.features = [
            "price_lag_1", "price_lag_3", "price_lag_7",
            "day_of_week", "month", "quarter",
            "demand_score", "weather_score", "competition_score",
        ]

    def load_model(self):
        try:
            if not os.path.exists(self.model_path):
                return False
            artifact = joblib.load(self.model_path)
            if isinstance(artifact, dict) and "model" in artifact:
                self.model = artifact["model"]
                self.scaler = artifact.get("scaler", StandardScaler())
            else:
                self.model = artifact
            logger.info("Price prediction model loaded successfully")
            return True
        except Exception as e:
            logger.error("Error loading price prediction model: %s", e)
            return False

    def save_model(self):
        try:
            os.makedirs(os.path.dirname(self.model_path), exist_ok=True)
            joblib.dump({"model": self.model, "scaler": self.scaler}, self.model_path)
            return True
        except Exception as e:
            logger.error("Error saving price prediction model: %s", e)
            return False

    def train(self, training_data: List[Dict[str, Any]]) -> Dict[str, Any]:
        if len(training_data) < 10:
            return {"status": "failed", "error": "At least 10 training samples are required"}
        try:
            df = pd.DataFrame(training_data)
            X = self._prepare_features(df)
            y = df["price"].astype(float).values
            X_train, X_test, y_train, y_test = train_test_split(
                X, y, test_size=0.2, random_state=42
            )
            X_train_scaled = self.scaler.fit_transform(X_train)
            X_test_scaled = self.scaler.transform(X_test)
            self.model = RandomForestRegressor(
                n_estimators=100, max_depth=10, min_samples_split=5,
                random_state=42, n_jobs=-1
            )
            self.model.fit(X_train_scaled, y_train)
            self.save_model()
            return {
                "status": "success",
                "train_score": float(self.model.score(X_train_scaled, y_train)),
                "test_score": float(self.model.score(X_test_scaled, y_test)),
                "feature_importance": dict(zip(self.features, self.model.feature_importances_)),
                "samples": len(training_data),
            }
        except Exception as e:
            logger.error("Error training price prediction model: %s", e)
            return {"status": "failed", "error": str(e)}

    def predict(self, product_data: Dict[str, Any], days: int = 7) -> Dict[str, Any]:
        try:
            if self.model is None and not self.load_model():
                return self._fallback_predict(product_data, days)
            days = max(1, min(int(days), 30))
            current_price = float(product_data.get("price", 0) or 0)
            predictions = []
            rolling = dict(product_data)
            for i in range(days):
                features = self._prepare_features(pd.DataFrame([rolling]))
                pred = float(self.model.predict(self.scaler.transform(features))[0])
                pred = max(0.0, pred)
                predictions.append({
                    "day": i + 1,
                    "date": (datetime.utcnow() + timedelta(days=i + 1)).strftime("%Y-%m-%d"),
                    "price": pred,
                })
                rolling["price_lag_7"] = rolling.get("price_lag_3", current_price)
                rolling["price_lag_3"] = rolling.get("price_lag_1", current_price)
                rolling["price_lag_1"] = pred
            last_price = predictions[-1]["price"]
            trend = "upward" if last_price > current_price * 1.05 else (
                "downward" if last_price < current_price * 0.95 else "stable"
            )
            return {
                "current_price": current_price,
                "predicted_price": last_price,
                "trend": trend,
                "confidence": 0.85,
                "recommendation": (
                    "Consider selling now" if trend == "upward"
                    else "Wait for better prices" if trend == "downward"
                    else "Hold"
                ),
                "predictions": predictions,
                "factors": {},
            }
        except Exception as e:
            logger.error("Error making price prediction: %s", e)
            return self._fallback_predict(product_data, days)

    def _fallback_predict(self, product_data: Dict[str, Any], days: int) -> Dict[str, Any]:
        current_price = float(product_data.get("price", 0) or 0)
        days = max(1, min(int(days), 30))
        # Deterministic fallback: no random predictions presented as AI output.
        predictions = [{
            "day": i + 1,
            "date": (datetime.utcnow() + timedelta(days=i + 1)).strftime("%Y-%m-%d"),
            "price": current_price,
        } for i in range(days)]
        return {
            "current_price": current_price,
            "predicted_price": current_price,
            "trend": "stable",
            "confidence": 0.0,
            "recommendation": "Insufficient model data; no price change assumed",
            "predictions": predictions,
            "factors": {},
        }

    def _prepare_features(self, df: pd.DataFrame) -> np.ndarray:
        features = np.zeros((len(df), len(self.features)))
        for idx, col in enumerate(self.features):
            if col in df.columns:
                features[:, idx] = pd.to_numeric(df[col], errors="coerce").fillna(0).values
        return features

price_prediction_model = PricePredictionModel()
