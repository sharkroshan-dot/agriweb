"""Durable AI training-job registry and orchestration."""
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from bson import ObjectId
from app.database.mongodb import MongoDB

class AITrainingService:
    collection_name = "ai_training_jobs"

    @classmethod
    async def create_job(cls, model_type: str, data_config: Dict[str, Any], hyperparameters: Optional[Dict[str, Any]], requested_by: str) -> Dict[str, Any]:
        now = datetime.now(timezone.utc)
        job = {
            "modelType": model_type,
            "status": "queued",
            "progress": 0,
            "dataConfig": data_config or {},
            "hyperparameters": hyperparameters or {},
            "requestedBy": requested_by,
            "createdAt": now,
            "startedAt": None,
            "completedAt": None,
            "accuracy": None,
            "metrics": None,
            "error": None,
            "result": None,
        }
        result = await MongoDB.get_collection(cls.collection_name).insert_one(job)
        job["_id"] = result.inserted_id
        return job

    @classmethod
    async def update(cls, job_id: str, **fields: Any) -> None:
        fields["updatedAt"] = datetime.now(timezone.utc)
        await MongoDB.get_collection(cls.collection_name).update_one(
            {"_id": ObjectId(job_id)}, {"$set": fields}
        )

    @classmethod
    async def get(cls, job_id: str) -> Optional[Dict[str, Any]]:
        return await MongoDB.get_collection(cls.collection_name).find_one({"_id": ObjectId(job_id)})

    @classmethod
    async def list(cls, model_type: Optional[str] = None):
        query = {"modelType": model_type} if model_type else {}
        return await MongoDB.get_collection(cls.collection_name).find(query).sort("createdAt", -1).to_list(length=100)

    @staticmethod
    def public(job: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "modelId": str(job["_id"]),
            "modelType": job.get("modelType"),
            "status": job.get("status"),
            "progress": job.get("progress", 0),
            "accuracy": job.get("accuracy"),
            "metrics": job.get("metrics"),
            "startedAt": job.get("startedAt"),
            "completedAt": job.get("completedAt"),
            "message": job.get("error") or job.get("result"),
        }
