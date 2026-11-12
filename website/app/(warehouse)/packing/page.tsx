"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { PackageCheck, RefreshCw, Users, Play, CheckCircle2, Info, AlertTriangle, Warehouse, Search, Clock3, Box, Truck, MapPin, Phone, Printer, ChevronRight, ClipboardCheck } from "lucide-react";
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
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [queueTab, setQueueTab] = useState<"queue" | "packing" | "shortage" | "completed">("queue");
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
  const unwrapShortageResponse = (value: any): any => {
    let current = value;
    for (let i = 0; i < 4 && current?.data; i += 1) current = current.data;
    return current;
  };
  const shortageRoot = unwrapShortageResponse(shortageData);
  const shortages = Array.isArray(shortageRoot?.shortages)
    ? shortageRoot.shortages
    : Array.isArray(shortageRoot?.data?.shortages)
      ? shortageRoot.data.shortages
      : Array.isArray(shortageData?.data?.data?.shortages)
        ? shortageData.data.data.shortages
        : [];

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

  const unresolvedShortages = shortages.filter((item: any) => !["resolved", "cancelled", "closed"].includes(String(item.status || "").toLowerCase()));
  const shortageOrderIds = new Set(unresolvedShortages.flatMap((item: any) => [item.orderId, item.orderNumber, item.order?._id, item.order?.id].filter(Boolean).map(String)));
  const taskHasOpenShortage = (task: any) => [task.orderId, task.orderNumber, task.order?.id, task.order?._id, task.id].filter(Boolean).some((id: any) => shortageOrderIds.has(String(id)));
  const visibleTasks = useMemo(() => {
    if (queueTab === "completed") return filteredTasks.filter((task: any) => ["packed", "verified", "ready_for_dispatch", "dispatched"].includes(String(task.status || "").toLowerCase()) && !taskHasOpenShortage(task));
    if (queueTab === "shortage") return filteredTasks.filter((task: any) => taskHasOpenShortage(task) || String(task.status || "").toLowerCase() === "customer_approval_pending");
    if (queueTab === "packing") return filteredTasks.filter((task: any) => ["assigned", "packing", "partially_packed"].includes(String(task.status || "").toLowerCase()) && !taskHasOpenShortage(task));
    return filteredTasks.filter((task: any) => String(task.status || "").toLowerCase() === "ready_for_packing" && !taskHasOpenShortage(task));
  }, [filteredTasks, queueTab, shortageData]);
  const selectedTask = visibleTasks.find((task: any) => String(task.id) === selectedOrderId) || visibleTasks[0] || null;
  const selectedShortage = unresolvedShortages.find((item: any) => String(item.id || item._id) === selectedOrderId) || unresolvedShortages[0] || null;
  const selectedShortageTask = selectedShortage ? filteredTasks.find((task: any) => [task.orderId, task.orderNumber, task.order?.id, task.order?._id, task.id].filter(Boolean).some((id: any) => [selectedShortage.orderId, selectedShortage.orderNumber, selectedShortage.order?.id, selectedShortage.order?._id].filter(Boolean).map(String).includes(String(id)))) : null;
  const selectedItems = selectedTask?.packingItems?.length ? selectedTask.packingItems : selectedTask?.items || [];
  const totalRequired = selectedItems.reduce((sum: number, item: any) => sum + Number(item.quantityRequired ?? item.quantity ?? 0), 0);
  const totalPacked = selectedItems.reduce((sum: number, item: any) => sum + Number(item.packedQuantity ?? item.actualPackedQuantity ?? 0), 0);
  const totalShortage = selectedItems.reduce((sum: number, item: any) => sum + Math.max(0, Number(item.quantityRequired ?? item.quantity ?? 0) - Number(item.packedQuantity ?? item.actualPackedQuantity ?? 0)), 0);

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

  const unfinishedCount = filteredTasks.filter((task: any) => String(task.status || "").toLowerCase() === "ready_for_packing" && !taskHasOpenShortage(task)).length;
  const packingCount = filteredTasks.filter((task: any) => ["assigned", "packing", "partially_packed"].includes(String(task.status || "").toLowerCase()) && !taskHasOpenShortage(task)).length;
  const completedCount = filteredTasks.filter((task: any) => ["packed", "verified", "ready_for_dispatch", "dispatched"].includes(String(task.status || "").toLowerCase()) && !taskHasOpenShortage(task)).length;
  const shortageTaskCount = unresolvedShortages.length;
  const finishedCount = filteredTasks.filter((task: any) => !isUnfinishedPackingTask(task)).length;

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
      const text = "Team assigned successfully to " + assigned + " order(s). You can now click Finish Order directly and enter the actual packed quantities.";
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
        toast.success("Packing finished. Dispatch records were created automatically; open Outgoing / Dispatch to process the shipment.");
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
      const paymentRaw = String(t.paymentMethod || t.payment_method || t.paymentMode || t.paymentType || t.payment?.method || t.payment?.paymentMethod || order.paymentMethod || order.payment_method || order.paymentMode || order.paymentType || order.payment?.method || order.payment?.paymentMethod || (t.cashOnDelivery || order.cashOnDelivery ? "cash" : "")).trim().toLowerCase().replace(/[ -]+/g, "_");
      const isCod = ["cash", "cod", "cash_on_delivery", "cashondelivery", "pay_on_delivery", "pay_later"].includes(paymentRaw);
      const isOnline = ["online", "online_payment", "razorpay", "upi", "card", "netbanking", "net_banking", "wallet", "stripe"].includes(paymentRaw);
      const payment = isCod ? "COD" : isOnline ? "ONLINE" : "";
      const rawAmount = t.finalPayableAmount ?? t.totalAmount ?? t.grandTotal ?? t.payableAmount ?? t.total ?? order.finalPayableAmount ?? order.totalAmount ?? order.grandTotal ?? order.payableAmount ?? order.total;
      const amount = Number(rawAmount);
      const qr = printQrRef.current?.querySelector("svg")?.outerHTML || "";
      const win = window.open("", "_blank", "width=720,height=900");
      if (!win) { toast.error("Please allow pop-ups to print the package label"); setPrintLabelData(null); return; }
      win.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>AgriConnect Delivery Label ${esc(orderNumber)}</title><style>*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;padding:12px;margin:0}.label{max-width:384px;margin:0 auto;border:1px solid #ddd;border-radius:4px;padding:8px 9px 7px}.brand{text-align:center;font-size:16px;font-weight:800;letter-spacing:.2px}.subtitle{text-align:center;font-size:7px;color:#444}.rule{border-top:1px solid #d5d5d5;margin:9px 0}.heading{font-size:7px;font-weight:500;color:#777;letter-spacing:.25px;margin:9px 0 4px}.value{font-size:9px;line-height:1.45;overflow-wrap:anywhere}.order{font-size:11px;font-weight:700}.muted{font-size:7px;color:#666;line-height:1.4;overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:5px}.origin{min-width:0}.item-name{font-size:9px}.qty{text-align:right;font-size:9px;font-weight:700;white-space:nowrap}table{width:100%;border-collapse:collapse;font-size:9px}td{padding:7px 0;border-bottom:1px solid #e5e5e5;vertical-align:top}.qr{text-align:center;margin-top:10px;border-top:1px solid #ddd;padding-top:8px}.qr svg{width:40px;height:40px}.qr .muted{font-size:6.5px}@media print{body{padding:0}.label{max-width:384px;width:100%;margin:0 auto;border:1px solid #ddd}}</style></head><body><main class="label"><div class="brand">AGRICONNECT</div><div class="subtitle">FARM-TO-HOME · DELIVERY LABEL</div><div class="rule"></div>
      ${orderNumber ? '<div class="heading">ORDER NUMBER</div><div class="order">' + esc(orderNumber) + '</div>' : ""}<div class="muted">${packageId ? "Package / Label ID: " + esc(packageId) + " · " : ""}Printed: ${esc(new Date().toLocaleString())}</div>
       ${farmName ? '<div class="heading">SOURCE FARM</div><div class="value">' + esc(farmName) + '</div>' + ([t.farmAddress, t.sourceFarmAddress, t.farm?.address, t.sourceFarm?.address].find((v) => typeof v === "string" && v.trim()) ? '<div class="muted">' + esc([t.farmAddress, t.sourceFarmAddress, t.farm?.address, t.sourceFarm?.address].find((v) => typeof v === "string" && v.trim())) + '</div>' : '') : ""}
      ${(customer || phone || addressText) ? '<div class="heading">DELIVER TO</div>' + (customer ? '<div class="value"><b>' + esc(customer) + '</b></div>' : "") + (phone ? '<div class="value">' + esc(phone) + '</div>' : "") + (addressText ? '<div class="value">' + esc(addressText) + '</div>' : "") : ""}
      ${rows ? '<div class="heading">PACKED ITEMS · ACTUAL QUANTITY</div><table>' + rows + '</table>' : ""}
        ${'<div class="heading">PAYMENT</div>' + (payment === "COD" ? '<div class="value">COD · Payable on delivery</div>' + (rawAmount !== undefined && rawAmount !== null && Number.isFinite(amount) ? '<div class="value">₹' + amount.toFixed(2) + '</div>' : '') : payment === "ONLINE" ? '<div class="value">ONLINE PAYMENT · PAID</div>' : '<div class="value">PAYMENT DETAILS UNCONFIRMED · Do not dispatch until verified</div>')}
      <div class="qr">${qr}<div class="muted"><b>DELIVERY PARTNER QR</b></div><div class="muted">Scan to open the delivery workspace. Login and assignment management authorization are required to access delivery actions and POD.</div><div class="muted verify">Verify the order reference before handover.</div></div></main><script>window.onload=()=>window.print();</script></body></html>`);
      win.document.close();
      setPrintLabelData(null);
    }, 100);
    return () => window.clearTimeout(timer);
  }, [printLabelData]);

  return (
    <>
    {printLabelData && <div aria-hidden="true" style={{ position: "fixed", left: "-10000px", top: 0 }}><div ref={printQrRef}><QRCodeSVG value={typeof window !== "undefined" ? window.location.origin + "/delivery/deliveries?orderId=" + encodeURIComponent(String(printLabelData.orderId || printLabelData.order?.id || printLabelData.order?._id || printLabelData.orderNumber || "")) : ""} size={160} level="M" /></div></div>}
      <div className="warehouse-packing-page w-full space-y-5 bg-slate-50/50 px-3 py-4 sm:px-5 lg:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><PackageCheck className="h-6 w-6"/></div>
          <div><h1 className="text-2xl font-bold tracking-tight text-slate-900">Order Packing</h1><p className="text-sm text-muted-foreground">Check each order, finish physical packing, then continue in Outgoing / Dispatch.</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => { window.location.assign("/outgoing"); }}><PackageCheck className="mr-2 h-4 w-4"/>Outgoing / Dispatch</Button>
          <Button type="button" variant="outline" onClick={() => { void Promise.all([refetch(), refetchShortages()]); }}><RefreshCw className="mr-2 h-4 w-4"/>Refresh</Button>
        </div>
      </div>

      {packingError && <Card className="border-red-200 bg-red-50"><CardContent className="p-4 text-sm text-red-700">Unable to load warehouse packing tasks. Check the backend logs or refresh the page.</CardContent></Card>}
      {isLoading ? <div className="h-32 animate-pulse rounded-lg bg-muted"/> : (
        <div className={`grid items-start gap-4 ${queueTab === "shortage" ? "grid-cols-1" : "xl:grid-cols-[minmax(390px,0.92fr)_minmax(0,1.65fr)]"}`}>
          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <CardContent className="space-y-3 p-3 sm:p-4">
              <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1">
                {([
                  { id: "queue", label: "Packing Queue", count: unfinishedCount },
                  { id: "packing", label: "In Packing", count: packingCount },
                  { id: "shortage", label: "Shortage", count: shortageTaskCount },
                  { id: "completed", label: "Completed", count: completedCount },
                ] as const).map((tab) => (
                  <button key={tab.id} type="button" onClick={() => { setQueueTab(tab.id); setSelectedOrderId(""); }} className={`min-w-0 rounded-lg px-2 py-2 text-center transition-colors ${queueTab === tab.id ? "bg-emerald-700 text-white shadow-sm" : "text-slate-600 hover:bg-white"}`}>
                    <span className="block truncate text-xs font-semibold sm:text-sm">{tab.label}</span>
                    <span className="mt-0.5 block text-sm font-bold">{tab.count}</span>
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/>
                <Input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search order, customer, farmer, product…" className="h-10 pl-9"/>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{visibleTasks.length} order(s) in this view</span>
                <span>{dateFilter === "today" ? "Today" : dateFilter === "yesterday" ? "Yesterday" : dateFilter === "week" ? "This Week" : "All Time"}</span>
              </div>
              <div className="max-h-[min(72vh,820px)] space-y-2 overflow-y-auto pr-1">
                {queueTab === "shortage" ? (
                  unresolvedShortages.length > 0 ? (
                    <details open className="group overflow-hidden rounded-xl border border-red-200 bg-white shadow-sm">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-red-50/70 px-4 py-3 marker:hidden">
                        <span className="flex min-w-0 items-center gap-2"><AlertTriangle className="h-5 w-5 shrink-0 text-red-600"/><span><span className="block text-sm font-semibold text-red-900">Shortage resolution required</span><span className="block text-xs text-red-700">{unresolvedShortages.length} unresolved case(s) · Dispatch remains blocked until resolved</span></span></span>
                        <span className="shrink-0 text-xs font-semibold text-red-700 group-open:hidden">View cases</span><span className="hidden shrink-0 text-xs font-semibold text-red-700 group-open:inline">Hide cases</span>
                      </summary>
                      <div className="border-t border-red-100 p-4">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600"/>
                          <div className="flex-1">
                            <p className="font-semibold text-red-900">Shortage Resolution — dispatch blocked</p>
                            <p className="mt-1 text-sm text-red-800">Shortages are confirmed from physical packed quantities. Resolve each case and then verify the final packing quantities before dispatch.</p>
                            <div className="mt-4 space-y-3">
                              {unresolvedShortages.map((x:any) => (
                                <button key={x.id} type="button" onClick={() => setSelectedOrderId(String(x.id || x._id))} className={`block w-full rounded-md border bg-white p-4 text-left text-sm transition-colors ${String(selectedShortage?.id || selectedShortage?._id) === String(x.id || x._id) ? "border-red-400 bg-red-50/40 ring-1 ring-red-100" : "border-red-200 hover:border-red-300"}`}>
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
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </details>
                  ) : (
                    <div className="rounded-xl border border-dashed p-8 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500"/><p className="mt-2 text-sm font-semibold text-slate-700">No open shortage cases</p><p className="mt-1 text-xs text-slate-500">Orders with shortages will appear here until resolved.</p></div>
                  )
                ) : (
                  <>
                    {visibleTasks.map((task: any) => {
                  const taskFarm = getFarmDetails(task);
                  const taskStatus = String(task.status || "ready_for_packing").toLowerCase();
                  const active = String(selectedTask?.id) === String(task.id);
                  const taskItems = task.packingItems?.length ? task.packingItems : task.items || [];
                  const quantity = taskItems.reduce((sum: number, item: any) => sum + Number(item.quantityRequired ?? item.quantity ?? 0), 0);
                  return (
                    <button key={task.id} type="button" onClick={() => setSelectedOrderId(String(task.id))} className={`w-full rounded-xl border p-3 text-left transition-all ${active ? "border-emerald-500 bg-emerald-50/80 shadow-sm ring-1 ring-emerald-100" : "border-slate-200 bg-white hover:border-emerald-300 hover:bg-slate-50"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-900">#{task.orderNumber || task.orderId?.slice(-8) || task.id}</p>
                          <p className="mt-1 flex items-center gap-1 truncate text-sm text-slate-600"><Users className="h-3 w-3 shrink-0"/>{task.customer?.name || "Customer details unavailable"}</p>
                          <p className="mt-1 flex items-center gap-1 truncate text-sm text-slate-500"><MapPin className="h-3 w-3 shrink-0"/>{[task.deliveryAddress?.city, task.deliveryAddress?.district, task.deliveryAddress?.state].filter(Boolean).join(", ") || taskFarm.name}</p>
                          <p className="mt-1 flex items-center gap-1 text-sm text-slate-500"><Box className="h-3 w-3"/>{taskItems.length} product(s) · {quantity} {taskItems[0]?.unit || "kg"}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <Badge variant="outline" className={taskStatus === "customer_approval_pending" ? "border-amber-200 bg-amber-50 text-amber-800" : ["packed","verified","ready_for_dispatch","dispatched"].includes(taskStatus) ? "border-blue-200 bg-blue-50 text-blue-700" : taskStatus === "ready_for_packing" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}>{taskStatus.replace(/_/g, " ")}</Badge>
                          <ChevronRight className={`h-4 w-4 ${active ? "text-emerald-700" : "text-slate-400"}`}/>
                        </div>
                      </div>
                    </button>
                  );
                })}

                                    {queueTab !== "shortage" && visibleTasks.length === 0 && <div className="rounded-xl border border-dashed p-8 text-center"><PackageCheck className="mx-auto h-8 w-8 text-slate-300"/><p className="mt-2 text-sm font-semibold text-slate-700">No orders in this section</p><p className="mt-1 text-xs text-slate-500">Choose another tab or date range.</p></div>}
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {queueTab === "shortage" ? (
            selectedShortage ? (
              <Card className="overflow-hidden border-red-200 shadow-sm">
                <CardContent className="space-y-5 p-4 sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-700"><AlertTriangle className="h-5 w-5"/></div>
                        <h2 className="text-xl font-bold text-slate-900">#{selectedShortage.orderNumber || selectedShortageTask?.orderNumber || selectedShortage.orderId || "Shortage order"}</h2>
                        <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">{String(selectedShortage.status || "open").replace(/_/g, " ")}</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                        <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5"/>{selectedShortageTask?.customer?.name || selectedShortage.customerName || "Customer details unavailable"}</span>
                        {selectedShortageTask?.customer?.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5"/>{selectedShortageTask.customer.phone}</span>}
                        <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5"/>{[selectedShortageTask?.deliveryAddress?.city, selectedShortageTask?.deliveryAddress?.district, selectedShortageTask?.deliveryAddress?.state].filter(Boolean).join(", ") || "Delivery location unavailable"}</span>
                      </div>
                    </div>
                    <div className="rounded-xl bg-red-50 px-4 py-3"><p className="text-[11px] font-medium text-red-800">Short quantity</p><p className="text-xl font-bold text-red-950">{Number(selectedShortage.shortageQuantity ?? Math.max(0, Number(selectedShortage.requiredQuantity || 0) - Number(selectedShortage.availableQuantity || 0)))} {selectedShortage.unit || "kg"}</p></div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Order confirmed</p><CheckCircle2 className="mx-auto mt-2 h-5 w-5 text-emerald-600"/></div>
                    <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Preparing</p><CheckCircle2 className="mx-auto mt-2 h-5 w-5 text-emerald-600"/></div>
                    <div className="rounded-lg bg-red-50 p-3"><p className="text-xs font-semibold text-red-700">Packing shortage</p><AlertTriangle className="mx-auto mt-2 h-5 w-5 text-red-600"/></div>
                  </div>
                  <div>
                    <h3 className="mb-3 font-bold text-slate-900">Shortage product details</h3>
                    <div className="overflow-hidden rounded-xl border">
                      <div className="grid grid-cols-4 gap-2 bg-slate-50 px-3 py-3 text-xs font-semibold text-slate-600"><span>Product</span><span>Required</span><span>Available</span><span>Shortage</span></div>
                      <div className="grid grid-cols-4 gap-2 px-3 py-4 text-sm"><span className="font-semibold text-slate-800">{selectedShortage.productName || "Product"}</span><span>{Number(selectedShortage.requiredQuantity || 0)} {selectedShortage.unit || "kg"}</span><span>{Number(selectedShortage.availableQuantity || 0)} {selectedShortage.unit || "kg"}</span><span className="font-bold text-red-700">{Number(selectedShortage.shortageQuantity ?? Math.max(0, Number(selectedShortage.requiredQuantity || 0) - Number(selectedShortage.availableQuantity || 0)))} {selectedShortage.unit || "kg"}</span></div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-semibold text-amber-900">Dispatch is blocked</p><p className="mt-1 text-xs text-amber-800">Resolve this shortage using the actions on the left. Once the customer decision or replenishment is recorded, refresh the queue to update the order.</p></div>
                </CardContent>
              </Card>
            ) : <Card className="flex min-h-[420px] items-center justify-center border-dashed"><CardContent className="text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500"/><h3 className="mt-3 font-semibold text-slate-800">No open shortage cases</h3><p className="mt-1 text-sm text-slate-500">There are no shortage orders to review.</p></CardContent></Card>
          ) : (selectedTask ? (
            <Card className="overflow-hidden border-slate-200 shadow-sm">
              <CardContent className="space-y-5 p-4 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><PackageCheck className="h-5 w-5"/></div>
                      <h2 className="text-xl font-bold text-slate-900">#{selectedTask.orderNumber || selectedTask.orderId?.slice(-8) || selectedTask.id}</h2>
                      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">{String(selectedTask.status || "ready_for_packing").replace(/_/g, " ")}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                      <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5"/>{selectedTask.customer?.name || "Customer unavailable"}</span>
                      {selectedTask.customer?.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5"/>{selectedTask.customer.phone}</span>}
                      <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5"/>{[selectedTask.deliveryAddress?.city, selectedTask.deliveryAddress?.district, selectedTask.deliveryAddress?.state].filter(Boolean).join(", ") || "Delivery location unavailable"}</span>
                    </div>
                  </div>
                  <div className="rounded-xl bg-emerald-50 px-4 py-3"><p className="text-[11px] font-medium text-emerald-800">Order value</p><p className="text-xl font-bold text-emerald-950">₹{Number(selectedTask.totalAmount || selectedTask.orderTotal || selectedTask.order?.totalAmount || 0).toLocaleString("en-IN")}</p></div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: "Order confirmed", done: true },
                    { label: "Preparing", done: ["packing","partially_packed","packed","verified","ready_for_dispatch"].includes(String(selectedTask.status || "").toLowerCase()) },
                    { label: "Packing", done: ["packing","partially_packed","packed","verified","ready_for_dispatch"].includes(String(selectedTask.status || "").toLowerCase()), current: ["ready_for_packing","assigned","packing","partially_packed"].includes(String(selectedTask.status || "").toLowerCase()) },
                  ].map((step) => <div key={step.label} className="rounded-lg bg-slate-50 p-2"><div className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full ${step.current ? "bg-emerald-700 text-white" : step.done ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-500"}`}>{step.done ? <CheckCircle2 className="h-4 w-4"/> : <Box className="h-4 w-4"/>}</div><p className="mt-1 text-[11px] font-semibold text-slate-700">{step.label}{step.current ? " (Current)" : ""}</p></div>)}
                </div>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_230px]">
                  <div className="min-w-0">
                    <div className="mb-2 flex items-center justify-between gap-2"><h3 className="font-bold text-slate-900">Pack Products ({selectedItems.length})</h3><Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Total Order Weight: {totalRequired} {selectedItems[0]?.unit || "kg"}</Badge></div>
                    <div className="overflow-x-auto rounded-xl border">
                      <table className="w-full min-w-[520px] text-sm">
                        <thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-3 py-3 text-left">Product</th><th className="px-3 py-3 text-right">Ordered Qty</th><th className="px-3 py-3 text-right">Packed Qty</th><th className="px-3 py-3 text-left">Unit</th><th className="px-3 py-3 text-left">Status</th></tr></thead>
                        <tbody className="divide-y">
                          {selectedItems.map((item: any, index: number) => {
                            const required = Number(item.quantityRequired ?? item.quantity ?? 0);
                            const packed = Number(item.packedQuantity ?? item.actualPackedQuantity ?? 0);
                            const short = Math.max(0, required - packed);
                            return <tr key={item.itemKey || item.id || index}>
                              <td className="px-3 py-3 font-semibold text-slate-800">{item.productName || item.name || "Product"}</td>
                              <td className="px-3 py-3 text-right tabular-nums">{required}</td>
                              <td className="px-3 py-3 text-right font-semibold tabular-nums">{packed}</td>
                              <td className="px-3 py-3 text-slate-600">{item.unit || "kg"}</td>
                              <td className="px-3 py-3">{short > 0 ? <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">Short {short}</Badge> : <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700"><CheckCircle2 className="mr-1 h-3 w-3"/>Packed</Badge>}</td>
                            </tr>;
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <aside className="space-y-3">
                    <div className="rounded-xl border p-3">
                      <h3 className="mb-2 text-sm font-bold text-slate-900">Packing Label</h3>
                      <div className="rounded-lg bg-slate-50 p-3 text-center"><Printer className="mx-auto h-7 w-7 text-slate-500"/><p className="mt-1 truncate text-xs font-semibold">{selectedTask.orderNumber || selectedTask.orderId || selectedTask.id}</p><p className="text-[11px] text-slate-500">{selectedItems.length} product(s) · {totalRequired} {selectedItems[0]?.unit || "kg"}</p></div>
                      <Button type="button" variant="outline" className="mt-2 w-full" onClick={() => printLabel(selectedTask)}><Printer className="mr-2 h-4 w-4"/>Print / Reprint Label</Button>
                    </div>
                    <div className="rounded-xl border p-3">
                      <h3 className="text-sm font-bold text-slate-900">Packing Team</h3>
                      <p className="mt-1 text-xs text-slate-500">{selectedTask.packingTeam?.name || selectedTask.packingTeamName || selectedTask.packingTeamId || "Team not assigned"}</p>
                      {String(selectedTask.status || "").toLowerCase() === "ready_for_packing" && <p className="mt-2 text-xs text-slate-500">Assign a team from the farm section below the order queue if required.</p>}
                    </div>
                  </aside>
                </div>

                <div className="grid gap-2 border-t pt-4 sm:grid-cols-3">
                  <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Total ordered</p><p className="text-lg font-bold">{totalRequired} {selectedItems[0]?.unit || "kg"}</p></div>
                  <div className="rounded-lg bg-emerald-50 p-3"><p className="text-xs text-emerald-700">Total packed</p><p className="text-lg font-bold text-emerald-800">{totalPacked} {selectedItems[0]?.unit || "kg"}</p></div>
                  <div className={`rounded-lg p-3 ${totalShortage > 0 ? "bg-red-50" : "bg-slate-50"}`}><p className={`text-xs ${totalShortage > 0 ? "text-red-700" : "text-slate-500"}`}>Shortage</p><p className={`text-lg font-bold ${totalShortage > 0 ? "text-red-800" : "text-slate-800"}`}>{totalShortage} {selectedItems[0]?.unit || "kg"}</p></div>
                </div>

                <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                  {["ready_for_packing","assigned","packing","partially_packed"].includes(String(selectedTask.status || "").toLowerCase()) && <Button type="button" className="bg-emerald-700 hover:bg-emerald-800" onClick={() => finishPackingTask(selectedTask)}><CheckCircle2 className="mr-2 h-4 w-4"/>Packing Finish Order</Button>}
                  {["packed","ready_for_dispatch"].includes(String(selectedTask.status || "").toLowerCase()) && <Button type="button" variant="outline" onClick={() => printLabel(selectedTask)}><Printer className="mr-2 h-4 w-4"/>Reprint Label</Button>}
                  {selectedTask.status === "customer_approval_pending" && <div className="w-full rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Waiting for customer decision. Dispatch remains blocked until the customer responds.</div>}
                  {["packed","ready_for_dispatch"].includes(String(selectedTask.status || "").toLowerCase()) && <Button type="button" variant="outline" onClick={() => window.location.assign("/outgoing")}><Truck className="mr-2 h-4 w-4"/>Open Outgoing / Dispatch</Button>}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="flex min-h-[420px] items-center justify-center border-dashed"><CardContent className="text-center"><ClipboardCheck className="mx-auto h-12 w-12 text-slate-300"/><h3 className="mt-3 font-semibold text-slate-800">Select an order to pack</h3><p className="mt-1 text-sm text-slate-500">Choose an order from the queue to review its products and packing label.</p></CardContent></Card>
          ))}
        </div>
      )}
    </div>
    </>
  );
}
