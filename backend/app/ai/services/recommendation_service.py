"""Recommendation orchestration helpers."""
from typing import Any, Dict, List

from app.ai.models.recommendation import recommendation_engine


def recommend(
    user_history: List[Dict[str, Any]],
    products: List[Dict[str, Any]],
    limit: int = 10,
) -> List[Dict[str, Any]]:
    return recommendation_engine.recommend(
        user_history=user_history,
        products=products,
        limit=max(1, min(limit, 50)),
    )
