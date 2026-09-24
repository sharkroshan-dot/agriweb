"""Train remaining learned models from real JSON/JSONL datasets and register validated artifacts."""
import argparse,json
from pathlib import Path
from app.ai.models.crop_recommendation import crop_recommendation_model
from app.ai.models.yield_prediction import yield_prediction_model
from app.ai.evaluation.model_registry import register_model

def load(path):
    rows=[]
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if line.strip():
            value=json.loads(line)
            rows.extend(value if isinstance(value,list) else [value])
    return rows

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--crop")
    p.add_argument("--yield-data")
    a=p.parse_args()
    jobs=[("crop_recommendation",a.crop,crop_recommendation_model),("yield_prediction",a.yield_data,yield_prediction_model)]
    for task,path,model in jobs:
        if not path: continue
        result=model.train(load(path))
        print(json.dumps(result,indent=2))
        if result.get("status")!="success":
            raise SystemExit(2)
        register_model(task, "1.0", result["model"], result.get("metrics",{}), result.get("samples",0), getattr(model,"FEATURES",[]), status="candidate")
if __name__=="__main__":
    main()
