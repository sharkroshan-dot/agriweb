"""Hybrid recommendation engine: behavioral, category, popularity and contextual scoring."""
from typing import Dict,Any,List
import math

class RecommendationEngine:
    def recommend(self,user_history:List[Dict[str,Any]],products:List[Dict[str,Any]],limit:int=10)->List[Dict[str,Any]]:
        watched={str(x.get("productId")) for x in user_history}; cats={}
        for item in user_history:
            c=item.get("categoryId")
            if c: cats[str(c)]=cats.get(str(c),0)+1
        max_views=max([float(p.get("views",0) or 0) for p in products] or [1]); max_rating=max([float(p.get("rating",0) or 0) for p in products] or [1])
        scored=[]
        for p in products:
            pid=str(p.get("_id"));
            if pid in watched: continue
            cat=str(p.get("categoryId")); behavior=min(1,cats.get(cat,0)/max(1,max(cats.values()) if cats else 1)); popularity=float(p.get("views",0) or 0)/max_views; rating=float(p.get("rating",0) or 0)/max_rating if max_rating else 0; freshness=float(p.get("freshnessScore",0.5) or .5); stock=1.0 if float(p.get("stock",1) or 0)>0 else 0.0
            score=.40*behavior+.25*popularity+.15*rating+.10*freshness+.10*stock
            reason="Matches your category history" if behavior else "Popular with marketplace users"
            scored.append(({**p,"recommendationScore":round(score,4),"recommendationReason":reason},score))
        scored.sort(key=lambda x:x[1],reverse=True); return [x[0] for x in scored[:max(1,min(limit,50))]]
recommendation_engine=RecommendationEngine()
