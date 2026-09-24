"""Crop recommendation with supervised tree model and transparent fallback."""
from typing import Dict,Any,List
import os,joblib,numpy as np,pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score,f1_score
class CropRecommendationModel:
 FEATURES=["nitrogen","phosphorus","potassium","temperature","humidity","ph","rainfall","water_availability","market_demand","expected_price"]
 def __init__(self): self.model=None;self.path=os.getenv("AGRICONNECT_CROP_MODEL_PATH","backend/app/ai/models/weights/crop_recommendation.pkl");self.metrics={}
 def train(self,rows:List[Dict[str,Any]]):
  if len(rows)<50:return {"status":"failed","error":"At least 50 labeled crop samples are required"}
  df=pd.DataFrame(rows);target="crop" if "crop" in df else "label" if "label" in df else None
  if not target:return {"status":"failed","error":"Training data requires crop or label"}
  df=df.dropna(subset=[target]);X=df.reindex(columns=self.FEATURES,fill_value=0).astype(float);y=df[target].astype(str)
  if y.nunique()<2:return {"status":"failed","error":"At least two crop classes are required"}
  tr,te,ytr,yte=train_test_split(X,y,test_size=.2,random_state=42,stratify=y);m=HistGradientBoostingClassifier(max_iter=250,learning_rate=.05,max_leaf_nodes=20,random_state=42).fit(tr,ytr);p=m.predict(te);self.model=m;self.metrics={"accuracy":float(accuracy_score(yte,p)),"f1_weighted":float(f1_score(yte,p,average="weighted"))};os.makedirs(os.path.dirname(self.path),exist_ok=True);joblib.dump({"model":m,"metrics":self.metrics,"features":self.FEATURES},self.path);return {"status":"success","model":"hist_gradient_boosting","metrics":self.metrics,"samples":len(df)}
 def load_model(self):
  if self.model is not None:return True
  if not os.path.exists(self.path):return False
  try:self.model=joblib.load(self.path).get("model");return self.model is not None
  except Exception:return False
 def recommend(self,f:Dict[str,Any],limit=5):
  if self.load_model():
   x=pd.DataFrame([{k:float(f.get(k,0) or 0) for k in self.FEATURES}]);probs=self.model.predict_proba(x)[0];order=np.argsort(probs)[::-1][:limit];return {"recommendations":[{"crop":str(self.model.classes_[i]),"probability":round(float(probs[i]),4)} for i in order],"confidence":round(float(probs[order[0]]),4),"model":"hist_gradient_boosting","metrics":self.metrics}
  return {"recommendations":[],"confidence":0.0,"model":"not_trained","metrics":{},"message":"A trained crop model is required for learned recommendations."}
crop_recommendation_model=CropRecommendationModel()
