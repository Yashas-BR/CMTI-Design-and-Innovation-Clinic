"""Routing matrix sublayer for route optimization.

Provider strategy:
- `osrm`: query OSRM table service (road-network based matrix).
- `local_dijkstra`: compute shortest paths over a local graph JSON.
- fallback always supports haversine matrix.
"""

from __future__ import annotations

import heapq
import json
from dataclasses import dataclass
from math import atan2, cos, radians, sin, sqrt
from pathlib import Path
from typing import Any

import httpx

from app.core.config import settings


@dataclass(slots=True)
class RoutingPoint:
    """One routing point used for matrix requests."""

    point_id: str
    latitude: float
    longitude: float


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_km = 6371.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    c = 2 * atan2(sqrt(a), sqrt(1 - a))
    return radius_km * c


def _haversine_matrix(points: list[RoutingPoint]) -> dict[tuple[str, str], float]:
    matrix: dict[tuple[str, str], float] = {}
    for src in points:
        for dst in points:
            matrix[(src.point_id, dst.point_id)] = _haversine_km(
                src.latitude,
                src.longitude,
                dst.latitude,
                dst.longitude,
            )
    return matrix


async def _osrm_matrix(points: list[RoutingPoint]) -> dict[tuple[str, str], float] | None:
    if not points:
        return {}

    coords = ";".join(f"{point.longitude},{point.latitude}" for point in points)
    base_url = settings.route_matrix_osrm_base_url.rstrip("/")
    profile = settings.route_matrix_osrm_profile.strip() or "driving"
    url = f"{base_url}/table/v1/{profile}/{coords}"

    try:
        async with httpx.AsyncClient(timeout=settings.route_matrix_timeout_seconds) as client:
            response = await client.get(url, params={"annotations": "distance"})
            response.raise_for_status()
            payload = response.json()
    except Exception:
        return None

    distances = payload.get("distances")
    if not isinstance(distances, list):
        return None

    matrix: dict[tuple[str, str], float] = {}
    for i, src in enumerate(points):
        row = distances[i] if i < len(distances) else None
        if not isinstance(row, list):
            return None
        for j, dst in enumerate(points):
            value_m = row[j] if j < len(row) else None
            if value_m is None:
                # OSRM can return null when disconnected; fallback to haversine for that edge.
                value_km = _haversine_km(src.latitude, src.longitude, dst.latitude, dst.longitude)
            else:
                value_km = float(value_m) / 1000.0
            matrix[(src.point_id, dst.point_id)] = value_km
    return matrix


def _nearest_graph_node(
    graph_nodes: dict[str, tuple[float, float]],
    point: RoutingPoint,
) -> str | None:
    if not graph_nodes:
        return None
    nearest_id: str | None = None
    nearest_dist = float("inf")
    for node_id, (lat, lon) in graph_nodes.items():
        dist = _haversine_km(point.latitude, point.longitude, lat, lon)
        if dist < nearest_dist:
            nearest_id = node_id
            nearest_dist = dist
    return nearest_id


def _dijkstra_shortest_paths(
    graph: dict[str, list[tuple[str, float]]],
    source: str,
) -> dict[str, float]:
    distances: dict[str, float] = {source: 0.0}
    heap: list[tuple[float, str]] = [(0.0, source)]

    while heap:
        current_dist, current = heapq.heappop(heap)
        if current_dist > distances.get(current, float("inf")):
            continue

        for neighbor, weight in graph.get(current, []):
            candidate = current_dist + weight
            if candidate < distances.get(neighbor, float("inf")):
                distances[neighbor] = candidate
                heapq.heappush(heap, (candidate, neighbor))

    return distances


def _local_dijkstra_matrix(points: list[RoutingPoint]) -> dict[tuple[str, str], float] | None:
    graph_file = settings.route_matrix_local_graph_file.strip()
    if not graph_file:
        return None

    file_path = Path(graph_file)
    if not file_path.exists() or not file_path.is_file():
        return None

    try:
        payload = json.loads(file_path.read_text(encoding="utf-8"))
    except Exception:
        return None

    nodes_raw = payload.get("nodes")
    edges_raw = payload.get("edges")
    if not isinstance(nodes_raw, list) or not isinstance(edges_raw, list):
        return None

    graph_nodes: dict[str, tuple[float, float]] = {}
    for node in nodes_raw:
        if not isinstance(node, dict):
            continue
        node_id = str(node.get("id", "")).strip()
        lat = node.get("lat")
        lon = node.get("lon")
        if not node_id or lat is None or lon is None:
            continue
        graph_nodes[node_id] = (float(lat), float(lon))

    if not graph_nodes:
        return None

    graph: dict[str, list[tuple[str, float]]] = {node_id: [] for node_id in graph_nodes.keys()}
    for edge in edges_raw:
        if not isinstance(edge, dict):
            continue
        src = str(edge.get("from", "")).strip()
        dst = str(edge.get("to", "")).strip()
        weight = edge.get("distance_km")
        if not src or not dst or weight is None:
            continue
        if src not in graph or dst not in graph:
            continue

        distance_km = float(weight)
        graph[src].append((dst, distance_km))
        if bool(edge.get("bidirectional", True)):
            graph[dst].append((src, distance_km))

    mapped_nodes: dict[str, str] = {}
    for point in points:
        mapped = _nearest_graph_node(graph_nodes, point)
        if mapped is None:
            return None
        mapped_nodes[point.point_id] = mapped

    matrix: dict[tuple[str, str], float] = {}
    for src in points:
        src_graph_node = mapped_nodes[src.point_id]
        shortest = _dijkstra_shortest_paths(graph, src_graph_node)
        for dst in points:
            dst_graph_node = mapped_nodes[dst.point_id]
            km = shortest.get(dst_graph_node)
            if km is None:
                km = _haversine_km(src.latitude, src.longitude, dst.latitude, dst.longitude)
            matrix[(src.point_id, dst.point_id)] = float(km)

    return matrix


async def build_travel_cost_matrix(points: list[RoutingPoint]) -> dict[tuple[str, str], float]:
    """Build pairwise travel-cost matrix with provider fallback.

    Returns a complete matrix for all point pairs, always populated.
    """
    provider = settings.route_matrix_provider.strip().lower()

    matrix: dict[tuple[str, str], float] | None = None
    if provider == "osrm":
        matrix = await _osrm_matrix(points)
    elif provider in {"local_dijkstra", "dijkstra"}:
        matrix = _local_dijkstra_matrix(points)

    if matrix is None:
        matrix = _haversine_matrix(points)

    return matrix
