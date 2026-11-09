"use client";

import { useEffect, useMemo, useState } from "react";
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
  masterCropId?: string;
  farmerCropId?: string;
  qualityStatus: string;
  eventType?: string;
  orderType?: string;
  referenceId?: string;
  productBreakdown?: { name: string; quantityKg: number }[];
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

const buildContractScheduleDates = (contract: any): string[] => {
  const start = parsePlanDate(contract.startDate);
  const end = parsePlanDate(contract.endDate);
  if (!start || !end || end < start) return [];
  const frequency = String(contract.frequency || "weekly").toLowerCase();
  const interval = Math.max(1, Math.min(12, Number(contract.recurrenceInterval || 1)));
  const dates: string[] = [];
  const cursor = new Date(start);
  for (let guard = 0; cursor <= end && guard < 1200; guard += 1) {
    dates.push(dateKey(cursor));
    if (frequency === "daily") cursor.setDate(cursor.getDate() + interval);
    else if (frequency === "monthly") cursor.setMonth(cursor.getMonth() + interval);
    else cursor.setDate(cursor.getDate() + 7 * interval);
  }
  return dates;
};

export function FarmerSupplyCalendarContent(props: { compact?: boolean; selectedDate?: string } = {}) {
  const compact = props.compact ?? false;
  const sharedSelectedDate = props.selectedDate;
  const [monthCursor, setMonthCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));
  useEffect(() => { if (compact && sharedSelectedDate) setSelectedDate(sharedSelectedDate); }, [compact, sharedSelectedDate]);
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
  const { data: inventoryData, isLoading: inventoryLoading, isError: inventoryError } = useQuery({
    queryKey: ["farmerSupplyCalendarInventory"],
    queryFn: () => api.get("/inventory/farmer/summary"),
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

  const plans = useMemo(() => plansData?.data?.plans || [], [plansData]);
  const batches = useMemo(() => batchesData?.data?.batches || [], [batchesData]);
  const farmerOrders = useMemo(() => farmerOrdersData?.data?.data?.orders || farmerOrdersData?.data?.orders || farmerOrdersData?.orders || [], [farmerOrdersData]);
  const b2bOrders = useMemo(() => b2bOrdersData?.data?.data?.orders || b2bOrdersData?.data?.orders || b2bOrdersData?.orders || [], [b2bOrdersData]);
  const contracts = useMemo(() => {
    const payload = contractsData?.data?.data?.contracts || contractsData?.data?.contracts || contractsData?.data || [];
    return Array.isArray(payload) ? payload : [];
  }, [contractsData]);
  const activeContracts = contracts.filter((contract: any) => ["active", "confirmed"].includes(String(contract.status || "").toLowerCase()));
  const inventorySummary = inventoryData?.data || {};
  const inventoryProducts = Array.isArray(inventorySummary.products) ? inventorySummary.products : [];

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
          batchId: batch?._id || batch?.id, masterCropId: plan.masterCropId, farmerCropId: plan.farmerCropId, qualityStatus: batch?.qualityStatus || "not_created",
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
        const items = Array.isArray(order.items) ? order.items : [];
        const productBreakdown = items.map((item: any) => ({
          name: String(item.productName || item.name || item.product?.name || order.cropName || order.productName || (isB2B ? "Business supply" : "Customer order")),
          quantityKg: Number(item.quantityKg ?? item.quantity ?? item.packedQuantityKg ?? 0),
        })).filter((item: any) => Number.isFinite(item.quantityKg) && item.quantityKg > 0);
        const fallbackName = String(order.cropName || order.productName || (isB2B ? "Business supply" : "Customer order"));
        const fallbackQuantity = Number(order.quantityKg ?? order.totalQuantityKg ?? order.packedQuantityKg ?? 0);
        const quantity = productBreakdown.length
          ? productBreakdown.reduce((sum: number, item: any) => sum + item.quantityKg, 0)
          : (Number.isFinite(fallbackQuantity) ? fallbackQuantity : 0);
        const cropNames = productBreakdown.length
          ? Array.from(new Set(productBreakdown.map((item: any) => item.name))).join(", ")
          : fallbackName;
        return {
          id: (isB2B ? "b2b-" : "retail-") + id, cropName: cropNames, date, dateKey: dateKey(date),
          expectedQuantityKg: quantity, actualQuantityKg: null, plannedRatePerKg: null, finalRatePerKg: null,
          preOrderCount: 0, status: eventType, qualityStatus: "not_applicable",
          eventType, orderType: isB2B ? "Business delivery" : eventType === "farm_pickup" ? "Farm pickup" : "Retail delivery",
          referenceId: id, productBreakdown: productBreakdown.length ? productBreakdown : [{ name: fallbackName, quantityKg: quantity }],
        } as CalendarEntry;
      }).filter(Boolean) as CalendarEntry[];

    const contractEntries: CalendarEntry[] = activeContracts.flatMap((contract: any) => {
      const id = String(contract._id || contract.id || contract.contractNumber || "");
      const history = Array.isArray(contract.deliveryHistory) ? contract.deliveryHistory : [];
      const historyByDate = new Map(history.filter((item: any) => item.scheduledDate).map((item: any) => [String(item.scheduledDate).slice(0, 10), item]));
      const scheduledDates = buildContractScheduleDates(contract);
      const dates = Array.from(new Set([...scheduledDates, ...historyByDate.keys()]));
      return dates.map((scheduleKey: string) => {
        const occurrence: any = historyByDate.get(scheduleKey) || {};
        if (["cancelled", "canceled", "skipped"].includes(String(occurrence.status || "").toLowerCase())) return null;
        const date = parsePlanDate(scheduleKey);
        if (!date) return null;
        return {
          id: "contract-" + id + "-" + scheduleKey, cropName: String(contract.cropName || "Contract supply"), date, dateKey: dateKey(date),
          expectedQuantityKg: Number(occurrence.requestedQuantityKg || occurrence.approvedQuantityKg || contract.quantityPerDeliveryKg || 0),
          actualQuantityKg: Number(occurrence.fulfilledQuantityKg || 0) || null,
          plannedRatePerKg: Number(contract.pricePerKg || 0) || null, finalRatePerKg: null,
          preOrderCount: 0, status: String(occurrence.fulfillmentStatus || "").toLowerCase() === "delivered" ? "business_delivery" : "business_delivery", qualityStatus: "not_applicable",
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
  const allUpcomingEntries = filteredEntries
    .filter(entry => entry.date.getTime() >= new Date(new Date().setHours(0, 0, 0, 0)).getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const upcomingEntries = allUpcomingEntries.slice(0, 6);
  const upcomingOrderEntries = allUpcomingEntries.filter(entry =>
    ["farm_pickup", "warehouse_delivery", "business_delivery", "retail_delivery"].includes(entry.eventType || "")
  );
  const upcomingOrderCount = new Set(upcomingOrderEntries.map(entry => entry.referenceId || entry.id)).size;
  const upcomingOrderQuantityKg = upcomingOrderEntries.reduce((sum, entry) => sum + Math.max(0, entry.expectedQuantityKg || 0), 0);
  const upcomingPickupCount = upcomingOrderEntries.filter(entry => entry.eventType === "farm_pickup").length;
  const upcomingDeliveryCount = upcomingOrderEntries.filter(entry => ["warehouse_delivery", "business_delivery", "retail_delivery"].includes(entry.eventType || "")).length;
  const upcomingProductQuantities = upcomingOrderEntries.reduce((totals, entry) => {
    (entry.productBreakdown || [{ name: entry.cropName, quantityKg: entry.expectedQuantityKg }]).forEach(product => {
      const name = product.name || "Other produce";
      totals.set(name, (totals.get(name) || 0) + Math.max(0, Number(product.quantityKg) || 0));
    });
    return totals;
  }, new Map<string, number>());
  const topUpcomingProducts = Array.from(upcomingProductQuantities.entries()).sort((a, b) => b[1] - a[1]);

  // Compare upcoming commitments with recorded harvest. This is an indicative planning
  // comparison only; it is not live sellable stock because reservations/allocations are
  // not exposed by the inventory API used on this page.
  const harvestedByProduct = plans.reduce((totals: Map<string, number>, plan: any) => {
    if (!isHarvested(plan)) return totals;
    const name = String(plan.cropName || "Other produce").trim().toLocaleLowerCase();
    const quantity = Math.max(0, Number(plan.actualQuantityKg ?? plan.expectedQuantityKg ?? 0) || 0);
    totals.set(name, (totals.get(name) || 0) + quantity);
    return totals;
  }, new Map<string, number>());
  const supplyDemandRows = topUpcomingProducts.map(([name, required]) => {
    const harvested = harvestedByProduct.get(String(name).trim().toLocaleLowerCase()) || 0;
    return { name, required, harvested, gap: Math.max(0, required - harvested) };
  });
  const totalHarvestPlanGapKg = supplyDemandRows.reduce((sum, row) => sum + row.gap, 0);

  const completedOrderStatuses = ["delivered", "completed", "fulfilled", "received"];
  const allFarmerOrders = [...farmerOrders, ...b2bOrders];
  const completedDeliveries = allFarmerOrders.filter((order: any) => completedOrderStatuses.includes(String(order.status || order.orderStatus || "").toLowerCase()));
  const pendingFarmerHarvestKg = plans.filter((plan: any) => !isHarvested(plan) && !["cancelled", "deleted"].includes(String(plan.status || "").toLowerCase()))
    .reduce((sum: number, plan: any) => sum + Math.max(0, Number(plan.expectedQuantityKg || 0)), 0);
  const totalHarvestedPlansKg = plans.filter((plan: any) => isHarvested(plan))
    .reduce((sum: number, plan: any) => sum + Math.max(0, Number(plan.actualQuantityKg ?? plan.expectedQuantityKg ?? 0)), 0);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const contractProgress = activeContracts.map((contract: any) => {
    const history = Array.isArray(contract.deliveryHistory) ? contract.deliveryHistory : [];
    const completedStatuses = ["delivered", "completed"];
    const completed = history.filter((item: any) =>
      completedStatuses.includes(String(item.fulfillmentStatus || "").toLowerCase())
    );
    const suppliedKg = completed.reduce((sum: number, item: any) =>
      sum + Math.max(0, Number(item.fulfilledQuantityKg || 0)), 0
    );
    const scheduleDates = buildContractScheduleDates(contract);
    const occurrenceQuantities = scheduleDates.map((scheduleKey: string) => {
      const occurrence = history.find((item: any) => String(item.scheduledDate || "").slice(0, 10) === scheduleKey);
      return Math.max(0, Number(occurrence?.requestedQuantityKg || occurrence?.approvedQuantityKg || contract.quantityPerDeliveryKg || 0));
    });
    const totalKg = occurrenceQuantities.length
      ? occurrenceQuantities.reduce((sum: number, value: number) => sum + value, 0)
      : null;
    const remainingKg = totalKg == null ? null : Math.max(0, totalKg - suppliedKg);
    const missed = scheduleDates.filter((scheduleKey: string) => {
      const item = history.find((row: any) => String(row.scheduledDate || "").slice(0, 10) === scheduleKey) || {};
      const scheduled = parsePlanDate(scheduleKey);
      const state = String(item.fulfillmentStatus || "").toLowerCase();
      return scheduled && scheduled < todayStart
        && !completedStatuses.includes(state)
        && !["cancelled", "canceled", "skipped"].includes(String(item.status || "").toLowerCase());
    });
    return {
      id: String(contract._id || contract.id || contract.contractNumber),
      name: String(contract.cropName || "Contract supply"),
      suppliedKg,
      totalKg,
      remainingKg,
      completionPct: totalKg != null && totalKg > 0 ? Math.min(100, suppliedKg / totalKg * 100) : null,
      completedCount: completed.length,
      occurrenceCount: history.length,
      missed,
    };
  });
  const missedContractOccurrences = contractProgress.reduce((sum, item) => sum + item.missed.length, 0);
  const threeDaysAhead = new Date(todayStart);
  threeDaysAhead.setDate(threeDaysAhead.getDate() + 3);
  const overdueHarvestPlans = plans.filter((plan: any) => {
    const due = parsePlanDate(plan.expectedHarvestDate);
    return due && due < todayStart && !isHarvested(plan) && !["cancelled", "deleted"].includes(String(plan.status || "").toLowerCase());
  });
  const soonHarvestPlans = plans.filter((plan: any) => {
    const due = parsePlanDate(plan.expectedHarvestDate);
    return due && due >= todayStart && due <= threeDaysAhead && !isHarvested(plan);
  });
  const batchesAwaitingInspection = batches.filter((batch: any) =>
    !["approved", "passed"].includes(String(batch.qualityStatus || batch.inspectionStatus || "").toLowerCase()) &&
    !["rejected", "cancelled", "expired"].includes(String(batch.status || "").toLowerCase())
  );
  const contractsDueSoon = activeContracts.filter((contract: any) => {
    const due = parsePlanDate(contract.nextDeliveryAt || contract.pendingFarmerDeliveryDate || contract.pendingRescheduledDeliveryDate);
    return due && due >= todayStart && due <= threeDaysAhead;
  });
  const farmerActionCount = overdueHarvestPlans.length + soonHarvestPlans.length + batchesAwaitingInspection.length + contractsDueSoon.length;

  const farmerOrderRows = [
    ...farmerOrders.map((order: any) => ({ ...order, __kind: "retail" })),
    ...b2bOrders.map((order: any) => ({ ...order, __kind: "b2b" })),
  ];
  const ordersAwaitingPreparation = farmerOrderRows.filter((order: any) =>
    ["confirmed", "preparing", "quality_check"].includes(String(order.status || order.orderStatus || "").toLowerCase())
  );
  const ordersReadyForPickup = farmerOrderRows.filter((order: any) =>
    String(order.status || order.orderStatus || "").toLowerCase() === "ready_for_pickup"
  );
  const selectedDayOrders = selectedEntries.filter(entry =>
    ["farm_pickup", "warehouse_delivery", "business_delivery", "retail_delivery"].includes(entry.eventType || "")
  );
  const selectedDayRetailCount = selectedDayOrders.filter(entry => entry.id.startsWith("retail-")).length;
  const selectedDayB2BCount = selectedDayOrders.filter(entry => entry.id.startsWith("b2b-") || entry.id.startsWith("contract-")).length;
  const selectedDayOrderQuantity = selectedDayOrders.reduce((sum, entry) => sum + Math.max(0, entry.expectedQuantityKg || 0), 0);
  const inventoryShortageRows = supplyDemandRows.filter(row => row.gap > 0);
  const overdueContracts = activeContracts.filter((contract: any) => {
    const due = parsePlanDate(contract.nextDeliveryAt || contract.pendingFarmerDeliveryDate || contract.pendingRescheduledDeliveryDate);
    return due && due < todayStart;
  });
  const smartAlertCount = overdueHarvestPlans.length + inventoryShortageRows.length + overdueContracts.length
    + ordersAwaitingPreparation.length + ordersReadyForPickup.length + missedContractOccurrences;

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
      masterCropId: batchEntry.masterCropId,
      farmerCropId: batchEntry.farmerCropId,
      quantityKg: quantity,
      harvestDate: new Date().toISOString(),
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
      {!compact && <FarmerPageHeader
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
        <Metric label="Harvested quantity" value={totalHarvestedPlansKg.toLocaleString("en-IN")} unit="kg" hint="Recorded actual harvest" icon={Sprout} tone="bg-blue-50 text-blue-700" />
        <Metric label="Pending harvest" value={pendingFarmerHarvestKg.toLocaleString("en-IN")} unit="kg" hint="Expected from open harvest plans" icon={Wheat} tone="bg-amber-50 text-amber-700" />
        <Metric label="Completed deliveries" value={completedDeliveries.length} hint="Retail and B2B orders" icon={Truck} tone="bg-violet-50 text-violet-700" />
      </section>
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric label="Deliveries & pickups" value={deliveryCount} hint="Scheduled this month" icon={Truck} tone="bg-sky-50 text-sky-700" />
        <Metric label="Active contracts" value={activeContracts.length} hint="Recurring supply agreements" icon={CalendarDays} tone="bg-violet-50 text-violet-700" />
        <Metric label="Orders awaiting preparation" value={ordersAwaitingPreparation.length} hint="Farmer action required" icon={PackageCheck} tone="bg-emerald-50 text-emerald-700" />
        <Metric label="Orders ready for pickup" value={ordersReadyForPickup.length} hint="Packed and awaiting collection" icon={Boxes} tone="bg-orange-50 text-orange-700" />
      </section>

      <section className="flex min-w-0 flex-col gap-4">
        <Card className={cn("min-w-0 overflow-hidden border-slate-200 shadow-sm", compact && "hidden")}>
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
                {Array.from({ length: 35 }, (_, index) => <div key={index} className="h-[72px] animate-pulse bg-white" />)}
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
              <div className="overflow-x-auto p-2 sm:p-3">
                <div className="min-w-[760px]">
                  <div className="grid grid-cols-7 overflow-hidden rounded-t-xl border border-slate-200 bg-slate-50">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) => (
                      <div key={day} className={cn("py-3.5 text-center text-xs font-extrabold uppercase tracking-[0.14em]", index === 0 || index === 6 ? "bg-emerald-50/70 text-emerald-800" : "text-slate-600")}>{day}</div>
                    ))}
                  </div>
                  <div className={cn("grid grid-cols-7 overflow-hidden rounded-b-xl border-x border-b border-slate-200", view === "week" ? "auto-rows-[108px]" : "auto-rows-[72px]")}>
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

        <aside className="grid min-w-0 grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="space-y-2.5 p-3">
              <div className="flex items-start justify-between gap-2">
                <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700">Selected date</p><h2 className="mt-1 text-lg font-bold text-slate-950">{selected.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</h2></div>
                {selectedDate === dateKey(new Date()) && <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-800">Today</Badge>}
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="flex items-center justify-between text-xs"><span className="text-slate-500">Scheduled activities</span><strong className="text-slate-900">{selectedEntries.length}</strong></div>
                <div className="mt-1 flex items-center justify-between text-xs"><span className="text-slate-500">Planned / recorded crop quantity</span><strong className="text-slate-900">{selectedEntries.filter(entry => entry.eventType === "harvest" || entry.eventType === "preharvest").reduce((sum, entry) => sum + (entry.actualQuantityKg ?? entry.expectedQuantityKg), 0).toLocaleString("en-IN")} kg</strong></div>
                <div className="mt-1 flex items-center justify-between text-xs"><span className="text-slate-500">Retail / B2B orders</span><strong className="text-slate-900">{selectedDayRetailCount} retail · {selectedDayB2BCount} B2B</strong></div>
                <div className="mt-1 flex items-center justify-between text-xs"><span className="text-slate-500">Order quantity scheduled</span><strong className="text-slate-900">{selectedDayOrderQuantity.toLocaleString("en-IN", { maximumFractionDigits: 2 })} kg</strong></div>
              </div>
              {selectedEntries.length ? selectedEntries.map(entry => (
                <div key={entry.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2"><p className="text-sm font-semibold text-slate-900">{entry.cropName}</p><Badge className={cn("border text-[10px]", statusMeta[entry.status]?.className)}>{statusMeta[entry.status]?.short}</Badge></div>
                  <p className="mt-1 text-xs text-slate-500">{entry.orderType || statusMeta[entry.status]?.label}</p>
                  {(entry.actualQuantityKg != null || entry.expectedQuantityKg > 0) && <p className="mt-1 text-xs text-slate-500">{entry.actualQuantityKg != null ? `Actual: ${entry.actualQuantityKg} kg` : `Expected / scheduled: ${entry.expectedQuantityKg} kg`}</p>}
                  {entry.preOrderCount > 0 && <p className="mt-1 text-xs text-blue-700">{entry.preOrderCount} pre-order(s) linked</p>}
                  {entry.batchId && <p className="mt-1 text-xs text-slate-500">Batch: {String(entry.batchId).slice(-8)} · {entry.qualityStatus === "approved" ? "Quality approved" : "Inspection pending"}</p>}
                  {(entry.eventType === "harvest" || entry.eventType === "preharvest") ? (
                    <div className="mt-3 space-y-2">
                      {entry.eventType === "preharvest" ? (
                        <Button type="button" className="w-full bg-emerald-700 text-white hover:bg-emerald-800" onClick={() => openHarvestForm(entry)}><Wheat className="mr-2 h-4 w-4" />Record harvested quantity</Button>
                      ) : !entry.batchId ? (
                        <Button type="button" className="w-full bg-emerald-700 text-white hover:bg-emerald-800" onClick={() => openBatchForm(entry)}><PackageCheck className="mr-2 h-4 w-4" />Create traceability batch</Button>
                      ) : entry.qualityStatus !== "approved" ? (
                        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"><FlaskConical className="mt-0.5 h-4 w-4 shrink-0" /><span><strong>Quality inspection queued</strong><br />Your batch was automatically added to the authorized warehouse / admin verification queue.</span></div>
                      ) : <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800"><CheckCircle2 className="h-4 w-4" />Quality approved</div>}
                      <Link href="/farmer/harvest-planner" className="inline-flex items-center text-xs font-semibold text-emerald-700 hover:text-emerald-800">Open full harvest plan <ArrowUpRight className="ml-1 h-3 w-3" /></Link>
                    </div>
                  ) : entry.id.startsWith("contract-") ? (
                    <Link href="/farmer/b2b/contracts" className="mt-3 inline-flex items-center text-xs font-semibold text-emerald-700 hover:text-emerald-800">View contract <ArrowUpRight className="ml-1 h-3 w-3" /></Link>
                  ) : entry.referenceId ? (
                    <div className="mt-3 space-y-2">
                      <Button asChild className="w-full bg-emerald-700 text-white hover:bg-emerald-800"><Link href={entry.id.startsWith("b2b-") ? "/farmer/orders/" + encodeURIComponent(entry.referenceId) + "?source=b2b" : "/farmer/orders/" + encodeURIComponent(entry.referenceId)}><ShoppingBag className="mr-2 h-4 w-4" />Open this order</Link></Button>
                      <p className="text-[11px] leading-4 text-slate-500">See the next available farmer action and order tracking. Warehouse and delivery teams complete their own steps.</p>
                    </div>
                  ) : null}
                </div>
              )) : <div className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center"><CalendarDays className="mx-auto h-6 w-6 text-slate-300" /><p className="mt-2 text-xs font-medium text-slate-600">No crop plan on this date</p><p className="mt-1 text-[11px] text-slate-400">Choose another date or add a harvest plan.</p></div>}
              <Button asChild className="w-full bg-emerald-700 text-white hover:bg-emerald-800"><Link href="/farmer/harvest-planner"><Plus className="mr-2 h-4 w-4" />Manage harvest plans</Link></Button>
            </CardContent>
          </Card>
          <details className="group rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-slate-800 [&::-webkit-details-marker]:hidden"><span>More planning information</span><span className="text-xs font-normal text-slate-500">Upcoming · demand · actions · alerts</span></summary>
            <div className="mt-3 space-y-3">


          <Card className="border-slate-200 shadow-sm">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between"><div><h3 className="text-sm font-bold text-slate-900">Upcoming schedule</h3><p className="text-[11px] text-slate-500">Orders, quantities, harvests and deliveries</p></div><Badge variant="outline">{allUpcomingEntries.length} activities</Badge></div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-[10px] font-medium text-slate-500">Upcoming orders</p><p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{upcomingOrderCount}</p><p className="text-[10px] text-slate-500">{upcomingPickupCount} pickups · {upcomingDeliveryCount} deliveries</p></div>
                <div className="rounded-lg border border-slate-200 bg-emerald-50/70 p-3"><p className="text-[10px] font-medium text-emerald-800">Quantity required</p><p className="mt-1 text-xl font-bold tabular-nums text-emerald-900">{upcomingOrderQuantityKg.toLocaleString("en-IN", { maximumFractionDigits: 2 })} kg</p><p className="text-[10px] text-emerald-800">Across upcoming orders</p></div>
              </div>
              {topUpcomingProducts.length > 0 && <div className="space-y-2"><p className="text-xs font-semibold text-slate-700">Quantity by product</p>{topUpcomingProducts.slice(0, 4).map(([name, quantity]) => <div key={name} className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-slate-600">{name}</span><span className="shrink-0 font-semibold text-slate-800">{quantity.toLocaleString("en-IN", { maximumFractionDigits: 2 })} kg</span></div>)}</div>}
              <div className="border-t border-slate-100 pt-2"><p className="mb-2 text-xs font-semibold text-slate-700">Next activities</p></div>
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
              <div className="flex items-center justify-between gap-2">
                <div><h3 className="text-sm font-bold text-slate-900">Supply versus demand</h3><p className="text-[11px] text-slate-500">Upcoming order needs compared with recorded harvest</p></div>
                <Badge variant="outline">Planning view</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-slate-50 p-3"><p className="text-[10px] text-slate-500">Upcoming demand</p><p className="text-lg font-bold text-slate-900">{inventoryLoading ? "…" : `${upcomingOrderQuantityKg.toLocaleString("en-IN", { maximumFractionDigits: 2 })} kg`}</p><p className="text-[10px] text-slate-500">Scheduled orders and contracts</p></div>
                <div className="rounded-lg bg-amber-50 p-3"><p className="text-[10px] text-amber-800">Harvest planning gap</p><p className="text-lg font-bold text-amber-900">{inventoryLoading ? "…" : `${totalHarvestPlanGapKg.toLocaleString("en-IN", { maximumFractionDigits: 2 })} kg`}</p><p className="text-[10px] text-amber-800">Demand minus recorded harvest</p></div>
              </div>
              {supplyDemandRows.length ? <div className="space-y-2">{supplyDemandRows.slice(0, 5).map(row => <div key={row.name} className="space-y-1"><div className="flex items-center justify-between gap-2 text-xs"><span className="truncate font-medium text-slate-700">{row.name}</span><span className="shrink-0 text-slate-600">{`${row.harvested.toLocaleString("en-IN")} kg harvested`} / {row.required.toLocaleString("en-IN")} kg needed</span></div>{<div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: row.required > 0 ? Math.min(100, row.harvested / row.required * 100) + "%" : "0%" }} /></div>}{row.gap != null && row.gap > 0 && <p className="text-[10px] text-amber-700">{row.gap.toLocaleString("en-IN")} kg shortage against current available stock</p>}</div>)}</div> : <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">No upcoming order quantities to compare yet.</p>}
              {inventoryError ? <p className="text-[10px] text-rose-700">Live inventory could not be loaded. Refresh or open Inventory Health to verify stock.</p> : <p className="text-[10px] leading-4 text-slate-500">This is a harvest-planning comparison, not live sellable inventory. It compares recorded harvested quantities with scheduled demand. Reservations, quality holds and available stock are managed separately by Inventory.</p>}
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-2"><div><h3 className="text-sm font-bold text-slate-900">Farmer action centre</h3><p className="text-[11px] text-slate-500">Only actions that require farmer attention</p></div><Badge variant="outline">{farmerActionCount + ordersAwaitingPreparation.length + ordersReadyForPickup.length + missedContractOccurrences} tasks</Badge></div>
              {overdueHarvestPlans.length > 0 && <Link href="/farmer/harvest-planner" className="block rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-900"><strong>{overdueHarvestPlans.length} overdue harvest plan(s)</strong><span className="block text-rose-800">Record harvest or revise the expected date.</span></Link>}
              {soonHarvestPlans.length > 0 && <Link href="/farmer/harvest-planner" className="block rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900"><strong>{soonHarvestPlans.length} harvest plan(s) due within 3 days</strong><span className="block text-amber-800">Check crop readiness and prepare for harvest.</span></Link>}
              {batchesAwaitingInspection.length > 0 && <Link href="/farmer/batches" className="block rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-900"><strong>{batchesAwaitingInspection.length} batch(es) awaiting quality status</strong><span className="block text-blue-800">Review inspection progress.</span></Link>}
              {ordersAwaitingPreparation.length > 0 && <Link href="/farmer/b2b/contracts#preparation" className="block rounded-lg border border-orange-200 bg-orange-50 p-2.5 text-xs text-orange-900"><strong>{ordersAwaitingPreparation.length} B2B order(s) need preparation</strong><span className="block text-orange-800">Prepare, pack and complete quality checks.</span></Link>}
              {ordersReadyForPickup.length > 0 && <Link href="/farmer/orders" className="block rounded-lg border border-sky-200 bg-sky-50 p-2.5 text-xs text-sky-900"><strong>{ordersReadyForPickup.length} order(s) ready for farm pickup</strong><span className="block text-sky-800">Keep packed produce ready for collection.</span></Link>}
              {contractsDueSoon.length > 0 && <Link href="/farmer/b2b/contracts" className="block rounded-lg border border-violet-200 bg-violet-50 p-2.5 text-xs text-violet-900"><strong>{contractsDueSoon.length} contract(s) due within 3 days</strong><span className="block text-violet-800">Confirm stock for the next occurrence.</span></Link>}
              {farmerActionCount + ordersAwaitingPreparation.length + ordersReadyForPickup.length === 0 && <p className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">No farmer actions are currently due in the records loaded.</p>}
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-2"><div><h3 className="text-sm font-bold text-slate-900">Recurring contract progress</h3><p className="text-[11px] text-slate-500">Based on saved delivery history</p></div><Badge variant="outline">{contractProgress.length} active</Badge></div>
              {contractProgress.length ? contractProgress.map(item => <div key={item.id} className="space-y-1.5 rounded-lg border border-slate-200 p-2.5">
                <div className="flex items-center justify-between gap-2"><strong className="truncate text-xs text-slate-800">{item.name}</strong><span className="shrink-0 text-[10px] text-slate-500">{item.completionPct == null ? "Progress unavailable" : item.completionPct.toFixed(0)+"%"}</span></div>
                {item.completionPct != null && <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-600" style={{width:item.completionPct+"%"}} /></div>}
                <p className="text-[10px] text-slate-600">{item.suppliedKg.toLocaleString("en-IN")} kg supplied · {item.remainingKg == null ? "Remaining quantity unavailable" : item.remainingKg.toLocaleString("en-IN")+" kg remaining"}</p>
                <p className="text-[10px] text-slate-500">{item.completedCount} completed of {item.occurrenceCount} recorded occurrences</p>
                {item.missed.length > 0 && <p className="text-[10px] font-semibold text-rose-700">{item.missed.length} past occurrence(s) not marked completed</p>}
              </div>) : <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">No active recurring contracts.</p>}
              <p className="text-[10px] leading-4 text-slate-500">Completion is calculated only from delivery-history entries with completed statuses and recorded quantities. A contract total is shown only when its monthly commitment and duration are available.</p>
              <Link href="/farmer/b2b/contracts" className="inline-flex items-center text-xs font-semibold text-emerald-700 hover:underline">Manage contracts <ArrowUpRight className="ml-1 h-3 w-3" /></Link>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-2"><div><h3 className="text-sm font-bold text-slate-900">Smart alerts</h3><p className="text-[11px] text-slate-500">Exceptions from live farmer records</p></div><Badge variant="outline">{smartAlertCount} alerts</Badge></div>
              {inventoryShortageRows.slice(0,4).map(row => <div key={"gap-"+row.name} className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900"><strong>{row.name}: {row.gap?.toLocaleString("en-IN")} kg demand gap</strong><span className="block text-amber-800">Compare upcoming demand with current available inventory.</span></div>)}
              {overdueContracts.length > 0 && <Link href="/farmer/b2b/contracts" className="block rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-900"><strong>{overdueContracts.length} contract(s) have a past scheduled date</strong><span className="block text-rose-800">Review occurrence status and shortage resolution.</span></Link>}
              {missedContractOccurrences > 0 && <Link href="/farmer/b2b/contracts" className="block rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-900"><strong>{missedContractOccurrences} recurring occurrence(s) are past due</strong><span className="block text-rose-800">Check the delivery history and update the occurrence.</span></Link>}
              {ordersAwaitingPreparation.length > 0 && <Link href="/farmer/b2b/contracts#preparation" className="block rounded-lg border border-orange-200 bg-orange-50 p-2.5 text-xs text-orange-900"><strong>{ordersAwaitingPreparation.length} order(s) need preparation or quality action</strong></Link>}
              {ordersReadyForPickup.length > 0 && <Link href="/farmer/orders" className="block rounded-lg border border-sky-200 bg-sky-50 p-2.5 text-xs text-sky-900"><strong>{ordersReadyForPickup.length} order(s) are ready for pickup</strong></Link>}
              {overdueHarvestPlans.length > 0 && <Link href="/farmer/harvest-planner" className="block rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-900"><strong>{overdueHarvestPlans.length} harvest plan(s) are overdue</strong></Link>}
              {smartAlertCount === 0 && <p className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">No exceptions detected in the records currently loaded.</p>}
              <p className="text-[10px] leading-4 text-slate-500">Alerts are reminders; this calendar does not automatically change stock, orders or contract states.</p>
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
        
            </div>
          </details>
        </aside>
      </section>

      {harvestEntry && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="supply-harvest-title">
          <form onSubmit={submitHarvest} className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div><h2 id="supply-harvest-title" className="text-lg font-bold text-slate-900">Record harvest</h2><p className="mt-1 text-sm text-slate-500">{harvestEntry.cropName} · Expected {harvestEntry.expectedQuantityKg} kg</p></div>
              <button type="button" onClick={() => setHarvestEntry(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <label className="block space-y-1 text-sm font-medium text-slate-700">Actual harvested quantity (kg)
              <input required min="0.01" step="0.01" type="number" value={harvestQuantity} onChange={event => setHarvestQuantity(event.target.value)} className="h-11 w-full rounded-lg border border-slate-300 px-3" />
            </label>
            <label className="block space-y-1 text-sm font-medium text-slate-700">Final selling price per kg (₹)
              <input required min="0.01" step="0.01" type="number" value={harvestRate} onChange={event => setHarvestRate(event.target.value)} className="h-11 w-full rounded-lg border border-slate-300 px-3" />
            </label>
            <p className="rounded-lg bg-blue-50 p-3 text-xs text-blue-800">After saving, create a traceability batch for this harvest.</p>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setHarvestEntry(null)}>Cancel</Button><Button type="submit" disabled={harvestMutation.isPending} className="bg-emerald-700 text-white">{harvestMutation.isPending ? "Saving..." : "Save harvest"}</Button></div>
          </form>
        </div>
      )}
      {batchEntry && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="supply-batch-title">
          <form onSubmit={submitBatch} className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3"><div><h2 id="supply-batch-title" className="text-lg font-bold text-slate-900">Create traceability batch</h2><p className="mt-1 text-sm text-slate-500">{batchEntry.cropName} · {batchEntry.actualQuantityKg ?? batchEntry.expectedQuantityKg} kg</p></div><button type="button" onClick={() => setBatchEntry(null)} className="rounded-lg p-2 text-slate-500" aria-label="Close"><X className="h-5 w-5" /></button></div>
            <label className="block space-y-1 text-sm font-medium text-slate-700">Quality grade<select value={batchGrade} onChange={event => setBatchGrade(event.target.value)} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3"><option>Premium</option><option>Standard</option><option>Economy</option></select></label>
            <label className="block space-y-1 text-sm font-medium text-slate-700">Storage method<select value={batchStorage} onChange={event => setBatchStorage(event.target.value)} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3"><option value="normal">Normal / ambient</option><option value="cold_storage">Cold storage</option><option value="refrigerated">Refrigerated</option><option value="frozen">Frozen</option></select></label>
            <label className="block space-y-1 text-sm font-medium text-slate-700">Shelf life (days)<input required min="1" max="90" type="number" value={batchShelfLife} onChange={event => setBatchShelfLife(event.target.value)} className="h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
            <p className="rounded-lg bg-blue-50 p-3 text-xs text-blue-800">The batch receives a traceability lot number. An authorized verifier completes quality approval.</p>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setBatchEntry(null)}>Cancel</Button><Button type="submit" disabled={batchMutation.isPending} className="bg-emerald-700 text-white">{batchMutation.isPending ? "Creating..." : "Create batch"}</Button></div>
          </form>
        </div>
      )}
    </div>
  );
}


export default function FarmerSupplyCalendarPage() {
  return <FarmerSupplyCalendarContent />;
}
