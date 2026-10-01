"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PackageCheck, RefreshCw, Users, Play, CheckCircle2, ShieldCheck, Info, AlertTriangle } from "lucide-react";
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
  const { data: shortageData, refetch: refetchShortages } = useQuery({
    queryKey: ["warehouseShortages"],
    queryFn: () => api.get("/warehouse/me/shortages", { params: { status: "open" } }),
  });
  const shortages = shortageData?.data?.shortages || [];

  const printLabel = (t: any) => {
    const address = t.deliveryAddress || {};
    const items = t.items || [];
    const addressText = [address.addressLine1, address.addressLine2, address.city, address.state, address.zipCode].filter(Boolean).join(", ");
    const win = window.open("", "_blank", "width=720,height=900");
    if (!win) { toast.error("Please allow pop-ups to print the package label"); return; }
    win.document.write(`<!doctype html><html><head><title>Package ${t.packageId || ""}</title><style>body{font-family:Arial,sans-serif;padding:32px;max-width:680px;margin:auto}h1{font-size:24px;margin-bottom:4px}.muted{color:#64748b;font-size:12px}.box{border:2px solid #111;padding:20px;margin-top:18px}.row{display:flex;justify-content:space-between;border-bottom:1px solid #ddd;padding:8px 0}.address{line-height:1.6}.qr{margin:24px auto;border:2px dashed #111;width:150px;height:150px;display:flex;align-items:center;justify-content:center;font-size:12px;text-align:center}</style></head><body><h1>AGRICONNECT</h1><div class="muted">DELIVERY PACKAGE</div><div class="box"><strong>Order:</strong> ${t.orderNumber || t.orderId}<br/><strong>Package:</strong> ${t.packageId || "—"}<h3>Customer</h3><div>${t.customer?.name || "Customer"}</div><h3>Products</h3>${items.map((i:any)=>"<div class=\"row\"><span>"+i.productName+"</span><strong>"+i.quantity+" "+(i.unit || "kg")+"</strong></div>").join("")}<h3>Delivery Address</h3><div class="address">${addressText || "Address not available"}</div><div class="qr">SCAN PACKAGE<br/>${t.packageId || "PACKAGE"}</div></div><script>window.onload=()=>window.print();</script></body></html>`);
    win.document.close();
  };

  const run = async (url: string, body?: any) => {
    try {
      await api.put(url, body);
      toast.success("Packing workflow updated");
      refetch();
      refetchShortages();
    } catch (e:any) { toast.error(e?.message || "Packing action failed"); }
  };

  return (
    <div className="space-y-6">
      <Card className="border-blue-100 bg-blue-50/60"><CardContent className="flex gap-3 p-4"><Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-600"/><div className="text-sm text-blue-900"><p className="font-semibold">Only warehouse-fulfilled orders appear here.</p><p className="mt-1 text-xs leading-5 text-blue-800">Bulk farm stock is received, quality-checked, and stored first. Then the warehouse allocates stock to each customer order and packs each order separately. Farmer-fulfilled long-distance orders are already packed and must never be repacked here.</p></div></CardContent></Card>
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold">Order Packing</h1><p className="text-muted-foreground">Pack each customer order separately after warehouse receiving.</p></div>
        <Button variant="outline" size="icon" onClick={() => refetch()}><RefreshCw className="h-4 w-4"/></Button>
      </div>
      {shortages.length > 0 && (
        <Card className="border-red-200 bg-red-50/70">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600"/>
              <div className="flex-1">
                <p className="font-semibold text-red-900">Bulk stock shortage — packing is blocked</p>
                <p className="mt-1 text-sm text-red-800">Do not reduce customer quantities silently. Resolve each shortage before the affected order can be packed or dispatched.</p>
                <div className="mt-4 space-y-2">
                  {shortages.map((x:any) => (
                    <div key={x.id} className="rounded-md border border-red-200 bg-white p-3 text-sm">
                      <div className="font-medium">Order #{x.orderId?.slice(-8)} · {x.shortageQuantity} kg shortage</div>
                      <div className="mt-1 text-xs text-muted-foreground">Required: {x.requiredQuantity} · Usable: {x.availableQuantity} · Resolution: {x.status.replace(/_/g, " ")}</div>
                      <div className="mt-1 text-xs text-red-700">Action required: farmer replenishment, approved customer reduction/substitution, or cancellation/refund according to your business policy.</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      {isLoading ? <div className="h-32 animate-pulse rounded-lg bg-muted"/> : tasks.length === 0 ? (
        <Card className="p-12 text-center"><PackageCheck className="mx-auto h-12 w-12 text-muted-foreground"/><h3 className="mt-4 font-semibold">No packing tasks</h3><p className="mt-2 text-sm text-muted-foreground">Received warehouse-fulfillment products will appear here.</p></Card>
      ) : <div className="space-y-4">{tasks.map((t:any) => (
        <Card key={t.id}><CardContent className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2"><h3 className="font-semibold">Order #{t.orderId?.slice(-8)}</h3><Badge variant="outline">{t.status.replace(/_/g, " ")}</Badge></div>
              <p className="mt-2 text-sm text-muted-foreground">Required: <b>{t.quantityRequired}</b> · Packed: <b>{t.packedQuantity || 0}</b> · Batch: {t.batchId || "—"}</p>
              <p className="mt-1 text-sm font-medium text-slate-900">Customer: {t.customer?.name || "Loading customer"}</p>
              <p className="mt-1 text-xs text-muted-foreground">Products: {(t.items || []).map((i:any) => `${i.productName} — ${i.quantity}`).join(" · ") || t.productId}</p>
              <p className="mt-1 text-xs text-muted-foreground">Delivery: {t.deliveryAddress ? [t.deliveryAddress.addressLine1, t.deliveryAddress.city, t.deliveryAddress.state, t.deliveryAddress.zipCode].filter(Boolean).join(", ") : "Address not available"}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {["ready_for_packing","assigned"].includes(t.status) && <div className="flex items-center gap-2"><Users className="h-4 w-4"/><Input className="w-32" placeholder="Team ID" value={team[t.id] || ""} onChange={e=>setTeam({...team,[t.id]:e.target.value})}/><Button size="sm" variant="outline" onClick={()=>run(`/warehouse/me/packing-tasks/${t.id}/assign`,{packingTeamId:team[t.id]})}>Assign</Button></div>}
              {t.status === "assigned" && <Button size="sm" onClick={()=>run(`/warehouse/me/packing-tasks/${t.id}/start`)}><Play className="mr-2 h-4 w-4"/>Start</Button>}
              {["packing","partially_packed"].includes(t.status) && <Button size="sm" onClick={()=>run(`/warehouse/me/packing-tasks/${t.id}/complete`,{packedQuantity:t.quantityRequired,packageId:t.packageId || undefined})}><PackageCheck className="mr-2 h-4 w-4"/>Pack Order</Button>}
              {t.status === "packed" && <Button size="sm" onClick={()=>run(`/warehouse/me/packing-tasks/${t.id}/verify`,{verified:true})}><ShieldCheck className="mr-2 h-4 w-4"/>Verify</Button>}
              {["packed","ready_for_dispatch"].includes(t.status) && <Button size="sm" variant="outline" onClick={()=>printLabel(t)}><PackageCheck className="mr-2 h-4 w-4"/>Print Label</Button>}
              {t.status === "ready_for_dispatch" && <Badge variant="success"><CheckCircle2 className="mr-1 h-4 w-4"/>Ready for Dispatch</Badge>}
            </div>
          </div>
        </CardContent></Card>
      ))}</div>}
    </div>
  );
}
