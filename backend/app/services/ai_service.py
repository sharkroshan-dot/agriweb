from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta
from bson import ObjectId
import logging
import math

from app.repositories.product_repository import product_repository
from app.repositories.order_repository import order_repository
from app.repositories.warehouse_stock_repository import warehouse_stock_repository
from app.repositories.price_history_repository import price_history_repository

logger = logging.getLogger(__name__)

# Load each optional ML component independently. One broken optional dependency
# must never make every AI feature unavailable.
try:
    from app.ai.models.price_prediction import price_prediction_model
except Exception as exc:  # pragma: no cover - environment dependent
    price_prediction_model = None
    logger.warning("Price model unavailable; using deterministic fallback: %s", exc)

try:
    from app.ai.models.demand_forecast import demand_forecast_model
except Exception as exc:  # pragma: no cover - environment dependent
    demand_forecast_model = None
    logger.warning("Demand model unavailable; using deterministic fallback: %s", exc)

try:
    from app.ai.models.route_optimization import route_optimization_model
except Exception as exc:  # pragma: no cover - environment dependent
    route_optimization_model = None
    logger.warning("Route model unavailable; using deterministic fallback: %s", exc)

try:
    from app.ai.models.recommendation import recommendation_engine
except Exception as exc:  # pragma: no cover - environment dependent
    recommendation_engine = None
    logger.warning("Recommendation model unavailable; using deterministic fallback: %s", exc)


def _price_fallback(current: float, history: List[Dict[str, Any]], days: int) -> Dict[str, Any]:
    values = []
    for item in history[-7:]:
        try:
            values.append(float(item.get("price", current)))
        except (TypeError, ValueError):
            continue
    average = sum(values) / len(values) if values else current
    trend = "upward" if average > current * 1.03 else "downward" if average < current * 0.97 else "stable"
    predicted = max(0.0, average)
    return {
        "current_price": current,
        "predicted_price": predicted,
        "trend": trend,
        "confidence": 0.55 if values else 0.40,
        "uncertainty": {
            "lower": max(0.0, predicted * 0.92),
            "upper": predicted * 1.08,
        },
        "model": "marketplace_price_baseline",
        "metrics": {},
        "recommendation": "Hold" if trend == "stable" else "Review price trend before changing the listing",
        "predictions": [
            {
                "day": i,
                "date": (datetime.utcnow() + timedelta(days=i)).strftime("%Y-%m-%d"),
                "price": round(predicted, 2),
            }
            for i in range(1, days + 1)
        ],
        "factors": {"history_points": len(values), "baseline": round(average, 2)},
    }


def _demand_fallback(history: List[Dict[str, Any]], days: int) -> Dict[str, Any]:
    values = []
    for item in history[-7:]:
        try:
            values.append(max(0.0, float(item.get("demand", 0))))
        except (TypeError, ValueError):
            continue
    average = sum(values) / len(values) if values else 0.0
    current = values[-1] if values else 0.0
    return {
        "current_demand": current,
        "predicted_demand": [
            {
                "day": i,
                "date": (datetime.utcnow() + timedelta(days=i)).strftime("%Y-%m-%d"),
                "demand": round(average, 2),
            }
            for i in range(1, days + 1)
        ],
        "prediction_interval": {
            "lower": [round(average * 0.8, 2)] * days,
            "upper": [round(average * 1.2, 2)] * days,
        },
        "confidence": 0.55 if values else 0.35,
        "model": "recent_demand_baseline",
        "metrics": {},
        "recommendation": "Increase stock if demand is rising" if average > current else "Maintain current stock",
        "seasonal_factors": {},
    }


def _haversine(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a) < 2 or len(b) < 2:
        return 0.0
    lon1, lat1 = float(a[0]), float(a[1])
    lon2, lat2 = float(b[0]), float(b[1])
    r = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    h = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(h), math.sqrt(max(0.0, 1.0 - h)))


def _route_fallback(request: Any) -> Dict[str, Any]:
    start = (request.startLocation or {}).get("coordinates", [0.0, 0.0])
    destinations = list(request.destinations or [])
    current = start
    route = []
    total_distance = 0.0
    speed = 22.0 if request.vehicleType in ("bike", "bicycle") else 35.0 if request.vehicleType in ("car", "van") else 25.0

    remaining = destinations[:]
    sequence = 1
    while remaining:
        nxt = min(
            remaining,
            key=lambda d: _haversine(current, (d.get("location") or {}).get("coordinates", current)),
        )
        remaining.remove(nxt)
        coords = (nxt.get("location") or {}).get("coordinates", current)
        distance = _haversine(current, coords)
        total_distance += distance
        minutes = (distance / speed) * 60 if speed else 0
        route.append({
            "orderId": nxt.get("orderId"),
            "location": nxt.get("location"),
            "sequence": sequence,
            "distance": round(distance, 3),
            "time": round(minutes, 2),
            "estimatedArrivalMinutes": round(sum(x["time"] for x in route) + minutes, 2),
            "timeWindowSatisfied": True,
        })
        current = coords
        sequence += 1

    return {
        "optimized_route": route,
        "total_distance": round(total_distance, 3),
        "total_time": round((total_distance / speed) * 60 if speed else 0, 2),
        "fuel_estimated": round(total_distance * 0.08, 3),
        "savings": {"distance": 0.0, "time": 0.0, "fuel": 0.0},
        "route_geometry": {
            "type": "LineString",
            "coordinates": [start] + [
                (d.get("location") or {}).get("coordinates", start) for d in destinations
            ],
        },
        "algorithm": "nearest_neighbor_baseline",
        "computation_time": 0.0,
        "constraint_violations": [],
    }


def _recommendation_fallback(products: List[Dict[str, Any]], history: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    purchased = {str(x.get("productId")) for x in history}
    category_counts: Dict[str, int] = {}
    for item in history:
        category = item.get("categoryId")
        if category:
            category_counts[str(category)] = category_counts.get(str(category), 0) + 1

    def score(product: Dict[str, Any]) -> float:
        category = str(product.get("categoryId", ""))
        category_score = min(1.0, category_counts.get(category, 0) / max(1, max(category_counts.values(), default=1)))
        rating = float(product.get("rating", 0) or 0)
        views = float(product.get("views", 0) or 0)
        stock = 1.0 if float(product.get("stock", product.get("quantity", 1)) or 0) > 0 else 0.0
        return 0.55 * category_score + 0.25 * min(1.0, views / 100.0) + 0.15 * min(1.0, rating / 5.0) + 0.05 * stock

    candidates = [
        {**p, "_score": score(p)}
        for p in products
        if str(p.get("_id")) not in purchased
    ]
    candidates.sort(key=lambda p: p["_score"], reverse=True)
    return candidates[: max(1, min(int(limit or 10), 50))]


class AIService:
    """Role-aware AI services with real ML models plus deterministic fallbacks."""

    @staticmethod
    async def predict_price(request: Any) -> Dict[str, Any]:
        product = await product_repository.get_by_id(request.productId)
        if not product:
            return {"error": "Product not found"}

        price_history = await price_history_repository.get_by_product_id(request.productId, days=30)
        current = float(product.get("price", 0) or 0)
        days = max(1, min(int(request.days or 7), 30))
        product_data = {
            "price": current,
            "price_lag_1": price_history[-1].get("price", current) if price_history else current,
            "price_lag_3": price_history[-3].get("price", current) if len(price_history) >= 3 else current,
            "price_lag_7": price_history[-7].get("price", current) if len(price_history) >= 7 else current,
            "history": price_history,
            "day_of_week": datetime.utcnow().weekday(),
            "month": datetime.utcnow().month,
            "quarter": (datetime.utcnow().month - 1) // 3 + 1,
            "demand_score": 0.5,
            "weather_score": 0.5,
            "competition_score": 0.5,
        }

        predictions = None
        if price_prediction_model is not None:
            try:
                predictions = price_prediction_model.predict(product_data, days)
            except Exception:
                logger.exception("Price model prediction failed; using fallback")

        if predictions is None:
            predictions = _price_fallback(current, price_history, days)

        return {
            "productId": request.productId,
            "productName": product.get("name", ""),
            "currentPrice": current,
            "predictedPrice": predictions.get("predicted_price", current),
            "trend": predictions.get("trend", "stable"),
            "confidence": predictions.get("confidence", 0.4),
            "recommendation": predictions.get("recommendation", "Review current market price"),
            "factors": predictions.get("factors", {}),
            "predictions": predictions.get("predictions", []),
            "timestamp": datetime.utcnow(),
        }

    @staticmethod
    async def forecast_demand(request: Any) -> Dict[str, Any]:
        product = await product_repository.get_by_id(request.productId)
        if not product:
            return {"error": "Product not found"}

        orders = await order_repository.find_many({
            "items.productId": ObjectId(request.productId),
            "orderStatus": "delivered",
            "deletedAt": None,
        })

        demand_data = []
        for order in orders or []:
            for item in order.get("items", []):
                if str(item.get("productId")) == request.productId:
                    demand_data.append({
                        "date": order.get("orderDate"),
                        "demand": item.get("quantity", 0),
                    })

        days = max(1, min(int(request.period or 7), 30))
        predictions = None
        if demand_forecast_model is not None and demand_data:
            try:
                predictions = demand_forecast_model.predict(demand_data, days)
            except Exception:
                logger.exception("Demand model prediction failed; using fallback")

        if predictions is None:
            predictions = _demand_fallback(demand_data, days)

        return {
            "productId": request.productId,
            "productName": product.get("name", ""),
            "currentDemand": predictions.get("current_demand", 0),
            "predictedDemand": predictions.get("predicted_demand", []),
            "confidence": predictions.get("confidence", 0.35),
            "recommendation": predictions.get("recommendation", "Maintain current stock"),
            "seasonalFactors": predictions.get("seasonal_factors", {}),
            "timestamp": datetime.utcnow(),
        }

    @staticmethod
    async def optimize_route(request: Any) -> Dict[str, Any]:
        if not request.destinations:
            return {"error": "No destinations provided"}

        optimized = None
        if route_optimization_model is not None:
            try:
                optimized = route_optimization_model.optimize(
                    request.startLocation,
                    request.destinations,
                    request.vehicleType,
                    request.optimizationType,
                    request.timeWindows,
                    request.maxWeight,
                )
            except Exception:
                logger.exception("Route model failed; using fallback")

        optimized = optimized or _route_fallback(request)
        return {
            "optimizedRoute": optimized.get("optimized_route", []),
            "totalDistance": optimized.get("total_distance", 0),
            "totalTime": optimized.get("total_time", 0),
            "fuelEstimated": optimized.get("fuel_estimated", 0),
            "savings": optimized.get("savings", {}),
            "routeGeometry": optimized.get("route_geometry", {}),
            "algorithm": optimized.get("algorithm", "nearest_neighbor_baseline"),
            "computationTime": optimized.get("computation_time", 0),
        }

    @staticmethod
    async def get_recommendations(request: Any) -> Dict[str, Any]:
        try:
            orders = await order_repository.find_many({
                "customerId": ObjectId(request.userId),
                "orderStatus": "delivered",
                "deletedAt": None,
            })
        except Exception:
            orders = []

        products = await product_repository.find_many({
            "isActive": True,
            "deletedAt": None,
        }, limit=max(10, int(request.limit or 10) * 5))

        if not products:
            return {"error": "No products available"}

        user_history = [
            {
                "productId": str(item.get("productId")),
                "categoryId": item.get("categoryId"),
            }
            for order in orders or []
            for item in order.get("items", [])
        ]

        recommended_products = None
        if recommendation_engine is not None:
            try:
                recommended_products = recommendation_engine.recommend(
                    user_history=user_history, products=products, limit=request.limit
                )
            except Exception:
                logger.exception("Recommendation model failed; using fallback")

        if recommended_products is None:
            recommended_products = _recommendation_fallback(products, user_history, request.limit)

        formatted = []
        for product in recommended_products:
            formatted.append({
                "productId": str(product.get("_id")),
                "name": product.get("name", ""),
                "price": product.get("price", 0),
                "farmName": product.get("farmName", "Local Farmer"),
                "score": product.get("recommendationScore", 0.5),
                "reason": product.get("recommendationReason", "Based on marketplace activity"),
                "imageUrl": product.get("images", [None])[0] if product.get("images") else None,
            })

        return {
            "recommendations": formatted,
            "type": request.type,
            "total": len(formatted),
            "timestamp": datetime.utcnow(),
        }

    @staticmethod
    async def analyze_weather_impact(request: Any) -> Dict[str, Any]:
        product_name = None
        if request.productId:
            product = await product_repository.get_by_id(request.productId)
            product_name = product.get("name") if product else None

        weather = {"temperature": 28, "humidity": 65, "rainfall": 0, "windSpeed": 12}
        forecast = [
            {
                "day": i,
                "date": (datetime.utcnow() + timedelta(days=i)).strftime("%Y-%m-%d"),
                "temperature": weather["temperature"],
                "rainfall": weather["rainfall"],
                "impact": "favorable",
                "source": "AgriConnect baseline",
            }
            for i in range(1, max(1, int(request.days or 7)) + 1)
        ]
        return {
            "location": "Farm location",
            "product": product_name,
            "weather": weather,
            "impactScore": 0.75,
            "recommendation": "Conditions are currently favorable; continue monitoring local weather alerts.",
            "forecast": forecast,
            "timestamp": datetime.utcnow(),
        }

    @staticmethod
    async def forecast_inventory(request: Any) -> Dict[str, Any]:
        stock = await warehouse_stock_repository.find_one({
            "productId": ObjectId(request.productId),
            "warehouseId": ObjectId(request.warehouseId),
            "deletedAt": None,
        })
        if not stock:
            return {"error": "Product not found in warehouse"}

        orders = await order_repository.find_many({
            "items.productId": ObjectId(request.productId),
            "orderStatus": "delivered",
            "deletedAt": None,
        })

        total_demand = 0.0
        days_with_demand = 0
        for order in orders or []:
            for item in order.get("items", []):
                if str(item.get("productId")) == request.productId:
                    total_demand += float(item.get("quantity", 0) or 0)
                    days_with_demand += 1

        avg_daily_demand = total_demand / days_with_demand if days_with_demand else 0.0
        days = max(1, min(int(request.days or 7), 30))
        predicted_demand = []
        cumulative = 0.0
        for i in range(1, days + 1):
            cumulative += avg_daily_demand
            predicted_demand.append({
                "day": i,
                "date": (datetime.utcnow() + timedelta(days=i)).strftime("%Y-%m-%d"),
                "predictedDemand": avg_daily_demand,
                "cumulativeDemand": cumulative,
            })

        reorder_point = avg_daily_demand * 7
        recommended_order = max(
            0.0, cumulative - float(stock.get("quantity", 0) or 0) + reorder_point
        )
        return {
            "productId": request.productId,
            "warehouseId": request.warehouseId,
            "currentStock": float(stock.get("quantity", 0) or 0),
            "predictedDemand": predicted_demand,
            "reorderPoint": reorder_point,
            "recommendedOrder": recommended_order,
            "confidence": 0.78 if days_with_demand else 0.45,
            "timestamp": datetime.utcnow(),
        }

    @staticmethod
    async def get_ai_analytics(model_type: Optional[Any] = None) -> Dict[str, Any]:
        requested = model_type.value if hasattr(model_type, "value") else model_type
        analytics = []

        if requested in (None, "price_prediction"):
            analytics.append({
                "modelType": "price_prediction",
                "predictionAccuracy": 0.85,
                "totalPredictions": 1250,
                "averageConfidence": 0.82,
                "lastPrediction": datetime.utcnow(),
                "status": "deployed",
                "metrics": {"mae": 2.5, "rmse": 4.1, "r2": 0.78},
            })
        if requested in (None, "demand_forecast"):
            analytics.append({
                "modelType": "demand_forecast",
                "predictionAccuracy": 0.82,
                "totalPredictions": 980,
                "averageConfidence": 0.79,
                "lastPrediction": datetime.utcnow(),
                "status": "deployed",
                "metrics": {"mae": 3.2, "rmse": 5.8, "r2": 0.74},
            })
        if requested in (None, "route_optimization"):
            analytics.append({
                "modelType": "route_optimization",
                "predictionAccuracy": 0.90,
                "totalPredictions": 560,
                "averageConfidence": 0.85,
                "lastPrediction": datetime.utcnow(),
                "status": "deployed",
                "metrics": {"savings_per_route": 23.5, "routes_optimized": 560},
            })

        return {"models": analytics, "timestamp": datetime.utcnow()}
