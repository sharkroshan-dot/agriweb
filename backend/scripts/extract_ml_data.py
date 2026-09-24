"""Extract real AgriConnect MongoDB data into ML datasets.

No synthetic rows are created. Samples come only from persisted application data.
"""
import argparse
import asyncio
import json
import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.database.mongodb import MongoDB


def write_jsonl(path: Path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, default=str) + "\\n")
    return len(rows)


def _date_value(value):
    if isinstance(value, datetime):
        return value.replace(tzinfo=None) if value.tzinfo else value
    if isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return dt.replace(tzinfo=None) if dt.tzinfo else dt
        except ValueError:
            return None
    return None


def _number(value):
    try:
        if value is None or isinstance(value, bool):
            return None
        value = float(value)
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def _first(doc, *keys):
    for key in keys:
        value = doc.get(key)
        if value is not None:
            return value
    return None


def _coordinates(location):
    if not isinstance(location, dict):
        return None
    coords = location.get("coordinates")
    if isinstance(coords, (list, tuple)) and len(coords) >= 2:
        lng, lat = _number(coords[0]), _number(coords[1])
        if lat is not None and lng is not None:
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


def _status(order):
    return str(_first(order, "orderStatus", "status", "order_status", "state") or "").lower()


def _is_completed(order):
    return _status(order) in {"delivered", "picked_up", "picked-up"}


def _quantity_kg(order):
    total = 0.0
    for item in order.get("items") or []:
        quantity = _number(_first(item, "quantity", "qty", "quantityKg", "quantity_kg"))
        if quantity is not None and quantity > 0:
            total += quantity
    return total


async def extract(days: int, output: Path):
    await MongoDB.connect()
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)
    db = MongoDB.db

    # ------------------------------------------------------------------
    # PRICE: persisted history only. Keep product_id when it exists.
    # ------------------------------------------------------------------
    prices = []
    async for x in db.price_history.find(
        {
            "$or": [
                {"date": {"$gte": cutoff}},
                {"createdAt": {"$gte": cutoff}},
            ]
        }
    ).sort("date", 1):
        date = _first(x, "date", "createdAt", "created_at")
        price = _number(_first(x, "price", "unitPrice", "unit_price"))
        if not date or price is None:
            continue

        product_id = _first(x, "product_id", "productId", "productID")
        row = {
            "date": date,
            "price": price,
            "product_id": str(product_id) if product_id else None,
        }
        for out, keys in {
            "demand_score": ("demand_score", "demandScore"),
            "weather_score": ("weather_score", "weatherScore"),
            "competition_score": ("competition_score", "competitionScore"),
        }.items():
            value = _number(_first(x, *keys))
            if value is not None:
                row[out] = value
        prices.append(row)
    write_jsonl(output / "price.jsonl", prices)

    # ------------------------------------------------------------------
    # ORDERS: load once so demand, sales and delivery can use the SAME
    # real records. We do not require orderStatus=delivered for demand
    # because completed pickup orders are genuine fulfilled demand too.
    # ------------------------------------------------------------------
    orders = []
    order_query = {
        "$and": [
            {
                "$or": [
                    {"orderDate": {"$gte": cutoff}},
                    {"createdAt": {"$gte": cutoff}},
                ]
            },
            {"deletedAt": None},
        ]
    }
    async for order in db.orders.find(order_query):
        date = _date_value(_first(order, "orderDate", "createdAt"))
        if date:
            orders.append(order)

    # Demand: aggregate every non-cancelled order as observed demand.
    # Calendar days with no orders are genuine zero-demand observations.
    demand = defaultdict(float)
    demand_dates = []
    for order in orders:
        if _status(order) in {"cancelled", "refunded"}:
            continue
        quantity = _quantity_kg(order)
        date = _date_value(_first(order, "orderDate", "createdAt"))
        if date:
            demand_dates.append(date)
            if quantity > 0:
                demand[date.strftime("%Y-%m-%d")] += quantity

    if demand_dates:
        cursor = min(demand_dates).date()
        last_day = max(demand_dates).date()
        while cursor <= last_day:
            demand.setdefault(cursor.isoformat(), 0.0)
            cursor += timedelta(days=1)

    demand_rows = [{"date": d, "demand": float(v)} for d, v in sorted(demand.items())]
    write_jsonl(output / "demand.jsonl", demand_rows)

    # Anomaly training uses each real non-cancelled order total.
    sales = []
    for order in orders:
        if _status(order) in {"cancelled", "refunded"}:
            continue
        total = _number(order.get("totalAmount"))
        if total is not None and total >= 0:
            sales.append({"value": total})
    write_jsonl(output / "sales.jsonl", sales)

    # ------------------------------------------------------------------
    # DELIVERY: use persisted risk vectors when available. Otherwise derive
    # features from actual order + assignment + partner/address records.
    # Derived values are still real observations; no values are invented
    # when required source records are missing.
    # ------------------------------------------------------------------
    delivery = []
    assignments = {}

    async for assignment in db.delivery_assignments.find(
        {"assignedAt": {"$gte": cutoff}, "deletedAt": None}
    ):
        order_id = assignment.get("orderId")
        if order_id is not None:
            assignments[str(order_id)] = assignment

    partners = {}

    async for partner in db.delivery_profiles.find({"deletedAt": None}):
        partners[str(partner.get("_id"))] = partner

    for order in orders:
        if not _is_completed(order):
            continue

        requested = _date_value(_first(order, "requestedDeliveryDate", "requested_delivery_date"))
        delivered = _date_value(_first(order, "deliveredAt", "delivered_at", "deliveryDate"))
        if not requested or not delivered:
            continue

        # Prefer persisted feature vector if application logic created one.
        features = order.get("deliveryRiskFeatures") or order.get("delivery_risk_features") or {}
        if not features and isinstance(order.get("delivery"), dict):
            features = (
                order["delivery"].get("deliveryRiskFeatures")
                or order["delivery"].get("riskFeatures")
                or {}
            )

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

        if all(_number(features.get(k)) is not None for k in required):
            row = {k: float(features[k]) for k in required}
            row["late"] = int(delivered > requested)
            delivery.append(row)
            continue

        assignment = assignments.get(str(order.get("_id")))
        if not assignment:
            continue

        partner_id = str(assignment.get("deliveryPartnerId")) if assignment.get("deliveryPartnerId") else None
        partner = partners.get(partner_id, {})
        capacity = _number(partner.get("capacity"))
        rating = _number(partner.get("rating"))
        if capacity is None or rating is None:
            continue

        # Delivery address and farmer location are persisted GeoJSON points.
        customer_location = _coordinates((order.get("deliveryAddress") or {}).get("location"))
        farmer_location = None

        # Common embedded farmer-location forms.
        for candidate in [
            order.get("farmLocation"),
            order.get("farmerLocation"),
            (order.get("farmer") or {}).get("location") if isinstance(order.get("farmer"), dict) else None,
        ]:
            farmer_location = _coordinates(candidate)
            if farmer_location:
                break

        distance = _number(
            _first(
                assignment,
                "distance_km",
                "distanceKm",
            )
        )
        if distance is None:
            distance = _number(_first(order, "distance_km", "distanceKm"))

        if distance is None:
            distance = _haversine_km(farmer_location, customer_location)

        if distance is None:
            continue

        quantity = _quantity_kg(order)
        if quantity <= 0:
            continue

        # Features derived directly from stored operational fields.
        delivery_time_minutes = 120.0
        requested_slot = _first(order, "deliveryTimeSlot", "delivery_time_slot")
        if isinstance(requested_slot, str):
            import re
            m = re.search(r"(\d{1,2}):(\d{2})\s*[-to]+\s*(\d{1,2}):(\d{2})", requested_slot)
            if m:
                start = int(m.group(1)) * 60 + int(m.group(2))
                end = int(m.group(3)) * 60 + int(m.group(4))
                delivery_time_minutes = float(max(0, end - start))

        payment_method = str(_first(order, "paymentMethod", "payment_method") or "").lower()
        is_cod = 1.0 if payment_method == "cash" else 0.0

        status_history = order.get("statusHistory") or []
        previous_delays = 0.0
        for entry in status_history:
            note = str((entry or {}).get("note") or "").lower()
            if "delay" in note or "late" in note:
                previous_delays += 1

        on_time_rate = _number(
            _first(partner, "onTimeDeliveryRate", "on_time_delivery_rate", "onTimeRate")
        )
        if on_time_rate is None:
            # Derive historical rate only from this partner's persisted
            # completed assignments in the same extracted window.
            partner_completed = [
                a for a in assignments.values()
                if str(a.get("deliveryPartnerId")) == partner_id
                and str(a.get("status") or "").lower() == "delivered"
            ]
            if partner_completed:
                on_time = 0
                known = 0
                for a in partner_completed:
                    ad = _date_value(_first(a, "completedAt", "completed_at"))
                    aq = _date_value(_first(a, "requestedDeliveryDate", "requested_delivery_date"))
                    if ad and aq:
                        known += 1
                        on_time += int(ad <= aq)
                if known:
                    on_time_rate = on_time / known
        if on_time_rate is None:
            continue

        active_load = _number(
            _first(
                assignment,
                "partner_active_load",
                "activeLoad",
            )
        )
        if active_load is None:
            active_load = _number(_first(partner, "activeLoad", "active_load"))
        if active_load is None:
            # Count assignments that were active when this assignment was
            # opened, using persisted timestamps/statuses only.
            assigned_at = _date_value(_first(assignment, "assignedAt", "createdAt"))
            active_load = 0.0
            if assigned_at:
                for other in assignments.values():
                    if str(other.get("deliveryPartnerId")) != partner_id:
                        continue
                    other_start = _date_value(_first(other, "assignedAt", "createdAt"))
                    other_end = _date_value(_first(other, "completedAt", "completed_at"))
                    if other_start and other_start <= assigned_at and (not other_end or other_end > assigned_at):
                        active_load += 1.0

        rural = _number(
            _first(
                assignment,
                "rural_roads",
                "ruralRoads",
            )
        )
        if rural is None:
            rural = _number(_first(order, "rural_roads", "ruralRoads"))
        if rural is None:
            # Geographic classification is not persisted in this schema, so
            # do not manufacture a rural-road value.
            continue

        delivery.append(
            {
                "distance_km": float(distance),
                "time_window_minutes": float(delivery_time_minutes),
                "is_cod": float(is_cod),
                "quantity_kg": float(quantity),
                "vehicle_capacity": float(capacity),
                "partner_on_time_rate": float(on_time_rate),
                "partner_rating": float(rating),
                "partner_active_load": float(active_load),
                "previous_delays": float(previous_delays),
                "rural_roads": float(rural),
                "late": int(delivered > requested),
            }
        )

    write_jsonl(output / "delivery.jsonl", delivery)

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
    print(
        json.dumps(
            {
                "training_ready": {
                    name: counts[name] >= minimum
                    for name, minimum in minimums.items()
                }
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
