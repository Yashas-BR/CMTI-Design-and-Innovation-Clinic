"""Phase 1 prototype for IoT-based smart waste monitoring.

This script simulates distance readings for 5 retrofit-enabled bins,
calculates fill percentage, and assigns status labels.
"""

from __future__ import annotations

import random
from typing import Dict, List


# Project constants for simulation
BIN_HEIGHT_CM = 50
BIN_IDS = ["B1", "B2", "B3", "B4", "B5"]
MIN_DISTANCE_CM = 5
MAX_DISTANCE_CM = 50


def generate_data() -> List[Dict[str, float]]:
    """Generate one simulated distance reading per bin."""
    records: List[Dict[str, float]] = []

    for bin_id in BIN_IDS:
        distance_cm = random.randint(MIN_DISTANCE_CM, MAX_DISTANCE_CM)
        records.append({"Bin_ID": bin_id, "Distance_cm": float(distance_cm)})

    return records


def calculate_fill(distance_cm: float, bin_height_cm: float = BIN_HEIGHT_CM) -> float:
    """Calculate fill percentage from distance and bin height."""
    fill_percent = ((bin_height_cm - distance_cm) / bin_height_cm) * 100
    return round(fill_percent, 2)


def assign_status(fill_percent: float) -> str:
    """Map fill percentage to Low/Medium/Full status."""
    if fill_percent < 40:
        return "Low"
    if fill_percent < 75:
        return "Medium"
    return "Full"


def build_records() -> List[Dict[str, float | str]]:
    """Create full records including fill percentage and status."""
    raw_records = generate_data()
    enriched_records: List[Dict[str, float | str]] = []

    for record in raw_records:
        distance_cm = float(record["Distance_cm"])
        fill_percent = calculate_fill(distance_cm)
        status = assign_status(fill_percent)

        enriched_records.append(
            {
                "Bin_ID": record["Bin_ID"],
                "Distance_cm": distance_cm,
                "Fill_percent": fill_percent,
                "Status": status,
            }
        )

    return enriched_records


def print_phase1_output(records: List[Dict[str, float | str]]) -> None:
    """Print simple Phase 1 sanity output for each bin."""
    print("Phase 1: Simulated Smart Bin Data")
    print("-" * 62)
    print(f"{'Bin_ID':<8}{'Distance_cm':<14}{'Fill_percent':<14}{'Status':<10}")
    print("-" * 62)

    for row in records:
        print(
            f"{row['Bin_ID']:<8}"
            f"{row['Distance_cm']:<14.2f}"
            f"{row['Fill_percent']:<14.2f}"
            f"{row['Status']:<10}"
        )


def main() -> None:
    """Run Phase 1 simulation workflow."""
    records = build_records()
    print_phase1_output(records)


if __name__ == "__main__":
    main()
