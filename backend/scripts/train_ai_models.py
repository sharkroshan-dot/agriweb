"""Train AgriConnect models from real JSON/JSONL datasets; never fabricates rows."""
import argparse
import json
from pathlib import Path

from app.ai.models.anomaly_detection import anomaly_detection_model
from app.ai.models.delivery_risk import delivery_risk_model
from app.ai.models.demand_forecast import demand_forecast_model
from app.ai.models.price_prediction import price_prediction_model


def load(path):
    rows = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            rows.extend(json.loads(line) if line.startswith("[") else [json.loads(line)])
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--price")
    parser.add_argument("--demand")
    parser.add_argument("--delivery")
    parser.add_argument("--anomaly")
    args = parser.parse_args()

    if args.price:
        result = price_prediction_model.train(load(args.price))
        print(json.dumps(result, indent=2))
        if result.get("status") != "success":
            raise SystemExit(2)

    if args.demand:
        result = demand_forecast_model.train(load(args.demand))
        print(json.dumps(result, indent=2))
        if result.get("status") != "success":
            raise SystemExit(2)

    if args.delivery:
        result = delivery_risk_model.train(load(args.delivery))
        print(json.dumps(result, indent=2))
        if result.get("status") != "success":
            raise SystemExit(2)

    if args.anomaly:
        anomaly_rows = load(args.anomaly)
        values = [
            float(row.get("value"))
            for row in anomaly_rows
            if isinstance(row, dict) and row.get("value") is not None
        ]
        result = anomaly_detection_model.train(values)
        print(json.dumps(result, indent=2))
        if result.get("status") != "success":
            raise SystemExit(2)


if __name__ == "__main__":
    main()
