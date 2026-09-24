"""Inventory forecast using recent real demand and stock coverage."""
from typing import List
import numpy as np
class InventoryForecastModel:
 def predict(self,current_stock:float,historical_daily_demand:List[float],days:int=7):
  vals=[float(x) for x in historical_daily_demand if x is not None and float(x)>=0];days=max(1,min(int(days),30));avg=float(np.mean(vals[-7:])) if vals else 0;std=float(np.std(vals[-7:])) if len(vals)>1 else 0;forecast=[avg]*days;coverage=float(current_stock/avg) if avg else None
  return {"current_stock":float(current_stock),"daily_demand":avg,"forecast":forecast,"ending_stock":max(0,float(current_stock)-sum(forecast)),"stock_coverage_days":coverage,"uncertainty":std,"reorder_required":bool(coverage is not None and coverage<3),"model":"rolling_demand_inventory_forecast","confidence":0.0 if len(vals)<30 else round(max(0,min(.99,1/(1+std/(avg+1)))),2)}
inventory_forecast_model=InventoryForecastModel()
