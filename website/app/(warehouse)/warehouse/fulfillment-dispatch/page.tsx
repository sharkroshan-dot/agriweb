"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AlertTriangle, ArrowLeftRight, ArrowRight, CheckCircle2, Leaf, MapPin, Package, RefreshCw, Route, Search, Truck, Warehouse } from "lucide-react";
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
const hubPoint=(value:any):{lat:number;lng:number}|null=>{
  if(!value||typeof value!=="object")return null;
  const nested=value.location||value.deliveryLocation||value.geo||value.coordinates||value;
  if(Array.isArray(nested)&&nested.length>=2){
    const lng=Number(nested[0]),lat=Number(nested[1]);
    return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180?{lat,lng}:null;
  }
  if(nested&&typeof nested==="object"){
    const coords=nested.coordinates;
    if(Array.isArray(coords)&&coords.length>=2){
      const lng=Number(coords[0]),lat=Number(coords[1]);
      if(Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180)return {lat,lng};
    }
    const lat=Number(nested.lat??nested.latitude),lng=Number(nested.lng??nested.lon??nested.longitude);
    if(Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180)return {lat,lng};
  }
  return null;
};
const geoDistanceKm=(a:any,b:any)=>{
  const p=hubPoint(a),q=hubPoint(b);if(!p||!q)return null;
  const rad=(n:number)=>n*Math.PI/180, dLat=rad(q.lat-p.lat),dLng=rad(q.lng-p.lng);
  const h=Math.sin(dLat/2)**2+Math.cos(rad(p.lat))*Math.cos(rad(q.lat))*Math.sin(dLng/2)**2;
  return 6371.0088*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
};
const orderDestinationPoint=(o:any)=>hubPoint(o.deliveryLocation)||hubPoint(o.deliveryAddress)||hubPoint(o.shippingAddress)||hubPoint(o.customerLocation);
const orderDestinationLocality=(o:any)=>{
  const a=o.deliveryAddress||o.shippingAddress||{};
  return normDistrict(a.locality||a.area||a.village||a.town||a.city||a.municipality||o.deliveryLocality||o.deliveryVillage||o.deliveryTown||o.deliveryCity);
};
const orderDestinationDistrict=(o:any)=>normDistrict(o.destinationDistrict||o.deliveryDistrict||o.customerDistrict||o.district||(o.deliveryAddress||{}).district||(o.shippingAddress||{}).district);
const recommendedLocalHub=(order:any,hubs:any[])=>{
  const active=(hubs||[]).filter((h:any)=>norm(h.status)==="active"&&h.deletedAt==null);
  if(!active.length)return null;
  const destination=orderDestinationPoint(order);
  if(destination){
    const ranked=active.map((hub:any)=>({hub,distance:geoDistanceKm(destination,hub.location||hub.coordinates)})).filter((x:any)=>x.distance!==null).sort((a:any,b:any)=>a.distance-b.distance);
    if(ranked.length)return {...ranked[0].hub,_recommendedDistanceKm:ranked[0].distance,_recommendationSource:"distance"};
  }
  const district=orderDestinationDistrict(order), locality=orderDestinationLocality(order);
  if(!district)return null;
  const ranked=active.map((hub:any)=>{
    const hubDistrict=normDistrict(hub.district||hub.address?.district||hub.address?.city);
    const areas=(hub.serviceAreas||[]).map((x:any)=>normDistrict(x));
    const localityMatch=Boolean(locality&&areas.includes(locality));
    return {hub,localityMatch,districtMatch:hubDistrict===district};
  }).filter((x:any)=>x.districtMatch).sort((a:any,b:any)=>Number(b.localityMatch)-Number(a.localityMatch));
  if(!ranked.length)return null;
  return {...ranked[0].hub,_recommendedDistanceKm:null,_recommendationSource:ranked[0].localityMatch?"service-area":"district"};
};
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
const getDeliveryAddress=(x:any)=>{
  const raw=x.deliveryAddress||x.shippingAddress||x.customerAddress||x.deliveryContact?.address||x.address;
  if(typeof raw==="string"&&raw.trim())return raw.trim();
  const address=raw&&typeof raw==="object"?raw:{};
  const parts=[
    address.addressLine1,address.addressLine2,address.line1,address.line2,
    address.street,address.streetAddress,address.building,address.apartment,
    address.landmark,address.locality,address.area,address.village,address.town,
    address.city,address.municipality,address.district,address.state,
    address.postalCode||address.zipCode||address.pincode,address.country,
    x.deliveryAddressLine,x.shippingAddressLine,x.deliveryLocality,x.deliveryCity,
    x.deliveryDistrict,x.deliveryState,x.deliveryPincode
  ].filter((value:any)=>value!==null&&value!==undefined&&typeof value!=="object"&&String(value).trim());
  return [...new Set(parts.map((value:any)=>String(value).trim()))].join(", ");
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
  const [activeStage,setActiveStage]=useState<DispatchStatus|"All">("Ready for Dispatch");
  const [selectedKey,setSelectedKey]=useState("");
  const [expanded,setExpanded]=useState<string[]>([]);
  const [selectedOrders,setSelectedOrders]=useState<Record<string,boolean>>({});
  const [partnerByOrder,setPartnerByOrder]=useState<Record<string,string>>({});
  const [hubByOrder,setHubByOrder]=useState<Record<string,string>>({});
  const [destinationCapacityAcknowledged,setDestinationCapacityAcknowledged]=useState<Record<string,boolean>>({});
  const [transferPreparationOpen,setTransferPreparationOpen]=useState(false);
  const [transferTeamByGroup,setTransferTeamByGroup]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState("");
  const farmerQuery=useQuery({queryKey:["unifiedFarmerFulfillmentTransfers"],queryFn:()=>api.get("/warehouse/me/farmer-fulfillment-transfers"),refetchInterval:15000});
  const outgoingQuery=useQuery({queryKey:["unifiedWarehouseOutgoing"],queryFn:async()=>{const first=await api.get("/warehouse/me/outgoing",{params:{page:1,limit:100}});const payload=first?.data||first;const pagination=payload?.pagination||{};const pages=Math.min(Number(pagination.totalPages||1),10);const rest=await Promise.all(Array.from({length:Math.max(0,pages-1)},(_,i)=>api.get("/warehouse/me/outgoing",{params:{page:i+2,limit:100}})));return {data:{outgoing:[...(payload?.outgoing||[]),...rest.flatMap((r:any)=>(r?.data||r)?.outgoing||[])],pagination}};},refetchInterval:20000});
  const teamsQuery=useQuery({queryKey:["unifiedFulfillmentPickupTeams"],queryFn:()=>api.get("/warehouse/me/pickup-team/members"),refetchInterval:30000});
  const hubsQuery=useQuery({queryKey:["unifiedFulfillmentLocalHubs"],queryFn:()=>api.get("/warehouse/me/local-hubs"),refetchInterval:30000});
  const consolidationQuery=useQuery({queryKey:["unifiedFarmerConsolidations"],queryFn:()=>api.get("/warehouse/me/farmer-fulfillment-consolidations"),refetchInterval:20000});
  const teams=(teamsQuery.data?.data?.members||[]).map((m:any)=>({id:String(m.deliveryPartnerId||m.id||m._id),name:m.name||m.partnerName||m.firstName||"Delivery partner",vehicle:m.vehicleType||m.vehicle||"Vehicle",capacity:Number(m.capacity||m.vehicleCapacity||0)}));
  const hubs=hubsQuery.data?.data?.hubs||hubsQuery.data?.hubs||[];
  const getRecommendedHub=(order:any)=>recommendedLocalHub(order,hubs);
  const getSelectedHubId=(order:any)=>hubByOrder[order.id]||String(getRecommendedHub(order)?.id||getRecommendedHub(order)?._id||"");
  const orderQuantity=(order:any)=>Number(order.totalQuantity||order.quantity||order.items?.reduce((sum:number,item:any)=>sum+Number(item.quantity||item.expectedQuantity||0),0)||0);
  const teamCanCarry=(team:any,order:any)=>orderQuantity(order)>0&&Number(team?.capacity||0)>=orderQuantity(order);
  const consolidationRows=consolidationQuery.data?.data?.consolidations||consolidationQuery.data?.consolidations||[];
  const farmerRows=farmerQuery.data?.data?.transfers||farmerQuery.data?.transfers||[];
  const outgoingRows=outgoingQuery.data?.data?.outgoing||outgoingQuery.data?.outgoing||[];
  const orders=useMemo(()=>{const farmer=farmerRows.map((row:any)=>{const detail=consolidationRows.find((x:any)=>String(x.orderId||x.requestId||"")===String(row.orderId||row.id||""));return normalizeFarmer({...row,...(detail?{consolidationLegs:detail.consolidationLegs||[],consolidationStatus:detail.consolidationStatus||row.consolidationStatus,allConsolidationLegsReceived:detail.allConsolidationLegsReceived,canDispatchToConsolidation:detail.canDispatchToConsolidation,isConsolidationWarehouse:detail.isConsolidationWarehouse,productPortions:detail.productPortions||row.productPortions,consolidation:detail.consolidation||row.consolidation}: {})});});const grouped=new Map<string,any>();for(const line of outgoingRows){const key=String(line.orderId||line.orderNumber||line.id);const existing=grouped.get(key);if(!existing)grouped.set(key,{...line,id:String(line.id||line._id),outgoingIds:[String(line.id||line._id)],items:[{productName:line.productName||line.name||"Product",quantity:Number(line.quantity||0)}],totalQuantity:Number(line.quantity||0)});else{existing.outgoingIds.push(String(line.id||line._id));existing.items.push({productName:line.productName||line.name||"Product",quantity:Number(line.quantity||0)});existing.totalQuantity+=Number(line.quantity||0);}}const warehouse=[...grouped.values()].map((x:any)=>normalizeWarehouse({...x,items:x.items,quantity:x.totalQuantity,totalQuantity:x.totalQuantity}));return [...farmer,...warehouse];},[farmerRows,outgoingRows,consolidationRows]);
  const filtered=useMemo(()=>{
    const q=search.trim().toLowerCase();
    return orders.filter((o:any)=>(activeRoute==="all"||o.route===activeRoute)&&(activeStage==="All"||o.dispatchStatus===activeStage)&&(sourceFilter==="all"||o.source===sourceFilter)&&(!q||[o.orderNumber,o.customerName,o.district,o.destinationGroup,o.itemSummary,o.currentStatus].some(v=>String(v||"").toLowerCase().includes(q)))).sort((a:any,b:any)=>{const at=new Date(a.createdAt||a.orderDate||a.placedAt||0).getTime()||0;const bt=new Date(b.createdAt||b.orderDate||b.placedAt||0).getTime()||0;return sortOrder==="newest"?bt-at:at-bt;});
  },[orders,search,activeRoute,activeStage,sourceFilter,sortOrder]);
  const selected=orders.find((o:any)=>o.source+":"+o.id===selectedKey)||filtered[0]||null;
  const routeCounts=Object.fromEntries(ROUTES.map(r=>[r.key,orders.filter((o:any)=>o.route===r.key).length])) as Record<RouteKey,number>;
  const stageNames=["To Receive","To Route","In Transfer","To Dispatch","Delivered"];
  const stageCounts=Object.fromEntries(stageNames.map(s=>[s,orders.filter((o:any)=>o.stage===s).length])) as Record<string,number>;
  const dispatchFilterNames=["Ready for Dispatch","Partner Assigned","Dispatched / In Transit","Delivered"] as const;
  const dispatchCounts=Object.fromEntries(dispatchFilterNames.map(s=>[s,orders.filter((o:any)=>o.dispatchStatus===s).length])) as Record<string,number>;
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
          const chosenHub=getSelectedHubId(order);
          if(!chosenHub) throw new Error("No active local hub could be matched to this delivery address. Verify the customer's delivery address and local-hub coverage.");
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
  const isBulkEligible=(o:any)=>o.dispatchStatus==="Ready for Dispatch"&&((o.source==="farmer"&&o.physicalReceiptConfirmed&&(["nearby","same_district","inter_district"].includes(o.route)||(o.route==="multi_warehouse"&&Boolean(o.canDispatchToConsolidation))))||(o.source==="warehouse"&&["nearby","same_district","inter_district"].includes(o.route)));
  const allEligibleDispatchOrders=orders.filter(isBulkEligible);
  const selectedDispatchOrders=orders.filter((o:any)=>selectedOrders[o.source+":"+o.id]);
  const visibleEligibleDispatchOrders=filtered.filter(isBulkEligible);
  const selectedInterDistrictFarmerOrders=selectedDispatchOrders.filter((o:any)=>o.source==="farmer"&&o.route==="inter_district");
  const transferPreparationGroups=useMemo(()=>{
    const grouped=new Map<string,any[]>();
    selectedInterDistrictFarmerOrders.forEach((o:any)=>{
      const destination=String(o.destinationWarehouseName||o.eventDestinationWarehouseName||o.destinationGroup||o.destinationDistrict||o.deliveryDistrict||o.district||"Destination warehouse to be resolved");
      grouped.set(destination,[...(grouped.get(destination)||[]),o]);
    });
    return [...grouped.entries()].map(([name,items])=>({key:name,name,items,quantity:items.reduce((sum:number,o:any)=>sum+orderQuantity(o),0)}));
  },[selectedDispatchOrders]);
  const assignSelectedTransferTeams=async()=>{
    if(!selectedInterDistrictFarmerOrders.length){toast.error("Select inter-district farmer orders first");return;}
    for(const group of transferPreparationGroups){
      const teamId=transferTeamByGroup[group.key];
      if(!teamId){toast.error("Choose a transfer pickup team for "+group.name);return;}
      const team=teams.find((t:any)=>t.id===teamId);
      if(!team||Number(team.capacity||0)<group.quantity){toast.error("Selected team does not have enough capacity for "+group.name);return;}
    }
    setWorking("assign-transfer-groups");
    let assigned=0;const errors:string[]=[];
    for(const group of transferPreparationGroups){
      const teamId=transferTeamByGroup[group.key];
      for(const order of group.items){
        try{
          // Create the destination-transfer manifest first; the assignment endpoint
          // requires an existing manifest in "awaiting_team_assignment" status.
          if(!order.destinationWarehouseId){
            await api.post("/warehouse/me/farmer-fulfillment/"+order.id+"/assign-destination-warehouse");
          }
          await api.post("/warehouse/me/farmer-fulfillment/"+order.id+"/dispatch-to-destination");
          await api.put("/warehouse/me/farmer-fulfillment/"+order.id+"/assign-destination-pickup-team",undefined,{params:{deliveryPartnerId:teamId}});
          assigned++;
        }catch(e:any){errors.push((order.orderNumber||order.id)+": "+(e?.message||"assignment failed"));}
      }
    }
    if(errors.length){
      toast.error(errors.slice(0,3).join("; "));
      setWorking("");
      await refresh();
      return;
    }
    toast.success("Transfer pickup team assigned for "+assigned+" order(s). Orders are prepared and have not been dispatched.");
    setTransferPreparationOpen(false);
    setWorking("");
    await refresh();
  };
  const selectAllEligibleOrders=()=>setSelectedOrders(Object.fromEntries(allEligibleDispatchOrders.map((o:any)=>[o.source+":"+o.id,true])));
  const clearSelectedOrders=()=>setSelectedOrders({});
  const bulkProcessSelected=async()=>{
    const chosen=selectedDispatchOrders;
    if(!chosen.length){toast.error("Select at least one eligible ready-for-dispatch order");return;}
    setWorking("bulk-process");
    let done=0;const errors:string[]=[];
    for(const o of chosen){
      try{
        if(!isBulkEligible(o))throw new Error("Order is not eligible for dispatch yet. Check physical receipt, route and ready status.");
        if(o.source==="farmer"){
          if(!o.physicalReceiptConfirmed)throw new Error("Physical receipt is not confirmed");
          if(o.route==="nearby"){
            const partner=partnerByOrder[o.id];if(!partner)throw new Error("Select a delivery partner");
            const team=teams.find((t:any)=>t.id===partner);if(!teamCanCarry(team,o))throw new Error("Selected delivery partner does not have enough vehicle capacity");
          }
          if(o.route==="nearby"){
            await api.put("/warehouse/me/farmer-fulfillment/"+o.id+"/assign-nearby-delivery-partner",undefined,{params:{deliveryPartnerId:partnerByOrder[o.id]}});
          }else if(o.route==="same_district"){
            await api.post("/warehouse/me/farmer-fulfillment/"+o.id+"/dispatch-to-local-hub");
          }else if(o.route==="inter_district"){
            let assignment:any;
            if(!o.destinationWarehouseId)assignment=await api.post("/warehouse/me/farmer-fulfillment/"+o.id+"/assign-destination-warehouse");
            if(assignment?.data?.destinationWarehouseCapacityOverrideRequired||o.destinationWarehouseCapacityOverrideRequired)throw new Error(assignment?.message||"Destination warehouse capacity requires manual review");
            await api.post("/warehouse/me/farmer-fulfillment/"+o.id+"/dispatch-to-destination");
          }else if(o.route==="multi_warehouse"&&o.canDispatchToConsolidation){
            await api.post("/warehouse/me/farmer-fulfillment/"+o.id+"/dispatch-to-consolidation");
          }else throw new Error("This order's route or current stage needs review before processing");
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
            const hub=getSelectedHubId(o);if(!hub)throw new Error("No active local hub could be matched to "+o.orderNumber+". Verify the delivery address and local-hub coverage.");
            await api.post("/warehouse/me/local-hubs/"+hub+"/orders/"+o.orderId+"/dispatch",{});
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
      <Card className="fulfillment-summary-card border-emerald-200 bg-emerald-50/60"><CardContent className="flex h-full min-h-[104px] items-center gap-2 p-3"><div className="rounded-full bg-emerald-100 p-2.5 text-emerald-700"><Leaf className="h-5 w-5"/></div><div className="min-w-0 flex-1"><p className="text-[11px] leading-tight text-emerald-800">Farmer Orders</p><p className="mt-1 text-2xl font-bold">{orders.filter((x:any)=>x.source==="farmer").length}</p><p className="text-[11px] text-emerald-800">Source share · {orders.length?Math.round(orders.filter((x:any)=>x.source==="farmer").length/orders.length*100):0}%</p></div></CardContent></Card>
      <Card className="fulfillment-summary-card border-blue-200 bg-blue-50/60"><CardContent className="flex h-full min-h-[104px] items-center gap-2 p-3"><div className="rounded-full bg-blue-100 p-2.5 text-blue-700"><Warehouse className="h-5 w-5"/></div><div className="min-w-0 flex-1"><p className="text-[11px] leading-tight text-blue-800">Warehouse Orders</p><p className="mt-1 text-2xl font-bold">{orders.filter((x:any)=>x.source==="warehouse").length}</p><p className="text-[11px] text-blue-800">Source share · {orders.length?Math.round(orders.filter((x:any)=>x.source==="warehouse").length/orders.length*100):0}%</p></div></CardContent></Card>
      <Card className="fulfillment-summary-card border-emerald-200 bg-emerald-50/40"><CardContent className="flex h-full min-h-[104px] items-center gap-2 p-3"><div className="rounded-full bg-emerald-100 p-2.5 text-emerald-700"><Package className="h-5 w-5"/></div><div><p className="text-xs text-slate-600">Ready for Transfer / Delivery</p><p className="mt-1 text-2xl font-bold">{stageCounts["To Route"]||0}</p></div></CardContent></Card>
      <Card className="fulfillment-summary-card border-blue-200 bg-blue-50/50"><CardContent className="flex h-full min-h-[104px] items-center gap-2 p-3"><div className="rounded-full bg-blue-100 p-2.5 text-blue-700"><ArrowLeftRight className="h-5 w-5"/></div><div><p className="text-xs text-slate-600">Transfer in Progress</p><p className="mt-1 text-2xl font-bold">{stageCounts["In Transfer"]||0}</p></div></CardContent></Card>
      <Card className="fulfillment-summary-card border-amber-200 bg-amber-50/50"><CardContent className="flex h-full min-h-[104px] items-center gap-2 p-3"><div className="rounded-full bg-amber-100 p-2.5 text-amber-700"><Truck className="h-5 w-5"/></div><div><p className="text-xs text-slate-600">Ready for Final Delivery</p><p className="mt-1 text-2xl font-bold">{stageCounts["To Dispatch"]||0}</p></div></CardContent></Card>
      <Card className="fulfillment-summary-card border-violet-200 bg-violet-50/50"><CardContent className="flex h-full min-h-[104px] items-center gap-2 p-3"><div className="rounded-full bg-violet-100 p-2.5 text-violet-700"><Truck className="h-5 w-5"/></div><div><p className="text-xs text-slate-600">Out for Delivery</p><p className="mt-1 text-2xl font-bold">{orders.filter((o:any)=>[o.status,o.transferStatus,o.dispatchStatus,o.orderStatus,o.fulfillmentStatus,o.currentStage,o.stage].some((v:any)=>["out_for_delivery","dispatched_to_customer","delivery_in_progress"].includes(norm(v)))).length}</p></div></CardContent></Card>
      <Card className="fulfillment-summary-card border-green-200 bg-green-50/50"><CardContent className="flex h-full min-h-[104px] items-center gap-2 p-3"><div className="rounded-full bg-green-100 p-2.5 text-green-700"><CheckCircle2 className="h-5 w-5"/></div><div><p className="text-xs text-slate-600">Delivered</p><p className="mt-1 text-2xl font-bold">{stageCounts["Delivered"]||0}</p></div></CardContent></Card>
      <Card className="fulfillment-summary-card border-red-200 bg-red-50/50"><CardContent className="flex h-full min-h-[104px] items-center gap-2 p-3"><div className="rounded-full bg-red-100 p-2.5 text-red-700"><AlertTriangle className="h-5 w-5"/></div><div><p className="text-xs text-red-800">Needs Attention</p><p className="mt-1 text-2xl font-bold">{routeCounts.route_review+routeCounts.needs_location}</p></div></CardContent></Card>
    </div>

    <div className="grid min-w-0 items-stretch gap-3 xl:grid-cols-[minmax(250px,0.88fr)_minmax(0,1.85fr)_minmax(330px,1.12fr)] 2xl:grid-cols-[minmax(270px,0.88fr)_minmax(0,1.85fr)_minmax(360px,1.12fr)]">
      <Card className="min-w-0 overflow-hidden xl:min-h-[680px]"><CardContent className="space-y-3 p-4 xl:max-h-[760px] xl:overflow-y-auto">
        <div className="flex items-center justify-between gap-2"><div><h2 className="text-lg font-bold">Route Groups</h2><p className="text-xs text-muted-foreground">Choose a route to view its orders.</p></div><Badge variant="outline">{activeRoute==="all"?orders.length:routeCounts[activeRoute]} orders</Badge></div>
        <button type="button" onClick={()=>{setActiveRoute("all");setActiveStage("All");setSelectedKey("");setSelectedOrders({});}} className={"flex w-full items-center gap-3 rounded-xl border p-3 text-left "+(activeRoute==="all"?"border-emerald-500 bg-emerald-50 ring-1 ring-emerald-100":"hover:border-emerald-300")}><span className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><Package className="h-4 w-4"/></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">All Orders</span><span className="block text-xs text-muted-foreground">All transfer and delivery orders</span></span><Badge variant="secondary">{orders.length}</Badge></button>
        {ROUTES.map(r=><button type="button" key={r.key} onClick={()=>{const nextRoute=activeRoute===r.key?"all":r.key;setActiveRoute(nextRoute);setActiveStage("All");setSelectedKey("");setSelectedOrders({});}} className={"flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors "+(activeRoute===r.key?"border-emerald-500 bg-emerald-50 ring-1 ring-emerald-100":"border-slate-200 hover:border-emerald-300 hover:bg-slate-50")}><span className="rounded-lg bg-emerald-50 p-2 text-emerald-700">{r.key==="nearby"?<Truck className="h-4 w-4"/>:r.key==="inter_district"?<ArrowLeftRight className="h-4 w-4"/>:r.key==="multi_warehouse"?<Package className="h-4 w-4"/>:<MapPin className="h-4 w-4"/>}</span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{r.label}</span><span className="mt-0.5 block text-xs text-muted-foreground">{r.description}</span></span><Badge variant="secondary">{routeCounts[r.key]}</Badge></button>)}
      </CardContent></Card>

      <Card className="min-w-0 overflow-hidden xl:min-h-[680px]"><CardContent className="space-y-3 p-4">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-bold">Orders ({filtered.length})</h2>{activeRoute!=="all"&&<Badge variant="outline">{ROUTES.find(r=>r.key===activeRoute)?.label}</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">Select an order to view its route-specific operations.</p></div>
            <select aria-label="Sort orders" className="h-9 min-w-[132px] rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm focus:border-emerald-500 focus:outline-none" value={sortOrder} onChange={e=>setSortOrder(e.target.value as "newest"|"oldest")}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select>
          </div>
          <div data-testid="dispatch-status-filters" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {dispatchFilterNames.map((status)=>(
              <button key={status} type="button" onClick={()=>{setActiveStage(status);setSelectedOrders({});setSelectedKey("");}} className={"flex min-w-0 items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-xs font-semibold transition-colors "+(activeStage===status?"border-emerald-600 bg-emerald-700 text-white shadow-sm":status==="Partner Assigned"?"border-blue-200 bg-blue-50/60 text-blue-900 hover:bg-blue-100":status==="Dispatched / In Transit"?"border-amber-200 bg-amber-50/60 text-amber-900 hover:bg-amber-100":status==="Delivered"?"border-green-200 bg-green-50/60 text-green-900 hover:bg-green-100":"border-emerald-200 bg-emerald-50/60 text-emerald-900 hover:bg-emerald-100")}>
                <span className="min-w-0 leading-4">{status}</span><span className={"shrink-0 rounded-full px-2 py-0.5 text-[10px] "+(activeStage===status?"bg-white/20 text-white":"bg-white/80 text-slate-700")}>{dispatchCounts[status]||0}</span>
              </button>
            ))}
          </div>
          <div className="grid w-full grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1">
            {([{key:"all",label:"All Orders",count:orders.length},{key:"farmer",label:"Farmer Orders",count:orders.filter((o:any)=>o.source==="farmer").length},{key:"warehouse",label:"Warehouse Orders",count:orders.filter((o:any)=>o.source==="warehouse").length}] as const).map(option=><button key={option.key} type="button" onClick={()=>setSourceFilter(option.key)} className={"flex min-w-0 items-center justify-center gap-2 rounded-lg px-2 py-2.5 text-center text-xs font-semibold transition-colors "+(sourceFilter===option.key?"bg-emerald-700 text-white shadow-sm":"text-slate-600 hover:bg-white hover:text-slate-900")}><span className="truncate">{option.label}</span><span className={"shrink-0 rounded-full px-1.5 py-0.5 text-[10px] "+(sourceFilter===option.key?"bg-white/20 text-white":"bg-white text-slate-500")}>{option.count}</span></button>)}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><Input className="h-10 rounded-lg border-slate-200 bg-white pl-9 text-xs" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by order number, customer, product or district..."/></div>
            <Button size="sm" variant="outline" className="h-10 rounded-lg px-3" onClick={()=>{setSearch("");setSourceFilter("all");setSortOrder("newest");setActiveStage("Ready for Dispatch");setSelectedOrders({});setSelectedKey("");}}>Clear</Button>
          </div>
        </div>
        {filtered.length===0?<div className="rounded-xl border border-dashed p-10 text-center"><Package className="mx-auto h-9 w-9 text-muted-foreground"/><p className="mt-3 font-semibold">No orders in this route group</p><p className="text-sm text-muted-foreground">Choose another route group or clear the search.</p></div>:<div className="fulfillment-orders-table w-full rounded-xl border"><table className="w-full min-w-0 table-fixed text-left text-xs"><thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="w-10 min-w-10 px-2 py-2 text-center"><input type="checkbox" aria-label="Select all eligible visible orders" title="Select all eligible visible orders" checked={visibleEligibleDispatchOrders.length>0&&visibleEligibleDispatchOrders.every((o:any)=>Boolean(selectedOrders[o.source+":"+o.id]))} disabled={!visibleEligibleDispatchOrders.length} onChange={e=>setSelectedOrders(v=>({...v,...Object.fromEntries(visibleEligibleDispatchOrders.map((o:any)=>[o.source+":"+o.id,e.target.checked]))}))} className="h-5 w-5 cursor-pointer accent-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"/></th><th className="w-[18%] px-1.5 py-2">Order ID</th><th className="w-[18%] px-2 py-2">Customer / Buyer</th><th className="w-[15%] px-2 py-2">Products</th><th className="w-[8%] px-2 py-2">Qty.</th><th className="w-[17%] px-1.5 py-2">Route</th><th className="w-[18%] px-1.5 py-2">Status</th></tr></thead><tbody className="divide-y">{filtered.map((o:any)=>{const key=o.source+":"+o.id;const active=selected?.source+":"+selected?.id===key;const canBulk=o.dispatchStatus==="Ready for Dispatch"&&((o.source==="farmer"&&o.physicalReceiptConfirmed&&["nearby","same_district","inter_district"].includes(o.route))||(o.source==="warehouse"&&["nearby","same_district","inter_district"].includes(o.route)));return <tr key={key} onClick={()=>setSelectedOrders(v=>({...v,[key]:!v[key]}))} aria-selected={Boolean(selectedOrders[key])} className={"cursor-pointer transition-colors "+(selectedOrders[key]?"bg-emerald-50 ring-1 ring-inset ring-emerald-200":"hover:bg-emerald-50/50")}><td className="w-10 min-w-10 px-2 py-2 text-center align-middle"><input type="checkbox" aria-label={"Select "+o.orderNumber} title={canBulk?"Select "+o.orderNumber:"Select to report validation issues during processing"} checked={Boolean(selectedOrders[key])} onClick={e=>e.stopPropagation()} onChange={e=>setSelectedOrders(v=>({...v,[key]:e.target.checked}))} className="h-5 w-5 cursor-pointer accent-emerald-600"/></td><td className="px-1.5 py-2 align-middle"><button title={o.orderNumber} className="block w-full max-w-full whitespace-normal break-all text-left text-[10px] leading-4 font-semibold text-emerald-900 hover:underline" >{o.orderNumber}</button><p className="mt-0.5 truncate text-[9px] text-muted-foreground">{o.source==="farmer"?"Farmer":"Warehouse"}</p></td><td className="px-1.5 py-2 align-middle"><span title={o.customerName} className="block whitespace-normal break-words text-[11px] leading-4 font-medium text-slate-700">{o.customerName}</span></td><td className="px-1.5 py-2 align-middle"><span title={o.itemSummary} className="block whitespace-normal break-words text-[11px] leading-4 text-slate-700">{o.itemSummary}</span></td><td className="px-2 py-2 align-middle whitespace-normal text-[11px] font-semibold text-slate-800">{o.quantitySummary}</td><td className="px-1.5 py-2 align-middle"><span className={"inline-flex max-w-full whitespace-normal rounded-md border px-1.5 py-1 text-[9px] font-semibold leading-3 "+(o.route==="nearby"||o.route==="same_district"?"border-emerald-200 bg-emerald-50 text-emerald-800":o.route==="inter_district"||o.route==="multi_warehouse"?"border-violet-200 bg-violet-50 text-violet-800":"border-amber-200 bg-amber-50 text-amber-800")}>{({nearby:"Nearby Delivery",same_district:"Same-District Delivery",inter_district:"Inter-District Transfer",multi_warehouse:"Multi-Warehouse",route_review:"Route Review",needs_location:"Location Needed"} as Record<RouteKey,string>)[o.route]}</span></td><td className="px-1.5 py-2 align-middle"><span className={"inline-flex max-w-full whitespace-normal rounded-md border px-1.5 py-1 text-[9px] font-semibold leading-3 "+(o.stage==="In Transfer"?"border-blue-200 bg-blue-50 text-blue-800":o.stage==="Delivered"?"border-emerald-200 bg-emerald-50 text-emerald-800":o.stage==="To Dispatch"?"border-indigo-200 bg-indigo-50 text-indigo-800":o.stage==="To Receive"?"border-slate-200 bg-slate-50 text-slate-700":"border-emerald-200 bg-emerald-50 text-emerald-800")}>{o.dispatchStatus}</span></td></tr>})}</tbody></table></div>}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground"><span>{selectedDispatchOrders.length} order(s) selected</span><span>{filtered.length} order(s) shown</span></div>
      </CardContent></Card>

      <Card className="min-w-0 overflow-hidden border-emerald-200 shadow-sm xl:sticky xl:top-20 xl:min-h-[680px]">
        <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-emerald-800 to-emerald-700 px-4 py-5 text-white">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-xl bg-white/15 p-2.5"><Truck className="h-6 w-6"/></div>
            <div className="min-w-0">
              <h2 className="text-xl font-bold leading-tight">Operations</h2>
              <p className="mt-1 text-xs text-emerald-50">Process selected orders for dispatch</p>
            </div>
          </div>
          <Badge className="shrink-0 border-white/20 bg-white px-3 py-1.5 text-sm font-semibold text-emerald-900">{selectedDispatchOrders.length} Selected</Badge>
        </div>
        <CardContent className="space-y-4 p-4">
        {selectedDispatchOrders.length>1&&<div className="space-y-4">
          <section className="overflow-hidden rounded-xl border border-emerald-100 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-100 bg-emerald-50/80 px-3 py-3">
              <div className="flex items-center gap-2"><h3 className="text-sm font-bold text-emerald-950">Selected Orders</h3><Badge className="bg-emerald-700 text-white">{selectedDispatchOrders.length}</Badge></div>
              <div className="flex flex-wrap items-center gap-1">
                <Button size="sm" variant="outline" className="h-8 border-emerald-300 bg-white px-2 text-[11px]" onClick={selectAllEligibleOrders} disabled={!allEligibleDispatchOrders.length}><CheckCircle2 className="mr-1 h-3.5 w-3.5"/>Select all ready ({allEligibleDispatchOrders.length})</Button>
                <Button size="sm" variant="ghost" className="h-8 px-2 text-[11px] text-rose-700 hover:bg-rose-50" onClick={clearSelectedOrders}><RefreshCw className="mr-1 h-3.5 w-3.5"/>Clear selection</Button>
              </div>
            </div>
            <div className="max-h-[260px] divide-y divide-slate-100 overflow-y-auto">
              {selectedDispatchOrders.map((o:any)=><div key={o.source+":"+o.id} className="space-y-2 px-3 py-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <div className="mt-0.5 rounded-lg bg-slate-100 p-2 text-slate-600"><Package className="h-4 w-4"/></div>
                  <div className="min-w-0 flex-1">
                    <p className="break-all text-xs font-bold text-slate-900">{o.orderNumber}</p>
                    <p className="mt-0.5 text-[11px] leading-4 text-slate-600">{o.source==="farmer"?"Farmer":"Warehouse"} · {o.itemSummary} · {o.quantitySummary}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge className={o.dispatchStatus==="Ready for Dispatch"?"border border-emerald-200 bg-emerald-50 text-[10px] text-emerald-800":"border border-amber-200 bg-amber-50 text-[10px] text-amber-800"}>{o.dispatchStatus}</Badge>
                    <button type="button" className="text-[10px] font-semibold text-rose-600 hover:underline" onClick={()=>setSelectedOrders(v=>({...v,[o.source+":"+o.id]:false}))}>Remove</button>
                  </div>
                </div>
                {o.source==="farmer"&&o.route==="nearby"&&!o.deliveryPartnerId&&<select aria-label={"Delivery partner for "+o.orderNumber} className="ml-10 h-9 w-[calc(100%-2.5rem)] rounded-lg border border-slate-200 bg-white px-2 text-xs" value={partnerByOrder[o.id]||""} onChange={e=>setPartnerByOrder(v=>({...v,[o.id]:e.target.value}))}><option value="">Select delivery partner</option>{teams.map((t:any)=><option key={t.id} value={t.id}>{t.name} · {t.vehicle} · {t.capacity} kg</option>)}</select>}
                {o.source==="warehouse"&&o.route==="same_district"&&(()=>{const rec=getRecommendedHub(o);const chosen=getSelectedHubId(o);return <div className="ml-10 w-[calc(100%-2.5rem)] space-y-1"><select aria-label={"Local hub for "+o.orderNumber} className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs" value={chosen} onChange={e=>setHubByOrder(v=>({...v,[o.id]:e.target.value}))}><option value="">{rec?"Choose another local hub":"No matching hub — select manually"}</option>{hubs.filter((h:any)=>norm(h.status)==="active"&&h.deletedAt==null).map((h:any)=>{const d=geoDistanceKm(orderDestinationPoint(o),h.location||h.coordinates);return <option key={String(h.id||h._id)} value={String(h.id||h._id)}>{h.name||h.warehouseName} · {h.district||"District unavailable"}{d!==null?" · "+d.toFixed(1)+" km":""}</option>})}</select>{rec&&<p className="text-[10px] text-emerald-700">Suggested: {rec.name||rec.warehouseName}{rec._recommendationSource==="distance"&&rec._recommendedDistanceKm!==null?" · "+rec._recommendedDistanceKm.toFixed(1)+" km away":" · "+(rec.district||"Matching district")}</p>}</div>})()}
              </div>)}
            </div>
          </section>

          {(()=>{const routes=[...new Set(selectedDispatchOrders.map((o:any)=>o.route))];const stages=[...new Set(selectedDispatchOrders.map((o:any)=>o.dispatchStatus))];const routeLabel=routes.length===1?(ROUTES.find(r=>r.key===routes[0])?.label||"Route"): "Multiple routes";const statusLabel=stages.length===1?stages[0]:"Mixed statuses";const next=routes.length!==1?"Process orders through their individual route workflows":routes[0]==="nearby"?"Assign delivery partner and dispatch":routes[0]==="same_district"?"Continue through the local-hub route":routes[0]==="inter_district"?"Dispatch to destination warehouse":routes[0]==="multi_warehouse"?"Complete warehouse consolidation":"Review route prerequisites";return <div className="grid grid-cols-1 gap-2 rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="text-slate-600"><Route className="mr-1.5 inline h-4 w-4 text-emerald-700"/>Selected route groups</span><span className="font-semibold text-slate-900">{routeLabel}</span></div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{routes.map((route:any)=>{const count=selectedDispatchOrders.filter((o:any)=>o.route===route).length;const label=ROUTES.find(r=>r.key===route)?.label||"Other route";return <div key={route} className="rounded-lg border border-emerald-100 bg-white px-2.5 py-2"><p className="text-[10px] leading-4 text-slate-600">{label}</p><p className="mt-0.5 text-sm font-bold text-slate-900">{count} order{count===1?"":"s"}</p></div>;})}</div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-emerald-100 pt-2 text-xs"><span className="text-slate-600"><CheckCircle2 className="mr-1.5 inline h-4 w-4 text-emerald-700"/>Current status</span><span className="font-semibold text-slate-900">{statusLabel}</span></div>
            <div className="border-t border-emerald-100 pt-2"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Next operation</p><p className="mt-1 text-sm font-semibold text-slate-900">{next}</p><p className="mt-1 text-[11px] leading-4 text-slate-600">Each selected order is processed using its own route and workflow. Orders that need location, route or readiness corrections are reported separately.</p></div>
          </div>;})()}

          <Button size="lg" className="h-12 w-full bg-emerald-700 text-sm font-bold text-white shadow-sm hover:bg-emerald-800" disabled={!!busy||!selectedDispatchOrders.length} onClick={()=>{if(selectedDispatchOrders.length&&selectedDispatchOrders.every((o:any)=>o.source==="farmer"&&o.route==="inter_district"))setTransferPreparationOpen(true);else bulkProcessSelected();}}><Truck className="mr-2 h-5 w-5"/>{selectedDispatchOrders.length&&selectedDispatchOrders.every((o:any)=>o.source==="farmer"&&o.route==="inter_district")?"Process "+selectedDispatchOrders.length+" Selected Orders":"Process "+selectedDispatchOrders.length+" Selected Orders"}<ArrowRight className="ml-2 h-4 w-4"/></Button>
          {transferPreparationOpen&&<div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-3 sm:p-6"><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-200 bg-emerald-50 px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Transfer preparation</p><h3 className="mt-1 text-lg font-bold text-slate-950">Review orders &amp; assign pickup team</h3><p className="mt-1 text-xs text-slate-600">{selectedInterDistrictFarmerOrders.length===1?"1 inter-district order · 1 transfer group":transferPreparationGroups.length+" transfer group(s) · "+selectedInterDistrictFarmerOrders.length+" orders"}</p></div><Button size="sm" variant="outline" onClick={()=>setTransferPreparationOpen(false)}>Close</Button></div><div className="space-y-4 p-5"><div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-xs leading-5 text-blue-900">Orders are grouped by destination warehouse. Assigning a team prepares the transfer only; it will not dispatch the shipment. Route planning and dispatch will be confirmed as the next steps.</div>{transferPreparationGroups.map((group:any)=>{const teamId=transferTeamByGroup[group.key]||"";const eligibleTeams=teams.filter((team:any)=>Number(team.capacity||0)>=group.quantity);return <section key={group.key} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="text-sm font-bold text-slate-900">{group.name}</h4><p className="mt-1 text-xs text-slate-600">{group.items.length} order(s) · {group.quantity.toLocaleString()} kg</p></div><Badge className="border-0 bg-emerald-100 text-emerald-800">Destination group</Badge></div><div className="mt-3 space-y-2">{group.items.map((o:any)=><div key={o.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs"><div className="min-w-0"><p className="font-semibold text-slate-800">{o.orderNumber}</p><p className="truncate text-slate-500">{o.customerName} · {o.district}</p></div><span className="shrink-0 font-semibold text-slate-700">{o.quantitySummary}</span></div>)}</div><div className="mt-3"><label className="mb-1.5 block text-xs font-semibold text-slate-700">Assign transfer pickup team</label><select aria-label={"Transfer pickup team for "+group.name} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs" value={teamId} onChange={e=>setTransferTeamByGroup(v=>({...v,[group.key]:e.target.value}))}><option value="">Select approved team with capacity</option>{eligibleTeams.map((team:any)=><option key={team.id} value={team.id}>{team.name} · {team.vehicle} · Capacity {team.capacity} kg</option>)}</select><p className="mt-1 text-[10px] text-slate-500">Required capacity: {group.quantity} kg. Teams below this capacity are hidden.</p>{!eligibleTeams.length&&<p className="mt-2 text-xs text-amber-700">No approved team has sufficient capacity for this group.</p>}</div></section>;})}<div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end"><Button variant="outline" onClick={()=>setTransferPreparationOpen(false)}>Cancel</Button><Button className="bg-emerald-700 text-white hover:bg-emerald-800" disabled={!!busy||transferPreparationGroups.some((g:any)=>!transferTeamByGroup[g.key]||!teams.some((t:any)=>t.id===transferTeamByGroup[g.key]&&Number(t.capacity||0)>=g.quantity))} onClick={assignSelectedTransferTeams}>{busy==="assign-transfer-groups"?"Assigning teams…":"Confirm & Assign Pickup Team"}</Button></div></div></div></div>}
          <div className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-[11px] leading-4 text-slate-600"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700"/>Each order is validated individually. Orders needing attention are reported without stopping eligible orders.</div>
          {selectedDispatchOrders.some((o:any)=>!isBulkEligible(o))&&<div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-4 text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0"/>Review required orders before processing. Orders with missing route details, receipt confirmation or required assignments will be flagged.</div>}
        </div>}
        {selected&&selectedDispatchOrders.length===1&&<div id="dispatch-order-details" className="overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-emerald-100 bg-emerald-50/80 px-3 py-3"><div className="flex min-w-0 items-center gap-2"><span className="rounded-lg bg-emerald-100 p-2 text-emerald-700"><Package className="h-4 w-4"/></span><div className="min-w-0"><p className="text-sm font-bold text-emerald-950">Selected Order</p><p className="text-[11px] text-emerald-800">1 order selected for processing</p></div></div><div className="flex shrink-0 items-center gap-2"><Badge className="bg-emerald-700 text-white">1 Selected</Badge><Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-slate-600" onClick={clearSelectedOrders}>Clear</Button></div></div>
          <div className="space-y-3 p-3">
          <div className="flex items-center justify-between gap-2"><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Next operation</p><p className="mt-0.5 truncate text-sm font-bold text-slate-900">{selected.orderNumber}</p></div><Badge className="shrink-0 border-0 bg-emerald-100 text-emerald-800">Route: {selected.route==="nearby"?"Nearby Direct Delivery":selected.route==="same_district"?"Same-District Delivery":selected.route==="inter_district"?"Inter-District Transfer":selected.route==="multi_warehouse"?"Multi-Warehouse":selected.route==="route_review"?"Route Review":"Location Needed"}</Badge></div><div className="mb-3 flex items-center justify-between"><span className="text-[11px] text-slate-500">{selected.source==="farmer"?"Farmer order":"Warehouse order"}</span><Badge variant="outline">{selected.dispatchStatus}</Badge></div>
          <div className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600"><span className="font-semibold text-slate-800">{selected.customerName}</span> · {selected.district} · {selected.itemSummary} · {selected.quantitySummary}</div>
           <div className="mb-3 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700"/><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Customer delivery address</p><p className="mt-0.5 break-words text-xs leading-5 text-slate-800">{getDeliveryAddress(selected)||"Delivery address not provided"}</p></div></div>
          {selected.route==="inter_district"&&<div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3"><div className="flex items-center justify-between gap-2"><p className="text-[10px] font-bold uppercase tracking-wide text-blue-900">Destination warehouse</p><Badge className="border-0 bg-blue-100 text-blue-800">Auto-assigned by district</Badge></div>{selected.destinationWarehouseName||selected.eventDestinationWarehouseName?<><p className="mt-1 text-sm font-bold text-slate-900">{selected.destinationWarehouseName||selected.eventDestinationWarehouseName}</p><p className="mt-0.5 text-[11px] text-slate-600">Serving {selected.destinationWarehouseDistrict||selected.destinationDistrict||selected.deliveryDistrict||selected.district}</p>{selected.destinationWarehouseRegionalFallback&&<p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-[10px] text-amber-800">A previous regional fallback was saved. Continuing will re-check the active warehouse for the exact delivery district.</p>}</>:<p className="mt-1 text-[11px] leading-4 text-slate-600">The system will automatically find the active warehouse serving the customer's delivery district when you continue. It will not select an unrelated regional warehouse.</p>}</div>}
          {(()=>{const transferState=norm(selected.destinationTransferStatus||selected.transferStatus||selected.warehouseTransferStatus||selected.currentStatus);const delivered=selected.dispatchStatus==="Delivered"||["delivered","completed"].includes(transferState);const inTransit=selected.dispatchStatus==="Dispatched / In Transit"||["in_transit","dispatched","assigned"].includes(transferState);const received=["received","received_at_destination","arrived_at_destination","destination_warehouse_received"].includes(transferState);const outForDelivery=["out_for_delivery","delivery_in_progress","dispatched_to_customer"].includes(transferState);const assigned=Boolean(selected.deliveryPartnerId||selected.deliveryJobId||selected.destinationTransferTeamId||selected.localHubTransferAssigned)||["assigned","in_transit","arrived_at_destination","received_at_destination"].includes(norm(selected.destinationTransferStatus||selected.localHubTransferStatus));const dispatched=["Dispatched / In Transit","Delivered"].includes(selected.dispatchStatus);const current=delivered?3:dispatched?2:assigned?1:0;const labels=["Assign Partner","Plan Route","Dispatch","Deliver"];const description=selected.route==="nearby"?"Assign a delivery partner for direct customer delivery within 15 km.":selected.route==="same_district"?"Move the order through the configured same-district local-hub route.":selected.route==="inter_district"?"Transfer the order to the warehouse serving the destination district, then hand it over for final delivery.":selected.route==="multi_warehouse"?"Receive all source portions, complete consolidation and prepare the combined order for delivery.":selected.route==="route_review"?"Review route configuration and verify delivery eligibility before dispatch.":"Complete the missing source or customer location details before routing.";const heading=selected.route==="nearby"?"Nearby Direct Delivery Process":selected.route==="same_district"?"Same-District Delivery Process":selected.route==="inter_district"?"Inter-District Transfer Process":selected.route==="multi_warehouse"?"Multi-Warehouse Consolidation Process":selected.route==="route_review"?"Route Review Required":"Location Verification Required";return <div className="mb-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-2 py-3">
              <div className="relative">
                <div className="absolute left-[12.5%] right-[12.5%] top-4 h-0.5 bg-slate-200"><div className="h-full bg-emerald-600 transition-all" style={{width:(current/3*100)+"%"}}/></div>
                <div className="relative z-10 grid grid-cols-4 gap-1">
                  {labels.map((label,i)=><div key={label} className="flex min-w-0 flex-col items-center text-center">
                    <div className={"flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold shadow-sm "+(i<current?"border-emerald-700 bg-emerald-700 text-white":i===current?"border-emerald-700 bg-white text-emerald-700 ring-4 ring-emerald-100":"border-slate-300 bg-white text-slate-400")}>{i<current?<CheckCircle2 className="h-4 w-4"/>:i+1}</div>
                    <p className="mt-2 max-w-full break-words text-[9px] font-semibold leading-3 text-slate-600 sm:text-[10px]">{label}</p>
                  </div>)}
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3"><div className="flex items-start gap-2"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700"><Truck className="h-5 w-5"/></span><div className="min-w-0"><p className="text-sm font-bold text-slate-900">{heading}</p><p className="mt-0.5 text-xs leading-4 text-slate-600">{description}</p></div></div></div>
          </div>;})()}
          <div className="space-y-2">
            {selected.source==="farmer"&&selected.route==="inter_district"&&<>
              {selected.currentWarehouseRole!=="destination"&&!["in_transit","arrived_at_destination","received_at_destination","completed","delivered"].includes(norm(selected.destinationTransferStatus))&&!["destination_warehouse_in_transit","destination_warehouse_received","destination_warehouse_arrived_pending_receipt"].includes(norm(selected.transferStatus))&&!isBulkEligible(selected)&&<Button size="sm" className="mt-2 h-10 w-full justify-center bg-emerald-700 font-semibold text-white shadow-sm hover:bg-emerald-800" disabled={!!busy} onClick={()=>act(selected,"destination")}><Truck className="mr-2 h-4 w-4"/>{busy===selected.id+"destination"?"Processing transfer…":selected.destinationWarehouseId?"Dispatch to destination warehouse":"Assign destination & create transfer manifest"}<ArrowRight className="ml-2 h-4 w-4"/></Button>}
              {selected.currentWarehouseRole==="source"&&selected.destinationWarehouseId&&["awaiting_team_assignment","assigned"].includes(norm(selected.destinationTransferStatus))&&norm(selected.destinationTransferStatus)!=="assigned"&&<div className="mt-2 space-y-2"><select aria-label="Inter-district transfer team" className="h-9 w-full rounded-md border bg-white px-2 text-xs" value={partnerByOrder[selected.id]||""} onChange={e=>setPartnerByOrder(v=>({...v,[selected.id]:e.target.value}))}><option value="">Select approved transfer team</option>{teams.map((t:any)=><option key={t.id} value={t.id}>{t.name} · {t.vehicle} · {t.capacity} kg</option>)}</select><Button size="sm" className="bg-emerald-700 text-white" disabled={!!busy||!partnerByOrder[selected.id]||!teamCanCarry(teams.find((t:any)=>t.id===partnerByOrder[selected.id]),selected)} onClick={()=>act(selected,"assign-transfer")}>Assign transfer team</Button></div>}
              {selected.currentWarehouseRole==="destination"&&(norm(selected.destinationTransferStatus)==="arrived_at_destination"||norm(selected.transferStatus)==="destination_warehouse_arrived_pending_receipt")&&<Button size="sm" className="mt-2 bg-emerald-700 text-white" disabled={!!busy} onClick={()=>act(selected,"destination-receive")}>Confirm destination warehouse receipt</Button>}
              {selected.currentWarehouseRole==="destination"&&(norm(selected.destinationTransferStatus)==="received_at_destination"||["destination_warehouse_received","hub_handoff_pending","hub_arrived_pending_receipt","local_hub_ready"].includes(norm(selected.transferStatus)))&&!["in_transit","assigned","arrived_at_hub","received"].includes(norm(selected.localHubTransferStatus))&&<Button size="sm" className="mt-2 bg-emerald-700 text-white" disabled={!!busy} onClick={()=>act(selected,"hub-handoff")}>Send complete order to local hub</Button>}
              {selected.currentWarehouseRole==="destination"&&["in_transit","assigned"].includes(norm(selected.localHubTransferStatus))&&!selected.localHubTransferAssigned&&<div className="mt-2 space-y-2"><select aria-label="Local hub pickup team" className="h-9 w-full rounded-md border bg-white px-2 text-xs" value={partnerByOrder[selected.id]||""} onChange={e=>setPartnerByOrder(v=>({...v,[selected.id]:e.target.value}))}><option value="">Select local-hub pickup team</option>{teams.map((t:any)=><option key={t.id} value={t.id}>{t.name} · {t.vehicle} · {t.capacity} kg</option>)}</select><Button size="sm" className="bg-emerald-700 text-white" disabled={!!busy||!partnerByOrder[selected.id]||!teamCanCarry(teams.find((t:any)=>t.id===partnerByOrder[selected.id]),selected)} onClick={()=>act(selected,"assign-hub-team")}>Assign local-hub pickup team</Button></div>}
              {selected.currentWarehouseRole==="destination"&&norm(selected.localHubTransferStatus)==="arrived_at_hub"&&<Button size="sm" className="mt-2 bg-emerald-700 text-white" disabled={!!busy} onClick={()=>act(selected,"hub-receive")}>Confirm local hub receipt</Button>}
              {selected.currentWarehouseRole==="destination"&&(norm(selected.localHubTransferStatus)==="received"||norm(selected.transferStatus)==="local_hub_ready")&&<p className="mt-2 rounded-lg bg-white p-2 text-[11px] font-medium text-emerald-800">Local hub receipt confirmed. Final-mile delivery job is available to the delivery partner.</p>}
              {selected.currentWarehouseRole!=="source"&&selected.currentWarehouseRole!=="destination"&&<p className="mt-2 rounded-lg bg-white p-2 text-[11px] text-amber-800">This stage belongs to the source or destination warehouse, not the current warehouse role.</p>}
            </>}
            {selected.source==="farmer"&&selected.route==="same_district"&&<>
              {selected.currentWarehouseRole==="source"&&!["hub_handoff_pending","hub_arrived_pending_receipt","local_hub_ready"].includes(norm(selected.transferStatus))&&!isBulkEligible(selected)&&<Button size="sm" className="mt-2 bg-emerald-700 text-white" disabled={!!busy||!selected.physicalReceiptConfirmed} onClick={()=>act(selected,"same")}>Create local-hub transfer</Button>}
              {selected.currentWarehouseRole==="source"&&norm(selected.transferStatus)==="hub_handoff_pending"&&!selected.localHubTransferAssigned&&<div className="mt-2 space-y-2"><select aria-label="Local hub pickup team" className="h-9 w-full rounded-md border bg-white px-2 text-xs" value={partnerByOrder[selected.id]||""} onChange={e=>setPartnerByOrder(v=>({...v,[selected.id]:e.target.value}))}><option value="">Select approved pickup team</option>{teams.map((t:any)=><option key={t.id} value={t.id}>{t.name} · {t.vehicle} · {t.capacity} kg</option>)}</select><Button size="sm" className="bg-emerald-700 text-white" disabled={!!busy||!partnerByOrder[selected.id]||!teamCanCarry(teams.find((t:any)=>t.id===partnerByOrder[selected.id]),selected)} onClick={()=>act(selected,"assign-hub-team")}>Assign local-hub pickup team</Button></div>}
              {["assigned","in_transit"].includes(norm(selected.localHubTransferStatus))&&<p className="mt-2 rounded-lg bg-white p-2 text-[11px] text-slate-700">Pickup team assigned. The partner must record arrival before the hub can confirm receipt.</p>}
              {norm(selected.localHubTransferStatus)==="arrived_at_hub"&&<Button size="sm" className="mt-2 bg-emerald-700 text-white" disabled={!!busy} onClick={()=>act(selected,"hub-receive")}>Confirm local hub receipt</Button>}
              {norm(selected.localHubTransferStatus)==="received"&&<p className="mt-2 rounded-lg bg-white p-2 text-[11px] font-medium text-emerald-800">Hub receipt confirmed. Final delivery job is available.</p>}
            </>}
            {selected.source==="farmer"&&selected.route==="nearby"&&selected.physicalReceiptConfirmed&&!selected.deliveryPartnerId&&<div className="mt-2 space-y-2"><select aria-label="Nearby final delivery partner" className="h-9 w-full rounded-md border bg-white px-2 text-xs" value={partnerByOrder[selected.id]||""} onChange={e=>setPartnerByOrder(v=>({...v,[selected.id]:e.target.value}))}><option value="">Select approved delivery partner</option>{teams.map((t:any)=><option key={t.id} value={t.id}>{t.name} · {t.vehicle} · {t.capacity} kg</option>)}</select>{!isBulkEligible(selected)&&<Button size="sm" className="bg-emerald-700 text-white" disabled={!!busy||!partnerByOrder[selected.id]||!teamCanCarry(teams.find((t:any)=>t.id===partnerByOrder[selected.id]),selected)} onClick={()=>act(selected,"nearby")}>Assign final delivery partner</Button>}</div>}
            {selected.source==="farmer"&&selected.route==="multi_warehouse"&&<>
              {selected.canDispatchToConsolidation&&selected.physicalReceiptConfirmed&&<Button size="sm" className="mt-2 bg-emerald-700 text-white" disabled={!!busy} onClick={()=>act(selected,"consolidation-dispatch")}>Dispatch source portion to consolidation</Button>}
              {selected.consolidation?.canReceive&&selected.isConsolidationWarehouse&&<Button size="sm" className="mt-2 bg-emerald-700 text-white" disabled={!!busy} onClick={()=>act(selected,"consolidation-receive")}>Receive all in-transit portions</Button>}
              {selected.consolidation?.canComplete&&selected.isConsolidationWarehouse&&<Button size="sm" className="mt-2 bg-emerald-700 text-white" disabled={!!busy} onClick={()=>act(selected,"consolidation-complete")}>Complete consolidation</Button>}
              {selected.consolidation?.canHandoffLocalHub&&selected.isConsolidationWarehouse&&<Button size="sm" className="mt-2 bg-emerald-700 text-white" disabled={!!busy} onClick={()=>act(selected,"consolidation-handoff")}>Send consolidated order to local hub</Button>}
              {selected.isConsolidationWarehouse&&norm(selected.transferStatus)==="hub_handoff_pending"&&!selected.localHubTransferAssigned&&<div className="mt-2 space-y-2"><select aria-label="Consolidation local hub pickup team" className="h-9 w-full rounded-md border bg-white px-2 text-xs" value={partnerByOrder[selected.id]||""} onChange={e=>setPartnerByOrder(v=>({...v,[selected.id]:e.target.value}))}><option value="">Select local-hub pickup team</option>{teams.map((t:any)=><option key={t.id} value={t.id}>{t.name} · {t.vehicle} · {t.capacity} kg</option>)}</select><Button size="sm" className="bg-emerald-700 text-white" disabled={!!busy||!partnerByOrder[selected.id]||!teamCanCarry(teams.find((t:any)=>t.id===partnerByOrder[selected.id]),selected)} onClick={()=>act(selected,"assign-hub-team")}>Assign local-hub pickup team</Button></div>}
              {norm(selected.localHubTransferStatus)==="arrived_at_hub"&&<Button size="sm" className="mt-2 bg-emerald-700 text-white" disabled={!!busy} onClick={()=>act(selected,"hub-receive")}>Confirm local hub receipt</Button>}
            </>}
            {selected.source==="warehouse"&&selected.route==="same_district"&&(()=>{const recommendation=getRecommendedHub(selected);const chosen=getSelectedHubId(selected);return <div className="mt-2 space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-800">Destination local hub</p>{recommendation&&<Badge className="border-0 bg-emerald-100 text-emerald-800">Recommended</Badge>}</div>{recommendation?<div className="rounded-lg border border-emerald-100 bg-white px-3 py-2"><p className="text-sm font-semibold text-slate-900">{recommendation.name||recommendation.warehouseName||"Local Hub"}</p><p className="mt-0.5 text-[11px] text-slate-600">{recommendation.address?.address||recommendation.address||recommendation.district||"Address not provided"}</p><p className="mt-1 text-[10px] font-medium text-emerald-700">{recommendation._recommendationSource==="distance"&&recommendation._recommendedDistanceKm!==null?"Nearest by delivery coordinates · "+recommendation._recommendedDistanceKm.toFixed(1)+" km":recommendation._recommendationSource==="service-area"?"Matched delivery locality coverage":"Matched delivery district"}</p></div>:<div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">{hubsQuery.isLoading?"Finding an active local hub…":"No active local hub matches this delivery address. Check the customer's address and the hub's service-area coverage."}</div>}<select aria-label="Warehouse local hub" className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs" value={chosen} onChange={e=>setHubByOrder(v=>({...v,[selected.id]:e.target.value}))}><option value="">Choose another active local hub</option>{hubs.filter((h:any)=>norm(h.status)==="active"&&h.deletedAt==null).map((h:any)=>{const d=geoDistanceKm(orderDestinationPoint(selected),h.location||h.coordinates);return <option key={String(h.id||h._id)} value={String(h.id||h._id)}>{h.name||h.warehouseName} · {h.district||"District unavailable"}{d!==null?" · "+d.toFixed(1)+" km":""}</option>})}</select>{!isBulkEligible(selected)&&<Button size="sm" className="h-10 w-full bg-emerald-700 font-semibold text-white hover:bg-emerald-800" disabled={!!busy||!chosen} onClick={()=>act(selected,"same")}><Truck className="mr-2 h-4 w-4"/>Dispatch to {recommendation?.name||"selected local hub"}<ArrowRight className="ml-2 h-4 w-4"/></Button>}</div>})()}
            {selected.source==="warehouse"&&selected.route==="nearby"&&!isBulkEligible(selected)&&<Button size="sm" className="mt-2 bg-emerald-700 text-white" disabled={!!busy} onClick={()=>act(selected,"nearby")}>Verify packing &amp; dispatch to delivery</Button>}
            {selected.source==="warehouse"&&selected.route==="inter_district"&&selected.dispatchStatus==="Dispatched / In Transit"&&<div className="mt-2 rounded-xl border border-blue-200 bg-blue-50 p-3"><p className="text-xs font-semibold text-blue-900">Transfer dispatched – awaiting destination receipt</p><p className="mt-1 text-[11px] leading-4 text-blue-800">Do not create another transfer. The destination warehouse must confirm the received quantity and condition before final delivery assignment.</p></div>}
            {isBulkEligible(selected)&&<Button size="lg" className="mt-2 h-11 w-full justify-center bg-emerald-700 text-sm font-bold text-white shadow-sm hover:bg-emerald-800" disabled={!!busy||(selected.route==="nearby"&&selected.source==="farmer"&&!partnerByOrder[selected.id])||(selected.route==="same_district"&&selected.source==="warehouse"&&!getSelectedHubId(selected))} onClick={()=>{if(selected.source==="farmer"&&selected.route==="inter_district"){setSelectedOrders({["farmer:"+selected.id]:true});setTransferTeamByGroup({});setTransferPreparationOpen(true);}else act(selected,selected.route==="nearby"?"nearby":selected.route==="same_district"?"same":"destination");}}><Truck className="mr-2 h-4 w-4"/>{busy?"Processing order…":selected.route==="nearby"?(selected.source==="farmer"?"Assign partner & continue":"Verify packing & dispatch"):selected.route==="same_district"?(selected.source==="farmer"?"Create local-hub transfer":"Dispatch to local hub"):selected.source==="warehouse"?"Assign destination & transfer team, then dispatch" :"Prepare transfer & assign pickup team"}<ArrowRight className="ml-2 h-4 w-4"/></Button>}
            {selected.route==="route_review"&&<Button asChild size="sm" variant="outline" className="mt-2"><Link href="/warehouse/farmer-fulfillment">Open route review workspace</Link></Button>}
            {selected.route==="needs_location"&&<Button asChild size="sm" variant="outline" className="mt-2"><Link href="/warehouse/farmer-fulfillment">Open location and route data</Link></Button>}
          </div>
          </div>
        </div>}
        {selectedDispatchOrders.length===0&&<div className="flex min-h-[590px] flex-col justify-center gap-8 px-1 py-7">
          <div className="mx-auto w-full max-w-sm text-center">
            <div className="relative mx-auto mb-5 flex h-40 w-40 items-center justify-center rounded-full bg-emerald-50">
              <div className="relative flex h-28 w-24 flex-col items-center justify-center gap-2 rounded-2xl border-[3px] border-emerald-700 bg-white px-3 shadow-sm">
                <div className="absolute -top-2.5 h-4 w-12 rounded-md border-2 border-emerald-700 bg-emerald-100"/>
                <div className="flex w-full items-center gap-1.5"><CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600"/><span className="h-1.5 flex-1 rounded-full bg-emerald-200"/></div>
                <div className="flex w-full items-center gap-1.5"><CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600"/><span className="h-1.5 flex-1 rounded-full bg-emerald-200"/></div>
                <div className="flex w-full items-center gap-1.5"><span className="h-4 w-4 shrink-0 rounded-full border-2 border-emerald-200"/><span className="h-1.5 flex-1 rounded-full bg-slate-100"/></div>
              </div>
              <div className="absolute bottom-7 right-5 flex h-12 w-12 items-center justify-center rounded-full border-4 border-emerald-50 bg-emerald-600 text-white shadow-md"><ArrowRight className="h-6 w-6"/></div>
            </div>
            <h3 className="text-2xl font-bold tracking-tight text-slate-900">No Orders Selected</h3>
            <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-slate-600">Select one or more orders from the list to view available operations and process dispatch.</p>
          </div>
          <section className="mx-auto w-full max-w-lg overflow-hidden rounded-xl border border-emerald-200 bg-white">
            <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50 px-4 py-3.5"><CheckCircle2 className="h-5 w-5 text-emerald-700"/><h3 className="text-sm font-bold text-emerald-900">Available Operations (after selection)</h3></div>
            <div className="space-y-3.5 px-4 py-4">
              {["Assign delivery partner","Plan and confirm route","Dispatch selected orders","Transfer to destination warehouse (if required)"].map((item)=><div key={item} className="flex items-center gap-3 text-sm text-slate-700"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><CheckCircle2 className="h-4 w-4"/></span><span>{item}</span></div>)}
            </div>
          </section>
        </div>}
      </CardContent></Card>
    </div>
    <p className="text-xs text-muted-foreground">The original Farmer Fulfillment and Outgoing / Dispatch pages remain available as fallback. This workspace exposes the same order-specific transfer, local-hub and consolidation operations while retaining backend authorization and validation.</p>
  </div>;
}
