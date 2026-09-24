"""Small JSON model registry for reproducible AgriConnect model selection."""
from pathlib import Path
from datetime import datetime, timezone
import json
from typing import Any, Dict, List, Optional

DEFAULT_PATH = Path("backend/app/ai/models/weights/model_registry.json")


def _path(path: Optional[str] = None) -> Path:
    return Path(path or DEFAULT_PATH)


def register_model(task: str, version: str, algorithm: str, metrics: Dict[str, Any], samples: int, features: List[str], status: str = "candidate", path: Optional[str] = None) -> Dict[str, Any]:
    target = _path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {"task": task, "version": version, "algorithm": algorithm, "metrics": metrics, "samples": samples, "features": features, "status": status, "registered_at": datetime.now(timezone.utc).isoformat()}
    records = []
    if target.exists():
        try:
            records = json.loads(target.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            records = []
    records = [r for r in records if not (r.get("task") == task and r.get("version") == version)]
    records.append(payload)
    target.write_text(json.dumps(records, indent=2), encoding="utf-8")
    return payload


def list_models(task: Optional[str] = None, path: Optional[str] = None) -> List[Dict[str, Any]]:
    target = _path(path)
    if not target.exists():
        return []
    try:
        records = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [r for r in records if task is None or r.get("task") == task]
