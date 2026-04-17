"""Smart Waste Management Dashboard for municipal operations.

Run:
    streamlit run waste_management_dashboard.py
"""

from __future__ import annotations

import csv
import io
import random
from dataclasses import dataclass, asdict
from datetime import datetime
from typing import Dict, List, Tuple

import matplotlib.pyplot as plt
import streamlit as st


BIN_HEIGHT_CM = 50
BIN_IDS = ["B1", "B2", "B3", "B4", "B5"]
MIN_DISTANCE_CM = 5
MAX_DISTANCE_CM = 50
WARDS = ["Ward-A", "Ward-B", "Ward-C", "Ward-D", "Ward-E"]


@dataclass
class BinRecord:
    bin_id: str
    ward: str
    distance_cm: float
    fill_percent: float
    status: str
    fill_rate_per_hour: float
    time_remaining_hours: float
    urgency_score: float
    distance_from_depot_km: float
    priority_score: float


def calculate_fill(distance_cm: float, bin_height_cm: float = BIN_HEIGHT_CM) -> float:
    """Compute fill percentage from ultrasonic distance reading."""
    fill_percent = ((bin_height_cm - distance_cm) / bin_height_cm) * 100
    return round(max(0.0, min(100.0, fill_percent)), 2)


def assign_status(fill_percent: float) -> str:
    """Assign level based on fill percentage threshold policy."""
    if fill_percent < 40:
        return "Low"
    if fill_percent < 75:
        return "Medium"
    return "Full"


def estimate_time_remaining(fill_percent: float, fill_rate_per_hour: float) -> float:
    """Estimate hours to full assuming a constant fill rate."""
    remaining = max(0.0, 100.0 - fill_percent)
    if fill_rate_per_hour <= 0:
        return 99.0
    return round(remaining / fill_rate_per_hour, 2)


def calculate_urgency_score(time_remaining_hours: float) -> float:
    """Convert remaining time to urgency on a 0-100 scale."""
    urgency = 100.0 - min(100.0, time_remaining_hours * 10.0)
    return round(max(0.0, urgency), 2)


def calculate_priority(fill_percent: float, urgency_score: float, distance_score: float) -> float:
    """Apply project's weighted priority formula."""
    score = (0.5 * fill_percent) + (0.3 * urgency_score) + (0.2 * distance_score)
    return round(score, 2)


def generate_data(seed: int, base_fill_rate: float) -> List[BinRecord]:
    """Generate simulated IoT readings and operational metrics for bins."""
    random.seed(seed)
    records: List[BinRecord] = []

    for idx, bin_id in enumerate(BIN_IDS):
        distance_cm = float(random.randint(MIN_DISTANCE_CM, MAX_DISTANCE_CM))
        fill_percent = calculate_fill(distance_cm)
        status = assign_status(fill_percent)

        fill_rate = round(random.uniform(max(0.5, base_fill_rate - 1.0), base_fill_rate + 1.5), 2)
        time_remaining = estimate_time_remaining(fill_percent, fill_rate)
        urgency_score = calculate_urgency_score(time_remaining)

        distance_from_depot = round(random.uniform(0.8, 8.0), 2)
        distance_score = min(100.0, distance_from_depot * 12.5)
        priority = calculate_priority(fill_percent, urgency_score, distance_score)

        records.append(
            BinRecord(
                bin_id=bin_id,
                ward=WARDS[idx],
                distance_cm=distance_cm,
                fill_percent=fill_percent,
                status=status,
                fill_rate_per_hour=fill_rate,
                time_remaining_hours=time_remaining,
                urgency_score=urgency_score,
                distance_from_depot_km=distance_from_depot,
                priority_score=priority,
            )
        )

    return records


def to_rows(records: List[BinRecord]) -> List[Dict[str, float | str]]:
    """Convert dataclass records to table-friendly dictionaries."""
    rows: List[Dict[str, float | str]] = []
    for rec in records:
        rows.append(
            {
                "Bin_ID": rec.bin_id,
                "Ward": rec.ward,
                "Fill%": rec.fill_percent,
                "Status": rec.status,
                "Fill_Rate(%/hr)": rec.fill_rate_per_hour,
                "Time_Remaining(hr)": rec.time_remaining_hours,
                "Urgency": rec.urgency_score,
                "Depot_Distance(km)": rec.distance_from_depot_km,
                "Priority": rec.priority_score,
            }
        )
    return rows


def make_csv(records: List[BinRecord]) -> str:
    """Create CSV export payload for dispatch sharing."""
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=list(asdict(records[0]).keys()))
    writer.writeheader()
    for rec in records:
        writer.writerow(asdict(rec))
    return output.getvalue()


def route_plan(records: List[BinRecord], threshold: float) -> List[Tuple[int, str, float, float]]:
    """Generate simple dispatch order by priority then proximity."""
    selected = [r for r in records if r.priority_score >= threshold or r.status == "Full"]
    selected.sort(key=lambda r: (-r.priority_score, r.distance_from_depot_km))

    plan: List[Tuple[int, str, float, float]] = []
    for idx, rec in enumerate(selected, start=1):
        plan.append((idx, rec.bin_id, rec.priority_score, rec.distance_from_depot_km))
    return plan


def draw_fill_chart(records: List[BinRecord]) -> None:
    """Draw fill percentage chart with labels by bin."""
    labels = [r.bin_id for r in records]
    values = [r.fill_percent for r in records]
    colors = ["#2ecc71" if r.status == "Low" else "#f1c40f" if r.status == "Medium" else "#e74c3c" for r in records]

    fig, ax = plt.subplots(figsize=(8, 4.5))
    bars = ax.bar(labels, values, color=colors, edgecolor="black")
    ax.set_title("Bin Fill Level Overview")
    ax.set_xlabel("Bin ID")
    ax.set_ylabel("Fill Percentage")
    ax.set_ylim(0, 100)

    for bar, val in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width() / 2, val + 1, f"{val:.1f}%", ha="center", va="bottom")

    st.pyplot(fig)


def main() -> None:
    """Render operations dashboard for smart waste monitoring."""
    st.set_page_config(page_title="InfraSense WasteOps Dashboard", page_icon="🗑", layout="wide")

    st.title("InfraSense Systems | Smart Waste Operations Dashboard")
    st.caption("Low-cost IoT retrofit monitoring for urban waste collection departments")

    with st.sidebar:
        st.header("Simulation Controls")
        seed = st.slider("Random scenario seed", min_value=1, max_value=999, value=42)
        base_fill_rate = st.slider("Base fill rate (% per hour)", min_value=0.5, max_value=8.0, value=3.0, step=0.5)
        priority_threshold = st.slider("Priority dispatch threshold", min_value=40.0, max_value=95.0, value=70.0, step=1.0)
        st.write("Use these controls during demos to simulate different city conditions.")

    records = generate_data(seed=seed, base_fill_rate=base_fill_rate)
    rows = to_rows(records)

    full_bins = sum(1 for r in records if r.status == "Full")
    avg_fill = round(sum(r.fill_percent for r in records) / len(records), 2)
    urgent_bins = sum(1 for r in records if r.priority_score >= priority_threshold or r.status == "Full")

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Total Bins", len(records))
    c2.metric("Full Bins", full_bins)
    c3.metric("Avg Fill%", avg_fill)
    c4.metric("Bins for Dispatch", urgent_bins)

    tab1, tab2, tab3 = st.tabs(["Live Monitoring", "Priority Dispatch", "Route Plan"])

    with tab1:
        st.subheader("Real-Time Bin Health")
        st.dataframe(rows, use_container_width=True)
        draw_fill_chart(records)

    with tab2:
        st.subheader("Collection Priority Queue")
        ranked = sorted(rows, key=lambda row: float(row["Priority"]), reverse=True)
        st.dataframe(ranked, use_container_width=True)

        csv_payload = make_csv(records)
        st.download_button(
            label="Download Dispatch Snapshot (CSV)",
            data=csv_payload,
            file_name=f"dispatch_snapshot_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
            mime="text/csv",
        )

    with tab3:
        st.subheader("Recommended Collection Order")
        plan = route_plan(records, threshold=priority_threshold)

        if not plan:
            st.info("No bins cross the threshold right now. Keep monitoring.")
        else:
            plan_rows = [
                {
                    "Stop": stop,
                    "Bin_ID": bin_id,
                    "Priority": priority,
                    "Distance_from_Depot(km)": distance,
                }
                for stop, bin_id, priority, distance in plan
            ]
            st.table(plan_rows)

            st.markdown("### Dispatch Notes")
            st.write("1. Prioritize Full bins even if slightly farther away.")
            st.write("2. Use the queue to assign vehicles by zone/ward.")
            st.write("3. Re-run every cycle to update route decisions.")


if __name__ == "__main__":
    main()
