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
function normalizeFarmer(x:any) {
  const category=classify(x,"farmer");
  return {...x,id:String(x.id||x.orderId||x.orderNumber),orderId:String(x.orderId||x.id||""),orderNumber:x.orderNumber||x.orderId||x.id||"Farmer order",source:"farmer" as Source,route:category,stage:farmerStage(x),destinationGroup:destinationName(x),customerName:x.customerName||x.customer?.name||x.businessName||"Customer details unavailable",district:x.destinationDistrict||x.deliveryDistrict||x.customerDistrict||"Location unavailable",itemSummary:x.items?.map((i:any)=>i.productName||i.name).filter(Boolean).join(", ")||x.productName||"Order items",quantitySummary:x.totalQuantity??x.quantity??"—",currentStatus:x.transferStatus||x.status||x.stage||"Awaiting receipt"};
}
function normalizeWarehouse(x:any) {
  const category=classify(x,"warehouse");
  return {...x,id:String(x.id||x.orderId||x.orderNumber),orderId:String(x.orderId||""),orderNumber:x.orderNumber||x.orderId||"Warehouse order",source:"warehouse" as Source,route:category,stage:warehouseStage(x),destinationGroup:destinationName(x),customerName:x.customerName||x.customer?.name||"Customer details unavailable",district:x.destinationDistrict||x.deliveryDistrict||x.customerDistrict||"Location unavailable",itemSummary:x.items?.map((i:any)=>i.productName||i.name).filter(Boolean).join(", ")||x.productName||"Order items",quantitySummary:x.totalQuantity??x.quantity??"—",currentStatus:x.status||"Ready for route review"};
}

export default function FulfillmentDispatchPage() {
  const [search,setSearch]=useState("");
  const [activeRoute,setActiveRoute]=useState<RouteKey|"all">("all");
  const [activeStage,setActiveStage]=useState("All");
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
    return orders.filter((o:any)=>(activeRoute==="all"||o.route===activeRoute)&&(activeStage==="All"||o.stage===activeStage)&&(!q||[o.orderNumber,o.orderId,o.customerName,o.district,o.destinationGroup,o.itemSummary,o.currentStatus].some(v=>String(v||"").toLowerCase().includes(q))));
  },[orders,search,activeRoute,activeStage]);
  const selected=filtered.find((o:any)=>o.source+":"+o.id===selectedKey)||filtered[0]||null;
  const routeCounts=Object.fromEntries(ROUTES.map(r=>[r.key,orders.filter((o:any)=>o.route===r.key).length])) as Record<RouteKey,number>;
  const stageNames=["To Receive","To Route","In Transfer","To Dispatch","Delivered"];
  const stageCounts=Object.fromEntries(stageNames.map(s=>[s,orders.filter((o:any)=>o.stage===s).length])) as Record<string,number>;
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
  return <div className="mx-auto w-full max-w-[1700px] space-y-4 pb-8">
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><Truck className="h-7 w-7"/></div><div><h1 className="text-2xl font-bold tracking-tight text-slate-950">Fulfillment &amp; Dispatch</h1><p className="text-sm text-slate-600">Manage farmer fulfillment, warehouse transfers and customer deliveries.</p></div></div><div className="flex gap-2"><Button variant="outline" onClick={()=>refresh()} disabled={farmerQuery.isFetching||outgoingQuery.isFetching}><RefreshCw className="mr-2 h-4 w-4"/>Refresh</Button><Button asChild><Link href="/warehouse/consolidation">Consolidation workspace <ArrowRight className="ml-2 h-4 w-4"/></Link></Button></div></div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={()=>{const first=orders.find((o:any)=>o.source==="farmer");setSelectedKey(first?first.source+":"+first.id:"");}} className="min-w-[230px] bg-emerald-700 hover:bg-emerald-800"><Leaf className="mr-2 h-4 w-4"/>Farmer Fulfillment Workflow</Button>
        <Button variant="outline" onClick={()=>{const first=orders.find((o:any)=>o.source==="warehouse");setSelectedKey(first?first.source+":"+first.id:"");}} className="min-w-[260px]"><Warehouse className="mr-2 h-4 w-4"/>Warehouse Outgoing / Dispatch Workflow</Button>
        <Button variant="outline" className="sm:ml-auto" onClick={()=>toast("Select an order to view its route-specific steps and available actions.")}><CheckCircle2 className="mr-2 h-4 w-4"/>Workflow Guide</Button>
      </div>
    </div>

    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-9 fulfillment-summary-grid">
      <Card className="fulfillment-summary-card"><CardContent className="flex h-full min-h-[104px] items-center gap-2 p-3"><div className="rounded-full bg-emerald-50 p-2.5 text-emerald-700"><Package className="h-5 w-5"/></div><div><p className="text-xs text-slate-600">All Orders</p><p className="mt-1 text-2xl font-bold">{orders.length}</p><p className="text-[11px] text-slate-500">Both sources</p></div></CardContent></Card>
      <Card className="fulfillment-summary-card border-emerald-200 bg-emerald-50/60"><CardContent className="flex h-full min-h-[104px] items-center gap-2 p-3"><div className="rounded-full bg-emerald-100 p-2.5 text-emerald-700"><Leaf className="h-5 w-5"/></div><div><p className="text-xs text-emerald-800">Farmer Orders</p><p className="mt-1 text-2xl font-bold">{orders.filter((x:any)=>x.source==="farmer").length}</p><p className="text-[11px] text-emerald-800">Farmer-packed · {orders.length?Math.round(orders.filter((x:any)=>x.source==="farmer").length/orders.length*100):0}%</p></div></CardContent></Card>
      <Card className="fulfillment-summary-card border-blue-200 bg-blue-50/60"><CardContent className="flex h-full min-h-[104px] items-center gap-2 p-3"><div className="rounded-full bg-blue-100 p-2.5 text-blue-700"><Warehouse className="h-5 w-5"/></div><div><p className="text-xs text-blue-800">Warehouse Orders</p><p className="mt-1 text-2xl font-bold">{orders.filter((x:any)=>x.source==="warehouse").length}</p><p className="text-[11px] text-blue-800">Warehouse-packed · {orders.length?Math.round(orders.filter((x:any)=>x.source==="warehouse").length/orders.length*100):0}%</p></div></CardContent></Card>
      <Card className="fulfillment-summary-card border-emerald-200 bg-emerald-50/40"><CardContent className="flex h-full min-h-[104px] items-center gap-2 p-3"><div className="rounded-full bg-emerald-100 p-2.5 text-emerald-700"><Package className="h-5 w-5"/></div><div><p className="text-xs text-slate-600">Ready for Transfer / Delivery</p><p className="mt-1 text-2xl font-bold">{stageCounts["To Route"]||0}</p></div></CardContent></Card>
      <Card className="fulfillment-summary-card border-blue-200 bg-blue-50/50"><CardContent className="flex h-full min-h-[104px] items-center gap-2 p-3"><div className="rounded-full bg-blue-100 p-2.5 text-blue-700"><ArrowLeftRight className="h-5 w-5"/></div><div><p className="text-xs text-slate-600">Transfer in Progress</p><p className="mt-1 text-2xl font-bold">{stageCounts["In Transfer"]||0}</p></div></CardContent></Card>
      <Card className="fulfillment-summary-card border-amber-200 bg-amber-50/50"><CardContent className="flex h-full min-h-[104px] items-center gap-2 p-3"><div className="rounded-full bg-amber-100 p-2.5 text-amber-700"><Truck className="h-5 w-5"/></div><div><p className="text-xs text-slate-600">Ready for Final Delivery</p><p className="mt-1 text-2xl font-bold">{stageCounts["To Dispatch"]||0}</p></div></CardContent></Card>
      <Card className="fulfillment-summary-card border-violet-200 bg-violet-50/50"><CardContent className="flex h-full min-h-[104px] items-center gap-2 p-3"><div className="rounded-full bg-violet-100 p-2.5 text-violet-700"><Truck className="h-5 w-5"/></div><div><p className="text-xs text-slate-600">Out for Delivery</p><p className="mt-1 text-2xl font-bold">{orders.filter((o:any)=>["out_for_delivery","dispatched_to_customer","delivery_in_progress"].includes(norm(o.status||o.transferStatus))).length}</p></div></CardContent></Card>
      <Card className="fulfillment-summary-card border-green-200 bg-green-50/50"><CardContent className="flex h-full min-h-[104px] items-center gap-2 p-3"><div className="rounded-full bg-green-100 p-2.5 text-green-700"><CheckCircle2 className="h-5 w-5"/></div><div><p className="text-xs text-slate-600">Delivered</p><p className="mt-1 text-2xl font-bold">{stageCounts["Delivered"]||0}</p></div></CardContent></Card>
      <Card className="fulfillment-summary-card border-red-200 bg-red-50/50"><CardContent className="flex h-full min-h-[104px] items-center gap-2 p-3"><div className="rounded-full bg-red-100 p-2.5 text-red-700"><AlertTriangle className="h-5 w-5"/></div><div><p className="text-xs text-red-800">Needs Attention</p><p className="mt-1 text-2xl font-bold">{routeCounts.route_review+routeCounts.needs_location}</p></div></CardContent></Card>
    </div>

    <div className="grid min-w-0 items-stretch gap-4 xl:grid-cols-[minmax(245px,0.82fr)_minmax(0,1.8fr)_minmax(310px,0.98fr)] 2xl:grid-cols-[minmax(260px,0.82fr)_minmax(0,1.85fr)_minmax(330px,0.98fr)]">
      <Card className="min-w-0 overflow-hidden xl:min-h-[680px]"><CardContent className="space-y-3 p-4 xl:max-h-[760px] xl:overflow-y-auto">
        <div className="flex items-center justify-between gap-2"><div><h2 className="text-lg font-bold">Route Groups</h2><p className="text-xs text-muted-foreground">Choose a route to view its orders.</p></div><Badge variant="outline">{filtered.length} orders</Badge></div>
        <button type="button" onClick={()=>{setActiveRoute("all");setSelectedKey("");}} className={"flex w-full items-center gap-3 rounded-xl border p-3 text-left "+(activeRoute==="all"?"border-emerald-500 bg-emerald-50 ring-1 ring-emerald-100":"hover:border-emerald-300")}><span className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><Package className="h-4 w-4"/></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">All Orders</span><span className="block text-xs text-muted-foreground">All transfer and delivery orders</span></span><Badge variant="secondary">{orders.length}</Badge></button>
        {ROUTES.map(r=><button type="button" key={r.key} onClick={()=>{setActiveRoute(activeRoute===r.key?"all":r.key);setSelectedKey("");}} className={"flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors "+(activeRoute===r.key?"border-emerald-500 bg-emerald-50 ring-1 ring-emerald-100":"border-slate-200 hover:border-emerald-300 hover:bg-slate-50")}><span className="rounded-lg bg-emerald-50 p-2 text-emerald-700">{r.key==="nearby"?<Truck className="h-4 w-4"/>:r.key==="inter_district"?<ArrowLeftRight className="h-4 w-4"/>:r.key==="multi_warehouse"?<Package className="h-4 w-4"/>:<MapPin className="h-4 w-4"/>}</span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{r.label}</span><span className="mt-0.5 block text-xs text-muted-foreground">{r.description}</span></span><Badge variant="secondary">{routeCounts[r.key]}</Badge></button>)}
      </CardContent></Card>

      <Card className="min-w-0 overflow-hidden xl:min-h-[680px]"><CardContent className="space-y-3 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><h2 className="text-lg font-bold">Orders ({filtered.length})</h2>{activeRoute!=="all"&&<Badge variant="outline">{ROUTES.find(r=>r.key===activeRoute)?.label}</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">Select an order to view its route-specific operations.</p></div><div className="flex min-w-0 gap-2"><div className="relative min-w-0 flex-1 sm:w-64"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/><Input className="pl-9" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search order, customer, product..."/></div><Button size="sm" variant="outline" onClick={()=>{setSearch("");setSelectedOrders({});}}>Clear</Button></div></div>
        {filtered.length===0?<div className="rounded-xl border border-dashed p-10 text-center"><Package className="mx-auto h-9 w-9 text-muted-foreground"/><p className="mt-3 font-semibold">No orders in this route group</p><p className="text-sm text-muted-foreground">Choose another route group or clear the search.</p></div>:<div className="fulfillment-orders-table w-full rounded-xl border"><table className="w-full min-w-0 table-fixed text-left text-xs"><thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="w-8 px-1.5 py-2"><input type="checkbox" aria-label="Select all eligible farmer orders" checked={filtered.filter((o:any)=>o.source==="farmer"&&o.physicalReceiptConfirmed&&["same_district","inter_district"].includes(o.route)).length>0&&filtered.filter((o:any)=>o.source==="farmer"&&o.physicalReceiptConfirmed&&["same_district","inter_district"].includes(o.route)).every((o:any)=>selectedOrders[o.source+":"+o.id])} onChange={e=>{const eligible=filtered.filter((o:any)=>o.source==="farmer"&&o.physicalReceiptConfirmed&&["same_district","inter_district"].includes(o.route));setSelectedOrders(v=>({...v,...Object.fromEntries(eligible.map((o:any)=>[o.source+":"+o.id,e.target.checked]))}));}} className="h-4 w-4 accent-emerald-600"/></th><th className="w-[21%] px-1.5 py-2">Order ID</th><th className="w-[16%] px-1.5 py-2">Customer / Buyer</th><th className="w-[11%] px-1.5 py-2">Products</th><th className="w-[8%] px-1.5 py-2">Qty.</th><th className="w-[21%] px-1.5 py-2">Route</th><th className="w-[19%] px-1.5 py-2">Status</th></tr></thead><tbody className="divide-y">{filtered.map((o:any)=>{const key=o.source+":"+o.id;const active=selected?.source+":"+selected?.id===key;const canBulk=o.source==="farmer"&&o.physicalReceiptConfirmed&&["same_district","inter_district"].includes(o.route);return <tr key={key} className={active?"bg-emerald-50/70":"hover:bg-slate-50"}><td className="px-1.5 py-2 align-middle"><input type="checkbox" aria-label={"Select "+o.orderNumber} checked={Boolean(selectedOrders[key])} disabled={!canBulk} onChange={e=>setSelectedOrders(v=>({...v,[key]:e.target.checked}))} className="h-4 w-4 accent-emerald-600"/></td><td className="px-1.5 py-2 align-middle"><button title={o.orderNumber} className="block max-w-full truncate text-left text-[10px] font-semibold text-emerald-900 hover:underline" onClick={()=>setSelectedKey(key)}>{o.orderNumber}</button><p className="mt-0.5 truncate text-[9px] text-muted-foreground">{o.source==="farmer"?"Farmer":"Warehouse"}</p></td><td className="px-1.5 py-2 align-middle"><span title={o.customerName} className="block truncate text-[10px]">{o.customerName}</span></td><td className="px-1.5 py-2 align-middle"><span title={o.itemSummary} className="block truncate text-[10px]">{o.itemSummary}</span></td><td className="px-1.5 py-2 align-middle text-[10px] font-semibold">{o.quantitySummary}</td><td className="px-3 py-3"><span className={"inline-flex max-w-full whitespace-normal rounded-md border px-1.5 py-1 text-[9px] font-semibold leading-3 "+(o.route==="nearby"||o.route==="same_district"?"border-emerald-200 bg-emerald-50 text-emerald-800":o.route==="inter_district"||o.route==="multi_warehouse"?"border-violet-200 bg-violet-50 text-violet-800":"border-amber-200 bg-amber-50 text-amber-800")}>{({nearby:"Nearby Delivery",same_district:"Same-District Delivery",inter_district:"Inter-District Transfer",multi_warehouse:"Multi-Warehouse",route_review:"Route Review",needs_location:"Location Needed"} as Record<RouteKey,string>)[o.route]}</span></td><td className="px-1.5 py-2 align-middle"><span className={"inline-flex max-w-full whitespace-normal rounded-md border px-1.5 py-1 text-[9px] font-semibold leading-3 "+(o.stage==="In Transfer"?"border-blue-200 bg-blue-50 text-blue-800":o.stage==="Delivered"?"border-emerald-200 bg-emerald-50 text-emerald-800":o.stage==="To Dispatch"?"border-indigo-200 bg-indigo-50 text-indigo-800":o.stage==="To Receive"?"border-slate-200 bg-slate-50 text-slate-700":"border-emerald-200 bg-emerald-50 text-emerald-800")}>{o.stage}</span></td></tr>})}</tbody></table></div>}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground"><span>{Object.values(selectedOrders).filter(Boolean).length} eligible farmer order(s) selected</span><span>{filtered.length} order(s) shown</span></div>
        {Object.values(selectedOrders).some(Boolean)&&<div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3"><p className="mb-2 text-sm font-semibold">Bulk route planning</p><div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy==="bulk"} onClick={()=>bulkPlan("same_district")}>Plan selected same-district routes</Button><Button size="sm" variant="outline" disabled={busy==="bulk"} onClick={()=>bulkPlan("inter_district")}>Plan selected inter-district routes</Button></div><p className="mt-1 text-xs text-muted-foreground">Bulk planning is limited to selected, physically received farmer orders. Warehouse orders use their individual packing and dispatch checks.</p></div>}
      </CardContent></Card>

      <Card className="min-w-0 overflow-hidden xl:sticky xl:top-20 xl:min-h-[680px]"><CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-2"><div><h2 className="text-lg font-bold">Operations</h2><p className="mt-1 text-xs text-muted-foreground">Route-specific actions for selected orders.</p></div><Badge variant="outline">{selected?"1 order selected":"No orders selected"}</Badge></div>
        {selected?<div className="space-y-4"><div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-bold">#{selected.orderNumber}</h2><Badge className={selected.source==="farmer"?"bg-emerald-100 text-emerald-800":"bg-blue-100 text-blue-800"}>{selected.source==="farmer"?"Farmer Fulfillment":"Warehouse Fulfillment"}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{selected.customerName} · {selected.district}</p></div><Badge variant="outline">{selected.stage}</Badge></div>
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
