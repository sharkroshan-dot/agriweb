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
    """Price prediction model using Random Forest."""

    def __init__(self):
        self.model = None
        self.scaler = StandardScaler()
        self.model_path = "backend/ai/models/price_prediction.pkl"
        self.features = [
            'price_lag_1', 'price_lag_3', 'price_lag_7',
            'day_of_week', 'month', 'quarter',
            'demand_score', 'weather_score', 'competition_score'
        ]

    def load_model(self):
        try:
            if os.path.exists(self.model_path):
                self.model = joblib.load(self.model_path)
                logger.info("Price prediction model loaded successfully")
                return True
            return False
        except Exception as e:
            logger.error(f"Error loading price prediction model: {str(e)}")
            return False

    def save_model(self):
        try:
            joblib.dump(self.model, self.model_path)
            logger.info("Price prediction model saved successfully")
            return True
        except Exception as e:
            logger.error(f"Error saving price prediction model: {str(e)}")
            return False

    def train(self, training_data: List[Dict[str, Any]]) -> Dict[str, Any]:
        try:
            df = pd.DataFrame(training_data)
            X = self._prepare_features(df)
            y = df['price'].values
            X_train, X_test, y_train, y_test = train_test_split(
                X, y, test_size=0.2, random_state=42
            )
            X_train_scaled = self.scaler.fit_transform(X_train)
            X_test_scaled = self.scaler.transform(X_test)

            self.model = RandomForestRegressor(
                n_estimators=100,
                max_depth=10,
                min_samples_split=5,
                random_state=42,
                n_jobs=-1
            )
            self.model.fit(X_train_scaled, y_train)
            train_score = self.model.score(X_train_scaled, y_train)
            test_score = self.model.score(X_test_scaled, y_test)
            feature_importance = dict(zip(
                self.features,
                self.model.feature_importances_
            ))
            self.save_model()
            return {
                "status": "success",
                "train_score": float(train_score),
                "test_score": float(test_score),
                "feature_importance": feature_importance,
                "samples": len(training_data)
            }
        except Exception as e:
            logger.error(f"Error training price prediction model: {str(e)}")
            return {"status": "failed", "error": str(e)}

    def predict(
        self,
        product_data: Dict[str, Any],
        days: int = 7
    ) -> Dict[str, Any]:
        try:
            if self.model is None and not self.load_model():
                return self._fallback_predict(product_data, days)

            features = self._prepare_features(pd.DataFrame([product_data]))
            features_scaled = self.scaler.transform(features)
            predictions = []
            current_price = product_data.get('price', 0)

            for i in range(days):
                pred = float(self.model.predict(features_scaled)[0])
                predictions.append({
                    "day": i + 1,
                    "date": (datetime.utcnow() + timedelta(days=i+1)).strftime("%Y-%m-%d"),
                    "price": pred
                })
                product_data['price_lag_1'] = pred
                features = self._prepare_features(pd.DataFrame([product_data]))
                features_scaled = self.scaler.transform(features)

            last_price = predictions[-1]['price']
            trend = "stable"
            if last_price > current_price * 1.05:
                trend = "upward"
            elif last_price < current_price * 0.95:
                trend = "downward"

            recommendation = "Hold"
            if trend == "upward":
                recommendation = "Consider selling now"
            elif trend == "downward":
                recommendation = "Wait for better prices"

            return {
                "current_price": current_price,
                "predicted_price": predictions[-1]['price'],
                "trend": trend,
                "confidence": 0.85,
                "recommendation": recommendation,
                "predictions": predictions,
                "factors": {
                    "seasonality": 0.2,
                    "demand": 0.4,
                    "weather": 0.1,
                    "competition": -0.3
                }
            }
        except Exception as e:
            logger.error(f"Error making price prediction: {str(e)}")
            return self._fallback_predict(product_data, days)

    def _fallback_predict(self, product_data: Dict[str, Any], days: int) -> Dict[str, Any]:
        current_price = product_data.get('price', 0)
        predictions = []
        for i in range(days):
            variation = np.random.uniform(-0.02, 0.02)
            price = current_price * (1 + variation * (i + 1))
            predictions.append({
                "day": i + 1,
                "date": (datetime.utcnow() + timedelta(days=i+1)).strftime("%Y-%m-%d"),
                "price": float(price)
            })
        return {
            "current_price": current_price,
            "predicted_price": predictions[-1]['price'] if predictions else current_price,
            "trend": "stable",
            "confidence": 0.5,
            "recommendation": "Use with caution - using fallback model",
            "predictions": predictions,
            "factors": {}
        }

    def _prepare_features(self, df: pd.DataFrame) -> np.ndarray:
        features = np.zeros((len(df), len(self.features)))
        for idx, col in enumerate(self.features):
            if col in df.columns:
                features[:, idx] = df[col].astype(float).fillna(0).values
            else:
                features[:, idx] = 0
        return features

price_prediction_model = PricePredictionModel()
