from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional


class AICopilotService:
    """Simple role-aware AI copilot brief for dashboards and mobile cards."""

    @staticmethod
    async def build_brief(role: str, user: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        normalized_role = (role or "customer").lower()
        if normalized_role not in {"customer", "farmer", "delivery", "business"}:
            normalized_role = "customer"

        templates = {
            "customer": {
                "title": "Shopping guidance",
                "insights": [
                    {
                        "title": "Fresh picks near you",
                        "model": "marketplace_recommender_v1",
                        "confidence": 0.86,
                        "severity": "low",
                        "reason": "Demand for nearby produce is healthy and lead times remain stable.",
                        "suggestedAction": "Browse the best-rated produce in your local market and compare freshness before ordering.",
                    },
                    {
                        "title": "Price watch",
                        "model": "price_prediction_v1",
                        "confidence": 0.79,
                        "severity": "medium",
                        "reason": "Recent pricing suggests a small premium on premium vegetables this week.",
                        "suggestedAction": "Track a few products and buy when the price trend softens or a bundle discount appears.",
                    },
                ],
            },
            "farmer": {
                "title": "Farm operations guidance",
                "insights": [
                    {
                        "title": "Demand pulse",
                        "model": "demand_forecast_v1",
                        "confidence": 0.9,
                        "severity": "medium",
                        "reason": "Your strongest demand is concentrated in the next 7-day harvest window.",
                        "suggestedAction": "Prioritize stock planning and harvest timing for the high-volume crops in this window.",
                    },
                    {
                        "title": "Pricing review",
                        "model": "price_prediction_v1",
                        "confidence": 0.82,
                        "severity": "high",
                        "reason": "Some produce categories are nearing price ceilings and may need a modest review.",
                        "suggestedAction": "Adjust prices conservatively and keep a close watch on competitor listings before the weekend rush.",
                    },
                ],
            },
            "delivery": {
                "title": "Route efficiency",
                "insights": [
                    {
                        "title": "Route optimization",
                        "model": "route_optimization_v2",
                        "confidence": 0.87,
                        "severity": "low",
                        "reason": "The current delivery cluster is efficient but has a few tight time windows.",
                        "suggestedAction": "Group nearby drops and leave a buffer around peak traffic windows to protect on-time performance.",
                    },
                    {
                        "title": "Risk watch",
                        "model": "risk_scoring_v1",
                        "confidence": 0.8,
                        "severity": "medium",
                        "reason": "A few orders are sensitive to weather and traffic shifts.",
                        "suggestedAction": "Confirm the latest road conditions and check customer availability before departure.",
                    },
                ],
            },
            "business": {
                "title": "Procurement guidance",
                "insights": [
                    {
                        "title": "Bulk sourcing window",
                        "model": "procurement_recommender_v1",
                        "confidence": 0.85,
                        "severity": "medium",
                        "reason": "Reliable supply is strong in the next few days with manageable price variance.",
                        "suggestedAction": "Lock in preferred suppliers while prices remain within your budget band.",
                    },
                    {
                        "title": "Demand balance",
                        "model": "demand_forecast_v1",
                        "confidence": 0.8,
                        "severity": "low",
                        "reason": "The forecast remains steady, limiting the need for abrupt stock changes.",
                        "suggestedAction": "Keep a moderate safety stock and review orders again mid-week.",
                    },
                ],
            },
        }

        payload = templates.get(normalized_role, templates["customer"])
        insight_list: List[Dict[str, Any]] = []
        for item in payload["insights"]:
            insight_list.append({
                **item,
                "description": item["reason"],
                "suggestedAction": item["suggestedAction"],
            })

        return {
            "role": normalized_role,
            "title": payload["title"],
            "guardrail": "AI recommendations are advisory only. The human user remains responsible for final decisions and must review the action before it is executed.",
            "insights": insight_list,
            "updatedAt": datetime.utcnow().isoformat(),
        }
