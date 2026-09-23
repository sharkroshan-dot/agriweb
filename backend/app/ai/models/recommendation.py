from typing import Dict, Any, List
import logging

logger = logging.getLogger(__name__)

class RecommendationEngine:
    """Lightweight recommendation engine for product suggestions."""

    def recommend(
        self,
        user_history: List[Dict[str, Any]],
        products: List[Dict[str, Any]],
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        watched_product_ids = {str(item.get("productId")) for item in user_history}
        category_scores: Dict[str, int] = {}

        for item in user_history:
            category = item.get("categoryId")
            if category:
                category_scores[str(category)] = category_scores.get(str(category), 0) + 1

        recommendations = []
        if category_scores:
            top_categories = sorted(category_scores.items(), key=lambda x: x[1], reverse=True)[:3]
            for category_id, _ in top_categories:
                for product in products:
                    if str(product.get("categoryId")) == category_id and str(product.get("_id")) not in watched_product_ids:
                        recommendations.append(product)
                        if len(recommendations) >= limit:
                            break
                if len(recommendations) >= limit:
                    break

        if len(recommendations) < limit:
            trending = sorted(products, key=lambda x: x.get("views", 0), reverse=True)
            for product in trending:
                if len(recommendations) >= limit:
                    break
                if str(product.get("_id")) not in watched_product_ids and product not in recommendations:
                    recommendations.append(product)

        return recommendations[:limit]

recommendation_engine = RecommendationEngine()
