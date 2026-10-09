"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowRight, CheckCircle2, PackageCheck, RefreshCw, Truck, Warehouse } from "lucide-react";
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
};

export default function FarmerFulfillmentTransfersPage() {
  const [busy,setBusy]=useState<string|null>(null);
  const {data,isLoading,refetch}=useQuery({
    queryKey:["warehouseFarmerFulfillmentTransfers"],
    queryFn:()=>api.get("/warehouse/me/farmer-fulfillment-transfers"),
    refetchInterval:15000,
  });
  const rows=data?.data?.transfers||[];

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
      <div><p className="text-sm font-medium text-indigo-600">Farmer Fulfillment</p><h1 className="text-3xl font-bold">Packed Transfers</h1><p className="mt-1 text-muted-foreground">These orders were packed and checked by the farmer. Receive → verify → store → send to the local hub. Never repack them here.</p></div>
      <Button variant="outline" size="icon" onClick={()=>refetch()}><RefreshCw className="h-4 w-4"/></Button>
    </div>
    <Card className="border-indigo-100 bg-indigo-50/50"><CardContent className="p-5"><div className="flex gap-3"><PackageCheck className="mt-0.5 h-5 w-5 text-indigo-600"/><div className="text-sm"><p className="font-semibold text-indigo-950">Warehouse responsibility</p><p className="mt-1 text-indigo-900/75">The sealed farmer package is not a normal warehouse customer-order packing task. Use Incoming Stock to physically receive it, then Store after approval.</p></div></div></CardContent></Card>
    {isLoading?<div className="h-40 animate-pulse rounded-xl bg-muted"/>:data?.success===false || (data===undefined && !isLoading)?<Card className="border-red-200 p-8 text-center"><Warehouse className="mx-auto h-10 w-10 text-red-500"/><p className="mt-3 font-semibold">Unable to load Farmer Fulfillment transfers</p><p className="mt-1 text-sm text-muted-foreground">The transfer API did not return data. Check that the backend is running, your warehouse account is linked to a warehouse, and then retry.</p><Button className="mt-4" variant="outline" onClick={()=>refetch()}>Retry loading</Button></Card>:rows.length===0?<Card className="p-12 text-center"><Warehouse className="mx-auto h-12 w-12 text-muted-foreground"/><p className="mt-4 font-semibold">No Farmer Fulfillment transfers</p><p className="mt-1 text-sm text-muted-foreground">Only active long-distance Farmer Fulfillment orders assigned to this warehouse appear here. Orders still with the farmer, nearby/self-delivery orders, completed orders, or orders not yet assigned to a warehouse will not appear.</p><Button className="mt-4" variant="outline" onClick={()=>refetch()}>Refresh transfers</Button></Card>:
    <div className="space-y-4">{rows.map((o:any)=><Card key={o.id} className="overflow-hidden"><CardHeader className="pb-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle>#{o.orderNumber}</CardTitle><p className="text-sm text-muted-foreground">{o.farmerName||"Farmer"} · {o.items?.length||0} item line(s)</p></div><Badge variant="outline">{labels[o.stage]||o.stage}</Badge></div></CardHeader><CardContent className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4"><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-muted-foreground">Receive</p><p className="mt-1 font-medium">{o.incoming?.filter((x:any)=>x.status==="received"||x.status==="stored").length||0} received</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-muted-foreground">Quality</p><p className="mt-1 font-medium">{o.incoming?.filter((x:any)=>x.qualityCheck==="passed").length||0} approved</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-muted-foreground">Stored</p><p className="mt-1 font-medium">{o.incoming?.filter((x:any)=>x.status==="stored").length||0} stored</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-muted-foreground">Destination</p><p className="mt-1 font-medium">{o.logisticsMode === "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner" ? "Consolidation Warehouse" : "Local Hub"}</p></div></div>
      <div className="flex flex-wrap gap-2">{(o.items||[]).map((i:any)=><Badge key={i.productId+"-"+(i.variantId||"")} variant="secondary">{i.productName}: {i.quantity} {i.unit}</Badge>)}</div>
      <div className="flex flex-wrap justify-end gap-2">{["warehouse_arrived","received_transfer","partial_received","quality_approved"].includes(o.stage)&&<Button asChild variant="outline"><Link href="/incoming"><Truck className="mr-2 h-4 w-4"/>Open Receiving / Quality</Link></Button>}{["stored","ready_for_dispatch"].includes(o.stage)&&<Button onClick={()=>handoff(o)} disabled={busy===o.id}><ArrowRight className="mr-2 h-4 w-4"/>{busy===o.id?"Dispatching…":o.logisticsMode === "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner" ? "Send to Consolidation" : "Send to Local Hub"}</Button>}{o.stage==="local_hub_transfer_pending"&&<Badge className="self-center"><CheckCircle2 className="mr-1 h-3 w-3"/>In transit to local hub</Badge>}</div>
    </CardContent></Card>)}</div>}
  </div>;
}
