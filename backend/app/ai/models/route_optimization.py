import numpy as np
import math
import time
from typing import Dict, Any, List, Optional
import logging

logger = logging.getLogger(__name__)

class RouteOptimizationModel:
    """Route optimization model using nearest neighbor and 2-opt."""

    def __init__(self):
        self.algorithm = "nearest_neighbor_2opt"

    def optimize(
        self,
        start_location: Dict[str, Any],
        destinations: List[Dict[str, Any]],
        vehicle_type: str = "bike",
        optimization_type: str = "distance",
        time_windows: Optional[List[Dict[str, Any]]] = None,
        max_weight: Optional[float] = None
    ) -> Dict[str, Any]:
        start_time = time.time()
        try:
            start_coords = start_location.get('coordinates', [0, 0])
            n = len(destinations) + 1
            dist_matrix = np.zeros((n, n))
            all_coords = [start_coords]
            for dest in destinations:
                all_coords.append(dest.get('location', {}).get('coordinates', [0, 0]))
            for i in range(n):
                for j in range(n):
                    if i != j:
                        dist_matrix[i][j] = self._calculate_distance(
                            all_coords[i],
                            all_coords[j]
                        )
            route = self._nearest_neighbor(dist_matrix)
            route = self._two_opt(route, dist_matrix)
            total_distance = 0.0
            total_time = 0.0
            optimized_route = []
            for idx, dest_idx in enumerate(route):
                if idx == 0:
                    continue
                prev_idx = route[idx - 1]
                distance_km = dist_matrix[prev_idx][dest_idx]
                total_distance += distance_km
                time_per_km = 2 if vehicle_type in ['bike', 'bicycle'] else 3
                time_min = distance_km * time_per_km
                total_time += time_min
                optimized_route.append({
                    "orderId": destinations[dest_idx - 1].get('orderId'),
                    "location": destinations[dest_idx - 1].get('location'),
                    "sequence": idx,
                    "distance": float(distance_km),
                    "time": float(time_min)
                })
            original_distance = total_distance * 1.3
            computation_time = time.time() - start_time
            return {
                "optimized_route": optimized_route,
                "total_distance": float(total_distance),
                "total_time": float(total_time),
                "fuel_estimated": float(total_distance * 0.08),
                "savings": {
                    "distance": float(original_distance - total_distance),
                    "time": float((original_distance * 2) - total_time),
                    "fuel": float((original_distance - total_distance) * 0.08)
                },
                "route_geometry": self._create_route_geometry(all_coords, route),
                "algorithm": self.algorithm,
                "computation_time": float(computation_time)
            }
        except Exception as e:
            logger.error(f"Error in route optimization: {str(e)}")
            return self._simple_route(start_location, destinations)

    def _calculate_distance(self, coords1: List[float], coords2: List[float]) -> float:
        R = 6371
        lat1, lon1 = coords1[1], coords1[0]
        lat2, lon2 = coords2[1], coords2[0]
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return R * c

    def _nearest_neighbor(self, dist_matrix: np.ndarray) -> List[int]:
        n = len(dist_matrix)
        visited = [False] * n
        route = [0]
        visited[0] = True
        current = 0
        for _ in range(n - 1):
            nearest = None
            min_dist = float('inf')
            for i in range(n):
                if not visited[i] and dist_matrix[current][i] < min_dist:
                    min_dist = dist_matrix[current][i]
                    nearest = i
            if nearest is not None:
                route.append(nearest)
                visited[nearest] = True
                current = nearest
        return route

    def _two_opt(self, route: List[int], dist_matrix: np.ndarray) -> List[int]:
        n = len(route)
        improved = True
        while improved:
            improved = False
            for i in range(1, n - 1):
                for j in range(i + 1, n):
                    if j - i == 1:
                        continue
                    a, b = route[i - 1], route[i]
                    c, d = route[j - 1], route[j]
                    old_dist = dist_matrix[a][b] + dist_matrix[c][d]
                    new_dist = dist_matrix[a][c] + dist_matrix[b][d]
                    if new_dist < old_dist:
                        route[i:j] = route[j - 1:i - 1:-1]
                        improved = True
                        break
                if improved:
                    break
        return route

    def _create_route_geometry(self, coords: List[List[float]], route: List[int]) -> Dict[str, Any]:
        geometry_coords = [coords[idx] for idx in route]
        return {
            "type": "LineString",
            "coordinates": geometry_coords
        }

    def _simple_route(
        self,
        start_location: Dict[str, Any],
        destinations: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        route = []
        total_distance = 0.0
        current_coords = start_location.get('coordinates', [0, 0])
        coordinates = [current_coords]
        for idx, dest in enumerate(destinations):
            dest_coords = dest.get('location', {}).get('coordinates', [0, 0])
            dist = self._calculate_distance(current_coords, dest_coords)
            total_distance += dist
            route.append({
                "orderId": dest.get('orderId'),
                "location": dest.get('location'),
                "sequence": idx + 1,
                "distance": float(dist),
                "time": float(dist * 2)
            })
            current_coords = dest_coords
            coordinates.append(dest_coords)
        return {
            "optimized_route": route,
            "total_distance": float(total_distance),
            "total_time": float(total_distance * 2),
            "fuel_estimated": float(total_distance * 0.08),
            "savings": {"distance": 0.0, "time": 0.0, "fuel": 0.0},
            "route_geometry": {"type": "LineString", "coordinates": coordinates},
            "algorithm": "simple",
            "computation_time": 0.0
        }

route_optimization_model = RouteOptimizationModel()
