"""Shared, working-directory-independent upload storage path resolution."""
from pathlib import Path

from app.core.config import PROJECT_ROOT, settings


def get_upload_directory() -> Path:
    """Return one absolute upload directory for both saving and serving.

    Older local runs may have created uploads relative to either the
    repository root or backend directory. Prefer the existing directory
    with the most files so evidence survives a Uvicorn restart from a
    different working directory.
    """
    configured = Path(settings.UPLOAD_DIR).expanduser()
    if configured.is_absolute():
        target = configured.resolve()
        target.mkdir(parents=True, exist_ok=True)
        return target

    candidates = [
        (Path.cwd() / configured).resolve(),
        (PROJECT_ROOT / "backend" / configured).resolve(),
        (PROJECT_ROOT / configured).resolve(),
    ]
    unique_candidates = list(dict.fromkeys(candidates))
    existing = [path for path in unique_candidates if path.is_dir()]

    if existing:
        def file_count(path: Path) -> int:
            try:
                return sum(1 for item in path.iterdir() if item.is_file())
            except OSError:
                return 0

        target = max(existing, key=file_count)
    else:
        target = (PROJECT_ROOT / "backend" / configured).resolve()

    target.mkdir(parents=True, exist_ok=True)
    return target
