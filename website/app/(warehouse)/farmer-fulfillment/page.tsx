"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { RefreshCw, Warehouse, PackageCheck, Route, MapPin, Truck, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { api } from "../../lib/api/client";
import toast from "react-hot-toast";

const STAGES: Record<string,string> = {
  awaiting_farmer_confirmation:"Waiting for Farmer",
  collection_team_assigned:"Collection Team Assigned",
  collection_en_route:"Collection En Route",
  collection_arrived:"At Farm",
  collected:"Collected",
  collection_departed:"In Transit",
  warehouse_arrived:"At Warehouse",
  received:"Received",
  received_transfer:"Received at Warehouse",
  stored:"Stored",
  ready_for_dispatch:"Ready for Local Hub",
  delivery_decision:"Hub Route Selected",
  dispatched:"Dispatched",
  destination_warehouse_in_transit:"In Transit to Destination",
  destination_warehouse_received:"Received at Destination",
  source_portion_in_transit:"In Transit to Consolidation",
  source_portion_received_at_consolidation:"Received at Consolidation",
  consolidation_in_transit:"Consolidation Transfer in Transit",
  consolidation_portions_received:"All Portions Received",
  consolidation_waiting_for_sources:"Waiting for Warehouse Portions",
  consolidated:"Consolidated — Ready for Local Hub",
  hub_handoff_pending:"In Transit to Local Hub",
  local_hub_ready:"Local Hub Received — Delivery Job Ready",
};

export default function FarmerFulfillmentWarehousePage() {
  const [selectedTeams,setSelectedTeams]=useState<Record<string,string>>({});
  const [assigningOrder,setAssigningOrder]=useState<string|null>(null);
  const [selectedRouteOrders,setSelectedRouteOrders]=useState<Record<string,boolean>>({});
  const [planningRoute,setPlanningRoute]=useState(false);
  const [activeRouteSection,setActiveRouteSection]=useState<"nearby"|"same_district"|"inter_district"|"route_review"|"needs_location">("nearby");
  const {data:teamsData}=useQuery({
    queryKey:["warehouseApprovedPickupTeams"],
    queryFn:()=>api.get("/warehouse/me/pickup-team/members"),
    refetchInterval:30000,
  });
  const pickupTeams=teamsData?.data?.members||teamsData?.data?.pickupTeams||teamsData?.members||[];
  const {data,isLoading,refetch}=useQuery({
    queryKey:["farmerFulfillmentTransfers"],
    queryFn:()=>api.get("/warehouse/me/farmer-fulfillment-transfers"),
    refetchInterval:15000,
  });
  const routeOrder: Record<string, number> = { nearby: 0, same_district: 1, inter_district: 2, multi_warehouse: 3, needs_location: 4 };
  const routeLabels: Record<string, string> = {
    nearby: "Nearby delivery",
    same_district: "Same-district warehouse → local hub",
    inter_district: "Inter-district → destination warehouse",
    multi_warehouse: "Inter-district · Multi-warehouse consolidation",
    needs_location: "Needs location / route review",
  };
  const routeDescriptions: Record<string, string> = {
    nearby: "Within the configured distance threshold. Assign a final delivery partner for direct source-warehouse-to-customer delivery when eligible.",
    same_district: "Beyond the nearby threshold, with matching source and destination districts. Plan the sealed transfer to the local hub and assign a pickup team.",
    inter_district: "Beyond the nearby threshold and in a different district. Dispatch to the destination warehouse first, then continue to the local hub.",
    multi_warehouse: "Receive each allocated sealed portion at its assigned source warehouse, transfer portions to the consolidation warehouse, then send the complete order to the local hub for one final delivery job.",
    needs_location: "Distance or district information is incomplete. Resolve the address/coordinates before dispatch; do not auto-assign a route.",
  };
  const transfersRaw=data?.data?.transfers||[];
  const transfers=[...transfersRaw].sort((a:any,b:any)=>(routeOrder[a.routeCategory]??4)-(routeOrder[b.routeCategory]??4));
  // Only fully received orders with verified routing belong in actionable queues.
  const eligibleTransfers=transfers.filter((o:any)=>o.physicalReceiptConfirmed && o.routeDataComplete && o.routeCategory!=="needs_location" && o.currentWarehouseRole!=="assigned");
  // Consolidation warehouses must see inbound legs before receipt, but those
  // orders must not inflate the fully-received route-planning count.
  const inboundConsolidationTransfers=transfers.filter((o:any)=>o.isConsolidationWarehouse && Number(o.consolidation?.inTransitLegs||0)>0 && o.routeDataComplete);
  const visibleTransfers=[...eligibleTransfers,...inboundConsolidationTransfers.filter((o:any)=>!eligibleTransfers.some((ready:any)=>ready.id===o.id))];
  const waitingTransfers=transfers.filter((o:any)=>!visibleTransfers.some((ready:any)=>ready.id===o.id));
  const needsLocationData=(o:any)=>o.routeCategory==="needs_location" || !o.routeDataComplete;
  const needsOperationalReview=(o:any)=>!needsLocationData(o) && (
    Boolean(o.isUnassigned) || o.currentWarehouseRole==="assigned" || !o.physicalReceiptConfirmed
  );
  const routeSectionRows={
    nearby:transfers.filter((o:any)=>o.routeCategory==="nearby" && !needsLocationData(o) && !needsOperationalReview(o)),
    same_district:transfers.filter((o:any)=>o.routeCategory==="same_district" && !needsLocationData(o) && !needsOperationalReview(o)),
    inter_district:transfers.filter((o:any)=>["inter_district","multi_warehouse"].includes(String(o.routeCategory)) && !needsLocationData(o) && !needsOperationalReview(o)),
    route_review:transfers.filter((o:any)=>needsOperationalReview(o)),
    needs_location:transfers.filter((o:any)=>needsLocationData(o)),
  };
  const routeSectionMeta=[
    {key:"nearby" as const,label:"Nearby Delivery",description:"Within 15 km by default; direct delivery is available only when explicitly configured."},
    {key:"same_district" as const,label:"Same-District Warehouse Fulfillment",description:"Beyond the nearby threshold, same district: create a sealed transfer to the local hub."},
    {key:"inter_district" as const,label:"Inter-District Warehouse Fulfillment",description:"Different district: destination warehouse, transfer team, destination receipt, then local hub."},
    {key:"route_review" as const,label:"Route Review Required",description:"Orders waiting for warehouse assignment or physical receipt before route planning."},
    {key:"needs_location" as const,label:"Needs Location Data",description:"Missing or unverified coordinates/districts. Correct location data before dispatch."},
  ];
  const sectionTransfers=routeSectionRows[activeRouteSection];
  const {data:consolidationData,refetch:refetchConsolidations}=useQuery({
    queryKey:["farmerFulfillmentConsolidations"],
    queryFn:()=>api.get("/warehouse/me/farmer-fulfillment-consolidations"),
    refetchInterval:15000,
  });
  const consolidations=consolidationData?.data?.consolidations||[];

  const requestReturn=async(orderId:string)=>{
    const reason=window.prompt("Reason for returning this farmer-packed shipment to the farmer:");
    if(!reason?.trim()) return;
    try{
      await api.post(`/warehouse/me/farmer-fulfillment/${orderId}/return-to-farmer`,{reason:reason.trim()});
      toast.success("Return request sent to farmer");
      await refreshAll();
    }catch(e:any){toast.error(e?.message||"Return request failed");}
  };
  const recoverSourceWarehouse=async(orderId:string)=>{
    try{
      await api.post(`/warehouse/me/farmer-fulfillment/${orderId}/recover-source-warehouse`);
      toast.success("Source warehouse assigned and packed pickup/receipt records checked. Complete physical receipt in Incoming Stock.");
      await refreshAll();
    }catch(e:any){toast.error(e?.message||"Could not assign source warehouse");}
  };
  const receive=async(id:string,qty:number)=>{
    try {
      await api.put(`/warehouse/me/incoming/${id}/receive`,undefined,{params:{quantity:qty,quality_check:"passed",usableQuantity:qty,notes:"Farmer-packed fulfillment received at warehouse"}});
      toast.success("Farmer-packed shipment received");
      await refetch();
    } catch(e:any){toast.error(e?.message||"Receiving failed");}
  };
  const refreshAll=async()=>{await refetch();await refetchConsolidations();};
  const completeConsolidation=async(id:string)=>{
    try{await api.post(`/warehouse/me/farmer-fulfillment/${id}/complete-consolidation`);toast.success("All warehouse portions consolidated");await refreshAll();}
    catch(e:any){toast.error(e?.message||"Consolidation failed");}
  };
  const dispatchConsolidation=async(id:string)=>{
    try{await api.post(`/warehouse/me/farmer-fulfillment/${id}/dispatch-to-consolidation`);toast.success("Warehouse portion dispatched to consolidation");await refreshAll();}
    catch(e:any){toast.error(e?.message||"Dispatch failed");}
  };
  const receiveConsolidation=async(id:string)=>{
    try{await api.post(`/warehouse/me/farmer-fulfillment/${id}/receive-at-consolidation`);toast.success("Portion received at consolidation");await refreshAll();}
    catch(e:any){toast.error(e?.message||"Consolidation receipt failed");}
  };
  const toggleRouteOrder=(id:string,checked:boolean)=>setSelectedRouteOrders(current=>({...current,[id]:checked}));
  const planSelectedTransfers=async(category:"same_district"|"inter_district")=>{
    const chosen=eligibleTransfers.filter((o:any)=>selectedRouteOrders[o.id] && o.routeCategory===category);
    if(!chosen.length){toast.error("Select at least one eligible order in this route category.");return;}
    setPlanningRoute(true);
    const failures:string[]=[];
    let completed=0;
    try{
      // Persist each route leg through the existing guarded backend endpoints. The
      // backend validates full receipt, warehouse role and route prerequisites.
      for(const order of chosen){
        try{
          if(category==="inter_district"){
            if(!order.destinationWarehouseId){
              await api.post(`/warehouse/me/farmer-fulfillment/${order.id}/assign-destination-warehouse`);
            }
            await api.post(`/warehouse/me/farmer-fulfillment/${order.id}/dispatch-to-destination`);
          }else{
            await api.post(`/warehouse/me/farmer-fulfillment/${order.id}/handoff-local-hub`);
          }
          completed++;
        }catch(e:any){failures.push(`${order.orderNumber||order.id}: ${e?.message||"route creation failed"}`);}
      }
      if(completed)toast.success(`Created ${completed} ${category==="inter_district"?"destination transfer manifest(s)":"local-hub transfer(s)"}. Assign pickup teams on each order card.`);
      if(failures.length)toast.error(failures.slice(0,2).join("; "));
      setSelectedRouteOrders(current=>{const next={...current};chosen.forEach((o:any)=>{delete next[o.id];});return next;});
      await refreshAll();
    }finally{setPlanningRoute(false);}
  };
  const assignPickupTeam=async(id:string,leg:"destination"|"hub")=>{
    const deliveryPartnerId=selectedTeams[id];
    if(!deliveryPartnerId){toast.error("Select an approved pickup team first.");return;}
    try{
      setAssigningOrder(id);
      const endpoint=leg==="destination"
        ? `/warehouse/me/farmer-fulfillment/${id}/assign-destination-pickup-team`
        : `/warehouse/me/farmer-fulfillment/${id}/assign-local-hub-pickup-team`;
      await api.put(endpoint,undefined,{params:{deliveryPartnerId}});
      toast.success(leg==="destination"?"Destination transfer pickup team assigned":"Local-hub pickup team assigned");
      await refreshAll();
    }catch(e:any){toast.error(e?.message||"Pickup-team assignment failed");}
    finally{setAssigningOrder(null);}
  };
  const assignDestinationWarehouse=async(id:string)=>{
    try{
      await api.post(`/warehouse/me/farmer-fulfillment/${id}/assign-destination-warehouse`);
      toast.success("Destination warehouse assigned using customer location and available capacity");
      await refreshAll();
    }catch(e:any){toast.error(e?.message||"Destination warehouse assignment failed");}
  };
  const dispatchDestination=async(id:string)=>{
    try{await api.post(`/warehouse/me/farmer-fulfillment/${id}/dispatch-to-destination`);toast.success("Order dispatched to destination warehouse");await refreshAll();}
    catch(e:any){toast.error(e?.message||"Destination dispatch failed");}
  };
  const receiveDestination=async(id:string)=>{
    try{await api.post(`/warehouse/me/farmer-fulfillment/${id}/receive-at-destination`);toast.success("Destination warehouse receipt confirmed");await refreshAll();}
    catch(e:any){toast.error(e?.message||"Destination receipt failed");}
  };
  const handoffHub=async(id:string)=>{
    try{await api.post(`/warehouse/me/farmer-fulfillment/${id}/handoff-local-hub`);toast.success("Complete order handed to local hub");await refreshAll();}
    catch(e:any){toast.error(e?.message||"Local hub handoff failed");}
  };
  const receiveHub=async(id:string)=>{
    try{await api.post(`/warehouse/me/farmer-fulfillment/${id}/receive-local-hub`);toast.success("Local hub received complete order; one delivery job opened");await refreshAll();}
    catch(e:any){toast.error(e?.message||"Local hub receipt failed");}
  };
  const store=async(id:string)=>{
    try {
      await api.put(`/warehouse/me/incoming/${id}/store`);
      toast.success("Transfer stored and ready for dispatch");
      await refetch();
    } catch(e:any){toast.error(e?.message||"Storage failed");}
  };

  return <div className="space-y-6">
    <div className="rounded-2xl bg-gradient-to-r from-indigo-800 to-slate-800 p-6 text-white">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="flex items-center gap-2 text-sm text-indigo-200"><Warehouse className="h-4 w-4"/>Farmer Fulfillment Transfer</div>
        <h1 className="mt-1 text-3xl font-bold">Packed Farmer Orders</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-200">These orders are already packed and verified by the farmer. This warehouse process does not repack the order. After physical receipt, orders are classified automatically using the 15 km default threshold.</p></div>
        <Button variant="secondary" size="icon" onClick={()=>refetch()}><RefreshCw className="h-4 w-4"/></Button>
      </div>
    </div>

    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-bold">Warehouse workflow</h2>
        <p className="text-sm text-muted-foreground">Choose the route that matches the order. The next-action buttons appear on each order card when its prerequisites are met.</p>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="border-blue-200">
          <CardContent className="space-y-3 p-4">
            <Badge variant="outline">Route 1 · Nearby</Badge>
            <h3 className="font-semibold">Farm → Source Warehouse → Final Delivery Partner → Customer</h3>
            <ol className="space-y-2 text-sm">
              {["Receive and verify the sealed farmer-packed order","Assign one approved final-mile delivery partner","Create one delivery job for the customer"].map((step,i)=><li key={step} className="flex gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-800">{i+1}</span><span>{step}</span></li>)}
            </ol>
          </CardContent>
        </Card>
        <Card className="border-violet-200">
          <CardContent className="space-y-3 p-4">
            <Badge variant="outline">Route 2 · Same district</Badge>
            <h3 className="font-semibold">Farm → Source Warehouse → Local Hub → Final Delivery Partner → Customer</h3>
            <ol className="space-y-2 text-sm">
              {["Receive and verify the sealed farmer-packed order","Create a local-hub transfer and assign a pickup team","Confirm local-hub receipt; one final delivery job opens"].map((step,i)=><li key={step} className="flex gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-800">{i+1}</span><span>{step}</span></li>)}
            </ol>
          </CardContent>
        </Card>
        <Card className="border-emerald-200">
          <CardContent className="space-y-3 p-4">
            <Badge variant="outline">Route 3 · Inter-district</Badge>
            <h3 className="font-semibold">Farm → Source Warehouse → Destination Warehouse → Local Hub → Final Delivery Partner → Customer</h3>
            <ol className="space-y-2 text-sm">
              {["Receive and verify at the source warehouse","Assign a destination warehouse and transfer pickup team","Destination confirms physical receipt","Transfer the complete order to the local hub","Confirm hub receipt; one final delivery job opens"].map((step,i)=><li key={step} className="flex gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">{i+1}</span><span>{step}</span></li>)}
            </ol>
            <p className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-900">Multi-warehouse exception: receive each allocated sealed portion at its source, dispatch every portion to consolidation, confirm all portions arrived, then send the consolidated order to the local hub. Only one final delivery job is created.</p>
          </CardContent>
        </Card>
      </div>
    </section>

    <section className="space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div><h2 className="text-xl font-bold">Farmer Fulfillment Orders</h2><p className="text-sm text-muted-foreground">Select a section to view its order cards. Each section keeps the same card layout while the available actions follow that route's prerequisites.</p></div>
        <Badge variant="outline">{transfers.length} total orders</Badge>
      </div>
      <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
        {routeSectionMeta.map((section)=>{
          const selected=activeRouteSection===section.key;
          const count=routeSectionRows[section.key].length;
          return <button key={section.key} onClick={()=>setActiveRouteSection(section.key)} className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition ${selected?"bg-emerald-600 text-white shadow-sm":"bg-white text-slate-600 hover:bg-emerald-50 hover:text-emerald-700"}`}>
            <span>{section.label}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${selected?"bg-amber-100 text-amber-700":"bg-emerald-100 text-emerald-700"}`}>{count}</span>
          </button>;
        })}
      </div>
      <div className="rounded-xl border bg-white p-4">
        <h3 className="font-semibold">{routeSectionMeta.find((section)=>section.key===activeRouteSection)?.label}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{routeSectionMeta.find((section)=>section.key===activeRouteSection)?.description}</p>
        <p className="mt-2 text-xs text-muted-foreground">Default nearby threshold: 15 km. A configured order/warehouse threshold overrides the default.</p>
      </div>
    </section>

    <Card className="border-indigo-100 bg-indigo-50/60"><CardContent className="p-5">
      <div className="grid gap-4 md:grid-cols-4 text-sm">
        {[
          ["1","Receive","Verify package + quantity"],
          ["2","Store / Hold","Place packed shipment safely"],
          ["3","Route","Warehouse → Local Hub"],
          ["4","Handoff","Local Hub → Delivery Partner → Customer"],
        ].map(([n,title,desc])=><div key={n} className="rounded-xl bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 font-bold text-indigo-700">{n}</span><b>{title}</b></div><p className="mt-2 text-xs text-muted-foreground">{desc}</p></div>)}
      </div>
    </CardContent></Card>

    {isLoading?<div className="h-32 animate-pulse rounded-xl bg-muted"/>:transfers.length===0?
      <Card className="p-12 text-center"><PackageCheck className="mx-auto h-12 w-12 text-muted-foreground"/><h3 className="mt-4 font-semibold">No farmer-packed transfers</h3><p className="mt-2 text-sm text-muted-foreground">Long-distance farmer fulfillment orders routed through this warehouse will appear here.</p></Card>:
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4">
        <div><h3 className="font-semibold">Plan transfer routes</h3><p className="text-sm text-muted-foreground">Select fully received orders in the same route category. Route manifests are created in order; each transfer still requires an approved pickup-team assignment.</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={planningRoute || !eligibleTransfers.some((o:any)=>selectedRouteOrders[o.id]&&o.routeCategory==="same_district")} onClick={()=>planSelectedTransfers("same_district")}>{planningRoute?"Planning…":"Plan Same-District Routes"}</Button><Button disabled={planningRoute || !eligibleTransfers.some((o:any)=>selectedRouteOrders[o.id]&&o.routeCategory==="inter_district")} onClick={()=>planSelectedTransfers("inter_district")}>{planningRoute?"Planning…":"Plan Inter-District Routes"}</Button></div>
      </div>
      <div className="space-y-4">{sectionTransfers.length===0?<Card><CardContent className="flex flex-col items-center py-12 text-center"><PackageCheck className="h-10 w-10 text-slate-300"/><p className="mt-3 font-semibold">No orders in this section</p><p className="mt-1 text-sm text-muted-foreground">Orders will appear here when their route and warehouse prerequisites match this section.</p></CardContent></Card>:sectionTransfers.map((o:any,index:number)=><><Card key={o.id}><CardContent className="p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">#{o.orderNumber}</h3><Badge variant="outline">{STAGES[o.stage]||o.stage}</Badge><Badge variant="secondary">Farmer Packed</Badge></div>
            <p className="mt-2 text-sm text-muted-foreground">Farmer: {o.farmerName||"Assigned Farmer"} · Warehouse: {o.warehouseName}</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3"/>Customer: {[o.deliveryAddress?.addressLine1,o.deliveryAddress?.city,o.deliveryAddress?.state].filter(Boolean).join(", ")||"Address unavailable"}</p>
            {["same_district","inter_district"].includes(String(o.routeCategory)) && <label className="mt-3 flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={Boolean(selectedRouteOrders[o.id])} onChange={e=>toggleRouteOrder(o.id,e.target.checked)} /> Include in {o.routeCategory==="inter_district"?"inter-district":"same-district"} route planning</label>}
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border bg-white p-3 text-sm"><p className="text-xs text-muted-foreground">Source warehouse</p><p className="mt-1 font-medium">{o.sourceWarehouseName||"Not assigned"}</p><p className="text-xs text-muted-foreground">{o.sourceDistrict||"Source district not recorded"}</p></div>
              <div className="rounded-lg border bg-white p-3 text-sm"><p className="text-xs text-muted-foreground">Destination warehouse</p><p className="mt-1 font-medium">{o.destinationWarehouseName||(o.routeCategory==="inter_district"?"Not assigned":"Not required for this route")}</p><p className="text-xs text-muted-foreground">{o.destinationDistrict||"Destination district not recorded"}</p></div>
              <div className="rounded-lg border bg-white p-3 text-sm"><p className="text-xs text-muted-foreground">Routing distance</p><p className="mt-1 font-medium">{o.routeDistanceKm==null?"Not calculated":Number(o.routeDistanceKm).toFixed(1)+" km"}</p><p className="text-xs text-muted-foreground">Nearby threshold: {o.nearbyThresholdKm??15} km</p></div>
            </div>
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-muted-foreground">Farm pickup: {o.pickupSchedule?.start||"20:00"}–{o.pickupSchedule?.end||"06:00"} IST · Warehouse-to-hub transfer: {o.downstreamTransferSchedule?.start||"06:00"}–{o.downstreamTransferSchedule?.end||"20:00"} IST. Sealed farmer-packed orders are never repacked.</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">{(o.items||[]).map((i:any)=><div key={`${i.productId}-${i.variantId||""}`} className="rounded-lg bg-slate-50 p-3 text-sm"><b>{i.productName}</b><div className="text-muted-foreground">{i.quantity} {i.unit}</div></div>)}</div>
            <div className="mt-4 space-y-2">{(o.incoming||[]).map((x:any)=><div key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"><div><b>Incoming shipment</b><div className="text-xs text-muted-foreground">Expected {x.expectedQuantity} · Received {x.receivedQuantity||0} · {x.qualityCheck||"quality pending"}</div></div><div className="flex gap-2">{x.status==="pending"&&<Button size="sm" onClick={()=>receive(x.id,x.expectedQuantity)}>Receive + Verify</Button>}{x.status==="received"&&<Button size="sm" onClick={()=>store(x.id)}>Store Packed Shipment</Button>}{x.status==="stored"&&<Badge variant="success"><CheckCircle2 className="mr-1 h-4 w-4"/>Stored</Badge>}
                  {(x.status==="rejected"||x.qualityCheck==="failed")&&<Button size="sm" variant="outline" onClick={()=>requestReturn(o.id)}>Return to Farmer</Button>}</div></div>)}</div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 lg:w-64">
            {o.isUnassigned && <Button size="sm" onClick={()=>recoverSourceWarehouse(o.id)}>Assign Source Warehouse & Prepare Pickup</Button>}
            <div className="rounded-xl border bg-slate-50 p-4 text-sm"><p className="font-semibold">No warehouse packing</p><p className="mt-1 text-xs text-muted-foreground">Farmer has already packed, checked and sealed this order.</p></div>
            {(() => {
              const mode = String(o.logisticsMode || "").toLowerCase();
              const multi = mode === "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner" ||
                mode.includes("multiple_warehouses") || Number(o.warehouseCount || 0) > 1 ||
                (Array.isArray(o.warehouseAllocations) && o.warehouseAllocations.length > 1);
              // The backend's verified distance/district classifier is authoritative.
              // Legacy logisticsMode/warehouseId fields are fallback hints only; they
              // must not override a verified Nearby or Same-District decision.
              const hasVerifiedRouteCategory = ["nearby","same_district","inter_district","needs_location"].includes(String(o.routeCategory||""));
              const interDistrict = !multi && (o.routeCategory==="inter_district" || (!hasVerifiedRouteCategory && (
                mode === "farmer_to_source_warehouse_to_destination_warehouse_to_local_hub_to_delivery_partner" ||
                mode.includes("destination_warehouse") || Boolean(o.destinationWarehouseId)
              )));
              const sameDistrict = !multi && (o.routeCategory==="same_district" || (!hasVerifiedRouteCategory && (
                mode === "farmer_to_warehouse_to_local_hub_to_delivery_partner" || mode === "farmer_to_warehouse"
              )));
              const con = consolidations.find((x:any)=>x.orderId===o.id);
              const conStatus = o.consolidationStatus || con?.consolidationStatus || "";
              const transferStatus = o.transferStatus || "";
              const incomingRows = o.incoming || [];
              const receiptComplete = incomingRows.length > 0 && incomingRows.every((x:any) =>
                ["received","stored"].includes(x.status) && Number(x.receivedQuantity || 0) + 1e-9 >= Number(x.expectedQuantity || 0)
              );
              const storedComplete = incomingRows.length > 0 && incomingRows.every((x:any) => x.status === "stored");
              const routeCategory=String(o.routeCategory||"needs_location");
              const routeNeedsReview=routeCategory==="needs_location" || !o.routeDataComplete;
              const sourceRole = o.currentWarehouseRole === "source" || (o.sourceWarehouseId && o.sourceWarehouseId === o.warehouseId);
              const destinationRole = o.currentWarehouseRole === "destination" || (o.destinationWarehouseId && o.destinationWarehouseId === o.warehouseId);
              const consolidationRole = o.currentWarehouseRole === "consolidation" || (o.consolidationWarehouseId && o.consolidationWarehouseId === o.warehouseId);
              const canReceiveAtSource = incomingRows.some((x:any)=>["pending","scheduled","in_transit","ready_for_pickup"].includes(x.status));
              const nextAction = multi
                ? (conStatus === "consolidated" ? "Transfer the complete order to the local hub" : "Receive every warehouse portion, then dispatch each portion to consolidation")
                : interDistrict
                  ? (transferStatus === "destination_warehouse_in_transit" ? "Confirm physical receipt at destination" : transferStatus === "destination_warehouse_received" ? "Transfer the complete order to the local hub" : "Receive at source, then dispatch to destination")
                  : (["hub_handoff_pending"].includes(transferStatus) ? "Confirm the local hub physically received the order" : transferStatus === "local_hub_ready" ? "One final delivery job is ready" : "Receive the packed order, then transfer it to the local hub");
              return <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Process this order</p>
                    <p className="mt-1 text-xs text-muted-foreground">{multi ? "Allocated Source Warehouses → Consolidation Warehouse → Local Hub → One Final Delivery Partner → Customer" : routeCategory==="nearby" ? "Source Warehouse → Final Delivery Partner → Customer" : interDistrict ? "Source Warehouse → Destination Warehouse → Local Hub → Final Delivery Partner → Customer" : sameDistrict ? "Source Warehouse → Local Hub → Final Delivery Partner → Customer" : "Resolve route classification before dispatch"}</p>
                  </div>
                  <Badge variant="outline">{STAGES[o.stage] || o.stage || "Awaiting warehouse action"}</Badge>
                </div>
                <div className="rounded-lg bg-white p-3">
                  <p className="text-xs font-medium text-muted-foreground">NEXT STEP</p>
                  <p className="mt-1 text-sm font-semibold">{nextAction}</p>
                </div>
                {routeCategory==="nearby" && <div className={o.directDeliveryConfigured?"rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800":"rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"}>Distance: {o.routeDistanceKm==null?"Not calculated":Number(o.routeDistanceKm).toFixed(1)+" km"} · Threshold: {o.nearbyThresholdKm??15} km. {o.directDeliveryConfigured?"Direct warehouse-to-customer delivery is configured.":"Nearby distance alone does not authorize direct delivery. Configure this order for direct warehouse-to-customer delivery or use the appropriate hub/warehouse route."}</div>}
                {routeNeedsReview && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">Route dispatch is blocked: coordinates or district details are missing. Correct the farm/customer location and refresh before selecting a route.</div>}
                <div className="flex flex-wrap gap-2">
                  {!multi && !interDistrict && routeCategory==="nearby" && <>
                    {incomingRows.filter((x:any)=>["pending","scheduled","in_transit","ready_for_pickup"].includes(x.status)).map((x:any)=><Button key={x.id} size="sm" onClick={()=>receive(x.id,x.expectedQuantity)}><PackageCheck className="mr-2 h-4 w-4"/>Receive + Verify</Button>)}
                    {incomingRows.filter((x:any)=>x.status === "received").map((x:any)=><Button key={x.id} size="sm" variant="outline" onClick={()=>store(x.id)}>Store / Hold Packed Shipment</Button>)}
                    {transferStatus!=="local_hub_ready" && <div className="flex flex-wrap items-center gap-2"><select className="h-9 rounded-md border bg-white px-2 text-sm" value={selectedTeams[o.id]||""} onChange={e=>setSelectedTeams(v=>({...v,[o.id]:e.target.value}))}><option value="">Select approved final delivery partner</option>{pickupTeams.map((t:any)=><option key={t.deliveryPartnerId||t.id} value={t.deliveryPartnerId||t.id}>{t.name||t.fullName||t.partnerName||"Delivery partner"} · {t.vehicleType||"Vehicle"} · capacity {t.capacity??t.vehicleCapacity??"N/A"}</option>)}</select><Button size="sm" disabled={!selectedTeams[o.id]||assigningOrder===o.id||!receiptComplete||routeNeedsReview||!o.directDeliveryConfigured} onClick={async()=>{try{setAssigningOrder(o.id);await api.put(`/warehouse/me/farmer-fulfillment/${o.id}/assign-nearby-delivery-partner`,undefined,{params:{deliveryPartnerId:selectedTeams[o.id]}});toast.success("Final delivery partner assigned and delivery job created");await refreshAll();}catch(e:any){toast.error(e?.message||"Partner assignment failed");}finally{setAssigningOrder(null);}}}>{assigningOrder===o.id?"Assigning…":"Assign Final Delivery Partner"}</Button></div>}
                    {o.deliveryPartnerId && <Badge variant="success">Final partner assigned · {o.deliveryPartnerId}</Badge>}
                  </>}
                  {!multi && !interDistrict && routeCategory==="same_district" && <>
                    {incomingRows.filter((x:any)=>["pending","scheduled","in_transit","ready_for_pickup"].includes(x.status)).map((x:any)=><Button key={x.id} size="sm" onClick={()=>receive(x.id,x.expectedQuantity)}><PackageCheck className="mr-2 h-4 w-4"/>Receive + Verify</Button>)}
                    {incomingRows.filter((x:any)=>x.status === "received").map((x:any)=><Button key={x.id} size="sm" variant="outline" onClick={()=>store(x.id)}>Store / Hold Packed Shipment</Button>)}
                    <Button size="sm" onClick={()=>handoffHub(o.id)} disabled={routeNeedsReview || !receiptComplete || !["received","stored"].every((s:string)=>["received","stored"].includes(s) && incomingRows.some((x:any)=>["received","stored"].includes(x.status))) || ["hub_handoff_pending","local_hub_ready"].includes(transferStatus)}><Route className="mr-2 h-4 w-4"/>Plan Route & Create Local-Hub Transfer</Button>
                    {transferStatus==="hub_handoff_pending" && <div className="flex flex-wrap items-center gap-2"><select className="h-9 rounded-md border bg-white px-2 text-sm" value={selectedTeams[o.id]||""} onChange={e=>setSelectedTeams(v=>({...v,[o.id]:e.target.value}))}><option value="">Select approved pickup team</option>{pickupTeams.map((t:any)=><option key={t.deliveryPartnerId||t.id} value={t.deliveryPartnerId||t.id}>{t.name||t.fullName||t.partnerName||"Pickup team"} · {t.vehicleType||"Vehicle"} · capacity {t.capacity??t.vehicleCapacity??"N/A"}</option>)}</select><Button size="sm" variant="outline" disabled={!selectedTeams[o.id]||assigningOrder===o.id} onClick={()=>assignPickupTeam(o.id,"hub")}>{assigningOrder===o.id?"Assigning…":"Assign Pickup Team"}</Button></div>}
                    {transferStatus === "hub_handoff_pending" && <Button size="sm" onClick={()=>receiveHub(o.id)}><MapPin className="mr-2 h-4 w-4"/>Confirm Local Hub Receipt</Button>}
                  </>}
                  {interDistrict && <>
                    {sourceRole && incomingRows.filter((x:any)=>["pending","scheduled","in_transit","ready_for_pickup"].includes(x.status)).map((x:any)=><Button key={x.id} size="sm" onClick={()=>receive(x.id,x.expectedQuantity)}><PackageCheck className="mr-2 h-4 w-4"/>Receive + Verify</Button>)}
                    {sourceRole && incomingRows.filter((x:any)=>x.status === "received").map((x:any)=><Button key={x.id} size="sm" variant="outline" onClick={()=>store(x.id)}>Store Packed Shipment</Button>)}
                    {sourceRole && !o.destinationWarehouseId && <Button size="sm" variant="outline" onClick={()=>assignDestinationWarehouse(o.id)} disabled={routeNeedsReview}><Warehouse className="mr-2 h-4 w-4"/>Assign Destination Warehouse</Button>}
                    {sourceRole && <Button size="sm" onClick={()=>dispatchDestination(o.id)} disabled={routeNeedsReview || !receiptComplete || !o.destinationWarehouseId || ["destination_warehouse_in_transit","destination_warehouse_received","hub_handoff_pending","local_hub_ready"].includes(transferStatus)}><Truck className="mr-2 h-4 w-4"/>Plan Inter-District Route & Create Transfer</Button>}
                    {sourceRole && ["destination_warehouse_transfer_pending","destination_warehouse_in_transit"].includes(transferStatus) && <div className="flex flex-wrap items-center gap-2"><select className="h-9 rounded-md border bg-white px-2 text-sm" value={selectedTeams[o.id]||""} onChange={e=>setSelectedTeams(v=>({...v,[o.id]:e.target.value}))}><option value="">Select approved pickup team</option>{pickupTeams.map((t:any)=><option key={t.deliveryPartnerId||t.id} value={t.deliveryPartnerId||t.id}>{t.name||t.fullName||t.partnerName||"Pickup team"} · {t.vehicleType||"Vehicle"} · capacity {t.capacity??t.vehicleCapacity??"N/A"}</option>)}</select><Button size="sm" variant="outline" disabled={!selectedTeams[o.id]||assigningOrder===o.id} onClick={()=>assignPickupTeam(o.id,"destination")}>{assigningOrder===o.id?"Assigning…":"Assign Transfer Team"}</Button></div>}
                    {destinationRole && <Button size="sm" onClick={()=>receiveDestination(o.id)} disabled={transferStatus !== "destination_warehouse_in_transit"}><Warehouse className="mr-2 h-4 w-4"/>Confirm Destination Receipt</Button>}
                    {destinationRole && <Button size="sm" onClick={()=>handoffHub(o.id)} disabled={transferStatus !== "destination_warehouse_received"}><Route className="mr-2 h-4 w-4"/>Transfer to Local Hub</Button>}
                    {transferStatus === "hub_handoff_pending" && <Button size="sm" onClick={()=>receiveHub(o.id)}><MapPin className="mr-2 h-4 w-4"/>Confirm Local Hub Receipt</Button>}
                  </>}
                  {multi && <>
                    {sourceRole && incomingRows.filter((x:any)=>["pending","scheduled","in_transit","ready_for_pickup"].includes(x.status)).map((x:any)=><Button key={x.id} size="sm" onClick={()=>receive(x.id,x.expectedQuantity)}><PackageCheck className="mr-2 h-4 w-4"/>Receive + Verify Portion</Button>)}
                    {sourceRole && incomingRows.filter((x:any)=>x.status === "received").map((x:any)=><Button key={x.id} size="sm" variant="outline" onClick={()=>store(x.id)}>Store Packed Portion</Button>)}
                    {con?.canDispatchToConsolidation && <Button size="sm" variant="outline" onClick={()=>dispatchConsolidation(o.id)} disabled={!storedComplete || Boolean(con?.sourceTransfer?.dispatched)}><Truck className="mr-2 h-4 w-4"/>Dispatch Portion to Consolidation</Button>}
                    {consolidationRole && <Button size="sm" variant="outline" onClick={()=>receiveConsolidation(o.id)} disabled={!Number(con?.inTransitLegCount||0) || Boolean(con?.allConsolidationLegsReceived)}><Warehouse className="mr-2 h-4 w-4"/>Receive Portions at Consolidation</Button>}
                    {consolidationRole && <Button size="sm" onClick={()=>completeConsolidation(o.id)} disabled={!con?.allWarehousesReceived || !con?.allConsolidationLegsReceived || ["consolidated","hub_handoff_pending","local_hub_ready"].includes(conStatus)}><CheckCircle2 className="mr-2 h-4 w-4"/>Complete Consolidation</Button>}
                    {consolidationRole && <Button size="sm" variant="outline" onClick={()=>handoffHub(o.id)} disabled={conStatus !== "consolidated"}><Route className="mr-2 h-4 w-4"/>Transfer Complete Order to Local Hub</Button>}
                    {consolidationRole && <Button size="sm" variant="outline" onClick={()=>receiveHub(o.id)} disabled={conStatus !== "hub_handoff_pending"}><MapPin className="mr-2 h-4 w-4"/>Confirm Local Hub Receipt</Button>}
                  </>}
                </div>
                {multi && <div className="grid gap-2 sm:grid-cols-3 text-xs">
                  <div className="rounded-lg bg-white p-3"><p className="text-muted-foreground">Warehouse portions</p><p className="mt-1 font-semibold">{con?.storedCount ?? 0}/{con?.incomingCount ?? 0} received + stored</p></div>
                  <div className="rounded-lg bg-white p-3"><p className="text-muted-foreground">Consolidation receipts</p><p className="mt-1 font-semibold">{`${con?.receivedConsolidationLegCount ?? 0}/${con?.totalConsolidationLegCount ?? 0} received`}</p></div>
                  <div className="rounded-lg bg-white p-3"><p className="text-muted-foreground">Local hub</p><p className="mt-1 font-semibold">{o.localHubName || "Assigned local hub"}</p></div>
                </div>}
                {!multi && !interDistrict && !receiptComplete && <p className="text-xs text-amber-700">Receive and verify the full packed quantity first. The local-hub transfer remains disabled until the shipment is physically received.</p>}
                {interDistrict && !o.destinationWarehouseId && <p className="text-xs text-amber-700">A destination warehouse has not been assigned yet. Dispatch is unavailable until the route assignment is complete.</p>}
                {multi && !con?.allWarehousesReceived && <p className="text-xs text-amber-700">Waiting for all allocated farmer-packed portions to be received at their assigned warehouses.</p>}
                {transferStatus === "local_hub_ready" && <p className="text-sm font-medium text-emerald-700">✓ Local hub receipt confirmed. The backend should expose one final delivery job for this original customer order.</p>}
              </div>;
            })()}
            {o.stage==="dispatched"&&<Badge variant="success" className="justify-center py-2"><Truck className="mr-1 h-4 w-4"/>Sent to Local Hub</Badge>}
          </div>
        </div>
      </CardContent></Card></>)}</div>}
  </div>;
}