"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sprout,
  Plus,
  CalendarDays,
  Wheat,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Filter,
  List,
  CalendarRange,
} from "lucide-react";
import { api } from "../../../lib/api/client";
import { FarmerPageHeader } from "../../../components/farmer/farmer-page-header";
import { formatDate, formatPrice, cn } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import { LocationPicker, LocationValue } from "../../../components/farmer/location-picker";
import toast from "react-hot-toast";

interface HarvestPlan {
  id: string;
  cropName: string;
  expectedHarvestDate: string;
  expectedQuantityKg: number;
  preOrderPricePerKg?: number;
  status: string;
  preorderCount?: number;
  notifyCount?: number;
  notes?: string;
  productCreated?: boolean;
} 
type CalendarView = "month" | "week" | "list";

function parseHarvestDate(value: string): Date {
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(value);
}

function atLocalDayStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function localDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return localDayKey(a) === localDayKey(b);
}

function startOfCalendarWeek(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() - result.getDay());
  return result;
}

function harvestEventClass(plan: HarvestPlan, today: Date): string {
  if (plan.status === "cancelled") return "border-slate-200 bg-slate-100 text-slate-600";
  if (plan.status === "harvested" || plan.productCreated) return "border-violet-200 bg-violet-50 text-violet-800";
  if (plan.status === "preorder") return "border-blue-200 bg-blue-50 text-blue-800";
  if (atLocalDayStart(parseHarvestDate(plan.expectedHarvestDate)) <= today) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  return "border-emerald-100 bg-emerald-50/60 text-emerald-800";
}


export default function FarmerHarvestsPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [location, setLocation] = useState<LocationValue | null>(null);
  const [form, setForm] = useState({
    cropName: "",
    expectedHarvestDate: "",
    expectedQuantityKg: "100",
    preOrderPricePerKg: "",
    preOrderEnabled: true,
    notes: "",
  });
  const [calendarView, setCalendarView] = useState<CalendarView>("month");
  const [currentMonth, setCurrentMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [cropFilter, setCropFilter] = useState("all");

  const { data: plansData, isLoading } = useQuery({
    queryKey: ["farmerHarvests"],
    queryFn: () => api.get("/harvests/farmer/plans", { params: { source: "calendar" } }),
  });

  const createMutation = useMutation({
    mutationFn: (payload: any) => api.post("/harvests/plans", { ...payload, source: "calendar" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farmerHarvests"] });
      setShowForm(false);
      setLocation(null);
      setForm({
        cropName: "",
        expectedHarvestDate: "",
        expectedQuantityKg: "100",
        preOrderPricePerKg: "",
        preOrderEnabled: true,
        notes: "",
      });
      toast.success("Harvest plan created!");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to create plan"),
  });

  const harvestMutation = useMutation({
    mutationFn: ({ planId, actualQuantityKg }: { planId: string; actualQuantityKg: number }) =>
      api.post(`/harvests/plans/${planId}/harvest`, { actualQuantityKg }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["farmerHarvests"] });
      queryClient.invalidateQueries({ queryKey: ["farmerHarvestPlans"] });
      queryClient.invalidateQueries({ queryKey: ["farmerHarvestBatches"] });
      queryClient.invalidateQueries({ queryKey: ["farmerHarvestedForBatches"] });
      router.push("/farmer/batches");
      toast.success(`Harvest marked at ${vars.actualQuantityKg} kg. Create its batch for traceability.`);
    },
    onError: (err: any) => toast.error(err?.message || "Failed to mark harvest"),
  });

  const cancelMutation = useMutation({
    mutationFn: (planId: string) => api.post(`/harvests/plans/${planId}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farmerHarvests"] });
      toast.success("Harvest plan cancelled");
    },
  });

  const plans: HarvestPlan[] = (plansData?.data?.plans || []).map((p: any) => ({ ...p, id: p._id || p.id }));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cropNames = Array.from(new Set(plans.map((plan) => plan.cropName).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const filteredPlans = plans.filter((plan) => cropFilter === "all" || plan.cropName === cropFilter);
  const activePlans = filteredPlans.filter((plan) => plan.status !== "cancelled" && plan.status !== "harvested" && !plan.productCreated);
  const thisWeekStart = startOfCalendarWeek(today);
  const thisWeekEnd = new Date(thisWeekStart);
  thisWeekEnd.setDate(thisWeekEnd.getDate() + 7);
  const weekPlans = filteredPlans.filter((plan) => {
    const date = parseHarvestDate(plan.expectedHarvestDate);
    return date >= thisWeekStart && date < thisWeekEnd && plan.status !== "cancelled";
  });
  const monthPlans = filteredPlans.filter((plan) => {
    const date = parseHarvestDate(plan.expectedHarvestDate);
    return date.getFullYear() === currentMonth.getFullYear()
      && date.getMonth() === currentMonth.getMonth()
      && plan.status !== "cancelled";
  });
  const readyPlans = filteredPlans.filter((plan) => {
    const date = parseHarvestDate(plan.expectedHarvestDate);
    return date <= today && plan.status !== "cancelled" && plan.status !== "harvested" && !plan.productCreated;
  });
  const selectedDayPlans = filteredPlans
    .filter((plan) => sameCalendarDay(parseHarvestDate(plan.expectedHarvestDate), selectedDate) && plan.status !== "cancelled")
    .sort((a, b) => parseHarvestDate(a.expectedHarvestDate).getTime() - parseHarvestDate(b.expectedHarvestDate).getTime());
  const todayPlans = filteredPlans.filter((plan) => sameCalendarDay(parseHarvestDate(plan.expectedHarvestDate), today) && plan.status !== "cancelled");
  const upcomingPlans = filteredPlans
    .filter((plan) => parseHarvestDate(plan.expectedHarvestDate) >= today && plan.status !== "cancelled" && !sameCalendarDay(parseHarvestDate(plan.expectedHarvestDate), today))
    .sort((a, b) => parseHarvestDate(a.expectedHarvestDate).getTime() - parseHarvestDate(b.expectedHarvestDate).getTime())
    .slice(0, 5);
  const monthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
  const calendarStart = calendarView === "week" ? startOfCalendarWeek(selectedDate) : startOfCalendarWeek(monthStart);
  const calendarDayCount = calendarView === "week" ? 7 : 42;
  const calendarDays = Array.from({ length: calendarDayCount }, (_, index) => {
    const date = new Date(calendarStart);
    date.setDate(calendarStart.getDate() + index);
    return date;
  });
  const monthTitle = currentMonth.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const selectedDateLabel = selectedDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });


  const statusBadge = (s: string) => {
    if (s === "harvested") return <Badge variant="success">Harvested</Badge>;
    if (s === "cancelled") return <Badge variant="destructive">Cancelled</Badge>;
    if (s === "preorder") return <Badge variant="outline">Pre-order open</Badge>;
    return <Badge variant="secondary">Planned</Badge>;
  };

  return (
    <div className="w-full min-w-0 space-y-5 pb-8">
      <FarmerPageHeader
        eyebrow="Farm operations"
        title="Harvest Calendar"
        description="Plan, track and manage crop harvest dates, expected quantities and market availability."
      >
        <Button
          className="h-10 bg-emerald-700 shadow-sm hover:bg-emerald-800"
          onClick={() => setShowForm((value) => !value)}
        >
          {showForm ? <XCircle className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
          {showForm ? "Close form" : "Add Harvest Plan"}
        </Button>
      </FarmerPageHeader>

      {showForm && (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/60">
            <CardTitle className="text-base font-semibold text-slate-900">New Harvest Plan</CardTitle>
            <CardDescription>Customers will see this and can pre-order before harvest.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Crop name *</label>
              <Input
                value={form.cropName}
                onChange={(e) => setForm({ ...form, cropName: e.target.value })}
                placeholder="e.g. Tomato"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Expected harvest date *</label>
              <Input
                type="date"
                value={form.expectedHarvestDate}
                onChange={(e) => setForm({ ...form, expectedHarvestDate: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Expected quantity (kg) *</label>
              <Input
                type="number"
                min={1}
                value={form.expectedQuantityKg}
                onChange={(e) => setForm({ ...form, expectedQuantityKg: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Pre-order price (₹/kg)</label>
              <Input
                type="number"
                min={0}
                value={form.preOrderPricePerKg}
                onChange={(e) => setForm({ ...form, preOrderPricePerKg: e.target.value })}
                placeholder="e.g. 42"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-medium text-gray-500">Notes (optional)</label>
              <Input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="e.g. Organically grown, harvested early morning"
              />
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <input
                type="checkbox"
                id="preorderToggle"
                checked={form.preOrderEnabled}
                onChange={(e) => setForm({ ...form, preOrderEnabled: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-emerald-600"
              />
              <label htmlFor="preorderToggle" className="text-sm text-gray-600">
                Accept pre-orders (requires a price)
              </label>
            </div>
            <div className="sm:col-span-2">
              <LocationPicker value={location} onChange={setLocation} />
            </div>
            <div className="sm:col-span-2">
              <Button
                className="w-full sm:w-auto"
                disabled={!form.cropName || !form.expectedHarvestDate || createMutation.isPending}
                onClick={() =>
                  createMutation.mutate({
                    cropName: form.cropName,
                    expectedHarvestDate: new Date(form.expectedHarvestDate).toISOString(),
                    expectedQuantityKg: Number(form.expectedQuantityKg),
                    preOrderPricePerKg: form.preOrderPricePerKg ? Number(form.preOrderPricePerKg) : null,
                    preOrderEnabled: form.preOrderEnabled,
                    notes: form.notes || null,
                    location: location
                      ? {
                          type: "Point",
                          coordinates: [location.lng, location.lat],
                          address: location.address,
                        }
                      : null,
                  })
                }
              >
                {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Create Plan
              </Button>
            </div>
          </CardContent>
        </Card>
      )}


      {isLoading ? (
        <div className="space-y-4" aria-label="Loading harvest calendar">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {[0, 1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white" />)}
          </div>
          <div className="h-[560px] animate-pulse rounded-2xl border border-slate-200 bg-white" />
        </div>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {[
              { label: "Active crop plans", value: activePlans.length, detail: "Not yet harvested", icon: Sprout, tone: "bg-emerald-50 text-emerald-700" },
              { label: "Harvests this week", value: weekPlans.length, detail: `${weekPlans.reduce((sum, plan) => sum + Number(plan.expectedQuantityKg || 0), 0)} kg expected`, icon: CalendarDays, tone: "bg-blue-50 text-blue-700" },
              { label: "Harvests this month", value: monthPlans.length, detail: `${monthPlans.reduce((sum, plan) => sum + Number(plan.expectedQuantityKg || 0), 0)} kg expected`, icon: Wheat, tone: "bg-violet-50 text-violet-700" },
              { label: "Ready to harvest", value: readyPlans.length, detail: `${readyPlans.reduce((sum, plan) => sum + Number(plan.expectedQuantityKg || 0), 0)} kg expected`, icon: CheckCircle2, tone: "bg-amber-50 text-amber-700" },
            ].map((stat) => (
              <Card key={stat.label} className="border-slate-200 shadow-sm">
                <CardContent className="flex items-center justify-between gap-3 p-4 sm:p-5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-500">{stat.label}</p>
                    <p className="mt-1 text-2xl font-bold tracking-tight text-slate-950">{stat.value}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{stat.detail}</p>
                  </div>
                  <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", stat.tone)}>
                    <stat.icon className="h-5 w-5" />
                  </span>
                </CardContent>
              </Card>
            ))}
          </section>

          <div className="grid min-w-0 items-start gap-4 2xl:grid-cols-[minmax(0,1.75fr)_minmax(300px,0.75fr)]">
            <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="flex min-w-0 items-center gap-2">
                  <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label="Previous month or week" onClick={() => {
                    if (calendarView === "week") {
                      const next = new Date(selectedDate);
                      next.setDate(next.getDate() - 7);
                      setSelectedDate(next);
                      setCurrentMonth(new Date(next.getFullYear(), next.getMonth(), 1));
                    } else {
                      setCurrentMonth((value) => new Date(value.getFullYear(), value.getMonth() - 1, 1));
                      setSelectedDate((value) => new Date(value.getFullYear(), value.getMonth() - 1, 1));
                    }
                  }}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-bold tracking-tight text-slate-950">{calendarView === "week" ? `Week of ${selectedDateLabel}` : monthTitle}</h2>
                    <p className="text-xs text-slate-500">{filteredPlans.length} harvest plan{filteredPlans.length === 1 ? "" : "s"} in your calendar</p>
                  </div>
                  <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label="Next month or week" onClick={() => {
                    if (calendarView === "week") {
                      const next = new Date(selectedDate);
                      next.setDate(next.getDate() + 7);
                      setSelectedDate(next);
                      setCurrentMonth(new Date(next.getFullYear(), next.getMonth(), 1));
                    } else {
                      setCurrentMonth((value) => new Date(value.getFullYear(), value.getMonth() + 1, 1));
                      setSelectedDate((value) => new Date(value.getFullYear(), value.getMonth() + 1, 1));
                    }
                  }}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="ml-1 h-9 shrink-0 text-emerald-800" onClick={() => {
                    const now = new Date();
                    setSelectedDate(now);
                    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
                  }}>Today</Button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                    {(["month", "week", "list"] as const).map((view) => (
                      <button
                        key={view}
                        type="button"
                        aria-pressed={calendarView === view}
                        onClick={() => setCalendarView(view)}
                        className={cn(
                          "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold capitalize transition-colors",
                          calendarView === view ? "bg-emerald-700 text-white shadow-sm" : "text-slate-600 hover:bg-white"
                        )}
                      >
                        {view === "list" ? <List className="h-3.5 w-3.5" /> : <CalendarRange className="h-3.5 w-3.5" />}
                        {view}
                      </button>
                    ))}
                  </div>
                  <div className="relative">
                    <select
                      aria-label="Filter harvest calendar by crop"
                      value={cropFilter}
                      onChange={(event) => setCropFilter(event.target.value)}
                      className="h-10 max-w-[160px] appearance-none rounded-lg border border-slate-200 bg-white pl-9 pr-8 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    >
                      <option value="all">All Crops</option>
                      {cropNames.map((crop) => <option key={crop} value={crop}>{crop}</option>)}
                    </select>
                    <Filter className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  </div>
                </div>
              </div>

              {calendarView === "list" ? (
                <div className="space-y-3 p-4 sm:p-5">
                  {monthPlans.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-12 text-center">
                      <CalendarDays className="mx-auto h-8 w-8 text-slate-300" />
                      <p className="mt-3 text-sm font-semibold text-slate-800">No harvests planned for {monthTitle}</p>
                      <p className="mt-1 text-xs text-slate-500">Choose another month or add a harvest plan.</p>
                    </div>
                  ) : monthPlans
                    .slice()
                    .sort((a, b) => parseHarvestDate(a.expectedHarvestDate).getTime() - parseHarvestDate(b.expectedHarvestDate).getTime())
                    .map((plan) => (
                      <button key={plan.id} type="button" onClick={() => setSelectedDate(parseHarvestDate(plan.expectedHarvestDate))} className="flex w-full flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-50/30 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg bg-emerald-50 text-emerald-800">
                            <span className="text-[10px] font-semibold uppercase">{parseHarvestDate(plan.expectedHarvestDate).toLocaleDateString("en-IN", { month: "short" })}</span>
                            <span className="text-lg font-bold leading-5">{parseHarvestDate(plan.expectedHarvestDate).getDate()}</span>
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{plan.cropName}</p>
                            <p className="mt-0.5 text-xs text-slate-500">{formatDate(plan.expectedHarvestDate)} · {plan.expectedQuantityKg} kg expected</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                          {statusBadge(plan.status)}
                          {plan.preorderCount ? <Badge variant="outline">{plan.preorderCount} pre-orders</Badge> : null}
                          <ChevronRight className="h-4 w-4 text-slate-400" />
                        </div>
                      </button>
                    ))}
                </div>
              ) : (
                <div className="p-3 sm:p-4">
                  <div className="grid grid-cols-7 border-b border-slate-200">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) => (
                      <div key={day} className={cn("py-2 text-center text-xs font-bold uppercase tracking-wide", index === 0 || index === 6 ? "text-emerald-700" : "text-slate-500")}>{day}</div>
                    ))}
                  </div>
                  <div className={cn("grid grid-cols-7 overflow-hidden rounded-b-xl border-l border-slate-200", calendarView === "week" ? "grid-rows-1" : "grid-rows-6")}>
                    {calendarDays.map((date) => {
                      const dayPlans = filteredPlans
                        .filter((plan) => sameCalendarDay(parseHarvestDate(plan.expectedHarvestDate), date) && plan.status !== "cancelled")
                        .sort((a, b) => parseHarvestDate(a.expectedHarvestDate).getTime() - parseHarvestDate(b.expectedHarvestDate).getTime());
                      const inCurrentMonth = date.getMonth() === currentMonth.getMonth();
                      const isToday = sameCalendarDay(date, today);
                      const isSelected = sameCalendarDay(date, selectedDate);
                      return (
                        <button
                          key={localDayKey(date)}
                          type="button"
                          onClick={() => {
                            setSelectedDate(date);
                            setCurrentMonth(new Date(date.getFullYear(), date.getMonth(), 1));
                          }}
                          className={cn(
                            "flex min-h-[104px] min-w-0 flex-col items-stretch gap-1 border-b border-r border-t-0 border-slate-200 p-1.5 text-left transition-colors sm:min-h-[124px] sm:p-2",
                            !inCurrentMonth && calendarView === "month" && "bg-slate-50/70",
                            isSelected && "bg-emerald-50/50 ring-2 ring-inset ring-emerald-600",
                            !isSelected && "hover:bg-emerald-50/40"
                          )}
                        >
                          <span className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                            isToday ? "bg-emerald-700 text-white" : inCurrentMonth ? "text-slate-800" : "text-slate-300"
                          )}>{date.getDate()}</span>
                          <div className="flex min-w-0 flex-col gap-1">
                            {dayPlans.slice(0, 2).map((plan) => (
                              <span key={plan.id} className={cn("block overflow-hidden rounded-md border px-1.5 py-1 text-[9px] font-semibold leading-3 sm:text-[10px] sm:leading-4", harvestEventClass(plan, today))}>
                                <span className="block truncate">{plan.cropName} Harvest</span>
                                <span className="block truncate opacity-80">{plan.expectedQuantityKg} kg</span>
                              </span>
                            ))}
                            {dayPlans.length > 2 ? <span className="px-1 text-[9px] font-semibold text-slate-500">+{dayPlans.length - 2} more</span> : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 px-4 py-3 text-[11px] font-medium text-slate-500 sm:px-5">
                {[
                  ["bg-emerald-500", "Planned / ready"],
                  ["bg-blue-500", "Pre-order open"],
                  ["bg-violet-500", "Harvested"],
                  ["bg-slate-400", "Cancelled"],
                ].map(([color, label]) => (
                  <span key={label} className="inline-flex items-center gap-1.5"><span className={cn("h-2.5 w-2.5 rounded-full", color)} />{label}</span>
                ))}
              </div>
            </section>

            <aside className="space-y-4">
              <Card className="overflow-hidden border-slate-200 shadow-sm">
                <CardHeader className="border-b border-slate-100 bg-slate-50/60 px-4 py-4">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CalendarDays className="h-4 w-4 text-emerald-700" />
                    {sameCalendarDay(selectedDate, today) ? "Today's Harvest" : "Harvests on selected date"}
                  </CardTitle>
                  <CardDescription>{selectedDateLabel}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 p-4">
                  {selectedDayPlans.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-3 py-7 text-center">
                      <Sprout className="mx-auto h-7 w-7 text-slate-300" />
                      <p className="mt-2 text-sm font-semibold text-slate-800">No harvests on this date</p>
                      <p className="mt-1 text-xs text-slate-500">Select a date with a crop event to see its details.</p>
                    </div>
                  ) : selectedDayPlans.map((plan) => (
                    <div key={plan.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-bold text-slate-900">{plan.cropName}</p>
                        {statusBadge(plan.status)}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-sm">
                        <span className="text-slate-500">Planned quantity</span>
                        <span className="font-bold text-slate-900">{plan.expectedQuantityKg} kg</span>
                      </div>
                      {plan.preOrderPricePerKg ? <p className="mt-1 text-xs text-emerald-700">{formatPrice(plan.preOrderPricePerKg)} / kg pre-order price</p> : null}
                      {plan.preorderCount ? <p className="mt-1 text-xs text-slate-500">{plan.preorderCount} pre-orders</p> : null}
                      {plan.notes ? <p className="mt-2 text-xs leading-5 text-slate-500">{plan.notes}</p> : null}
                      {!plan.productCreated && plan.status !== "harvested" && plan.status !== "cancelled" ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" disabled={harvestMutation.isPending} onClick={() => {
                            const value = window.prompt("Enter the actual harvested quantity (kg):", String(plan.expectedQuantityKg ?? ""));
                            if (value === null) return;
                            const actualQuantityKg = Number(value);
                            if (!Number.isFinite(actualQuantityKg) || actualQuantityKg <= 0) {
                              toast.error("Enter a valid harvested quantity greater than 0 kg");
                              return;
                            }
                            harvestMutation.mutate({ planId: plan.id, actualQuantityKg });
                          }}>
                            {harvestMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
                            Mark Harvested
                          </Button>
                          <Button size="sm" variant="outline" disabled={cancelMutation.isPending} onClick={() => cancelMutation.mutate(plan.id)}>Cancel Plan</Button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="overflow-hidden border-slate-200 shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-4">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base"><Clock3 className="h-4 w-4 text-emerald-700" />Upcoming Harvests</CardTitle>
                    <CardDescription>Next planned crop dates</CardDescription>
                  </div>
                  <Badge variant="outline">{upcomingPlans.length} upcoming</Badge>
                </CardHeader>
                <CardContent className="space-y-3 p-4">
                  {upcomingPlans.length === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-500">No upcoming harvest plans.</p>
                  ) : upcomingPlans.map((plan) => (
                    <button key={plan.id} type="button" className="flex w-full items-center gap-3 rounded-xl border border-slate-100 p-3 text-left transition-colors hover:border-emerald-200 hover:bg-emerald-50/30" onClick={() => {
                      const date = parseHarvestDate(plan.expectedHarvestDate);
                      setSelectedDate(date);
                      setCurrentMonth(new Date(date.getFullYear(), date.getMonth(), 1));
                      setCalendarView("month");
                    }}>
                      <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg bg-emerald-50 text-emerald-800">
                        <span className="text-[9px] font-semibold uppercase">{parseHarvestDate(plan.expectedHarvestDate).toLocaleDateString("en-IN", { month: "short" })}</span>
                        <span className="text-lg font-bold leading-5">{parseHarvestDate(plan.expectedHarvestDate).getDate()}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{plan.cropName}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{plan.expectedQuantityKg} kg expected</p>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                    </button>
                  ))}
                </CardContent>
              </Card>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}