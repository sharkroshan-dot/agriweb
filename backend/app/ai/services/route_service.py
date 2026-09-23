"""Route optimization orchestration helpers."""
from typing import Any, Dict, List, Optional

from app.ai.models.route_optimization import route_optimization_model


def optimize_route(
    start_location: Dict[str, Any],
    destinations: List[Dict[str, Any]],
    vehicle_type: str = "bike",
    optimization_type: str = "distance",
    time_windows: Optional[List[Dict[str, Any]]] = None,
    max_weight: Optional[float] = None,
) -> Dict[str, Any]:
    return route_optimization_model.optimize(
        start_location,
        destinations,
        vehicle_type,
        optimization_type,
        time_windows,
        max_weight,
    )
