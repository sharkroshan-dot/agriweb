"""Background AI training tasks."""
import asyncio
from datetime import datetime, timezone
from celery import shared_task
from bson import ObjectId
from app.database.mongodb import MongoDB
from app.services.ai_training_service import AITrainingService

async def _train(model_type, data_config, hyperparameters, job_id):
    await MongoDB.connect()
    await AITrainingService.update(job_id, status="running", progress=5, startedAt=datetime.now(timezone.utc))
    try:
        if model_type == "price_prediction":
            from app.ai.models.price_prediction import price_prediction_model
            product_id = data_config.get("productId")
            if not product_id: raise ValueError("dataConfig.productId is required for price_prediction")
            from app.repositories.price_history_repository import price_history_repository
            data = await price_history_repository.get_by_product_id(product_id, days=int(data_config.get("days", 365)))
            result = price_prediction_model.train(data)
        elif model_type == "demand_forecast":
            from app.ai.models.demand_forecast import demand_forecast_model
            product_id = data_config.get("productId")
            if not product_id: raise ValueError("dataConfig.productId is required for demand_forecast")
            from app.repositories.order_repository import order_repository
            orders = await order_repository.find_many({"items.productId": ObjectId(product_id), "orderStatus": "delivered", "deletedAt": None})
            data = [{"date": o.get("orderDate"), "demand": item.get("quantity", 0)} for o in orders for item in o.get("items", []) if str(item.get("productId")) == product_id]
            result = demand_forecast_model.train(data)
        else:
            raise ValueError(f"Training is not implemented for model type: {model_type}")
        if result.get("status") != "success": raise ValueError(result.get("error", "Training failed"))
        metrics = result.get("metrics") or {}
        accuracy = max(0.0, min(1.0, 1.0 - float(metrics.get("mae", 1.0)) / (float(metrics.get("mae", 1.0)) + 1.0)))
        await AITrainingService.update(job_id, status="completed", progress=100, accuracy=accuracy, metrics=metrics, completedAt=datetime.now(timezone.utc), result=result)
    except Exception as exc:
        await AITrainingService.update(job_id, status="failed", progress=100, completedAt=datetime.now(timezone.utc), error=str(exc))
    finally:
        await MongoDB.close()

@shared_task(bind=True, name="agriconnect.ai.train_model")
def train_model_task(self, model_type, data_config, hyperparameters, job_id):
    asyncio.run(_train(model_type, data_config, hyperparameters, job_id))
    return {"jobId": job_id}
