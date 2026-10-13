"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowRight, CheckCircle2, PackageCheck, RefreshCw, Truck, Warehouse, ClipboardCheck, Route } from "lucide-react";
import { PrefetchLink as Link } from "../../../components/shared/prefetch-link";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { api } from "../../../lib/api/client";
import toast from "react-hot-toast";

const labels: Record<string,string> = {
  awaiting_warehouse_receipt:"Awaiting Farm Pickup",
  collection_team_assigned:"Collection Team Assigned",
  warehouse_arrived:"Arrived at Warehouse — Receive & Inspect",
  received_transfer:"Received — Ready for Transfer",
  partial_received:"Partially Received",
  quality_approved:"Quality Approved — Store Stock",
  stored:"Stored — Ready for Handoff",
  ready_for_dispatch:"Ready for Local Hub",
  local_hub_transfer_pending:"Local Hub Transfer Pending",
  ready_for_consolidation:"Ready for Consolidation",
  consolidation_waiting_for_sources:"Waiting for Source Warehouses",
  consolidation_in_transit:"Warehouse Portions In Transit",
  consolidation_portions_received:"Portions Received — Complete Consolidation",
  consolidated:"Consolidated — Send to Local Hub",
  hub_handoff_pending:"In Transit to Local Hub",
  local_hub_ready:"Local Hub Received — Delivery Partner Ready",
  source_portion_in_transit:"Warehouse Portion In Transit",
  source_portion_received_at_consolidation:"Portion Received at Consolidation",
  warehouse_assignment_pending:"Awaiting Warehouse Assignment",
  long_distance_pending:"Awaiting Warehouse Assignment",
  source_warehouse_pickup_pending:"Awaiting Farm Pickup",
  destination_warehouse_transfer_pending:"Awaiting Destination Warehouse Transfer",
};

export default function FarmerFulfillmentTransfersPage() {
  const [busy,setBusy]=useState<string|null>(null);
  const [selectedHubTeam,setSelectedHubTeam]=useState<Record<string,string>>({});
  const [selectedDestinationTeam,setSelectedDestinationTeam]=useState<Record<string,string>>({});
  const [selectedRouteOrders,setSelectedRouteOrders]=useState<Record<string,boolean>>({});
  const {data,isLoading,isError,error,refetch}=useQuery({
    queryKey:["warehouseFarmerFulfillmentTransfers"],
    queryFn:()=>api.get("/warehouse/me/farmer-fulfillment-transfers"),
    refetchInterval:15000,
  });
  const {data:teamPayload}=useQuery({queryKey:["warehouseFarmerFulfillmentPickupTeams"],queryFn:()=>api.get("/warehouse/me/pickup-team/members"),refetchInterval:30000});
  const hubPickupTeams=Array.isArray(teamPayload?.data?.members)?teamPayload.data.members.map((m:any)=>({id:String(m.id||m._id||m.deliveryPartnerId),deliveryPartnerId:String(m.deliveryPartnerId||m.id||m._id),name:m.name||m.partnerName||m.firstName||"Pickup Partner",vehicleType:m.vehicleType||m.vehicle||"Vehicle",capacity:Number(m.capacity||m.vehicleCapacity||0)})):[];
  const transferPayload=data?.data?.transfers??data?.transfers;
  const allRows=Array.isArray(transferPayload)?transferPayload:[];
  const unlinkedPackedPackets=Array.isArray(data?.data?.unlinkedPackedPackets)?data.data.unlinkedPackedPackets:[];
  const shipmentQuantity=(order:any)=>{
    const receiptQuantity=(order.incoming||[]).reduce((total:number,row:any)=>total+Number(
      row.usableQuantity||row.receivedQuantity||row.expectedQuantity||row.quantityReceived||row.quantity||0
    ),0);
    return receiptQuantity||((order.items||[]).reduce((total:number,item:any)=>total+Number(item.quantity||item.expectedQuantity||0),0));
  };
  const teamCanCarry=(team:any,order:any)=>{
    const required=shipmentQuantity(order);
    return required>0&&team.capacity>=required;
  };
  const selectedTeamCanCarry=(teams:any[],selectedId:string,order:any)=>{
    const team=teams.find((candidate:any)=>candidate.deliveryPartnerId===selectedId);
    return Boolean(team&&teamCanCarry(team,order));
  };
  const MULTI_WAREHOUSE_MODE="farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner";
  // Consolidation is for one customer order assembled from multiple supply sources,
  // not merely an order carrying a legacy logisticsMode value.
  const isTrueConsolidation=(row:any)=>{
    const allocations=Array.isArray(row.warehouseAllocations)?row.warehouseAllocations:(Array.isArray(row.allocations)?row.allocations:[]);
    const sourceWarehouseIds=new Set(allocations.map((a:any)=>String(a.warehouseId||a.sourceWarehouseId||"")).filter(Boolean));
    const sourceCount=Number(row.warehouseCount||sourceWarehouseIds.size||0);
    const explicitlyBulk= row.fulfillmentPurpose==="event_bulk" || row.isMultiWarehouseConsolidation===true || Boolean(row.consolidationId);
    return row.logisticsMode===MULTI_WAREHOUSE_MODE && (sourceCount>1 || sourceWarehouseIds.size>1 || explicitlyBulk);
  };
  const rows=allRows.filter((row:any)=>!isTrueConsolidation(row)).map((row:any)=>({
    ...row,
    incoming: Array.isArray(row.incoming)?row.incoming:[],
    items: Array.isArray(row.items)?row.items:[],
    warehouseAllocations: Array.isArray(row.warehouseAllocations)?row.warehouseAllocations:[],
    // A legacy single-source record should use the standard transfer action path.
    logisticsMode: row.logisticsMode===MULTI_WAREHOUSE_MODE ? "farmer_to_warehouse_to_local_hub_to_delivery_partner" : row.logisticsMode,
  }));
  const consolidationRows=allRows.filter((row:any)=>isTrueConsolidation(row));
  const isRouteQueueEligible=(row:any)=>!row.isUnassigned && row.physicalReceiptConfirmed===true;
  const routeCategoryFor=(row:any)=>{
    const category=String(row.routeCategory||row.farmerFulfillmentRouteType||"needs_location");
    if(category!=="multi_warehouse")return category;
    const source=String(row.sourceDistrict||"").trim().toLowerCase();
    const destination=String(row.destinationDistrict||"").trim().toLowerCase();
    if(source&&destination&&source!==destination)return "inter_district";
    const hasDistance=row.routeDistanceKm!==null&&row.routeDistanceKm!==undefined&&row.routeDistanceKm!=="";
    const distance=hasDistance?Number(row.routeDistanceKm):Number.NaN;
    const threshold=Number(row.nearbyThresholdKm??15);
    if(source&&destination&&source===destination&&Number.isFinite(distance)){
      if(distance>threshold)return "same_district";
      return row.directDeliveryConfigured?"nearby":"route_review";
    }
    return "needs_location";
  };
  const displayCategory=(row:any)=>isRouteQueueEligible(row)?routeCategoryFor(row):"waiting_receipt";
  const routeRank:Record<string,number>={nearby:0,same_district:1,inter_district:2,route_review:3,needs_location:4,waiting_receipt:5};
  const displayRows=[...rows].sort((a:any,b:any)=>
    Number(isRouteQueueEligible(b))-Number(isRouteQueueEligible(a)) ||
    (routeRank[displayCategory(a)]??4)-(routeRank[displayCategory(b)]??4)
  );
  // Keep each route queue visible even when a category currently has no orders.
  // Counts include only fully received shipments; pre-receipt and unassigned orders
  // remain visible below in a separate operational queue.
  const routeSections=[
    {key:"nearby",title:"Nearby Delivery",subtitle:"Within the configured distance threshold · assign a final-mile delivery partner",accent:"border-emerald-200 bg-emerald-50/50",icon:Truck},
    {key:"same_district",title:"Same-District Warehouse Fulfillment",subtitle:"Beyond the nearby threshold · transfer the sealed order to the local hub",accent:"border-blue-200 bg-blue-50/50",icon:Warehouse},
    {key:"inter_district",title:"Inter-District Warehouse Fulfillment",subtitle:"Transfer to the destination warehouse first, confirm receipt, then send to the local hub",accent:"border-violet-200 bg-violet-50/50",icon:Route},
    {key:"route_review",title:"Route Review Required",subtitle:"Nearby, but direct warehouse-to-customer delivery is not configured for this order",accent:"border-amber-200 bg-amber-50/50",icon:ClipboardCheck},
    {key:"needs_location",title:"Needs Location Data",subtitle:"Add source/customer coordinates or district details to classify the route",accent:"border-amber-200 bg-amber-50/50",icon:ClipboardCheck},
  ];
  const routeOrders:Record<string,any[]> = {
    nearby:displayRows.filter((o:any)=>isRouteQueueEligible(o)&&routeCategoryFor(o)==="nearby"),
    same_district:displayRows.filter((o:any)=>isRouteQueueEligible(o)&&routeCategoryFor(o)==="same_district"),
    inter_district:displayRows.filter((o:any)=>isRouteQueueEligible(o)&&routeCategoryFor(o)==="inter_district"),
    route_review:displayRows.filter((o:any)=>isRouteQueueEligible(o)&&routeCategoryFor(o)==="route_review"),
    needs_location:displayRows.filter((o:any)=>isRouteQueueEligible(o)&&routeCategoryFor(o)==="needs_location"),
  };
  const routeCounts:Record<string,number>={
    nearby:routeOrders.nearby.length,
    same_district:routeOrders.same_district.length,
    inter_district:routeOrders.inter_district.length,
    route_review:routeOrders.route_review.length,
    needs_location:routeOrders.needs_location.length,
  };
  const selectedSameDistrictOrders=routeOrders.same_district.filter((order:any)=>selectedRouteOrders[order.id]&&isRouteQueueEligible(order));
  const selectedInterDistrictOrders=routeOrders.inter_district.filter((order:any)=>selectedRouteOrders[order.id]&&isRouteQueueEligible(order));
  const toggleRouteOrder=(id:string,checked:boolean)=>setSelectedRouteOrders(current=>({...current,[id]:checked}));

  const assignHubPickupTeam=async(order:any)=>{
    const partnerId=selectedHubTeam[order.id];
    if(!partnerId){toast.error("Select an approved pickup team first");return;}
    if(!selectedTeamCanCarry(hubPickupTeams,partnerId,order)){toast.error("Select a pickup team with sufficient configured vehicle capacity");return;}
    try{
      setBusy(order.id+":assignHubTeam");
      await api.put("/warehouse/me/farmer-fulfillment/"+order.id+"/assign-local-hub-pickup-team",undefined,{params:{deliveryPartnerId:partnerId}});
      toast.success("Pickup team assigned. The partner can now start the transfer to the local hub.");
      await refetch();
    }catch(e:any){toast.error(e?.message||"Unable to assign pickup team");}
    finally{setBusy(null);}
  };

  const dispatchDestination=async(order:any)=>{
    try{
      setBusy(order.id+":destination-dispatch");
      // The card action must complete destination selection before attempting
      // to create a transfer manifest. Previously it dispatched immediately,
      // which failed for every inter-district order without a saved destination.
      if(!order.destinationWarehouseId){
        await api.post("/warehouse/me/farmer-fulfillment/"+order.id+"/assign-destination-warehouse");
      }
      await api.post("/warehouse/me/farmer-fulfillment/"+order.id+"/dispatch-to-destination");
      toast.success("Destination warehouse assigned and transfer manifest created. Assign a transfer team to dispatch it.");
      await refetch();
    }
    catch(e:any){toast.error(e?.message||"Unable to assign destination warehouse or create transfer");}
    finally{setBusy(null);}
  };
  const assignDestinationPickupTeam=async(order:any)=>{
    const partnerId=selectedDestinationTeam[order.id];if(!partnerId){toast.error("Select an approved transfer team first");return;}
    if(!selectedTeamCanCarry(hubPickupTeams,partnerId,order)){toast.error("Select a transfer team with sufficient configured vehicle capacity");return;}
    try{setBusy(order.id+":destination-assign");await api.put("/warehouse/me/farmer-fulfillment/"+order.id+"/assign-destination-pickup-team",undefined,{params:{deliveryPartnerId:partnerId}});toast.success("Destination transfer team assigned");await refetch();}
    catch(e:any){toast.error(e?.message||"Unable to assign destination transfer team");}finally{setBusy(null);}
  };
  const receiveDestination=async(order:any)=>{
    try{setBusy(order.id+":destination-receive");await api.post("/warehouse/me/farmer-fulfillment/"+order.id+"/receive-at-destination");toast.success("Destination warehouse receipt confirmed");await refetch();}
    catch(e:any){toast.error(e?.message||"Unable to confirm destination receipt");}finally{setBusy(null);}
  };
  const assignNearbyDeliveryPartner=async(order:any)=>{
    const partnerId=selectedHubTeam[order.id];if(!partnerId){toast.error("Select an approved delivery partner first");return;}
    try{setBusy(order.id+":nearby-assign");await api.put("/warehouse/me/farmer-fulfillment/"+order.id+"/assign-nearby-delivery-partner",undefined,{params:{deliveryPartnerId:partnerId}});toast.success("Final delivery partner assigned");await refetch();}
    catch(e:any){toast.error(e?.message||"Unable to assign final delivery partner");}finally{setBusy(null);}
  };
  const recoverSourceWarehouse=async(order:any)=>{
    try{
      setBusy(order.id+":recover-source");
      await api.post("/warehouse/me/farmer-fulfillment/"+order.id+"/recover-source-warehouse");
      toast.success("Received packed shipment linked to this warehouse. The route is ready for processing.");
      await refetch();
    }catch(e:any){toast.error(e?.message||"Unable to link the packed shipment to this warehouse");}
    finally{setBusy(null);}
  };

  const planSelectedRoutes=async(category:"same_district"|"inter_district")=>{
    const selected=category==="same_district"?selectedSameDistrictOrders:selectedInterDistrictOrders;
    if(!selected.length){toast.error("Select at least one eligible order first");return;}
    setBusy("bulk-route-plan");
    let completed=0;
    const failures:string[]=[];
    try{
      for(const order of selected){
        try{
          if(category==="inter_district"){
            if(!order.destinationWarehouseId){await api.post("/warehouse/me/farmer-fulfillment/"+order.id+"/assign-destination-warehouse");}
            await api.post("/warehouse/me/farmer-fulfillment/"+order.id+"/dispatch-to-destination");
          }else{
            await api.post("/warehouse/me/farmer-fulfillment/"+order.id+"/dispatch-to-local-hub");
          }
          completed++;
        }catch(e:any){failures.push((order.orderNumber||order.id)+": "+(e?.message||"route planning failed"));}
      }
      if(completed){toast.success(category==="inter_district"?"Created destination transfer manifest(s). Assign transfer teams on each order card.":"Created local-hub transfer(s). Assign pickup teams on each order card.");}
      if(failures.length){toast.error(failures.slice(0,2).join("; "));}
      setSelectedRouteOrders(current=>{const next={...current};selected.forEach((order:any)=>{delete next[order.id];});return next;});
      await refetch();
    }finally{setBusy(null);}
  };
  const runTransferAction=async(order:any,action:"dispatch"|"receiveConsolidation"|"completeConsolidation"|"handoffLocalHub"|"confirmHubReceipt")=>{
    const routes={
      dispatch: order.logisticsMode === "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner"
        ? "dispatch-to-consolidation" : "dispatch-to-local-hub",
      receiveConsolidation: "receive-at-consolidation",
      completeConsolidation: "complete-consolidation",
      handoffLocalHub: "handoff-local-hub",
      confirmHubReceipt: "receive-local-hub",
    } as const;
    const messages={
      dispatch: order.logisticsMode === "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner"
        ? "Farmer-packed portion dispatched to consolidation" : "Farmer-packed order dispatched to the local hub",
      receiveConsolidation: "Warehouse portions received at consolidation",
      completeConsolidation: "Consolidation completed",
      handoffLocalHub: "Consolidated order sent to the local hub",
      confirmHubReceipt: "Local hub receipt confirmed; delivery job opened",
    } as const;
    try{
      setBusy(order.id+":"+action);
      await api.post("/warehouse/me/farmer-fulfillment/"+order.id+"/"+routes[action]);
      toast.success(messages[action]);
      await refetch();
    }catch(e:any){toast.error(e?.message||"Unable to update farmer fulfillment transfer");}
    finally{setBusy(null);}
  };

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-sm font-medium text-indigo-600">Farmer Fulfillment</p><h1 className="text-3xl font-bold">Farmer Fulfillment Transfers</h1><p className="mt-1 text-muted-foreground">Manage already-packed orders after physical receipt: transfer to the destination warehouse when required, send to the local hub, and confirm hub receipt. Pickup planning and incoming receipt belong on their own pages.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" size="icon" aria-label="Refresh transfers" onClick={()=>{refetch();}}><RefreshCw className="h-4 w-4"/></Button></div>
    </div>
    <Card className="border-indigo-100 bg-indigo-50/50"><CardContent className="p-5"><div className="flex gap-3"><PackageCheck className="mt-0.5 h-5 w-5 text-indigo-600"/><div className="text-sm"><p className="font-semibold text-indigo-950">Warehouse responsibility</p><p className="mt-1 text-indigo-900/75">This page starts after Incoming Stock confirms physical receipt. Manage downstream transfer stages only: source-to-destination warehouse transfer when required, transfer to the local hub, and confirmation of hub receipt. Farm pickup belongs to Farm Collection and Pickup Routes; receipt belongs to Incoming Stock. Never repack sealed farmer-packed orders.</p></div></div></CardContent></Card>
    <Card className="border-sky-200 bg-sky-50/40">
      <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-lg"><ClipboardCheck className="h-5 w-5 text-sky-700"/>How to process an order — step by step</CardTitle><p className="text-sm text-muted-foreground">Follow these steps the first time you use this page. Counts on the route cards are live orders from the backend, not sample data.</p></CardHeader>
      <CardContent className="space-y-4">
        <ol className="space-y-3 text-sm">
          <li className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-700 text-xs font-bold text-white">1</span><div><p className="font-semibold">Prepare a real packed order</p><p className="mt-1 text-muted-foreground">Use a farmer order that is packed and active. Check that the customer address, source warehouse, coordinates and district are saved on the order/profile. A card in Needs Location Data cannot be routed until those details are corrected.</p></div></li>
          <li className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-700 text-xs font-bold text-white">2</span><div><p className="font-semibold">Record receipt before routing</p><p className="mt-1 text-muted-foreground">Open Incoming Stock, locate the same order, confirm the physical received quantity and quality/receipt checks, then return here and press Refresh. This page must not dispatch stock that has not physically arrived.</p><Button asChild variant="outline" size="sm" className="mt-2"><Link href="/incoming">Open Incoming Stock <ArrowRight className="ml-2 h-4 w-4"/></Link></Button></div></li>
          <li className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-700 text-xs font-bold text-white">3</span><div><p className="font-semibold">Use the route card that matches the order</p><p className="mt-1 text-muted-foreground">The default nearby threshold is 15 km. Nearby orders can be assigned directly only when direct warehouse-to-customer delivery is configured. Same-District orders beyond the threshold go to a local hub. Different-district orders go to a destination warehouse first. If the card says Route Review Required, correct the delivery configuration; if it says Needs Location Data, correct the source/customer location or district.</p></div></li>
          <li className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-700 text-xs font-bold text-white">4</span><div><p className="font-semibold">Select orders and plan transfers</p><p className="mt-1 text-muted-foreground">For Same-District or Inter-District, tick the checkbox on each eligible order and use the matching Plan button. Select an approved team with enough vehicle capacity when prompted. Do not assign the same order to two routes.</p></div></li>
          <li className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-700 text-xs font-bold text-white">5</span><div><p className="font-semibold">Dispatch, confirm each handoff, then verify delivery</p><p className="mt-1 text-muted-foreground">For Inter-District, dispatch the destination manifest and confirm receipt at the destination warehouse first. Then create the local-hub transfer. For Same-District, transfer to the local hub. Confirm physical hub receipt; only then check the final delivery job/partner list. Keep the farmer-packed order sealed—do not repack it as bulk inventory.</p></div></li>
        </ol>
        <div className="rounded-lg border bg-white p-4">
          <p className="font-semibold">Example test cases (illustrations, not inserted orders)</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3"><Badge variant="outline">Nearby</Badge><p className="mt-2 text-sm font-semibold">8 km · direct delivery enabled</p><p className="mt-1 text-xs text-muted-foreground">Expected: Nearby Delivery → choose approved delivery partner → Assign Final Delivery Partner → verify partner job.</p></div>
            <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3"><Badge variant="outline">Same District</Badge><p className="mt-2 text-sm font-semibold">24 km · same district</p><p className="mt-1 text-xs text-muted-foreground">Expected: select order → Plan Same-District Routes → assign pickup team → dispatch to hub → confirm hub receipt → verify final job.</p></div>
            <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3"><Badge variant="outline">Inter-District</Badge><p className="mt-2 text-sm font-semibold">Different source/customer districts</p><p className="mt-1 text-xs text-muted-foreground">Expected: assign destination warehouse → plan/dispatch transfer → confirm destination receipt → transfer to hub → confirm hub receipt → verify final job.</p></div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">These examples explain the expected route only. They do not change the database or increase the live route-card counts.</p>
        </div>
      </CardContent>
    </Card>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Automatic fulfillment route queues">
      {routeSections.map((section:any)=>{
        const SectionIcon=section.icon;
        const orders=routeOrders[section.key]||[];
        return <section key={section.key} className={`flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card shadow-sm ${section.accent}`}>
          <div className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2"><SectionIcon className="mt-0.5 h-5 w-5 shrink-0"/><h2 className="text-sm font-semibold leading-5">{section.title}</h2></div>
              <span className="inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full border bg-background px-2 text-sm font-bold tabular-nums">{isLoading?"—":routeCounts[section.key]}</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{section.subtitle}</p>
          </div>
          <div className="flex-1 border-t bg-background/80 p-3">
            {isLoading?<p className="py-3 text-sm text-muted-foreground">Loading live orders…</p>:orders.length===0?<div className="rounded-lg border border-dashed p-4 text-center"><PackageCheck className="mx-auto h-6 w-6 text-muted-foreground"/><p className="mt-2 text-sm font-medium">No orders in this section</p><p className="mt-1 text-xs text-muted-foreground">Orders are grouped here as soon as this warehouse can classify their route. Unreceived orders are shown but cannot be dispatched yet.</p></div>:
              <div className="grid gap-3">{orders.map((order:any,index:number)=><Card key={order.id} className="overflow-hidden border-slate-200 bg-background transition-shadow hover:shadow-md">
                <CardHeader className="border-b bg-slate-50/80 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-emerald-500 bg-emerald-600 text-sm font-bold text-white">{index+1}</div>
                      <div className="min-w-0"><CardTitle className="truncate text-base">Order #{order.orderNumber||String(order.id).slice(-7)}</CardTitle><p className="mt-1 truncate text-xs text-muted-foreground">{order.farmerName||"Farmer"} · {(order.items||[]).length} item line(s)</p></div>
                    </div>
                    <Badge variant="outline" className="shrink-0">{labels[order.stage]||String(order.stage||"Received").replace(/_/g," ")}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap gap-1.5">
                    {order.routeDistanceKm!==null&&order.routeDistanceKm!==undefined&&<Badge variant="secondary">{Number(order.routeDistanceKm).toFixed(1)} km</Badge>}
                    <Badge variant="outline">{Number(order.nearbyThresholdKm??15)} km threshold</Badge>
                    {!isRouteQueueEligible(order)&&<Badge variant="outline">Waiting for physical receipt</Badge>}
                  </div>
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground"><span>Fulfillment progress</span><span className="font-semibold text-slate-700">{order.transferStatus==="local_hub_ready"?"Completed":order.physicalReceiptConfirmed?"In progress":"Awaiting receipt"}</span></div>
                    <div className="flex items-center gap-1">{["Warehouse","Route","Hub","Delivery"].map((step,i)=>{const status=String(order.transferStatus||"");const done=i===0?Boolean(order.physicalReceiptConfirmed):i===1?["destination_warehouse_in_transit","destination_warehouse_received","hub_handoff_pending","local_hub_ready"].includes(status):i===2?["destination_warehouse_received","local_hub_ready"].includes(status):status==="local_hub_ready";return <div key={step} className="min-w-0 flex-1"><div className={"h-1.5 rounded-full "+(done?"bg-emerald-500":(!order.physicalReceiptConfirmed&&i===0)?"bg-blue-500":"bg-slate-200")}/><p className={"mt-1 text-center text-[10px] font-medium "+(done?"text-emerald-700":"text-slate-400")}>{step}</p></div>;})}</div>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">{!isRouteQueueEligible(order)?"Complete physical receipt in Incoming Stock before starting route actions.":section.key==="nearby"?(order.deliveryPartnerId?"Final delivery partner assigned.":"Assign the final delivery partner below."):section.key==="same_district"?"Select this received order to plan its sealed transfer to the local hub.":section.key==="inter_district"?"Select this received order to plan its destination warehouse transfer.":section.key==="needs_location"?"Add the missing warehouse/customer location or district details before planning this route.":"Direct delivery is not configured. Update the order delivery mode before assigning a partner."}</p>
                  {["same_district","inter_district"].includes(section.key)&&isRouteQueueEligible(order)&&<label className="flex items-center gap-2 rounded-lg border bg-white p-3 text-sm font-medium"><input type="checkbox" checked={Boolean(selectedRouteOrders[order.id])} onChange={e=>toggleRouteOrder(order.id,e.target.checked)}/>Select for {section.key==="inter_district"?"inter-district":"same-district"} route planning</label>}
                  {section.key==="nearby"&&!order.deliveryPartnerId&&order.directDeliveryConfigured&&isRouteQueueEligible(order)&&<div className="space-y-2 rounded-lg border bg-slate-50 p-3"><select aria-label={"Delivery partner for "+(order.orderNumber||order.id)} className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={selectedHubTeam[order.id]||""} onChange={e=>setSelectedHubTeam(prev=>({...prev,[order.id]:e.target.value}))}><option value="">Select approved delivery partner</option>{hubPickupTeams.map((team:any)=><option key={team.id} value={team.deliveryPartnerId}>{team.name} · {team.vehicleType} · {team.capacity} kg</option>)}</select><Button size="sm" className="w-full" onClick={()=>assignNearbyDeliveryPartner(order)} disabled={!selectedHubTeam[order.id]||busy===order.id+":nearby-assign"}>{busy===order.id+":nearby-assign"?"Assigning…":"Assign Final Delivery Partner"}</Button></div>}
                  <Button asChild size="sm" variant="outline" className="w-full"><Link href={"#order-"+order.id}>Open full workflow <ArrowRight className="ml-2 h-4 w-4"/></Link></Button>
                </CardContent>
              </Card>)}</div>}
          </div>
          <div className="border-t bg-background p-3"><p className="text-xs text-muted-foreground">{isLoading?"Loading":`${orders.length} classified order(s) · ${orders.filter((order:any)=>isRouteQueueEligible(order)).length} ready for route actions · threshold ${Number(orders[0]?.nearbyThresholdKm??15)} km`}</p>
            {section.key==="same_district"&&selectedSameDistrictOrders.length>0&&<Button className="mt-2 w-full" size="sm" onClick={()=>planSelectedRoutes("same_district")} disabled={busy==="bulk-route-plan"}>{busy==="bulk-route-plan"?"Planning…":`Plan Same-District Routes (${selectedSameDistrictOrders.length})`}</Button>}
            {section.key==="inter_district"&&selectedInterDistrictOrders.length>0&&<Button className="mt-2 w-full" size="sm" onClick={()=>planSelectedRoutes("inter_district")} disabled={busy==="bulk-route-plan"}>{busy==="bulk-route-plan"?"Planning…":`Plan Inter-District Routes (${selectedInterDistrictOrders.length})`}</Button>}
          </div>
        </section>;
      })}
    </div>
    {unlinkedPackedPackets.length>0&&<Card className="border-amber-300 bg-amber-50/60"><CardContent className="p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="font-semibold text-amber-950">{unlinkedPackedPackets.length} packed packet(s) received but not linked to an order</p><p className="mt-1 text-sm text-amber-900">These packets are visible in Incoming Stock, but the transfer workflow cannot route them until an active order is linked by order ID or order number. Check the packet reference; do not create a duplicate order.</p></div><Button asChild variant="outline"><Link href="/incoming"><ClipboardCheck className="mr-2 h-4 w-4"/>Review Incoming Stock</Link></Button></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{unlinkedPackedPackets.map((packet:any)=><div key={packet.id} className="rounded-lg border border-amber-200 bg-white p-3 text-sm"><p className="font-medium">{packet.orderNumber?`Order #${packet.orderNumber}`:"No order reference"}</p><p className="mt-1 text-xs text-muted-foreground">{packet.productName} · {packet.quantityReceived||0}/{packet.quantity||0} received · {String(packet.status||"unknown").replace(/_/g," ")}</p><Button asChild size="sm" variant="ghost" className="mt-2 h-8 px-2"><Link href={"/incoming?search="+encodeURIComponent(String(packet.orderNumber||packet.id))}>Open packet in Incoming Stock</Link></Button></div>)}</div>
    </CardContent></Card>}
    <Card className="border-slate-200">
      <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="font-semibold">Route category guide</p>
          <p className="mt-1 text-sm text-muted-foreground">Use the category cards above to select and plan same-district or inter-district transfers. Nearby orders are assigned directly to a final delivery partner. Each order card below contains the detailed workflow, transfer stages, and receipt actions.</p>
        </div>
      </CardContent>
    </Card>
    {!isLoading && consolidationRows.length>0 && <Card className="border-amber-200 bg-amber-50/60"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold text-amber-950">Separate multi-warehouse customer orders</p><p className="mt-1 text-sm text-amber-900/80">{consolidationRows.length} order(s) require portions from multiple supply sources for one customer. Manage them on the dedicated consolidation page.</p></div><Button asChild><Link href="/warehouse/multi-warehouse-consolidation"><Warehouse className="mr-2 h-4 w-4"/>Open Multi-Warehouse Consolidation</Link></Button></CardContent></Card>}
    {isLoading?<div className="h-40 animate-pulse rounded-xl bg-muted"/>:isError || data?.success===false || (data===undefined && !isLoading)?<Card className="border-red-200 p-8 text-center"><Warehouse className="mx-auto h-10 w-10 text-red-500"/><p className="mt-3 font-semibold">Unable to load Farmer Fulfillment transfers</p><p className="mt-1 text-sm text-muted-foreground">{error instanceof Error?error.message:"Check that the backend is running and your warehouse account is linked to a warehouse, then retry."}</p><Button className="mt-4" variant="outline" onClick={()=>refetch()}>Retry loading</Button></Card>:rows.length===0?<Card className="border-indigo-100 p-6 sm:p-8">
      <div className="mx-auto max-w-4xl">
        <div className="text-center"><Warehouse className="mx-auto h-12 w-12 text-muted-foreground"/><p className="mt-4 text-xl font-semibold">{consolidationRows.length?"No standard transfers in this queue":"No Farmer Fulfillment orders found for this warehouse"}</p><p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">{consolidationRows.length?"Orders that combine portions from multiple warehouses belong on Multi-Warehouse Consolidation and are kept separate.":"A zero here means the transfer API returned no active farmer orders linked to this warehouse. Counts are real order counts, not packet totals; nine incoming packets may represent fewer orders, and packets without an active linked order cannot be routed."}</p></div>
        {!consolidationRows.length&&<div className="mt-6 rounded-xl border bg-muted/20 p-4 sm:p-5">
          <h2 className="font-semibold">How to get an order into this process</h2>
          <ol className="mt-3 space-y-3 text-sm">
            <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-800">1</span><span>In <strong>Farm Collection</strong>, make sure the packed order pickup is assigned to this warehouse and the team records arrival.</span></li>
            <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-800">2</span><span>In <strong>Incoming Stock</strong>, find each packed packet, check its order reference, and confirm the physically received quantity. Do not repack or store it as bulk stock.</span></li>
            <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-800">3</span><span>Return here and refresh. Each active order assigned to this warehouse is classified by distance and district into Nearby, Same-District, Inter-District, Route Review, or Needs Location Data.</span></li>
            <li className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-800">4</span><span>Use the matching route card: assign a final delivery partner for eligible Nearby orders; create a local-hub transfer for Same-District orders; or send Inter-District orders to their destination warehouse first. Assign teams and confirm physical receipt at each handoff.</span></li>
          </ol>
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950"><strong>If Incoming Stock already shows received packets but this page is empty:</strong> confirm the packet has an order number/order link and that the order’s source warehouse is this warehouse. If these are correct, check that MongoDB is running and reload; without database connectivity neither page can read the saved orders.</p>
        </div>}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button variant="outline" onClick={()=>refetch()}>Refresh transfers</Button>
          {!consolidationRows.length&&<><Button asChild variant="outline"><Link href="/incoming"><ClipboardCheck className="mr-2 h-4 w-4"/>Open Incoming Stock</Link></Button><Button asChild variant="outline"><Link href="/collections"><Truck className="mr-2 h-4 w-4"/>Open Farm Collection</Link></Button></>}
          {consolidationRows.length>0&&<Button asChild><Link href="/warehouse/multi-warehouse-consolidation"><Warehouse className="mr-2 h-4 w-4"/>Open Multi-Warehouse Consolidation ({consolidationRows.length})</Link></Button>}
        </div>
      </div>
    </Card>:
    <div className="space-y-4">{displayRows.length===0?<Card className="border-dashed p-6 text-center"><p className="font-medium">No Farmer Fulfillment orders</p><p className="mt-1 text-sm text-muted-foreground">Orders appear here when they are assigned to this warehouse.</p></Card>:displayRows.map((o:any,index:number)=>{
      const category=displayCategory(o);
      const categoryLabels:Record<string,{title:string,description:string}>={
        waiting_receipt:{title:"Waiting for Receipt or Warehouse Assignment",description:"These orders have not yet passed the full physical-receipt gate at this warehouse, or have no confirmed source warehouse. Complete Incoming Stock receipt or resolve assignment before route classification."},
        nearby:{title:"1. Nearby Delivery",description:"Distance is within the configured nearby threshold. Assign a final delivery partner for direct delivery; do not send these orders through the warehouse-to-hub route."},
        same_district:{title:"2. Same-District Warehouse Fulfillment",description:"Distance is outside the nearby threshold, but farm and customer are in the same district. Send the sealed order from the source warehouse to the local hub."},
        inter_district:{title:"3. Inter-District Warehouse Fulfillment",description:"Farm and customer are in different districts. Transfer to the destination-district warehouse first, confirm receipt, then send to the local hub."},
        route_review:{title:"Route Review Required",description:"The order is within the nearby distance threshold, but it is not configured for direct warehouse-to-customer delivery. Update its delivery configuration before assigning a final-mile partner."},
        needs_location:{title:"Needs Location Data",description:"The backend cannot calculate a reliable distance or determine the district route. Add valid farm and customer coordinates/districts before dispatch."}
      };
      const section=categoryLabels[category]||categoryLabels.needs_location;
      const multi=o.logisticsMode==="farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner";
      const isConsolidationWarehouse=Boolean(o.isConsolidationWarehouse);
      // These values are used by the action buttons below the progress IIFE too.
      const interDistrict=routeCategoryFor(o)==="inter_district";
      const isSource=o.currentWarehouseRole==="source";
      const isDestination=o.currentWarehouseRole==="destination";
      const transferStatus=String(o.transferStatus||"");
      const receivedAtSource=o.physicalReceiptConfirmed===true;
      const lines=o.incoming?.length ? o.incoming : (multi && isConsolidationWarehouse ? (o.warehouseAllocations||[]) : (o.items||[]));
      const receiveCount=o.incoming?.filter((x:any)=>x.status==="received"||x.status==="stored").length||0;
      const qualityCount=o.incoming?.filter((x:any)=>x.qualityCheck==="passed").length||0;
      const storedCount=o.incoming?.filter((x:any)=>x.status==="stored").length||0;
      const allIncomingArrived=Boolean(o.incoming?.length)&&o.incoming.every((x:any)=>Boolean(x.arrivedWarehouseAt));
      const hasUnstoredIncoming=Boolean(o.incoming?.length)&&o.incoming.some((x:any)=>x.status!=="stored");
      return <div key={o.id} className="space-y-3">
      {(index===0||displayCategory(displayRows[index-1])!==category)&&<section className="rounded-xl border bg-muted/20 p-4"><h2 className="text-lg font-semibold">{section.title}</h2><p className="mt-1 text-sm text-muted-foreground">{section.description}</p><p className="mt-2 text-xs text-muted-foreground">{category==="waiting_receipt"?displayRows.filter((x:any)=>displayCategory(x)===category).length:displayRows.filter((x:any)=>isRouteQueueEligible(x)&&displayCategory(x)===category).length} order(s){category!=="waiting_receipt"&&" · nearby threshold "+Number(o.nearbyThresholdKm??15)+" km"}</p></section>}
      <Card id={"order-"+o.id} className="overflow-hidden scroll-mt-24">
        <CardHeader className="pb-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle>#{o.orderNumber}</CardTitle><p className="text-sm text-muted-foreground">{o.farmerName||"Farmer"} - {lines.length} allocated line(s)</p>{["same_district","inter_district"].includes(category)&&receivedAtSource&&!o.isUnassigned&&<label className="mt-3 flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={Boolean(selectedRouteOrders[o.id])} onChange={e=>toggleRouteOrder(o.id,e.target.checked)} /> Select for {category==="inter_district"?"Inter-District":"Same-District"} route planning</label>}</div><Badge variant="outline">{labels[o.stage]||o.stage}</Badge></div></CardHeader>
        <CardContent className="space-y-4">
          <div className="mb-3 flex flex-wrap gap-2">
            <Badge variant="outline">{routeCategoryFor(o)==="inter_district"?"Inter-district transfer":routeCategoryFor(o)==="same_district"?"Same-district transfer":o.logisticsMode==="farmer_to_delivery_partner"||routeCategoryFor(o)==="nearby"?"Direct farm pickup":"Warehouse transfer"}</Badge>
            {o.currentWarehouseRole&&<Badge variant="secondary">This warehouse: {o.currentWarehouseRole==="destination"?"Destination":o.currentWarehouseRole==="source"?"Source":o.currentWarehouseRole==="consolidation"?"Consolidation":"Assigned"}</Badge>}
            {o.sourceDistrict&&<Badge variant="secondary">From district: {o.sourceDistrict}</Badge>}
            {o.destinationDistrict&&<Badge variant="secondary">To district: {o.destinationDistrict}</Badge>}
            {Number.isFinite(Number(o.routeDistanceKm))&&o.routeDistanceKm!==null&&o.routeDistanceKm!==""&&<Badge variant="secondary">Route distance: {Number(o.routeDistanceKm).toFixed(1)} km</Badge>}
            {o.orderStatus&&<Badge variant="outline">Order: {String(o.orderStatus).replace(/_/g," ")}</Badge>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Source warehouse</p><p className="mt-1 font-medium">{o.sourceWarehouseName||"Not assigned"}</p><p className="text-xs text-muted-foreground">{o.sourceDistrict||"Source district not recorded"}</p></div>
            <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Destination warehouse</p><p className="mt-1 font-medium">{o.destinationWarehouseName|| (routeCategoryFor(o)==="inter_district"?"Not assigned yet":"Not required for this route")}</p><p className="text-xs text-muted-foreground">{o.destinationDistrict||"Destination district not recorded"}</p></div>
          </div>
          {(() => {
            const interDistrict = routeCategoryFor(o) === "inter_district";
            const direct = o.logisticsMode === "farmer_to_delivery_partner" || routeCategoryFor(o) === "nearby";
            const isSource = o.currentWarehouseRole === "source";
            const isDestination = o.currentWarehouseRole === "destination";
            const transferStatus = String(o.transferStatus || "");
            const receivedAtSource = o.physicalReceiptConfirmed===true;
            const steps = direct
              ? [{title:"Farm pickup",detail:"Collect the sealed farmer-packed order",done:true},{title:"Delivery partner",detail:"Assign one partner for the final mile",done:Boolean(o.deliveryPartnerId) || ["local_hub_ready","delivered"].includes(o.stage)},{title:"Customer",detail:"Deliver the order",done:o.orderStatus==="delivered"}]
              : interDistrict
                ? [{title:"Farm pickup",detail:"Pickup team collects during 20:00–06:00 IST",done:["warehouse_arrived","received_transfer","quality_approved","stored","destination_warehouse_transfer_pending","hub_handoff_pending","local_hub_ready"].includes(o.stage)},{title:"Source warehouse",detail:"Confirm full physical receipt of the sealed package",done:o.physicalReceiptConfirmed===true},{title:"Destination warehouse",detail:"Transfer across districts during 06:00–20:00 IST",done:["hub_handoff_pending","local_hub_ready"].includes(o.stage)},{title:"Local hub",detail:"Receive shipment and open delivery handoff",done:o.stage==="local_hub_ready"},{title:"Delivery partner",detail:"One partner delivers the complete order",done:o.orderStatus==="delivered"}]
                : [{title:"Farm pickup",detail:"Pickup team collects during 20:00–06:00 IST",done:["warehouse_arrived","received_transfer","quality_approved","stored","hub_handoff_pending","local_hub_ready"].includes(o.stage)},{title:"Source warehouse",detail:"Confirm full physical receipt of the sealed package",done:o.physicalReceiptConfirmed===true},{title:"Local hub",detail:"Transfer during 06:00–20:00 IST",done:o.stage==="local_hub_ready"},{title:"Delivery partner",detail:"One partner delivers to the customer",done:o.orderStatus==="delivered"}];
            const firstPending = steps.findIndex((step:any)=>!step.done);
            return <section aria-label="Fulfillment process" className="rounded-xl border p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">Fulfillment process</h3><p className="text-xs text-muted-foreground">Live progress from the saved order and warehouse status</p></div><Badge variant="outline">{interDistrict?"Inter-district":direct?"Direct delivery":"Same-district"}</Badge></div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {steps.map((step:any,index:number)=><div key={step.title} className={`min-w-0 rounded-lg border p-3 ${step.done?"border-emerald-200 bg-emerald-50/70":index===firstPending?"border-indigo-300 bg-indigo-50/70":"bg-muted/30"}`}>
                  <div className="flex items-center gap-2"><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${step.done?"bg-emerald-600 text-white":index===firstPending?"bg-indigo-600 text-white":"bg-muted text-muted-foreground"}`}>{step.done?"✓":index+1}</span><p className="text-sm font-semibold">{step.title}</p></div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">{step.detail}</p>
                  <p className={`mt-2 text-xs font-medium ${step.done?"text-emerald-700":index===firstPending?"text-indigo-700":"text-muted-foreground"}`}>{step.done?"Completed":index===firstPending?"Current / next step":"Waiting"}</p>
                </div>)}
              </div>
              {interDistrict && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">Inter-district orders must be received at the source, dispatched to the assigned destination warehouse, physically received there, and only then transferred to the local hub.</p>}
              {!interDistrict && !direct && <p className="mt-3 text-xs text-muted-foreground">Operating windows: farm pickup 20:00–06:00 IST · warehouse-to-hub transfer 06:00–20:00 IST. This package stays sealed; no repacking or normal bulk-stock quality workflow.</p>}
            </section>;
          })()}
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-muted-foreground">{o.isUnassigned?"Assignment":isConsolidationWarehouse?"Consolidation Receipt":"Warehouse Receipt"}</p><p className="mt-1 font-medium">{o.isUnassigned?"Not assigned":isConsolidationWarehouse?((o.consolidation?.receivedLegs||0)+"/"+(o.consolidation?.totalLegs||0)+" portions"):(`${receiveCount}/${o.incoming?.length||0} received`)}</p></div>
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-muted-foreground">{o.isUnassigned?"Capacity":isConsolidationWarehouse?"Source Storage":"Quality"}</p><p className="mt-1 font-medium">{o.isUnassigned?"Review required":isConsolidationWarehouse?(o.consolidation?.allSourcePortionsStored?"All source portions stored":"Waiting for source storage"):(`${qualityCount}/${o.incoming?.length||0} approved`)}</p></div>
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-muted-foreground">Stored</p><p className="mt-1 font-medium">{o.isUnassigned?"Not received":isConsolidationWarehouse?(o.consolidation?.allSourcePortionsStored?"All source portions stored":"Not all portions stored"):(`${storedCount}/${o.incoming?.length||0} stored`)}</p></div>
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-muted-foreground">Destination</p><p className="mt-1 font-medium">{o.isUnassigned?"Waiting for source warehouse":isConsolidationWarehouse?"Consolidation intake":multi?("Consolidation · "+(o.consolidationWarehouseName||"Warehouse")):o.currentWarehouseRole==="destination"?("Destination warehouse · "+(o.warehouseName||"Current warehouse")):routeCategoryFor(o)==="inter_district"?("Destination warehouse · "+(o.destinationWarehouseName||"Assignment required")):("Local hub · "+(o.localHubName||"Assigned hub"))}</p></div>
          </div>
          <div className="flex flex-wrap gap-2">{lines.map((i:any,index:number)=><Badge key={[i.warehouseId||"local",i.productId||i.productName||"product",i.variantId||"no-variant",i.incomingStockId||i.id||i.lineId||index].join("-")} variant="secondary">{i.warehouseName?i.warehouseName+" · ":""}{i.productName||"Product"}: {i.expectedQuantity??i.quantity??0} {i.unit||"kg"}</Badge>)}</div>
          {o.isUnassigned&&<div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-950"><p>{o.message||"The order record has no source warehouse assignment."}</p>{o.physicalReceiptConfirmed&&<div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs">A fully received packed shipment is recorded at this warehouse. Link it to this warehouse before planning the route.</p><Button size="sm" onClick={()=>recoverSourceWarehouse(o)} disabled={busy===o.id+":recover-source"}>{busy===o.id+":recover-source"?"Linking…":"Link Received Shipment to This Warehouse"}</Button></div>}</div>}
          {isConsolidationWarehouse&&multi&&<p className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-xs text-indigo-900">This warehouse is the consolidation destination. Receive arriving source portions, complete consolidation only after all source portions are stored and received here, then transfer the single combined order to the local hub.</p>}
          {interDistrict&&isSource&&!receivedAtSource&&<p className="w-full rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">Next action: open Incoming Stock and confirm physical arrival and the complete received quantity. Destination dispatch stays disabled until receipt is complete.</p>}
          {interDistrict&&isSource&&receivedAtSource&&!transferStatus.startsWith("destination_warehouse_")&&!["hub_handoff_pending","local_hub_ready"].includes(transferStatus)&&<p className="w-full rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-950">Next action: create the destination transfer, then assign an approved transfer team below.</p>}
          {interDistrict&&isDestination&&transferStatus==="destination_warehouse_arrived_pending_receipt"&&<p className="w-full rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-950">Next action: verify physical arrival, then click Confirm Destination Receipt. Sending to the local hub is enabled only after receipt.</p>}
          {interDistrict&&isDestination&&transferStatus==="destination_warehouse_received"&&<p className="w-full rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-950">Next action: click Send to Local Hub, then assign an approved local-hub transfer team.</p>}
          {!interDistrict&&!isConsolidationWarehouse&&o.physicalReceiptConfirmed&&!["hub_handoff_pending","hub_arrived_pending_receipt","local_hub_ready"].includes(transferStatus)&&<p className="w-full rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-950">Next action: the sealed order has been physically received. Click Send to Local Hub, assign an approved pickup team, wait for partner arrival, and confirm Local Hub Receipt. Do not repack or send it through bulk-stock quality/storage.</p>}
          {transferStatus==="hub_handoff_pending"&&<p className="w-full rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-950">Next action: select an approved team and click Assign Pickup Team. The partner then starts the transfer and records arrival at the local hub.</p>}
          {transferStatus==="hub_arrived_pending_receipt"&&<p className="w-full rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-950">Next action: the partner recorded arrival. Confirm Local Hub Receipt to make the final delivery job eligible.</p>}
          <section className="rounded-xl border-2 border-indigo-200 bg-indigo-50/60 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Action required for this order</p>
                <p className="mt-1 font-semibold text-indigo-950">{o.isUnassigned ? "Resolve the warehouse assignment before routing" : interDistrict && isSource && !receivedAtSource ? "Record physical shipment receipt" : interDistrict && isSource && transferStatus === "destination_warehouse_transfer_pending" ? "Assign the destination transfer team" : interDistrict && isSource && receivedAtSource ? "Create the destination warehouse transfer" : interDistrict && isDestination && transferStatus === "destination_warehouse_arrived_pending_receipt" ? "Confirm the destination warehouse receipt" : interDistrict && isDestination && transferStatus === "destination_warehouse_received" ? "Send the shipment to the local hub" : transferStatus === "hub_handoff_pending" ? "Assign a team to transfer this order to the local hub" : transferStatus === "hub_arrived_pending_receipt" ? "Confirm the local hub receipt" : category === "nearby" && receivedAtSource ? (o.deliveryPartnerId ? "Final delivery partner assigned" : "Publish the order to an approved delivery partner") : category === "same_district" && receivedAtSource ? "Transfer the sealed order to the local hub" : category === "inter_district" && receivedAtSource ? "Transfer the order to the destination warehouse first" : category === "needs_location" ? "Resolve source/customer location data before routing" : category === "route_review" ? "Review direct-delivery configuration" : ["quality_approved","stored","ready_for_dispatch"].includes(o.stage) && !isConsolidationWarehouse ? "Send this packed order to the local hub" : ["awaiting_warehouse_receipt","source_warehouse_pickup_pending","awaiting_farm_pickup","collection_team_assigned"].includes(o.stage) ? "Track or complete farm pickup" : "Review the order status and follow the enabled action below"}</p>
                <p className="mt-1 text-sm text-indigo-900/80">{o.isUnassigned ? "This order has no confirmed source warehouse, so transfer actions are intentionally unavailable." : !receivedAtSource && ["awaiting_warehouse_receipt","source_warehouse_pickup_pending","awaiting_farm_pickup","collection_team_assigned"].includes(o.stage) ? "Complete pickup tracking only if the package has not arrived. Confirm its actual received quantity in Incoming Stock before downstream transfer." : category === "nearby" ? "The warehouse has received this packet. Publish it to an approved delivery partner for collection from this warehouse and delivery to the customer." : category === "same_district" ? "Select the order and plan a pickup-team transfer to the local hub. Confirm hub receipt before final-mile delivery." : category === "inter_district" ? "Assign the destination warehouse transfer team, confirm destination receipt, then transfer to the local hub." : category === "needs_location" ? "The route cannot be safely calculated from the current source and customer address data. Correct those details before dispatch." : category === "route_review" ? "Nearby distance does not authorize direct delivery unless the order is configured for warehouse-to-customer delivery." : "Continue with the route-specific action once its prerequisites are satisfied."}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {o.isUnassigned&&o.physicalReceiptConfirmed&&<Button onClick={()=>recoverSourceWarehouse(o)} disabled={busy===o.id+":recover-source"}>{busy===o.id+":recover-source"?"Linking…":"Link Received Shipment to This Warehouse"}</Button>}
                {!o.isUnassigned&&!receivedAtSource&&["awaiting_warehouse_receipt","source_warehouse_pickup_pending","awaiting_farm_pickup","collection_team_assigned","warehouse_arrived","partial_received"].includes(String(o.stage||""))&&<Button asChild><Link href={"/incoming?search="+encodeURIComponent(String(o.orderNumber||o.id))}><ClipboardCheck className="mr-2 h-4 w-4"/>Complete Receipt in Incoming Stock</Link></Button>}
                {!o.isUnassigned&&!receivedAtSource&&["awaiting_warehouse_receipt","source_warehouse_pickup_pending","awaiting_farm_pickup","collection_team_assigned"].includes(String(o.stage||""))&&<Button asChild variant="outline"><Link href={"/collections?search="+encodeURIComponent(String(o.orderNumber||o.id))}><Route className="mr-2 h-4 w-4"/>Track Farm Pickup</Link></Button>}
                {!o.isUnassigned&&receivedAtSource&&category==="nearby"&&!o.deliveryPartnerId&&o.directDeliveryConfigured&&<div className="flex flex-wrap items-center gap-2">
                  <select aria-label={"Final delivery partner for "+(o.orderNumber||o.id)} className="h-10 min-w-56 rounded-md border bg-background px-3 text-sm" value={selectedHubTeam[o.id]||""} onChange={e=>setSelectedHubTeam(prev=>({...prev,[o.id]:e.target.value}))}>
                    <option value="">Select approved delivery partner</option>
                    {hubPickupTeams.map((team:any)=><option key={team.id} value={team.deliveryPartnerId}>{team.name||"Delivery partner"} · {team.vehicleType||"Vehicle"} · {team.capacity||0} kg</option>)}
                  </select>
                  <Button onClick={()=>assignNearbyDeliveryPartner(o)} disabled={!selectedHubTeam[o.id]||busy===o.id+":nearby-assign"}>{busy===o.id+":nearby-assign"?"Publishing…":"Publish to Delivery Partners"}</Button>
                </div>}
                {!o.isUnassigned&&receivedAtSource&&category==="nearby"&&o.deliveryPartnerId&&<Badge variant="success"><CheckCircle2 className="mr-1 h-3 w-3"/>Delivery partner assigned</Badge>}
                {!o.isUnassigned&&receivedAtSource&&category==="needs_location"&&<p className="max-w-sm text-sm text-amber-900">Correct the source warehouse and customer delivery address/coordinates before assigning this order.</p>}
                {!o.isUnassigned&&receivedAtSource&&category==="route_review"&&<p className="max-w-sm text-sm text-amber-900">Configure direct warehouse-to-customer delivery or correct the route data before assigning a partner.</p>}
              </div>
            </div>
          </section>
          {["awaiting_warehouse_receipt","source_warehouse_pickup_pending","awaiting_farm_pickup","collection_team_assigned"].includes(String(o.stage||"")) && <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4"><p className="font-semibold text-amber-950">Waiting for physical receipt</p><p className="mt-1 text-sm text-amber-900">Complete farm pickup in Farm Collection / Pickup Routes, then confirm actual receipt in Incoming Stock. Downstream transfer actions remain unavailable until receipt is recorded.</p><div className="mt-3 flex flex-wrap gap-2"><Button asChild variant="outline"><Link href={"/collections?search="+encodeURIComponent(String(o.orderNumber||o.id))}><Route className="mr-2 h-4 w-4"/>Open Farm Collection</Link></Button><Button asChild variant="outline"><Link href={"/incoming?search="+encodeURIComponent(String(o.orderNumber||o.id))}><ClipboardCheck className="mr-2 h-4 w-4"/>Open Incoming Stock</Link></Button></div></section>}
          <div className="flex flex-wrap justify-end gap-2">
            {["awaiting_warehouse_receipt","source_warehouse_pickup_pending","awaiting_farm_pickup","collection_team_assigned","warehouse_arrived","partial_received"].includes(String(o.stage||""))&&<Button asChild variant="outline"><Link href={"/incoming?search="+encodeURIComponent(String(o.orderNumber||o.id))}><ClipboardCheck className="mr-2 h-4 w-4"/>Complete Receipt in Incoming Stock</Link></Button>}
            {o.incoming?.some((x:any)=>x.status==="received"&&Number(x.quantityReceived??0)+1e-9<Number(x.quantity??0))&&<Badge variant="outline" className="self-center">Partial receipt — resolve quantity discrepancy in Incoming Stock before dispatch</Badge>}
            {interDistrict&&isSource&&<Button onClick={()=>dispatchDestination(o)} disabled={!receivedAtSource||!o.destinationWarehouseId||["destination_warehouse_transfer_pending","destination_warehouse_in_transit","destination_warehouse_arrived_pending_receipt","destination_warehouse_received","hub_handoff_pending","local_hub_ready"].includes(transferStatus)||busy===o.id+":destination-dispatch"}><Truck className="mr-2 h-4 w-4"/>{busy===o.id+":destination-dispatch"?"Dispatching…":"Create Destination Transfer"}</Button>}
            {interDistrict&&isSource&&transferStatus==="destination_warehouse_transfer_pending"&&<div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
              <label className="text-sm font-medium text-indigo-950" htmlFor={"destination-team-"+o.id}>Warehouse transfer team</label>
              <select id={"destination-team-"+o.id} className="h-10 min-w-56 rounded-md border bg-white px-3 text-sm text-slate-900" value={selectedDestinationTeam[o.id]||""} onChange={e=>setSelectedDestinationTeam(prev=>({...prev,[o.id]:e.target.value}))}>
                <option value="">Select approved pickup team</option>
                {hubPickupTeams.map((team:any)=><option key={team.id} value={team.deliveryPartnerId} disabled={!teamCanCarry(team,o)}>{team.name||"Pickup Partner"} · {team.vehicleType||"Vehicle"} · {team.capacity||0} kg{teamCanCarry(team,o)?"":" · insufficient capacity"}</option>)}
              </select>
              <Button onClick={()=>assignDestinationPickupTeam(o)} disabled={!selectedTeamCanCarry(hubPickupTeams,selectedDestinationTeam[o.id],o)||busy===o.id+":destination-assign"}>{busy===o.id+":destination-assign"?"Assigning…":"Assign Transfer Team"}</Button>
            </div>}
            {interDistrict&&isDestination&&<Button onClick={()=>receiveDestination(o)} disabled={transferStatus!=="destination_warehouse_arrived_pending_receipt"||busy===o.id+":destination-receive"}><CheckCircle2 className="mr-2 h-4 w-4"/>{busy===o.id+":destination-receive"?"Confirming…":"Confirm Destination Receipt"}</Button>}
            {interDistrict&&isDestination&&<Button onClick={()=>runTransferAction(o,"handoffLocalHub")} disabled={transferStatus!=="destination_warehouse_received"||busy===o.id+":handoffLocalHub"}><ArrowRight className="mr-2 h-4 w-4"/>Send to Local Hub</Button>}
            {interDistrict&&<p className="w-full rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">Inter-district route: send to the destination warehouse first. The local-hub button remains disabled until destination receipt is confirmed.</p>}
            {category==="same_district"&&!interDistrict&&!isConsolidationWarehouse&&o.physicalReceiptConfirmed&&<Button onClick={()=>runTransferAction(o,"dispatch")} disabled={busy===o.id+":dispatch"}><ArrowRight className="mr-2 h-4 w-4"/>{busy===o.id+":dispatch"?"Dispatching…":multi?"Send to Consolidation":"Send to Local Hub"}</Button>}
            {isConsolidationWarehouse&&o.consolidation?.canReceive&&<Button onClick={()=>runTransferAction(o,"receiveConsolidation")} disabled={busy===o.id+":receiveConsolidation"}><CheckCircle2 className="mr-2 h-4 w-4"/>{busy===o.id+":receiveConsolidation"?"Receiving…":("Confirm Arrived Portions ("+o.consolidation.inTransitLegs+")")}</Button>}
            {isConsolidationWarehouse&&o.consolidation?.canComplete&&<Button onClick={()=>runTransferAction(o,"completeConsolidation")} disabled={busy===o.id+":completeConsolidation"}><PackageCheck className="mr-2 h-4 w-4"/>{busy===o.id+":completeConsolidation"?"Completing…":"Complete Consolidation"}</Button>}
            {isConsolidationWarehouse&&o.consolidation?.canHandoffLocalHub&&<Button onClick={()=>runTransferAction(o,"handoffLocalHub")} disabled={busy===o.id+":handoffLocalHub"}><ArrowRight className="mr-2 h-4 w-4"/>{busy===o.id+":handoffLocalHub"?"Sending…":"Send Consolidated Order to Local Hub"}</Button>}
            {o.transferStatus==="hub_handoff_pending"&&<div className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
              <label className="text-sm font-medium text-indigo-950" htmlFor={"hub-team-"+o.id}>Local-hub transfer team</label>
              <select id={"hub-team-"+o.id} className="h-10 min-w-56 rounded-md border bg-white px-3 text-sm text-slate-900" value={selectedHubTeam[o.id]||""} onChange={e=>setSelectedHubTeam(prev=>({...prev,[o.id]:e.target.value}))}>
                <option value="">Select approved pickup team</option>
                {hubPickupTeams.map((team:any)=><option key={team.id} value={team.deliveryPartnerId} disabled={!teamCanCarry(team,o)}>{team.name||"Pickup Partner"} · {team.vehicleType||"Vehicle"} · {team.capacity||0} kg{teamCanCarry(team,o)?"":" · insufficient capacity"}</option>)}
              </select>
              <Button onClick={()=>assignHubPickupTeam(o)} disabled={!selectedTeamCanCarry(hubPickupTeams,selectedHubTeam[o.id],o)||busy===o.id+":assignHubTeam"}>{busy===o.id+":assignHubTeam"?"Assigning…":"Assign Pickup Team"}</Button>
            </div>}
            {(o.transferStatus==="hub_arrived_pending_receipt"||isConsolidationWarehouse&&o.consolidation?.canConfirmHubReceipt)&&<Button onClick={()=>runTransferAction(o,"confirmHubReceipt")} disabled={busy===o.id+":confirmHubReceipt"}><CheckCircle2 className="mr-2 h-4 w-4"/>{busy===o.id+":confirmHubReceipt"?"Confirming…":"Confirm Local Hub Receipt"}</Button>}
            {o.stage==="hub_handoff_pending"&&o.transferStatus!=="hub_arrived_pending_receipt"&&<Badge variant="outline" className="self-center">Transfer assigned/in progress · waiting for hub arrival</Badge>}
            {o.stage==="local_hub_ready"&&<Badge variant="success" className="self-center"><CheckCircle2 className="mr-1 h-3 w-3"/>Local hub received · Delivery job ready</Badge>}
          </div>
        </CardContent>
      </Card>
      </div>;
    })}</div>}
  </div>;
}
