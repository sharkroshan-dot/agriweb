from typing import Dict, Any, Optional
from datetime import datetime
import json
import logging
import os

logger = logging.getLogger(__name__)

class ModelRegistry:
    """Registry for managing AI models."""

    def __init__(self):
        self.registry_file = "backend/ai/registry.json"
        self.models = self._load_registry()

    def _load_registry(self) -> Dict[str, Any]:
        try:
            if os.path.exists(self.registry_file):
                with open(self.registry_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            return {}
        except Exception as e:
            logger.error(f"Error loading model registry: {str(e)}")
            return {}

    def _save_registry(self):
        try:
            with open(self.registry_file, 'w', encoding='utf-8') as f:
                json.dump(self.models, f, indent=2, default=str)
        except Exception as e:
            logger.error(f"Error saving model registry: {str(e)}")

    def register_model(
        self,
        model_id: str,
        model_type: str,
        version: str,
        metadata: Dict[str, Any]
    ):
        self.models[model_id] = {
            "modelId": model_id,
            "modelType": model_type,
            "version": version,
            "status": "registered",
            "metadata": metadata,
            "registeredAt": datetime.utcnow().isoformat()
        }
        self._save_registry()

    def get_model(self, model_id: str) -> Optional[Dict[str, Any]]:
        return self.models.get(model_id)

    def update_model_status(self, model_id: str, status: str):
        if model_id in self.models:
            self.models[model_id]["status"] = status
            self._save_registry()

    def get_active_models(self) -> Dict[str, Any]:
        return {
            k: v for k, v in self.models.items()
            if v.get("status") in ["deployed", "ready"]
        }

model_registry = ModelRegistry()
