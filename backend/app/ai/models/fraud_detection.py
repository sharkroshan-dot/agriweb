from typing import Dict, Any, List
import logging

logger = logging.getLogger(__name__)


class FraudDetectionModel:
    """Order-level fraud detection model.

    Detects suspicious behavior around COD, cancellations, refunds, coupons and
    payment failures. Produces a risk score 0-100 plus a level and flags.

    IMPORTANT: a high score must NEVER trigger an automatic ban. It should
    only route the order to manual review / additional verification.

    Risk buckets (matching the AgriConnect spec):
        0-30   LOW  (green)
        31-70  MEDIUM (yellow)
        71-100 HIGH (red)
    """

    def __init__(self):
        self.model_path = "backend/ai/models/fraud_detection.pkl"

    def predict(self, features: Dict[str, Any]) -> Dict[str, Any]:
        """Predict fraud risk for an order/customer.

        Expected feature keys (all optional):
          cod_cancellation_rate  float 0-1 - fraction of past COD orders cancelled
          order_value            float - current order value
          customer_avg_order     float - customer's average past order value
          refund_frequency       int   - refunds requested in past 90 days
          account_age_days       float - account age
          failed_payments        int   - recent payment failures
          coupon_used            bool  - current order uses a coupon
          coupon_orders          int   - fraction-like count of coupon usage in past 90 days
          is_cod                 bool  - current order is COD
          recent_cancellations   int   - cancellations in past 30 days
          payment_method_changes int   - times payment method changed recently
        """
        try:
            factors: List[Dict[str, Any]] = []
            score = 0.0

            cod_cancel = float(features.get("cod_cancellation_rate") or 0)
            order_value = float(features.get("order_value") or 0)
            avg_order = float(features.get("customer_avg_order") or 0)
            refunds = int(features.get("refund_frequency") or 0)
            age_days = float(features.get("account_age_days") or 365)
            failed = int(features.get("failed_payments") or 0)
            coupon_used = bool(features.get("coupon_used"))
            coupon_orders = int(features.get("coupon_orders") or 0)
            is_cod = bool(features.get("is_cod"))
            cancellations = int(features.get("recent_cancellations") or 0)
            method_changes = int(features.get("payment_method_changes") or 0)

            # Repeat COD cancellations are the strongest signal (see spec example).
            if cod_cancel >= 0.75:
                score += 30
                factors.append({"factor": "cod_cancellations", "impact": "high", "detail": "Most COD orders are cancelled", "points": 30})
            elif cod_cancel >= 0.5:
                score += 18
                factors.append({"factor": "cod_cancellations", "impact": "medium", "detail": "Half of COD orders are cancelled", "points": 18})

            if cancellations >= 4:
                score += 20
                factors.append({"factor": "recent_cancellations", "impact": "high", "detail": f"{cancellations} cancellations in 30 days", "points": 20})
            elif cancellations >= 2:
                score += 10
                factors.append({"factor": "recent_cancellations", "impact": "medium", "detail": f"{cancellations} cancellations in 30 days", "points": 10})

            # Order value far above the customer's normal basket.
            if avg_order > 0 and order_value > avg_order * 2.5:
                score += 15
                factors.append({"factor": "unusual_order_value", "impact": "medium", "detail": "Order value well above customer average", "points": 15})

            if order_value >= 10000:
                score += 10
                factors.append({"factor": "high_value", "impact": "medium", "detail": "High value order", "points": 10})

            if refunds >= 3:
                score += 12
                factors.append({"factor": "refund_frequency", "impact": "medium", "detail": "Frequent refund requests", "points": 12})

            if failed >= 3:
                score += 10
                factors.append({"factor": "payment_failures", "impact": "medium", "detail": "Repeated payment failures", "points": 10})
            elif failed >= 1 and is_cod:
                score += 5
                factors.append({"factor": "payment_failures", "impact": "low", "detail": "Prior payment failure on COD", "points": 5})

            if age_days < 7:
                score += 10
                factors.append({"factor": "young_account", "impact": "medium", "detail": "Account created less than a week ago", "points": 10})

            if coupon_used:
                score += 8
                factors.append({"factor": "coupon_usage", "impact": "low", "detail": "Coupon applied to order", "points": 8})

            if coupon_orders >= 5:
                score += 6
                factors.append({"factor": "coupon_abuse", "impact": "low", "detail": "Unusually high coupon usage", "points": 6})

            if method_changes >= 2:
                score += 8
                factors.append({"factor": "payment_method_changes", "impact": "low", "detail": "Payment method changed repeatedly", "points": 8})

            score = min(100.0, max(0.0, score))
            level = "LOW" if score <= 30 else ("MEDIUM" if score <= 70 else "HIGH")

            if level == "LOW":
                recommendation = "Proceed normally"
            elif level == "MEDIUM":
                recommendation = "Monitor this order"
            else:
                recommendation = "Require additional verification before dispatch (manual review / OTP)"

            factors.sort(key=lambda f: f["points"], reverse=True)
            return {
                "risk_score": round(score, 1),
                "risk_level": level,
                "flags": [f["factor"] for f in factors],
                "recommendation": recommendation,
                "factors": factors[:6],
                "confidence": round(0.5 + 0.4 * min(1.0, score / 100), 2),
            }
        except Exception as e:
            logger.error(f"Error predicting fraud risk: {str(e)}")
            return {
                "risk_score": 0.0,
                "risk_level": "LOW",
                "flags": [],
                "recommendation": "Unable to compute fraud risk",
                "factors": [],
                "confidence": 0.0,
            }


fraud_detection_model = FraudDetectionModel()