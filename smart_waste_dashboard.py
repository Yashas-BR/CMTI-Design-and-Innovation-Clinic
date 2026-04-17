"""Phase 2 prototype for IoT-based smart waste monitoring.

This script simulates distance readings for 5 retrofit-enabled bins,
calculates fill percentage, assigns status labels, prints a dashboard
table, and visualizes fill level using a bar chart.
"""

from __future__ import annotations

import random
from typing import Dict, List

import matplotlib.pyplot as plt


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


def print_table(records: List[Dict[str, float | str]]) -> None:
    """Print clean terminal dashboard table with required columns."""
    print("Smart Waste Bin Dashboard")
    print("-" * 40)
    print(f"{'Bin_ID':<10}{'Fill%':<12}{'Status':<10}")
    print("-" * 40)

    for row in records:
        print(f"{row['Bin_ID']:<10}{row['Fill_percent']:<12.2f}{row['Status']:<10}")


def plot_chart(records: List[Dict[str, float | str]]) -> None:
    """Plot fill percentage bar chart with value labels."""
    bin_ids = [str(row["Bin_ID"]) for row in records]
    fill_values = [float(row["Fill_percent"]) for row in records]

    bars = plt.bar(bin_ids, fill_values, color="#2E8B57", edgecolor="black")
    plt.title("Smart Waste Bin Fill Levels")
    plt.xlabel("Bin ID")
    plt.ylabel("Fill Percentage (%)")
    plt.ylim(0, 100)

    for bar, value in zip(bars, fill_values):
        plt.text(
            bar.get_x() + bar.get_width() / 2,
            value + 1,
            f"{value:.1f}%",
            ha="center",
            va="bottom",
        )

    plt.tight_layout()
    plt.show()


def main() -> None:
    """Run Phase 2 simulation workflow."""
    records = build_records()
    print_table(records)
    plot_chart(records)


if __name__ == "__main__":
    main()
