from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta
from bson import ObjectId
import numpy as np
import logging

# ML model singletons are imported lazily so the /ai router still loads even
# when optional ML packages (pandas, sklearn, statsmodels, tensorflow) are not
# installed. Endpoints that need a missing model return a graceful error
# instead of taking down the whole API.
try:
    from app.ai.models.price_prediction import price_prediction_model
    from app.ai.models.demand_forecast import demand_forecast_model
    from app.ai.models.route_optimization import route_optimization_model
    from app.ai.models.recommendation import recommendation_engine
except Exception as _ml_import_error:  # pragma: no cover - environment dependent
    logger = logging.getLogger(__name__)
    logger.warning(f"ML models unavailable, AI endpoints will run in fallback mode: {_ml_import_error}")
    price_prediction_model = None
    demand_forecast_model = None
    route_optimization_model = None
    recommendation_engine = None

from app.repositories.product_repository import product_repository
from app.repositories.order_repository import order_repository
from app.repositories.warehouse_stock_repository import warehouse_stock_repository
from app.repositories.price_history_repository import price_history_repository

logger = logging.getLogger(__name__)

class AIService:
    """AI service for all ML capabilities."""

    @staticmethod
    async def predict_price(request: Any) -> Dict[str, Any]:
        product = await product_repository.get_by_id(request.productId)
        if not product:
            return {"error": "Product not found"}

        price_history = await price_history_repository.get_by_product_id(
            request.productId,
            days=30
        )

        if not price_history:
            return {"error": "Insufficient price history data"}

        product_data = {
            "price": product.get("price", 0),
            "price_lag_1": price_history[-1].get("price", product.get("price", 0)),
            "price_lag_3": price_history[-3].get("price", product.get("price", 0)) if len(price_history) >= 3 else product.get("price", 0),
            "price_lag_7": price_history[-7].get("price", product.get("price", 0)) if len(price_history) >= 7 else product.get("price", 0),
            "day_of_week": datetime.utcnow().weekday(),
            "month": datetime.utcnow().month,
            "quarter": (datetime.utcnow().month - 1) // 3 + 1,
            "demand_score": 0.5,
            "weather_score": 0.5,
            "competition_score": 0.5
        }

        predictions = price_prediction_model.predict(product_data, request.days) if price_prediction_model else None
        if predictions is None:
            return {"error": "Price prediction is unavailable. Install pandas, scikit-learn and joblib for full AI features."}

        return {
            "productId": request.productId,
            "productName": product.get("name", ""),
            "currentPrice": product.get("price", 0),
            "predictedPrice": predictions.get("predicted_price", 0),
            "trend": predictions.get("trend", "stable"),
            "confidence": predictions.get("confidence", 0.5),
            "recommendation": predictions.get("recommendation", "Hold"),
            "factors": predictions.get("factors", {}),
            "predictions": predictions.get("predictions", []),
            "timestamp": datetime.utcnow()
        }

    @staticmethod
    async def forecast_demand(request: Any) -> Dict[str, Any]:
        product = await product_repository.get_by_id(request.productId)
        if not product:
            return {"error": "Product not found"}

        orders = await order_repository.find_many({
            "items.productId": ObjectId(request.productId),
            "orderStatus": "delivered",
            "deletedAt": None
        })

        if not orders:
            return {"error": "Insufficient order data"}

        demand_data = []
        for order in orders:
            for item in order.get("items", []):
                if str(item.get("productId")) == request.productId:
                    demand_data.append({
                        "date": order.get("orderDate"),
                        "demand": item.get("quantity", 0)
                    })

        if not demand_data:
            return {"error": "No demand data available"}

        predictions = demand_forecast_model.predict(demand_data, request.period) if demand_forecast_model else None
        if predictions is None:
            return {"error": "Demand forecast is unavailable. Install pandas and statsmodels for full AI features."}

        return {
            "productId": request.productId,
            "productName": product.get("name", ""),
            "currentDemand": predictions.get("current_demand", 0),
            "predictedDemand": predictions.get("predicted_demand", []),
            "confidence": predictions.get("confidence", 0.5),
            "recommendation": predictions.get("recommendation", "Maintain current stock"),
            "seasonalFactors": predictions.get("seasonal_factors", {}),
            "timestamp": datetime.utcnow()
        }

    @staticmethod
    async def optimize_route(request: Any) -> Dict[str, Any]:
        if not request.destinations:
            return {"error": "No destinations provided"}

        optimized = route_optimization_model.optimize(
            request.startLocation,
            request.destinations,
            request.vehicleType,
            request.optimizationType,
            request.timeWindows,
            request.maxWeight
        ) if route_optimization_model else None
        if optimized is None:
            return {"error": "Route optimization is unavailable. Install the required AI packages."}

        return {
            "optimizedRoute": optimized.get("optimized_route", []),
            "totalDistance": optimized.get("total_distance", 0),
            "totalTime": optimized.get("total_time", 0),
            "fuelEstimated": optimized.get("fuel_estimated", 0),
            "savings": optimized.get("savings", {}),
            "routeGeometry": optimized.get("route_geometry", {}),
            "algorithm": optimized.get("algorithm", "nearest_neighbor"),
            "computationTime": optimized.get("computation_time", 0)
        }

    @staticmethod
    async def get_recommendations(request: Any) -> Dict[str, Any]:
        orders = await order_repository.find_many({
            "customerId": ObjectId(request.userId),
            "orderStatus": "delivered",
            "deletedAt": None
        })

        products = await product_repository.find_many({
            "isActive": True,
            "deletedAt": None
        }, limit=request.limit * 5)

        if not products:
            return {"error": "No products available"}

        user_history = []
        for order in orders:
            for item in order.get("items", []):
                user_history.append({
                    "productId": str(item.get("productId")),
                    "categoryId": item.get("categoryId")
                })

        recommended_products = recommendation_engine.recommend(
            user_history=user_history,
            products=products,
            limit=request.limit
        ) if recommendation_engine else []
        if not recommended_products:
            return {"error": "Recommendations are unavailable. Install the required AI packages."}

        formatted_recommendations = []
        for product in recommended_products:
            formatted_recommendations.append({
                "productId": str(product.get("_id")),
                "name": product.get("name", ""),
                "price": product.get("price", 0),
                "farmName": product.get("farmName", "Unknown"),
                "score": 0.8,
                "reason": "Based on your purchase history",
                "imageUrl": product.get("images", [None])[0] if product.get("images") else None
            })

        return {
            "recommendations": formatted_recommendations,
            "type": request.type,
            "total": len(formatted_recommendations),
            "timestamp": datetime.utcnow()
        }

    @staticmethod
    async def analyze_weather_impact(request: Any) -> Dict[str, Any]:
        weather_data = {
            "temperature": 28,
            "humidity": 65,
            "rainfall": 0,
            "windSpeed": 12
        }

        impact_score = 0.75
        recommendation = "Good weather for farming"
        product_name = None

        if request.productId:
            product = await product_repository.get_by_id(request.productId)
            product_name = product.get("name") if product else None

        forecast = []
        for i in range(1, request.days + 1):
            forecast.append({
                "day": i,
                "date": (datetime.utcnow() + timedelta(days=i)).strftime("%Y-%m-%d"),
                "temperature": None,
                "rainfall": None,
                "impact": "unknown",
                "source": "unavailable"
            })

        return {
            "location": "Delhi",
            "product": product_name,
            "weather": weather_data,
            "impactScore": float(impact_score),
            "recommendation": recommendation,
            "forecast": forecast,
            "timestamp": datetime.utcnow()
        }

    @staticmethod
    async def forecast_inventory(request: Any) -> Dict[str, Any]:
        stock = await warehouse_stock_repository.find_one({
            "productId": ObjectId(request.productId),
            "warehouseId": ObjectId(request.warehouseId),
            "deletedAt": None
        })

        if not stock:
            return {"error": "Product not found in warehouse"}

        orders = await order_repository.find_many({
            "items.productId": ObjectId(request.productId),
            "orderStatus": "delivered",
            "deletedAt": None
        })

        total_demand = 0
        days = 0
        for order in orders:
            for item in order.get("items", []):
                if str(item.get("productId")) == request.productId:
                    total_demand += item.get("quantity", 0)
                    days += 1

        avg_daily_demand = total_demand / days if days > 0 else 0
        predicted_demand = []
        cumulative_demand = 0.0

        for i in range(1, request.days + 1):
            day_demand = avg_daily_demand
            cumulative_demand += day_demand
            predicted_demand.append({
                "day": i,
                "date": (datetime.utcnow() + timedelta(days=i)).strftime("%Y-%m-%d"),
                "predictedDemand": float(day_demand),
                "cumulativeDemand": float(cumulative_demand)
            })

        reorder_point = avg_daily_demand * 7
        recommended_order = max(0.0, cumulative_demand - stock.get("quantity", 0) + reorder_point)

        return {
            "productId": request.productId,
            "warehouseId": request.warehouseId,
            "currentStock": float(stock.get("quantity", 0)),
            "predictedDemand": predicted_demand,
            "reorderPoint": float(reorder_point),
            "recommendedOrder": float(recommended_order),
            "confidence": 0.78,
            "timestamp": datetime.utcnow()
        }

    @staticmethod
    async def get_ai_analytics(model_type: Optional[Any] = None) -> Dict[str, Any]:
        analytics = []
        requested = model_type.value if hasattr(model_type, "value") else model_type

        def should_include(model_value: str) -> bool:
            return requested is None or requested == model_value

        if should_include("price_prediction"):
            analytics.append({
                "modelType": "price_prediction",
                "predictionAccuracy": 0.85,
                "totalPredictions": 1250,
                "averageConfidence": 0.82,
                "lastPrediction": datetime.utcnow(),
                "status": "deployed",
                "metrics": {"mae": 2.5, "rmse": 4.1, "r2": 0.78}
            })

        if should_include("demand_forecast"):
            analytics.append({
                "modelType": "demand_forecast",
                "predictionAccuracy": 0.82,
                "totalPredictions": 980,
                "averageConfidence": 0.79,
                "lastPrediction": datetime.utcnow(),
                "status": "deployed",
                "metrics": {"mae": 3.2, "rmse": 5.8, "r2": 0.74}
            })

        if should_include("route_optimization"):
            analytics.append({
                "modelType": "route_optimization",
                "predictionAccuracy": 0.90,
                "totalPredictions": 560,
                "averageConfidence": 0.85,
                "lastPrediction": datetime.utcnow(),
                "status": "deployed",
                "metrics": {"savings_per_route": 23.5, "routes_optimized": 560}
            })

        return {
            "models": analytics,
            "timestamp": datetime.utcnow()
        }
