"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, CheckCircle2, Loader2, PackageCheck, RefreshCw } from "lucide-react";
import { api } from "../../lib/api/client";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import toast from "react-hot-toast";

export default function WarehouseIncomingPage() {
  const qc = useQueryClient();
  const [receiving, setReceiving] = useState<any>(null);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["warehouse", "incoming", "bulk"],
    queryFn: () => api.get("/warehouse/me/incoming?limit=100"),
  });
  const receive = useMutation({
    mutationFn: ({ id, quantity }: { id: string; quantity: number }) =>
      api.put(`/warehouse/me/incoming/${id}/receive?quantity=${quantity}&quality_check=passed&usableQuantity=${quantity}`),
    onSuccess: () => { toast.success("Shipment received and quality approved."); setReceiving(null); qc.invalidateQueries({ queryKey: ["warehouse", "incoming", "bulk"] }); },
    onError: (e: any) => toast.error(e?.message || "Receive failed"),
  });
  const store = useMutation({
    mutationFn: (id: string) => api.put(`/warehouse/me/incoming/${id}/store`),
    onSuccess: () => { toast.success("Shipment stored and consolidation updated."); qc.invalidateQueries({ queryKey: ["warehouse", "incoming", "bulk"] }); },
    onError: (e: any) => toast.error(e?.message || "Storage failed"),
  });
  const rows = data?.data?.incoming || [];
  return <div className="space-y-5">
    <div className="flex items-center justify-between">
      <div><h1 className="text-2xl font-bold">Incoming Stock</h1><p className="text-sm text-slate-500">Receive, quality-check and store farm collections for event and weekly basket fulfillment.</p></div>
      <Button variant="outline" size="icon" onClick={() => refetch()}><RefreshCw className="h-4 w-4" /></Button>
    </div>
    {isLoading ? <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin" /></div> :
      rows.length === 0 ? <Card><CardContent className="py-12 text-center text-sm text-slate-500">No incoming shipments.</CardContent></Card> :
      <div className="space-y-3">{rows.map((x: any) => {
        const isEvent = x.sourceMode === "event_fulfillment_transfer";
        const received = x.status === "received"; const stored = x.status === "stored";
        return <Card key={x.id || x._id}><CardContent className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><div className="flex flex-wrap items-center gap-2"><Badge variant={isEvent ? "success" : "secondary"}>{isEvent ? "Bulk Consolidation" : "Incoming"}</Badge><Badge variant="outline">{String(x.status || "scheduled").replace(/_/g," ")}</Badge></div>
              <p className="mt-2 font-semibold">{x.eventProductName || x.productName || "Farm Product"}</p>
              <p className="text-sm text-slate-500">{x.quantity} kg {x.eventRequestId ? `· Event ${String(x.eventRequestId).slice(-8)}` : ""}</p>
            </div>
            <div className="flex gap-2">{!received && !stored && <Button size="sm" disabled={receive.isPending} onClick={() => receive.mutate({id:String(x.id || x._id),quantity:Number(x.quantity)})}><ArrowDown className="mr-1.5 h-4 w-4" />Receive & QC</Button>}{received && !stored && <Button size="sm" disabled={store.isPending} onClick={() => store.mutate(String(x.id || x._id))}><PackageCheck className="mr-1.5 h-4 w-4" />Store</Button>}{stored && <Badge variant="success"><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Stored</Badge>}</div>
          </div>
        </CardContent></Card>
      })}</div>}
  </div>;
}
