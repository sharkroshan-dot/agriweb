"""Harvest planning from yield, demand, price and inventory constraints."""
class HarvestPlanningModel:
 def plan(self,crop,expected_yield_kg,demand_forecast,predicted_price,current_inventory=0,days_to_maturity=0):
  expected=max(0,float(expected_yield_kg));demand=max(0,float(demand_forecast));price=max(0,float(predicted_price));inventory=max(0,float(current_inventory));available=expected+inventory;gap=demand-available
  action="Prioritize harvest and prepare additional supply" if gap>0 else "Avoid premature harvest; monitor price and demand" if price and demand<available*.5 else "Harvest according to maturity and storage capacity"
  return {"crop":crop,"expected_yield_kg":expected,"forecast_demand_kg":demand,"predicted_price":price,"current_inventory_kg":inventory,"supply_gap_kg":round(gap,2),"days_to_maturity":int(days_to_maturity),"recommendation":action,"confidence":0.0,"model":"constraint_based_harvest_planner"}
harvest_planning_model=HarvestPlanningModel()
