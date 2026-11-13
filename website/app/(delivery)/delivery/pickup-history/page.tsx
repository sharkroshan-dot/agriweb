"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import {
  CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Download, Eye,
  Filter, History, MapPin, PackageCheck, RefreshCw, Search, Truck, Warehouse,
  ArrowLeftRight, Building2, RotateCcw,
} from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { api } from "../../../lib/api/client";
import { DeliveryPageHeader } from "../../../components/delivery/delivery-page-header";

type HistoryTab = "pickup" | "transfer" | "b2b";
type HistoryRecord = {
  key: string;
  number: string;
  date: any;
  person: string;
  area: string;
  products: string;
  quantity: string;
  warehouse: string;
  status: string;
  detail: any;
};

const receivedStatuses = new Set(["received", "warehouse_received", "received_at_warehouse", "arrived_warehouse", "returned_to_warehouse", "stored"]);
const normalize = (value: any) => String(value ?? "").trim().toLowerCase().replace(/[ -]+/g, "_");
const historyStatusLabel = (value: any) => {
  const status = normalize(value);
  const labels: Record<string, string> = {
    completed: "Completed",
    returned_to_warehouse: "Returned to Warehouse",
    warehouse_received: "Warehouse Received",
    received: "Warehouse Received",
    received_at_warehouse: "Warehouse Received",
    arrived_warehouse: "Warehouse Received",
    stored: "Stored",
    arrived_at_destination: "Arrived at Destination",
    arrived_at_hub: "Arrived at Local Hub",
    delivered: "Delivered",
  };
  return labels[status] || String(value || "Completed").replace(/_/g, " ").replace(/\\b\\w/g, (letter: string) => letter.toUpperCase());
};
const asDate = (value: any) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const formatDate = (value: any) => {
  const date = asDate(value);
  return date ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date) : "Date unavailable";
};
const dateValue = (value: any) => {
  const date = asDate(value);
  return date ? date.toISOString().slice(0, 10) : "";
};
const routeHandoverDate = (route: any) => route.warehouseArrivalAt || route.arrivedWarehouseAt || route.warehouseArrivedAt || route.returnedAt || route.completedAt || route.updatedAt || route.routeDate || route.createdAt;

const buildFarmRecords = (routes: any[]): HistoryRecord[] => {
  const rows: HistoryRecord[] = [];
  const seen = new Set<string>();
  for (const route of routes) {
    if (!receivedStatuses.has(normalize(route?.status || route?.orderStatus || route?.collectionStatus))) continue;
    const stops = Array.isArray(route.stops) ? route.stops : [];
    for (const [stopIndex, stop] of stops.entries()) {
      const orders = Array.isArray(stop.orders) && stop.orders.length ? stop.orders : [stop];
      const grouped = new Map<string, any[]>();
      for (const [index, order] of orders.entries()) {
        const orderNo = String(order.orderNumber || order.orderNo || order.b2bOrderNumber || order.orderId || order.b2bOrderId || "").trim();
        const group = orderNo ? "order:" + orderNo.toLowerCase() : "item:" + String(order.collectionId || order.id || index);
        grouped.set(group, [...(grouped.get(group) || []), order]);
      }
      for (const [group, products] of grouped) {
        const first = products[0];
        const routeId = String(route.id || route._id || route.routeNumber || "");
        const key = routeId + ":" + stopIndex + ":" + group;
        if (seen.has(key)) continue;
        seen.add(key);
        const qty = products.reduce((sum, item) => sum + Number(item.actualQuantity ?? item.quantity ?? 0), 0);
        const productNames = [...new Set(products.map(item => item.productName).filter(Boolean))].join(", ");
        rows.push({
          key, number: String(first.orderNumber || first.orderNo || first.b2bOrderNumber || first.orderId || first.b2bOrderId || first.collectionId || "Pickup order"),
          date: routeHandoverDate(route), person: stop.farmerName || stop.farmName || "Farmer not recorded",
          area: stop.area || stop.village || stop.pickupAddress || "Area unavailable",
          products: productNames || "Product details unavailable", quantity: qty ? qty.toLocaleString("en-IN") + " kg" : "—",
          warehouse: route.warehouseName || route.destinationWarehouseName || "Assigned warehouse",
          status: "Pickup Completed", detail: { route, stop, products },
        });
      }
    }
  }
  return rows.sort((a, b) => (asDate(b.date)?.getTime() || 0) - (asDate(a.date)?.getTime() || 0));
};

const buildTransferRecords = (warehouseTransfers: any[], hubTransfers: any[]): HistoryRecord[] => {
  const rows: HistoryRecord[] = [];
  const seen = new Set<string>();
  for (const item of [...warehouseTransfers, ...hubTransfers]) {
    const status = normalize(item.status);
    if (!["arrived_at_destination", "arrived_at_hub"].includes(status)) continue;
    const key = String(item.id || item._id || item.orderId || item.orderNumber || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const isHub = status === "arrived_at_hub";
    const qty = Number(item.quantityKg ?? item.quantity ?? 0);
    rows.push({
      key, number: String(item.orderNumber || item.requestNumber || item.id || "Transfer order"),
      date: item.arrivedAtDestinationAt || item.arrivedAtHubAt || item.arrivedAt || item.updatedAt || item.createdAt,
      person: item.sourceWarehouseName || item.sourceName || "Source warehouse",
      area: item.destinationWarehouseName || item.localHubName || item.destinationName || (isHub ? "Local Hub" : "Destination warehouse"),
      products: item.productName || item.products?.map?.((p: any) => p.productName || p.name).filter(Boolean).join(", ") || "Transfer goods",
      quantity: qty ? qty.toLocaleString("en-IN") + " kg" : "—",
      warehouse: item.destinationWarehouseName || item.localHubName || "Destination not recorded",
      status: "Transfer Completed", detail: item,
    });
  }
  return rows.sort((a, b) => (asDate(b.date)?.getTime() || 0) - (asDate(a.date)?.getTime() || 0));
};

const buildB2BRecords = (orders: any[]): HistoryRecord[] => orders
  .filter(item => normalize(item.status) === "delivered" || Boolean(item.deliveredAt))
  .map((item, index) => ({
    key: String(item.id || item.orderId || item.orderNumber || index),
    number: String(item.orderNumber || item.id || "B2B order"),
    date: item.deliveredAt || item.updatedAt || item.createdAt,
    person: item.businessName || item.buyerName || "Business buyer",
    area: typeof item.deliveryAddress === "string" ? item.deliveryAddress : item.deliveryAddress?.district || item.deliveryAddress?.city || item.deliveryAddress?.addressLine1 || "Business delivery area",
    products: item.productName || item.name || "Business order",
    quantity: Number(item.quantityKg || 0) ? Number(item.quantityKg).toLocaleString("en-IN") + " kg" : "—",
    warehouse: item.sourceWarehouseName || item.warehouseName || "Dispatch warehouse",
    status: "Delivered", detail: item,
  }))
  .sort((a, b) => (asDate(b.date)?.getTime() || 0) - (asDate(a.date)?.getTime() || 0));

const startOfDay = (date: Date) => { const d = new Date(date); d.setHours(0, 0, 0, 0); return d; };
const toLocalDateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const parseDateInput = (value: string) => {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
};
const dateOffset = (days: number) => {
  const date = startOfDay(new Date());
  date.setDate(date.getDate() - days);
  return toLocalDateInput(date);
};

export default function PickupHistoryPage() {
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken as string | undefined;
  const [tab, setTab] = useState<HistoryTab>("pickup");
  const [searchText, setSearchText] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [startDate, setStartDate] = useState(dateOffset(6));
  const [endDate, setEndDate] = useState(dateOffset(0));
  const [quickRange, setQuickRange] = useState<"today" | "yesterday" | "7days" | "30days" | "month" | null>("7days");
  const [warehouse, setWarehouse] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const farmQ = useQuery({ queryKey: ["myPickupHistoryRoutes"], queryFn: () => api.get("/delivery/me/pickup-routes"), enabled: Boolean(accessToken), refetchInterval: 30000 });
  const warehouseQ = useQuery({ queryKey: ["myPickupHistoryWarehouseTransfers"], queryFn: () => api.get("/delivery/me/farmer-fulfillment-warehouse-transfers"), enabled: Boolean(accessToken), refetchInterval: 30000 });
  const hubQ = useQuery({ queryKey: ["myPickupHistoryHubTransfers"], queryFn: () => api.get("/delivery/me/farmer-fulfillment-hub-transfers"), enabled: Boolean(accessToken), refetchInterval: 30000 });
  const b2bQ = useQuery({ queryKey: ["myPickupHistoryB2B"], queryFn: () => api.get("/delivery/me/b2b-delivery-orders"), enabled: Boolean(accessToken), refetchInterval: 30000 });

  const farmRows = useMemo(() => buildFarmRecords(farmQ.data?.data?.routes || []), [farmQ.data]);
  const transferRows = useMemo(() => buildTransferRecords(warehouseQ.data?.data?.transfers || [], hubQ.data?.data?.transfers || []), [warehouseQ.data, hubQ.data]);
  const b2bRows = useMemo(() => buildB2BRecords(b2bQ.data?.data?.orders || []), [b2bQ.data]);
  const tabRows: Record<HistoryTab, HistoryRecord[]> = { pickup: farmRows, transfer: transferRows, b2b: b2bRows };
  const rows = tabRows[tab];
  const isLoading = tab === "pickup" ? farmQ.isLoading : tab === "transfer" ? warehouseQ.isLoading || hubQ.isLoading : b2bQ.isLoading;
  const isError = tab === "pickup" ? farmQ.isError : tab === "transfer" ? warehouseQ.isError || hubQ.isError : b2bQ.isError;
  const allRows = [...farmRows, ...transferRows, ...b2bRows];
  const warehouses = [...new Set(rows.map(row => row.warehouse).filter(Boolean))].sort();
  const availableStatuses = tab === "pickup" ? ["pickup_completed"] : tab === "transfer" ? ["transfer_completed"] : ["delivered"];
  const filteredRows = rows.filter(row => {
    const haystack = [row.number, row.person, row.area, row.products, row.warehouse].join(" ").toLowerCase();
    const matchesSearch = !appliedSearch || haystack.includes(appliedSearch.toLowerCase());
    const rowDate = asDate(row.date);
    const from = parseDateInput(startDate);
    const to = parseDateInput(endDate);
    if (to) to.setHours(23, 59, 59, 999);
    const matchesDate = (!from || Boolean(rowDate && rowDate >= startOfDay(from))) && (!to || Boolean(rowDate && rowDate <= to));
    const matchesWarehouse = warehouse === "all" || row.warehouse === warehouse;
    const matchesStatus = status === "all" || normalize(row.status) === status;
    return matchesSearch && matchesDate && matchesWarehouse && matchesStatus;
  });
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const visibleRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);
  const totalQty = allRows.length;
  const completedCounts = { pickup: farmRows.length, transfer: transferRows.length, b2b: b2bRows.length };
  const loadingAll = farmQ.isLoading || warehouseQ.isLoading || hubQ.isLoading || b2bQ.isLoading;
  const refresh = () => { void farmQ.refetch(); void warehouseQ.refetch(); void hubQ.refetch(); void b2bQ.refetch(); };
  const clearFilters = () => { setSearchText(""); setAppliedSearch(""); setStartDate(""); setEndDate(""); setWarehouse("all"); setStatus("all"); setQuickRange(null); setPage(1); };
  const applyQuickDate = (range: "today" | "yesterday" | "7days" | "30days" | "month") => {
    const today = dateOffset(0);
    const yesterday = dateOffset(1);
    const start = range === "today"
      ? today
      : range === "yesterday"
        ? yesterday
        : range === "month"
          ? toLocalDateInput(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
          : dateOffset(range === "7days" ? 6 : 29);
    setStartDate(start);
    setEndDate(range === "yesterday" ? yesterday : today);
    setQuickRange(range);
    setPage(1);
  };
  const exportRows = () => {
    const headers = ["Order / Route", "Date", "Farmer / Business / Source", "Area / Destination", "Products", "Quantity", "Warehouse", "Status"];
    const csv = [headers, ...filteredRows.map(row => [row.number, formatDate(row.date), row.person, row.area, row.products, row.quantity, row.warehouse, row.status])]
      .map(line => line.map(value => '"' + String(value ?? "").replace(/"/g, '""') + '"').join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = "agriconnect-" + tab + "-history.csv"; link.click(); URL.revokeObjectURL(url);
  };
  const tabConfig = [
    { id: "pickup" as const, label: "Farm Pickup History", icon: Truck, count: completedCounts.pickup },
    { id: "transfer" as const, label: "Warehouse Transfer History", icon: ArrowLeftRight, count: completedCounts.transfer },
    { id: "b2b" as const, label: "B2B Delivery History", icon: Building2, count: completedCounts.b2b },
  ];
  const pageTitle = tab === "pickup" ? "Farm Pickup History" : tab === "transfer" ? "Warehouse Transfer History" : "B2B Delivery History";
  const description = tab === "pickup" ? "Completed farm collections handed over to the assigned warehouse." : tab === "transfer" ? "Transfers with arrival confirmed at the destination warehouse or local hub." : "Business orders successfully delivered and handed over to the buyer.";

  return (
    <div className="space-y-5 pb-8">
      <DeliveryPageHeader
        title="Pickup History"
        description="Review completed farm pickups, warehouse transfers and B2B business deliveries."
        actionLabel="Refresh"
        actionHref={undefined}
      >
        <Button type="button" variant="outline" onClick={refresh} disabled={loadingAll} className="min-h-10 bg-white">
          <RefreshCw className={"mr-2 h-4 w-4 " + (loadingAll ? "animate-spin" : "")} />Refresh
        </Button>
      </DeliveryPageHeader>

      <section className="grid gap-3 md:grid-cols-3" aria-label="Completed history totals">
        <div className="flex items-center gap-4 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-sm"><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><Truck className="h-6 w-6" /></div><div><p className="text-sm font-semibold text-slate-700">Farm Pickup <span className="font-normal text-slate-500">(Completed)</span></p><p className="text-3xl font-extrabold text-slate-950">{farmQ.isLoading ? "—" : farmRows.length}</p><p className="text-xs text-slate-500">Farm → Warehouse</p></div></div>
        <div className="flex items-center gap-4 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-sm"><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-700"><ArrowLeftRight className="h-6 w-6" /></div><div><p className="text-sm font-semibold text-slate-700">Warehouse Transfer <span className="font-normal text-slate-500">(Completed)</span></p><p className="text-3xl font-extrabold text-slate-950">{warehouseQ.isLoading || hubQ.isLoading ? "—" : transferRows.length}</p><p className="text-xs text-slate-500">Warehouse → Warehouse / Hub</p></div></div>
        <div className="flex items-center gap-4 rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-4 shadow-sm"><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><Building2 className="h-6 w-6" /></div><div><p className="text-sm font-semibold text-slate-700">B2B Business Delivery <span className="font-normal text-slate-500">(Completed)</span></p><p className="text-3xl font-extrabold text-slate-950">{b2bQ.isLoading ? "—" : b2bRows.length}</p><p className="text-xs text-slate-500">Warehouse → Business buyer</p></div></div>
      </section>

      <nav className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="History categories">
        {tabConfig.map(item => { const Icon = item.icon; const active = tab === item.id; return <button key={item.id} type="button" onClick={() => { setTab(item.id); setPage(1); setAppliedSearch(""); setSearchText(""); setWarehouse("all"); setStatus("all"); }} className={"flex min-h-12 items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition-colors " + (active ? "border-emerald-700 bg-emerald-700 text-white shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50")}><Icon className="h-5 w-5" /><span>{item.label}</span><span className={"rounded-full px-2 py-0.5 text-xs " + (active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-700")}>{item.count}</span></button>; })}
      </nav>

      <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700"><Filter className="h-5 w-5" /></div><h2 className="text-base font-bold text-slate-950">Search &amp; Filter</h2></div>
          <div className="flex flex-wrap gap-2">
            {[{ label: "Today", value: "today" as const }, { label: "Yesterday", value: "yesterday" as const }, { label: "Last 7 Days", value: "7days" as const }, { label: "Last 30 Days", value: "30days" as const }, { label: "This Month", value: "month" as const }].map(item => { const active = quickRange === item.value; return <Button key={item.value} type="button" size="sm" variant={active ? "default" : "outline"} aria-pressed={active} onClick={() => applyQuickDate(item.value)} className={active ? "border-emerald-700 bg-emerald-700 font-semibold text-white shadow-sm hover:border-emerald-800 hover:bg-emerald-800 focus:ring-0 focus-visible:ring-2 focus-visible:ring-emerald-500" : "border-slate-200 bg-white font-medium text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 focus:ring-0 focus-visible:ring-2 focus-visible:ring-emerald-500"}>{item.label}</Button>; })}
          </div>
        </div>
        <div className="grid gap-3 xl:grid-cols-[minmax(220px,1.5fr)_minmax(180px,1fr)_minmax(170px,1fr)_minmax(150px,.8fr)_auto_auto]">
          <label className="min-w-0"><span className="mb-1 block text-xs font-semibold text-slate-600">Search</span><div className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3"><Search className="h-4 w-4 shrink-0 text-slate-400" /><input value={searchText} onChange={event => setSearchText(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { setAppliedSearch(searchText.trim()); setPage(1); } }} placeholder="Route, order, farmer or product..." className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400" /></div></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">From date</span><input type="date" value={startDate} max={endDate || undefined} onChange={event => { setStartDate(event.target.value); setQuickRange(null); setPage(1); }} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700" /></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">To date</span><input type="date" value={endDate} min={startDate || undefined} onChange={event => { setEndDate(event.target.value); setQuickRange(null); setPage(1); }} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700" /></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">Warehouse</span><select value={warehouse} onChange={event => { setWarehouse(event.target.value); setPage(1); }} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"><option value="all">All Warehouses</option>{warehouses.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">Status</span><select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"><option value="all">All statuses</option>{availableStatuses.map(value => <option key={value} value={value}>{value === "pickup_completed" ? "Pickup Completed" : value === "transfer_completed" ? "Transfer Completed" : "Delivered"}</option>)}</select></label>
          <div className="flex items-end gap-2"><Button type="button" onClick={() => { setAppliedSearch(searchText.trim()); setPage(1); }} className="h-10 bg-emerald-700 text-white hover:bg-emerald-800"><Search className="mr-2 h-4 w-4" />Search</Button><Button type="button" variant="outline" onClick={clearFilters} className="h-10 bg-white"><RotateCcw className="mr-2 h-4 w-4" />Clear</Button></div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
          <div><h2 className="text-lg font-bold text-slate-950">{pageTitle} ({filteredRows.length} Records)</h2><p className="mt-1 text-sm text-slate-500">{description}</p></div>
          <Button type="button" variant="outline" onClick={exportRows} disabled={!filteredRows.length} className="bg-white"><Download className="mr-2 h-4 w-4" />Export CSV</Button>
        </div>
        {isLoading ? <div className="space-y-3 p-5">{[1, 2, 3].map(item => <div key={item} className="h-14 animate-pulse rounded-lg bg-slate-100" />)}</div>
          : isError ? <div className="px-5 py-14 text-center text-sm text-slate-600">History could not be loaded. Refresh the page and try again.</div>
          : filteredRows.length === 0 ? <div className="px-5 py-14 text-center"><PackageCheck className="mx-auto h-10 w-10 text-slate-300" /><p className="mt-3 font-semibold text-slate-900">No completed records found</p><p className="mt-1 text-sm text-slate-500">Try changing the date range or clearing your search.</p></div>
          : <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-emerald-50 text-xs font-semibold uppercase tracking-wide text-emerald-950"><tr><th className="px-4 py-3"># / Route</th><th className="px-4 py-3">Date &amp; Time</th><th className="px-4 py-3">{tab === "pickup" ? "Farmer / Farm" : tab === "transfer" ? "Source" : "Business Buyer"}</th><th className="px-4 py-3">{tab === "pickup" ? "Area / Locality" : "Destination"}</th><th className="px-4 py-3">Products &amp; Quantity</th><th className="px-4 py-3">Warehouse</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{visibleRows.map((row, index) => { const open = Boolean(expanded[row.key]); return <tr key={row.key} className="align-top hover:bg-slate-50/70"><td className="px-4 py-3"><span className="font-semibold text-slate-900">{(page - 1) * pageSize + index + 1}. {row.number}</span></td><td className="whitespace-nowrap px-4 py-3 text-slate-600"><span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-slate-400" />{formatDate(row.date)}</span></td><td className="px-4 py-3"><span className="font-semibold text-slate-900">{row.person}</span></td><td className="px-4 py-3"><span className="inline-flex items-start gap-1.5 text-slate-700"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />{row.area}</span></td><td className="px-4 py-3"><p className="font-medium text-slate-800">{row.products}</p><p className="mt-1 text-xs text-slate-500">{row.quantity}</p></td><td className="px-4 py-3"><span className="inline-flex items-center gap-1.5 text-slate-700"><Warehouse className="h-4 w-4 text-slate-400" />{row.warehouse}</span></td><td className="px-4 py-3"><Badge variant="success"><CheckCircle2 className="mr-1 h-3.5 w-3.5" />{row.status}</Badge></td><td className="px-4 py-3"><Button type="button" size="sm" variant="outline" onClick={() => setExpanded(previous => ({ ...previous, [row.key]: !previous[row.key] }))} className="bg-white"><Eye className="mr-1.5 h-4 w-4" />{open ? "Hide" : "View Details"}</Button>{open && <div className="mt-2 min-w-64 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"><p className="font-semibold text-slate-900">Record details</p><pre className="mt-2 whitespace-pre-wrap break-words font-sans">{tab === "pickup" ? (row.detail.products || []).map((item: any) => (item.productName || "Product") + ": " + (item.actualQuantity ?? item.quantity ?? "—") + " kg").join("\n") : JSON.stringify(row.detail, (key, value) => key.startsWith("_") ? undefined : value, 2)}</pre></div>}</td></tr>; })}</tbody></table></div>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-600"><span>Showing {filteredRows.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filteredRows.length)} of {filteredRows.length} records</span><div className="flex items-center gap-1"><Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}><ChevronLeft className="h-4 w-4" /></Button><span className="px-2 font-semibold text-slate-800">{page} / {pageCount}</span><Button type="button" size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage(value => Math.min(pageCount, value + 1))}><ChevronRight className="h-4 w-4" /></Button></div></div>
      </section>
    </div>
  );
}
