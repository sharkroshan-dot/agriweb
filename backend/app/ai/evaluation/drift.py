"""Lightweight production drift checks for numeric features and predictions."""
from typing import Iterable, Dict, Any
import math

def psi(expected: Iterable[float], actual: Iterable[float], bins: int = 10) -> float:
    ref=sorted(float(x) for x in expected if x is not None); cur=[float(x) for x in actual if x is not None]
    if len(ref)<20 or len(cur)<20:return 0.0
    edges=sorted(set(ref[min(len(ref)-1,int(i*len(ref)/bins))] for i in range(bins)))
    if len(edges)<2:return 0.0
    def dist(values):
        counts=[0]*len(edges)
        for x in values:
            idx=sum(x>=e for e in edges)-1; counts[max(0,min(len(counts)-1,idx))]+=1
        total=max(1,len(values)); return [c/total or 1e-6 for c in counts]
    a,b=dist(ref),dist(cur)
    return float(sum((x-y)*math.log(x/y) for x,y in zip(a,b)))

def drift_report(reference: Dict[str,Iterable[float]], current: Dict[str,Iterable[float]], threshold: float=.2)->Dict[str,Any]:
    rows=[]
    for name,ref in reference.items():
        value=psi(ref,current.get(name,[])); rows.append({"feature":name,"psi":round(value,4),"drifted":value>=threshold})
    return {"threshold":threshold,"features":rows,"drifted_features":[r["feature"] for r in rows if r["drifted"]]}
