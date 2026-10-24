"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PackageCheck, Truck, Warehouse, RefreshCw, CheckCircle2 } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../../lib/api/client";
import { Card, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";

export default function B2BFulfillmentPage() {
  const qc = useQueryClient();
  const [forms, setForms] = useState<Record<string, any>>({});
  const query = useQuery({
    queryKey: ["b2b", "warehouse-fulfillment"],
    queryFn: () => api.get("/b2b/warehouse/fulfillment"),
    refetchInterval: 15000,
  });
  const orders = query.data?.data?.orders || query.data?.orders || [];
  const mutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => api.put(`/b2b/warehouse/fulfillment/${id}`, payload),
    onSuccess: () => {
      toast.success("B2B fulfillment updated");
      qc.invalidateQueries({ queryKey: ["b2b", "warehouse-fulfillment"] });
      qc.invalidateQueries({ queryKey: ["b2b", "farmer", "orders"] });
    },
    onError: (e: any) => toast.error(e?.message || "Could not update B2B fulfillment"),
  });
  const formFor = (id: string) => forms[id] || {};
  const setForm = (id: string, patch: any) => setForms((old) => ({ ...old, [id]: { ...old[id], ...patch } }));
  const action = (id: string, payload: any) => mutation.mutate({ id, payload });

  return (
    <div className="space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-slate-900">B2B Pickup & Fulfillment</h1><p className="text-sm text-slate-500">Manage business orders after the farmer marks them Ready for Pickup.</p></div>
        <Button variant="outline" onClick={() => query.refetch()}><RefreshCw className="mr-2 h-4 w-4"/>Refresh</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[{label:"Ready for pickup",status:"ready_for_pickup"},{label:"Picked up",status:"picked_up"},{label:"Warehouse received",status:"warehouse_received"}].map((s) => <Card key={s.status}><CardContent className="p-4"><p className="text-sm text-slate-500">{s.label}</p><p className="text-2xl font-bold">{orders.filter((o:any)=>o.status===s.status).length}</p></CardContent></Card>)}
      </div>
      {query.isLoading ? <p className="py-12 text-center text-slate-500">Loading B2B fulfillment orders…</p> : query.isError ? <Card><CardContent className="p-6 text-sm text-red-600">Could not load B2B fulfillment. Check warehouse permissions and the backend response, then refresh.</CardContent></Card> : orders.length === 0 ? <Card><CardContent className="p-10 text-center text-slate-500">No B2B orders are waiting for pickup or fulfillment.</CardContent></Card> : <div className="space-y-4">
        {orders.map((o:any) => {
          const f = formFor(o.id);
          return <Card key={o.id}><CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{o.orderNumber || o.id}</h2><Badge>{String(o.status).replace(/_/g," ")}</Badge></div><p className="mt-1 text-sm text-slate-600">{o.productName} · {o.quantityKg} kg · {o.businessInfo?.businessName || "Business buyer"}</p><p className="text-xs text-slate-500">{o.deliveryCity || o.deliveryAddress || "Buyer delivery address not provided"}</p></div>
              <p className="font-semibold text-emerald-700">₹{Number(o.totalAmount || 0).toFixed(2)}</p>
            </div>
            {o.status === "ready_for_pickup" && <div className="rounded-xl border bg-slate-50 p-4 space-y-3"><h3 className="font-medium"><Truck className="mr-2 inline h-4 w-4"/>Assign farm pickup</h3><div className="grid gap-3 sm:grid-cols-2"><Input value={f.pickupTeam || ""} onChange={(e)=>setForm(o.id,{pickupTeam:e.target.value})} placeholder="Pickup team / team ID"/><Input value={f.vehicle || ""} onChange={(e)=>setForm(o.id,{vehicle:e.target.value})} placeholder="Vehicle number / type"/></div><Button disabled={mutation.isPending || !f.pickupTeam?.trim() || !f.vehicle?.trim()} onClick={()=>action(o.id,{action:"assign_pickup",pickupTeam:f.pickupTeam,vehicle:f.vehicle})}>Confirm Pickup Assignment</Button><Button variant="outline" disabled={mutation.isPending || !o.pickupTeam || !o.pickupVehicle} onClick={()=>action(o.id,{action:"confirm_pickup"})}>Confirm Farm Collection</Button>{o.pickupTeam && <p className="text-xs text-slate-500">Assigned: {o.pickupTeam} · {o.pickupVehicle}</p>}</div>}
            {o.status === "picked_up" && <div className="rounded-xl border bg-slate-50 p-4 space-y-3"><h3 className="font-medium"><Warehouse className="mr-2 inline h-4 w-4"/>Receive at warehouse</h3><div className="grid gap-3 sm:grid-cols-2"><Input type="number" min="0.01" step="0.01" value={f.receivedQuantityKg ?? String(o.packedQuantityKg || o.quantityKg || "")} onChange={(e)=>setForm(o.id,{receivedQuantityKg:e.target.value})} placeholder="Received quantity (kg)"/><select className="h-10 rounded-md border bg-white px-3 text-sm" value={f.qualityCheck || "passed"} onChange={(e)=>setForm(o.id,{qualityCheck:e.target.value})}><option value="passed">Quality passed</option><option value="failed">Quality failed</option></select></div><Input value={f.notes || ""} onChange={(e)=>setForm(o.id,{notes:e.target.value})} placeholder="Receipt / quality notes (optional)"/><Button disabled={mutation.isPending || Number(f.receivedQuantityKg ?? o.packedQuantityKg ?? o.quantityKg) <= 0} onClick={()=>action(o.id,{action:"receive_stock",receivedQuantityKg:Number(f.receivedQuantityKg ?? o.packedQuantityKg ?? o.quantityKg),qualityCheck:f.qualityCheck || "passed",notes:f.notes})}><PackageCheck className="mr-2 h-4 w-4"/>Confirm Warehouse Receipt</Button></div>}
            {o.status === "warehouse_received" && <div className="rounded-xl border bg-slate-50 p-4 space-y-3"><h3 className="font-medium">Dispatch to business buyer</h3><p className="text-sm text-slate-600">Current flow dispatches from the receiving warehouse. Inter-district destination-warehouse transfer selection still needs to be configured.</p><Input value={f.deliveryPartner || ""} onChange={(e)=>setForm(o.id,{deliveryPartner:e.target.value})} placeholder="Assigned delivery partner / ID"/><Input value={f.notes || ""} onChange={(e)=>setForm(o.id,{notes:e.target.value})} placeholder="Dispatch notes (optional)"/><Button disabled={mutation.isPending || o.warehouseQualityCheck !== "passed" || !f.deliveryPartner?.trim()} onClick={()=>action(o.id,{action:"dispatch_to_buyer",deliveryPartner:f.deliveryPartner,notes:f.notes})}>Assign Delivery & Dispatch</Button>{o.warehouseQualityCheck === "failed" && <p className="text-sm text-red-600">Quality failed — dispatch is blocked. Resolve the inspection before proceeding.</p>}</div>}
            {o.status === "in_transit" && <div className="rounded-xl border bg-slate-50 p-4 space-y-3"><p className="text-sm">Delivery partner: {o.finalDeliveryPartner || "Not shown"}</p><Input value={f.notes || ""} onChange={(e)=>setForm(o.id,{notes:e.target.value})} placeholder="Delivery proof / notes (optional)"/><Button disabled={mutation.isPending} onClick={()=>action(o.id,{action:"confirm_delivery",notes:f.notes})}><CheckCircle2 className="mr-2 h-4 w-4"/>Confirm Delivered to Business</Button></div>}
            {o.status === "delivered" && <p className="text-sm text-emerald-700">Delivered. The business buyer must confirm receipt and settle payment to complete the order.</p>}
          </CardContent></Card>
        })}
      </div>}
    </div>
  );
}
