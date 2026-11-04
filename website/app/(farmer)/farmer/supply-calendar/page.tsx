"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays, Wheat, Sprout, Boxes, TrendingUp, IndianRupee,
  ChevronLeft, ChevronRight, Plus, List, LayoutGrid, CalendarRange,
  PackageCheck, Clock3, ClipboardList, ArrowUpRight, CheckCircle2,
  RefreshCw, AlertCircle, Truck, Store, BriefcaseBusiness, CloudSun, FileText, ShoppingBag,
} from "lucide-react";
import { api } from "../../../lib/api/client";
import { formatDate, cn } from "../../../lib/utils";
import { Card, CardContent } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { FarmerPageHeader } from "../../../components/farmer/farmer-page-header";

type CalendarEntry = {
  id: string;
  cropName: string;
  date: Date;
  dateKey: string;
  expectedQuantityKg: number;
  actualQuantityKg: number | null;
  plannedRatePerKg: number | null;
  finalRatePerKg: number | null;
  preOrderCount: number;
  status: string;
  batchId?: string;
  qualityStatus: string;
  eventType?: string;
  orderType?: string;
  referenceId?: string;
};

const dateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parsePlanDate = (value: any): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

const isHarvested = (plan: any) =>
  String(plan.status || "").toLowerCase() === "harvested" ||
  String(plan.stage || "").toLowerCase() === "harvested" ||
  plan.actualQuantityKg != null;

const statusFor = (plan: any, batch: any) => {
  if (batch?.qualityStatus === "approved") return "quality_approved";
  if (batch) return "batched";
  if (isHarvested(plan)) return "harvested";
  if (String(plan.status || "").toLowerCase() === "preorder") return "preorder";
  return "planned";
};

const statusMeta: Record<string, { label: string; short: string; className: string; dot: string }> = {
  planned: { label: "Pre-harvest planned", short: "Pre-harvest", className: "border-violet-200 bg-violet-50 text-violet-800", dot: "bg-violet-500" },
  preorder: { label: "Pre-order open", short: "Pre-order", className: "border-blue-200 bg-blue-50 text-blue-800", dot: "bg-blue-500" },
  harvested: { label: "Harvest recorded", short: "Harvested", className: "border-emerald-200 bg-emerald-50 text-emerald-800", dot: "bg-emerald-500" },
  batched: { label: "Batch created", short: "Batch created", className: "border-amber-200 bg-amber-50 text-amber-800", dot: "bg-amber-500" },
  quality_approved: { label: "Quality approved", short: "Quality approved", className: "border-green-200 bg-green-50 text-green-800", dot: "bg-green-600" },
  farm_pickup: { label: "Farm pickup", short: "Farm pickup", className: "border-rose-200 bg-rose-50 text-rose-800", dot: "bg-rose-500" },
  warehouse_delivery: { label: "Warehouse delivery", short: "Warehouse delivery", className: "border-amber-200 bg-amber-50 text-amber-800", dot: "bg-amber-500" },
  business_delivery: { label: "Business delivery", short: "Business delivery", className: "border-purple-200 bg-purple-50 text-purple-800", dot: "bg-purple-500" },
  retail_delivery: { label: "Retail delivery", short: "Retail delivery", className: "border-sky-200 bg-sky-50 text-sky-800", dot: "bg-sky-500" },
};

function Metric({ label, value, unit, hint, icon: Icon, tone }: any) {
  return (
    <Card className="border-slate-200 shadow-none">
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-slate-950">{value}<span className="ml-1 text-sm font-semibold text-slate-500">{unit || ""}</span></p>
          <p className="mt-1 text-[11px] text-slate-400">{hint}</p>
        </div>
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", tone)}><Icon className="h-5 w-5" /></span>
      </CardContent>
    </Card>
  );
}

export default function FarmerSupplyCalendarPage() {
  const [monthCursor, setMonthCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));
  const [view, setView] = useState<"month" | "week" | "list">("month");
  const [cropFilter, setCropFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: plansData, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["farmerSupplyCalendarFromHarvestPlans"],
    queryFn: () => api.get("/harvests/farmer/plans"),
    retry: 1,
  });
  const { data: batchesData } = useQuery({
    queryKey: ["farmerSupplyCalendarBatches"],
    queryFn: () => api.get("/batches"),
    retry: 1,
  });

  const { data: farmerOrdersData } = useQuery({
    queryKey: ["farmerSupplyCalendarOrders"],
    queryFn: () => api.get("/farmers/me/orders", { params: { limit: 500 } }),
    retry: 1,
  });
  const { data: b2bOrdersData } = useQuery({
    queryKey: ["farmerSupplyCalendarB2BOrders"],
    queryFn: () => api.get("/b2b/orders"),
    retry: 1,
  });
  const { data: contractsData } = useQuery({
    queryKey: ["farmerSupplyCalendarContracts"],
    queryFn: () => api.get("/b2b/contracts/me"),
    retry: 1,
  });

  const plans = plansData?.data?.plans || [];
  const batches = batchesData?.data?.batches || [];
  const farmerOrders = farmerOrdersData?.data?.orders || farmerOrdersData?.orders || [];
  const b2bOrders = b2bOrdersData?.data?.orders || b2bOrdersData?.orders || b2bOrdersData?.data?.data?.orders || [];
  const contractPayload = contractsData?.data?.contracts || contractsData?.data || [];
  const contracts = Array.isArray(contractPayload) ? contractPayload : [];
  const activeContracts = contracts.filter((contract: any) => ["active", "confirmed"].includes(String(contract.status || "").toLowerCase()));

  const entries = useMemo<CalendarEntry[]>(() => {
    const harvestEntries = plans
      .filter((plan: any) => !["cancelled", "deleted"].includes(String(plan.status || "").toLowerCase()))
      .map((plan: any) => {
        const id = String(plan._id || plan.id || "");
        const batch = batches.find((item: any) => String(item.sourceHarvestPlanId || "") === id);
        const date = parsePlanDate(plan.expectedHarvestDate || plan.harvestDate || plan.harvestedAt);
        if (!date) return null;
        const status = statusFor(plan, batch);
        const harvested = ["harvested", "batched", "quality_approved"].includes(status);
        return {
          id, cropName: String(plan.cropName || "Crop"), date, dateKey: dateKey(date),
          expectedQuantityKg: Number(plan.expectedQuantityKg || 0),
          actualQuantityKg: plan.actualQuantityKg != null ? Number(plan.actualQuantityKg) : null,
          plannedRatePerKg: plan.preOrderPricePerKg != null ? Number(plan.preOrderPricePerKg) : null,
          finalRatePerKg: plan.finalRatePerKg != null ? Number(plan.finalRatePerKg) : null,
          preOrderCount: Number(plan.preorderCount || 0), status,
          batchId: batch?._id || batch?.id, qualityStatus: batch?.qualityStatus || "not_created",
          eventType: harvested ? "harvest" : "preharvest",
          orderType: harvested ? "Harvest" : "Pre-harvest",
          referenceId: id,
        } as CalendarEntry;
      }).filter(Boolean) as CalendarEntry[];

    const mapOrders = (orders: any[], isB2B: boolean): CalendarEntry[] => (Array.isArray(orders) ? orders : [])
      .map((order: any) => {
        const id = String(order.id || order._id || order.orderId || "");
        const orderStatus = String(order.status || order.orderStatus || "").toLowerCase();
        if (!id || ["cancelled", "canceled", "rejected", "completed", "delivered"].includes(orderStatus)) return null;
        const date = parsePlanDate(order.deliveryDeadline || order.requiredDate || order.scheduledDeliveryDate || order.deliveryDate || order.expectedDeliveryDate);
        if (!date) return null;
        const deliveryType = String(order.deliveryType || order.fulfillmentMethod || "").toLowerCase();
        const stage = String(order.fulfillmentStage || order.transferStatus || "").toLowerCase();
        const eventType = isB2B
          ? (stage.includes("warehouse") || stage.includes("transfer") ? "warehouse_delivery" : "business_delivery")
          : (orderStatus.includes("pickup") || deliveryType === "pickup" ? "farm_pickup" : "retail_delivery");
        const item = Array.isArray(order.items) ? order.items[0] || {} : {};
        const cropName = String(order.cropName || order.productName || item.productName || item.name || item.product?.name || (isB2B ? "Business supply" : "Customer order"));
        const quantity = Number(order.quantityKg || order.totalQuantityKg || item.quantityKg || item.quantity || order.packedQuantityKg || 0);
        return {
          id: (isB2B ? "b2b-" : "retail-") + id, cropName, date, dateKey: dateKey(date),
          expectedQuantityKg: quantity, actualQuantityKg: null, plannedRatePerKg: null, finalRatePerKg: null,
          preOrderCount: 0, status: eventType, qualityStatus: "not_applicable",
          eventType, orderType: isB2B ? "Business delivery" : eventType === "farm_pickup" ? "Farm pickup" : "Retail delivery",
          referenceId: id,
        } as CalendarEntry;
      }).filter(Boolean) as CalendarEntry[];

    const contractEntries: CalendarEntry[] = activeContracts.map((contract: any) => {
      const date = parsePlanDate(contract.nextDeliveryAt || contract.pendingFarmerDeliveryDate || contract.pendingRescheduledDeliveryDate);
      if (!date) return null;
      const id = String(contract._id || contract.id || contract.contractNumber || "");
      return {
        id: "contract-" + id, cropName: String(contract.cropName || "Contract supply"), date, dateKey: dateKey(date),
        expectedQuantityKg: Number(contract.quantityPerDeliveryKg || contract.quantityPerMonthKg || 0),
        actualQuantityKg: null, plannedRatePerKg: Number(contract.pricePerKg || 0) || null, finalRatePerKg: null,
        preOrderCount: 0, status: "business_delivery", qualityStatus: "not_applicable",
        eventType: "business_delivery", orderType: "Recurring contract", referenceId: id,
      } as CalendarEntry;
    }).filter(Boolean) as CalendarEntry[];

    const unique = new Map<string, CalendarEntry>();
    [...harvestEntries, ...mapOrders(farmerOrders, false), ...mapOrders(b2bOrders, true), ...contractEntries].forEach(entry => {
      if (!unique.has(entry.id)) unique.set(entry.id, entry);
    });
    return Array.from(unique.values());
  }, [plans, batches, farmerOrders, b2bOrders, activeContracts]);

  const crops = useMemo(() => Array.from(new Set(entries.map(entry => entry.cropName))).sort(), [entries]);
  const filteredEntries = useMemo(() => entries.filter(entry =>
    (cropFilter === "all" || entry.cropName === cropFilter) &&
    (statusFilter === "all" ||
      (statusFilter === "preharvest" ? entry.eventType === "preharvest" :
      statusFilter === "harvested" ? entry.eventType === "harvest" : entry.eventType === statusFilter))
  ), [entries, cropFilter, statusFilter]);

  const monthStart = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
  const calendarStart = new Date(monthStart);
  calendarStart.setDate(calendarStart.getDate() - calendarStart.getDay());
  const monthCells = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(calendarStart);
    date.setDate(calendarStart.getDate() + index);
    return date;
  });
  const selected = parsePlanDate(selectedDate) || new Date();
  const weekStart = new Date(selected);
  weekStart.setDate(selected.getDate() - selected.getDay());
  const weekDates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return date;
  });
  const visibleDates = view === "week" ? weekDates : monthCells;
  const selectedEntries = filteredEntries.filter(entry => entry.dateKey === selectedDate);
  const upcomingEntries = filteredEntries
    .filter(entry => entry.date.getTime() >= new Date(new Date().setHours(0, 0, 0, 0)).getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 6);

  const monthEntries = filteredEntries.filter(entry => entry.date.getMonth() === monthCursor.getMonth() && entry.date.getFullYear() === monthCursor.getFullYear());
  const cropPlanEntries = monthEntries.filter(entry => entry.eventType === "harvest" || entry.eventType === "preharvest");
  const monthSupplyKg = cropPlanEntries.reduce((sum, entry) => sum + (entry.actualQuantityKg ?? entry.expectedQuantityKg), 0);
  const harvestedCount = monthEntries.filter(entry => entry.eventType === "harvest").length;
  const preHarvestCount = monthEntries.filter(entry => entry.eventType === "preharvest").length;
  const deliveryCount = monthEntries.filter(entry => ["farm_pickup", "warehouse_delivery", "business_delivery", "retail_delivery"].includes(entry.eventType || "")).length;
  const harvestTaskCount = harvestedCount + preHarvestCount;
  const preorderCount = monthEntries.reduce((sum, entry) => sum + entry.preOrderCount, 0);
  const monthLabel = monthCursor.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  const changeMonth = (amount: number) => setMonthCursor(current => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  const goToday = () => {
    const today = new Date();
    setMonthCursor(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(dateKey(today));
  };

  const renderEntry = (entry: CalendarEntry, compact = false) => {
    const meta = statusMeta[entry.status] || statusMeta.planned;
    const quantity = entry.actualQuantityKg ?? entry.expectedQuantityKg;
    return (
      <button
        key={entry.id}
        type="button"
        onClick={() => setSelectedDate(entry.dateKey)}
        className={cn("w-full min-w-0 rounded-lg border-l-[3px] px-2 py-1.5 text-left transition hover:shadow-sm", meta.className, entry.status === "planned" ? "border-l-violet-500" : entry.status === "preorder" ? "border-l-blue-500" : entry.status === "harvested" ? "border-l-emerald-500" : entry.status === "batched" ? "border-l-amber-500" : "border-l-green-600")}
      >
        <span className="block truncate text-[11px] font-semibold">{entry.cropName}</span>
        <span className="mt-0.5 block truncate text-[10px] opacity-80">{quantity > 0 ? `${quantity} kg` : "Quantity not set"} · {meta.short}</span>
        {!compact && entry.preOrderCount > 0 && <span className="block truncate text-[10px] opacity-75">{entry.preOrderCount} pre-order(s)</span>}
      </button>
    );
  };

  return (
    <div className="w-full min-w-0 space-y-5 pb-8">
      <FarmerPageHeader
        eyebrow="Farm planning & supply"
        title="Supply Calendar"
        description="See when crops are expected to be ready, track harvested quantities and stay on top of supply commitments."
        actions={
          <Button asChild className="h-10 bg-emerald-700 text-white hover:bg-emerald-800">
            <Link href="/farmer/harvest-planner"><Plus className="mr-2 h-4 w-4" />Add harvest plan</Link>
          </Button>
        }
      />

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric label="Planned supply" value={monthSupplyKg.toLocaleString("en-IN")} unit="kg" hint={monthLabel} icon={Boxes} tone="bg-emerald-50 text-emerald-700" />
        <Metric label="Pre-harvest plans" value={preHarvestCount} hint="Expected this month" icon={Sprout} tone="bg-violet-50 text-violet-700" />
        <Metric label="Harvested crops" value={harvestedCount} hint="Recorded this month" icon={Wheat} tone="bg-blue-50 text-blue-700" />
        <Metric label="Pre-orders" value={preorderCount} hint="Linked to harvest plans" icon={TrendingUp} tone="bg-amber-50 text-amber-700" />
      </section>

      <section className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0 overflow-hidden border-slate-200 shadow-sm">
          <CardContent className="space-y-4 p-3 sm:p-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center rounded-lg border border-slate-200 bg-white p-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => changeMonth(-1)} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Button>
                  <span className="min-w-[145px] text-center text-sm font-semibold text-slate-800">{monthLabel}</span>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => changeMonth(1)} aria-label="Next month"><ChevronRight className="h-4 w-4" /></Button>
                </div>
                <Button variant="outline" className="h-9 text-xs" onClick={goToday}>Today</Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label="Filter by crop" value={cropFilter} onChange={event => setCropFilter(event.target.value)} className="h-9 min-w-[130px] rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-emerald-500">
                  <option value="all">All crops</option>
                  {crops.map(crop => <option key={crop} value={crop}>{crop}</option>)}
                </select>
                <select aria-label="Filter by stage" value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="h-9 min-w-[145px] rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-emerald-500">
                  <option value="all">All stages</option>
                  <option value="preharvest">Pre-harvest</option>
                  <option value="harvested">Harvested &amp; batched</option>
                </select>
                <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-1">
                  {(["month", "week", "list"] as const).map(mode => (
                    <button key={mode} type="button" onClick={() => setView(mode)} className={cn("flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-medium capitalize", view === mode ? "bg-white text-emerald-800 shadow-sm" : "text-slate-500 hover:text-slate-800")}>
                      {mode === "month" ? <LayoutGrid className="h-3.5 w-3.5" /> : mode === "week" ? <CalendarRange className="h-3.5 w-3.5" /> : <List className="h-3.5 w-3.5" />}{mode}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {isLoading ? (
              <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200">
                {Array.from({ length: 35 }, (_, index) => <div key={index} className="h-24 animate-pulse bg-white" />)}
              </div>
            ) : isError ? (
              <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><AlertCircle className="h-5 w-5 shrink-0" />Could not load your harvest plans. Refresh to try again.</div>
            ) : view === "list" ? (
              <div className="space-y-2">
                {filteredEntries.filter(entry => entry.date.getMonth() === monthCursor.getMonth() && entry.date.getFullYear() === monthCursor.getFullYear()).length ? filteredEntries.filter(entry => entry.date.getMonth() === monthCursor.getMonth() && entry.date.getFullYear() === monthCursor.getFullYear()).map(entry => (
                  <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg bg-slate-50 text-slate-700"><span className="text-base font-bold">{entry.date.getDate()}</span><span className="text-[9px] uppercase">{entry.date.toLocaleDateString("en-IN", { month: "short" })}</span></div>
                      <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{entry.cropName}</p><p className="text-xs text-slate-500">{entry.actualQuantityKg != null ? `Actual ${entry.actualQuantityKg} kg` : `Expected ${entry.expectedQuantityKg} kg`} · {entry.preOrderCount} pre-orders</p></div>
                    </div>
                    <Badge className={cn("border", statusMeta[entry.status]?.className)}>{statusMeta[entry.status]?.label}</Badge>
                  </div>
                )) : <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No crop plans match these filters for {monthLabel}.</div>}
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => <div key={day} className="py-2 text-center text-[11px] font-semibold text-slate-600">{day}</div>)}
                </div>
                <div className="grid grid-cols-7 gap-px bg-slate-200">
                  {visibleDates.map(date => {
                    const key = dateKey(date);
                    const dayEntries = filteredEntries.filter(entry => entry.dateKey === key);
                    const inMonth = date.getMonth() === monthCursor.getMonth();
                    const isSelected = key === selectedDate;
                    const isToday = key === dateKey(new Date());
                    return (
                      <button key={key} type="button" onClick={() => { setSelectedDate(key); if (view === "week") setMonthCursor(new Date(date.getFullYear(), date.getMonth(), 1)); }} className={cn("min-h-[94px] min-w-0 bg-white p-1.5 text-left transition hover:bg-emerald-50/40 sm:min-h-[116px] sm:p-2", !inMonth && view === "month" && "bg-slate-50/70", isSelected && "ring-2 ring-inset ring-emerald-500", isToday && "bg-emerald-50/40")}>
                        <span className={cn("mb-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[11px] font-semibold", isToday ? "bg-emerald-700 text-white" : inMonth || view === "week" ? "text-slate-700" : "text-slate-300")}>{date.getDate()}</span>
                        <div className="space-y-1">
                          {dayEntries.slice(0, 2).map(entry => renderEntry(entry, true))}
                          {dayEntries.length > 2 && <span className="block px-1 text-[10px] font-semibold text-slate-500">+{dayEntries.length - 2} more</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-3">
              {Object.entries(statusMeta).map(([key, meta]) => (
                <span key={key} className="inline-flex items-center gap-1.5 text-[10px] text-slate-500"><span className={cn("h-2 w-2 rounded-full", meta.dot)} />{meta.short}</span>
              ))}
            </div>
          </CardContent>
        </Card>

        <aside className="space-y-4">
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700">Selected date</p><h2 className="mt-1 text-lg font-bold text-slate-950">{selected.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</h2></div>
                {selectedDate === dateKey(new Date()) && <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-800">Today</Badge>}
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="flex items-center justify-between text-xs"><span className="text-slate-500">Planned for this date</span><strong className="text-slate-900">{selectedEntries.length} crop plan(s)</strong></div>
                <div className="mt-1 flex items-center justify-between text-xs"><span className="text-slate-500">Expected / actual quantity</span><strong className="text-slate-900">{selectedEntries.reduce((sum, entry) => sum + (entry.actualQuantityKg ?? entry.expectedQuantityKg), 0).toLocaleString("en-IN")} kg</strong></div>
              </div>
              {selectedEntries.length ? selectedEntries.map(entry => (
                <div key={entry.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2"><p className="text-sm font-semibold text-slate-900">{entry.cropName}</p><Badge className={cn("border text-[10px]", statusMeta[entry.status]?.className)}>{statusMeta[entry.status]?.short}</Badge></div>
                  <p className="mt-1 text-xs text-slate-500">{entry.actualQuantityKg != null ? `Actual: ${entry.actualQuantityKg} kg` : `Expected: ${entry.expectedQuantityKg} kg`}</p>
                  {entry.preOrderCount > 0 && <p className="mt-1 text-xs text-blue-700">{entry.preOrderCount} pre-order(s) linked</p>}
                  {entry.batchId && <p className="mt-1 text-xs text-slate-500">Batch: {String(entry.batchId).slice(-8)} · {entry.qualityStatus === "approved" ? "Quality approved" : "Inspection pending"}</p>}
                  <Link href="/farmer/harvest-planner" className="mt-2 inline-flex items-center text-xs font-semibold text-emerald-700 hover:text-emerald-800">Open harvest plan <ArrowUpRight className="ml-1 h-3 w-3" /></Link>
                </div>
              )) : <div className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center"><CalendarDays className="mx-auto h-6 w-6 text-slate-300" /><p className="mt-2 text-xs font-medium text-slate-600">No crop plan on this date</p><p className="mt-1 text-[11px] text-slate-400">Choose another date or add a harvest plan.</p></div>}
              <Button asChild className="w-full bg-emerald-700 text-white hover:bg-emerald-800"><Link href="/farmer/harvest-planner"><Plus className="mr-2 h-4 w-4" />Manage harvest plans</Link></Button>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between"><div><h3 className="text-sm font-bold text-slate-900">Upcoming supply</h3><p className="text-[11px] text-slate-500">Your next planned harvests</p></div><Badge variant="outline">{upcomingEntries.length} upcoming</Badge></div>
              {upcomingEntries.length ? upcomingEntries.map(entry => (
                <button key={entry.id} type="button" onClick={() => { setSelectedDate(entry.dateKey); setMonthCursor(new Date(entry.date.getFullYear(), entry.date.getMonth(), 1)); }} className="flex w-full items-center justify-between gap-2 border-b border-slate-100 pb-2 text-left last:border-0 last:pb-0">
                  <div className="flex min-w-0 items-center gap-2"><span className={cn("h-2 w-2 shrink-0 rounded-full", statusMeta[entry.status]?.dot)} /><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-800">{entry.cropName}</p><p className="text-[10px] text-slate-500">{formatDate(entry.date)}</p></div></div>
                  <span className="shrink-0 text-xs font-semibold text-slate-700">{entry.actualQuantityKg ?? entry.expectedQuantityKg} kg</span>
                </button>
              )) : <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">No upcoming harvest plans. Create one in Harvest Planner to see it here.</p>}
            </CardContent>
          </Card>

          <Card className="border-emerald-200 bg-emerald-50/50 shadow-none">
            <CardContent className="flex items-start gap-3 p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700"><Sprout className="h-5 w-5" /></span>
              <div className="min-w-0"><p className="text-sm font-semibold text-emerald-950">Plan your next harvest</p><p className="mt-1 text-xs leading-5 text-emerald-900/70">Add expected harvest dates and quantities. Your plans will appear here automatically.</p><Link href="/farmer/harvest-planner" className="mt-2 inline-flex items-center text-xs font-bold text-emerald-800 hover:underline">Go to Harvest Planner <ArrowUpRight className="ml-1 h-3 w-3" /></Link></div>
            </CardContent>
          </Card>
        </aside>
      </section>
    </div>
  );
}
