"""Train remaining learned farmer models from real JSON/JSONL datasets only."""
import argparse,json
from pathlib import Path
from app.ai.models.crop_recommendation import crop_recommendation_model
from app.ai.models.yield_prediction import yield_prediction_model

def load(path):
 rows=[]
 for line in Path(path).read_text(encoding="utf-8").splitlines():
  if line.strip(): rows.extend(json.loads(line) if line.lstrip().startswith("[") else [json.loads(line)])
 return rows

def main():
 p=argparse.ArgumentParser();p.add_argument("--crop");p.add_argument("--yield-data");a=p.parse_args()
 for path,model in [(a.crop,crop_recommendation_model),(a.yield_data,yield_prediction_model)]:
  if path:
   result=model.train(load(path));print(json.dumps(result,indent=2))
   if result.get("status")!="success":raise SystemExit(2)
if __name__=="__main__":main()
