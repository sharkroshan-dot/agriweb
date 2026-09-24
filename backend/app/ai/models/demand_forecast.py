"""AgriConnect demand forecasting with benchmarked seasonal and tree models."""
from datetime import datetime,timedelta
import logging,os
from typing import Dict,Any,List
import joblib,numpy as np,pandas as pd
from statsmodels.tsa.holtwinters import ExponentialSmoothing
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error,mean_squared_error
logger=logging.getLogger(__name__)
class DemandForecastModel:
    def __init__(self): self.model=None; self.model_name="holt_winters"; self.model_path=os.getenv("AGRICONNECT_DEMAND_MODEL_PATH","backend/app/ai/models/weights/demand_forecast.pkl"); self.metrics={}; self.features=["lag_1","lag_7","lag_14","rolling_mean_7","rolling_std_7","day_of_week","month"]
    def load_model(self):
        try:
            if not os.path.exists(self.model_path):return False
            a=joblib.load(self.model_path); self.model=a.get("model") if isinstance(a,dict) else a; self.model_name=a.get("model_name",self.model_name) if isinstance(a,dict) else self.model_name; self.metrics=a.get("metrics",{}) if isinstance(a,dict) else {}; return self.model is not None or self.model_name=="recent_average"
        except Exception as e: logger.error("Error loading demand model: %s",e); return False
    def _frame(self,data):
        df=pd.DataFrame(data).copy(); df["date"]=pd.to_datetime(df.get("date"),errors="coerce"); df["demand"]=pd.to_numeric(df.get("demand"),errors="coerce"); df=df.dropna(subset=["date","demand"]).sort_values("date").set_index("date").asfreq("D"); df.demand=df.demand.interpolate(limit_direction="both"); df["lag_1"]=df.demand.shift(1); df["lag_7"]=df.demand.shift(7); df["lag_14"]=df.demand.shift(14); df["rolling_mean_7"]=df.demand.shift(1).rolling(7).mean(); df["rolling_std_7"]=df.demand.shift(1).rolling(7).std().fillna(0); df["day_of_week"]=df.index.dayofweek; df["month"]=df.index.month; return df
    def _hw(self,s,days):
        if len(s)<14:return None
        try:return np.asarray(ExponentialSmoothing(s,trend="add",seasonal="add",seasonal_periods=7).fit().forecast(days),float)
        except Exception:return None
    def train(self,data:List[Dict[str,Any]])->Dict[str,Any]:
        if len(data)<30:return {"status":"failed","error":"At least 30 chronological demand samples are required"}
        try:
            df=self._frame(data); split=max(7,int(len(df)*.2)); train,test=df.iloc[:-split],df.iloc[-split:]; valid=train.dropna(subset=self.features)
            if len(valid)<20:return {"status":"failed","error":"Not enough lagged samples after feature engineering"}
            gb=HistGradientBoostingRegressor(max_iter=250,learning_rate=.05,max_leaf_nodes=15,l2_regularization=1.0,random_state=42).fit(valid[self.features],valid.demand); gbp=gb.predict(test[self.features].ffill().fillna(0)); scores={"hist_gradient_boosting":mean_absolute_error(test.demand,gbp)}; hw=self._hw(train.demand,len(test));
            if hw is not None:scores["holt_winters"]=mean_absolute_error(test.demand,hw)
            naive=np.repeat(train.demand.tail(7).mean(),len(test)); scores["recent_average"]=mean_absolute_error(test.demand,naive); self.model_name=min(scores,key=scores.get); self.model=gb if self.model_name=="hist_gradient_boosting" else ExponentialSmoothing(df.demand,trend="add",seasonal="add",seasonal_periods=7).fit() if self.model_name=="holt_winters" else None; pred=gbp if self.model_name=="hist_gradient_boosting" else hw if self.model_name=="holt_winters" else naive; self.metrics={"mae":float(mean_absolute_error(test.demand,pred)),"rmse":float(np.sqrt(mean_squared_error(test.demand,pred))),"baseline_mae":float(scores["recent_average"])}
            os.makedirs(os.path.dirname(self.model_path),exist_ok=True); joblib.dump({"model":self.model,"model_name":self.model_name,"metrics":self.metrics,"features":self.features},self.model_path); from app.ai.evaluation.model_registry import register_model; register_model("demand",datetime.utcnow().strftime("%Y%m%d%H%M%S"),self.model_name,self.metrics,len(df),self.features); return {"status":"success","model":self.model_name,"metrics":self.metrics,"candidate_mae":scores,"samples":len(df),"validation_samples":len(test)}
        except Exception as e:logger.exception("Error training demand model");return {"status":"failed","error":str(e)}
    def predict(self,history:List[Dict[str,Any]],days:int=7)->Dict[str,Any]:
        days=max(1,min(int(days),30))
        try:
            df=self._frame(history)
            if len(df)<2 or not self.load_model():return self._fallback_predict(history,days)
            if self.model_name=="holt_winters": values=np.asarray(self.model.forecast(days),float)
            elif self.model_name=="recent_average": values=np.repeat(float(df.demand.tail(7).mean()),days)
            else:
                work=df.copy(); values=[]
                for i in range(days):
                    d=work.index.max()+timedelta(days=1); row={"lag_1":float(work.demand.iloc[-1]),"lag_7":float(work.demand.iloc[-7]) if len(work)>=7 else float(work.demand.iloc[-1]),"lag_14":float(work.demand.iloc[-14]) if len(work)>=14 else float(work.demand.iloc[-1]),"rolling_mean_7":float(work.demand.tail(7).mean()),"rolling_std_7":float(work.demand.tail(7).std() or 0),"day_of_week":d.dayofweek,"month":d.month}; p=max(0,float(self.model.predict(pd.DataFrame([row])[self.features])[0])); values.append(p); work.loc[d,"demand"]=p
                values=np.asarray(values)
            current=float(df.demand.iloc[-1]); values=np.maximum(values,0); spread=max(float(np.std(values)),current*.05); preds=[{"day":i+1,"date":(datetime.utcnow()+timedelta(days=i+1)).strftime("%Y-%m-%d"),"demand":float(v)} for i,v in enumerate(values)]; peak=max(preds,key=lambda x:x["demand"]); return {"current_demand":current,"predicted_demand":preds,"prediction_interval":{"lower":[max(0,float(v-1.96*spread)) for v in values],"upper":[float(v+1.96*spread) for v in values]},"confidence":self._confidence(),"model":self.model_name,"metrics":self.metrics,"recommendation":f"Increase stock for {peak['date']}" if peak["demand"]>current*1.2 else "Reduce stock levels" if peak["demand"]<current*.8 else "Maintain current stock","seasonal_factors":{"weekly_pattern":self._weekly(df)}}
        except Exception as e:logger.exception("Error making demand forecast");return self._fallback_predict(history,days)
    def _confidence(self):return round(max(0,min(.99,1/(1+float(self.metrics.get("mae",0))/10))),2) if self.metrics else 0.0
    def _fallback_predict(self,data,days):
        d=pd.to_numeric(pd.DataFrame(data).get("demand",pd.Series(dtype=float)),errors="coerce").dropna(); avg=float(d.tail(min(7,len(d))).mean()) if len(d) else 0; return {"current_demand":float(d.iloc[-1]) if len(d) else 0,"predicted_demand":[{"day":i+1,"date":(datetime.utcnow()+timedelta(days=i+1)).strftime("%Y-%m-%d"),"demand":avg} for i in range(days)],"prediction_interval":{"lower":[avg]*days,"upper":[avg]*days},"confidence":0.0,"model":"fallback_recent_average","metrics":{},"recommendation":"Insufficient trained model data; using recent average","seasonal_factors":{}}
    def _weekly(self,df):
        if len(df)<7:return {}
        a=df.groupby(df.index.dayofweek).demand.mean(); return {n:float(a.get(i,0)) for i,n in enumerate(["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"])}
demand_forecast_model=DemandForecastModel()
