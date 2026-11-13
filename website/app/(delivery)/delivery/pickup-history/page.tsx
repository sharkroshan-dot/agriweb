"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { CalendarDays, CheckCircle2, ChevronDown, MapPin, PackageCheck, RefreshCw, Truck, Warehouse } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { api } from "../../../lib/api/client";

const receivedStatuses = new Set(["received", "warehouse_received", "received_at_warehouse", "arrived_warehouse", "returned_to_warehouse", "stored"]);
const normalizeStatus = (value: any) => String(value || "").trim().toLowerCase().replace(/[ -]+/g, "_");
const isReceived = (item: any) => receivedStatuses.has(normalizeStatus(item?.status || item?.orderStatus || item?.collectionStatus));
const formatDate = (value: any) => {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
};
const handoverDate = (route: any) => route.warehouseArrivalAt || route.arrivedWarehouseAt || route.warehouseArrivedAt || route.returnedAt || route.completedAt || route.updatedAt || route.routeDate || route.createdAt;

type PickupRecord = { key: string; route: any; stop: any; order: any; orderNumber: string; products: any[] };

const pickupRecords = (routes: any[]): PickupRecord[] => {
  const result: PickupRecord[] = [];
  const seen = new Set<string>();
  for (const route of routes.filter(isReceived)) {
    const stops = Array.isArray(route.stops) ? route.stops : [];
    for (const [stopIndex, stop] of stops.entries()) {
      const sourceOrders = Array.isArray(stop.orders) && stop.orders.length ? stop.orders : [stop];
      const groups = new Map<string, any[]>();
      for (const [orderIndex, order] of sourceOrders.entries()) {
        const number = String(order.orderNumber || order.orderNo || order.b2bOrderNumber || order.orderId || order.b2bOrderId || "").trim();
        const groupKey = number ? "order:" + number.toLowerCase() : "collection:" + String(order.collectionId || order.id || orderIndex);
        groups.set(groupKey, [...(groups.get(groupKey) || []), order]);
      }
      for (const [groupKey, products] of groups.entries()) {
        const first = products[0];
        const routeKey = String(route.id || route._id || route.routeNumber || "");
        const key = routeKey + ":" + stopIndex + ":" + groupKey;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ key, route, stop, order: first, products, orderNumber: String(first.orderNumber || first.orderNo || first.b2bOrderNumber || first.orderId || first.b2bOrderId || first.collectionId || "Pickup order") });
      }
    }
  }
  return result.sort((a, b) => new Date(handoverDate(b.route) || 0).getTime() - new Date(handoverDate(a.route) || 0).getTime());
};

export default function PickupHistoryPage() {
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken as string | undefined;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["myPickupHistory"],
    queryFn: () => api.get("/delivery/me/pickup-routes"),
    enabled: Boolean(accessToken),
    refetchInterval: 15000,
  });
  const routes: any[] = data?.data?.routes || [];
  const completedRoutes = routes.filter(isReceived);
  const records = pickupRecords(routes);
  const totalQuantity = records.reduce((sum, record) => sum + record.products.reduce((quantity, item) => quantity + Number(item.actualQuantity ?? item.quantity ?? 0), 0), 0);

  return (
    <div className="space-y-5 pb-8">
      <header className="rounded-2xl border border-emerald-100 bg-gradient-to-r from-white via-emerald-50/60 to-sky-50 px-5 py-6 shadow-sm sm:px-7">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700"><PackageCheck className="h-7 w-7" /></div>
          <div><p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Warehouse Pickup</p><h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl">Pickup History</h1><p className="mt-1 text-sm leading-6 text-slate-600">Completed farm pickup orders, organized individually after warehouse handover.</p></div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Pickup history summary">
        <Card className="rounded-2xl border-emerald-200 bg-emerald-50/60 shadow-sm"><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm font-medium text-slate-600">Completed Pickup Orders</p><p className="mt-1 text-3xl font-bold text-slate-950">{isLoading ? "—" : records.length}</p></div><PackageCheck className="h-7 w-7 text-emerald-700" /></CardContent></Card>
        <Card className="rounded-2xl border-blue-200 bg-blue-50/60 shadow-sm"><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm font-medium text-slate-600">Completed Pickup Routes</p><p className="mt-1 text-3xl font-bold text-slate-950">{isLoading ? "—" : completedRoutes.length}</p></div><Truck className="h-7 w-7 text-blue-700" /></CardContent></Card>
        <Card className="rounded-2xl border-violet-200 bg-violet-50/60 shadow-sm"><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm font-medium text-slate-600">Recorded Pickup Quantity</p><p className="mt-1 text-3xl font-bold text-slate-950">{isLoading ? "—" : totalQuantity.toLocaleString("en-IN") + " kg"}</p></div><Warehouse className="h-7 w-7 text-violet-700" /></CardContent></Card>
      </section>

      <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-white">
          <div><CardTitle className="text-lg text-slate-950">Completed Farm Pickup Orders</CardTitle><p className="mt-1 text-sm text-slate-500">Each pickup order has its own record. Warehouse transfers and customer or B2B deliveries are not included.</p></div>
          <Button type="button" variant="outline" onClick={() => void refetch()} disabled={isFetching}><RefreshCw className={"mr-2 h-4 w-4 " + (isFetching ? "animate-spin" : "")} />Refresh</Button>
        </CardHeader>
        <CardContent className="space-y-3 p-4 sm:p-5">
          {isLoading ? <div className="space-y-3">{[1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-xl bg-slate-100" />)}</div>
            : isError ? <div className="py-12 text-center text-sm text-slate-600">Could not load pickup history. Please refresh and try again.</div>
            : records.length === 0 ? <div className="py-12 text-center"><PackageCheck className="mx-auto h-10 w-10 text-slate-400" /><p className="mt-3 font-semibold text-slate-900">No completed pickup orders yet</p><p className="mt-1 text-sm text-slate-500">Orders appear here after the pickup route reaches the warehouse.</p></div>
            : records.map((record) => {
              const { route, stop, order, products } = record;
              const open = Boolean(expanded[record.key]);
              const quantity = products.reduce((sum, product) => sum + Number(product.actualQuantity ?? product.quantity ?? 0), 0);
              return (
                <article key={record.key} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
                  <div className="flex flex-wrap items-start justify-between gap-3 bg-slate-50/70 px-4 py-3">
                    <div><p className="text-sm font-bold text-slate-950">Order {record.orderNumber}</p><p className="mt-1 text-xs text-slate-500">Route {route.routeNumber || route.id || "Pickup route"}</p></div>
                    <Badge variant="success"><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Warehouse handover recorded</Badge>
                  </div>
                  <div className="grid gap-3 px-4 py-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Farmer / Farm</p><p className="mt-1 font-semibold text-slate-900">{stop.farmerName || "Farmer not recorded"}</p><p className="mt-1 flex items-start gap-1 text-xs text-slate-600"><MapPin className="h-3.5 w-3.5 shrink-0" />{stop.pickupAddress || "Farm address unavailable"}</p></div>
                    <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Destination</p><p className="mt-1 font-semibold text-slate-900">{route.warehouseName || route.destinationWarehouseName || "Assigned warehouse"}</p></div>
                    <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quantity</p><p className="mt-1 font-semibold text-slate-900">{quantity.toLocaleString("en-IN")} kg</p><p className="mt-1 text-xs text-slate-600">{products.length} collection item(s)</p></div>
                    <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Handover Date</p><p className="mt-1 flex items-start gap-1 font-semibold text-slate-900"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />{formatDate(handoverDate(route))}</p></div>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
                    <p className="text-xs text-slate-500">{products.map((item) => item.productName).filter(Boolean).join(", ") || "Product details unavailable"}</p>
                    <Button type="button" size="sm" variant="outline" aria-expanded={open} onClick={() => setExpanded((previous) => ({ ...previous, [record.key]: !previous[record.key] }))}>{open ? "Hide Details" : "View Details"}<ChevronDown className={"ml-2 h-4 w-4 transition-transform " + (open ? "rotate-180" : "")} /></Button>
                  </div>
                  {open && <div className="space-y-2 border-t border-slate-100 bg-emerald-50/30 px-4 py-4">
                    <p className="text-sm font-semibold text-slate-900">Collected products</p>
                    {products.map((product, index) => <div key={product.collectionId || index} className="flex flex-wrap justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm"><div><p className="font-semibold text-slate-900">{product.productName || "Product"}</p>{product.batchNumber && <p className="mt-1 text-xs text-slate-500">Batch: {product.batchNumber}</p>}</div><div className="text-right"><p className="font-medium text-slate-800">Expected: {product.quantity ?? 0} kg</p><p className="text-emerald-700">Collected: {product.actualQuantity ?? product.quantity ?? 0} kg</p></div></div>)}
                    {route.vehicleNumber && <p className="text-xs text-slate-600">Vehicle: {route.vehicleNumber}</p>}
                  </div>}
                </article>
              );
            })}
        </CardContent>
      </Card>
    </div>
  );
}
