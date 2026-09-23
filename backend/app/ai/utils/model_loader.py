"""Safe model loading helpers."""
from pathlib import Path
from typing import Any, Callable, Optional


def load_joblib_model(
    path: str | Path, loader: Optional[Callable[[str], Any]] = None
) -> Any:
    if loader is None:
        import joblib
        loader = joblib.load
    model_path = Path(path)
    if not model_path.exists():
        return None
    return loader(str(model_path))
