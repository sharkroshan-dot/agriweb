"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PackageCheck, RefreshCw, Users, Play, CheckCircle2, ShieldCheck, Info, AlertTriangle, Warehouse, Search, Clock3 } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { api } from "../../lib/api/client";
import toast from "react-hot-toast";

const getPackingActivityDate = (task: any): Date | null => {
  const status = String(task?.status || "").toLowerCase();
  const rawDate =
    (["packed", "customer_approval_pending", "verified", "ready_for_dispatch", "dispatched"].includes(status)
      ? task?.packingCompletedAt || task?.packedAt || task?.completedAt
      : null) ||
    (["packing", "partially_packed"].includes(status) ? task?.packingStartedAt || task?.startedAt : null) ||
    task?.packingTeamAssignedAt ||
    task?.createdAt;
  if (!rawDate) return null;
  const parsed = new Date(rawDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const matchesPackingDate = (task: any, period: string): boolean => {
  if (period === "all") return true;
  const date = getPackingActivityDate(task);
  if (!date) return false;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  if (period === "today") end.setDate(start.getDate() + 1);
  else if (period === "yesterday") {
    start.setDate(start.getDate() - 1);
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 1);
  } else if (period === "week") {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 7);
  }
  return date >= start && date < end;
};

const isUnfinishedPackingTask = (task: any) =>
  ["ready_for_packing", "assigned", "packing", "partially_packed"].includes(String(task?.status || "").toLowerCase());

export default function WarehousePackingPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState<"today" | "yesterday" | "week" | "all">("today");
  const [showRemainingOnly, setShowRemainingOnly] = useState(false);
  const [farmTeam, setFarmTeam] = useState<Record<string,string>>({});
  const [assigningFarm, setAssigningFarm] = useState<string | null>(null);
  const [farmAssignmentMessages, setFarmAssignmentMessages] = useState<Record<string, { kind: "success" | "error" | "info"; text: string }>>({});
  const [farmAssignedLocally, setFarmAssignedLocally] = useState<Record<string, boolean>>({});
  const [farmStartedLocally, setFarmStartedLocally] = useState<Record<string, boolean>>({});
  const [taskStatusOverrides, setTaskStatusOverrides] = useState<Record<string, string>>({});
  const { data, isLoading, error: packingError, refetch } = useQuery({
    queryKey: ["warehousePackingTasks"],
    queryFn: () => api.get("/warehouse/me/packing-tasks", { params: { status: "all" } }),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const packingRoot = data?.data ?? data;
  const serverTasks = packingRoot?.data?.tasks ?? packingRoot?.tasks ?? [];
  const tasks = serverTasks.map((task: any) => ({ ...task, status: taskStatusOverrides[task.id] || task.status }));
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

  const filteredTasks = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return tasks.filter((task: any) => {
      if (!matchesPackingDate(task, dateFilter)) return false;
      if (!query) return true;
      const farm = getFarmDetails(task);
      const values = [
        farm.name, farm.farmerName, farm.address, task.farmId, task.farmerId,
        task.orderNumber, task.orderId, task.id, task.status, task.batchId,
        task.customer?.name, task.customer?.phone,
        ...(task.items || []).flatMap((item: any) => [item.productName, item.productId]),
        ...(task.packingItems || []).flatMap((item: any) => [item.productName, item.productId]),
        task.deliveryAddress?.addressLine1, task.deliveryAddress?.city,
        task.deliveryAddress?.district, task.deliveryAddress?.state, task.deliveryAddress?.zipCode,
      ];
      return values.filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
    });
  }, [tasks, searchTerm, dateFilter]);

  const visibleTasks = useMemo(
    () => showRemainingOnly ? filteredTasks.filter(isUnfinishedPackingTask) : filteredTasks,
    [filteredTasks, showRemainingOnly],
  );

  const farmGroups = useMemo(() => {
    const groups = new Map<string, { key: string; name: string; farmerName: string; address: string; tasks: any[] }>();
    for (const task of visibleTasks) {
      const details = getFarmDetails(task);
      const group = groups.get(details.key) || { ...details, tasks: [] };
      group.tasks.push(task);
      groups.set(details.key, group);
    }
    return Array.from(groups.values());
  }, [visibleTasks]);

  const unfinishedCount = filteredTasks.filter(isUnfinishedPackingTask).length;
  const finishedCount = filteredTasks.length - unfinishedCount;

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
        setTaskStatusOverrides((current) => ({ ...current, [task.id]: "assigned" }));
        assigned += 1;
      } catch (error: any) {
        const detail = error?.response?.data?.detail || error?.message;
        failed.push((task.orderNumber || task.orderId || task.id) + (detail ? ": " + detail : ""));
      }
    }
    if (assigned) {
      setFarmAssignedLocally((current) => ({ ...current, [farm.key]: true }));
      const text = "Team assigned successfully to " + assigned + " order(s). The next action is Start Packing for Farm.";
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

  const startPackingForFarm = async (farm: { key: string; name: string; tasks: any[] }) => {
    const assignedTasks = farm.tasks.filter((task: any) => {
      const status = String(task.status || "").toLowerCase();
      return status === "assigned" || (farmAssignedLocally[farm.key] && status === "ready_for_packing");
    });
    if (!assignedTasks.length) {
      const text = "Assign a packing team first. No assigned orders are waiting to start.";
      setFarmAssignmentMessages((current) => ({ ...current, [farm.key]: { kind: "error", text } }));
      toast.error(text);
      return;
    }
    setAssigningFarm(farm.key);
    setFarmAssignmentMessages((current) => ({ ...current, [farm.key]: { kind: "info", text: "Starting packing for " + assignedTasks.length + " assigned order(s)…" } }));
    let started = 0;
    const failed: string[] = [];
    for (const task of assignedTasks) {
      try {
        await api.put("/warehouse/me/packing-tasks/" + task.id + "/start");
        setTaskStatusOverrides((current) => ({ ...current, [task.id]: "packing" }));
        started += 1;
      } catch (error: any) {
        failed.push((task.orderNumber || task.orderId || task.id) + ": " + (error?.response?.data?.detail || error?.message || "Could not start"));
      }
    }
    const message = started
      ? "Packing started for " + started + " order(s). Continue with the actual packed quantities on each order card."
      : "Could not start packing. " + (failed.slice(0, 2).join("; ") || "Refresh and try again.");
    setFarmAssignmentMessages((current) => ({ ...current, [farm.key]: { kind: failed.length ? "error" : started ? "success" : "error", text: failed.length && started ? message + " Failed: " + failed.slice(0, 2).join("; ") : message } }));
    if (started) {
      setFarmAssignedLocally((current) => ({ ...current, [farm.key]: false }));
      setFarmStartedLocally((current) => ({ ...current, [farm.key]: true }));
      toast.success("Started packing for " + started + " order(s).");
    }
    if (failed.length && !started) toast.error(message);
    setAssigningFarm(null);
    await Promise.all([refetch(), refetchShortages()]);
  };

  const run = async (path: string, payload?: any) => {
    try {
      const response = payload === undefined ? await api.put(path) : await api.put(path, payload);
      const statusAction = path.includes("/start") ? "packing" : path.includes("/complete") ? "packed" : path.includes("/verify") ? "ready_for_dispatch" : path.includes("/assign") ? "assigned" : "";
      const taskIdMatch = path.match(/packing-tasks\/([^/]+)\//);
      if (statusAction && taskIdMatch) setTaskStatusOverrides((current) => ({ ...current, [taskIdMatch[1]]: statusAction }));
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
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="border-amber-200 bg-amber-50/60"><CardContent className="p-4">
          <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-600 text-sm font-bold text-white">3</span><h2 className="font-semibold text-amber-950">Finish Packing &amp; Check Shortage</h2></div>
          <p className="mt-2 text-sm text-amber-900">Check each order physically, then click Finish Order. The system uses the recorded available quantity to detect shortages; only orders with a shortage require customer approval. The customer—not the warehouse—decides whether to accept the reduced quantity or cancel.</p>
          <p className="mt-2 text-xs text-amber-800">Ready to pack: {tasks.filter((t:any)=>["packing","partially_packed"].includes(t.status)).length} · Shortage cases: {shortages.filter((s:any)=>!["resolved","cancelled"].includes(String(s.status||"").toLowerCase())).length}</p>
        </CardContent></Card>
        <Card className="border-blue-200 bg-blue-50/60"><CardContent className="p-4">
          <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">4</span><h2 className="font-semibold text-blue-950">Verify &amp; Dispatch</h2></div>
          <p className="mt-2 text-sm text-blue-900">When every item is fully packed, click Verify Packed Order. Successful verification creates dispatch records and changes the order to Ready for Dispatch.</p>
          <p className="mt-2 text-xs text-blue-800">Waiting for verification: {tasks.filter((t:any)=>t.status==="packed").length} · Ready for dispatch: {tasks.filter((t:any)=>t.status==="ready_for_dispatch").length}</p>
          <Button className="mt-3" variant="outline" size="sm" onClick={()=>{window.location.href="/outgoing";}}>Open Dispatch</Button>
        </CardContent></Card>
      </div>
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
                      <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                        <p className="font-semibold">Waiting for the customer</p>
                        <p className="mt-1">The customer will choose to accept the available quantity or cancel the order from My Orders. Warehouse staff cannot cancel this order or choose a reduced quantity on the customer's behalf. Dispatch remains blocked until the customer decides.</p>
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
            {!farmStartedLocally[farm.key] && !farmAssignedLocally[farm.key] && !farm.tasks.some((task: any) => ["assigned","packing","partially_packed","packed","customer_approval_pending","verified","ready_for_dispatch","dispatched"].includes(String(task.status || "").toLowerCase())) && farm.tasks.some((task: any) => String(task.status || "").toLowerCase() === "ready_for_packing") && <div className="flex flex-wrap items-center gap-2"><Users className="h-4 w-4"/><Input className="w-40" placeholder="Packing Team ID" value={farmTeam[farm.key] || ""} onChange={e=>{setFarmTeam({...farmTeam,[farm.key]:e.target.value});setFarmAssignmentMessages((current)=>{const next={...current};delete next[farm.key];return next;});}}/><Button type="button" disabled={assigningFarm === farm.key} onClick={() => assignFarmTeam(farm)}>{assigningFarm === farm.key ? "Assigning…" : "Assign Team to Farm"}</Button></div>}
            {farm.tasks.some((task: any) => String(task.status || "").toLowerCase() === "assigned") && <Button type="button" disabled={assigningFarm === farm.key} onClick={() => startPackingForFarm(farm)}><Play className="mr-2 h-4 w-4"/>{assigningFarm === farm.key ? "Starting…" : "Next: Start Packing for Remaining Orders"}</Button>}
            {farm.tasks.some((task: any) => ["packing","partially_packed"].includes(String(task.status || "").toLowerCase())) && <Badge variant="outline">Packing in progress — progress is saved per order; continue below</Badge>}
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
              
              {["ready_for_packing","assigned"].includes(String(t.status || "").toLowerCase()) && <div className="flex items-center gap-2">{t.status === "assigned" && <Badge variant="outline">Team assigned</Badge>}<Button size="sm" onClick={()=>run(`/warehouse/me/packing-tasks/${t.id}/start`)}><Play className="mr-2 h-4 w-4"/>{t.status === "assigned" ? "Start Packing" : "Continue: Start Packing"}</Button></div>}
              {["packing","partially_packed"].includes(String(t.status || "").toLowerCase()) && <Button size="sm" onClick={async()=>{const items:any[]=[]; for (const i of (t.packingItems||[])) { const required=Number(i.quantityRequired||0); const available=Number(i.quantityAvailable ?? i.packedQuantity ?? required); const qty=Math.max(0,Math.min(required,available)); items.push({productId:i.productId,variantId:i.variantId||undefined,packedQuantity:qty}); } if(!items.length){toast.error("This order has no packing checklist. Refresh or re-sync the order.");return;} try { const response=await api.put(`/warehouse/me/packing-tasks/${t.id}/complete`,{items,packedQuantity:items.reduce((s:number,i:any)=>s+Number(i.packedQuantity||0),0),packageId:t.packageId||undefined}); const root=response?.data?.data??response?.data??response; const shortageFlag=Boolean(root?.shortageDetectedAfterPacking || root?.shortageResolutionRequired || items.some((item:any)=>{const line=(t.packingItems||[]).find((x:any)=>String(x.productId)===String(item.productId)&&String(x.variantId||"")===String(item.variantId||""));return Number(item.packedQuantity)<Number(line?.quantityRequired||0);})); setTaskStatusOverrides((current)=>({...current,[t.id]:shortageFlag?"customer_approval_pending":"packed"})); if(shortageFlag){await refetchShortages(); const refreshed=await api.get("/warehouse/me/shortages",{params:{status:"all"}}); const rootShort=refreshed?.data?.data??refreshed?.data??refreshed; const cases=rootShort?.shortages??rootShort?.data?.shortages??[]; const orderKey=String(t.orderId||t.order?._id||""); for(const shortage of cases.filter((s:any)=>String(s.orderId)===orderKey&&!["resolved","cancelled","customer_approval_pending"].includes(String(s.status||"").toLowerCase()))){await api.put(`/warehouse/me/shortages/${shortage.id}/resolution`,{resolutionType:"customer_approval_pending",approvedQuantity:shortage.availableQuantity,notes:"Customer must choose whether to accept the available quantity or cancel the order. Warehouse cannot cancel it on the customer's behalf."});} toast.success("Order checked. A quantity shortage was found; customer approval is required before dispatch."); } else {toast.success("Order checked and packing completed.");} await Promise.all([refetch(),refetchShortages()]); } catch(error:any){toast.error(error?.response?.data?.detail||error?.message||"Could not finish packing this order.");}}}><PackageCheck className="mr-2 h-4 w-4"/>Finish Order</Button>}
              {t.status === "customer_approval_pending" && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-semibold">Waiting for customer decision</p><p className="mt-1">The customer must accept the available quantity or cancel the order. You cannot finish, verify, or dispatch this order until the customer responds.</p></div>}
              {t.status === "packed" && <div className="flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 p-3"><div className="mr-2"><p className="text-sm font-semibold text-blue-950">Next process: Verify packed order</p><p className="text-xs text-blue-800">Check the recorded quantities and confirm this order before dispatch.</p></div><Button size="sm" onClick={()=>run(`/warehouse/me/packing-tasks/${t.id}/verify`,{verified:true})}><ShieldCheck className="mr-2 h-4 w-4"/>Verify & Continue</Button></div>}
              {["packed","ready_for_dispatch"].includes(t.status) && <Button size="sm" variant="outline" onClick={()=>printLabel(t)}><PackageCheck className="mr-2 h-4 w-4"/>Print Label</Button>}
              {t.status === "ready_for_dispatch" && <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3"><Badge variant="success"><CheckCircle2 className="mr-1 h-4 w-4"/>Packing Verified · Ready for Dispatch</Badge><div className="mr-2"><p className="text-sm font-semibold text-emerald-950">Next process: Outgoing & Delivery Decision</p><p className="text-xs text-emerald-800">Choose the delivery route and continue dispatch.</p></div><Button size="sm" onClick={() => { window.location.href = "/outgoing"; }}><PackageCheck className="mr-2 h-4 w-4"/>Next: Continue to Dispatch</Button></div>}
            </div>
          </div>
        </CardContent></Card>
          ))}</div>
        </section>
      ))}</div>}
    </div>
  );
}
