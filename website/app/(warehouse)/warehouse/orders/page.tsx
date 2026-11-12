"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock3, Package, PackageCheck, RefreshCw, Search, Truck, MapPin, User, ArrowUpRight, Phone, Mail, CircleDot } from "lucide-react";
import { Card, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Input } from "../../../components/ui/input";
import { WarehousePageHeader } from "../../../components/warehouse/warehouse-page-header";
import { PrefetchLink as Link } from "../../../components/shared/prefetch-link";
import { cn } from "../../../lib/utils";
import { api } from "../../../lib/api/client";

type OrderTab = "all" | "awaiting" | "packing" | "ready" | "transit" | "delivered";

const normalizeStage = (value: any) => String(value || "").trim().toLowerCase().replace(/[\\s-]+/g, "_");

const getStage = (order: any) => {
  const orderStatus = normalizeStage(order?.orderStatus);
  const deliveryStatus = normalizeStage(order?.deliveryStatus);
  const warehouseStage = normalizeStage(order?.warehouseFulfillmentStage);
  const generalStatus = normalizeStage(order?.status || order?.fulfillmentStatus);

  // Terminal order states must win over an old/stale warehouse stage.
  if (["cancelled", "canceled", "refunded"].includes(orderStatus)) return orderStatus;
  if (["delivered", "completed"].includes(orderStatus) || ["delivered", "completed"].includes(deliveryStatus)) {
    return orderStatus === "completed" ? "completed" : "delivered";
  }
  // The warehouse fulfillment stage is the most specific live stage while an
  // order is still active. Fall back to delivery/order status when it is absent.
  return warehouseStage || deliveryStatus || orderStatus || generalStatus || "confirmed";
};

const stageMeta = (rawStage: string) => {
  const stage = normalizeStage(rawStage);
  if (["delivered", "completed"].includes(stage)) return { label: stage === "completed" ? "Completed" : "Delivered", tone: "bg-emerald-50 text-emerald-700 border-emerald-200", group: "delivered" };
  if (["cancelled", "canceled", "refunded"].includes(stage)) return { label: stage === "refunded" ? "Refunded" : "Cancelled", tone: "bg-rose-50 text-rose-700 border-rose-200", group: "awaiting" };
  if (["dispatched", "shipped", "in_transit", "out_for_delivery", "delivery_assigned", "picked_up", "picked-up"].includes(stage)) return { label: stage === "in_transit" ? "In transit" : stage.replace(/_/g, " "), tone: "bg-blue-50 text-blue-700 border-blue-200", group: "transit" };
  if (["ready_for_dispatch", "delivery_decision", "awaiting_dispatch"].includes(stage)) return { label: stage === "delivery_decision" ? "Delivery planning" : "Ready for dispatch", tone: "bg-violet-50 text-violet-700 border-violet-200", group: "ready" };
  if (["preparing", "quality_check", "packing", "packing_team_assigned", "packed", "shortage_pending", "ready_for_packing", "received"].includes(stage)) return { label: stage === "shortage_pending" ? "Shortage resolution" : stage === "ready_for_packing" ? "Ready for packing" : stage.replace(/_/g, " "), tone: "bg-amber-50 text-amber-800 border-amber-200", group: "packing" };
  const label = stage ? stage.replace(/_/g, " ") : "Confirmed";
  return { label: label.charAt(0).toUpperCase() + label.slice(1), tone: "bg-slate-100 text-slate-700 border-slate-200", group: "awaiting" };
};

const STANDARD_JOURNEY = [
  { id: "confirmed", label: "Order confirmed", aliases: ["pending", "confirmed", "accepted", "processing"] },
  { id: "preparing", label: "Preparing", aliases: ["preparing", "incoming", "ready_for_packing", "packing_team_assigned", "packing", "partially_packed"] },
  { id: "quality_check", label: "Quality inspection", aliases: ["quality_check", "quality_checked", "quality_passed", "quality_approved", "received"] },
  { id: "packed", label: "Packed / ready", aliases: ["packed", "packing_complete", "verified", "ready_for_dispatch", "delivery_decision", "ready_for_delivery"] },
  { id: "dispatched", label: "Dispatched", aliases: ["dispatched", "shipped", "picked_up", "in_transit", "out_for_delivery", "delivery_assigned"] },
  { id: "delivered", label: "Delivered", aliases: ["delivered", "completed"] },
];

const TRANSFER_JOURNEY = [
  { id: "confirmed", label: "Order confirmed", aliases: ["pending", "confirmed", "accepted", "processing"] },
  { id: "preparing", label: "Farm preparation", aliases: ["preparing", "ready_for_packing", "packing", "packed", "packing_complete"] },
  { id: "farm_pickup", label: "Farm pickup", aliases: ["ready_for_pickup", "pickup_assigned", "pickup_started", "collected", "collected_from_farm", "picked_up_from_farm"] },
  { id: "source_received", label: "Source warehouse received", aliases: ["received_transfer", "warehouse_received", "arrived_warehouse", "source_warehouse_received", "stored_transfer", "warehouse_received_stored"] },
  { id: "source_quality", label: "Quality inspection", aliases: ["warehouse_quality_check", "quality_inspection", "quality_passed_at_warehouse"] },
  { id: "transfer_ready", label: "Transfer prepared", aliases: ["transfer_pending", "transfer_ready", "ready_for_transfer"] },
  { id: "transfer_dispatched", label: "Transfer dispatched", aliases: ["transfer_dispatched", "dispatched_to_destination"] },
  { id: "transfer_transit", label: "Transfer in transit", aliases: ["in_transit", "transfer_in_transit"] },
  { id: "destination_received", label: "Destination warehouse received", aliases: ["received", "completed", "received_at_destination", "destination_warehouse_received", "received_at_consolidation"] },
  { id: "final_assigned", label: "Final delivery assigned", aliases: ["final_delivery_assigned", "delivery_assigned", "partner_assigned"] },
  { id: "out_for_delivery", label: "Out for delivery", aliases: ["out_for_delivery", "final_delivery_in_transit", "delivery_in_transit"] },
  { id: "delivered", label: "Delivered", aliases: ["delivered", "completed_delivery"] },
];

const hasWarehouseTransfer = (order: any) => {
  const mode = normalizeStage(order?.logisticsMode || order?.warehouseTransfer?.mode || order?.transfer?.mode);
  const legs = Array.isArray(order?.transferLegs) ? order.transferLegs : [];
  return legs.length > 0 || Boolean(order?.warehouseTransferId || order?.warehouseTransfer?.id) ||
    ["warehouse_to_warehouse", "inter_warehouse", "warehouse_transfer", "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner"].includes(mode);
};

const getJourneySteps = (order: any) => hasWarehouseTransfer(order) ? TRANSFER_JOURNEY : STANDARD_JOURNEY;

const getJourneyIndex = (order: any, rawStage: string) => {
  const stage = normalizeStage(rawStage);
  if (["cancelled", "canceled", "refunded"].includes(stage)) return -1;
  const steps = getJourneySteps(order);
  const transferStatus = normalizeStage(order?.transferStatus || order?.warehouseTransfer?.status || order?.transfer?.status);
  const deliveryStatus = normalizeStage(order?.deliveryStatus);
  if (deliveryStatus === "delivered" || ["delivered", "completed"].includes(normalizeStage(order?.orderStatus))) return steps.length - 1;

  if (steps === TRANSFER_JOURNEY) {
    if (["received", "completed", "received_at_destination", "destination_warehouse_received", "received_at_consolidation"].includes(transferStatus)) return 8;
    if (["in_transit", "transfer_in_transit"].includes(transferStatus)) return 7;
    if (["dispatched", "transfer_dispatched", "dispatched_to_destination"].includes(transferStatus)) return 6;
    if (["pending", "transfer_pending", "transfer_ready", "ready_for_transfer"].includes(transferStatus)) return 5;
  }

  const found = steps.findIndex((step) => step.aliases.includes(stage));
  if (found >= 0) return found;

  // The warehouse fulfillment stage is authoritative for the standard route.
  if (steps === STANDARD_JOURNEY) {
    if (["ready_for_dispatch", "delivery_decision", "verified"].includes(stage)) return 3;
    if (["dispatched", "in_transit", "out_for_delivery", "delivery_assigned"].includes(stage)) return 4;
    if (["delivered", "completed"].includes(stage)) return 5;
  }
  return 0;
};

const getStepCompletion = (order: any, index: number, currentIndex: number) => {
  if (index < currentIndex) return "complete";
  if (index === currentIndex) return "current";
  return "pending";
};

const displayDate = (value: any) => {
  if (!value) return "Not provided";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not provided" : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const money = (value: any) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }) : "—";
};

export default function WarehouseOrdersPage() {
  const [tab, setTab] = useState<OrderTab>("all");
  const [search, setSearch] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["warehouseCustomerOrders"],
    queryFn: () => api.get("/warehouse/me/customer-orders"),
    refetchInterval: 30000,
  });

  const allOrders = useMemo(() => {
    const payload = data?.data ?? data ?? {};
    return Array.isArray(payload) ? payload : Array.isArray(payload.orders) ? payload.orders : Array.isArray(payload.items) ? payload.items : [];
  }, [data]);

  const counts = useMemo(() => {
    const result: Record<string, number> = { all: allOrders.length, awaiting: 0, packing: 0, ready: 0, transit: 0, delivered: 0 };
    allOrders.forEach((order: any) => {
      const group = stageMeta(getStage(order)).group;
      result[group] = (result[group] || 0) + 1;
    });
    return result;
  }, [allOrders]);

  const orders = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allOrders.filter((order: any) => {
      const customer = order.customer || {};
      const matchesSearch = !term || [order.orderNumber, order.id, order.trackingNumber, order.trackingId, customer.name, customer.phone, customer.email, order.deliveryAddress?.addressLine1, order.deliveryAddress?.street, order.deliveryAddress?.city, order.deliveryAddress?.state, order.deliveryAddress?.zipCode, ...(Array.isArray(order.items) ? order.items.flatMap((item: any) => [item.productName, item.name, item.productId]) : [])]
        .filter(Boolean).some((value: any) => String(value).toLowerCase().includes(term));
      const group = stageMeta(getStage(order)).group;
      return matchesSearch && (tab === "all" || group === tab);
    });
  }, [allOrders, search, tab]);

  const tabs: { id: OrderTab; label: string; icon: any }[] = [
    { id: "all", label: "All orders", icon: Package },
    { id: "awaiting", label: "Awaiting processing", icon: Clock3 },
    { id: "packing", label: "Packing", icon: PackageCheck },
    { id: "ready", label: "Ready for dispatch", icon: CheckCircle2 },
    { id: "transit", label: "In transit", icon: Truck },
    { id: "delivered", label: "Delivered", icon: CheckCircle2 },
  ];

  return (
    <div className="warehouse-customer-orders-page space-y-6">
      <WarehousePageHeader eyebrow="Warehouse order management" title="Customer Enquiries & Order Lookup" description="Find a customer order using any details they can provide, then review its latest progress and answer their delivery questions." meta={<span>{counts.all} searchable warehouse orders · including completed orders</span>} actions={<Button variant="outline" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")} />Refresh</Button>} />

      {isError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><span>Customer orders could not be loaded. Please retry.</span><Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button></div>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Order summary">
        {[
          { label: "Total assigned", value: counts.all, icon: Package, note: "Orders assigned to this warehouse" },
          { label: "Awaiting processing", value: counts.awaiting, icon: Clock3, note: "Not yet in active packing" },
          { label: "Packing / preparation", value: counts.packing, icon: PackageCheck, note: "Currently being prepared" },
          { label: "Ready for dispatch", value: counts.ready, icon: CheckCircle2, note: "Waiting for dispatch handover" },
        ].map((item) => <Card key={item.label} className="border-slate-200 shadow-sm"><CardContent className="flex items-start justify-between gap-3 p-4"><div><p className="text-sm text-muted-foreground">{item.label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{isLoading ? "—" : item.value}</p><p className="mt-1 text-xs text-muted-foreground">{item.note}</p></div><div className="rounded-xl bg-slate-100 p-2.5"><item.icon className="h-5 w-5 text-slate-600" /></div></CardContent></Card>)}
      </section>

      <Card className="border-slate-200 shadow-sm"><CardContent className="space-y-4 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><h2 className="font-semibold">Find a customer order</h2><p className="text-sm text-muted-foreground">Order number is optional. Search by customer name, phone, email, product, address or tracking reference.</p></div><div className="relative w-full md:max-w-sm"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Enter name, phone, email, product, address or tracking number" className="pl-9" /></div></div>
        <div className="flex gap-2 overflow-x-auto pb-1">{tabs.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={cn("inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors", tab === item.id ? "border-emerald-700 bg-emerald-700 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}><item.icon className="h-4 w-4" />{item.label}<span className={cn("rounded-full px-1.5 py-0.5 text-xs", tab === item.id ? "bg-white/15" : "bg-slate-100")}>{counts[item.id]}</span></button>)}</div>
      </CardContent></Card>

      {isLoading ? <div className="space-y-3">{[1,2,3].map((n) => <div key={n} className="h-28 animate-pulse rounded-xl bg-muted" />)}</div> : orders.length === 0 ? (
        <Card className="border-dashed"><CardContent className="flex flex-col items-center px-6 py-14 text-center"><Package className="h-10 w-10 text-slate-300" /><h3 className="mt-3 font-semibold">No matching customer orders</h3><p className="mt-1 max-w-md text-sm text-muted-foreground">{search ? "Try another search term or clear your search." : "Try searching with the customer’s phone number, name, product or delivery address. Order number is not required."}</p><Button variant="outline" className="mt-4" onClick={() => { setSearch(""); setTab("all"); }}>Clear search</Button></CardContent></Card>
      ) : (
        <div className="space-y-3">{orders.map((order: any) => {
          const stage = getStage(order);
          const meta = stageMeta(stage);
          const customer = order.customer || {};
          const items = Array.isArray(order.items) ? order.items : [];
          const quantity = items.reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0);
          const address = order.deliveryAddress || {};
          const deadline = order.deliveryDate || order.expectedDeliveryDate || order.deliveryDeadline;
          const overdue = deadline && !["delivered", "completed"].includes(stage) && new Date(deadline).getTime() < Date.now();
          return <Card key={order.id || order._id || order.orderNumber} className="border-slate-200 shadow-sm transition-shadow hover:shadow-md"><CardContent className="p-4 md:p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-900">#{order.orderNumber || order.id || "Order"}</h3><Badge variant="outline" className={meta.tone}>{meta.label}</Badge>{overdue && <Badge variant="destructive"><AlertTriangle className="mr-1 h-3 w-3" />Overdue</Badge>}<Badge variant="outline">{String(order.fulfillmentMethod || order.fulfillmentType || "Warehouse fulfillment").replace(/_/g, " ")}</Badge></div>
                {!["cancelled", "canceled", "refunded"].includes(stage) && <div className="max-w-full overflow-x-auto pb-1"><div className="flex min-w-[760px] items-center justify-between gap-1">{getJourneySteps(order).map((step, index, journeySteps) => { const currentIndex = getJourneyIndex(order, stage); const stepState = getStepCompletion(order, index, currentIndex); const reached = stepState === "complete" || stepState === "current"; const current = stepState === "current"; return <div key={step.id} className="flex min-w-0 flex-1 items-center"><div className="flex min-w-0 flex-col items-center text-center"><span className={cn("flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold", reached ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white text-slate-400", current && "ring-2 ring-emerald-100")}>{reached ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}</span><span className={cn("mt-1 max-w-[76px] truncate text-[10px] leading-tight", current ? "font-semibold text-emerald-700" : reached ? "text-slate-600" : "text-slate-400")}>{step.label}</span></div>{index < journeySteps.length - 1 && <span className={cn("mx-1 mb-4 h-0.5 min-w-2 flex-1", index < currentIndex ? "bg-emerald-500" : "bg-slate-200")} />}</div>; })}</div></div>}<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="flex items-start gap-2"><User className="mt-0.5 h-4 w-4 text-slate-400" /><div><p className="text-xs text-muted-foreground">Customer</p><p className="text-sm font-medium">{customer.name || "Customer"}</p><p className="text-xs text-muted-foreground">{customer.phone || customer.email || "Contact not provided"}</p></div></div>
                  <div className="flex items-start gap-2"><Package className="mt-0.5 h-4 w-4 text-slate-400" /><div><p className="text-xs text-muted-foreground">Order items</p><p className="text-sm font-medium">{items.length} products · {quantity || "—"} total units</p><p className="line-clamp-1 text-xs text-muted-foreground">{items.slice(0, 2).map((item: any) => item.productName || item.name || "Product").join(", ") || "Items not provided"}{items.length > 2 ? " and more" : ""}</p></div></div>
                  <div className="flex items-start gap-2"><CalendarClock className="mt-0.5 h-4 w-4 text-slate-400" /><div><p className="text-xs text-muted-foreground">Delivery deadline</p><p className={cn("text-sm font-medium", overdue && "text-rose-700")}>{displayDate(deadline)}</p><p className="text-xs text-muted-foreground">Placed {displayDate(order.createdAt || order.orderDate)}</p></div></div>
                  <div className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 text-slate-400" /><div><p className="text-xs text-muted-foreground">Delivery location</p><p className="text-sm font-medium">{[address.city, address.state].filter(Boolean).join(", ") || "Address not provided"}</p><p className="line-clamp-1 text-xs text-muted-foreground">{address.addressLine1 || address.street || ""}</p></div></div>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-100 pt-3 xl:w-48 xl:flex-col xl:items-stretch xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0">
                <div className="xl:mb-1"><p className="text-xs text-muted-foreground">Order value</p><p className="text-lg font-semibold">{money(order.totalAmount ?? order.total ?? order.grandTotal)}</p></div>
                <Button variant="outline" size="sm" onClick={() => setSelectedOrder(order)}>View order details</Button>
                {["preparing", "quality_check", "packing", "packing_team_assigned", "packed", "shortage_pending", "ready_for_packing"].includes(stage) && <Button size="sm" asChild><Link href="/packing">Open packing <ArrowUpRight className="ml-2 h-4 w-4" /></Link></Button>}
                {["ready_for_dispatch", "delivery_decision", "dispatched"].includes(stage) && <Button size="sm" variant="outline" asChild><Link href="/outgoing">Open dispatch <ArrowUpRight className="ml-2 h-4 w-4" /></Link></Button>}
              </div>
            </div>
          </CardContent></Card>;
        })}</div>
      )}

      {selectedOrder && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onClick={() => setSelectedOrder(null)}><section role="dialog" aria-modal="true" aria-labelledby="customer-order-detail-title" className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Customer order details</p><h2 id="customer-order-detail-title" className="mt-1 text-xl font-semibold">#{selectedOrder.orderNumber || selectedOrder.id || "Order"}</h2><p className="mt-1 text-sm text-muted-foreground">{selectedOrder.customer?.name || "Customer"} · {displayDate(selectedOrder.createdAt || selectedOrder.orderDate)}</p></div><Button variant="outline" size="sm" onClick={() => setSelectedOrder(null)}>Close</Button></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-muted-foreground">Current order status</p><p className="mt-1 font-medium capitalize">{stageMeta(getStage(selectedOrder)).label}</p><p className="mt-1 text-xs text-muted-foreground">Order status: {String(selectedOrder.orderStatus || selectedOrder.warehouseFulfillmentStage || selectedOrder.deliveryStatus || selectedOrder.status || "Not provided").replace(/_/g, " ")}</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-muted-foreground">Estimated delivery</p><p className="mt-1 font-medium">{displayDate(selectedOrder.estimatedDelivery || selectedOrder.deliveryDate || selectedOrder.expectedDeliveryDate || selectedOrder.deliveryDeadline)}</p></div></div>
        <h3 className="mt-5 font-semibold">Customer contact</h3><div className="mt-2 grid gap-2 sm:grid-cols-2 text-sm"><p className="flex items-center gap-2"><Phone className="h-4 w-4 text-slate-400"/>{selectedOrder.customer?.phone || "Phone not available"}</p><p className="flex items-center gap-2"><Mail className="h-4 w-4 text-slate-400"/>{selectedOrder.customer?.email || "Email not available"}</p></div>
        <h3 className="mt-5 font-semibold">Delivery and tracking</h3><div className="mt-2 grid gap-3 sm:grid-cols-2"><div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Delivery partner</p><p className="mt-1 text-sm font-medium">{selectedOrder.deliveryPartner?.name || selectedOrder.deliveryPartner?.fullName || selectedOrder.deliveryPartner?.phone || "Not assigned / not available"}</p></div><div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Tracking reference</p><p className="mt-1 break-all text-sm font-medium">{selectedOrder.trackingNumber || selectedOrder.trackingId || "Not available"}</p></div><div className="rounded-lg border p-3 sm:col-span-2"><p className="text-xs text-muted-foreground">Dispatch / delivery dates</p><p className="mt-1 text-sm">Dispatched: {displayDate(selectedOrder.dispatchedAt)} · Delivered: {displayDate(selectedOrder.deliveredAt)}</p></div></div>
        {Array.isArray(selectedOrder.statusHistory) && selectedOrder.statusHistory.length > 0 && <><h3 className="mt-5 font-semibold">Order status history</h3><div className="mt-2 space-y-3 border-l-2 border-slate-200 pl-4">{selectedOrder.statusHistory.map((entry: any, index: number) => <div key={entry.id || entry._id || index} className="relative"><CircleDot className="absolute -left-[23px] top-0.5 h-3.5 w-3.5 bg-white text-emerald-600"/><p className="text-sm font-medium">{String(entry.status || entry.stage || entry.title || "Update").replace(/_/g, " ")}</p><p className="text-xs text-muted-foreground">{displayDate(entry.timestamp || entry.createdAt || entry.updatedAt)}{entry.note || entry.description ? " · " + (entry.note || entry.description) : ""}</p></div>)}</div></>}<h3 className="mt-5 font-semibold">Products ordered</h3><div className="mt-2 divide-y rounded-lg border">{(selectedOrder.items || []).map((item: any, index: number) => <div key={item.id || item.productId || index} className="flex items-center justify-between gap-3 p-3 text-sm"><div><p className="font-medium">{item.productName || item.name || "Product"}</p><p className="text-xs text-muted-foreground">{item.qualityGrade || item.grade || "Standard quality"}</p></div><p className="shrink-0 font-medium">{item.quantity} {item.unit || "kg"} × {money(item.unitPrice)}</p></div>)}</div><div className="mt-4 flex justify-between border-t pt-3"><span className="text-sm text-muted-foreground">Order total</span><span className="font-semibold">{money(selectedOrder.totalAmount ?? selectedOrder.total ?? selectedOrder.grandTotal)}</span></div><h3 className="mt-5 font-semibold">Delivery address</h3><p className="mt-1 text-sm text-muted-foreground">{[selectedOrder.deliveryAddress?.addressLine1, selectedOrder.deliveryAddress?.city, selectedOrder.deliveryAddress?.state, selectedOrder.deliveryAddress?.zipCode].filter(Boolean).join(", ") || "Address not provided"}</p></section></div>}
    </div>
  );
}
