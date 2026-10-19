"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PackageCheck, RefreshCw, Users, Play, CheckCircle2, Info, AlertTriangle, Warehouse, Search, Clock3 } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { api } from "../../lib/api/client";
import toast from "react-hot-toast";
import { QRCodeSVG } from "qrcode.react";

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
  const searchParams = useSearchParams();
  const requestedOrderId = searchParams.get("orderId") || "";
  const requestedFarm = searchParams.get("farm") || "";
  const [searchTerm, setSearchTerm] = useState("");
  const [printLabelData, setPrintLabelData] = useState<any | null>(null);
  const printQrRef = useRef<HTMLDivElement | null>(null);
  const [dateFilter, setDateFilter] = useState<"today" | "yesterday" | "week" | "all">(requestedOrderId || requestedFarm ? "all" : "today");
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
      if (requestedOrderId) {
        const taskOrderIds = [task.orderId, task.order?._id, task.orderNumber, task.orderNo, task.id].filter(Boolean).map(String);
        if (!taskOrderIds.includes(requestedOrderId)) return false;
      }
      if (requestedFarm) {
        const target = requestedFarm.includes(":") ? requestedFarm.slice(requestedFarm.indexOf(":") + 1).toLowerCase() : requestedFarm.toLowerCase();
        const farm = getFarmDetails(task);
        const farmValues = [farm.key, task.farmId, task.sourceFarmId, task.farmName, task.sourceFarmName, task.farmerName].filter(Boolean).map((value: any) => String(value).toLowerCase());
        if (!farmValues.some((value: string) => value === requestedFarm.toLowerCase() || value === target || value.endsWith(":" + target))) return false;
      }
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
  }, [tasks, searchTerm, dateFilter, requestedOrderId, requestedFarm]);

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

  const finishPackingTask = async (t: any) => {
    if (!window.confirm("Finish physical packing for order #" + (t.orderNumber || t.orderId) + "? Enter the actual packed quantity for every item next.")) return;
    const items: any[] = [];
    for (const item of (t.packingItems || [])) {
      const required = Number(item.quantityRequired || 0);
      const initial = String(Math.min(required, Math.max(0, Number(item.packedQuantity || required))));
      const entered = window.prompt("Actual quantity physically packed for " + (item.productName || "item") + " (required " + required + " " + (item.unit || "kg") + ")", initial);
      if (entered === null) return;
      const qty = Number(entered.trim());
      if (!Number.isFinite(qty) || qty < 0 || qty > required) { toast.error("Enter a quantity from 0 to " + required + " for " + (item.productName || "this item") + "."); return; }
      items.push({ productId: item.productId, variantId: item.variantId || undefined, packedQuantity: qty });
    }
    if (!items.length) { toast.error("This order has no packing checklist. Refresh or re-sync the order."); return; }
    try {
      const response = await api.put("/warehouse/me/packing-tasks/" + t.id + "/complete", { items, packedQuantity: items.reduce((sum: number, item: any) => sum + Number(item.packedQuantity || 0), 0), packageId: t.packageId || undefined });
      const root = response?.data?.data ?? response?.data ?? response;
      const shortageFlag = Boolean(root?.shortageDetectedAfterPacking || root?.shortageResolutionRequired || items.some((item: any) => { const line = (t.packingItems || []).find((x: any) => String(x.productId) === String(item.productId) && String(x.variantId || "") === String(item.variantId || "")); return Number(item.packedQuantity) < Number(line?.quantityRequired || 0); }));
      setTaskStatusOverrides((current) => ({ ...current, [t.id]: shortageFlag ? "customer_approval_pending" : "ready_for_dispatch" }));
      if (shortageFlag) {
        await refetchShortages();
        const refreshed = await api.get("/warehouse/me/shortages", { params: { status: "all" } });
        const rootShort = refreshed?.data?.data ?? refreshed?.data ?? refreshed;
        const cases = rootShort?.shortages ?? rootShort?.data?.shortages ?? [];
        const orderKey = String(t.orderId || t.order?._id || "");
        for (const shortage of cases.filter((s: any) => String(s.orderId) === orderKey && !["resolved", "cancelled", "customer_approval_pending"].includes(String(s.status || "").toLowerCase()))) {
          await api.put("/warehouse/me/shortages/" + shortage.id + "/resolution", { resolutionType: "customer_approval_pending", approvedQuantity: shortage.availableQuantity, notes: "Customer must choose whether to accept the available quantity or cancel the order. Warehouse cannot cancel it on the customer\u0027s behalf." });
        }
        toast.success("Physical shortage recorded. Customer approval is required before dispatch.");
      } else {
        toast.success("Packing quantities checked. The order is verified and ready for dispatch.");
      }
      await Promise.all([refetch(), refetchShortages()]);
    } catch (error: any) { toast.error(error?.response?.data?.detail || error?.message || "Could not finish packing this order."); }
  };
  const printLabel = (t: any) => setPrintLabelData(t);

  useEffect(() => {
    if (!printLabelData) return;
    const timer = window.setTimeout(() => {
      const t = printLabelData;
      const esc = (v: unknown) => String(v ?? "—").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c] as string));
      const order = t.order || {};
      const orderId = String(t.orderId || order.id || order._id || "");
      const orderNumber = t.orderNumber || order.orderNumber || orderId || "";
      const packageId = t.packageId || t.labelId || (t.id || t._id || orderNumber ? "PKG-" + String(t.id || t._id || orderNumber).slice(-8) : "");
      const customer = [t.customer?.name, t.customerName, order.customer?.name, order.customerName].find((v) => typeof v === "string" && v.trim()) || "";
      const phone = [t.customer?.phone, t.customerPhone, order.customer?.phone, order.customerPhone].find((v) => typeof v === "string" && v.trim()) || "";
      const address = t.deliveryAddress || t.shippingAddress || order.deliveryAddress || order.shippingAddress || order.address || t.customer?.address || order.customer?.address || {};
      const addressText = typeof address === "string" ? address.trim() : [address.formattedAddress,address.fullAddress,address.addressLine1,address.addressLine2,address.line1,address.line2,address.streetAddress,address.street,address.area,address.locality,address.village,address.district,address.city,address.state,address.pinCode || address.pincode || address.postalCode || address.zipCode].filter((v) => v !== undefined && v !== null && String(v).trim()).map((v) => String(v).trim()).join(", ");
      const farmName = [t.farmName, t.sourceFarmName, t.farmerName, order.farmName, t.farm?.name, t.sourceFarm?.name].find((v) => typeof v === "string" && v.trim()) || "";
      const warehouseName = "";
      const items = (t.packingItems?.length ? t.packingItems : t.items || []);
      const rows = items.filter((i: any) => i.productName || i.name || i.packedQuantity != null || i.actualPackedQuantity != null || i.quantity != null || i.quantityRequired != null).map((i: any) => {
        const name = i.productName || i.name || i.product?.name || "";
        const quantity = i.packedQuantity ?? i.actualPackedQuantity ?? i.quantity ?? i.quantityRequired;
        const unit = i.unit || i.product?.unit || "";
        const description = i.description || i.productDescription || i.product?.description || "";
        return "<tr><td><div class='item-name'>" + esc(name) + "</div><div class='muted'>" + esc(description || "Fresh produce") + "</div></td><td class='qty'>" + esc(quantity ?? "") + (unit ? " " + esc(unit) : "") + "</td></tr>";
      }).join("");
      const payment = String(t.paymentMethod || order.paymentMethod || order.payment?.method || "").toUpperCase();
      const rawAmount = t.totalAmount ?? t.total ?? order.totalAmount ?? order.total;
      const amount = Number(rawAmount);
      const paymentStatus = String(t.paymentStatus || order.paymentStatus || order.payment?.status || "").replace(/_/g, " ").toUpperCase();
      const qr = printQrRef.current?.querySelector("svg")?.outerHTML || "";
      const win = window.open("", "_blank", "width=720,height=900");
      if (!win) { toast.error("Please allow pop-ups to print the package label"); setPrintLabelData(null); return; }
      win.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>AgriConnect Delivery Label ${esc(orderNumber)}</title><style>*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;padding:12px;margin:0}.label{max-width:384px;margin:0 auto;border:1px solid #ddd;border-radius:4px;padding:8px 9px 7px}.brand{text-align:center;font-size:16px;font-weight:800;letter-spacing:.2px}.subtitle{text-align:center;font-size:7px;color:#444}.rule{border-top:1px solid #d5d5d5;margin:9px 0}.heading{font-size:7px;font-weight:500;color:#777;letter-spacing:.25px;margin:9px 0 4px}.value{font-size:9px;line-height:1.45;overflow-wrap:anywhere}.order{font-size:11px;font-weight:700}.muted{font-size:7px;color:#666;line-height:1.4;overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:5px}.origin{min-width:0}.item-name{font-size:9px}.qty{text-align:right;font-size:9px;font-weight:700;white-space:nowrap}table{width:100%;border-collapse:collapse;font-size:9px}td{padding:7px 0;border-bottom:1px solid #e5e5e5;vertical-align:top}.qr{text-align:center;margin-top:10px;border-top:1px solid #ddd;padding-top:8px}.qr svg{width:40px;height:40px}.qr .muted{font-size:6.5px}@media print{body{padding:0}.label{max-width:384px;width:100%;margin:0 auto;border:1px solid #ddd}}</style></head><body><main class="label"><div class="brand">AGRICONNECT</div><div class="subtitle">FARM-TO-HOME · DELIVERY LABEL</div><div class="rule"></div>
      ${orderNumber ? '<div class="heading">ORDER NUMBER</div><div class="order">' + esc(orderNumber) + '</div>' : ""}<div class="muted">${packageId ? "Package / Label ID: " + esc(packageId) + " · " : ""}Printed: ${esc(new Date().toLocaleString())}</div>
       ${farmName ? '<div class="heading">SOURCE FARM</div><div class="value">' + esc(farmName) + '</div>' + ([t.farmAddress, t.sourceFarmAddress, t.farm?.address, t.sourceFarm?.address].find((v) => typeof v === "string" && v.trim()) ? '<div class="muted">' + esc([t.farmAddress, t.sourceFarmAddress, t.farm?.address, t.sourceFarm?.address].find((v) => typeof v === "string" && v.trim())) + '</div>' : '') : ""}
      ${(customer || phone || addressText) ? '<div class="heading">DELIVER TO</div>' + (customer ? '<div class="value"><b>' + esc(customer) + '</b></div>' : "") + (phone ? '<div class="value">' + esc(phone) + '</div>' : "") + (addressText ? '<div class="value">' + esc(addressText) + '</div>' : "") : ""}
      ${rows ? '<div class="heading">PACKED ITEMS · ACTUAL QUANTITY</div><table>' + rows + '</table>' : ""}
      ${'<div class="heading">PAYMENT</div>' + (payment === "COD" ? '<div class="value">COD · Payable on delivery</div>' + (rawAmount !== undefined && rawAmount !== null && Number.isFinite(amount) ? '<div class="value">₹' + amount.toFixed(2) + '</div>' : '') : '<div class="value">' + esc(payment || 'Payment method unavailable') + (paymentStatus ? ' · ' + esc(paymentStatus) : '') + '</div>')}
      <div class="qr">${qr}<div class="muted"><b>DELIVERY PARTNER QR</b></div><div class="muted">Scan to open the delivery workspace. Login and assignment management authorization are required to access delivery actions and POD.</div><div class="muted verify">Verify the order reference before handover.</div></div></main><script>window.onload=()=>window.print();</script></body></html>`);
      win.document.close();
      setPrintLabelData(null);
    }, 100);
    return () => window.clearTimeout(timer);
  }, [printLabelData]);

  return (
    <>
    {printLabelData && <div aria-hidden="true" style={{ position: "fixed", left: "-10000px", top: 0 }}><div ref={printQrRef}><QRCodeSVG value={typeof window !== "undefined" ? window.location.origin + "/delivery/deliveries?orderId=" + encodeURIComponent(String(printLabelData.orderId || printLabelData.order?.id || printLabelData.order?._id || printLabelData.orderNumber || "")) : ""} size={160} level="M" /></div></div>}
      <div className="space-y-6">
      <Card className="border-blue-100 bg-blue-50/60"><CardContent className="flex gap-3 p-4"><Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-600"/><div className="text-sm text-blue-900"><p className="font-semibold">Only warehouse-fulfilled orders appear here.</p><p className="mt-1 text-xs leading-5 text-blue-800">Bulk farm stock is received, quality-checked, and stored first. Then the warehouse allocates stock to each customer order and packs each order separately. Farmer-fulfilled long-distance orders are already packed and must never be repacked here.</p></div></CardContent></Card>
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="border-amber-200 bg-amber-50/60"><CardContent className="p-4">
          <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-600 text-sm font-bold text-white">3</span><h2 className="font-semibold text-amber-950">Finish Packing &amp; Check Shortage</h2></div>
          <p className="mt-2 text-sm text-amber-900">Bulk stock is received before packing, so no shortage is shown from inventory estimates. Click Finish Order, enter the actual quantity physically packed for each item, and only then the system records any shortage. Short orders wait for the customer decision and cannot be dispatched.</p>
          <p className="mt-2 text-xs text-amber-800">Ready to pack: {tasks.filter((t:any)=>["packing","partially_packed"].includes(t.status)).length} · Shortage cases: {shortages.filter((s:any)=>!["resolved","cancelled"].includes(String(s.status||"").toLowerCase())).length}</p>
        </CardContent></Card>
        <Card className="border-blue-200 bg-blue-50/60"><CardContent className="p-4">
          <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">4</span><h2 className="font-semibold text-blue-950">Verify &amp; Dispatch</h2></div>
          <p className="mt-2 text-sm text-blue-900">When every item is fully packed, click Verify Packed Order. Successful verification creates dispatch records and changes the order to Ready for Dispatch.</p>
          <p className="mt-2 text-xs text-blue-800">Finish Order checks actual quantities and automatically prepares complete orders for dispatch. Shortage orders wait for the customer decision.</p>
          <Button className="mt-3" variant="outline" size="sm" onClick={()=>{window.location.href="/outgoing";}}>Open Dispatch</Button>
        </CardContent></Card>
      </div>
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold">Order Packing</h1><p className="text-muted-foreground">Pack each customer order separately after warehouse receiving.</p></div>
        <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={() => { window.location.assign("/outgoing"); }}><PackageCheck className="mr-2 h-4 w-4"/>Open Outgoing / Dispatch</Button><Button type="button" variant="outline" size="icon" onClick={() => { void Promise.all([refetch(), refetchShortages()]); }} aria-label="Refresh packing tasks"><RefreshCw className="h-4 w-4"/></Button></div>
      </div>
      <Card className="border-slate-200"><CardContent className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <button type="button" onClick={() => setShowRemainingOnly(false)} className={"rounded-lg border p-3 text-left transition " + (!showRemainingOnly ? "border-emerald-600 bg-emerald-50" : "border-slate-200 bg-white hover:bg-slate-50")}>
            <p className="text-sm text-muted-foreground">Matching orders</p><p className="mt-1 text-2xl font-bold">{filteredTasks.length}</p>
          </button>
          <button type="button" onClick={() => setShowRemainingOnly(true)} className={"rounded-lg border p-3 text-left transition " + (showRemainingOnly ? "border-amber-500 bg-amber-50" : "border-slate-200 bg-white hover:bg-slate-50")}>
            <p className="text-sm text-muted-foreground">Remaining — not finished</p><p className="mt-1 text-2xl font-bold">{unfinishedCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">Ready for Packing · Assigned · Packing · Partially Packed</p>
          </button>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm text-muted-foreground">Finished / awaiting next step</p><p className="mt-1 text-2xl font-bold">{finishedCount}</p>
          </div>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/><Input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search farm, farmer, order number, product, customer, address, or status…" className="pl-9"/></div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground"><Clock3 className="h-4 w-4"/>Date:</span>
            {([{value:"today",label:"Today"},{value:"yesterday",label:"Yesterday"},{value:"week",label:"This Week"},{value:"all",label:"All Time"}] as const).map((option) => <Button key={option.value} type="button" size="sm" variant={dateFilter === option.value ? "default" : "outline"} onClick={() => setDateFilter(option.value)}>{option.label}</Button>)}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Showing {visibleTasks.length} order(s) · {dateFilter === "today" ? "Today" : dateFilter === "yesterday" ? "Yesterday" : dateFilter === "week" ? "This Week (Monday-start)" : "All Time"}{showRemainingOnly ? " · Remaining orders only" : ""}</p>
      </CardContent></Card>
      {shortages.filter((x:any) => !["resolved", "cancelled"].includes(String(x.status || "").toLowerCase())).length > 0 && (
        <Card className="border-red-200 bg-red-50/70">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600"/>
              <div className="flex-1">
                <p className="font-semibold text-red-900">Shortage Resolution — dispatch blocked</p>
                <p className="mt-1 text-sm text-red-800">Shortages are confirmed from physical packed quantities. Resolve each case and then verify the final packing quantities before dispatch.</p>
                <div className="mt-4 space-y-3">
                  {shortages.filter((x:any) => !["resolved", "cancelled"].includes(String(x.status || "").toLowerCase())).map((x:any) => (
                    <div key={x.id} className="rounded-md border border-red-200 bg-white p-4 text-sm">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="font-semibold">Order #{x.orderNumber || x.orderId?.slice(-8)} · {x.productName || "Product"}</div>
                        <Badge variant="outline" className="border-red-200 text-red-700">{String(x.status || "open").replace(/_/g, " ")}</Badge>
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        <div className="rounded bg-slate-50 p-2"><span className="text-xs text-muted-foreground">Required</span><p className="font-semibold">{Number(x.requiredQuantity || 0)} {x.unit || "kg"}</p></div>
                        <div className="rounded bg-slate-50 p-2"><span className="text-xs text-muted-foreground">Physically available</span><p className="font-semibold">{Number(x.availableQuantity || 0)} {x.unit || "kg"}</p></div>
                        <div className="rounded bg-red-50 p-2"><span className="text-xs text-red-700">Short quantity</span><p className="font-semibold text-red-800">{Number(x.shortageQuantity ?? Math.max(0, Number(x.requiredQuantity || 0) - Number(x.availableQuantity || 0)))} {x.unit || "kg"}</p></div>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">Available product remains usable. Choose a resolution below; dispatch stays blocked while any shortage is unresolved.</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" disabled={["replenishment_requested"].includes(String(x.status || "").toLowerCase())} onClick={async () => {
                          try { const r = await api.put("/warehouse/me/shortages/" + x.id + "/resolution", { resolutionType: "farmer_replenishment", notes: "Warehouse requested replenishment for the physically confirmed shortage." }); toast.success(r?.data?.message || "Replenishment request recorded."); await Promise.all([refetch(), refetchShortages()]); }
                          catch (e:any) { toast.error(e?.response?.data?.detail || e?.message || "Could not request replenishment."); }
                        }}>Request Replenishment</Button>
                        <Button type="button" size="sm" variant="outline" disabled={["customer_approval_pending"].includes(String(x.status || "").toLowerCase())} onClick={async () => {
                          try { const r = await api.put("/warehouse/me/shortages/" + x.id + "/resolution", { resolutionType: "customer_approval_pending", approvedQuantity: Number(x.availableQuantity || 0), notes: "Customer must approve reduced quantity or choose cancellation before dispatch." }); toast.success(r?.data?.message || "Customer approval requested."); await Promise.all([refetch(), refetchShortages()]); }
                          catch (e:any) { toast.error(e?.response?.data?.detail || e?.message || "Could not request customer approval."); }
                        }}>Request Customer Decision</Button>
                        <Button type="button" size="sm" variant="outline" onClick={async () => {
                          const productId = window.prompt("Enter the substitute product ID. The customer must approve this substitution before it can be packed.");
                          if (!productId) return;
                          try { const r = await api.put("/warehouse/me/shortages/" + x.id + "/resolution", { resolutionType: "substitution_pending", substituteProductId: productId.trim(), notes: "Substitute proposed; customer approval required before packing." }); toast.success(r?.data?.message || "Substitution proposal recorded."); await Promise.all([refetch(), refetchShortages()]); }
                          catch (e:any) { toast.error(e?.response?.data?.detail || e?.message || "Could not propose substitution."); }
                        }}>Propose Substitute</Button>
                        <Button type="button" size="sm" variant="destructive" onClick={async () => {
                          const shortQty = Math.max(0, Number(x.requiredQuantity || 0) - Number(x.availableQuantity || 0));
                          const raw = window.prompt("Enter the unavailable quantity approved by the customer for cancellation/refund (maximum " + shortQty + "). Do not proceed without customer approval.", String(shortQty));
                          if (raw === null) return;
                          const qty = Number(raw);
                          if (!Number.isFinite(qty) || qty <= 0 || qty > shortQty) { toast.error("Enter a quantity greater than 0 and no more than " + shortQty + "."); return; }
                          if (!window.confirm("Confirm the customer has approved cancellation/refund of " + qty + " units? This updates the order quantity and payable/refund record.")) return;
                          try { const r = await api.put("/warehouse/me/shortages/" + x.id + "/resolution", { resolutionType: "refund_cancellation", resolvedQuantity: qty, notes: "Customer-approved cancellation/refund of unavailable quantity." }); toast.success(r?.data?.message || "Cancellation/refund quantity recorded."); await Promise.all([refetch(), refetchShortages()]); }
                          catch (e:any) { toast.error(e?.response?.data?.detail || e?.message || "Could not record cancellation/refund."); }
                        }}>Record Approved Cancel / Refund</Button>
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
      {isLoading ? <div className="h-32 animate-pulse rounded-lg bg-muted"/> : !packingError && visibleTasks.length === 0 ? (
        <Card className="p-12 text-center"><PackageCheck className="mx-auto h-12 w-12 text-muted-foreground"/><h3 className="mt-4 font-semibold">{showRemainingOnly ? "No remaining orders in this date range" : searchTerm.trim() ? "No orders match your search" : "No packing tasks in this date range"}</h3><p className="mt-2 text-sm text-muted-foreground">{showRemainingOnly ? "All matching orders have finished packing or are waiting for customer approval/verification." : "Try another date range or search term, or choose All Time to see older orders."}</p></Card>
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

            {farm.tasks.some((task: any) => ["packing","partially_packed"].includes(String(task.status || "").toLowerCase())) && <Badge variant="outline">Packing in progress — progress is saved per order; continue below</Badge>}
            {farmAssignmentMessages[farm.key] && <div role="status" aria-live="polite" className={"mt-3 rounded-md border px-3 py-2 text-sm " + (farmAssignmentMessages[farm.key].kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : farmAssignmentMessages[farm.key].kind === "error" ? "border-red-200 bg-red-50 text-red-900" : "border-blue-200 bg-blue-50 text-blue-900")}>{farmAssignmentMessages[farm.key].text}</div>}
          </CardContent></Card>
          <div className="space-y-3">{farm.tasks.map((t:any) => (
        <Card key={t.id} className="overflow-hidden border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md"><CardContent className="p-0">
          <div className="flex flex-col lg:flex-row">
            <div className="min-w-0 flex-1 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-slate-900">Order #{t.orderNumber || t.orderId?.slice(-8)}</h3><Badge variant="outline" className={"rounded-full px-2.5 py-0.5 text-xs " + (["packed","ready_for_dispatch","dispatched"].includes(String(t.status||"").toLowerCase()) ? "border-emerald-200 bg-emerald-50 text-emerald-700" : t.status === "customer_approval_pending" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-blue-200 bg-blue-50 text-blue-700")}>{String(t.status || "ready_for_packing").replace(/_/g, " ")}</Badge></div>
                  <p className="mt-1 text-sm text-muted-foreground">{t.createdAt ? new Date(t.createdAt).toLocaleString() : "Packing task"}</p>
                </div>
                <div className="text-left sm:text-right"><p className="text-lg font-bold tracking-tight text-slate-900">{Number(t.packedQuantity || 0)} / {Number(t.quantityRequired || 0)} packed</p><p className="text-xs text-muted-foreground">Batch: {t.batchId || "—"}</p></div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Customer</p><p className="mt-1 truncate text-sm font-medium text-slate-900">{t.customer?.name || "Customer details unavailable"}</p></div>
                <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Items</p><p className="mt-1 text-sm font-medium text-slate-900">{(t.packingItems || t.items || []).length} item{(t.packingItems || t.items || []).length === 1 ? "" : "s"}</p></div>
                <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Delivery</p><p className="mt-1 truncate text-sm font-medium text-slate-900">{t.deliveryAddress ? [t.deliveryAddress.addressLine1, t.deliveryAddress.city, t.deliveryAddress.state, t.deliveryAddress.zipCode].filter(Boolean).join(", ") : "Address not available"}</p></div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {(t.packingItems || t.items || []).slice(0,2).map((item:any,idx:number)=><span key={item.itemKey || item.id || idx} className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">{item.productName || item.name || "Product"} · {item.quantityRequired ?? item.quantity ?? 0} {item.unit || ""}</span>)}
                {(t.packingItems || t.items || []).length > 2 && <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">+{(t.packingItems || t.items || []).length - 2} more</span>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2"><Badge variant="outline" className="rounded-full border-blue-200 bg-blue-50 text-blue-700"><Warehouse className="mr-1 h-3 w-3"/>Warehouse Fulfillment</Badge><Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-600">Packing task</Badge></div>
              {(t.packingItems || []).length > 0 && (
                <div className="mt-3 rounded-md border bg-slate-50 p-3 text-xs">
                  <div className="font-semibold text-slate-800">Order-line allocation</div>
                  <div className="mt-2 space-y-1">
                    {(t.packingItems || []).map((i:any) => (
                      <div key={i.itemKey} className="flex flex-wrap justify-between gap-2">
                        <span>{i.productName}</span>
                        <span>
                          {Number(i.packedQuantity || 0)} / {Number(i.quantityRequired || 0)} {i.unit || "kg"}
                          {Boolean(t.packingAttemptComplete) && Number(i.quantityShort || 0) > 0 && <span className="ml-2 font-semibold text-red-700">short {Number(i.quantityShort).toFixed(2)} {i.unit || "kg"}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="mt-3 text-xs text-muted-foreground">Delivery: {t.deliveryAddress ? [t.deliveryAddress.addressLine1, t.deliveryAddress.city, t.deliveryAddress.state, t.deliveryAddress.zipCode].filter(Boolean).join(", ") : "Address not available"}</p>
            </div>
            <div className="border-t bg-slate-50/70 p-4 sm:p-5 lg:w-[320px] lg:border-l lg:border-t-0">
              <div className="mb-3 rounded-lg border border-slate-200 bg-white p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Next action</p><p className="mt-1 text-sm font-semibold text-slate-900">{["ready_for_packing","assigned"].includes(String(t.status||"").toLowerCase()) ? "Check quantities, then finish packing" : ["ready_for_packing","assigned","packing","partially_packed"].includes(String(t.status||"").toLowerCase()) ? "Check quantities, then finish packing" : t.status === "packed" ? "Packing completed — refresh order status" : t.status === "customer_approval_pending" ? "Waiting for customer decision" : t.status === "ready_for_dispatch" ? "Continue to dispatch" : "Review order status"}</p><p className="mt-1 text-xs text-muted-foreground">Process this order independently. Its saved stage is retained when you return to this page.</p></div>
              <div className="space-y-2">
              
              {["ready_for_packing","assigned","packing","partially_packed"].includes(String(t.status || "").toLowerCase()) && <Button size="sm" onClick={() => finishPackingTask(t)}><PackageCheck className="mr-2 h-4 w-4"/>Finish Order</Button>}
              {t.status === "customer_approval_pending" && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-semibold">Waiting for customer decision</p><p className="mt-1">The customer must accept the available quantity or cancel the order. Dispatch remains blocked until the customer responds and the final quantities are checked.</p></div>}
              {t.status === "packed" && <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><p className="font-semibold">Packing quantities checked during Finish Order</p><p className="mt-1">No separate verification action is needed. Refresh the page if the order status has not updated.</p></div>}
              {["packed","ready_for_dispatch"].includes(t.status) && <Button size="sm" variant="outline" className="h-9 px-4 text-sm" onClick={()=>printLabel(t)}><PackageCheck className="mr-2 h-4 w-4"/>Print Label</Button>}
              {t.status === "ready_for_dispatch" && <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3"><Badge variant="success"><CheckCircle2 className="mr-1 h-4 w-4"/>Packing Checked · Ready for Dispatch</Badge><Button size="sm" onClick={() => { window.location.href = "/outgoing"; }}><PackageCheck className="mr-2 h-4 w-4"/>Next: Continue to Dispatch</Button></div>}
              </div>
            </div>
          </div>
        </CardContent></Card>
          ))}</div>
        </section>
      ))}</div>}
    </div>
    </>
  );
}
