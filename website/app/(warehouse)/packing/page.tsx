"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PackageCheck, RefreshCw, Users, Play, CheckCircle2, ShieldCheck, Info, AlertTriangle, Warehouse } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { api } from "../../lib/api/client";
import toast from "react-hot-toast";

export default function WarehousePackingPage() {
  const [farmTeam, setFarmTeam] = useState<Record<string,string>>({});
  const [assigningFarm, setAssigningFarm] = useState<string | null>(null);
  const [farmAssignmentMessages, setFarmAssignmentMessages] = useState<Record<string, { kind: "success" | "error" | "info"; text: string }>>({});
  const { data, isLoading, error: packingError, refetch } = useQuery({
    queryKey: ["warehousePackingTasks"],
    queryFn: () => api.get("/warehouse/me/packing-tasks", { params: { status: "all" } }),
  });
  const packingRoot = data?.data ?? data;
  const tasks = packingRoot?.data?.tasks ?? packingRoot?.tasks ?? [];
  const { data: shortageData, refetch: refetchShortages } = useQuery({
    queryKey: ["warehouseShortages"],
    queryFn: () => api.get("/warehouse/me/shortages", { params: { status: "all" } }),
  });
  const shortageRoot = shortageData?.data ?? shortageData;
  const shortages = shortageRoot?.data?.shortages ?? shortageRoot?.shortages ?? [];

  const getFarmDetails = (task: any) => {
    const item = (task.items || [])[0] || (task.packingItems || [])[0] || {};
    const farm = task.farm || task.sourceFarm || task.farmDetails || item.farm || item.sourceFarm || {};
    const farmId = String(task.farmId || task.sourceFarmId || task.farmProfileId || farm.id || farm._id || item.farmId || item.sourceFarmId || "").trim();
    const farmName = String(task.farmName || task.sourceFarmName || task.farmerName || farm.name || farm.farmName || farm.farmerName || item.farmName || item.sourceFarmName || "").trim();
    const farmerName = String(task.farmer?.name || task.farmer?.fullName || farm.farmer?.name || farm.ownerName || "").trim();
    const address = String(farm.address || farm.location?.formattedAddress || farm.location?.address || task.sourceFarmAddress || task.farmAddress || "").trim();
    const key = farmId ? "farm:" + farmId : farmName ? "name:" + farmName.toLowerCase() : farmerName ? "farmer:" + farmerName.toLowerCase() : address ? "address:" + address.toLowerCase() : "order:" + task.id;
    return { key, name: farmName || farmerName || (farmId ? "Farm " + farmId.slice(-6) : "Farm details unavailable"), farmerName, address };
  };

  const farmGroups = useMemo(() => {
    const groups = new Map<string, { key: string; name: string; farmerName: string; address: string; tasks: any[] }>();
    for (const task of tasks) {
      const details = getFarmDetails(task);
      const group = groups.get(details.key) || { ...details, tasks: [] };
      group.tasks.push(task);
      groups.set(details.key, group);
    }
    return Array.from(groups.values());
  }, [tasks]);

  const assignFarmTeam = async (farm: { key: string; name: string; tasks: any[] }) => {
    const teamId = (farmTeam[farm.key] || "").trim();
    if (!teamId) {
      const text = "Enter the packing team ID, then click Assign Team to Farm.";
      setFarmAssignmentMessages((current) => ({ ...current, [farm.key]: { kind: "error", text } }));
      toast.error(text);
      return;
    }
    const eligible = farm.tasks.filter((task: any) => ["ready_for_packing", "assigned"].includes(String(task.status || "").toLowerCase()));
    if (!eligible.length) {
      const text = "No orders are waiting for assignment. Only Ready for Packing or already Assigned orders can be assigned.";
      setFarmAssignmentMessages((current) => ({ ...current, [farm.key]: { kind: "info", text } }));
      toast(text);
      return;
    }
    setFarmAssignmentMessages((current) => ({ ...current, [farm.key]: { kind: "info", text: "Assigning team to " + eligible.length + " order(s)…" } }));
    setAssigningFarm(farm.key);
    let assigned = 0;
    const failed: string[] = [];
    for (const task of eligible) {
      try {
        await api.put("/warehouse/me/packing-tasks/" + task.id + "/assign", { packingTeamId: teamId });
        assigned += 1;
      } catch (error: any) {
        const detail = error?.response?.data?.detail || error?.message;
        failed.push((task.orderNumber || task.orderId || task.id) + (detail ? ": " + detail : ""));
      }
    }
    if (assigned) {
      const text = "Team assigned successfully to " + assigned + " order(s). Their status should now be Assigned; use Start Packing on each order to continue.";
      setFarmAssignmentMessages((current) => ({ ...current, [farm.key]: { kind: failed.length ? "error" : "success", text: failed.length ? text + " " + failed.length + " order(s) failed: " + failed.slice(0, 2).join("; ") : text } }));
      toast.success("Packing team assigned to " + assigned + " order(s) for " + farm.name + ".");
    } else {
      const text = "Assignment failed. " + (failed.slice(0, 2).join("; ") || "The server did not confirm any assigned orders.");
      setFarmAssignmentMessages((current) => ({ ...current, [farm.key]: { kind: "error", text } }));
      toast.error(text);
    }
    setAssigningFarm(null);
    await Promise.all([refetch(), refetchShortages()]);
  };

  const run = async (path: string, payload?: any) => {
    try {
      const response = payload === undefined ? await api.put(path) : await api.put(path, payload);
      toast.success(response?.data?.message || response?.message || "Packing task updated.");
      await Promise.all([refetch(), refetchShortages()]);
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || error?.message || "Could not update packing task.");
    }
  };

  const printLabel = (t: any) => {
    const address = t.deliveryAddress || {};
    const items = t.items || [];
    const addressText = [address.addressLine1, address.addressLine2, address.city, address.state, address.zipCode].filter(Boolean).join(", ");
    const win = window.open("", "_blank", "width=720,height=900");
    if (!win) { toast.error("Please allow pop-ups to print the package label"); return; }
    win.document.write(`<!doctype html><html><head><title>Package ${t.packageId || ""}</title><style>body{font-family:Arial,sans-serif;padding:32px;max-width:680px;margin:auto}h1{font-size:24px;margin-bottom:4px}.muted{color:#64748b;font-size:12px}.box{border:2px solid #111;padding:20px;margin-top:18px}.row{display:flex;justify-content:space-between;border-bottom:1px solid #ddd;padding:8px 0}.address{line-height:1.6}.qr{margin:24px auto;border:2px dashed #111;width:150px;height:150px;display:flex;align-items:center;justify-content:center;font-size:12px;text-align:center}</style></head><body><h1>AGRICONNECT</h1><div class="muted">DELIVERY PACKAGE</div><div class="box"><strong>Order:</strong> ${t.orderNumber || t.orderId}<br/><strong>Package:</strong> ${t.packageId || "—"}<h3>Customer</h3><div>${t.customer?.name || "Customer"}</div><h3>Products</h3>${items.map((i:any)=>"<div class=\"row\"><span>"+i.productName+"</span><strong>"+i.quantity+" "+(i.unit || "kg")+"</strong></div>").join("")}<h3>Delivery Address</h3><div class="address">${addressText || "Address not available"}</div><div class="qr">SCAN PACKAGE<br/>${t.packageId || "PACKAGE"}</div></div><script>window.onload=()=>window.print();</script></body></html>`);
    win.document.close();
  };

  const verifyAllPackedTasks = async () => {
    const eligible = tasks.filter((task: any) => task.status === "packed");
    if (!eligible.length) {
      toast("No fully packed orders are waiting for verification.");
      return;
    }
    let verified = 0;
    const failed: string[] = [];
    for (const task of eligible) {
      try {
        await api.put(`/warehouse/me/packing-tasks/${task.id}/verify`, { verified: true });
        verified += 1;
      } catch {
        failed.push(task.orderNumber || task.orderId || task.id);
      }
    }
    if (verified) toast.success(`Verified ${verified} order(s). Ready orders can continue to dispatch.`);
    if (failed.length) toast.error(`${failed.length} order(s) need review. Check quantities, shortages, and dispatch records.`);
    await refetch();
    await refetchShortages();
  };

  return (
    <div className="space-y-6">
      <Card className="border-blue-100 bg-blue-50/60"><CardContent className="flex gap-3 p-4"><Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-600"/><div className="text-sm text-blue-900"><p className="font-semibold">Only warehouse-fulfilled orders appear here.</p><p className="mt-1 text-xs leading-5 text-blue-800">Bulk farm stock is received, quality-checked, and stored first. Then the warehouse allocates stock to each customer order and packs each order separately. Farmer-fulfilled long-distance orders are already packed and must never be repacked here.</p></div></CardContent></Card>
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold">Order Packing</h1><p className="text-muted-foreground">Pack each customer order separately after warehouse receiving.</p></div>
        <div className="flex flex-wrap items-center gap-2"><Button onClick={verifyAllPackedTasks} disabled={!tasks.some((task: any) => task.status === "packed")}><ShieldCheck className="mr-2 h-4 w-4"/>Verify All Packed</Button><Button variant="outline" size="icon" onClick={() => refetch()} aria-label="Refresh packing tasks"><RefreshCw className="h-4 w-4"/></Button><Button asChild variant="outline"><Link href="/outgoing">Continue to Dispatch</Link></Button></div>
      </div>
      {shortages.length > 0 && (
        <Card className="border-red-200 bg-red-50/70">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600"/>
              <div className="flex-1">
                <p className="font-semibold text-red-900">Order-line shortage — available stock can still be packed</p>
                <p className="mt-1 text-sm text-red-800">The shortage is determined from the final physical packed quantity. Resolve the remaining quantity before the order can be dispatched.</p>
                <div className="mt-4 space-y-2">
                  {shortages.map((x:any) => (
                    <div key={x.id} className="rounded-md border border-red-200 bg-white p-3 text-sm">
                      <div className="font-medium">Order #{x.orderId?.slice(-8)} · {x.shortageQuantity} kg shortage</div>
                      <div className="mt-1 text-xs text-muted-foreground">Required: {x.requiredQuantity} · Available/usable: {x.availableQuantity} · Status: {String(x.status || "").replace(/_/g, " ")}</div>
                      <div className="mt-1 text-xs text-red-700">The available quantity is not lost. It can be packed now; choose how the remaining quantity will be resolved.</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={async()=>{try{await api.put(`/warehouse/me/shortages/${x.id}/resolution`,{resolutionType:"farmer_replenishment"});toast.success("Farmer replenishment requested");refetchShortages();refetch();}catch(e:any){toast.error(e?.message||"Failed to update shortage");}}}>Farmer Replenishment</Button>
                        <Button size="sm" variant="outline" onClick={async()=>{try{await api.put(`/warehouse/me/shortages/${x.id}/resolution`,{resolutionType:"customer_approval_pending",approvedQuantity:x.availableQuantity});toast.success("Customer approval requested");refetchShortages();}catch(e:any){toast.error(e?.message||"Failed to update shortage");}}}>Customer Approval</Button>
                        <Button size="sm" variant="outline" onClick={async()=>{const q=window.prompt("How many kg should be marked for refund/cancellation?", String(x.shortageQuantity)); if(!q)return; try{await api.put(`/warehouse/me/shortages/${x.id}/resolution`,{resolutionType:"refund_cancellation",resolvedQuantity:Number(q)});toast.success("Refund/cancellation recorded");refetchShortages();refetch();}catch(e:any){toast.error(e?.message||"Failed to record refund");}}}>Refund / Cancellation</Button>
                        <Button size="sm" variant="outline" onClick={async()=>{const productId=window.prompt("Enter substitute product ID"); if(!productId)return; try{await api.put(`/warehouse/me/shortages/${x.id}/resolution`,{resolutionType:"substitution_pending",substituteProductId:productId});toast.success("Substitution proposal recorded");refetchShortages();}catch(e:any){toast.error(e?.message||"Failed to record substitution");}}}>Substitution</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      {packingError && <Card className="border-red-200 bg-red-50"><CardContent className="p-4 text-sm text-red-700">Unable to load warehouse packing tasks. Check the backend logs or refresh the page.</CardContent></Card>}
      {isLoading ? <div className="h-32 animate-pulse rounded-lg bg-muted"/> : !packingError && tasks.length === 0 ? (
        <Card className="p-12 text-center"><PackageCheck className="mx-auto h-12 w-12 text-muted-foreground"/><h3 className="mt-4 font-semibold">No packing tasks</h3><p className="mt-2 text-sm text-muted-foreground">Received warehouse-fulfillment products will appear here.</p></Card>
      ) : <div className="space-y-6">{farmGroups.map((farm) => (
        <section key={farm.key} className="space-y-3">
          <Card className="border-emerald-200 bg-emerald-50/40"><CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><Warehouse className="h-5 w-5 text-emerald-700"/><h2 className="text-lg font-semibold">{farm.name}</h2><Badge variant="outline">{farm.tasks.length} order{farm.tasks.length === 1 ? "" : "s"}</Badge></div>
              {farm.farmerName && farm.farmerName !== farm.name && <p className="mt-1 text-sm text-muted-foreground">Farmer: {farm.farmerName}</p>}
              {farm.address && <p className="mt-1 text-sm text-muted-foreground">{farm.address}</p>}
              <p className="mt-1 text-xs text-muted-foreground">Assign one packing team to all eligible orders from this farm. Packing and verification remain order-by-order.</p>
            </div>
            {farm.tasks.some((task: any) => ["ready_for_packing", "assigned"].includes(String(task.status || "").toLowerCase())) && <div className="flex flex-wrap items-center gap-2"><Users className="h-4 w-4"/><Input className="w-40" placeholder="Packing Team ID" value={farmTeam[farm.key] || ""} onChange={e=>{setFarmTeam({...farmTeam,[farm.key]:e.target.value});setFarmAssignmentMessages((current)=>{const next={...current};delete next[farm.key];return next;});}}/><Button type="button" disabled={assigningFarm === farm.key} onClick={() => assignFarmTeam(farm)}>{assigningFarm === farm.key ? "Assigning…" : "Assign Team to Farm"}</Button></div>}
            {farmAssignmentMessages[farm.key] && <div role="status" aria-live="polite" className={"mt-3 rounded-md border px-3 py-2 text-sm " + (farmAssignmentMessages[farm.key].kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : farmAssignmentMessages[farm.key].kind === "error" ? "border-red-200 bg-red-50 text-red-900" : "border-blue-200 bg-blue-50 text-blue-900")}>{farmAssignmentMessages[farm.key].text}</div>}
          </CardContent></Card>
          <div className="space-y-3">{farm.tasks.map((t:any) => (
        <Card key={t.id}><CardContent className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2"><h3 className="font-semibold">Order #{t.orderId?.slice(-8)}</h3><Badge variant="outline">{t.status.replace(/_/g, " ")}</Badge></div>
              <p className="mt-2 text-sm text-muted-foreground">Required: <b>{t.quantityRequired}</b> · Packed: <b>{t.packedQuantity || 0}</b> · Batch: {t.batchId || "—"}</p>
              <p className="mt-1 text-sm font-medium text-slate-900">Customer: {t.customer?.name || "Loading customer"}</p>
              <p className="mt-1 text-xs text-muted-foreground">Products: {(t.items || []).map((i:any) => `${i.productName} — ${i.quantity}`).join(" · ") || t.productId}</p>
              {(t.packingItems || []).length > 0 && (
                <div className="mt-3 rounded-md border bg-slate-50 p-3 text-xs">
                  <div className="font-semibold text-slate-800">Order-line allocation</div>
                  <div className="mt-2 space-y-1">
                    {(t.packingItems || []).map((i:any) => (
                      <div key={i.itemKey} className="flex flex-wrap justify-between gap-2">
                        <span>{i.productName}</span>
                        <span>
                          {Number(i.packedQuantity || 0)} / {Number(i.quantityRequired || 0)} {i.unit || "kg"}
                          {Number(i.quantityShort || 0) > 0 && <span className="ml-2 font-semibold text-red-700">short {Number(i.quantityShort).toFixed(2)} {i.unit || "kg"}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="mt-1 text-xs text-muted-foreground">Delivery: {t.deliveryAddress ? [t.deliveryAddress.addressLine1, t.deliveryAddress.city, t.deliveryAddress.state, t.deliveryAddress.zipCode].filter(Boolean).join(", ") : "Address not available"}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              
              {t.status === "assigned" && <div className="flex items-center gap-2"><Badge variant="outline">Team assigned</Badge><Button size="sm" onClick={()=>run(`/warehouse/me/packing-tasks/${t.id}/start`)}><Play className="mr-2 h-4 w-4"/>Start Packing</Button></div>}
              {["packing","partially_packed"].includes(t.status) && <Button size="sm" onClick={async()=>{const items=(t.packingItems||[]).map((i:any)=>{const q=window.prompt(`Actual packed quantity for ${i.productName} (required ${i.quantityRequired} ${i.unit||"kg"})`,String(i.packedQuantity||i.quantityAvailable||0)); return q===null?null:{productId:i.productId,variantId:i.variantId||undefined,packedQuantity:Number(q)};}).filter(Boolean); if(!items.length)return; await run(`/warehouse/me/packing-tasks/${t.id}/complete`,{items,packedQuantity:items.reduce((s:any,i:any)=>s+Number(i.packedQuantity||0),0),packageId:t.packageId||undefined});}}><PackageCheck className="mr-2 h-4 w-4"/>Finish Packing & Check Shortage</Button>}
              {t.status === "packed" && <Button size="sm" onClick={()=>run(`/warehouse/me/packing-tasks/${t.id}/verify`,{verified:true})}><ShieldCheck className="mr-2 h-4 w-4"/>Verify Packed Order</Button>}
              {["packed","ready_for_dispatch"].includes(t.status) && <Button size="sm" variant="outline" onClick={()=>printLabel(t)}><PackageCheck className="mr-2 h-4 w-4"/>Print Label</Button>}
              {t.status === "ready_for_dispatch" && <div className="flex flex-wrap items-center gap-2"><Badge variant="success"><CheckCircle2 className="mr-1 h-4 w-4"/>Packing Verified · Ready for Dispatch</Badge><Button size="sm" onClick={() => { window.location.href = "/outgoing"; }}><PackageCheck className="mr-2 h-4 w-4"/>Continue to Dispatch</Button></div>}
            </div>
          </div>
        </CardContent></Card>
          ))}</div>
        </section>
      ))}</div>}
    </div>
  );
}
