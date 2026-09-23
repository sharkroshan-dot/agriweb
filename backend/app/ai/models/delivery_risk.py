from typing import Dict, Any, List, Optional
import logging

logger = logging.getLogger(__name__)


class DeliveryRiskModel:
    """Delivery risk prediction model.

    Estimates the probability that a delivery will be late or fail before it
    starts. Uses a transparent weighted scoring approach so the contribution of
    each factor can be explained to the farmer or delivery partner.

    Risk buckets (matching the AgriConnect spec):
        0-30   LOW
        31-70  MEDIUM
        71-100 HIGH
    """

    def __init__(self):
        self.model_path = "backend/ai/models/delivery_risk.pkl"

    def predict(self, features: Dict[str, Any]) -> Dict[str, Any]:
        """Predict delivery risk for a single order/delivery.

        Expected feature keys (all optional, defaults chosen for unknown data):
          distance_km            float - straight-line or routed distance
          time_window_minutes    int   - remaining delivery window in minutes
          is_cod                 bool  - cash on delivery
          quantity_kg            float - total weight of the order
          vehicle_capacity       float - partner vehicle capacity in kg
          partner_on_time_rate   float - partner historical on-time rate (0-1)
          partner_rating         float - partner rating (0-5)
          partner_active_load    int   - number of deliveries already on the vehicle
          previous_delays        int   - partner previous late/failed deliveries
          delivery_slot          str   - e.g. "Morning", "Afternoon", "Evening"
          rural_roads            int   - estimated narrow/rural road segments
        """
        try:
            factors: List[Dict[str, Any]] = []
            score = 0.0

            distance = float(features.get("distance_km") or 0)
            window = float(features.get("time_window_minutes") or 120)
            is_cod = bool(features.get("is_cod"))
            qty = float(features.get("quantity_kg") or 0)
            capacity = float(features.get("vehicle_capacity") or 0)
            on_time = float(features.get("partner_on_time_rate") or 0.9)
            rating = float(features.get("partner_rating") or 4.0)
            load = int(features.get("partner_active_load") or 0)
            delays = int(features.get("previous_delays") or 0)
            slot = str(features.get("delivery_slot") or "")
            rural = int(features.get("rural_roads") or 0)

            # Distance: each 5 km beyond the first 5 km adds weight.
            if distance > 5:
                distance_score = min(30.0, (distance - 5) * 1.5)
                score += distance_score
                factors.append({
                    "factor": "distance",
                    "impact": "high" if distance > 15 else "medium",
                    "detail": f"{distance:.1f} km route",
                    "points": round(distance_score, 1),
                })

            # Time window pressure: tight windows raise risk.
            if window <= 30:
                score += 20
                factors.append({"factor": "time_window", "impact": "high", "detail": "Very tight delivery window", "points": 20})
            elif window <= 60:
                score += 12
                factors.append({"factor": "time_window", "impact": "medium", "detail": "Tight delivery window", "points": 12})

            # COD orders are held to a stricter on-time standard.
            if is_cod:
                score += 8
                factors.append({"factor": "cod", "impact": "medium", "detail": "Cash on delivery order", "points": 8})

            # Vehicle utilization: near/over capacity raises risk.
            if capacity > 0:
                utilization = (qty + load * 2) / capacity
                if utilization > 1.0:
                    score += 25
                    factors.append({"factor": "capacity", "impact": "high", "detail": "Order exceeds vehicle capacity", "points": 25})
                elif utilization > 0.8:
                    score += 15
                    factors.append({"factor": "capacity", "impact": "medium", "detail": "High vehicle utilization", "points": 15})

            # Partner reliability.
            if on_time < 0.8:
                score += 25
                factors.append({"factor": "partner_on_time", "impact": "high", "detail": "Low partner on-time record", "points": 25})
            elif on_time < 0.9:
                score += 12
                factors.append({"factor": "partner_on_time", "impact": "medium", "detail": "Below-average on-time record", "points": 12})

            if rating < 3.5:
                score += 10
                factors.append({"factor": "partner_rating", "impact": "medium", "detail": "Low partner rating", "points": 10})

            if load >= 8:
                score += 15
                factors.append({"factor": "partner_load", "impact": "high", "detail": f"{load} deliveries already assigned", "points": 15})
            elif load >= 5:
                score += 8
                factors.append({"factor": "partner_load", "impact": "medium", "detail": f"{load} deliveries already assigned", "points": 8})

            if delays >= 3:
                score += 15
                factors.append({"factor": "delivery_history", "impact": "high", "detail": "Multiple previous delays/failures", "points": 15})
            elif delays >= 1:
                score += 6
                factors.append({"factor": "delivery_history", "impact": "medium", "detail": "Previous delivery delay/failure", "points": 6})

            # Rural roads slow down rural routes.
            if rural >= 8:
                score += 10
                factors.append({"factor": "rural_roads", "impact": "medium", "detail": f"{rural} rural road segments", "points": 10})

            # Evening deliveries have more traffic in Indian cities.
            if slot and ("evening" in slot.lower() or "afternoon" in slot.lower()):
                score += 5
                factors.append({"factor": "delivery_slot", "impact": "low", "detail": f"{slot} traffic window", "points": 5})

            score = min(100.0, max(0.0, score))
            level = "LOW" if score <= 30 else ("MEDIUM" if score <= 70 else "HIGH")

            if level == "LOW":
                recommendation = "Proceed with current partner"
            elif level == "MEDIUM":
                recommendation = "Monitor this delivery and keep the customer informed"
            else:
                recommendation = "Assign this order to another available partner or delivery at an earlier slot"

            expected_minutes = round(distance / 25 * 60 + 10 * (load + 1), 0)

            factors.sort(key=lambda f: f["points"], reverse=True)
            return {
                "risk_score": round(score, 1),
                "risk_level": level,
                "expected_delivery_minutes": expected_minutes,
                "recommendation": recommendation,
                "factors": factors[:5],
                "confidence": round(0.5 + 0.4 * (1 - score / 100), 2),
            }
        except Exception as e:
            logger.error(f"Error predicting delivery risk: {str(e)}")
            return {
                "risk_score": 0.0,
                "risk_level": "LOW",
                "expected_delivery_minutes": 0,
                "recommendation": "Unable to compute delivery risk",
                "factors": [],
                "confidence": 0.0,
            }


delivery_risk_model = DeliveryRiskModel()