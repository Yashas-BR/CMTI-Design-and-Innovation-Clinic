"""Flask API backend for InfraSense Smart Waste Management Dashboard."""

from __future__ import annotations

import csv
import io
import os
import random
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, List, Tuple
from urllib.parse import urlencode

import jwt
import requests
from flask import Flask, redirect, request
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.config["SECRET_KEY"] = "your-secret-key-change-in-production"
CORS(app)

# Constants
BIN_HEIGHT_CM = 50
BIN_IDS = ["B1", "B2", "B3", "B4", "B5"]
MIN_DISTANCE_CM = 5
MAX_DISTANCE_CM = 50
WARDS = ["Ward-A", "Ward-B", "Ward-C", "Ward-D", "Ward-E"]

DRIVER_ASSIGNMENTS = {
    "driverA": ["B1", "B2", "B3"],
    "Driver-2": ["B4"],
    "Driver-3": ["B5"],
}

USERS = {
    "auth": {"password": "auth@123", "role": "Authority"},
    "driverA": {"password": "driverA@123", "role": "Driver"},
}

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "http://127.0.0.1:5000/api/auth/google/callback")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://127.0.0.1:5175")
GOOGLE_AUTHORITY_EMAIL = os.getenv("GOOGLE_AUTHORITY_EMAIL", "").lower().strip()
GOOGLE_DRIVERA_EMAIL = os.getenv("GOOGLE_DRIVERA_EMAIL", "").lower().strip()

GOOGLE_OAUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"


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


def create_app_token(username: str, role: str) -> str:
    """Create app JWT token for authenticated sessions."""
    return jwt.encode(
        {
            "username": username,
            "role": role,
            "exp": datetime.utcnow() + timedelta(hours=24),
        },
        app.config["SECRET_KEY"],
        algorithm="HS256",
    )


def create_google_state(role: str) -> str:
    """Create signed state token carrying desired role."""
    return jwt.encode(
        {
            "role": role,
            "exp": datetime.utcnow() + timedelta(minutes=10),
        },
        app.config["SECRET_KEY"],
        algorithm="HS256",
    )


def resolve_google_user(email: str, requested_role: str) -> Tuple[str, str] | None:
    """Map Google account to application user role."""
    normalized_email = email.lower().strip()

    if GOOGLE_AUTHORITY_EMAIL and normalized_email == GOOGLE_AUTHORITY_EMAIL:
        return ("auth", "Authority")
    if GOOGLE_DRIVERA_EMAIL and normalized_email == GOOGLE_DRIVERA_EMAIL:
        return ("driverA", "Driver")

    # Fallback for local demo when allowlist env vars are not configured.
    if requested_role == "Authority":
        return ("auth", "Authority")
    return ("driverA", "Driver")


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


def records_to_rows(records: List[BinRecord]) -> List[Dict[str, Any]]:
    """Convert dataclass records to dict rows."""
    rows: List[Dict[str, Any]] = []
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


def filter_records_for_driver(records: List[BinRecord], assigned_bins: List[str]) -> List[BinRecord]:
    """Limit records to a driver's assigned bins only."""
    allowed = set(assigned_bins)
    return [rec for rec in records if rec.bin_id in allowed]


def route_plan(records: List[BinRecord], threshold: float) -> List[Dict[str, Any]]:
    """Generate simple dispatch order by priority then proximity."""
    selected = [r for r in records if r.priority_score >= threshold or r.status == "Full"]
    selected.sort(key=lambda r: (-r.priority_score, r.distance_from_depot_km))

    plan: List[Dict[str, Any]] = []
    for idx, rec in enumerate(selected, start=1):
        plan.append(
            {
                "Stop": idx,
                "Bin_ID": rec.bin_id,
                "Priority": rec.priority_score,
                "Distance_from_Depot(km)": rec.distance_from_depot_km,
            }
        )
    return plan


@app.route("/api/auth/login", methods=["POST"])
def login() -> Tuple[Dict[str, Any], int]:
    """Login with username/password and return JWT token."""
    data = request.get_json() or {}
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()

    user = USERS.get(username)
    if not user or user["password"] != password:
        return {"error": "Invalid credentials"}, 401

    token = create_app_token(username=username, role=str(user["role"]))
    return {"token": token, "username": username, "role": user["role"]}, 200


@app.route("/api/auth/google/url", methods=["POST"])
def google_auth_url() -> Tuple[Dict[str, Any], int]:
    """Create Google OAuth URL for frontend redirect."""
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        return {"error": "Google OAuth is not configured on backend."}, 400

    data = request.get_json() or {}
    requested_role = str(data.get("role", "Driver"))
    if requested_role not in {"Authority", "Driver"}:
        requested_role = "Driver"

    state = create_google_state(role=requested_role)
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "online",
        "prompt": "select_account",
        "state": state,
    }
    return {"auth_url": f"{GOOGLE_OAUTH_URL}?{urlencode(params)}"}, 200


@app.route("/api/auth/google/callback", methods=["GET"])
def google_auth_callback():
    """Handle Google OAuth callback and redirect user to frontend with app token."""
    code = request.args.get("code", "")
    state = request.args.get("state", "")

    if not code or not state:
        return redirect(f"{FRONTEND_URL}/?error=google_auth_failed")

    try:
        decoded_state = jwt.decode(state, app.config["SECRET_KEY"], algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return redirect(f"{FRONTEND_URL}/?error=invalid_google_state")

    requested_role = str(decoded_state.get("role", "Driver"))

    token_response = requests.post(
        GOOGLE_TOKEN_URL,
        data={
            "code": code,
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": GOOGLE_REDIRECT_URI,
            "grant_type": "authorization_code",
        },
        timeout=20,
    )

    if token_response.status_code != 200:
        return redirect(f"{FRONTEND_URL}/?error=google_token_exchange_failed")

    access_token = token_response.json().get("access_token", "")
    if not access_token:
        return redirect(f"{FRONTEND_URL}/?error=google_access_token_missing")

    profile_response = requests.get(
        GOOGLE_USERINFO_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=20,
    )
    if profile_response.status_code != 200:
        return redirect(f"{FRONTEND_URL}/?error=google_profile_failed")

    profile = profile_response.json()
    mapped_user = resolve_google_user(email=str(profile.get("email", "")), requested_role=requested_role)
    if mapped_user is None:
        return redirect(f"{FRONTEND_URL}/?error=google_user_not_allowed")

    username, role = mapped_user
    app_token = create_app_token(username=username, role=role)
    return redirect(f"{FRONTEND_URL}/?token={app_token}")


@app.route("/api/auth/verify", methods=["POST"])
def verify_token() -> Tuple[Dict[str, Any], int]:
    """Verify JWT token and return user info."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return {"error": "Missing or invalid token"}, 401

    token = auth_header[7:]
    try:
        payload = jwt.decode(token, app.config["SECRET_KEY"], algorithms=["HS256"])
        return {"username": payload["username"], "role": payload["role"]}, 200
    except jwt.ExpiredSignatureError:
        return {"error": "Token expired"}, 401
    except jwt.InvalidTokenError:
        return {"error": "Invalid token"}, 401


@app.route("/api/dashboard/data", methods=["GET"])
def get_dashboard_data() -> Tuple[Dict[str, Any], int]:
    """Get bin data and metrics, optionally filtered for driver."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return {"error": "Unauthenticated"}, 401

    token = auth_header[7:]
    try:
        payload = jwt.decode(token, app.config["SECRET_KEY"], algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return {"error": "Invalid token"}, 401

    role = payload.get("role", "")
    username = payload.get("username", "")

    seed = int(request.args.get("seed", 42))
    base_fill_rate = float(request.args.get("base_fill_rate", 3.0))
    priority_threshold = float(request.args.get("priority_threshold", 70.0))

    records = generate_data(seed=seed, base_fill_rate=base_fill_rate)

    if role == "Driver":
        if username in DRIVER_ASSIGNMENTS:
            records = filter_records_for_driver(records, DRIVER_ASSIGNMENTS[username])

    rows = records_to_rows(records)

    full_bins = sum(1 for r in records if r.status == "Full")
    avg_fill = round(sum(r.fill_percent for r in records) / len(records), 2) if records else 0.0
    urgent_bins = sum(1 for r in records if r.priority_score >= priority_threshold or r.status == "Full")

    return {
        "role": role,
        "username": username,
        "total_bins": len(records),
        "full_bins": full_bins,
        "avg_fill": avg_fill,
        "urgent_bins": urgent_bins,
        "rows": rows,
        "driver_assignment": DRIVER_ASSIGNMENTS if role == "Authority" else {username: DRIVER_ASSIGNMENTS.get(username, [])},
    }, 200


@app.route("/api/dashboard/priority", methods=["GET"])
def get_priority_queue() -> Tuple[Dict[str, Any], int]:
    """Get priority-sorted dispatch queue."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return {"error": "Unauthenticated"}, 401

    token = auth_header[7:]
    try:
        payload = jwt.decode(token, app.config["SECRET_KEY"], algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return {"error": "Invalid token"}, 401

    role = payload.get("role", "")
    username = payload.get("username", "")

    seed = int(request.args.get("seed", 42))
    base_fill_rate = float(request.args.get("base_fill_rate", 3.0))

    records = generate_data(seed=seed, base_fill_rate=base_fill_rate)

    if role == "Driver":
        if username in DRIVER_ASSIGNMENTS:
            records = filter_records_for_driver(records, DRIVER_ASSIGNMENTS[username])

    rows = sorted(records_to_rows(records), key=lambda row: float(row["Priority"]), reverse=True)
    return {"queue": rows}, 200


@app.route("/api/dashboard/route", methods=["GET"])
def get_route_plan() -> Tuple[Dict[str, Any], int]:
    """Get recommended collection order."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return {"error": "Unauthenticated"}, 401

    token = auth_header[7:]
    try:
        payload = jwt.decode(token, app.config["SECRET_KEY"], algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return {"error": "Invalid token"}, 401

    role = payload.get("role", "")
    username = payload.get("username", "")

    seed = int(request.args.get("seed", 42))
    base_fill_rate = float(request.args.get("base_fill_rate", 3.0))
    priority_threshold = float(request.args.get("priority_threshold", 70.0))

    records = generate_data(seed=seed, base_fill_rate=base_fill_rate)

    if role == "Driver":
        if username in DRIVER_ASSIGNMENTS:
            records = filter_records_for_driver(records, DRIVER_ASSIGNMENTS[username])

    plan = route_plan(records, threshold=priority_threshold)
    return {"plan": plan, "role": role}, 200


@app.route("/api/dashboard/export", methods=["GET"])
def export_csv() -> Tuple[str, int, Dict[str, str]]:
    """Export dispatch snapshot as CSV (Authority only)."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return "Unauthenticated", 401, {}

    token = auth_header[7:]
    try:
        payload = jwt.decode(token, app.config["SECRET_KEY"], algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return "Invalid token", 401, {}

    role = payload.get("role", "")
    if role != "Authority":
        return "Unauthorized", 403, {}

    seed = int(request.args.get("seed", 42))
    base_fill_rate = float(request.args.get("base_fill_rate", 3.0))

    records = generate_data(seed=seed, base_fill_rate=base_fill_rate)

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=list(asdict(records[0]).keys()))
    writer.writeheader()
    for rec in records:
        writer.writerow(asdict(rec))

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return (
        output.getvalue(),
        200,
        {
            "Content-Disposition": f"attachment; filename=dispatch_snapshot_{timestamp}.csv",
            "Content-Type": "text/csv",
        },
    )


@app.route("/health", methods=["GET"])
def health() -> Tuple[Dict[str, str], int]:
    """Health check endpoint."""
    return {"status": "ok"}, 200


if __name__ == "__main__":
    app.run(debug=True, port=5000, host="127.0.0.1")
