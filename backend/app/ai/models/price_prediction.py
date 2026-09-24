"""AgriConnect price forecasting with benchmarked tree models and uncertainty bands."""
from datetime import datetime, timedelta
import logging, os
from typing import Any, Dict, List
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor, HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
logger=logging.getLogger(__name__)
class PricePredictionModel:
    def __init__(self):
        self.model=None; self.model_name="hist_gradient_boosting"; self.model_path=os.getenv("AGRICONNECT_PRICE_MODEL_PATH","backend/app/ai/models/weights/price_prediction.pkl"); self.features=["price_lag_1","price_lag_3","price_lag_7","day_of_week","month","quarter","demand_score","weather_score","competition_score","price_rolling_mean_7","price_rolling_std_7"]; self.metrics={}; self.validation_samples=0
    def load_model(self):
        try:
            if not os.path.exists(self.model_path): return False
            a=joblib.load(self.model_path); self.model=a.get("model") if isinstance(a,dict) else a; self.model_name=a.get("model_name",self.model_name) if isinstance(a,dict) else self.model_name; self.metrics=a.get("metrics",{}) if isinstance(a,dict) else {}; return self.model is not None
        except Exception as e: logger.error("Error loading price model: %s",e); return False
    def _frame(self,data):
        df=pd.DataFrame(data).copy(); df["date"]=pd.to_datetime(df.get("date",pd.date_range(end=datetime.utcnow(),periods=len(df),freq="D")),errors="coerce"); df["price"]=pd.to_numeric(df.get("price",0),errors="coerce"); df=df.dropna(subset=["date","price"]).sort_values("date")
        for c in ["demand_score","weather_score","competition_score"]: df[c]=pd.to_numeric(df.get(c,0),errors="coerce").fillna(0)
        df["price_lag_1"]=df.price.shift(1); df["price_lag_3"]=df.price.shift(3); df["price_lag_7"]=df.price.shift(7); df["price_rolling_mean_7"]=df.price.shift(1).rolling(7).mean(); df["price_rolling_std_7"]=df.price.shift(1).rolling(7).std().fillna(0); df["day_of_week"]=df.date.dt.dayofweek; df["month"]=df.date.dt.month; df["quarter"]=df.date.dt.quarter; return df.dropna(subset=["price_lag_1","price_lag_3","price_lag_7","price_rolling_mean_7"])
    def train(self,training_data:List[Dict[str,Any]])->Dict[str,Any]:
        if len(training_data)<30:return {"status":"failed","error":"At least 30 chronological price samples are required"}
        try:
            df=self._frame(training_data); split=max(1,int(len(df)*.2)); train,test=df.iloc[:-split],df.iloc[-split:]
            if len(train)<10:return {"status":"failed","error":"Not enough training samples"}
            candidates={"random_forest":RandomForestRegressor(n_estimators=250,max_depth=12,min_samples_leaf=2,random_state=42,n_jobs=-1),"hist_gradient_boosting":HistGradientBoostingRegressor(max_iter=250,learning_rate=.05,max_leaf_nodes=15,l2_regularization=1.0,random_state=42)}; scores={}
            for n,m in candidates.items(): m.fit(train[self.features],train.price); scores[n]=mean_absolute_error(test.price,m.predict(test[self.features]))
            self.model_name=min(scores,key=scores.get); self.model=candidates[self.model_name]; pred=self.model.predict(test[self.features]); self.metrics={"mae":float(mean_absolute_error(test.price,pred)),"rmse":float(np.sqrt(mean_squared_error(test.price,pred))),"r2":float(r2_score(test.price,pred))}; self.validation_samples=len(test)
            os.makedirs(os.path.dirname(self.model_path),exist_ok=True); joblib.dump({"model":self.model,"model_name":self.model_name,"metrics":self.metrics,"features":self.features},self.model_path)
            from app.ai.evaluation.model_registry import register_model; register_model("price",datetime.utcnow().strftime("%Y%m%d%H%M%S"),self.model_name,self.metrics,len(df),self.features)
            return {"status":"success","model":self.model_name,"metrics":self.metrics,"candidate_mae":scores,"samples":len(df),"validation_samples":len(test)}
        except Exception as e: logger.exception("Error training price model"); return {"status":"failed","error":str(e)}
    def predict(self,product_data:Dict[str,Any],days:int=7)->Dict[str,Any]:
        days=max(1,min(int(days),30)); current=float(product_data.get("price",0) or 0)
        try:
            if self.model is None and not self.load_model():return self._fallback_predict(product_data,days)
            history=list(product_data.get("history",[]) or []); frame=self._frame(history+[dict(product_data,date=datetime.utcnow().strftime("%Y-%m-%d"),price=current)]) if history else pd.DataFrame(); recent=[current]; rows=[]
            for i in range(days):
                d=(frame.date.max()+timedelta(days=1)) if not frame.empty else datetime.utcnow()+timedelta(days=i+1)
                f={"price_lag_1":float(frame.price.iloc[-1]) if len(frame) else current,"price_lag_3":float(frame.price.iloc[-3]) if len(frame)>=3 else current,"price_lag_7":float(frame.price.iloc[-7]) if len(frame)>=7 else current,"price_rolling_mean_7":float(frame.price.tail(7).mean()) if len(frame) else current,"price_rolling_std_7":float(frame.price.tail(7).std() or 0) if len(frame)>1 else 0,"day_of_week":d.dayofweek,"month":d.month,"quarter":d.quarter,"demand_score":float(product_data.get("demand_score",0) or 0),"weather_score":float(product_data.get("weather_score",0) or 0),"competition_score":float(product_data.get("competition_score",0) or 0)}; pred=max(0,float(self.model.predict(pd.DataFrame([f])[self.features])[0])); rows.append({"day":i+1,"date":d.strftime("%Y-%m-%d"),"price":pred}); recent=(recent+[pred])[-7:]
                if not frame.empty: frame.loc[d,"price"]=pred
            last=rows[-1]["price"]; spread=float(np.std(recent)) if len(recent)>1 else 0; uncertainty=max(spread,abs(last-current)*.15,current*.03); trend="upward" if last>current*1.05 else "downward" if last<current*.95 else "stable"
            return {"current_price":current,"predicted_price":last,"trend":trend,"confidence":self._confidence(),"uncertainty":{"lower":max(0,last-1.96*uncertainty),"upper":last+1.96*uncertainty},"model":self.model_name,"metrics":self.metrics,"predictions":rows,"factors":{}}
        except Exception as e: logger.exception("Error predicting price"); return self._fallback_predict(product_data,days)
    def _confidence(self): return round(max(0,min(.99,1/(1+float(self.metrics.get("mae",0))/100))),2) if self.metrics else 0.0
    def _fallback_predict(self,data,days):
        current=float(data.get("price",0) or 0); return {"current_price":current,"predicted_price":current,"trend":"stable","confidence":0.0,"uncertainty":{"lower":current,"upper":current},"model":"fallback_recent_price","metrics":{},"recommendation":"Insufficient trained model data","predictions":[{"day":i+1,"date":(datetime.utcnow()+timedelta(days=i+1)).strftime("%Y-%m-%d"),"price":current} for i in range(days)],"factors":{}}
price_prediction_model=PricePredictionModel()
