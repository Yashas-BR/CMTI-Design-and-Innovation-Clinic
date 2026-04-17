"""Simple load check utility for MQTT ingest endpoint.

Usage:
    python tests/load_check_mqtt_ingest.py --base-url http://localhost:8000 --requests 500 --concurrency 25
"""

from __future__ import annotations

import argparse
import asyncio
from time import perf_counter

import httpx


def _build_payload(index: int) -> dict:
    return {
        "topic": "smartbin/BIN_001/data",
        "payload": {
            "bin_id": "BIN_001",
            "ts": index,
            "fill_pct": float((index % 100)),
            "fill_rate": 0.1,
            "ttf_min": 90,
            "priority": 55,
            "alert": "GREEN",
            "overflow_imminent": False,
            "queued": False,
        },
        "qos": 0,
        "retain": False,
    }


async def _one_request(client: httpx.AsyncClient, base_url: str, index: int) -> tuple[int, float]:
    start = perf_counter()
    response = await client.post(f"{base_url}/api/v1/mqtt/ingest", json=_build_payload(index))
    elapsed = perf_counter() - start
    return response.status_code, elapsed


async def run_load(base_url: str, requests: int, concurrency: int) -> None:
    semaphore = asyncio.Semaphore(max(concurrency, 1))

    async with httpx.AsyncClient(timeout=10.0) as client:
        async def wrapped(index: int) -> tuple[int, float]:
            async with semaphore:
                return await _one_request(client, base_url, index)

        started = perf_counter()
        results = await asyncio.gather(*[wrapped(i) for i in range(requests)])
        total_elapsed = perf_counter() - started

    status_counts: dict[int, int] = {}
    latencies = []
    for code, elapsed in results:
        status_counts[code] = status_counts.get(code, 0) + 1
        latencies.append(elapsed)

    latencies.sort()
    p50 = latencies[int(0.50 * len(latencies))] if latencies else 0.0
    p95 = latencies[int(0.95 * len(latencies))] if latencies else 0.0
    rps = (requests / total_elapsed) if total_elapsed > 0 else 0.0

    print("Load check complete")
    print(f"  requests:     {requests}")
    print(f"  concurrency:  {concurrency}")
    print(f"  duration_s:   {total_elapsed:.2f}")
    print(f"  rps:          {rps:.2f}")
    print(f"  p50_s:        {p50:.4f}")
    print(f"  p95_s:        {p95:.4f}")
    print(f"  status_count: {status_counts}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Load check for MQTT ingest endpoint")
    parser.add_argument("--base-url", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--requests", type=int, default=200, help="Total requests")
    parser.add_argument("--concurrency", type=int, default=20, help="Concurrent workers")
    args = parser.parse_args()

    asyncio.run(run_load(args.base_url, args.requests, args.concurrency))
