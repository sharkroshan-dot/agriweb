"""Model promotion helper based on registered validation metrics."""
from typing import Dict, Any, Optional
from .model_registry import list_models, register_model

def best_model(task: str, metric: str, lower_is_better: bool=True) -> Optional[Dict[str,Any]]:
    records=[r for r in list_models(task) if metric in r.get("metrics",{})]
    if not records:return None
    return sorted(records,key=lambda r:float(r["metrics"][metric]),reverse=not lower_is_better)[0]

def promote(task:str,version:str)->Optional[Dict[str,Any]]:
    target=next((r for r in list_models(task) if r.get("version")==version),None)
    if not target:return None
    return register_model(task,version,target.get("algorithm","unknown"),target.get("metrics",{}),int(target.get("samples",0)),target.get("features",[]),"production")
