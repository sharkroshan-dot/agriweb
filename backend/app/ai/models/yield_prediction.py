"""Crop yield prediction with Random Forest and HistGradientBoosting benchmark."""
from typing import Dict,Any,List
import os,joblib,numpy as np,pandas as pd
from sklearn.ensemble import RandomForestRegressor,HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error,mean_squared_error
class YieldPredictionModel:
 FEATURES=["area_hectare","crop_age_days","rainfall","temperature","humidity","soil_nitrogen","soil_ph","irrigation_index","fertilizer_index","pest_pressure"]
 def __init__(self):self.model=None;self.name="hist_gradient_boosting";self.path=os.getenv("AGRICONNECT_YIELD_MODEL_PATH","backend/app/ai/models/weights/yield_prediction.pkl");self.metrics={}
 def train(self,rows:List[Dict[str,Any]]):
  if len(rows)<40:return {"status":"failed","error":"At least 40 labeled yield samples are required"}
  df=pd.DataFrame(rows);target="yield" if "yield" in df else "yield_kg" if "yield_kg" in df else None
  if not target:return {"status":"failed","error":"Training data requires yield or yield_kg"}
  df=df.dropna(subset=[target]);X=df.reindex(columns=self.FEATURES,fill_value=0).astype(float);y=pd.to_numeric(df[target],errors="coerce");mask=y.notna();X=X[mask];y=y[mask];split=max(8,int(len(X)*.2));tr,te=X.iloc[:-split],X.iloc[-split:];yt,ye=y.iloc[:-split],y.iloc[-split:];c={"random_forest":RandomForestRegressor(n_estimators=250,max_depth=14,min_samples_leaf=2,random_state=42,n_jobs=-1),"hist_gradient_boosting":HistGradientBoostingRegressor(max_iter=250,learning_rate=.05,max_leaf_nodes=20,random_state=42)};scores={}
  for n,m in c.items():m.fit(tr,yt);scores[n]=mean_absolute_error(ye,m.predict(te))
  self.name=min(scores,key=scores.get);self.model=c[self.name];p=self.model.predict(te);self.metrics={"mae":float(mean_absolute_error(ye,p)),"rmse":float(np.sqrt(mean_squared_error(ye,p))),"candidate_mae":scores};os.makedirs(os.path.dirname(self.path),exist_ok=True);joblib.dump({"model":self.model,"model_name":self.name,"metrics":self.metrics,"features":self.FEATURES},self.path);return {"status":"success","model":self.name,"metrics":self.metrics,"samples":len(X)}
 def load_model(self):
  if self.model is not None:return True
  if not os.path.exists(self.path):return False
  try:a=joblib.load(self.path);self.model=a["model"];self.name=a.get("model_name",self.name);self.metrics=a.get("metrics",{});return True
  except Exception:return False
 def predict(self,f):
  if not self.load_model():return {"predicted_yield_kg":None,"confidence":0.0,"model":"not_trained","metrics":{},"message":"A trained yield model is required for numeric prediction."}
  x=pd.DataFrame([{k:float(f.get(k,0) or 0) for k in self.FEATURES}]);v=max(0,float(self.model.predict(x)[0]));return {"predicted_yield_kg":v,"confidence":round(max(0,min(.99,1/(1+float(self.metrics.get("mae",0))/1000))),2),"model":self.name,"metrics":self.metrics}
yield_prediction_model=YieldPredictionModel()
