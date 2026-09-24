"""Hybrid anomaly detection: robust MAD baseline plus optional Isolation Forest."""
from typing import Dict, Any, List
import statistics
import logging
import os

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest

logger = logging.getLogger(__name__)


class AnomalyDetectionModel:
    def __init__(self):
        self.model = None
        self.model_path = os.getenv(
            "AGRICONNECT_ANOMALY_MODEL_PATH",
            "backend/app/ai/models/weights/anomaly_detection.pkl",
        )

    def train(self, historical: List[float]) -> Dict[str, Any]:
        values = np.asarray(
            [float(v) for v in historical if v is not None], dtype=float
        ).reshape(-1, 1)
        if len(values) < 30:
            return {"status": "failed", "error": "At least 30 historical values are required"}
        self.model = IsolationForest(
            n_estimators=200, contamination="auto", random_state=42
        )
        self.model.fit(values)
        os.makedirs(os.path.dirname(self.model_path), exist_ok=True)
        joblib.dump(self.model, self.model_path)
        return {
            "status": "success",
            "samples": len(values),
            "model": "isolation_forest",
        }

    def _load(self):
        if self.model is None and os.path.exists(self.model_path):
            try:
                self.model = joblib.load(self.model_path)
            except Exception:
                pass

    def detect(
        self,
        historical: List[float],
        current: float,
        threshold: float = 3.0,
        entity: str = "entity",
        metric: str = "value",
    ) -> Dict[str, Any]:
        try:
            values = [float(v) for v in historical if v is not None]
            if len(values) < 3:
                return self._empty(
                    entity,
                    metric,
                    current,
                    "Insufficient history to detect anomalies",
                )

            median = statistics.median(values)
            mad = statistics.median([abs(v - median) for v in values])
            deviation = (
                mad
                if mad > 0
                else (
                    statistics.pstdev(values)
                    if len(values) > 1
                    else 0
                )
                or max(abs(float(current) - median), 1.0)
            )
            z = (float(current) - median) / deviation
            robust = abs(z) >= float(threshold)

            self._load()
            ml = None
            if self.model is not None and len(values) >= 30:
                ml = int(
                    self.model.predict(np.asarray([[float(current)]]))[0]
                ) == -1

            anomaly = bool(robust or ml)
            method = "mad" if ml is None else "mad_or_isolation_forest"
            direction = "above" if z > 0 else "below"
            reason = (
                f"{metric} is unusually {direction} normal range "
                f"(median {median:.2f}, current {float(current):.2f})"
                if anomaly
                else f"{metric} is within the normal range (median {median:.2f})"
            )
            return {
                "entity": entity,
                "metric": metric,
                "current": float(current),
                "median": round(median, 2),
                "deviation_unit": round(deviation, 2),
                "is_anomaly": anomaly,
                "z_score": round(z, 2),
                "method": method,
                "reason": reason,
            }
        except Exception:
            logger.exception("Error detecting anomaly")
            return self._empty(entity, metric, current, "Unable to detect anomaly")

    def _empty(self, entity, metric, current, reason):
        return {
            "entity": entity,
            "metric": metric,
            "current": float(current),
            "median": float(current),
            "is_anomaly": False,
            "z_score": 0.0,
            "method": "fallback",
            "reason": reason,
        }


anomaly_detection_model = AnomalyDetectionModel()
