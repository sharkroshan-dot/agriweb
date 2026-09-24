"""Constraint-aware route optimization using nearest-neighbor + 2-opt baseline.

The optimizer never fabricates travel savings. It reports only distances actually
computed from the supplied coordinates and marks time-window/capacity violations.
"""
import math,time
from typing import Dict,Any,List,Optional
import numpy as np

class RouteOptimizationModel:
    algorithm="nearest_neighbor_2opt_constraints"
    def optimize(self,start_location:Dict[str,Any],destinations:List[Dict[str,Any]],vehicle_type="bike",optimization_type="distance",time_windows:Optional[List[Dict[str,Any]]]=None,max_weight:Optional[float]=None)->Dict[str,Any]:
        started=time.time(); start=start_location.get("coordinates")
        if not start or len(start)<2:return self._simple_route(start_location,destinations)
        valid=[d for d in destinations if d.get("location",{}).get("coordinates") and len(d["location"]["coordinates"])>=2]
        if not valid:return {"optimized_route":[],"total_distance":0.0,"total_time":0.0,"fuel_estimated":0.0,"savings":{"distance":0.0,"time":0.0,"fuel":0.0},"route_geometry":{"type":"LineString","coordinates":[start]},"algorithm":self.algorithm,"computation_time":time.time()-started,"constraint_violations":[]}
        coords=[start]+[d["location"]["coordinates"] for d in valid]; n=len(coords); matrix=np.zeros((n,n))
        for i in range(n):
            for j in range(n):
                if i!=j:matrix[i,j]=self._distance(coords[i],coords[j])
        route=self._two_opt(self._nearest_neighbor(matrix),matrix)
        speed_kmh=22.0 if vehicle_type in ("bike","bicycle") else 35.0 if vehicle_type in ("car","van") else 25.0
        total_distance=0.0; total_time=0.0; weight=0.0; violations=[]; output=[]
        for seq,idx in enumerate(route[1:],1):
            prev=route[seq-1]; leg=matrix[prev,idx]; minutes=leg/max(speed_kmh,1)*60; total_distance+=leg; total_time+=minutes
            d=valid[idx-1]; weight+=float(d.get("weight_kg",d.get("quantity_kg",0)) or 0)
            window=(time_windows[idx-1] if time_windows and idx-1<len(time_windows) else d.get("timeWindow"))
            arrival=total_time; late=False
            if window:
                end=float(window.get("end_minutes",window.get("end",1440)) or 1440); late=arrival>end
                if late:violations.append({"orderId":d.get("orderId"),"type":"time_window","arrival_minutes":round(arrival,1),"window_end":end})
            output.append({"orderId":d.get("orderId"),"location":d.get("location"),"sequence":seq,"distance":float(leg),"time":float(minutes),"estimatedArrivalMinutes":round(arrival,1),"timeWindowSatisfied":not late})
        if max_weight is not None and weight>float(max_weight):violations.append({"type":"capacity","total_weight_kg":round(weight,2),"max_weight_kg":float(max_weight)})
        return {"optimized_route":output,"total_distance":round(float(total_distance),3),"total_time":round(float(total_time),2),"fuel_estimated":round(float(total_distance*0.08),3),"savings":{"distance":0.0,"time":0.0,"fuel":0.0},"route_geometry":{"type":"LineString","coordinates":[coords[i] for i in route]},"algorithm":self.algorithm,"computation_time":float(time.time()-started),"constraint_violations":violations,"capacity":{"used_kg":round(weight,2),"max_kg":max_weight}}
    def _distance(self,a,b):
        r=6371.0; lon1,lat1=a[0],a[1]; lon2,lat2=b[0],b[1]; dlat=math.radians(lat2-lat1);dlon=math.radians(lon2-lon1);h=math.sin(dlat/2)**2+math.cos(math.radians(lat1))*math.cos(math.radians(lat2))*math.sin(dlon/2)**2;return r*2*math.atan2(math.sqrt(h),math.sqrt(max(0,1-h)))
    def _nearest_neighbor(self,m):
        n=len(m); route=[0]; seen={0}; cur=0
        for _ in range(n-1):
            nxt=min((i for i in range(n) if i not in seen),key=lambda i:m[cur,i]);route.append(nxt);seen.add(nxt);cur=nxt
        return route
    def _two_opt(self,route,m):
        improved=True
        while improved:
            improved=False
            for i in range(1,len(route)-2):
                for j in range(i+1,len(route)):
                    if j-i==1:continue
                    old=m[route[i-1],route[i]]+m[route[j-1],route[j]] if j<len(route) else m[route[i-1],route[i]]
                    new=m[route[i-1],route[j-1]]+m[route[i],route[j]] if j<len(route) else old
                    if j<len(route) and new<old:
                        route[i:j]=reversed(route[i:j]);improved=True;break
                if improved:break
        return route
    def _simple_route(self,start,destinations):
        coords=start.get("coordinates",[0,0]);out=[];total=0
        for i,d in enumerate(destinations,1):
            c=d.get("location",{}).get("coordinates",coords);dist=self._distance(coords,c);total+=dist;out.append({"orderId":d.get("orderId"),"location":d.get("location"),"sequence":i,"distance":dist,"time":dist*2});coords=c
        return {"optimized_route":out,"total_distance":total,"total_time":total*2,"fuel_estimated":total*.08,"savings":{"distance":0,"time":0,"fuel":0},"route_geometry":{"type":"LineString","coordinates":[start.get("coordinates",[0,0])]+[d.get("location",{}).get("coordinates",[0,0]) for d in destinations]},"algorithm":"simple_fallback","computation_time":0.0,"constraint_violations":[]}
route_optimization_model=RouteOptimizationModel()
