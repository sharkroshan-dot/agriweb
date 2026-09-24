"""Quality assessment adapter with safe no-model behavior."""
import os,joblib
class QualityAssessmentModel:
 def __init__(self):self.model=None;self.path=os.getenv("AGRICONNECT_QUALITY_MODEL_PATH","backend/app/ai/models/weights/quality_assessment.pkl")
 def load_model(self):
  if self.model is not None:return True
  if not os.path.exists(self.path):return False
  try:self.model=joblib.load(self.path);return True
  except Exception:return False
 def predict(self,image_features):
  if not self.load_model():return {"grade":None,"confidence":0.0,"model":"not_trained","requires_human_review":True,"message":"No trained quality vision model is available."}
  try:
   p=self.model.predict([image_features])[0];c=float(max(self.model.predict_proba([image_features])[0])) if hasattr(self.model,"predict_proba") else 0;return {"grade":str(p),"confidence":round(c,4),"model":"trained_quality_classifier","requires_human_review":c<.7}
  except Exception:return {"grade":None,"confidence":0.0,"model":"prediction_error","requires_human_review":True}
quality_assessment_model=QualityAssessmentModel()
