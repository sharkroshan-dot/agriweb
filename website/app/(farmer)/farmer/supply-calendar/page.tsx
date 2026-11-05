"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays, Sprout, Boxes,
  ChevronLeft, ChevronRight, Plus, List, LayoutGrid, CalendarRange,
  ArrowUpRight, RefreshCw, AlertCircle, Truck, CloudSun, FileText, ShoppingBag,
  Wheat, PackageCheck, FlaskConical, Loader2, CheckCircle2, X,
} from "lucide-react";
import { api } from "../../../lib/api/client";
import { formatDate, cn } from "../../../lib/utils";
import { Card, CardContent } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { FarmerPageHeader } from "../../../components/farmer/farmer-page-header";
import toast from "react-hot-toast";

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
  const [harvestEntry, setHarvestEntry] = useState<CalendarEntry | null>(null);
  const [harvestQuantity, setHarvestQuantity] = useState("");
  const [harvestRate, setHarvestRate] = useState("");
  const [batchEntry, setBatchEntry] = useState<CalendarEntry | null>(null);
  const [batchGrade, setBatchGrade] = useState("Standard");
  const [batchStorage, setBatchStorage] = useState("normal");
  const [batchShelfLife, setBatchShelfLife] = useState("3");


  const { data: plansData, isLoading, isError } = useQuery({
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
  const queryClient = useQueryClient();
  const harvestMutation = useMutation({
    mutationFn: (payload: { planId: string; actualQuantityKg: number; finalRatePerKg: number }) =>
      api.post("/harvests/plans/" + payload.planId + "/harvest", { actualQuantityKg: payload.actualQuantityKg, finalRatePerKg: payload.finalRatePerKg }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farmerSupplyCalendarFromHarvestPlans"] });
      queryClient.invalidateQueries({ queryKey: ["farmerSupplyCalendarBatches"] });
      queryClient.invalidateQueries({ queryKey: ["farmerHarvestPlans"] });
      setHarvestEntry(null);
      toast.success("Harvest recorded. Next, create a traceable batch.");
    },
    onError: (error: any) => toast.error(error?.message || "Could not record harvest"),
  });
  const batchMutation = useMutation({
    mutationFn: (payload: any) => api.post("/batches", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farmerSupplyCalendarBatches"] });
      queryClient.invalidateQueries({ queryKey: ["farmerSupplyCalendarFromHarvestPlans"] });
      queryClient.invalidateQueries({ queryKey: ["farmerHarvestBatches"] });
      setBatchEntry(null);
      toast.success("Batch created. Request its quality inspection next.");
    },
    onError: (error: any) => toast.error(error?.message || "Could not create batch"),
  });
  const inspectionMutation = useMutation({
    mutationFn: (batchId: string) => api.post("/quality/inspections/request", { batchId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farmerSupplyCalendarBatches"] });
      queryClient.invalidateQueries({ queryKey: ["farmerSupplyCalendarFromHarvestPlans"] });
      toast.success("Quality inspection requested. An authorized verifier will review the batch.");
    },
    onError: (error: any) => toast.error(error?.message || "Could not request quality inspection"),
  });


  const plans = plansData?.data?.plans || [];
  const batches = batchesData?.data?.batches || [];
  const farmerOrders = farmerOrdersData?.data?.data?.orders || farmerOrdersData?.data?.orders || farmerOrdersData?.orders || [];
  const b2bOrders = b2bOrdersData?.data?.data?.orders || b2bOrdersData?.data?.orders || b2bOrdersData?.orders || [];
  const contractPayload = contractsData?.data?.data?.contracts || contractsData?.data?.contracts || contractsData?.data || [];
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
        // Recurring occurrences are represented by contract delivery history; keep separately assigned replacement supplies.
        if (isB2B && order.contractId && order.isReplacementSupply !== true) return null;
        const date = parsePlanDate(order.deliveryDeadline || order.requiredDate || order.scheduledDeliveryDate || order.deliveryDate || order.expectedDeliveryDate);
        if (!date) return null;
        const deliveryType = String(order.deliveryType || order.fulfillmentMethod || "").toLowerCase();
        const stage = String(order.fulfillmentStage || order.transferStatus || "").toLowerCase();
        const eventType = isB2B
          ? (orderStatus.includes("pickup") || stage.includes("pickup") ? "farm_pickup" : stage.includes("warehouse") || stage.includes("transfer") ? "warehouse_delivery" : "business_delivery")
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

    const contractEntries: CalendarEntry[] = activeContracts.flatMap((contract: any) => {
      const id = String(contract._id || contract.id || contract.contractNumber || "");
      const history = Array.isArray(contract.deliveryHistory) ? contract.deliveryHistory : [];
      const occurrences = history.filter((item: any) => item.scheduledDate && !["cancelled", "canceled", "skipped"].includes(String(item.status || "").toLowerCase()));
      const dates = occurrences.length ? occurrences : [{ scheduledDate: contract.nextDeliveryAt || contract.pendingFarmerDeliveryDate || contract.pendingRescheduledDeliveryDate, requestedQuantityKg: contract.quantityPerDeliveryKg || contract.quantityPerMonthKg }];
      return dates.map((occurrence: any, index: number) => {
        const date = parsePlanDate(occurrence.scheduledDate);
        if (!date) return null;
        return {
          id: "contract-" + id + "-" + dateKey(date) + "-" + index, cropName: String(contract.cropName || "Contract supply"), date, dateKey: dateKey(date),
          expectedQuantityKg: Number(occurrence.approvedQuantityKg || occurrence.requestedQuantityKg || contract.quantityPerDeliveryKg || contract.quantityPerMonthKg || 0),
          actualQuantityKg: null, plannedRatePerKg: Number(contract.pricePerKg || 0) || null, finalRatePerKg: null,
          preOrderCount: 0, status: "business_delivery", qualityStatus: "not_applicable",
          eventType: "business_delivery", orderType: "Recurring contract", referenceId: id,
        } as CalendarEntry;
      }).filter(Boolean) as CalendarEntry[];
    });

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
  const daysInMonth = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0).getDate();
  const calendarCellCount = 42;
  const monthCells = Array.from({ length: calendarCellCount }, (_, index) => {
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
  const monthLabel = monthCursor.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  const changeMonth = (amount: number) => setMonthCursor(current => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  const goToday = () => {
    const today = new Date();
    setMonthCursor(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(dateKey(today));
  };
  const openHarvestForm = (entry: CalendarEntry) => {
    setHarvestEntry(entry);
    setHarvestQuantity(String(entry.expectedQuantityKg || ""));
    setHarvestRate(String(entry.plannedRatePerKg || ""));
  };
  const submitHarvest = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!harvestEntry?.referenceId) return;
    const quantity = Number(harvestQuantity);
    const rate = Number(harvestRate);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(rate) || rate <= 0) {
      toast.error("Enter a valid harvested quantity and selling rate.");
      return;
    }
    harvestMutation.mutate({ planId: harvestEntry.referenceId, actualQuantityKg: quantity, finalRatePerKg: rate });
  };
  const openBatchForm = (entry: CalendarEntry) => {
    setBatchEntry(entry);
    setBatchGrade("Standard");
    setBatchStorage("normal");
    setBatchShelfLife("3");
  };
  const submitBatch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!batchEntry?.referenceId) return;
    const quantity = Number(batchEntry.actualQuantityKg ?? batchEntry.expectedQuantityKg);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error("A valid harvested quantity is required before creating a batch.");
      return;
    }
    batchMutation.mutate({
      cropName: batchEntry.cropName,
      quantityKg: quantity,
      harvestDate: batchEntry.date.toISOString(),
      qualityGrade: batchGrade,
      storageType: batchStorage,
      shelfLifeDays: batchShelfLife ? Number(batchShelfLife) : undefined,
      sourceHarvestPlanId: batchEntry.referenceId,
    });
  };


  const renderEntry = (entry: CalendarEntry, compact = false) => {
    const meta = statusMeta[entry.status] || statusMeta.planned;
    const quantity = entry.actualQuantityKg ?? entry.expectedQuantityKg;
    return (
      <div
        key={entry.id}
        className={cn(
          "w-full min-w-0 overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-left",
          meta.className,
          entry.status === "planned" ? "border-l-violet-500" : entry.status === "preorder" ? "border-l-blue-500" : entry.status === "harvested" ? "border-l-emerald-500" : entry.status === "batched" ? "border-l-amber-500" : "border-l-green-600"
        )}
        title={`${entry.cropName} · ${entry.orderType || meta.short}${quantity > 0 ? ` · ${quantity} kg` : ""}`}
      >
        <span className="block truncate text-[10px] font-semibold leading-4">{entry.cropName}</span>
        <span className="block truncate text-[9px] leading-3 opacity-80">{entry.orderType || meta.short}{quantity > 0 ? ` · ${quantity} kg` : ""}</span>
        {!compact && entry.preOrderCount > 0 && <span className="block truncate text-[9px] opacity-75">{entry.preOrderCount} pre-order(s)</span>}
      </div>
    );
  };

  return (
    <div className="w-full min-w-0 space-y-5 pb-8">
      <FarmerPageHeader
        eyebrow="Farm planning & supply"
        title="Supply Calendar"
        description="Plan harvests, track farm pickups and warehouse movements, and keep business and customer deliveries on schedule."
        actions={
          <Button asChild className="h-10 bg-emerald-700 text-white hover:bg-emerald-800">
            <Link href="/farmer/harvest-planner"><Plus className="mr-2 h-4 w-4" />Add harvest plan</Link>
          </Button>
        }
      />

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric label="Total planned supply" value={monthSupplyKg.toLocaleString("en-IN")} unit="kg" hint={monthLabel} icon={Boxes} tone="bg-emerald-50 text-emerald-700" />
        <Metric label="Harvest tasks" value={harvestTaskCount} hint={`${preHarvestCount} pre-harvest · ${harvestedCount} harvested`} icon={Sprout} tone="bg-blue-50 text-blue-700" />
        <Metric label="Deliveries & pickups" value={deliveryCount} hint="Scheduled this month" icon={Truck} tone="bg-amber-50 text-amber-700" />
        <Metric label="Recurring contracts" value={activeContracts.length} hint="Active supply agreements" icon={CalendarDays} tone="bg-violet-50 text-violet-700" />
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
                  <option value="all">All event types</option>
                  <option value="preharvest">Pre-harvest</option>
                  <option value="harvested">Harvested</option>
                  <option value="farm_pickup">Farm pickup</option>
                  <option value="warehouse_delivery">Warehouse delivery</option>
                  <option value="business_delivery">Business delivery</option>
                  <option value="retail_delivery">Retail delivery</option>
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
              <div className="overflow-x-auto p-3 sm:p-4">
                <div className="min-w-[760px]">
                  <div className="grid grid-cols-7 overflow-hidden rounded-t-xl border border-slate-200 bg-slate-50">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) => (
                      <div key={day} className={cn("py-3.5 text-center text-xs font-extrabold uppercase tracking-[0.14em]", index === 0 || index === 6 ? "bg-emerald-50/70 text-emerald-800" : "text-slate-600")}>{day}</div>
                    ))}
                  </div>
                  <div className={cn("grid grid-cols-7 overflow-hidden rounded-b-xl border-x border-b border-slate-200", view === "week" ? "auto-rows-[176px]" : "auto-rows-[112px]")}>
                    {visibleDates.map(date => {
                      const key = dateKey(date);
                      const dayEntries = filteredEntries
                        .filter(entry => entry.dateKey === key)
                        .sort((a, b) => a.cropName.localeCompare(b.cropName));
                      const inMonth = date.getMonth() === monthCursor.getMonth();
                      const isSelected = key === selectedDate;
                      const isToday = key === dateKey(new Date());
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => { setSelectedDate(key); if (view === "week") setMonthCursor(new Date(date.getFullYear(), date.getMonth(), 1)); }}
                          className={cn(
                            "group relative flex min-w-0 flex-col items-stretch gap-1.5 border-b border-r border-slate-200 p-2 text-left transition-all duration-150",
                            !inMonth && view === "month" && "bg-slate-50/60",
                            inMonth && !isSelected && "bg-white hover:bg-emerald-50/50",
                            isSelected && "z-[1] bg-emerald-50/80 shadow-[inset_0_0_0_2px_#059669]",
                            isToday && !isSelected && "bg-emerald-50/40"
                          )}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className={cn(
                              "flex h-7 w-7 items-center justify-center rounded-lg text-xs font-extrabold tabular-nums transition-colors",
                              isToday ? "bg-emerald-700 text-white shadow-sm" : isSelected ? "bg-emerald-100 text-emerald-900" : inMonth || view === "week" ? "text-slate-800 group-hover:bg-emerald-100" : "text-slate-300"
                            )}>{date.getDate()}</span>
                            {dayEntries.length > 0 && (
                              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[9px] font-bold tabular-nums text-slate-600 shadow-sm">
                                {dayEntries.length} {dayEntries.length === 1 ? "item" : "items"}
                              </span>
                            )}
                          </div>
                          <div className="flex min-w-0 flex-col gap-1">
                            {dayEntries.slice(0, 2).map(entry => {
                              const meta = statusMeta[entry.status] || statusMeta.planned;
                              const quantity = entry.actualQuantityKg ?? entry.expectedQuantityKg;
                              return (
                                <span key={entry.id} title={`${entry.cropName} · ${entry.orderType || meta.short}`} className={cn(
                                  "block min-w-0 overflow-hidden rounded-md border border-l-[3px] px-2 py-1 text-xs font-bold leading-4 shadow-sm",
                                  meta.className,
                                  entry.status === "planned" ? "border-l-violet-500" : entry.status === "preorder" ? "border-l-blue-500" : entry.status === "harvested" ? "border-l-emerald-500" : entry.status === "batched" ? "border-l-amber-500" : "border-l-green-600"
                                )}>
                                  <span className="block truncate">{entry.cropName}</span>
                                  <span className="mt-0.5 flex items-center justify-between gap-1 text-[10px] font-semibold leading-3 opacity-85">
                                    <span className="truncate">{quantity > 0 ? `${quantity} kg` : entry.orderType || meta.short}</span>
                                    <span className="shrink-0">{entry.orderType || meta.short}</span>
                                  </span>
                                </span>
                              );
                            })}
                            {dayEntries.length > 2 && (
                              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-800">+{dayEntries.length - 2} more</span>
                            )}
                          </div>
                          {dayEntries.length === 0 && isSelected && (
                            <span className="mt-auto text-[10px] font-medium text-emerald-700">Selected day</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
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
                <div className="flex items-center justify-between text-xs"><span className="text-slate-500">Scheduled activities</span><strong className="text-slate-900">{selectedEntries.length}</strong></div>
                <div className="mt-1 flex items-center justify-between text-xs"><span className="text-slate-500">Planned / recorded crop quantity</span><strong className="text-slate-900">{selectedEntries.filter(entry => entry.eventType === "harvest" || entry.eventType === "preharvest").reduce((sum, entry) => sum + (entry.actualQuantityKg ?? entry.expectedQuantityKg), 0).toLocaleString("en-IN")} kg</strong></div>
              </div>
              {selectedEntries.length ? selectedEntries.map(entry => (
                <div key={entry.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2"><p className="text-sm font-semibold text-slate-900">{entry.cropName}</p><Badge className={cn("border text-[10px]", statusMeta[entry.status]?.className)}>{statusMeta[entry.status]?.short}</Badge></div>
                  <p className="mt-1 text-xs text-slate-500">{entry.orderType || statusMeta[entry.status]?.label}</p>
                  {(entry.actualQuantityKg != null || entry.expectedQuantityKg > 0) && <p className="mt-1 text-xs text-slate-500">{entry.actualQuantityKg != null ? `Actual: ${entry.actualQuantityKg} kg` : `Expected / scheduled: ${entry.expectedQuantityKg} kg`}</p>}
                  {entry.preOrderCount > 0 && <p className="mt-1 text-xs text-blue-700">{entry.preOrderCount} pre-order(s) linked</p>}
                  {entry.batchId && <p className="mt-1 text-xs text-slate-500">Batch: {String(entry.batchId).slice(-8)} · {entry.qualityStatus === "approved" ? "Quality approved" : "Inspection pending"}</p>}
                  <Link
                    href={
                      entry.eventType === "harvest" || entry.eventType === "preharvest"
                        ? "/farmer/harvest-planner"
                        : entry.id.startsWith("contract-")
                          ? "/farmer/b2b/contracts"
                          : entry.id.startsWith("b2b-") && entry.referenceId
                            ? `/farmer/orders/${encodeURIComponent(entry.referenceId)}?source=b2b`
                            : entry.referenceId
                              ? `/farmer/orders/${encodeURIComponent(entry.referenceId)}`
                              : "/farmer/orders"
                    }
                    className="mt-2 inline-flex items-center text-xs font-semibold text-emerald-700 hover:text-emerald-800"
                  >
                    {entry.eventType === "harvest" || entry.eventType === "preharvest"
                      ? "Open harvest plan"
                      : entry.id.startsWith("contract-")
                        ? "View contract"
                        : "View this order"}
                    <ArrowUpRight className="ml-1 h-3 w-3" />
                  </Link>
                </div>
              )) : <div className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center"><CalendarDays className="mx-auto h-6 w-6 text-slate-300" /><p className="mt-2 text-xs font-medium text-slate-600">No crop plan on this date</p><p className="mt-1 text-[11px] text-slate-400">Choose another date or add a harvest plan.</p></div>}
              <Button asChild className="w-full bg-emerald-700 text-white hover:bg-emerald-800"><Link href="/farmer/harvest-planner"><Plus className="mr-2 h-4 w-4" />Manage harvest plans</Link></Button>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between"><div><h3 className="text-sm font-bold text-slate-900">Upcoming schedule</h3><p className="text-[11px] text-slate-500">Harvests, pickups and deliveries coming up</p></div><Badge variant="outline">{upcomingEntries.length} upcoming</Badge></div>
              {upcomingEntries.length ? upcomingEntries.map(entry => (
                <button key={entry.id} type="button" onClick={() => { setSelectedDate(entry.dateKey); setMonthCursor(new Date(entry.date.getFullYear(), entry.date.getMonth(), 1)); }} className="flex w-full items-center justify-between gap-2 border-b border-slate-100 pb-2 text-left last:border-0 last:pb-0">
                  <div className="flex min-w-0 items-center gap-2"><span className={cn("h-2 w-2 shrink-0 rounded-full", statusMeta[entry.status]?.dot)} /><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-800">{entry.cropName}</p><p className="text-[10px] text-slate-500">{formatDate(entry.date)}</p></div></div>
                  <span className="shrink-0 text-xs font-semibold text-slate-700">{entry.actualQuantityKg ?? entry.expectedQuantityKg} kg</span>
                </button>
              )) : <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">No upcoming activities. Your harvest plans, pickups and supply orders will appear here when scheduled.</p>}
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardContent className="space-y-3 p-4">
              <h3 className="text-sm font-bold text-slate-900">Quick actions</h3>
              <div className="grid grid-cols-2 gap-2">
                <Button asChild variant="outline" className="h-auto justify-start border-emerald-200 px-3 py-2 text-xs text-emerald-800"><Link href="/farmer/harvest-planner"><Sprout className="mr-2 h-4 w-4" />Harvest plan</Link></Button>
                <Button asChild variant="outline" className="h-auto justify-start border-purple-200 px-3 py-2 text-xs text-purple-800"><Link href="/farmer/b2b/rfqs"><FileText className="mr-2 h-4 w-4" />Farmer RFQs</Link></Button>
                <Button asChild variant="outline" className="h-auto justify-start border-blue-200 px-3 py-2 text-xs text-blue-800"><Link href="/farmer/b2b/contracts"><RefreshCw className="mr-2 h-4 w-4" />Contracts</Link></Button>
                <Button asChild variant="outline" className="h-auto justify-start border-amber-200 px-3 py-2 text-xs text-amber-800"><Link href="/farmer/orders"><ShoppingBag className="mr-2 h-4 w-4" />Orders</Link></Button>
              </div>
              <Link href="/farmer/weather" className="flex items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-xs font-medium text-sky-800 hover:bg-sky-100"><CloudSun className="h-4 w-4" />Check weather before planning harvest</Link>
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
