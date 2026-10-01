"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PackageCheck, RefreshCw, Users, Play, CheckCircle2, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { api } from "../../lib/api/client";
import toast from "react-hot-toast";

export default function WarehousePackingPage() {
  const [team, setTeam] = useState<Record<string,string>>({});
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["warehousePackingTasks"],
    queryFn: () => api.get("/warehouse/me/packing-tasks", { params: { status: "all" } }),
  });
  const tasks = data?.data?.tasks || [];

  const run = async (url: string, body?: any) => {
    try {
      await api.put(url, body);
      toast.success("Packing workflow updated");
      refetch();
    } catch (e:any) { toast.error(e?.message || "Packing action failed"); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold">Order Packing</h1><p className="text-muted-foreground">Pack each customer order separately after warehouse receiving.</p></div>
        <Button variant="outline" size="icon" onClick={() => refetch()}><RefreshCw className="h-4 w-4"/></Button>
      </div>
      {isLoading ? <div className="h-32 animate-pulse rounded-lg bg-muted"/> : tasks.length === 0 ? (
        <Card className="p-12 text-center"><PackageCheck className="mx-auto h-12 w-12 text-muted-foreground"/><h3 className="mt-4 font-semibold">No packing tasks</h3><p className="mt-2 text-sm text-muted-foreground">Received warehouse-fulfillment products will appear here.</p></Card>
      ) : <div className="space-y-4">{tasks.map((t:any) => (
        <Card key={t.id}><CardContent className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2"><h3 className="font-semibold">Order #{t.orderId?.slice(-8)}</h3><Badge variant="outline">{t.status}</Badge></div>
              <p className="mt-2 text-sm text-muted-foreground">Required: <b>{t.quantityRequired}</b> · Packed: <b>{t.packedQuantity || 0}</b> · Batch: {t.batchId || "—"}</p>
              <p className="mt-1 text-xs text-muted-foreground">Farmer: {t.farmerId} · Product: {t.productId}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {["ready_for_packing","assigned"].includes(t.status) && <div className="flex items-center gap-2"><Users className="h-4 w-4"/><Input className="w-32" placeholder="Team ID" value={team[t.id] || ""} onChange={e=>setTeam({...team,[t.id]:e.target.value})}/><Button size="sm" variant="outline" onClick={()=>run(`/warehouse/me/packing-tasks/${t.id}/assign`,{packingTeamId:team[t.id]})}>Assign</Button></div>}
              {t.status === "assigned" && <Button size="sm" onClick={()=>run(`/warehouse/me/packing-tasks/${t.id}/start`)}><Play className="mr-2 h-4 w-4"/>Start</Button>}
              {["packing","partially_packed"].includes(t.status) && <Button size="sm" onClick={()=>run(`/warehouse/me/packing-tasks/${t.id}/complete`,{packedQuantity:t.quantityRequired,packageId:t.packageId || undefined})}><PackageCheck className="mr-2 h-4 w-4"/>Pack Order</Button>}
              {t.status === "packed" && <Button size="sm" onClick={()=>run(`/warehouse/me/packing-tasks/${t.id}/verify`,{verified:true})}><ShieldCheck className="mr-2 h-4 w-4"/>Verify</Button>}
              {t.status === "ready_for_dispatch" && <Badge variant="success"><CheckCircle2 className="mr-1 h-4 w-4"/>Ready for Dispatch</Badge>}
            </div>
          </div>
        </CardContent></Card>
      ))}</div>}
    </div>
  );
}
