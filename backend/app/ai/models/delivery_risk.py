"""Delivery risk: calibrated supervised classifier with explainable fallback scoring."""
from typing import Dict, Any, List
import logging, os
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import precision_score, recall_score, f1_score
logger=logging.getLogger(__name__)

class DeliveryRiskModel:
    FEATURES=["distance_km","time_window_minutes","is_cod","quantity_kg","vehicle_capacity","partner_on_time_rate","partner_rating","partner_active_load","previous_delays","rural_roads"]
    def __init__(self):
        self.model=None; self.model_path=os.getenv("AGRICONNECT_DELIVERY_RISK_MODEL_PATH","backend/app/ai/models/weights/delivery_risk.pkl"); self.metrics={}
    def _vector(self,f):
        return np.array([[float(bool(f.get("is_cod"))) if k=="is_cod" else float(f.get(k,0) or 0) for k in self.FEATURES]])
    def load_model(self):
        try:
            if not os.path.exists(self.model_path):return False
            a=joblib.load(self.model_path); self.model=a.get("model") if isinstance(a,dict) else a; self.metrics=a.get("metrics",{}) if isinstance(a,dict) else {}; return self.model is not None
        except Exception as e:logger.error("Error loading delivery risk model: %s",e);return False
    def train(self,training_data:List[Dict[str,Any]])->Dict[str,Any]:
        if len(training_data)<40:return {"status":"failed","error":"At least 40 labeled delivery samples are required"}
        try:
            df=pd.DataFrame(training_data); target="late" if "late" in df else "risk_label"; 
            if target not in df:return {"status":"failed","error":"Training data requires late or risk_label target"}
            y=df[target].astype(int); X=df.reindex(columns=self.FEATURES,fill_value=0).astype(float); split=max(10,int(len(df)*.2)); tr,te=X.iloc[:-split],X.iloc[-split:]; yt,ye=y.iloc[:-split],y.iloc[-split:]
            base=HistGradientBoostingClassifier(max_iter=200,learning_rate=.05,max_leaf_nodes=15,l2_regularization=1.0,random_state=42); model=CalibratedClassifierCV(base,method="sigmoid",cv=3); model.fit(tr,yt); pred=model.predict(te); self.model=model; self.metrics={"precision":float(precision_score(ye,pred,zero_division=0)),"recall":float(recall_score(ye,pred,zero_division=0)),"f1":float(f1_score(ye,pred,zero_division=0))}; os.makedirs(os.path.dirname(self.model_path),exist_ok=True); joblib.dump({"model":model,"metrics":self.metrics,"features":self.FEATURES},self.model_path); from app.ai.evaluation.model_registry import register_model; register_model("delivery_risk","calibrated-hgb-"+pd.Timestamp.utcnow().strftime("%Y%m%d%H%M%S"),"calibrated_hist_gradient_boosting",self.metrics,len(df),self.FEATURES); return {"status":"success","metrics":self.metrics,"samples":len(df)}
        except Exception as e:logger.exception("Error training delivery risk model");return {"status":"failed","error":str(e)}
    def predict(self,features:Dict[str,Any])->Dict[str,Any]:
        try:
            if self.model is None:self.load_model()
            if self.model is not None:
                p=float(self.model.predict_proba(self._vector(features))[0,1]); level="HIGH" if p>=.7 else "MEDIUM" if p>=.35 else "LOW"; return {"risk_score":round(p*100,1),"risk_level":level,"probability":round(p,4),"confidence":round(abs(p-.5)*2,2),"model":"calibrated_hist_gradient_boosting","metrics":self.metrics,"factors":self._factor_summary(features),"recommendation":"Review or reassign before dispatch" if level=="HIGH" else "Monitor delivery" if level=="MEDIUM" else "Proceed with current assignment"}
            return self._rule_score(features)
        except Exception as e:logger.exception("Error predicting delivery risk");return self._rule_score(features)
    def _factor_summary(self,f):
        factors=[]; d=float(f.get("distance_km") or 0); w=float(f.get("time_window_minutes") or 120); r=float(f.get("partner_on_time_rate") or .9); load=float(f.get("partner_active_load") or 0)
        if d>15:factors.append({"factor":"distance","impact":"high","detail":f"{d:.1f} km route"})
        elif d>5:factors.append({"factor":"distance","impact":"medium","detail":f"{d:.1f} km route"})
        if w<=60:factors.append({"factor":"time_window","impact":"high" if w<=30 else "medium","detail":f"{w:.0f} minutes remaining"})
        if r<.8:factors.append({"factor":"partner_on_time","impact":"high","detail":f"{r:.0%} historical on-time rate"})
        if load>=8:factors.append({"factor":"partner_load","impact":"high","detail":f"{load:.0f} active deliveries"})
        return factors[:5]
    def _rule_score(self,features):
        d=float(features.get("distance_km") or 0); w=float(features.get("time_window_minutes") or 120); cod=bool(features.get("is_cod")); q=float(features.get("quantity_kg") or 0); cap=float(features.get("vehicle_capacity") or 0); r=float(features.get("partner_on_time_rate") or .9); load=int(features.get("partner_active_load") or 0); delays=int(features.get("previous_delays") or 0); rural=int(features.get("rural_roads") or 0); score=min(100,max(0,(max(0,d-5)*1.5)+(20 if w<=30 else 12 if w<=60 else 0)+(8 if cod else 0)+(25 if cap and q>cap else 15 if cap and q>cap*.8 else 0)+(25 if r<.8 else 12 if r<.9 else 0)+(15 if load>=8 else 8 if load>=5 else 0)+(15 if delays>=3 else 6 if delays else 0)+(10 if rural>=8 else 0))); level="HIGH" if score>70 else "MEDIUM" if score>30 else "LOW"; return {"risk_score":round(score,1),"risk_level":level,"probability":round(score/100,3),"confidence":0.0,"model":"explainable_rule_fallback","metrics":{},"factors":self._factor_summary(features),"recommendation":"Review or reassign before dispatch" if level=="HIGH" else "Monitor delivery" if level=="MEDIUM" else "Proceed with current assignment"}
delivery_risk_model=DeliveryRiskModel()
