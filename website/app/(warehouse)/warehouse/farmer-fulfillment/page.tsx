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
  const [activeRouteSection,setActiveRouteSection]=useState("nearby");
  const [activeInterDistrictSection,setActiveInterDistrictSection]=useState<"outbound"|"inbound">("outbound");
  const [selectedHubTeam,setSelectedHubTeam]=useState<Record<string,string>>({});
  const [selectedDestinationTeam,setSelectedDestinationTeam]=useState<Record<string,string>>({});
  const [selectedRouteOrders,setSelectedRouteOrders]=useState<Record<string,boolean>>({});
  const [destinationCapacityAcknowledged,setDestinationCapacityAcknowledged]=useState<Record<string,boolean>>({});
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
  const interDistrictOutboundOrders=routeOrders.inter_district.filter((order:any)=>order.currentWarehouseRole==="source");
  const interDistrictInboundOrders=routeOrders.inter_district.filter((order:any)=>order.currentWarehouseRole==="destination");
  const activeInterDistrictOrders=activeInterDistrictSection==="outbound"
    ?interDistrictOutboundOrders
    :interDistrictInboundOrders;
  const activeRouteOrders=activeRouteSection==="inter_district"
    ?activeInterDistrictOrders
    :routeOrders[activeRouteSection]||[];
  const waitingReceiptRows=displayRows.filter((order:any)=>!isRouteQueueEligible(order));
  const visibleRows=[...activeRouteOrders,...waitingReceiptRows];
  const selectedSameDistrictOrders=routeOrders.same_district.filter((order:any)=>selectedRouteOrders[order.id]&&isRouteQueueEligible(order));
  const selectedInterDistrictOrders=routeOrders.inter_district.filter((order:any)=>selectedRouteOrders[order.id]&&isRouteQueueEligible(order));
  const selectedHubRouteOrders=selectedSameDistrictOrders.filter((order:any)=>!["hub_handoff_pending","hub_arrived_pending_receipt","local_hub_ready"].includes(String(order.transferStatus||"")));
  const selectedDestinationRouteOrders=selectedInterDistrictOrders.filter((order:any)=>!["destination_warehouse_transfer_pending","destination_warehouse_in_transit","destination_warehouse_arrived_pending_receipt","destination_warehouse_received","hub_handoff_pending","hub_arrived_pending_receipt","local_hub_ready"].includes(String(order.transferStatus||"")));
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
      let assignment:any;
      if(!order.destinationWarehouseId){
        assignment=await api.post("/warehouse/me/farmer-fulfillment/"+order.id+"/assign-destination-warehouse");
      }
      if(assignment?.data?.destinationWarehouseCapacityOverrideRequired){
        toast.error(assignment.message||"Review the destination capacity warning and confirm before dispatch.");
        await refetch();
        return;
      }
      const capacityOverrideConfirmed=Boolean(
        order.destinationWarehouseCapacityOverrideRequired&&destinationCapacityAcknowledged[order.id]
      );
      if(order.destinationWarehouseCapacityOverrideRequired&&!capacityOverrideConfirmed){
        toast.error("Confirm the destination can physically receive this sealed shipment before dispatch.");
        return;
      }
      await api.post(
        "/warehouse/me/farmer-fulfillment/"+order.id+"/dispatch-to-destination",
        undefined,
        {params:capacityOverrideConfirmed?{capacityOverrideConfirmed:true}:undefined},
      );
      toast.success(assignment?.message||"Destination warehouse assigned and transfer manifest created. Assign a transfer team to dispatch it.");
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
            if(!order.destinationWarehouseId){
              const assignment=await api.post("/warehouse/me/farmer-fulfillment/"+order.id+"/assign-destination-warehouse");
              if(assignment?.data?.destinationWarehouseCapacityOverrideRequired){
                failures.push((order.orderNumber||order.id)+": "+(assignment.message||"Destination capacity confirmation is required. Review the order card."));
                continue;
              }
            }
            if(order.destinationWarehouseCapacityOverrideRequired){
              failures.push((order.orderNumber||order.id)+": Destination capacity confirmation is required. Review the order card.");
              continue;
            }
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
      <div><p className="text-sm font-medium text-indigo-600">Farmer Fulfillment</p><h1 className="text-3xl font-bold">Farmer Fulfillment Transfers</h1></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" size="icon" aria-label="Refresh transfers" onClick={()=>{refetch();}}><RefreshCw className="h-4 w-4"/></Button></div>
    </div>
    <Card className="border-indigo-100 bg-indigo-50/50"><CardContent className="p-5"><div className="flex gap-3"><PackageCheck className="mt-0.5 h-5 w-5 text-indigo-600"/><div className="text-sm"><p className="font-semibold text-indigo-950">End-to-end farmer-to-customer workflow</p><p className="mt-1 text-indigo-900/75">Start with orders marked Ready for Pickup, collect the sealed farmer-packed order, confirm warehouse receipt, route it to the destination warehouse when inter-district, transfer it to the local hub, confirm hub receipt, and assign the final-mile delivery partner. Each button opens the correct operational page or performs the next eligible action. Physical receipt must be confirmed by the receiving staff; the system never fakes an arrival.</p></div></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-amber-200 bg-white p-3"><p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Step 1 · Farm pickup</p><p className="mt-1 text-sm text-slate-700">Select ready collection jobs and create/assign pickup routes.</p><div className="mt-3 flex flex-wrap gap-2"><Button asChild size="sm"><Link href="/collections"><Truck className="mr-2 h-4 w-4"/>Farm Collection</Link></Button><Button asChild size="sm" variant="outline"><Link href="/pickup-routes"><Route className="mr-2 h-4 w-4"/>Pickup Routes</Link></Button></div></div>
        <div className="rounded-lg border border-sky-200 bg-white p-3"><p className="text-xs font-semibold uppercase tracking-wide text-sky-800">Step 2 · Receive stock</p><p className="mt-1 text-sm text-slate-700">Record actual quantity and confirm physical receipt and required checks.</p><Button asChild size="sm" className="mt-3"><Link href="/incoming"><PackageCheck className="mr-2 h-4 w-4"/>Incoming Stock</Link></Button></div>
        <div className="rounded-lg border border-violet-200 bg-white p-3"><p className="text-xs font-semibold uppercase tracking-wide text-violet-800">Step 3 · Warehouse delivery route</p><p className="mt-1 text-sm text-slate-700">Select orders, create destination/local-hub manifests, assign eligible teams and confirm arrivals.</p><Button size="sm" className="mt-3" onClick={()=>refetch()}><RefreshCw className="mr-2 h-4 w-4"/>Refresh Route Queue</Button></div>
        <div className="rounded-lg border border-emerald-200 bg-white p-3"><p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Step 4 · Final delivery</p><p className="mt-1 text-sm text-slate-700">After hub receipt, verify the delivery job and assign a final-mile partner.</p><Button asChild size="sm" className="mt-3" variant="outline"><Link href="/delivery"><Truck className="mr-2 h-4 w-4"/>Delivery Operations</Link></Button></div>
      </div>
    </CardContent></Card>
    <Card className="border-emerald-200 bg-emerald-50/30" id="full-workflow">
      <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-lg"><Route className="h-5 w-5 text-emerald-700"/>Farm-to-Customer Fulfillment Flowchart</CardTitle><p className="text-sm text-muted-foreground">Use these buttons to follow the complete process from farmer pickup to customer delivery. Each handoff must be recorded by the team responsible for it.</p></CardHeader>
      <CardContent><div className="mx-auto max-w-4xl space-y-2">
        <div className="rounded-xl border-2 border-emerald-300 bg-white p-4 text-center"><p className="font-semibold">1 · Farmer packs order → marks Ready for Pickup</p><p className="mt-1 text-sm text-muted-foreground">Keep the customer packet sealed. Never repack it as bulk stock.</p></div>
        <div className="text-center text-emerald-700"><ArrowRight className="mx-auto h-5 w-5 rotate-90"/></div>
        <div className="rounded-xl border bg-white p-4 text-center"><p className="font-semibold">2 · Farm Collection → Pickup Routes</p><p className="mt-1 text-sm text-muted-foreground">Select ready pickups, choose a vehicle with enough capacity, create/offer the route, assign/accept a partner, record collection and departure.</p><div className="mt-3 flex flex-wrap justify-center gap-2"><Button asChild size="sm"><Link href="/collections">Open Farm Collection <ArrowRight className="ml-2 h-4 w-4"/></Link></Button><Button asChild size="sm" variant="outline"><Link href="/pickup-routes">Open Pickup Routes <Truck className="ml-2 h-4 w-4"/></Link></Button></div></div>
        <div className="text-center text-emerald-700"><ArrowRight className="mx-auto h-5 w-5 rotate-90"/></div>
        <div className="rounded-xl border bg-white p-4 text-center"><p className="font-semibold">3 · Incoming Stock — confirm actual receipt</p><p className="mt-1 text-sm text-muted-foreground">Match the packet/order, record received quantity, finish required checks, and confirm receipt. Routing stays blocked until physical receipt is recorded.</p><div className="mt-3"><Button asChild size="sm"><Link href="/incoming">Open Incoming Stock <ClipboardCheck className="ml-2 h-4 w-4"/></Link></Button></div></div>
        <div className="text-center text-emerald-700"><ArrowRight className="mx-auto h-5 w-5 rotate-90"/></div>
        <div className="rounded-xl border-2 border-indigo-300 bg-white p-4 text-center"><p className="font-semibold">4 · This page classifies the route (15 km threshold)</p><p className="mt-1 text-sm text-muted-foreground">Source warehouse and customer address/district determine the route. Select a queue below to continue.</p><div className="mt-3 flex flex-wrap justify-center gap-2"><Button asChild size="sm" variant="outline"><Link href="#route-nearby">Nearby</Link></Button><Button asChild size="sm" variant="outline"><Link href="#route-same_district">Same District</Link></Button><Button asChild size="sm" variant="outline"><Link href="#route-inter_district">Inter-District</Link></Button></div></div>
        <div className="text-center text-emerald-700"><ArrowRight className="mx-auto h-5 w-5 rotate-90"/></div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4"><p className="font-semibold text-emerald-950">A · Nearby (within 15 km)</p><p className="mt-1 text-sm">When direct delivery is configured, choose an approved delivery partner and publish/assign the sealed order.</p><Button asChild size="sm" variant="outline" className="mt-3 w-full"><Link href="#route-nearby">Open Nearby queue</Link></Button></div>
          <div className="rounded-xl border border-blue-300 bg-blue-50 p-4"><p className="font-semibold text-blue-950">B · Same District (over 15 km)</p><p className="mt-1 text-sm">Select orders → plan local-hub route → assign pickup team → dispatch → confirm hub receipt.</p><Button asChild size="sm" variant="outline" className="mt-3 w-full"><Link href="#route-same_district">Open Same-District queue</Link></Button></div>
          <div className="rounded-xl border border-violet-300 bg-violet-50 p-4"><p className="font-semibold text-violet-950">C · Inter-District</p><p className="mt-1 text-sm">Assign destination warehouse → plan transfer → assign team → dispatch → confirm destination receipt → send to local hub → confirm hub receipt.</p><Button asChild size="sm" variant="outline" className="mt-3 w-full"><Link href="#route-inter_district">Open Inter-District queue</Link></Button></div>
        </div>
        <div className="text-center text-emerald-700"><ArrowRight className="mx-auto h-5 w-5 rotate-90"/></div>
        <div className="rounded-xl border-2 border-emerald-300 bg-white p-4 text-center"><p className="font-semibold">5 · Local hub confirms receipt → final-mile delivery</p><p className="mt-1 text-sm text-muted-foreground">Verify the delivery job and assign an approved final-mile partner. The delivery workflow must record the customer's delivery confirmation.</p></div>
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><strong>Exception path:</strong> If source/customer address, coordinates, district, vehicle capacity, or warehouse assignment is missing, resolve it before dispatch. Never confirm a physical handoff that has not happened.</p>
      </div></CardContent>
    </Card>
    <Card className="border-sky-200 bg-sky-50/30">
      <CardHeader className="border-b bg-white/70">
        <CardTitle className="flex items-center gap-2 text-lg"><ClipboardCheck className="h-5 w-5 text-sky-700"/>Customer Delivery Service & Event Order Flowcharts</CardTitle>
        <p className="text-sm text-muted-foreground">Operational decision flows for regular customer orders and planned/urgent event orders. Time windows are interpreted in local service time; actual partner availability and ETA must come from live backend data.</p>
      </CardHeader>
      <CardContent className="grid gap-4 p-4 xl:grid-cols-2">
        <section className="rounded-xl border bg-white p-4">
          <h3 className="font-semibold text-slate-950">A · Regular Customer Order</h3>
          <div className="mt-3 space-y-2 text-center text-sm">
            <div className="rounded-lg border-2 border-slate-300 p-3"><strong>Customer checkout → Check stock</strong><p className="mt-1 text-muted-foreground">Out of stock → block order. In stock → continue.</p></div>
            <div className="text-slate-400">↓</div>
            <div className="rounded-lg border p-3"><strong>Check delivery service time</strong><p className="mt-1 text-muted-foreground">21:30–06:00 → accept if policy permits and schedule 06:00 delivery. 06:00–21:30 → search available partners.</p></div>
            <div className="text-slate-400">↓</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3"><strong>No eligible partner</strong><p className="mt-1 text-muted-foreground">Show the next available time; do not invent a partner.</p></div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3"><strong>Partner available</strong><p className="mt-1 text-muted-foreground">Calculate live ETA. ≤30 min: fastest option. &gt;30 min: standard option.</p></div>
            </div>
            <div className="text-slate-400">↓</div>
            <div className="rounded-lg border p-3"><strong>Confirm order → Farmer fulfillment → Packing complete</strong><p className="mt-1 text-muted-foreground">Then follow the Farm-to-Customer Fulfillment Flowchart above for pickup, warehouse/hub transfers, and final delivery.</p></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild size="sm"><Link href="/checkout">Open Customer Checkout <ArrowRight className="ml-2 h-4 w-4"/></Link></Button>
            <Button size="sm" variant="outline" onClick={()=>{document.getElementById("full-workflow")?.scrollIntoView({behavior:"smooth",block:"start"});}}>Open Fulfillment Flow</Button>
          </div>
        </section>
        <section className="rounded-xl border bg-white p-4">
          <h3 className="font-semibold text-slate-950">B · Event / Bulk Order</h3>
          <div className="mt-3 space-y-2 text-center text-sm">
            <div className="rounded-lg border-2 border-slate-300 p-3"><strong>Create event order</strong><p className="mt-1 text-muted-foreground">Event date · delivery date/time · guest count · products and quantities.</p></div>
            <div className="text-slate-400">↓</div>
            <div className="rounded-lg border p-3"><strong>Check time until delivery</strong><p className="mt-1 text-muted-foreground">≤24 hours → urgent event. &gt;24 hours → planned event.</p></div>
            <div className="text-slate-400">↓</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3"><strong>Urgent event</strong><p className="mt-1 text-muted-foreground">Smart sourcing with availability and delivery deadline checks.</p></div>
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3"><strong>Planned event</strong><p className="mt-1 text-muted-foreground">Smart sourcing and planned fulfillment before the event deadline.</p></div>
            </div>
            <div className="text-slate-400">↓</div>
            <div className="rounded-lg border p-3"><strong>Source stock → receive/verify portions → consolidate if multiple sources → local hub → final delivery</strong><p className="mt-1 text-muted-foreground">Use consolidation for a single event order that combines products from multiple farmers/warehouses. Confirm each real receipt before the next leg.</p></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild size="sm"><Link href="/marketplace">Open Marketplace <ArrowRight className="ml-2 h-4 w-4"/></Link></Button>
            <Button asChild size="sm" variant="outline"><Link href="/warehouse/consolidation">Open Multi-Warehouse Consolidation <ArrowRight className="ml-2 h-4 w-4"/></Link></Button>
          </div>
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">The 24-hour event split is shown here as the requested workflow. The event-order creation form, deadline validation, smart-sourcing engine, and live ETA must be connected to their actual business/order APIs before this flow can be considered fully automated.</p>
        </section>
      </CardContent>
    </Card>
    <Card className="border-emerald-200 bg-emerald-50/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg"><Route className="h-5 w-5 text-emerald-700"/>Delivery Route Planning</CardTitle>
        <p className="text-sm text-muted-foreground">Use the same select → plan → assign vehicle/team → track route workflow as Farm Collection. These are already-packed customer orders, so each route stop carries a sealed order packet and no order is repacked.</p>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-blue-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-blue-950">Same-District · Local Hub Route</h3><Badge variant="outline">{selectedHubRouteOrders.length} selected</Badge></div>
          <p className="mt-2 text-sm text-muted-foreground">Select orders in the Same-District section, then create their warehouse-to-hub manifests. Assign an approved pickup vehicle to each order and track departure and hub arrival.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={()=>planSelectedRoutes("same_district")} disabled={!selectedHubRouteOrders.length||busy==="bulk-route-plan"}>{busy==="bulk-route-plan"?"Planning route…":`Plan Local Hub Route (${selectedHubRouteOrders.length})`}</Button>
            <Button size="sm" variant="outline" onClick={()=>setSelectedRouteOrders(current=>{const next={...current};routeOrders.same_district.forEach((o:any)=>{if(isRouteQueueEligible(o))next[o.id]=true;});return next;})} disabled={!routeOrders.same_district.length}>Select All Eligible</Button>
            <Button size="sm" variant="ghost" onClick={()=>setSelectedRouteOrders(current=>{const next={...current};routeOrders.same_district.forEach((o:any)=>delete next[o.id]);return next;})}>Clear Selection</Button>
          </div>
        </div>
        <div className="rounded-xl border border-violet-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-violet-950">Inter-District · Destination Warehouse Route</h3><Badge variant="outline">{selectedDestinationRouteOrders.length} selected</Badge></div>
          <p className="mt-2 text-sm text-muted-foreground">Create the destination manifest first. Assign an approved transfer vehicle/team, confirm destination receipt, and only then create the local-hub route.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={()=>planSelectedRoutes("inter_district")} disabled={!selectedDestinationRouteOrders.length||busy==="bulk-route-plan"}>{busy==="bulk-route-plan"?"Planning route…":`Plan Destination Route (${selectedDestinationRouteOrders.length})`}</Button>
            <Button size="sm" variant="outline" onClick={()=>setSelectedRouteOrders(current=>{const next={...current};routeOrders.inter_district.forEach((o:any)=>{if(isRouteQueueEligible(o))next[o.id]=true;});return next;})} disabled={!routeOrders.inter_district.length}>Select All Eligible</Button>
            <Button size="sm" variant="ghost" onClick={()=>setSelectedRouteOrders(current=>{const next={...current};routeOrders.inter_district.forEach((o:any)=>delete next[o.id]);return next;})}>Clear Selection</Button>
          </div>
        </div>
        <div className="md:col-span-2 rounded-lg border bg-white p-3 text-sm text-slate-700">
          <strong>Route lifecycle:</strong> Select eligible orders → Plan route/manifests → Assign approved vehicle/team with sufficient capacity → Partner starts route and records arrival → receiving warehouse confirms physical receipt → plan the next leg. Route creation never confirms physical receipt automatically.
        </div>
      </CardContent>
    </Card>
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
    <section className="space-y-4" aria-label="Farmer fulfillment route sections">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 md:grid-cols-3 xl:grid-cols-5" role="tablist" aria-label="Fulfillment route categories">
        {routeSections.map((section:any)=>{
          const SectionIcon=section.icon;
          const selected=activeRouteSection===section.key;
          return <button
            key={section.key}
            id={`fulfillment-tab-${section.key}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`fulfillment-panel-${section.key}`}
            onClick={()=>setActiveRouteSection(section.key)}
            className={`flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition ${selected?"bg-emerald-600 text-white shadow-sm":"bg-white text-slate-600 hover:bg-emerald-50 hover:text-emerald-700"}`}
          >
            <SectionIcon className="h-4 w-4 shrink-0"/>
            <span className="truncate">{section.title}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${selected?"bg-white/20 text-white":"bg-emerald-100 text-emerald-700"}`}>{isLoading?"—":routeCounts[section.key]}</span>
          </button>;
        })}
      </div>
      {routeSections.filter((section:any)=>section.key===activeRouteSection).map((section:any)=>{
        const SectionIcon=section.icon;
        return <section key={section.key} id={`fulfillment-panel-${section.key}`} role="tabpanel" aria-labelledby={`fulfillment-tab-${section.key}`} className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100"><SectionIcon className="h-5 w-5 text-emerald-700"/></span>
                <div className="min-w-0"><h2 className="text-lg font-bold leading-6 text-slate-900">{section.title}</h2><p className="mt-1 text-sm leading-5 text-muted-foreground">{section.subtitle}</p></div>
              </div>
              <span className="inline-flex h-9 min-w-9 shrink-0 items-center justify-center self-start rounded-full bg-emerald-50 px-3 text-sm font-bold tabular-nums text-emerald-800">{isLoading?"—":routeCounts[section.key]}</span>
            </div>
          </div>
          <div className="p-4 sm:p-5">
            {section.key==="inter_district"&&<div className="mb-4">
              <div className="grid grid-cols-1 gap-1 rounded-xl bg-slate-100 p-1 sm:grid-cols-2" role="tablist" aria-label="Inter-district transfer stages">
                <button type="button" role="tab" aria-selected={activeInterDistrictSection==="outbound"} onClick={()=>setActiveInterDistrictSection("outbound")} className={`flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${activeInterDistrictSection==="outbound"?"bg-emerald-600 text-white shadow-sm":"bg-white text-slate-600 hover:bg-emerald-50 hover:text-emerald-700"}`}>
                  <Truck className="h-4 w-4"/><span>Send to Destination Warehouse</span><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${activeInterDistrictSection==="outbound"?"bg-white/20 text-white":"bg-emerald-100 text-emerald-700"}`}>{isLoading?"—":interDistrictOutboundOrders.length}</span>
                </button>
                <button type="button" role="tab" aria-selected={activeInterDistrictSection==="inbound"} onClick={()=>setActiveInterDistrictSection("inbound")} className={`flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${activeInterDistrictSection==="inbound"?"bg-emerald-600 text-white shadow-sm":"bg-white text-slate-600 hover:bg-emerald-50 hover:text-emerald-700"}`}>
                  <Warehouse className="h-4 w-4"/><span>Received from Other Warehouse</span><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${activeInterDistrictSection==="inbound"?"bg-white/20 text-white":"bg-emerald-100 text-emerald-700"}`}>{isLoading?"—":interDistrictInboundOrders.length}</span>
                </button>
              </div>
            </div>}
          </div>
        </section>;
      })}
    </section>
    {unlinkedPackedPackets.length>0&&<Card className="border-amber-300 bg-amber-50/60"><CardContent className="p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="font-semibold text-amber-950">{unlinkedPackedPackets.length} received packet(s) need an order link</p></div><Button asChild variant="outline"><Link href="/incoming"><ClipboardCheck className="mr-2 h-4 w-4"/>Review Incoming Stock</Link></Button></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{unlinkedPackedPackets.map((packet:any)=><div key={packet.id} className="rounded-lg border border-amber-200 bg-white p-3 text-sm"><p className="font-medium">{packet.orderNumber?`Order #${packet.orderNumber}`:"No order reference"}</p><p className="mt-1 text-xs text-muted-foreground">{packet.productName} · {packet.quantityReceived||0}/{packet.quantity||0} received · {String(packet.status||"unknown").replace(/_/g," ")}</p><Button asChild size="sm" variant="ghost" className="mt-2 h-8 px-2"><Link href={"/incoming?search="+encodeURIComponent(String(packet.orderNumber||packet.id))}>Open packet in Incoming Stock</Link></Button></div>)}</div>
    </CardContent></Card>}
    {!isLoading && consolidationRows.length>0 && <Card className="border-amber-200 bg-amber-50/60"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold text-amber-950">Separate multi-warehouse customer orders</p><p className="mt-1 text-sm text-amber-900/80">{consolidationRows.length} order(s) require portions from multiple supply sources for one customer. Manage them on the dedicated consolidation page.</p></div><Button asChild><Link href="/warehouse/multi-warehouse-consolidation"><Warehouse className="mr-2 h-4 w-4"/>Open Multi-Warehouse Consolidation</Link></Button></CardContent></Card>}
    {isLoading?<div className="h-40 animate-pulse rounded-xl bg-muted"/>:isError || data?.success===false || (data===undefined && !isLoading)?<Card className="border-red-200 p-8 text-center"><Warehouse className="mx-auto h-10 w-10 text-red-500"/><p className="mt-3 font-semibold">Unable to load Farmer Fulfillment transfers</p><p className="mt-1 text-sm text-muted-foreground">{error instanceof Error?error.message:"Check that the backend is running and your warehouse account is linked to a warehouse, then retry."}</p><Button className="mt-4" variant="outline" onClick={()=>refetch()}>Retry loading</Button></Card>:rows.length===0?<Card className="border-dashed p-6 text-center"><p className="font-medium">{consolidationRows.length?"No standard transfers in this queue":"No Farmer Fulfillment orders found for this warehouse"}</p><div className="mt-4 flex justify-center gap-2"><Button variant="outline" onClick={()=>refetch()}>Refresh</Button>{!consolidationRows.length&&<Button asChild variant="outline"><Link href="/incoming"><ClipboardCheck className="mr-2 h-4 w-4"/>Incoming Stock</Link></Button>}{consolidationRows.length>0&&<Button asChild><Link href="/warehouse/multi-warehouse-consolidation"><Warehouse className="mr-2 h-4 w-4"/>Multi-Warehouse Consolidation</Link></Button>}</div></Card>:
    <div className="space-y-4">{visibleRows.length===0?<Card className="border-dashed p-6 text-center"><p className="font-medium">No orders in this section</p></Card>:visibleRows.map((o:any,index:number)=>{
      const category=displayCategory(o);
      const categoryLabels:Record<string,string>={
        waiting_receipt:"Waiting for Receipt or Warehouse Assignment",
        nearby:"Nearby Delivery",
        same_district:"Same-District Warehouse Fulfillment",
        inter_district:"Inter-District Warehouse Fulfillment",
        route_review:"Route Review Required",
        needs_location:"Needs Location Data"
      };
      const sectionTitle=categoryLabels[category]||categoryLabels.needs_location;
      const multi=o.logisticsMode==="farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner";
      const isConsolidationWarehouse=Boolean(o.isConsolidationWarehouse);
      const interDistrict=routeCategoryFor(o)==="inter_district";
      const isSource=o.currentWarehouseRole==="source";
      const isDestination=o.currentWarehouseRole==="destination";
      const transferStatus=String(o.transferStatus||"");
      const receivedAtSource=o.physicalReceiptConfirmed===true;
      const lines=o.incoming?.length ? o.incoming : (multi && isConsolidationWarehouse ? (o.warehouseAllocations||[]) : (o.items||[]));
      return <div key={o.id} className="space-y-3">
      {category==="waiting_receipt"&&(index===0||displayCategory(visibleRows[index-1])!==category)&&<section className="rounded-xl border bg-muted/20 px-4 py-3"><h2 className="font-semibold">{sectionTitle}</h2><p className="text-xs text-muted-foreground">{waitingReceiptRows.length} orders</p></section>}
      <Card id={"order-"+o.id} className="overflow-hidden scroll-mt-24">
        <CardHeader className="pb-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle>#{o.orderNumber}</CardTitle><p className="text-sm text-muted-foreground">{o.farmerName||"Farmer"} - {lines.length} allocated line(s)</p>{["same_district","inter_district"].includes(category)&&receivedAtSource&&!o.isUnassigned&&<label className="mt-3 flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={Boolean(selectedRouteOrders[o.id])} onChange={e=>toggleRouteOrder(o.id,e.target.checked)} /> Select for {category==="inter_district"?"Inter-District":"Same-District"} route planning</label>}</div><Badge variant="outline">{labels[o.stage]||o.stage}</Badge></div></CardHeader>
        <CardContent className="space-y-4">
          <div className="mb-3 flex flex-wrap gap-2">
            <Badge variant="outline">{routeCategoryFor(o)==="inter_district"?"Inter-district transfer":routeCategoryFor(o)==="same_district"?"Same-district transfer":o.logisticsMode==="farmer_to_delivery_partner"||routeCategoryFor(o)==="nearby"?"Direct farm pickup":"Warehouse transfer"}</Badge>
            {o.currentWarehouseRole&&<Badge variant="secondary">This warehouse: {o.currentWarehouseRole==="destination"?"Destination":o.currentWarehouseRole==="source"?"Source":o.currentWarehouseRole==="consolidation"?"Consolidation":"Assigned"}</Badge>}
            {o.sourceDistrict&&<Badge variant="secondary">From district: {o.sourceDistrict}</Badge>}
            {o.destinationDistrict&&<Badge variant="secondary">To district: {o.destinationDistrict}</Badge>}
            {o.destinationWarehouseRegionalFallback&&<Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">Regional destination warehouse</Badge>}
            {o.destinationWarehouseCapacityOverrideRequired&&<Badge variant="outline" className="border-red-300 bg-red-50 text-red-900">Capacity confirmation required</Badge>}
            {Number.isFinite(Number(o.routeDistanceKm))&&o.routeDistanceKm!==null&&o.routeDistanceKm!==""&&<Badge variant="secondary">Route distance: {Number(o.routeDistanceKm).toFixed(1)} km</Badge>}
            {o.orderStatus&&<Badge variant="outline">Order: {String(o.orderStatus).replace(/_/g," ")}</Badge>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Source warehouse</p><p className="mt-1 font-medium">{o.sourceWarehouseName||"Not assigned"}</p><p className="text-xs text-muted-foreground">{o.sourceDistrict||"Source district not recorded"}</p></div>
            <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Destination warehouse</p><p className="mt-1 font-medium">{o.destinationWarehouseName|| (routeCategoryFor(o)==="inter_district"?"Not assigned yet":"Not required for this route")}</p><p className="text-xs text-muted-foreground">Customer district: {o.destinationDistrict||"Not recorded"}{o.destinationWarehouseDistrict&&o.destinationWarehouseDistrict!==o.destinationDistrict?` · Warehouse district: ${o.destinationWarehouseDistrict}`:""}</p>{o.destinationWarehouseRegionalFallback&&<p className="mt-2 text-xs text-amber-800">No eligible warehouse was found in the customer district. This active regional warehouse was selected based on available capacity; verify before dispatch.</p>}{o.destinationWarehouseCapacityOverrideRequired&&<p className="mt-2 text-xs text-red-800">Configured available capacity ({Number(o.destinationWarehouseAvailableCapacity||0)}) is below the order quantity ({Number(o.destinationWarehouseRequiredCapacity||0)}). Confirm with warehouse staff that this sealed shipment can physically be received.</p>}</div>
          </div>
          <div className="flex flex-wrap gap-2">{lines.map((i:any,index:number)=><Badge key={[i.warehouseId||"local",i.productId||i.productName||"product",i.variantId||"no-variant",i.incomingStockId||i.id||i.lineId||index].join("-")} variant="secondary">{i.warehouseName?i.warehouseName+" · ":""}{i.productName||"Product"}: {i.expectedQuantity??i.quantity??0} {i.unit||"kg"}</Badge>)}</div>
          {o.isUnassigned&&<div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-950"><p>{o.message||"The order record has no source warehouse assignment."}</p>{o.physicalReceiptConfirmed&&<div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs">A fully received packed shipment is recorded at this warehouse. Link it to this warehouse before planning the route.</p><Button size="sm" onClick={()=>recoverSourceWarehouse(o)} disabled={busy===o.id+":recover-source"}>{busy===o.id+":recover-source"?"Linking…":"Link Received Shipment to This Warehouse"}</Button></div>}</div>}
          {isConsolidationWarehouse&&multi&&<p className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-xs text-indigo-900">This warehouse is the consolidation destination. Receive arriving source portions, complete consolidation only after all source portions are stored and received here, then transfer the single combined order to the local hub.</p>}
          <section className="rounded-xl border-2 border-indigo-200 bg-indigo-50/60 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Action required for this order</p>
                <p className="mt-1 font-semibold text-indigo-950">{o.isUnassigned ? "Resolve the warehouse assignment before routing" : interDistrict && isSource && !receivedAtSource ? "Record physical shipment receipt" : interDistrict && isSource && transferStatus === "destination_warehouse_transfer_pending" ? "Assign the destination transfer team" : interDistrict && isSource && receivedAtSource ? "Create the destination warehouse transfer" : interDistrict && isDestination && transferStatus === "destination_warehouse_arrived_pending_receipt" ? "Confirm the destination warehouse receipt" : interDistrict && isDestination && transferStatus === "destination_warehouse_received" ? "Send the shipment to the local hub" : transferStatus === "hub_handoff_pending" ? "Assign a team to transfer this order to the local hub" : transferStatus === "hub_arrived_pending_receipt" ? "Confirm the local hub receipt" : category === "nearby" && receivedAtSource ? (o.deliveryPartnerId ? "Final delivery partner assigned" : "Publish the order to an approved delivery partner") : category === "same_district" && receivedAtSource ? "Transfer the sealed order to the local hub" : category === "inter_district" && receivedAtSource ? "Transfer the order to the destination warehouse first" : category === "needs_location" ? "Resolve source/customer location data before routing" : category === "route_review" ? "Review direct-delivery configuration" : ["quality_approved","stored","ready_for_dispatch"].includes(o.stage) && !isConsolidationWarehouse ? "Send this packed order to the local hub" : ["awaiting_warehouse_receipt","source_warehouse_pickup_pending","awaiting_farm_pickup","collection_team_assigned"].includes(o.stage) ? "Track or complete farm pickup" : "Review the order status and follow the enabled action below"}</p>
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
          <div className="flex flex-wrap justify-end gap-2">
            {o.incoming?.some((x:any)=>x.status==="received"&&Number(x.quantityReceived??0)+1e-9<Number(x.quantity??0))&&<Badge variant="outline" className="self-center">Partial receipt — resolve quantity discrepancy in Incoming Stock before dispatch</Badge>}
            {interDistrict&&isSource&&o.destinationWarehouseCapacityOverrideRequired&&<label className="flex w-full items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-950"><input className="mt-1" type="checkbox" checked={Boolean(destinationCapacityAcknowledged[o.id])} onChange={event=>setDestinationCapacityAcknowledged(current=>({...current,[o.id]:event.target.checked}))}/><span>I confirmed with the destination warehouse that it can physically receive this sealed shipment despite the capacity warning.</span></label>}
            {interDistrict&&isSource&&<Button onClick={()=>dispatchDestination(o)} disabled={!receivedAtSource||o.destinationWarehouseCapacityOverrideRequired&&!destinationCapacityAcknowledged[o.id]||["destination_warehouse_transfer_pending","destination_warehouse_in_transit","destination_warehouse_arrived_pending_receipt","destination_warehouse_received","hub_handoff_pending","local_hub_ready"].includes(transferStatus)||busy===o.id+":destination-dispatch"}><Truck className="mr-2 h-4 w-4"/>{busy===o.id+":destination-dispatch"?"Dispatching…":o.destinationWarehouseCapacityOverrideRequired?"Confirm & Create Destination Transfer":o.destinationWarehouseId?"Create Destination Transfer":"Assign Destination & Create Transfer"}</Button>}
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
    })}
      {activeRouteSection==="same_district"&&selectedSameDistrictOrders.length>0&&<Button className="w-full" onClick={()=>planSelectedRoutes("same_district")} disabled={busy==="bulk-route-plan"}>{busy==="bulk-route-plan"?"Planning…":`Plan Same-District Routes (${selectedSameDistrictOrders.length})`}</Button>}
      {activeRouteSection==="inter_district"&&activeInterDistrictSection==="outbound"&&selectedInterDistrictOrders.length>0&&<Button className="w-full" onClick={()=>planSelectedRoutes("inter_district")} disabled={busy==="bulk-route-plan"}>{busy==="bulk-route-plan"?"Planning…":`Plan Inter-District Routes (${selectedInterDistrictOrders.length})`}</Button>}
    </div>}
  </div>;
}
