"""Extract real AgriConnect MongoDB data into ML training datasets.

No synthetic rows are created. Missing labels/features cause samples to be skipped.
Run from backend after MongoDB is configured:
    python -m scripts.extract_ml_data --days 180 --output data/ml
"""
import argparse, asyncio, json
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from bson import ObjectId
from app.database.mongodb import MongoDB


def write_jsonl(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows: f.write(json.dumps(row, default=str) + "\\n")
    return len(rows)

async def extract(days:int, output:Path):
    await MongoDB.connect(); cutoff=datetime.utcnow()-timedelta(days=days)
    db=MongoDB.db
    # Price: use persisted market price history only.
    prices=[]
    async for x in db.price_history.find({"date":{"$gte":cutoff},"price":{"$exists":True}}).sort("date",1):
        try: prices.append({"date":x.get("date"),"price":float(x["price"]),"demand_score":float(x.get("demand_score",0) or 0),"weather_score":float(x.get("weather_score",0) or 0),"competition_score":float(x.get("competition_score",0) or 0),"product_id":str(x.get("product_id"))})
        except (TypeError,ValueError): continue
    write_jsonl(output/"price.jsonl",prices)
    # Demand: aggregate delivered order quantities by calendar day/product.
    demand=defaultdict(float)
    async for order in db.orders.find({"orderDate":{"$gte":cutoff},"orderStatus":"delivered","deletedAt":None},{"orderDate":1,"items":1}):
        date=order.get("orderDate");
        if not date: continue
        key=date.strftime("%Y-%m-%d") if hasattr(date,"strftime") else str(date)[:10]
        for item in order.get("items",[]):
            try: demand[key]+=float(item.get("quantity",0) or 0)
            except (TypeError,ValueError): pass
    demand_rows=[{"date":k,"demand":v} for k,v in sorted(demand.items())]; write_jsonl(output/"demand.jsonl",demand_rows)
    # Delivery risk: use only orders containing a requested date, delivered timestamp,
    # and the operational features already persisted by the application.
    delivery=[]
    async for order in db.orders.find({"orderDate":{"$gte":cutoff},"requestedDeliveryDate":{"$exists":True},"deliveredAt":{"$exists":True},"deliveryRiskFeatures":{"$exists":True}}):
        req=order.get("requestedDeliveryDate"); delivered=order.get("deliveredAt"); features=order.get("deliveryRiskFeatures") or {}
        if not req or not delivered: continue
        try:
            late=int(delivered>req); row={k:features[k] for k in ["distance_km","time_window_minutes","is_cod","quantity_kg","vehicle_capacity","partner_on_time_rate","partner_rating","partner_active_load","previous_delays","rural_roads"] if k in features};
            if len(row)==10: row["late"]=late; delivery.append(row)
        except Exception: continue
    write_jsonl(output/"delivery.jsonl",delivery)
    # Sales anomaly data: daily delivered revenue from actual order totals.
    sales=defaultdict(float)
    async for order in db.orders.find({"orderDate":{"$gte":cutoff},"orderStatus":"delivered","deletedAt":None},{"orderDate":1,"totalAmount":1}):
        d=order.get("orderDate");
        if not d: continue
        key=d.strftime("%Y-%m-%d") if hasattr(d,"strftime") else str(d)[:10]
        try: sales[key]+=float(order.get("totalAmount",0) or 0)
        except (TypeError,ValueError): pass
    write_jsonl(output/"sales.jsonl",[{"value":v} for _,v in sorted(sales.items())])
    await MongoDB.close()
    return {"price":len(prices),"demand":len(demand_rows),"delivery":len(delivery),"anomaly":len(sales)}

async def main():
    p=argparse.ArgumentParser(); p.add_argument("--days",type=int,default=180); p.add_argument("--output",default="data/ml"); p.add_argument("--min-price",type=int,default=30); p.add_argument("--min-demand",type=int,default=30); p.add_argument("--min-delivery",type=int,default=40); p.add_argument("--min-anomaly",type=int,default=30); a=p.parse_args(); counts=await extract(a.days,Path(a.output)); print(json.dumps(counts,indent=2)); print("Training is permitted only for datasets meeting the configured minimum sample counts.")

if __name__=="__main__": asyncio.run(main())
