"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AlertTriangle, ArrowLeftRight, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, Leaf, MapPin, Package, RefreshCw, Route, Search, Truck, Warehouse } from "lucide-react";
import toast from "react-hot-toast";
import { Card, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Input } from "../../../components/ui/input";
import { api } from "../../../lib/api/client";

type Source = "farmer" | "warehouse";
type RouteKey = "nearby" | "same_district" | "inter_district" | "multi_warehouse" | "route_review" | "needs_location";
const ROUTES: {key:RouteKey;label:string;description:string}[] = [
  {key:"nearby",label:"Nearby Direct Delivery",description:"Within 15 km; direct delivery is configured."},
  {key:"same_district",label:"Same-District Warehouse Route",description:"Same district; use the configured local-hub route."},
  {key:"inter_district",label:"Inter-District Warehouse Transfer",description:"Transfer to the destination district warehouse."},
  {key:"multi_warehouse",label:"Multi-Warehouse Consolidation",description:"One customer order needs portions from multiple source warehouses."},
  {key:"route_review",label:"Route Review Required",description:"Route configuration or operational prerequisites need review."},
  {key:"needs_location",label:"Needs Location Data",description:"Customer or warehouse location details are incomplete."},
];
const norm=(v:any)=>String(v??"").trim().toLowerCase().replace(/[\s-]+/g,"_");
const normDistrict=(v:any)=>String(v??"").trim().toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
function classify(row:any,source:Source):RouteKey {
  const raw=norm(row.routeCategory||row.farmerFulfillmentRouteType||row.warehouseRouteCategory);
  if(raw==="multi_warehouse"||raw==="consolidation") return "multi_warehouse";
  if(row.routeDataComplete===false) return "needs_location";
  if(["needs_location","location_missing"].includes(raw)) return "needs_location";
  if(["route_review","review_required"].includes(raw)) return "route_review";
  if(["nearby","direct","nearby_delivery"].includes(raw)) return "nearby";
  if(["same_district","local_hub","same_district_warehouse"].includes(raw)) return "same_district";
  if(["inter_district","destination_warehouse","warehouse_transfer"].includes(raw)) return "inter_district";
  const from=normDistrict(row.sourceDistrict||row.sourceWarehouseDistrict);
  const to=normDistrict(row.destinationDistrict||row.deliveryDistrict||row.customerDistrict||row.deliveryAddress?.district);
  if(!from||!to) return "needs_location";
  if(from!==to) return "inter_district";
  const distance=Number(row.routeDistanceKm);
  const hasDistance=row.routeDistanceKm!==null&&row.routeDistanceKm!==undefined&&row.routeDistanceKm!=="";
  const threshold=Number(row.nearbyThresholdKm??15);
  if(hasDistance&&Number.isFinite(distance)&&distance<=threshold) return row.directDeliveryConfigured?"nearby":"route_review";
  if(hasDistance&&Number.isFinite(distance)&&distance>threshold) return "same_district";
  return source==="farmer" ? "route_review" : "route_review";
}
const statusText=(v:any)=>String(v??"Unknown").replace(/_/g," ");
const firstText=(...values:any[])=>values.find(v=>v!==null&&v!==undefined&&String(v).trim()!==""&&typeof v!=="object");
const isDatabaseId=(value:any)=>/^[a-f0-9]{24}$/i.test(String(value??"").trim());
const readableOrderReference=(x:any,source:"farmer"|"warehouse")=>{
  const candidates=[x.orderNumber,x.customerOrderNumber,x.orderNo,x.referenceNumber,x.displayOrderNumber,x.order?.orderNumber,x.order?.orderNo,x.order?.referenceNumber];
  const reference=candidates.find(v=>v!==null&&v!==undefined&&String(v).trim()!==""&&!isDatabaseId(v));
  return reference?String(reference):source==="warehouse"?"Warehouse order · Reference unavailable":"Farmer order · Reference unavailable";
};
const getBuyerName=(x:any)=>{
  const buyer=x.customer||x.buyer||x.business||x.customerDetails||x.buyerDetails||x.user||x.deliveryContact||{};
  const address=x.deliveryAddress||x.shippingAddress||x.customerAddress||{};
  return firstText(x.customerName,x.buyerName,x.businessName,x.business?.businessName,x.customer?.fullName,x.customer?.name,x.customer?.businessName,x.buyer?.name,x.buyer?.businessName,x.customerDetails?.name,x.customerDetails?.fullName,x.buyerDetails?.name,x.user?.name,x.deliveryContact?.name,address.contactName,address.name,x.recipientName) || "Customer name not provided";
};
const getItems=(x:any)=>{
  const raw=Array.isArray(x.items)?x.items:Array.isArray(x.orderItems)?x.orderItems:Array.isArray(x.products)?x.products:Array.isArray(x.lineItems)?x.lineItems:[];
  if(raw.length)return raw;
  const product=firstText(x.productName,x.product?.name,x.product?.productName,x.name,x.productId);
  return product?[{productName:product,quantity:firstText(x.quantity,x.totalQuantity,x.orderedQuantity)}]:[];
};
const getProductSummary=(x:any)=>{
  const items=getItems(x);
  const names=items.map((i:any)=>firstText(i.productName,i.name,i.product?.name,i.product?.productName,i.title,i.productId)).filter(Boolean);
  return names.length?Array.from(new Set(names.map(String))).join(", "):"Product details unavailable";
};
const getQuantitySummary=(x:any)=>{
  const items=getItems(x);
  const total=items.reduce((sum:number,i:any)=>sum+Number(i.quantity??i.orderedQuantity??i.expectedQuantity??i.totalQuantity??0),0);
  const unit=firstText(items.find((i:any)=>i.unit||i.unitName||i.measurementUnit)?.unit,items.find((i:any)=>i.unitName)?.unitName,x.unit,x.unitName);
  if(total>0)return String(total)+(unit?" "+unit:"");
  const fallback=firstText(x.totalQuantity,x.quantity,x.orderedQuantity);
  return fallback!==undefined?String(fallback)+(unit?" "+unit:""):"Quantity not provided";
};
const destinationName=(x:any)=>x.destinationWarehouseName||x.destinationWarehouse?.name||x.assignedDestinationWarehouseName||x.consolidationWarehouseName||x.destinationDistrict||x.deliveryDistrict||x.customerDistrict||"Destination not assigned";
function farmerStage(x:any) {
  const s=norm(x.stage||x.warehouseFulfillmentStage||x.transferStatus||x.status||x.fulfillmentStatus||x.currentStage);
  if(["delivered","completed"].includes(norm(x.orderStatus))||["delivered","completed"].includes(s))return "Delivered";
  if(["destination_warehouse_in_transit","destination_warehouse_transfer_pending","consolidation_in_transit","source_portion_in_transit","hub_handoff_pending","hub_arrived_pending_receipt","in_transit","local_hub_ready"].includes(s))return "In Transfer";
  if(["consolidated","consolidation_portions_received","destination_warehouse_received","quality_approved","received_transfer","stored","ready_for_dispatch","to_route"].includes(s)||x.physicalReceiptConfirmed)return "To Route";
  return "To Receive";
}
function warehouseStage(x:any) {
  const s=norm(x.status);
  if(["delivered","completed"].includes(s))return "Delivered";
  if(["dispatched","in_transit"].includes(s))return "In Transfer";
  if(["pending","packed","ready_for_dispatch"].includes(s))return "To Route";
  return "To Dispatch";
}
type DispatchStatus = "Ready for Dispatch" | "Partner Assigned" | "Dispatched / In Transit" | "Delivered" | "Not Dispatch Ready";
const dispatchStatusOf=(x:any):DispatchStatus=>{
  const values=[x.dispatchStatus,x.orderStatus,x.fulfillmentStatus,x.transferStatus,x.warehouseFulfillmentStage,x.currentStage,x.stage,x.status].map(norm);
  if(values.some(s=>["delivered","completed"].includes(s)))return "Delivered";
  if(values.some(s=>["dispatched","in_transit","out_for_delivery","shipped","dispatch_completed","delivery_in_progress"].includes(s)))return "Dispatched / In Transit";
  const assignedFields=[x.deliveryPartnerId,x.deliveryPartner,x.assignedDeliveryPartnerId,x.assignedDeliveryPartner,x.partnerId,x.assignedPartner,x.assignedTeam,x.transferTeam,x.destinationPickupTeam,x.localHubPickupTeam,x.pickupTeam];
  const hasAssignedPartner=assignedFields.some(v=>v!==null&&v!==undefined&&(typeof v==="object"?Object.keys(v).length>0:String(v).trim()!==""));
  if(hasAssignedPartner||values.some(s=>["partner_assigned","delivery_partner_assigned","assigned","team_assigned","transfer_team_assigned","pickup_team_assigned"].includes(s)))return "Partner Assigned";
  const readyStates=["packed","packing_completed","packing_complete","quality_approved","qc_passed","ready_for_dispatch","ready_to_dispatch","to_route","ready_for_transfer","received_transfer","destination_warehouse_received","stored","consolidated","consolidation_portions_received"];
  if(values.some(s=>readyStates.includes(s))||x.physicalReceiptConfirmed===true)return "Ready for Dispatch";
  return "Not Dispatch Ready";
};
function normalizeFarmer(x:any) {
  const category=classify(x,"farmer");
  return {...x,id:String(x.id||x._id||x.orderId||x.orderNumber),orderId:String(x.orderId||x.id||x._id||""),orderNumber:readableOrderReference(x,"farmer"),source:"farmer" as Source,route:category,stage:farmerStage(x),dispatchStatus:dispatchStatusOf(x),destinationGroup:destinationName(x),customerName:getBuyerName(x),district:x.destinationDistrict||x.deliveryDistrict||x.customerDistrict||"Location unavailable",itemSummary:getProductSummary(x),quantitySummary:getQuantitySummary(x),currentStatus:x.transferStatus||x.status||x.stage||"Awaiting receipt"};
}
function normalizeWarehouse(x:any) {
  const category=classify(x,"warehouse");
  return {...x,id:String(x.id||x._id||x.orderId||x.orderNumber),orderId:String(x.orderId||x.id||x._id||""),orderNumber:readableOrderReference(x,"warehouse"),source:"warehouse" as Source,route:category,stage:warehouseStage(x),dispatchStatus:dispatchStatusOf(x),destinationGroup:destinationName(x),customerName:getBuyerName(x),district:x.destinationDistrict||x.deliveryDistrict||x.customerDistrict||"Location unavailable",itemSummary:getProductSummary(x),quantitySummary:getQuantitySummary(x),currentStatus:x.status||"Ready for route review"};
}

export default function FulfillmentDispatchPage() {
  const [search,setSearch]=useState("");
  const [sourceFilter,setSourceFilter]=useState<"all"|"farmer"|"warehouse">("all");
  const [sortOrder,setSortOrder]=useState<"newest"|"oldest">("newest");
  const [activeRoute,setActiveRoute]=useState<RouteKey|"all">("all");
  const [activeStage,setActiveStage]=useState<DispatchStatus>("Ready for Dispatch");
  const [selectedKey,setSelectedKey]=useState("");
  const [expanded,setExpanded]=useState<string[]>([]);
  const [selectedOrders,setSelectedOrders]=useState<Record<string,boolean>>({});
  const [partnerByOrder,setPartnerByOrder]=useState<Record<string,string>>({});
  const [hubByOrder,setHubByOrder]=useState<Record<string,string>>({});
  const [destinationCapacityAcknowledged,setDestinationCapacityAcknowledged]=useState<Record<string,boolean>>({});
  const [busy,setBusy]=useState("");
  const farmerQuery=useQuery({queryKey:["unifiedFarmerFulfillmentTransfers"],queryFn:()=>api.get("/warehouse/me/farmer-fulfillment-transfers"),refetchInterval:15000});
  const outgoingQuery=useQuery({queryKey:["unifiedWarehouseOutgoing"],queryFn:async()=>{const first=await api.get("/warehouse/me/outgoing",{params:{page:1,limit:100}});const payload=first?.data||first;const pagination=payload?.pagination||{};const pages=Math.min(Number(pagination.totalPages||1),10);const rest=await Promise.all(Array.from({length:Math.max(0,pages-1)},(_,i)=>api.get("/warehouse/me/outgoing",{params:{page:i+2,limit:100}})));return {data:{outgoing:[...(payload?.outgoing||[]),...rest.flatMap((r:any)=>(r?.data||r)?.outgoing||[])],pagination}};},refetchInterval:20000});
  const teamsQuery=useQuery({queryKey:["unifiedFulfillmentPickupTeams"],queryFn:()=>api.get("/warehouse/me/pickup-team/members"),refetchInterval:30000});
  const hubsQuery=useQuery({queryKey:["unifiedFulfillmentLocalHubs"],queryFn:()=>api.get("/warehouse/me/local-hubs"),refetchInterval:30000});
  const consolidationQuery=useQuery({queryKey:["unifiedFarmerConsolidations"],queryFn:()=>api.get("/warehouse/me/farmer-fulfillment-consolidations"),refetchInterval:20000});
  const teams=(teamsQuery.data?.data?.members||[]).map((m:any)=>({id:String(m.deliveryPartnerId||m.id||m._id),name:m.name||m.partnerName||m.firstName||"Delivery partner",vehicle:m.vehicleType||m.vehicle||"Vehicle",capacity:Number(m.capacity||m.vehicleCapacity||0)}));
  const hubs=hubsQuery.data?.data?.hubs||hubsQuery.data?.hubs||[];
  const orderQuantity=(order:any)=>Number(order.totalQuantity||order.quantity||order.items?.reduce((sum:number,item:any)=>sum+Number(item.quantity||item.expectedQuantity||0),0)||0);
  const teamCanCarry=(team:any,order:any)=>orderQuantity(order)>0&&Number(team?.capacity||0)>=orderQuantity(order);
  const consolidationRows=consolidationQuery.data?.data?.consolidations||consolidationQuery.data?.consolidations||[];
  const farmerRows=farmerQuery.data?.data?.transfers||farmerQuery.data?.transfers||[];
  const outgoingRows=outgoingQuery.data?.data?.outgoing||outgoingQuery.data?.outgoing||[];
  const orders=useMemo(()=>{const farmer=farmerRows.map((row:any)=>{const detail=consolidationRows.find((x:any)=>String(x.orderId||x.requestId||"")===String(row.orderId||row.id||""));return normalizeFarmer({...row,...(detail?{consolidationLegs:detail.consolidationLegs||[],consolidationStatus:detail.consolidationStatus||row.consolidationStatus,allConsolidationLegsReceived:detail.allConsolidationLegsReceived,canDispatchToConsolidation:detail.canDispatchToConsolidation,isConsolidationWarehouse:detail.isConsolidationWarehouse,productPortions:detail.productPortions||row.productPortions,consolidation:detail.consolidation||row.consolidation}: {})});});const grouped=new Map<string,any>();for(const line of outgoingRows){const key=String(line.orderId||line.orderNumber||line.id);const existing=grouped.get(key);if(!existing)grouped.set(key,{...line,id:String(line.id||line._id),outgoingIds:[String(line.id||line._id)],items:[{productName:line.productName||line.name||"Product",quantity:Number(line.quantity||0)}],totalQuantity:Number(line.quantity||0)});else{existing.outgoingIds.push(String(line.id||line._id));existing.items.push({productName:line.productName||line.name||"Product",quantity:Number(line.quantity||0)});existing.totalQuantity+=Number(line.quantity||0);}}const warehouse=[...grouped.values()].map((x:any)=>normalizeWarehouse({...x,items:x.items,quantity:x.totalQuantity,totalQuantity:x.totalQuantity}));return [...farmer,...warehouse];},[farmerRows,outgoingRows,consolidationRows]);
  const filtered=useMemo(()=>{
    const q=search.trim().toLowerCase();
    return orders.filter((o:any)=>o.dispatchStatus!=="Not Dispatch Ready"&&(activeRoute==="all"||o.route===activeRoute)&&(o.dispatchStatus===activeStage)&&(sourceFilter==="all"||o.source===sourceFilter)&&(!q||[o.orderNumber,o.customerName,o.district,o.destinationGroup,o.itemSummary,o.currentStatus].some(v=>String(v||"").toLowerCase().includes(q)))).sort((a:any,b:any)=>{const at=new Date(a.createdAt||a.orderDate||a.placedAt||0).getTime()||0;const bt=new Date(b.createdAt||b.orderDate||b.placedAt||0).getTime()||0;return sortOrder==="newest"?bt-at:at-bt;});
  },[orders,search,activeRoute,activeStage,sourceFilter,sortOrder]);
  const selected=filtered.find((o:any)=>o.source+":"+o.id===selectedKey)||filtered[0]||null;
  const routeCounts=Object.fromEntries(ROUTES.map(r=>[r.key,orders.filter((o:any)=>o.route===r.key).length])) as Record<RouteKey,number>;
  const stageNames=["To Receive","To Route","In Transfer","To Dispatch","Delivered"];
  const stageCounts=Object.fromEntries(stageNames.map(s=>[s,orders.filter((o:any)=>o.stage===s).length])) as Record<string,number>;
  const dispatchFilterNames:DispatchStatus[]=["Ready for Dispatch","Partner Assigned","Dispatched / In Transit","Delivered"];
  const dispatchCounts=Object.fromEntries(dispatchFilterNames.map(s=>[s,orders.filter((o:any)=>o.dispatchStatus===s).length])) as Record<DispatchStatus,number>;
  const groups=useMemo(()=>{const m=new Map<string,any[]>();filtered.forEach((o:any)=>m.set(o.destinationGroup,[...(m.get(o.destinationGroup)||[]),o]));return [...m.entries()].sort((a,b)=>a[0].localeCompare(b[0]));},[filtered]);
  const refresh=()=>Promise.all([farmerQuery.refetch(),outgoingQuery.refetch(),teamsQuery.refetch(),hubsQuery.refetch(),consolidationQuery.refetch()]);
  const toggleGroup=(name:string)=>setExpanded(v=>v.includes(name)?v.filter(x=>x!==name):[...v,name]);
  const setWorking=(key:string)=>setBusy(key);
  const act=async(order:any,action:string)=>{
    const id=order.id;
    try {
      setWorking(id+action);
      if(order.source==="farmer"){
        if(action==="recover") await api.post("/warehouse/me/farmer-fulfillment/"+id+"/recover-source-warehouse");
        else if(action==="nearby") {
          const partner=partnerByOrder[id]; if(!partner) throw new Error("Select an approved delivery partner first");
          const team=teams.find((t:any)=>t.id===partner);if(!teamCanCarry(team,order))throw new Error("Select a delivery partner with sufficient vehicle capacity.");
          await api.put("/warehouse/me/farmer-fulfillment/"+id+"/assign-nearby-delivery-partner",undefined,{params:{deliveryPartnerId:partner}});
        } else if(action==="same") {
          await api.post("/warehouse/me/farmer-fulfillment/"+id+"/dispatch-to-local-hub");
        } else if(action==="assign-hub-team") {
          const partner=partnerByOrder[id];if(!partner)throw new Error("Select an approved local-hub pickup team first");
          const team=teams.find((t:any)=>t.id===partner);if(!teamCanCarry(team,order))throw new Error("Select a pickup team with sufficient vehicle capacity.");
          await api.put("/warehouse/me/farmer-fulfillment/"+id+"/assign-local-hub-pickup-team",undefined,{params:{deliveryPartnerId:partner}});
        }
        else if(action==="destination") {
          let result:any;
          if(!order.destinationWarehouseId) result=await api.post("/warehouse/me/farmer-fulfillment/"+id+"/assign-destination-warehouse");
          if(result?.data?.destinationWarehouseCapacityOverrideRequired||order.destinationWarehouseCapacityOverrideRequired){
            if(!destinationCapacityAcknowledged[id])throw new Error(result?.message||"Confirm destination warehouse capacity in the Operations panel before dispatch.");
          }
          await api.post("/warehouse/me/farmer-fulfillment/"+id+"/dispatch-to-destination",undefined,{params:destinationCapacityAcknowledged[id]?{capacityOverrideConfirmed:true}:undefined});
        } else if(action==="assign-transfer") {
          const partner=partnerByOrder[id];if(!partner)throw new Error("Select an approved transfer team first");
          const team=teams.find((t:any)=>t.id===partner);if(!teamCanCarry(team,order))throw new Error("Select a transfer team with sufficient vehicle capacity.");
          await api.put("/warehouse/me/farmer-fulfillment/"+id+"/assign-destination-pickup-team",undefined,{params:{deliveryPartnerId:partner}});
        } else if(action==="destination-receive") await api.post("/warehouse/me/farmer-fulfillment/"+id+"/receive-at-destination");
        else if(action==="hub-handoff") await api.post("/warehouse/me/farmer-fulfillment/"+id+"/handoff-local-hub");
        else if(action==="hub-receive") await api.post("/warehouse/me/farmer-fulfillment/"+id+"/receive-local-hub");
        else if(action==="consolidation-dispatch") await api.post("/warehouse/me/farmer-fulfillment/"+id+"/dispatch-to-consolidation");
        else if(action==="consolidation-receive") {
          const legs=(order.consolidationLegs||[]).filter((leg:any)=>leg.status==="in_transit"&&String(leg.destinationWarehouseId||"")===String(order.consolidationWarehouseId||"")).map((leg:any)=>leg.id).filter(Boolean);
          if(!legs.length)throw new Error("There are no in-transit consolidation portions to receive");
          await api.post("/warehouse/me/farmer-fulfillment/"+id+"/receive-at-consolidation",undefined,{params:{legIds:legs}});
        }
        else if(action==="consolidation-complete") await api.post("/warehouse/me/farmer-fulfillment/"+id+"/complete-consolidation");
        else if(action==="consolidation-handoff") await api.post("/warehouse/me/farmer-fulfillment/"+id+"/handoff-local-hub");
      } else {
        if(!order.orderId) throw new Error("Customer order reference is missing");
        const check=await api.get("/warehouse/me/orders/"+order.orderId+"/fulfillment-check");
        const audit=check?.data||check;
        if(!audit?.readyForDispatch) throw new Error("Packing verification is incomplete. Complete Order Packing first.");
        if(action==="nearby") {
          await api.post("/warehouse/me/outgoing/"+id+"/delivery-route",{route:"nearby",radius:order.nearbyThresholdKm??15});
          await api.put("/warehouse/me/outgoing/"+id+"/status",undefined,{params:{status:"dispatched"}});
          await api.post("/warehouse/me/outgoing/"+id+"/delivery-route",{route:"nearby",radius:order.nearbyThresholdKm??15});
        } else if(action==="same") {
          const chosenHub=hubByOrder[id];
          if(!chosenHub) throw new Error("Select an active local hub in the customer's district first");
          const result=await api.post("/warehouse/me/local-hubs/"+chosenHub+"/orders/"+order.orderId+"/dispatch",{});
          toast.success(result?.message||result?.data?.message||"Warehouse dispatch to local hub created. Waiting for hub receipt.");
        } else if(action==="destination") await api.post("/warehouse/me/outgoing/"+id+"/inter-district-dispatch");
        else throw new Error("This order needs route review or consolidation.");
      }
      toast.success("Order action completed");
      await refresh();
    } catch(e:any) {toast.error(e?.message||"Unable to process this order");}
    finally {setWorking("");}
  };
  const isBulkEligible=(o:any)=>o.dispatchStatus==="Ready for Dispatch"&&((o.source==="farmer"&&o.physicalReceiptConfirmed&&["nearby","same_district","inter_district"].includes(o.route))||(o.source==="warehouse"&&["nearby","same_district","inter_district"].includes(o.route)));
  const allEligibleDispatchOrders=orders.filter(isBulkEligible);
  const selectedDispatchOrders=orders.filter((o:any)=>selectedOrders[o.source+":"+o.id]);
  const selectAllEligibleOrders=()=>setSelectedOrders(Object.fromEntries(allEligibleDispatchOrders.map((o:any)=>[o.source+":"+o.id,true])));
  const clearSelectedOrders=()=>setSelectedOrders({});
  const bulkProcessSelected=async()=>{
    const chosen=selectedDispatchOrders;
    if(!chosen.length){toast.error("Select at least one eligible ready-for-dispatch order");return;}
    const invalid=chosen.filter((o:any)=>!isBulkEligible(o));
    if(invalid.length){toast.error("Some selected orders are no longer eligible. Refresh and select ready orders again.");return;}
    const missingPartner=chosen.find((o:any)=>o.source==="farmer"&&o.route==="nearby"&&!partnerByOrder[o.id]);
    if(missingPartner){toast.error("Choose a delivery partner for each selected nearby farmer order");setSelectedKey(missingPartner.source+":"+missingPartner.id);return;}
    const missingHub=chosen.find((o:any)=>o.source==="warehouse"&&o.route==="same_district"&&!hubByOrder[o.id]);
    if(missingHub){toast.error("Choose a local hub for each selected same-district warehouse order");setSelectedKey(missingHub.source+":"+missingHub.id);return;}
    const insufficient=chosen.find((o:any)=>o.source==="farmer"&&o.route==="nearby"&&!teamCanCarry(teams.find((t:any)=>t.id===partnerByOrder[o.id]),o));
    if(insufficient){toast.error("The selected delivery partner does not have enough vehicle capacity for "+(insufficient.orderNumber||"one selected order"));setSelectedKey(insufficient.source+":"+insufficient.id);return;}
    setWorking("bulk-process");
    let done=0;const errors:string[]=[];
    for(const o of chosen){
      try{
        if(o.source==="farmer"){
          if(!o.physicalReceiptConfirmed)throw new Error("Physical receipt is not confirmed");
          if(o.route==="nearby"){
            await api.put("/warehouse/me/farmer-fulfillment/"+o.id+"/assign-nearby-delivery-partner",undefined,{params:{deliveryPartnerId:partnerByOrder[o.id]}});
          }else if(o.route==="same_district"){
            await api.post("/warehouse/me/farmer-fulfillment/"+o.id+"/dispatch-to-local-hub");
          }else if(o.route==="inter_district"){
            let assignment:any;
            if(!o.destinationWarehouseId)assignment=await api.post("/warehouse/me/farmer-fulfillment/"+o.id+"/assign-destination-warehouse");
            if(assignment?.data?.destinationWarehouseCapacityOverrideRequired||o.destinationWarehouseCapacityOverrideRequired)throw new Error(assignment?.message||"Destination warehouse capacity requires manual review");
            await api.post("/warehouse/me/farmer-fulfillment/"+o.id+"/dispatch-to-destination");
          }else throw new Error("Route needs review before processing");
        }else{
          if(!o.orderId)throw new Error("Customer order reference is missing");
          const check=await api.get("/warehouse/me/orders/"+o.orderId+"/fulfillment-check");
          const audit=check?.data||check;
          if(!audit?.readyForDispatch)throw new Error("Packing verification is incomplete");
          if(o.route==="nearby"){
            await api.post("/warehouse/me/outgoing/"+o.id+"/delivery-route",{route:"nearby",radius:o.nearbyThresholdKm??15});
            await api.put("/warehouse/me/outgoing/"+o.id+"/status",undefined,{params:{status:"dispatched"}});
            await api.post("/warehouse/me/outgoing/"+o.id+"/delivery-route",{route:"nearby",radius:o.nearbyThresholdKm??15});
          }else if(o.route==="same_district"){
            await api.post("/warehouse/me/local-hubs/"+hubByOrder[o.id]+"/orders/"+o.orderId+"/dispatch",{});
          }else if(o.route==="inter_district"){
            await api.post("/warehouse/me/outgoing/"+o.id+"/inter-district-dispatch");
          }else throw new Error("Route needs review before processing");
        }
        done++;
      }catch(e:any){errors.push((o.orderNumber||o.id)+": "+(e?.message||"processing failed"));}
    }
    if(done)toast.success("Processed "+done+" of "+chosen.length+" selected orders across farmer and warehouse workflows");
    if(errors.length)toast.error(errors.length+" order(s) need attention: "+errors.slice(0,3).join("; "));
    setSelectedOrders({});setWorking("");await refresh();
  };
  const bulkPlan=async(route:"same_district"|"inter_district")=>{
    const chosen=filtered.filter((o:any)=>o.source==="farmer"&&o.route===route&&selectedOrders[o.source+":"+o.id]&&o.physicalReceiptConfirmed);
    if(!chosen.length){toast.error("Select received farmer orders in this route group first");return;}
    setWorking("bulk");
    let done=0;const errors:string[]=[];
    for(const o of chosen){try{if(route==="same_district")await api.post("/warehouse/me/farmer-fulfillment/"+o.id+"/dispatch-to-local-hub");else{if(!o.destinationWarehouseId)await api.post("/warehouse/me/farmer-fulfillment/"+o.id+"/assign-destination-warehouse");await api.post("/warehouse/me/farmer-fulfillment/"+o.id+"/dispatch-to-destination");}done++;}catch(e:any){errors.push((o.orderNumber||o.id)+": "+(e?.message||"failed"));}}
    if(done)toast.success("Planned "+done+" route(s)");
    if(errors.length)toast.error(errors.slice(0,2).join("; "));
    setWorking("");await refresh();
  };

  const loading=farmerQuery.isLoading||outgoingQuery.isLoading||consolidationQuery.isLoading;
  return <div className="fulfillment-dispatch-page mx-auto w-full max-w-[1700px] space-y-3 pb-8">
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3"><div className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><Truck className="h-7 w-7"/></div><div className="min-w-0"><h1 className="text-2xl font-bold tracking-tight text-slate-950">Fulfillment &amp; Dispatch</h1><p className="text-sm text-slate-600">Manage farmer fulfillment, warehouse transfers and customer deliveries.</p></div></div>
        <div className="flex flex-wrap items-center gap-2"><Button variant="outline" onClick={()=>refresh()} disabled={farmerQuery.isFetching||outgoingQuery.isFetching}><RefreshCw className="mr-2 h-4 w-4"/>Refresh</Button><Button asChild><Link href="/warehouse/consolidation">Consolidation workspace <ArrowRight className="ml-2 h-4 w-4"/></Link></Button><Button variant="outline" onClick={()=>toast("Select an order to view its route-specific steps and available actions.")}><CheckCircle2 className="mr-2 h-4 w-4"/>Workflow Guide</Button></div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild className="h-10 min-w-[260px] justify-center bg-emerald-700 text-white hover:bg-emerald-800"><Link href="/warehouse/farmer-fulfillment"><Leaf className="mr-2 h-4 w-4"/>Farmer Fulfillment Workflow</Link></Button>
        <Button asChild variant="outline" className="h-10 min-w-[280px] justify-center border-slate-300 bg-white"><Link href="/outgoing"><Warehouse className="mr-2 h-4 w-4"/>Warehouse Outgoing / Dispatch Workflow</Link></Button>
      </div>
    </div>

    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-9 fulfillment-summary-grid">
      <Card className="fulfillment-summary-card"><CardContent className="flex h-[104px] min-w-0 items-center gap-2 p-3"><div className="rounded-full bg-emerald-50 p-2.5 text-emerald-700"><Package className="h-5 w-5"/></div><div className="min-w-0 flex-1"><p className="text-[11px] leading-tight text-slate-600">All Orders</p><p className="mt-1 text-2xl font-bold">{orders.length}</p><p className="text-[11px] text-slate-500">Both sources</p></div></CardContent></Card>
      <Card className="fulfillment-summary-card border-emerald-200 bg-emerald-50/60"><CardContent className="flex h-full min-h-[104px] items-center gap-2 p-3"><div className="rounded-full bg-emerald-100 p-2.5 text-emerald-700"><Leaf className="h-5 w-5"/></div><div className="min-w-0 flex-1"><p className="text-[11px] leading-tight text-emerald-800">Farmer Orders</p><p className="mt-1 text-2xl font-bold">{orders.filter((x:any)=>x.source==="farmer").length}</p><p className="text-[11px] text-emerald-800">Farmer-packed · {orders.length?Math.round(orders.filter((x:any)=>x.source==="farmer").length/orders.length*100):0}%</p></div></CardContent></Card>
      <Card className="fulfillment-summary-card border-blue-200 bg-blue-50/60"><CardContent className="flex h-full min-h-[104px] items-center gap-2 p-3"><div className="rounded-full bg-blue-100 p-2.5 text-blue-700"><Warehouse className="h-5 w-5"/></div><div className="min-w-0 flex-1"><p className="text-[11px] leading-tight text-blue-800">Warehouse Orders</p><p className="mt-1 text-2xl font-bold">{orders.filter((x:any)=>x.source==="warehouse").length}</p><p className="text-[11px] text-blue-800">Warehouse-packed · {orders.length?Math.round(orders.filter((x:any)=>x.source==="warehouse").length/orders.length*100):0}%</p></div></CardContent></Card>
      <Card className="fulfillment-summary-card border-emerald-200 bg-emerald-50/40"><CardContent className="flex h-full min-h-[104px] items-center gap-2 p-3"><div className="rounded-full bg-emerald-100 p-2.5 text-emerald-700"><Package className="h-5 w-5"/></div><div><p className="text-xs text-slate-600">Ready for Transfer / Delivery</p><p className="mt-1 text-2xl font-bold">{stageCounts["To Route"]||0}</p></div></CardContent></Card>
      <Card className="fulfillment-summary-card border-blue-200 bg-blue-50/50"><CardContent className="flex h-full min-h-[104px] items-center gap-2 p-3"><div className="rounded-full bg-blue-100 p-2.5 text-blue-700"><ArrowLeftRight className="h-5 w-5"/></div><div><p className="text-xs text-slate-600">Transfer in Progress</p><p className="mt-1 text-2xl font-bold">{stageCounts["In Transfer"]||0}</p></div></CardContent></Card>
      <Card className="fulfillment-summary-card border-amber-200 bg-amber-50/50"><CardContent className="flex h-full min-h-[104px] items-center gap-2 p-3"><div className="rounded-full bg-amber-100 p-2.5 text-amber-700"><Truck className="h-5 w-5"/></div><div><p className="text-xs text-slate-600">Ready for Final Delivery</p><p className="mt-1 text-2xl font-bold">{stageCounts["To Dispatch"]||0}</p></div></CardContent></Card>
      <Card className="fulfillment-summary-card border-violet-200 bg-violet-50/50"><CardContent className="flex h-full min-h-[104px] items-center gap-2 p-3"><div className="rounded-full bg-violet-100 p-2.5 text-violet-700"><Truck className="h-5 w-5"/></div><div><p className="text-xs text-slate-600">Out for Delivery</p><p className="mt-1 text-2xl font-bold">{orders.filter((o:any)=>["out_for_delivery","dispatched_to_customer","delivery_in_progress"].includes(norm(o.status||o.transferStatus))).length}</p></div></CardContent></Card>
      <Card className="fulfillment-summary-card border-green-200 bg-green-50/50"><CardContent className="flex h-full min-h-[104px] items-center gap-2 p-3"><div className="rounded-full bg-green-100 p-2.5 text-green-700"><CheckCircle2 className="h-5 w-5"/></div><div><p className="text-xs text-slate-600">Delivered</p><p className="mt-1 text-2xl font-bold">{stageCounts["Delivered"]||0}</p></div></CardContent></Card>
      <Card className="fulfillment-summary-card border-red-200 bg-red-50/50"><CardContent className="flex h-full min-h-[104px] items-center gap-2 p-3"><div className="rounded-full bg-red-100 p-2.5 text-red-700"><AlertTriangle className="h-5 w-5"/></div><div><p className="text-xs text-red-800">Needs Attention</p><p className="mt-1 text-2xl font-bold">{routeCounts.route_review+routeCounts.needs_location}</p></div></CardContent></Card>
    </div>

    <div className="grid min-w-0 items-stretch gap-3 xl:grid-cols-[minmax(250px,0.88fr)_minmax(0,1.85fr)_minmax(330px,1.12fr)] 2xl:grid-cols-[minmax(270px,0.88fr)_minmax(0,1.85fr)_minmax(360px,1.12fr)]">
      <Card className="min-w-0 overflow-hidden xl:min-h-[680px]"><CardContent className="space-y-3 p-4 xl:max-h-[760px] xl:overflow-y-auto">
        <div className="flex items-center justify-between gap-2"><div><h2 className="text-lg font-bold">Route Groups</h2><p className="text-xs text-muted-foreground">Choose a route to view its orders.</p></div><Badge variant="outline">{filtered.length} orders</Badge></div>
        <button type="button" onClick={()=>{setActiveRoute("all");setSelectedKey("");}} className={"flex w-full items-center gap-3 rounded-xl border p-3 text-left "+(activeRoute==="all"?"border-emerald-500 bg-emerald-50 ring-1 ring-emerald-100":"hover:border-emerald-300")}><span className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><Package className="h-4 w-4"/></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">All Orders</span><span className="block text-xs text-muted-foreground">All transfer and delivery orders</span></span><Badge variant="secondary">{orders.length}</Badge></button>
        {ROUTES.map(r=><button type="button" key={r.key} onClick={()=>{setActiveRoute(activeRoute===r.key?"all":r.key);setSelectedKey("");}} className={"flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors "+(activeRoute===r.key?"border-emerald-500 bg-emerald-50 ring-1 ring-emerald-100":"border-slate-200 hover:border-emerald-300 hover:bg-slate-50")}><span className="rounded-lg bg-emerald-50 p-2 text-emerald-700">{r.key==="nearby"?<Truck className="h-4 w-4"/>:r.key==="inter_district"?<ArrowLeftRight className="h-4 w-4"/>:r.key==="multi_warehouse"?<Package className="h-4 w-4"/>:<MapPin className="h-4 w-4"/>}</span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{r.label}</span><span className="mt-0.5 block text-xs text-muted-foreground">{r.description}</span></span><Badge variant="secondary">{routeCounts[r.key]}</Badge></button>)}
      </CardContent></Card>

      <Card className="min-w-0 overflow-hidden xl:min-h-[680px]"><CardContent className="space-y-3 p-4">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-bold">Orders ({filtered.length})</h2>{activeRoute!=="all"&&<Badge variant="outline">{ROUTES.find(r=>r.key===activeRoute)?.label}</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">Select an order to view its route-specific operations.</p></div>
            <select aria-label="Sort orders" className="h-9 min-w-[132px] rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm focus:border-emerald-500 focus:outline-none" value={sortOrder} onChange={e=>setSortOrder(e.target.value as "newest"|"oldest")}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select>
          </div>
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
            {dispatchFilterNames.map((status)=>(
              <button key={status} type="button" onClick={()=>{setActiveStage(status);setSelectedOrders({});setSelectedKey("");}} className={"flex min-w-0 items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-xs font-semibold transition-colors "+(activeStage===status?"border-emerald-600 bg-emerald-700 text-white shadow-sm":status==="Partner Assigned"?"border-blue-200 bg-blue-50/60 text-blue-900 hover:bg-blue-100":status==="Dispatched / In Transit"?"border-amber-200 bg-amber-50/60 text-amber-900 hover:bg-amber-100":status==="Delivered"?"border-green-200 bg-green-50/60 text-green-900 hover:bg-green-100":"border-emerald-200 bg-emerald-50/60 text-emerald-900 hover:bg-emerald-100")}>
                <span className="min-w-0 leading-4">{status}</span><span className={"shrink-0 rounded-full px-2 py-0.5 text-[10px] "+(activeStage===status?"bg-white/20 text-white":"bg-white/80 text-slate-700")}>{dispatchCounts[status]||0}</span>
              </button>
            ))}
          </div>
          <div className="grid w-full grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1">
            {([{key:"all",label:"All Orders",count:orders.length},{key:"farmer",label:"Farmer Orders",count:orders.filter((o:any)=>o.source==="farmer").length},{key:"warehouse",label:"Warehouse Orders",count:orders.filter((o:any)=>o.source==="warehouse").length}] as const).map(option=><button key={option.key} type="button" onClick={()=>setSourceFilter(option.key)} className={"flex min-w-0 items-center justify-center gap-2 rounded-lg px-2 py-2.5 text-center text-xs font-semibold transition-colors "+(sourceFilter===option.key?"bg-emerald-700 text-white shadow-sm":"text-slate-600 hover:bg-white hover:text-slate-900")}><span className="truncate">{option.label}</span><span className={"shrink-0 rounded-full px-1.5 py-0.5 text-[10px] "+(sourceFilter===option.key?"bg-white/20 text-white":"bg-white text-slate-500")}>{option.count}</span></button>)}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/50 p-2">
            <div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold text-emerald-950">{allEligibleDispatchOrders.length} eligible ready orders across all routes</span><span className="text-slate-500">Select all to process farmer and warehouse orders together.</span></div>
            <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" className="h-8 border-emerald-300 bg-white" onClick={selectAllEligibleOrders} disabled={!allEligibleDispatchOrders.length}>Select All Ready Orders</Button><Button size="sm" variant="ghost" className="h-8" onClick={clearSelectedOrders} disabled={!Object.values(selectedOrders).some(Boolean)}>Clear Selection</Button></div>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><Input className="h-10 rounded-lg border-slate-200 bg-white pl-9 text-xs" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by order number, customer, product or district..."/></div>
            <Button size="sm" variant="outline" className="h-10 rounded-lg px-3" onClick={()=>{setSearch("");setSourceFilter("all");setSortOrder("newest");setActiveStage("Ready for Dispatch");setSelectedOrders({});setSelectedKey("");}}>Clear</Button>
          </div>
        </div>
        {filtered.length===0?<div className="rounded-xl border border-dashed p-10 text-center"><Package className="mx-auto h-9 w-9 text-muted-foreground"/><p className="mt-3 font-semibold">No orders in this route group</p><p className="text-sm text-muted-foreground">Choose another route group or clear the search.</p></div>:<div className="fulfillment-orders-table w-full rounded-xl border"><table className="w-full min-w-0 table-fixed text-left text-xs"><thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="w-[4%] px-1 py-2"><input type="checkbox" aria-label="Select all eligible dispatch orders" checked={filtered.filter((o:any)=>o.dispatchStatus==="Ready for Dispatch"&&((o.source==="farmer"&&o.physicalReceiptConfirmed&&["nearby","same_district","inter_district"].includes(o.route))||(o.source==="warehouse"&&["nearby","same_district","inter_district"].includes(o.route)))).length>0&&filtered.filter((o:any)=>o.dispatchStatus==="Ready for Dispatch"&&((o.source==="farmer"&&o.physicalReceiptConfirmed&&["nearby","same_district","inter_district"].includes(o.route))||(o.source==="warehouse"&&["nearby","same_district","inter_district"].includes(o.route)))).every((o:any)=>selectedOrders[o.source+":"+o.id])} onChange={e=>{const eligible=filtered.filter((o:any)=>o.dispatchStatus==="Ready for Dispatch"&&((o.source==="farmer"&&o.physicalReceiptConfirmed&&["nearby","same_district","inter_district"].includes(o.route))||(o.source==="warehouse"&&["nearby","same_district","inter_district"].includes(o.route))));setSelectedOrders(v=>({...v,...Object.fromEntries(eligible.map((o:any)=>[o.source+":"+o.id,e.target.checked]))}));}} className="h-4 w-4 accent-emerald-600"/></th><th className="w-[21%] px-1.5 py-2">Order ID</th><th className="w-[17%] px-2 py-2">Customer / Buyer</th><th className="w-[15%] px-2 py-2">Products</th><th className="w-[9%] px-2 py-2">Qty.</th><th className="w-[21%] px-1.5 py-2">Route</th><th className="w-[19%] px-1.5 py-2">Status</th></tr></thead><tbody className="divide-y">{filtered.map((o:any)=>{const key=o.source+":"+o.id;const active=selected?.source+":"+selected?.id===key;const canBulk=o.dispatchStatus==="Ready for Dispatch"&&((o.source==="farmer"&&o.physicalReceiptConfirmed&&["nearby","same_district","inter_district"].includes(o.route))||(o.source==="warehouse"&&["nearby","same_district","inter_district"].includes(o.route)));return <tr key={key} className={active?"bg-emerald-50/70":"hover:bg-slate-50"}><td className="px-1.5 py-2 align-middle"><input type="checkbox" aria-label={"Select "+o.orderNumber} checked={Boolean(selectedOrders[key])} disabled={!canBulk||o.dispatchStatus!=="Ready for Dispatch"} onChange={e=>setSelectedOrders(v=>({...v,[key]:e.target.checked}))} className="h-4 w-4 accent-emerald-600"/></td><td className="px-1.5 py-2 align-middle"><button title={o.orderNumber} className="block w-full max-w-full whitespace-normal break-all text-left text-[10px] leading-4 font-semibold text-emerald-900 hover:underline" onClick={()=>setSelectedKey(key)}>{o.orderNumber}</button><p className="mt-0.5 truncate text-[9px] text-muted-foreground">{o.source==="farmer"?"Farmer":"Warehouse"}</p></td><td className="px-1.5 py-2 align-middle"><span title={o.customerName} className="block whitespace-normal break-words text-[11px] leading-4 font-medium text-slate-700">{o.customerName}</span></td><td className="px-1.5 py-2 align-middle"><span title={o.itemSummary} className="block whitespace-normal break-words text-[11px] leading-4 text-slate-700">{o.itemSummary}</span></td><td className="px-2 py-2 align-middle whitespace-normal text-[11px] font-semibold text-slate-800">{o.quantitySummary}</td><td className="px-1.5 py-2 align-middle"><span className={"inline-flex max-w-full whitespace-normal rounded-md border px-1.5 py-1 text-[9px] font-semibold leading-3 "+(o.route==="nearby"||o.route==="same_district"?"border-emerald-200 bg-emerald-50 text-emerald-800":o.route==="inter_district"||o.route==="multi_warehouse"?"border-violet-200 bg-violet-50 text-violet-800":"border-amber-200 bg-amber-50 text-amber-800")}>{({nearby:"Nearby Delivery",same_district:"Same-District Delivery",inter_district:"Inter-District Transfer",multi_warehouse:"Multi-Warehouse",route_review:"Route Review",needs_location:"Location Needed"} as Record<RouteKey,string>)[o.route]}</span></td><td className="px-1.5 py-2 align-middle"><span className={"inline-flex max-w-full whitespace-normal rounded-md border px-1.5 py-1 text-[9px] font-semibold leading-3 "+(o.stage==="In Transfer"?"border-blue-200 bg-blue-50 text-blue-800":o.stage==="Delivered"?"border-emerald-200 bg-emerald-50 text-emerald-800":o.stage==="To Dispatch"?"border-indigo-200 bg-indigo-50 text-indigo-800":o.stage==="To Receive"?"border-slate-200 bg-slate-50 text-slate-700":"border-emerald-200 bg-emerald-50 text-emerald-800")}>{o.dispatchStatus}</span></td></tr>})}</tbody></table></div>}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground"><span>{selectedDispatchOrders.length} order(s) selected</span><span>{filtered.length} order(s) shown</span></div>
        {selectedDispatchOrders.length>0&&<div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-bold text-emerald-950">Process multiple orders together</p><Badge className="bg-emerald-700 text-white">{selectedDispatchOrders.length} selected</Badge></div>
          <div className="mt-3 space-y-2">
            {selectedDispatchOrders.filter((o:any)=>o.source==="farmer"&&o.route==="nearby"&&!o.deliveryPartnerId).map((o:any)=><div key={o.source+":"+o.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-2 rounded-lg border border-white bg-white p-2"><span className="truncate text-xs font-semibold text-slate-700">{o.orderNumber} · Nearby farmer</span><select aria-label={"Delivery partner for "+o.orderNumber} className="h-9 min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-xs" value={partnerByOrder[o.id]||""} onChange={e=>setPartnerByOrder(v=>({...v,[o.id]:e.target.value}))}><option value="">Select delivery partner</option>{teams.map((t:any)=><option key={t.id} value={t.id}>{t.name} · {t.vehicle} · {t.capacity} kg</option>)}</select></div>)}
            {selectedDispatchOrders.filter((o:any)=>o.source==="warehouse"&&o.route==="same_district").map((o:any)=><div key={o.source+":"+o.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-2 rounded-lg border border-white bg-white p-2"><span className="truncate text-xs font-semibold text-slate-700">{o.orderNumber} · Local hub</span><select aria-label={"Local hub for "+o.orderNumber} className="h-9 min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-xs" value={hubByOrder[o.id]||""} onChange={e=>setHubByOrder(v=>({...v,[o.id]:e.target.value}))}><option value="">Select destination local hub</option>{hubs.filter((h:any)=>norm(h.status)==="active"&&(normDistrict(h.district)===normDistrict(o.district)||normDistrict(h.district)===normDistrict(o.destinationDistrict||o.deliveryDistrict))).map((h:any)=><option key={String(h.id||h._id)} value={String(h.id||h._id)}>{h.name} · {h.district}</option>)}</select></div>)}
          </div>
          <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" className="bg-emerald-700 text-white hover:bg-emerald-800" disabled={busy==="bulk-process"} onClick={bulkProcessSelected}><Truck className="mr-2 h-4 w-4"/>{busy==="bulk-process"?"Processing orders…":"Process Selected Orders ("+selectedDispatchOrders.length+")"}</Button><Button size="sm" variant="outline" onClick={clearSelectedOrders}>Clear selection</Button></div>
          <p className="mt-2 text-[11px] leading-4 text-slate-600">Select All Ready Orders includes every eligible route and both order sources, not only the currently visible filter. Nearby farmer orders need a partner per order; same-district warehouse orders need a destination hub. Packing, receipt, capacity and route checks remain enforced per order.</p>
        </div>}
      </CardContent></Card>

      <Card className="min-w-0 overflow-hidden xl:sticky xl:top-20 xl:min-h-[680px]"><CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-2"><div><h2 className="text-lg font-bold">Operations</h2><p className="mt-1 text-xs text-muted-foreground">Actions for selected orders.</p></div><Badge variant="outline">{selectedDispatchOrders.length?selectedDispatchOrders.length+" selected":selected?"1 order selected":"No selection"}</Badge></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-3 flex items-center justify-between gap-1">
            {["Assign Partner","Plan Route","Dispatch","Deliver"].map((step,i)=><div key={step} className="flex min-w-0 flex-1 flex-col items-center text-center"><span className={"flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold "+(i===0?"border-emerald-700 bg-emerald-700 text-white":"border-slate-300 bg-slate-50 text-slate-600")}>{i+1}</span><span className="mt-1 text-[10px] font-semibold leading-3 text-slate-600">{step}</span></div>)}
          </div>
          <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 p-3"><div className="flex items-center gap-2"><span className="rounded-lg bg-white p-2 text-emerald-700"><Truck className="h-5 w-5"/></span><div><p className="text-sm font-bold text-slate-900">{selected?.route==="nearby"?"Nearby Direct Delivery Process":selected?.route==="same_district"?"Same-District Delivery Process":selected?.route==="inter_district"?"Inter-District Transfer Process":"Dispatch Processing"}</p><p className="text-xs text-slate-600">Select eligible orders, assign the required partner or route, then process dispatch.</p></div></div></div>
        </div>
        {selected?<div className="space-y-4"><div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-bold">#{selected.orderNumber}</h2><Badge className={selected.source==="farmer"?"bg-emerald-100 text-emerald-800":"bg-blue-100 text-blue-800"}>{selected.source==="farmer"?"Farmer Fulfillment":"Warehouse Fulfillment"}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{selected.customerName} · {selected.district}</p></div><Badge variant="outline">{selected.dispatchStatus}</Badge></div>
      <div className="grid gap-2 sm:grid-cols-4"><div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Current status</p><p className="mt-1 text-sm font-semibold">{statusText(selected.currentStatus)}</p></div><div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Route</p><p className="mt-1 text-sm font-semibold">{ROUTES.find(r=>r.key===selected.route)?.label}</p></div><div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Source warehouse</p><p className="mt-1 text-sm font-semibold">{selected.sourceWarehouseName||"Current warehouse"}</p></div><div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Destination warehouse</p><p className="mt-1 text-sm font-semibold">{selected.destinationWarehouseName||selected.destinationGroup}</p></div></div>
      <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Products / quantity</p><p className="mt-1 text-sm font-semibold">{selected.itemSummary} · {selected.quantitySummary}</p></div>
      {selected.source==="farmer"?<div className="space-y-3"><div className="flex flex-wrap items-center gap-2"><Button asChild size="sm" variant="outline"><Link href={"/incoming?search="+encodeURIComponent(selected.orderNumber)}><ClipboardCheck className="mr-2 h-4 w-4"/>Open receipt / quality check</Link></Button><Button asChild size="sm" variant="outline"><Link href={"/collections?search="+encodeURIComponent(selected.orderNumber)}>Track farm pickup</Link></Button></div>
        {!selected.physicalReceiptConfirmed&&<p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">This farmer-packed order must be physically received and pass the required quality checks before route planning.</p>}
        {selected.isUnassigned&&selected.physicalReceiptConfirmed&&<Button size="sm" disabled={!!busy} onClick={()=>act(selected,"recover")}>Link received shipment to this warehouse</Button>}
        {selected.physicalReceiptConfirmed&&selected.route==="nearby"&&!selected.deliveryPartnerId&&<div className="flex flex-wrap gap-2"><select className="h-9 rounded-md border bg-background px-2 text-sm" value={partnerByOrder[selected.id]||""} onChange={e=>setPartnerByOrder(v=>({...v,[selected.id]:e.target.value}))}><option value="">Select approved delivery partner</option>{teams.map((t:any)=><option key={t.id} value={t.id}>{t.name} · {t.vehicle} · {t.capacity} kg</option>)}</select><Button size="sm" disabled={!!busy||!partnerByOrder[selected.id]} onClick={()=>act(selected,"nearby")}>Assign delivery partner</Button></div>}
        {selected.physicalReceiptConfirmed&&selected.route==="same_district"&&!selected.transferStatus?.includes("hub")&&<Button size="sm" disabled={!!busy} onClick={()=>act(selected,"same")}>Create local-hub transfer</Button>}
        {selected.transferStatus==="hub_handoff_pending"&&<div className="flex flex-wrap gap-2"><select className="h-9 rounded-md border bg-background px-2 text-sm" value={partnerByOrder[selected.id]||""} onChange={e=>setPartnerByOrder(v=>({...v,[selected.id]:e.target.value}))}><option value="">Select local-hub pickup team</option>{teams.map((t:any)=><option key={t.id} value={t.id}>{t.name} · {t.vehicle} · {t.capacity} kg</option>)}</select><Button size="sm" disabled={!!busy||!partnerByOrder[selected.id]} onClick={()=>act(selected,"assign-hub-team")}>Assign local-hub pickup team</Button></div>}
        {selected.physicalReceiptConfirmed&&selected.route==="inter_district"&&<div className="flex flex-wrap gap-2"><Button size="sm" disabled={!!busy} onClick={()=>act(selected,"destination")}>Assign destination &amp; create transfer</Button>{selected.transferStatus==="destination_warehouse_transfer_pending"&&<><select className="h-9 rounded-md border bg-background px-2 text-sm" value={partnerByOrder[selected.id]||""} onChange={e=>setPartnerByOrder(v=>({...v,[selected.id]:e.target.value}))}><option value="">Select transfer team</option>{teams.map((t:any)=><option key={t.id} value={t.id}>{t.name} · {t.capacity} kg</option>)}</select><Button size="sm" disabled={!!busy||!partnerByOrder[selected.id]} onClick={()=>act(selected,"assign-transfer")}>Assign transfer team</Button></>}</div>}
        {selected.currentWarehouseRole==="destination"&&selected.transferStatus==="destination_warehouse_arrived_pending_receipt"&&<Button size="sm" disabled={!!busy} onClick={()=>act(selected,"destination-receive")}>Confirm destination receipt</Button>}
        {selected.transferStatus==="destination_warehouse_received"&&<Button size="sm" disabled={!!busy} onClick={()=>act(selected,"hub-handoff")}>Send to local hub</Button>}
        {selected.transferStatus==="hub_arrived_pending_receipt"&&<Button size="sm" disabled={!!busy} onClick={()=>act(selected,"hub-receive")}>Confirm local hub receipt</Button>}
        {selected.canDispatchToConsolidation&&selected.physicalReceiptConfirmed&&<Button size="sm" disabled={!!busy} onClick={()=>act(selected,"consolidation-dispatch")}>Dispatch portion to consolidation</Button>}
        {selected.consolidationLegs?.some((leg:any)=>leg.status==="in_transit")&&selected.isConsolidationWarehouse&&<Button size="sm" disabled={!!busy} onClick={()=>act(selected,"consolidation-receive")}>Receive in-transit consolidation portions</Button>}
        {(selected.consolidation?.canComplete||selected.consolidationStatus==="consolidation_portions_received")&&selected.isConsolidationWarehouse&&<Button size="sm" disabled={!!busy} onClick={()=>act(selected,"consolidation-complete")}>Complete consolidation</Button>}
        {(selected.consolidation?.canHandoffLocalHub||selected.consolidationStatus==="consolidated")&&selected.isConsolidationWarehouse&&<Button size="sm" disabled={!!busy} onClick={()=>act(selected,"consolidation-handoff")}>Create local-hub handoff</Button>}
        {selected.consolidation?.canComplete&&<Button size="sm" disabled={!!busy} onClick={()=>act(selected,"consolidation-complete")}>Complete consolidation</Button>}
        {selected.consolidation?.canHandoffLocalHub&&<Button size="sm" disabled={!!busy} onClick={()=>act(selected,"consolidation-handoff")}>Send consolidated order to local hub</Button>}
      </div>:<div className="space-y-3"><p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">Warehouse orders become eligible here only after Order Packing confirms the packed quantities. The dispatch action checks the backend fulfillment audit before proceeding.</p><div className="flex flex-wrap gap-2"><Button asChild size="sm" variant="outline"><Link href={"/packing?search="+encodeURIComponent(selected.orderNumber)}>Open Order Packing</Link></Button>{selected.route==="nearby"&&<Button size="sm" disabled={!!busy} onClick={()=>act(selected,"nearby")}>Verify packing &amp; dispatch to delivery</Button>}{selected.route==="same_district"&&<div className="flex flex-wrap items-center gap-2"><select className="h-9 min-w-[230px] rounded-md border bg-background px-2 text-sm" value={hubByOrder[selected.id]||""} onChange={e=>setHubByOrder(v=>({...v,[selected.id]:e.target.value}))}><option value="">Select local hub for {selected.district}</option>{hubs.filter((h:any)=>norm(h.status)==="active"&&(normDistrict(h.district)===normDistrict(selected.district)||normDistrict(h.district)===normDistrict(selected.destinationDistrict||selected.deliveryDistrict))).map((h:any)=><option key={String(h.id||h._id)} value={String(h.id||h._id)}>{h.name} · {h.district} · {h.status||"active"}</option>)}</select><Button size="sm" disabled={!!busy||!hubByOrder[selected.id]} onClick={()=>act(selected,"same")}>Dispatch to selected local hub</Button>{!hubs.some((h:any)=>norm(h.status)==="active"&&(normDistrict(h.district)===normDistrict(selected.district)||normDistrict(h.district)===normDistrict(selected.destinationDistrict||selected.deliveryDistrict)))&&<span className="text-xs text-amber-700">No active local hub is configured for this destination district under your warehouse.</span>}</div>}{selected.route==="inter_district"&&<Button size="sm" disabled={!!busy} onClick={()=>act(selected,"destination")}>Create destination warehouse transfer</Button>}{selected.route==="multi_warehouse"&&<Button asChild size="sm"><Link href="/warehouse/consolidation">Open consolidation</Link></Button>}</div></div>}
      {(selected.route==="route_review"||selected.route==="needs_location")&&<div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mr-2 inline h-4 w-4"/>{selected.route==="needs_location"?"Complete source and customer district/location data before routing.":"Review route configuration and direct-delivery eligibility before processing."} Dispatch is blocked until the route is valid.</div>}
      <div className="flex flex-wrap gap-2 border-t pt-3"><Button asChild size="sm" variant="outline"><Link href="/warehouse/consolidation">Multi-warehouse consolidation</Link></Button></div>
    </div>:<div className="rounded-xl border border-dashed p-8 text-center"><Truck className="mx-auto h-10 w-10 text-slate-300"/><p className="mt-2 font-semibold">No order selected</p><p className="mt-1 text-xs text-muted-foreground">Choose an order from the middle panel to see the next valid operation.</p></div>}
      </CardContent></Card>
    </div>
    <p className="text-xs text-muted-foreground">The original Farmer Fulfillment and Outgoing / Dispatch pages remain available as fallback. This workspace exposes the same order-specific transfer, local-hub and consolidation operations while retaining backend authorization and validation.</p>
  </div>;
}
