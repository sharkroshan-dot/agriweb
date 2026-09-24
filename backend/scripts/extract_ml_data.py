"""Extract real AgriConnect MongoDB data into ML datasets.

No synthetic rows are created. Samples are extracted only from persisted
application data. Missing required labels/features are skipped.
"""

import argparse
import asyncio
import json
import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from bson import ObjectId

from app.database.mongodb import MongoDB


def write_jsonl(path: Path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            # Real JSONL: write an actual newline, never a literal "\\n".
            f.write(json.dumps(row, default=str) + "\n")
    return len(rows)


def _date_value(value):
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _number(value):
    try:
        if value is None or isinstance(value, bool):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _first(doc, *keys):
    for key in keys:
        value = doc.get(key)
        if value is not None:
            return value
    return None


def _valid_number(value):
    return value is not None and math.isfinite(value)


def _coordinates(location):
    if not isinstance(location, dict):
        return None
    coordinates = location.get("coordinates")
    if isinstance(coordinates, (list, tuple)) and len(coordinates) >= 2:
        lng, lat = _number(coordinates[0]), _number(coordinates[1])
        if _valid_number(lat) and _valid_number(lng):
            return float(lat), float(lng)
    return None


def _haversine_km(a, b):
    if not a or not b:
        return None
    lat1, lon1 = a
    lat2, lon2 = b
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h))


def _status_is_delivered(order):
    return str(_first(order, "orderStatus", "status", "order_status", "state") or "").lower() in {
        "delivered",
        "picked_up",
        "picked-up",
    }


async def extract(days: int, output: Path):
    await MongoDB.connect()
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)
    db = MongoDB.db

    # Price history: support both camelCase and snake_case legacy fields.
    prices = []
    async for x in db.price_history.find({"date": {"$gte": cutoff}}).sort("date", 1):
        price = _number(_first(x, "price", "unitPrice", "unit_price"))
        date = _first(x, "date", "createdAt", "created_at")
        if not _valid_number(price) or not date:
            continue

        product_id = _first(x, "product_id", "productId", "productID")
        demand_score = _number(_first(x, "demand_score", "demandScore"))
        weather_score = _number(_first(x, "weather_score", "weatherScore"))
        competition_score = _number(_first(x, "competition_score", "competitionScore"))

        row = {
            "date": date,
            "price": price,
            "product_id": str(product_id) if product_id else None,
        }

        # Preserve contextual features only when actually persisted.
        if demand_score is not None:
            row["demand_score"] = demand_score
        if weather_score is not None:
            row["weather_score"] = weather_score
        if competition_score is not None:
            row["competition_score"] = competition_score

        prices.append(row)

    write_jsonl(output / "price.jsonl", prices)

    # Demand: aggregate quantities from every genuinely delivered/picked-up
    # order day. We do not manufacture missing calendar days.
    demand = defaultdict(float)
    order_query = {
        "$or": [
            {"orderStatus": {"$in": ["delivered", "picked_up"]}},
            {"status": {"$in": ["delivered", "picked_up"]}},
        ],
        "$or": [
            {"orderDate": {"$gte": cutoff}},
            {"createdAt": {"$gte": cutoff}},
        ],
    }

    # Avoid duplicate $or keys by using $and.
    order_query = {
        "$and": [
            {
                "$or": [
                    {"orderStatus": {"$in": ["delivered", "picked_up"]}},
                    {"status": {"$in": ["delivered", "picked_up"]}},
                ]
            },
            {
                "$or": [
                    {"orderDate": {"$gte": cutoff}},
                    {"createdAt": {"$gte": cutoff}},
                ]
            },
            {"deletedAt": None},
        ]
    }

    async for order in db.orders.find(order_query, {"orderDate": 1, "createdAt": 1, "items": 1}):
        if not _status_is_delivered(order):
            continue

        date = _first(order, "orderDate", "createdAt")
        date = _date_value(date)
        if not date:
            continue

        key = date.strftime("%Y-%m-%d")
        quantity_total = 0.0

        for item in order.get("items") or []:
            quantity = _number(_first(item, "quantity", "qty"))
            if quantity is not None and quantity > 0:
                quantity_total += quantity

        if quantity_total > 0:
            demand[key] += quantity_total

    demand_rows = [{"date": key, "demand": value} for key, value in sorted(demand.items())]
    write_jsonl(output / "demand.jsonl", demand_rows)

    # Delivery: first use persisted deliveryRiskFeatures from orders. If those
    # are absent, use the actual delivery_assignments + order + partner data
    # only when every required feature is explicitly available.
    delivery = []

    async for order in db.orders.find(
        {"orderDate": {"$gte": cutoff}, "deletedAt": None}
    ):
        requested = _date_value(_first(order, "requestedDeliveryDate", "requested_delivery_date"))
        delivered = _date_value(_first(order, "deliveredAt", "delivered_at", "deliveryDate"))
        if not requested or not delivered or not _status_is_delivered(order):
            continue

        features = order.get("deliveryRiskFeatures") or order.get("delivery_risk_features") or {}

        # Some records may store the features under a nested delivery object.
        if not features and isinstance(order.get("delivery"), dict):
            features = order["delivery"].get("deliveryRiskFeatures") or order["delivery"].get("riskFeatures") or {}

        required = [
            "distance_km",
            "time_window_minutes",
            "is_cod",
            "quantity_kg",
            "vehicle_capacity",
            "partner_on_time_rate",
            "partner_rating",
            "partner_active_load",
            "previous_delays",
            "rural_roads",
        ]

        if all(key in features and _number(features.get(key)) is not None for key in required):
            row = {key: float(features[key]) for key in required}
            row["late"] = int(delivered > requested)
            delivery.append(row)

    # Also inspect delivery_assignments for persisted risk features. This does
    # not invent missing values; it only accepts a complete feature vector.
    if len(delivery) == 0:
        async for assignment in db.delivery_assignments.find(
            {"assignedAt": {"$gte": cutoff}, "deletedAt": None}
        ):
            risk = assignment.get("deliveryRiskFeatures") or assignment.get("riskFeatures") or {}
            required = [
                "distance_km",
                "time_window_minutes",
                "is_cod",
                "quantity_kg",
                "vehicle_capacity",
                "partner_on_time_rate",
                "partner_rating",
                "partner_active_load",
                "previous_delays",
                "rural_roads",
            ]
            if not all(key in risk and _number(risk.get(key)) is not None for key in required):
                continue

            completed = _date_value(
                _first(assignment, "completedAt", "completed_at", "deliveredAt")
            )
            requested = _date_value(
                _first(assignment, "requestedDeliveryDate", "requested_delivery_date")
            )
            if not completed or not requested:
                continue

            row = {key: float(risk[key]) for key in required}
            row["late"] = int(completed > requested)
            delivery.append(row)

    write_jsonl(output / "delivery.jsonl", delivery)

    # Sales anomaly data: one actual delivered order total per observation.
    # This preserves real transaction variation and avoids synthetic values.
    sales = []
    async for order in db.orders.find(
        order_query,
        {"orderDate": 1, "createdAt": 1, "totalAmount": 1},
    ):
        total = _number(order.get("totalAmount"))
        if total is not None and total >= 0:
            sales.append({"value": total})

    write_jsonl(output / "sales.jsonl", sales)

    await MongoDB.close()

    return {
        "price": len(prices),
        "demand": len(demand_rows),
        "delivery": len(delivery),
        "anomaly": len(sales),
    }


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=180)
    parser.add_argument("--output", default="data/ml")
    parser.add_argument("--min-price", type=int, default=30)
    parser.add_argument("--min-demand", type=int, default=30)
    parser.add_argument("--min-delivery", type=int, default=40)
    parser.add_argument("--min-anomaly", type=int, default=30)
    args = parser.parse_args()

    counts = await extract(args.days, Path(args.output))
    print(json.dumps(counts, indent=2))

    minimums = {
        "price": args.min_price,
        "demand": args.min_demand,
        "delivery": args.min_delivery,
        "anomaly": args.min_anomaly,
    }
    ready = {name: counts[name] >= minimum for name, minimum in minimums.items()}
    print(json.dumps({"training_ready": ready}, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
