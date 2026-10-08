"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowRight, Boxes, CheckCircle2, RefreshCw, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { api } from "../../../lib/api/client";
import toast from "react-hot-toast";

export default function WarehouseConsolidationPage(){
  const [busy,setBusy]=useState<string|null>(null);
  const {data,isLoading,refetch}=useQuery({queryKey:["warehouseConsolidations"],queryFn:()=>api.get("/warehouse/me/farmer-fulfillment-consolidations"),refetchInterval:15000});
  const rows=data?.data?.consolidations||[];
  const complete=async(id:string)=>{
    try{setBusy(id);await api.post("/warehouse/me/farmer-fulfillment/"+id+"/complete-consolidation");toast.success("Complete order sent to local hub");await refetch();}
    catch(e:any){toast.error(e?.message||"Consolidation handoff failed");}finally{setBusy(null);}
  };
  return <div className="space-y-6">
    <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium text-violet-600">Farmer Fulfillment</p><h1 className="text-3xl font-bold">Multi-Warehouse Consolidation</h1><p className="mt-1 text-muted-foreground">Wait for every warehouse portion → consolidate the original customer order → send the complete order to one local hub.</p></div><Button variant="outline" size="icon" onClick={()=>refetch()}><RefreshCw className="h-4 w-4"/></Button></div>
    {isLoading?<div className="h-40 animate-pulse rounded-xl bg-muted"/>:rows.length===0?<Card className="p-12 text-center"><Boxes className="mx-auto h-12 w-12 text-muted-foreground"/><p className="mt-4 font-semibold">No consolidation orders</p><p className="mt-1 text-sm text-muted-foreground">Multi-warehouse farmer-packed orders appear here when assigned to this warehouse.</p></Card>:
    <div className="space-y-4">{rows.map((o:any)=><Card key={o.orderId}><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle>#{o.orderNumber}</CardTitle><p className="text-sm text-muted-foreground">{o.warehouseCount} warehouse portions · Consolidation warehouse: {o.consolidationWarehouseName||"This warehouse"}</p></div><Badge variant="outline">{o.consolidationStatus||"collecting"}</Badge></div></CardHeader><CardContent className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4"><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-muted-foreground">Stored portions</p><p className="font-semibold">{o.storedCount}/{o.incomingCount||o.warehouseCount}</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-muted-foreground">Warehouse legs received</p><p className="font-semibold">{o.allConsolidationLegsReceived?"Complete":"Pending"}</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-muted-foreground">Order</p><p className="font-semibold">#{o.orderNumber}</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-muted-foreground">Final delivery</p><p className="font-semibold">ONE partner</p></div></div>
      <div className="space-y-2">{(o.allocations||[]).map((a:any)=><div key={String(a.warehouseId)+"-"+String(a.productId)} className="flex items-center justify-between rounded-lg border p-3 text-sm"><span>Warehouse {String(a.warehouseId).slice(-6)} · {a.quantity} {a.unit||"kg"}</span><Badge variant="outline">{o.storedCount? "Tracked":"Pending"}</Badge></div>)}</div>
      <div className="flex justify-end">{o.isConsolidationWarehouse&&o.allWarehousesReceived&&o.allConsolidationLegsReceived?<Button onClick={()=>complete(o.orderId)} disabled={busy===o.orderId}><Truck className="mr-2 h-4 w-4"/>{busy===o.orderId?"Sending…":"Consolidate & Send to Local Hub"}</Button>:<p className="text-sm text-muted-foreground">{o.isConsolidationWarehouse?"Waiting for all warehouse portions to arrive.":"Source warehouse: dispatch your stored portion from Farmer Fulfillment Transfers."}</p>}</div>
    </CardContent></Card>)}</div>}
  </div>;
}
