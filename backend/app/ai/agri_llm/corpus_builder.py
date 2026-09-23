"""Build AgriConnect-specific LLM training examples from the repository.

This reads the project's own source tree. It never downloads a pretrained model
and it never stores private runtime records in the training corpus.
"""
from __future__ import annotations
import json
import re
from pathlib import Path
from typing import Iterable

INTENT_BY_ROUTE = {
    "nearby": "product_search",
    "marketplace": "navigate",
    "orders": "navigate",
    "cart": "navigate",
    "wishlist": "navigate",
    "subscriptions": "navigate",
    "trace": "traceability",
    "delivery": "delivery_information",
    "deliveries": "delivery_information",
    "analytics": "navigate",
    "ai-predictions": "navigate",
    "farmer": "navigate",
    "dashboard": "navigate",
}

def _route_name(path: Path, root: Path) -> str | None:
    rel = path.relative_to(root).as_posix()
    if not rel.endswith("/page.tsx") and not rel.endswith("/page.ts"):
        return None
    route = rel[:-len("/page.tsx")] if rel.endswith("/page.tsx") else rel[:-len("/page.ts")]
    route = route.replace("/page", "").strip("/")
    if not route:
        return "/"
    # Ignore dynamic implementation-only pages when generating navigation targets.
    if "[" in route or "]" in route:
        return None
    return "/" + route

def discover_routes(repo_root: Path) -> list[str]:
    website = repo_root / "website" / "app"
    if not website.exists():
        return []
    routes = []
    for p in website.rglob("page.tsx"):
        route = _route_name(p, website)
        if route:
            routes.append(route)
    return sorted(set(routes))

def discover_backend_capabilities(repo_root: Path) -> list[str]:
    backend = repo_root / "backend" / "app"
    if not backend.exists():
        return []
    names: set[str] = set()
    for p in backend.rglob("*.py"):
        if p.name.startswith("__"):
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for match in re.finditer(r"async\s+def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", text):
            name = match.group(1)
            if any(k in name.lower() for k in (
                "predict","forecast","delivery","route","trace","quality",
                "recommend","fraud","demand","price","product","market",
                "order","subscription","analytics","assistant"
            )):
                names.add(name)
    return sorted(names)

def _plan(intent: str, query: str = "", product: str = "", destination: str = "", open_page: bool = False):
    return {"requests": [{"intent": intent, "query": query, "product": product,
                          "days": 7, "destination": destination, "open": open_page}]}

def build_repository_training_rows(repo_root: str | Path) -> list[tuple[str, dict]]:
    root = Path(repo_root)
    rows: list[tuple[str, dict]] = []

    for route in discover_routes(root):
        label = route.strip("/").replace("-", " ").replace("/", " ").replace("_", " ").strip() or "home"
        rows.extend([
            (f"open {label}", _plan("navigate", label, destination=route, open_page=True)),
            (f"go to {label}", _plan("navigate", label, destination=route, open_page=True)),
            (f"take me to the {label} page", _plan("navigate", label, destination=route, open_page=True)),
            (f"show me {label}", _plan("navigate", label, destination=route, open_page=True)),
        ])

    for capability in discover_backend_capabilities(root):
        label = capability.replace("_", " ").strip()
        low = label.lower()
        if "demand" in low or "forecast" in low:
            intent = "demand_forecast"
        elif "price" in low or "predict" in low:
            intent = "price_prediction"
        elif "delivery" in low or "route" in low:
            intent = "delivery_information"
        elif "trace" in low:
            intent = "traceability"
        elif "product" in low or "market" in low:
            intent = "product_search"
        else:
            continue
        rows.append((f"help me with {label}", _plan(intent, label)))

    return rows

def training_texts(repo_root: str | Path) -> list[str]:
    rows = build_repository_training_rows(repo_root)
    return [
        f"USER: {q}\nASSISTANT: {json.dumps(a, separators=(',', ':'))}"
        for q, a in rows
    ]
