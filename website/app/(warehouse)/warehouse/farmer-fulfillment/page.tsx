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
  received_transfer:"Received — Quality Check",
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
  const receiveIncoming=async(item:any)=>{
    try{
      setBusy(item.id+":receive");
      const quantity=Number(item.expectedQuantity??item.quantity??0);
      if(!Number.isFinite(quantity)||quantity<=0) throw new Error("Expected quantity is missing or invalid");
      await api.put("/warehouse/me/incoming/"+item.id+"/receive",undefined,{params:{quantity,quality_check:"passed",usableQuantity:quantity,notes:"Farmer-packed order received and package seal checked"}});
      toast.success("Shipment received and quantity recorded");
      await refetch();
    }catch(e:any){toast.error(e?.message||"Unable to receive shipment");}
    finally{setBusy(null);}
  };
  const storeIncoming=async(item:any)=>{
    try{
      setBusy(item.id+":store");
      await api.put("/warehouse/me/incoming/"+item.id+"/store");
      toast.success("Packed shipment storage recorded");
      await refetch();
    }catch(e:any){toast.error(e?.message||"Unable to record storage");}
    finally{setBusy(null);}
  };
  const dispatchDestination=async(order:any)=>{
    try{
      setBusy(order.id+":destination-dispatch");
      await api.post("/warehouse/me/farmer-fulfillment/"+order.id+"/dispatch-to-destination");
      toast.success("Shipment dispatched to destination warehouse");
      await refetch();
    }catch(e:any){toast.error(e?.message||"Destination dispatch failed");}
    finally{setBusy(null);}
  };
  const receiveDestination=async(order:any)=>{
    try{
      setBusy(order.id+":destination-receive");
      await api.post("/warehouse/me/farmer-fulfillment/"+order.id+"/receive-at-destination");
      toast.success("Destination warehouse receipt confirmed");
      await refetch();
    }catch(e:any){toast.error(e?.message||"Destination receipt failed");}
    finally{setBusy(null);}
  };
  const {data,isLoading,refetch}=useQuery({
    queryKey:["warehouseFarmerFulfillmentTransfers"],
    queryFn:()=>api.get("/warehouse/me/farmer-fulfillment-transfers"),
    refetchInterval:15000,
  });
  const allRows=data?.data?.transfers||[];
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
    // A legacy single-source record should use the standard transfer action path.
    logisticsMode: row.logisticsMode===MULTI_WAREHOUSE_MODE ? "farmer_to_warehouse_to_local_hub_to_delivery_partner" : row.logisticsMode,
  }));
  const consolidationRows=allRows.filter((row:any)=>isTrueConsolidation(row));

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
      <div><p className="text-sm font-medium text-indigo-600">Farmer Fulfillment</p><h1 className="text-3xl font-bold">Packed Transfers</h1><p className="mt-1 text-muted-foreground">Receive sealed farmer-packed orders, confirm the transfer, and route them to the correct next stop. Same-district orders go to the local hub; inter-district orders must transfer to a destination-district warehouse first. Never repack these orders.</p></div>
      <div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link href="/incoming"><ClipboardCheck className="mr-2 h-4 w-4"/>Incoming Stock</Link></Button><Button asChild variant="outline"><Link href="/collections"><Route className="mr-2 h-4 w-4"/>Farm Collection & Route Planning</Link></Button><Button variant="outline" size="icon" aria-label="Refresh transfers" onClick={()=>refetch()}><RefreshCw className="h-4 w-4"/></Button></div>
    </div>
    <Card className="border-indigo-100 bg-indigo-50/50"><CardContent className="p-5"><div className="flex gap-3"><PackageCheck className="mt-0.5 h-5 w-5 text-indigo-600"/><div className="text-sm"><p className="font-semibold text-indigo-950">Warehouse responsibility</p><p className="mt-1 text-indigo-900/75">The sealed farmer package is not a normal warehouse customer-order packing task. Use Incoming Stock to physically receive it, then Store after approval.</p></div></div></CardContent></Card>
    {!isLoading && consolidationRows.length>0 && <Card className="border-amber-200 bg-amber-50/60"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold text-amber-950">Separate multi-warehouse customer orders</p><p className="mt-1 text-sm text-amber-900/80">{consolidationRows.length} order(s) require portions from multiple supply sources for one customer. Manage them on the dedicated consolidation page.</p></div><Button asChild><Link href="/warehouse/multi-warehouse-consolidation"><Warehouse className="mr-2 h-4 w-4"/>Open Multi-Warehouse Consolidation</Link></Button></CardContent></Card>}
    {isLoading?<div className="h-40 animate-pulse rounded-xl bg-muted"/>:data?.success===false || (data===undefined && !isLoading)?<Card className="border-red-200 p-8 text-center"><Warehouse className="mx-auto h-10 w-10 text-red-500"/><p className="mt-3 font-semibold">Unable to load Farmer Fulfillment transfers</p><p className="mt-1 text-sm text-muted-foreground">The transfer API did not return data. Check that the backend is running, your warehouse account is linked to a warehouse, and then retry.</p><Button className="mt-4" variant="outline" onClick={()=>refetch()}>Retry loading</Button></Card>:rows.length===0?<Card className="p-8 text-center"><Warehouse className="mx-auto h-12 w-12 text-muted-foreground"/><p className="mt-4 font-semibold">No standard Farmer Fulfillment transfers</p><p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">This page is for already-packed orders assigned to one source warehouse and sent directly to a local hub. Orders that combine portions from multiple warehouses belong on Multi-Warehouse Consolidation and are kept separate.</p><div className="mt-4 flex flex-wrap justify-center gap-2"><Button variant="outline" onClick={()=>refetch()}>Refresh transfers</Button>{consolidationRows.length>0&&<Button asChild><Link href="/warehouse/multi-warehouse-consolidation"><Warehouse className="mr-2 h-4 w-4"/>Open Multi-Warehouse Consolidation ({consolidationRows.length})</Link></Button>}</div></Card>:
    <div className="space-y-4">{rows.map((o:any)=>{
      const multi=o.logisticsMode==="farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner";
      const isConsolidationWarehouse=Boolean(o.isConsolidationWarehouse);
      const lines=o.incoming?.length ? o.incoming : (multi && isConsolidationWarehouse ? (o.warehouseAllocations||[]) : (o.items||[]));
      const receiveCount=o.incoming?.filter((x:any)=>x.status==="received"||x.status==="stored").length||0;
      const qualityCount=o.incoming?.filter((x:any)=>x.qualityCheck==="passed").length||0;
      const storedCount=o.incoming?.filter((x:any)=>x.status==="stored").length||0;
      const allIncomingArrived=Boolean(o.incoming?.length)&&o.incoming.every((x:any)=>Boolean(x.arrivedWarehouseAt));
      const hasUnstoredIncoming=Boolean(o.incoming?.length)&&o.incoming.some((x:any)=>x.status!=="stored");
      const showReceiving=allIncomingArrived&&hasUnstoredIncoming||["warehouse_arrived","received_transfer","partial_received","quality_approved"].includes(o.stage);
      return <Card key={o.id} className="overflow-hidden">
        <CardHeader className="pb-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle>#{o.orderNumber}</CardTitle><p className="text-sm text-muted-foreground">{o.farmerName||"Farmer"} · {lines.length} allocated line(s)</p></div><Badge variant="outline">{labels[o.stage]||o.stage}</Badge></div></CardHeader>
        <CardContent className="space-y-4">
          <div className="mb-3 flex flex-wrap gap-2">
            <Badge variant="outline">{o.farmerFulfillmentRouteType==="inter_district"?"Inter-district transfer":o.farmerFulfillmentRouteType==="same_district"?"Same-district transfer":o.logisticsMode==="farmer_to_delivery_partner"||o.farmerFulfillmentRouteType==="nearby"?"Direct farm pickup":"Warehouse transfer"}</Badge>
            {o.currentWarehouseRole&&<Badge variant="secondary">This warehouse: {o.currentWarehouseRole==="destination"?"Destination":o.currentWarehouseRole==="source"?"Source":o.currentWarehouseRole==="consolidation"?"Consolidation":"Assigned"}</Badge>}
            {o.sourceDistrict&&<Badge variant="secondary">From district: {o.sourceDistrict}</Badge>}
            {o.destinationDistrict&&<Badge variant="secondary">To district: {o.destinationDistrict}</Badge>}
            {Number.isFinite(Number(o.routeDistanceKm))&&o.routeDistanceKm!==null&&o.routeDistanceKm!==""&&<Badge variant="secondary">Route distance: {Number(o.routeDistanceKm).toFixed(1)} km</Badge>}
            {o.orderStatus&&<Badge variant="outline">Order: {String(o.orderStatus).replace(/_/g," ")}</Badge>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Source warehouse</p><p className="mt-1 font-medium">{o.sourceWarehouseName||"Not assigned"}</p><p className="text-xs text-muted-foreground">{o.sourceDistrict||"Source district not recorded"}</p></div>
            <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Destination warehouse</p><p className="mt-1 font-medium">{o.destinationWarehouseName|| (o.farmerFulfillmentRouteType==="inter_district"?"Not assigned yet":"Not required for this route")}</p><p className="text-xs text-muted-foreground">{o.destinationDistrict||"Destination district not recorded"}</p></div>
          </div>
          {(() => {
            const interDistrict = o.farmerFulfillmentRouteType === "inter_district";
            const direct = o.logisticsMode === "farmer_to_delivery_partner" || o.farmerFulfillmentRouteType === "nearby";
            const isSource = o.currentWarehouseRole === "source";
            const isDestination = o.currentWarehouseRole === "destination";
            const transferStatus = String(o.transferStatus || "");
            const receivedAtSource = ["received_transfer","quality_approved","stored"].includes(o.stage);
            const steps = direct
              ? [{title:"Farm pickup",detail:"Collect the sealed farmer-packed order",done:true},{title:"Delivery partner",detail:"Assign one partner for the final mile",done:Boolean(o.deliveryPartnerId) || ["local_hub_ready","delivered"].includes(o.stage)},{title:"Customer",detail:"Deliver the order",done:o.orderStatus==="delivered"}]
              : interDistrict
                ? [{title:"Farm pickup",detail:"Pickup team collects during 20:00–06:00 IST",done:["warehouse_arrived","received_transfer","quality_approved","stored","destination_warehouse_transfer_pending","hub_handoff_pending","local_hub_ready"].includes(o.stage)},{title:"Source warehouse",detail:"Receive quantity and verify sealed package; do not repack",done:["stored","destination_warehouse_transfer_pending","hub_handoff_pending","local_hub_ready"].includes(o.stage)},{title:"Destination warehouse",detail:"Transfer across districts during 06:00–20:00 IST",done:["hub_handoff_pending","local_hub_ready"].includes(o.stage)},{title:"Local hub",detail:"Receive shipment and open delivery handoff",done:o.stage==="local_hub_ready"},{title:"Delivery partner",detail:"One partner delivers the complete order",done:o.orderStatus==="delivered"}]
                : [{title:"Farm pickup",detail:"Pickup team collects during 20:00–06:00 IST",done:["warehouse_arrived","received_transfer","quality_approved","stored","hub_handoff_pending","local_hub_ready"].includes(o.stage)},{title:"Source warehouse",detail:"Receive, inspect the sealed package and store",done:["stored","hub_handoff_pending","local_hub_ready"].includes(o.stage)},{title:"Local hub",detail:"Transfer during 06:00–20:00 IST",done:o.stage==="local_hub_ready"},{title:"Delivery partner",detail:"One partner delivers to the customer",done:o.orderStatus==="delivered"}];
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
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-muted-foreground">Destination</p><p className="mt-1 font-medium">{o.isUnassigned?"Waiting for source warehouse":isConsolidationWarehouse?"Consolidation intake":multi?("Consolidation · "+(o.consolidationWarehouseName||"Warehouse")):o.currentWarehouseRole==="destination"?("Destination warehouse · "+(o.warehouseName||"Current warehouse")):o.farmerFulfillmentRouteType==="inter_district"?("Destination warehouse · "+(o.destinationWarehouseName||"Assignment required")):("Local hub · "+(o.localHubName||"Assigned hub"))}</p></div>
          </div>
          <div className="flex flex-wrap gap-2">{lines.map((i:any)=><Badge key={(i.warehouseId||"local")+"-"+i.productId+"-"+(i.variantId||"")} variant="secondary">{i.warehouseName?i.warehouseName+" · ":""}{i.productName||"Product"}: {i.expectedQuantity??i.quantity??0} {i.unit||"kg"}</Badge>)}</div>
          {o.isUnassigned&&<p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-950">{o.message||"The delivery decision was saved, but no safe warehouse assignment exists yet. Check active warehouse status, configured capacity, and location data. No pickup team can be assigned until a source warehouse is selected."}</p>}
          {isConsolidationWarehouse&&multi&&<p className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-xs text-indigo-900">This warehouse is the consolidation destination. Receive arriving source portions, complete consolidation only after all source portions are stored and received here, then transfer the single combined order to the local hub.</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button asChild variant="outline"><Link href={"/collections?search="+encodeURIComponent(String(o.orderNumber||o.id))}><Route className="mr-2 h-4 w-4"/>Open Farm Collection</Link></Button>
            <Button asChild variant="outline"><Link href={"/incoming?search="+encodeURIComponent(String(o.orderNumber||o.id))}><ClipboardCheck className="mr-2 h-4 w-4"/>Open Incoming Stock</Link></Button>
            {showReceiving&&o.incoming?.filter((x:any)=>["pending","scheduled","ready_for_pickup","in_transit"].includes(x.status)).map((item:any)=><Button key={item.id} onClick={()=>receiveIncoming(item)} disabled={busy===item.id+":receive"}><Truck className="mr-2 h-4 w-4"/>{busy===item.id+":receive"?"Receiving…":"Receive + Verify"}</Button>)}
            {o.incoming?.filter((x:any)=>x.status==="received").map((item:any)=><Button key={item.id} variant="outline" onClick={()=>storeIncoming(item)} disabled={busy===item.id+":store"}><PackageCheck className="mr-2 h-4 w-4"/>{busy===item.id+":store"?"Saving…":"Store / Hold Sealed Package"}</Button>)}
            {interDistrict&&isSource&&<Button onClick={()=>dispatchDestination(o)} disabled={!receivedAtSource||!o.destinationWarehouseId||["destination_warehouse_in_transit","destination_warehouse_received","hub_handoff_pending","local_hub_ready"].includes(transferStatus)||busy===o.id+":destination-dispatch"}><Truck className="mr-2 h-4 w-4"/>{busy===o.id+":destination-dispatch"?"Dispatching…":"Dispatch to Destination Warehouse"}</Button>}
            {interDistrict&&isDestination&&<Button onClick={()=>receiveDestination(o)} disabled={transferStatus!=="destination_warehouse_in_transit"||busy===o.id+":destination-receive"}><CheckCircle2 className="mr-2 h-4 w-4"/>{busy===o.id+":destination-receive"?"Confirming…":"Confirm Destination Receipt"}</Button>}
            {interDistrict&&isDestination&&<Button onClick={()=>runTransferAction(o,"handoffLocalHub")} disabled={transferStatus!=="destination_warehouse_received"||busy===o.id+":handoffLocalHub"}><ArrowRight className="mr-2 h-4 w-4"/>Send to Local Hub</Button>}
            {o.farmerFulfillmentRouteType==="inter_district"&&<p className="w-full rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">Inter-district route: send to the destination warehouse first. The local-hub button remains disabled until destination receipt is confirmed.</p>}
            {o.farmerFulfillmentRouteType!=="inter_district"&&!isConsolidationWarehouse&&["stored","ready_for_dispatch"].includes(o.stage)&&<Button onClick={()=>runTransferAction(o,"dispatch")} disabled={busy===o.id+":dispatch"}><ArrowRight className="mr-2 h-4 w-4"/>{busy===o.id+":dispatch"?"Dispatching…":multi?"Send to Consolidation":"Send to Local Hub"}</Button>}
            {isConsolidationWarehouse&&o.consolidation?.canReceive&&<Button onClick={()=>runTransferAction(o,"receiveConsolidation")} disabled={busy===o.id+":receiveConsolidation"}><CheckCircle2 className="mr-2 h-4 w-4"/>{busy===o.id+":receiveConsolidation"?"Receiving…":("Confirm Arrived Portions ("+o.consolidation.inTransitLegs+")")}</Button>}
            {isConsolidationWarehouse&&o.consolidation?.canComplete&&<Button onClick={()=>runTransferAction(o,"completeConsolidation")} disabled={busy===o.id+":completeConsolidation"}><PackageCheck className="mr-2 h-4 w-4"/>{busy===o.id+":completeConsolidation"?"Completing…":"Complete Consolidation"}</Button>}
            {isConsolidationWarehouse&&o.consolidation?.canHandoffLocalHub&&<Button onClick={()=>runTransferAction(o,"handoffLocalHub")} disabled={busy===o.id+":handoffLocalHub"}><ArrowRight className="mr-2 h-4 w-4"/>{busy===o.id+":handoffLocalHub"?"Sending…":"Send Consolidated Order to Local Hub"}</Button>}
            {isConsolidationWarehouse&&o.consolidation?.canConfirmHubReceipt&&<Button onClick={()=>runTransferAction(o,"confirmHubReceipt")} disabled={busy===o.id+":confirmHubReceipt"}><CheckCircle2 className="mr-2 h-4 w-4"/>{busy===o.id+":confirmHubReceipt"?"Confirming…":"Confirm Local Hub Receipt"}</Button>}
            {o.stage==="hub_handoff_pending"&&<Badge variant="outline" className="self-center">Waiting for local-hub receipt</Badge>}
            {o.stage==="local_hub_ready"&&<Badge variant="success" className="self-center"><CheckCircle2 className="mr-1 h-3 w-3"/>Local hub received · Delivery job ready</Badge>}
          </div>
        </CardContent>
      </Card>;
    })}</div>}
  </div>;
}
