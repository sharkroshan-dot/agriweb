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

const getStage = (order: any) => String(order?.warehouseFulfillmentStage || order?.status || order?.fulfillmentStatus || "confirmed").toLowerCase();

const stageMeta = (stage: string) => {
  if (["delivered", "completed"].includes(stage)) return { label: stage === "completed" ? "Completed" : "Delivered", tone: "bg-emerald-50 text-emerald-700 border-emerald-200", group: "delivered" };
  if (["dispatched", "in_transit", "out_for_delivery", "delivery_assigned"].includes(stage)) return { label: stage.replace(/_/g, " "), tone: "bg-blue-50 text-blue-700 border-blue-200", group: "transit" };
  if (["ready_for_dispatch", "delivery_decision"].includes(stage)) return { label: stage === "delivery_decision" ? "Delivery planning" : "Ready for dispatch", tone: "bg-violet-50 text-violet-700 border-violet-200", group: "ready" };
  if (["preparing", "quality_check", "packing", "packing_team_assigned", "packed", "shortage_pending"].includes(stage)) return { label: stage === "shortage_pending" ? "Shortage resolution" : stage.replace(/_/g, " "), tone: "bg-amber-50 text-amber-800 border-amber-200", group: "packing" };
  return { label: stage.replace(/_/g, " "), tone: "bg-slate-100 text-slate-700 border-slate-200", group: "awaiting" };
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
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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

      {selectedOrder && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onClick={() => setSelectedOrder(null)}><section role="dialog" aria-modal="true" aria-labelledby="customer-order-detail-title" className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Customer order details</p><h2 id="customer-order-detail-title" className="mt-1 text-xl font-semibold">#{selectedOrder.orderNumber || selectedOrder.id || "Order"}</h2><p className="mt-1 text-sm text-muted-foreground">{selectedOrder.customer?.name || "Customer"} · {displayDate(selectedOrder.createdAt || selectedOrder.orderDate)}</p></div><Button variant="outline" size="sm" onClick={() => setSelectedOrder(null)}>Close</Button></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-muted-foreground">Current order status</p><p className="mt-1 font-medium capitalize">{stageMeta(getStage(selectedOrder)).label}</p><p className="mt-1 text-xs text-muted-foreground">Order status: {String(selectedOrder.orderStatus || selectedOrder.status || "Not provided").replace(/_/g, " ")}</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-muted-foreground">Estimated delivery</p><p className="mt-1 font-medium">{displayDate(selectedOrder.estimatedDelivery || selectedOrder.deliveryDate || selectedOrder.expectedDeliveryDate || selectedOrder.deliveryDeadline)}</p></div></div>
        <h3 className="mt-5 font-semibold">Customer contact</h3><div className="mt-2 grid gap-2 sm:grid-cols-2 text-sm"><p className="flex items-center gap-2"><Phone className="h-4 w-4 text-slate-400"/>{selectedOrder.customer?.phone || "Phone not available"}</p><p className="flex items-center gap-2"><Mail className="h-4 w-4 text-slate-400"/>{selectedOrder.customer?.email || "Email not available"}</p></div>
        <h3 className="mt-5 font-semibold">Delivery and tracking</h3><div className="mt-2 grid gap-3 sm:grid-cols-2"><div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Delivery partner</p><p className="mt-1 text-sm font-medium">{selectedOrder.deliveryPartner?.name || selectedOrder.deliveryPartner?.fullName || selectedOrder.deliveryPartner?.phone || "Not assigned / not available"}</p></div><div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Tracking reference</p><p className="mt-1 break-all text-sm font-medium">{selectedOrder.trackingNumber || selectedOrder.trackingId || "Not available"}</p></div><div className="rounded-lg border p-3 sm:col-span-2"><p className="text-xs text-muted-foreground">Dispatch / delivery dates</p><p className="mt-1 text-sm">Dispatched: {displayDate(selectedOrder.dispatchedAt)} · Delivered: {displayDate(selectedOrder.deliveredAt)}</p></div></div>
        {Array.isArray(selectedOrder.statusHistory) && selectedOrder.statusHistory.length > 0 && <><h3 className="mt-5 font-semibold">Order status history</h3><div className="mt-2 space-y-3 border-l-2 border-slate-200 pl-4">{selectedOrder.statusHistory.map((entry: any, index: number) => <div key={entry.id || entry._id || index} className="relative"><CircleDot className="absolute -left-[23px] top-0.5 h-3.5 w-3.5 bg-white text-emerald-600"/><p className="text-sm font-medium">{String(entry.status || entry.stage || entry.title || "Update").replace(/_/g, " ")}</p><p className="text-xs text-muted-foreground">{displayDate(entry.timestamp || entry.createdAt || entry.updatedAt)}{entry.note || entry.description ? " · " + (entry.note || entry.description) : ""}</p></div>)}</div></>}<h3 className="mt-5 font-semibold">Products ordered</h3><div className="mt-2 divide-y rounded-lg border">{(selectedOrder.items || []).map((item: any, index: number) => <div key={item.id || item.productId || index} className="flex items-center justify-between gap-3 p-3 text-sm"><div><p className="font-medium">{item.productName || item.name || "Product"}</p><p className="text-xs text-muted-foreground">{item.qualityGrade || item.grade || "Standard quality"}</p></div><p className="shrink-0 font-medium">{item.quantity} {item.unit || "kg"} × {money(item.unitPrice)}</p></div>)}</div><div className="mt-4 flex justify-between border-t pt-3"><span className="text-sm text-muted-foreground">Order total</span><span className="font-semibold">{money(selectedOrder.totalAmount ?? selectedOrder.total ?? selectedOrder.grandTotal)}</span></div><h3 className="mt-5 font-semibold">Delivery address</h3><p className="mt-1 text-sm text-muted-foreground">{[selectedOrder.deliveryAddress?.addressLine1, selectedOrder.deliveryAddress?.city, selectedOrder.deliveryAddress?.state, selectedOrder.deliveryAddress?.zipCode].filter(Boolean).join(", ") || "Address not provided"}</p></section></div>}
    </div>
  );
}
