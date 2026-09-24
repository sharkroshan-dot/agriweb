"""Train AgriConnect models from real JSON/JSONL datasets; never fabricates rows."""
import argparse,json
from pathlib import Path
from app.ai.models.price_prediction import price_prediction_model
from app.ai.models.demand_forecast import demand_forecast_model
from app.ai.models.delivery_risk import delivery_risk_model
from app.ai.models.anomaly_detection import anomaly_detection_model

def load(path):
    rows=[]
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line=line.strip()
        if line: rows.extend(json.loads(line) if line.startswith("[") else [json.loads(line)])
    return rows

def main():
    p=argparse.ArgumentParser(); p.add_argument("--price"); p.add_argument("--demand"); p.add_argument("--delivery"); p.add_argument("--anomaly"); a=p.parse_args()
    if a.price: print(json.dumps(price_prediction_model.train(load(a.price)),indent=2))
    if a.demand: print(json.dumps(demand_forecast_model.train(load(a.demand)),indent=2))
    if a.delivery: print(json.dumps(delivery_risk_model.train(load(a.delivery)),indent=2))
    if a.anomaly:\n        anomaly_rows=load(a.anomaly)\n        values=[float(row.get("value")) for row in anomaly_rows if isinstance(row,dict) and row.get("value") is not None]\n        print(json.dumps(anomaly_detection_model.train(values),indent=2))
if __name__=="__main__": main()
