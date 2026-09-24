"""Delivery risk: calibrated supervised classifier with explainable fallback scoring."""

from typing import Any, Dict, List
import logging
import os

import joblib
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import f1_score, precision_score, recall_score
from sklearn.model_selection import train_test_split

logger = logging.getLogger(__name__)


class DeliveryRiskModel:
    FEATURES = [
        "distance_km",
        "time_window_minutes",
        "is_cod",
        "quantity_kg",
        "vehicle_capacity",
        "partner_on_time_rate",
        "partner_rating",
        "partner_active_load",
        "previous_delays",
        "rural_roads",
    ]

    def __init__(self):
        self.model = None
        self.threshold = 0.5
        self.model_path = os.getenv(
            "AGRICONNECT_DELIVERY_RISK_MODEL_PATH",
            "backend/app/ai/models/weights/delivery_risk.pkl",
        )
        self.metrics = {}

    def _vector(self, features):
        return np.array(
            [[
                float(bool(features.get("is_cod")))
                if key == "is_cod"
                else float(features.get(key, 0) or 0)
                for key in self.FEATURES
            ]],
            dtype=float,
        )

    def load_model(self):
        try:
            if not os.path.exists(self.model_path):
                return False

            artifact = joblib.load(self.model_path)
            if isinstance(artifact, dict):
                self.model = artifact.get("model")
                self.metrics = artifact.get("metrics", {})
                self.threshold = float(artifact.get("threshold", 0.5))
            else:
                self.model = artifact
                self.threshold = 0.5

            return self.model is not None
        except Exception as exc:
            logger.error("Error loading delivery risk model: %s", exc)
            return False

    def train(self, training_data: List[Dict[str, Any]]) -> Dict[str, Any]:
        if len(training_data) < 40:
            return {
                "status": "failed",
                "error": "At least 40 labeled delivery samples are required",
            }

        try:
            df = pd.DataFrame(training_data)
            target = "late" if "late" in df.columns else "risk_label"

            if target not in df.columns:
                return {
                    "status": "failed",
                    "error": "Training data requires late or risk_label target",
                }

            y = pd.to_numeric(df[target], errors="coerce").fillna(0).astype(int)
            X = df.reindex(columns=self.FEATURES, fill_value=0).astype(float)

            class_counts = y.value_counts().to_dict()
            if len(class_counts) < 2:
                return {
                    "status": "failed",
                    "error": "Delivery training requires both on-time and late samples",
                }

            # Preserve both delivery classes in validation.
            X_train, X_val, y_train, y_val = train_test_split(
                X,
                y,
                test_size=0.25,
                random_state=42,
                stratify=y,
            )

            base = RandomForestClassifier(
                n_estimators=300,
                min_samples_leaf=2,
                class_weight="balanced",
                random_state=42,
                n_jobs=-1,
            )
            model = CalibratedClassifierCV(
                base,
                method="sigmoid",
                cv=3,
            )
            model.fit(X_train, y_train)

            probabilities = model.predict_proba(X_val)[:, 1]

            # Choose the threshold from the validation set rather than
            # assuming 0.50 is appropriate for an imbalanced risk problem.
            thresholds = np.arange(0.20, 0.81, 0.01)
            best_threshold = 0.5
            best_f1 = -1.0

            for threshold in thresholds:
                candidate = (probabilities >= threshold).astype(int)
                score = f1_score(
                    y_val,
                    candidate,
                    zero_division=0,
                )
                if score > best_f1:
                    best_f1 = float(score)
                    best_threshold = float(threshold)

            predictions = (
                probabilities >= best_threshold
            ).astype(int)

            self.model = model
            self.threshold = best_threshold
            self.metrics = {
                "precision": float(
                    precision_score(
                        y_val,
                        predictions,
                        zero_division=0,
                    )
                ),
                "recall": float(
                    recall_score(
                        y_val,
                        predictions,
                        zero_division=0,
                    )
                ),
                "f1": float(
                    f1_score(
                        y_val,
                        predictions,
                        zero_division=0,
                    )
                ),
                "threshold": best_threshold,
                "class_counts": {
                    str(key): int(value)
                    for key, value in class_counts.items()
                },
            }

            os.makedirs(
                os.path.dirname(self.model_path),
                exist_ok=True,
            )

            joblib.dump(
                {
                    "model": model,
                    "metrics": self.metrics,
                    "threshold": self.threshold,
                    "features": self.FEATURES,
                },
                self.model_path,
            )

            from app.ai.evaluation.model_registry import register_model

            register_model(
                "delivery_risk",
                "calibrated-rf-" + pd.Timestamp.utcnow().strftime(
                    "%Y%m%d%H%M%S"
                ),
                "calibrated_random_forest",
                self.metrics,
                len(df),
                self.FEATURES,
            )

            return {
                "status": "success",
                "metrics": self.metrics,
                "samples": len(df),
            }

        except Exception as exc:
            logger.exception(
                "Error training delivery risk model"
            )
            return {
                "status": "failed",
                "error": str(exc),
            }

    def predict(self, features: Dict[str, Any]) -> Dict[str, Any]:
        try:
            if self.model is None:
                self.load_model()

            if self.model is not None:
                probability = float(
                    self.model.predict_proba(
                        self._vector(features)
                    )[0, 1]
                )

                level = (
                    "HIGH"
                    if probability >= 0.7
                    else "MEDIUM"
                    if probability >= 0.35
                    else "LOW"
                )

                return {
                    "risk_score": round(
                        probability * 100,
                        1,
                    ),
                    "risk_level": level,
                    "probability": round(
                        probability,
                        4,
                    ),
                    "confidence": round(
                        abs(probability - 0.5) * 2,
                        2,
                    ),
                    "model": "calibrated_random_forest",
                    "metrics": self.metrics,
                    "factors": self._factor_summary(features),
                    "recommendation": (
                        "Review or reassign before dispatch"
                        if level == "HIGH"
                        else "Monitor delivery"
                        if level == "MEDIUM"
                        else "Proceed with current assignment"
                    ),
                }

            return self._rule_score(features)

        except Exception:
            logger.exception(
                "Error predicting delivery risk"
            )
            return self._rule_score(features)

    def _factor_summary(self, features):
        factors = []
        distance = float(
            features.get("distance_km") or 0
        )
        window = float(
            features.get("time_window_minutes") or 120
        )
        on_time_rate = float(
            features.get("partner_on_time_rate") or 0.9
        )
        load = float(
            features.get("partner_active_load") or 0
        )

        if distance > 15:
            factors.append({
                "factor": "distance",
                "impact": "high",
                "detail": f"{distance:.1f} km route",
            })
        elif distance > 5:
            factors.append({
                "factor": "distance",
                "impact": "medium",
                "detail": f"{distance:.1f} km route",
            })

        if window <= 60:
            factors.append({
                "factor": "time_window",
                "impact": "high" if window <= 30 else "medium",
                "detail": f"{window:.0f} minutes remaining",
            })

        if on_time_rate < 0.8:
            factors.append({
                "factor": "partner_on_time",
                "impact": "high",
                "detail": f"{on_time_rate:.0%} historical on-time rate",
            })

        if load >= 8:
            factors.append({
                "factor": "partner_load",
                "impact": "high",
                "detail": f"{load:.0f} active deliveries",
            })

        return factors[:5]

    def _rule_score(self, features):
        distance = float(features.get("distance_km") or 0)
        window = float(features.get("time_window_minutes") or 120)
        cod = bool(features.get("is_cod"))
        quantity = float(features.get("quantity_kg") or 0)
        capacity = float(features.get("vehicle_capacity") or 0)
        on_time_rate = float(
            features.get("partner_on_time_rate") or 0.9
        )
        load = int(
            features.get("partner_active_load") or 0
        )
        delays = int(
            features.get("previous_delays") or 0
        )
        rural = int(
            features.get("rural_roads") or 0
        )

        score = min(
            100,
            max(
                0,
                (max(0, distance - 5) * 1.5)
                + (
                    20
                    if window <= 30
                    else 12
                    if window <= 60
                    else 0
                )
                + (8 if cod else 0)
                + (
                    25
                    if capacity and quantity > capacity
                    else 15
                    if capacity and quantity > capacity * 0.8
                    else 0
                )
                + (
                    25
                    if on_time_rate < 0.8
                    else 12
                    if on_time_rate < 0.9
                    else 0
                )
                + (
                    15
                    if load >= 8
                    else 8
                    if load >= 5
                    else 0
                )
                + (
                    15
                    if delays >= 3
                    else 6
                    if delays
                    else 0
                )
                + (10 if rural >= 8 else 0),
            ),
        )

        level = (
            "HIGH"
            if score > 70
            else "MEDIUM"
            if score > 30
            else "LOW"
        )

        return {
            "risk_score": round(score, 1),
            "risk_level": level,
            "probability": round(score / 100, 3),
            "confidence": 0.0,
            "model": "explainable_rule_fallback",
            "metrics": {},
            "factors": self._factor_summary(features),
            "recommendation": (
                "Review or reassign before dispatch"
                if level == "HIGH"
                else "Monitor delivery"
                if level == "MEDIUM"
                else "Proceed with current assignment"
            ),
        }


delivery_risk_model = DeliveryRiskModel()
