from typing import Dict, Any, List
import statistics
import logging

logger = logging.getLogger(__name__)


class AnomalyDetectionModel:
    """Anomaly detection over time-series business values.

    Unlike fraud detection (is this malicious?), anomaly detection asks:
    "is this value unusual compared with the normal range?". A farmer suddenly
    selling ₹1,50,000/day instead of ₹5,000-10,000 is flagged for review —
    not because it is fraud, but because it deserves a look (could be a large
    B2B order).

    Uses a robust median + median-absolute-deviation threshold so outliers in
    the history itself do not distort the "normal" band. Falls back to
    mean/std when MAD is zero.
    """

    def __init__(self):
        self.model_path = "backend/ai/models/anomaly_detection.pkl"

    def detect(
        self,
        historical: List[float],
        current: float,
        threshold: float = 3.0,
        entity: str = "entity",
        metric: str = "value",
    ) -> Dict[str, Any]:
        """Check whether ``current`` deviates from ``historical``.

        Args:
            historical: list of past observed values (e.g. daily sales).
            current:    the value to test.
            threshold:  number of deviations (MAD or std) that counts as anomaly.
            entity:     label for the entity being checked (for reporting).
            metric:     label for the metric being checked.
        """
        try:
            if not historical:
                return {
                    "entity": entity,
                    "metric": metric,
                    "current": current,
                    "median": current,
                    "is_anomaly": False,
                    "z_score": 0.0,
                    "reason": "Insufficient history to detect anomalies",
                }

            values = [float(v) for v in historical if v is not None]
            if not values:
                return {
                    "entity": entity,
                    "metric": metric,
                    "current": current,
                    "median": current,
                    "is_anomaly": False,
                    "z_score": 0.0,
                    "reason": "Insufficient history to detect anomalies",
                }

            median = statistics.median(values)
            mad = statistics.median([abs(v - median) for v in values])

            # Scale: when MAD is ~0 (flat series), use std as the deviation unit.
            if mad > 0:
                deviation = mad
            else:
                stdev = statistics.pstdev(values) if len(values) > 1 else 0.0
                deviation = stdev if stdev > 0 else max(abs(current - median) or 1.0, 1.0)

            z_score = (float(current) - median) / deviation
            is_anomaly = abs(z_score) >= threshold

            if is_anomaly:
                direction = "above" if z_score > 0 else "below"
                reason = (
                    f"{metric} is unusually {direction} normal range "
                    f"(median {median:.2f}, current {float(current):.2f})"
                )
            else:
                reason = f"{metric} is within the normal range (median {median:.2f})"

            return {
                "entity": entity,
                "metric": metric,
                "current": float(current),
                "median": round(median, 2),
                "deviation_unit": round(deviation, 2),
                "is_anomaly": bool(is_anomaly),
                "z_score": round(z_score, 2),
                "reason": reason,
            }
        except Exception as e:
            logger.error(f"Error detecting anomaly: {str(e)}")
            return {
                "entity": entity,
                "metric": metric,
                "current": float(current),
                "median": float(current),
                "is_anomaly": False,
                "z_score": 0.0,
                "reason": "Unable to detect anomaly",
            }


anomaly_detection_model = AnomalyDetectionModel()