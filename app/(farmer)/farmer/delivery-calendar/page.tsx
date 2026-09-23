"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Clock,
  MapPin,
  Truck,
  DollarSign,
  Package,
  Plus,
  X,
  Info,
  AlertTriangle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { cn, formatPrice } from "../../../lib/utils";
import { api } from "../../../lib/api/client";
import Link from "next/link";

type ViewMode = "month" | "week" | "day";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TIME_SLOTS = [
  { label: "Morning", period: "6-8 AM", icon: Clock, color: "bg-amber-50 border-amber-200 hover:bg-amber-100" },
  { label: "Mid-day", period: "8-10 AM", icon: Clock, color: "bg-sky-50 border-sky-200 hover:bg-sky-100" },
  { label: "Afternoon", period: "4-6 PM", icon: Clock, color: "bg-orange-50 border-orange-200 hover:bg-orange-100" },
];

function weekDates(weekOffset = 0) {
  const now = new Date();
  const mondayOffset = (now.getDay() + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - mondayOffset + weekOffset * 7);
  return Array.from({ length: DAYS.length }, (_, i) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    return date;
  });
}

function weekLabel(dates: Date[]) {
  const start = dates[0];
  const end = dates[dates.length - 1];
  const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return `${fmt(start)} – ${fmt(end)}`;
}

function dayName(date: Date) {
  return DAYS[(date.getDay() + 6) % 7];
}

function addDays(base: Date, days: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function daysFromToday(date: Date) {
  const a = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const b = new Date();
  const today = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((a.getTime() - today.getTime()) / 86400000);
}

function isToday(date: Date) {
  return daysFromToday(date) === 0;
}

function monthCells(monthOffset = 0): (Date | null)[] {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const leading = (first.getDay() + 6) % 7;
  const cells: (Date | null)[] = Array.from({ length: leading }, () => null);
  for (let d = 1; d <= lastDay; d++) {
    cells.push(new Date(first.getFullYear(), first.getMonth(), d));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function monthLabel(monthOffset = 0) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + monthOffset, 1).toLocaleDateString(
    "en-IN",
    { month: "long", year: "numeric" }
  );
}

function DeliveryRow({ d }: { d: any }) {
  const isPartner = d.assignment === "partner";
  return (
    <div className={cn("rounded-lg border p-3", isPartner && "border-blue-200 bg-blue-50/40")}>
      <div className="flex items-center justify-between">
        <p className="font-medium text-sm">
          {d.customerName}
          {isPartner && (
            <Badge variant="outline" className="ml-2 border-blue-400 px-1.5 py-0 text-[10px] text-blue-600">
              Partner
            </Badge>
          )}
        </p>
        <span className="text-xs text-gray-500">{d.distance} km</span>
      </div>
      <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
        <MapPin className="h-3 w-3 shrink-0" />
        {d.address}
        {d.items > 0 ? ` · ${d.items} items` : ""}
      </p>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {d.total != null && (
            <p className="text-xs font-medium text-gray-700">{formatPrice(d.total)}</p>
          )}
          {d.isCOD && (
            <Badge variant="warning" className="px-1.5 py-0 text-[10px]">COD</Badge>
          )}
        </div>
        <Badge
          variant={d.status === "ready_for_pickup" || d.status === "ready_for_delivery" ? "warning" : "secondary"}
          className="px-1.5 py-0 text-[10px]"
        >
          {(d.status || "").replace(/_/g, " ")}
        </Badge>
      </div>
    </div>
  );
}

export default function DeliveryCalendarPage() {
  const router = useRouter();
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const [dayOffset, setDayOffset] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState<{ day: string; time: string } | null>(null);
  const dates = weekDates(weekOffset);

  const { data: calendarData, isLoading } = useQuery({
    queryKey: ["deliveryCalendar", viewMode],
    queryFn: () => api.get("/farmers/me/delivery-calendar"),
  });

  const slots = (calendarData as any)?.slots ?? [];
  const summary = (calendarData as any)?.summary ?? {};

  const countForDate = (date: Date) =>
    slots
      .filter((s: any) => s.day === dayName(date))
      .reduce((sum: number, s: any) => sum + (s.count || 0), 0);

  const selectedDate = addDays(new Date(), dayOffset);
  const selectedDaySlots = TIME_SLOTS.map((slot) => ({
    ...slot,
    data: slots.find(
      (s: any) => s.day === dayName(selectedDate) && s.timeSlot === slot.label
    ),
  }));

  let periodLabel = "";
  let goPrev: () => void = () => {};
  let goNext: () => void = () => {};
  if (viewMode === "month") {
    periodLabel = monthLabel(monthOffset);
    goPrev = () => setMonthOffset((m) => m - 1);
    goNext = () => setMonthOffset((m) => m + 1);
  } else if (viewMode === "week") {
    periodLabel = `Week of ${weekLabel(dates)}`;
    goPrev = () => setWeekOffset((o) => o - 1);
    goNext = () => setWeekOffset((o) => o + 1);
  } else {
    periodLabel = selectedDate.toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    goPrev = () => setDayOffset((o) => o - 1);
    goNext = () => setDayOffset((o) => o + 1);
  }
  const offToday =
    (viewMode === "month" && monthOffset !== 0) ||
    ((viewMode === "week" || viewMode === "day") &&
      (viewMode === "week" ? weekOffset : dayOffset) !== 0);

  const selectedSlotData = selectedSlot
    ? slots.find(
        (s: any) => s.day === selectedSlot.day && s.timeSlot === selectedSlot.time
      )
    : null;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 animate-pulse rounded bg-gray-200" />
        <div className="h-32 animate-pulse rounded-lg bg-gray-200" />
        <div className="h-96 animate-pulse rounded-lg bg-gray-200" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Delivery Calendar</h1>
          <p className="text-gray-500">Manage your monthly, weekly and daily delivery schedule</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-1">
            {(["month", "week", "day"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors",
                  viewMode === mode
                    ? "bg-emerald-600 text-white"
                    : "hover:bg-gray-100"
                )}
              >
                {mode}
              </button>
            ))}
          </div>
          <Button asChild>
            <Link href="/farmer/delivery-schedule/new">
              <Plus className="mr-2 h-4 w-4" />
              Schedule Delivery
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr,320px]">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" onClick={goPrev}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{periodLabel}</h2>
              {offToday && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setWeekOffset(0);
                    setMonthOffset(0);
                    setDayOffset(0);
                  }}
                >
                  Today
                </Button>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={goNext}>
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>

          {viewMode === "week" && (
            <>
              {slots.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
                  <CalendarDays className="h-12 w-12 text-gray-300" />
                  <h3 className="mt-4 text-lg font-semibold text-gray-900">No deliveries scheduled</h3>
                  <p className="mt-2 text-sm text-gray-500">Schedule your first delivery to get started.</p>
                  <Button asChild className="mt-4">
                    <Link href="/farmer/delivery-schedule/new">
                      <Plus className="mr-2 h-4 w-4" />
                      Schedule Delivery
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <div className="grid min-w-[910px] grid-cols-7 gap-3">
                    {DAYS.map((day, dayIndex) => (
                      <div key={day} className="space-y-2">
                        <div
                          className={cn(
                            "rounded-lg p-3 text-center",
                            isToday(dates[dayIndex]) ? "bg-emerald-100" : "bg-gray-50"
                          )}
                        >
                          <p className="text-sm font-medium text-gray-900">{day}</p>
                          <p className="text-xs text-gray-500">
                            {dates[dayIndex].getDate()} {dates[dayIndex].toLocaleString("en-IN", { month: "short" })}
                          </p>
                        </div>
                        {TIME_SLOTS.map((slot) => {
                          const slotData = slots.find(
                            (s: any) => s.day === day && s.timeSlot === slot.label
                          );
                          const count = slotData?.count || 0;
                          const selfCt = slotData?.selfCount ?? count;
                          const partnerCt = slotData?.partnerCount ?? 0;
                          return (
                            <button
                              key={slot.label}
                              onClick={() => setSelectedSlot({ day, time: slot.label })}
                              className={cn(
                                "w-full rounded-lg border p-3 text-left transition-all",
                                count > 0
                                  ? slot.color
                                  : "border-dashed border-gray-200 bg-white hover:bg-gray-50",
                                selectedSlot?.day === day &&
                                  selectedSlot?.time === slot.label &&
                                  "ring-2 ring-emerald-500"
                              )}
                            >
                              <div className="flex items-center justify-between">
                                <slot.icon className="h-4 w-4 text-gray-500" />
                                {count > 0 && (
                                  <Badge
                                    variant={
                                      count >= 4
                                        ? "destructive"
                                        : count >= 2
                                        ? "warning"
                                        : "default"
                                    }
                                    className="px-1.5 py-0 text-xs"
                                  >
                                    {count}
                                  </Badge>
                                )}
                              </div>
                              <p className="mt-1 flex items-center gap-1 text-xs font-medium text-gray-700">
                                {slot.label}
                                {(slotData as any)?.overloaded && (
                                  <AlertTriangle className="h-3 w-3 text-red-500" />
                                )}
                              </p>
                              <p className="text-[10px] text-gray-400">{slot.period}</p>
                              {count > 0 && (
                                <p className="mt-1 text-[10px] font-medium text-emerald-600">
                                  {count} delivery{count > 1 ? "ies" : ""}
                                  {partnerCt > 0 ? ` (${selfCt}s · ${partnerCt}p)` : ""}
                                </p>
                              )}
                              {count === 0 && (
                                <p className="mt-1 text-[10px] text-gray-400">No slots</p>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedSlotData && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-base">
                        {selectedSlotData.day} · {selectedSlotData.timeSlot}
                      </CardTitle>
                      <CardDescription>
                        Delivery slot details
                      </CardDescription>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSelectedSlot(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <Badge variant="success" className="gap-1 text-xs">
                        <Truck className="h-3 w-3" /> Self {selectedSlotData.selfCount ?? selectedSlotData.deliveries?.filter((d: any) => d.assignment !== "partner").length ?? 0}
                      </Badge>
                      {(selectedSlotData.partnerCount ?? 0) > 0 && (
                        <Badge variant="outline" className="border-blue-400 text-xs text-blue-600">
                          Partner {selectedSlotData.partnerCount}
                        </Badge>
                      )}
                      {selectedSlotData.distanceKm != null && (
                        <Badge variant="secondary" className="text-xs">
                          {selectedSlotData.distanceKm} km
                        </Badge>
                      )}
                      {selectedSlotData.estimatedMinutes != null && (
                        <Badge variant="secondary" className="text-xs">
                          ~{Math.floor(selectedSlotData.estimatedMinutes / 60)}h {selectedSlotData.estimatedMinutes % 60}m
                        </Badge>
                      )}
                      {selectedSlotData.income != null && (
                        <Badge variant="default" className="text-xs">
                          {formatPrice(selectedSlotData.income)}
                        </Badge>
                      )}
                    </div>
                    {(selectedSlotData as any)?.overloaded && (
                      <p className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        High workload — your own share exceeds your delivery capacity for one run. Consider moving some
                        orders to another slot or opening them for partners.
                      </p>
                    )}
                    <div className="space-y-3">
                      {selectedSlotData.deliveries?.length > 0 ? (
                        selectedSlotData.deliveries.map((d: any, i: number) => (
                          <DeliveryRow key={i} d={d} />
                        ))
                      ) : (
                        <p className="text-sm text-gray-500">No deliveries in this slot</p>
                      )}
                      <Button size="sm" className="mt-2" onClick={() => router.push("/farmer/route")}>
                        <Truck className="mr-2 h-4 w-4" />
                        View Route
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {viewMode === "month" && (
            <Card>
              <CardContent className="p-4">
                <div className="grid grid-cols-7 gap-2">
                  {DAYS.map((d) => (
                    <div key={d} className="pb-1 text-center text-xs font-medium text-gray-500">
                      {d.slice(0, 3)}
                    </div>
                  ))}
                  {monthCells(monthOffset).map((date, i) => {
                    if (!date) return <div key={`pad-${i}`} />;
                    const count = countForDate(date);
                    const today = isToday(date);
                    return (
                      <button
                        key={date.toISOString()}
                        onClick={() => {
                          setDayOffset(daysFromToday(date));
                          setViewMode("day");
                        }}
                        title={`${date.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} — click for day view`}
                        className={cn(
                          "flex h-20 flex-col items-center rounded-lg border p-2 transition-colors",
                          count > 0
                            ? "border-emerald-200 bg-emerald-50 hover:bg-emerald-100"
                            : "border-dashed border-gray-200 bg-white hover:bg-gray-50",
                          today && "ring-2 ring-emerald-500"
                        )}
                      >
                        <span
                          className={cn(
                            "self-end text-sm",
                            today ? "font-bold text-emerald-600" : "text-gray-700"
                          )}
                        >
                          {date.getDate()}
                        </span>
                        {count > 0 && (
                          <>
                            <Badge
                              variant={
                                count >= 4 ? "destructive" : count >= 2 ? "warning" : "default"
                              }
                              className="mt-auto px-1.5 py-0 text-[10px]"
                            >
                              {count}
                            </Badge>
                            <span className="mt-0.5 text-[10px] text-emerald-700">
                              delivery{count > 1 ? "ies" : "y"}
                            </span>
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-3 flex items-center gap-1 text-xs text-gray-400">
                  <Info className="h-3 w-3" />
                  Counts repeat weekly based on each order's scheduled delivery day. Click a date
                  for its full day plan.
                </p>
              </CardContent>
            </Card>
          )}

          {viewMode === "day" && (
            <div className="space-y-4">
              {selectedDaySlots.every(({ data }) => !data) && (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
                  <CalendarDays className="h-12 w-12 text-gray-300" />
                  <h3 className="mt-4 text-lg font-semibold text-gray-900">No deliveries this day</h3>
                  <p className="mt-2 text-sm text-gray-500">
                    Orders with a matching delivery day will appear here.
                  </p>
                </div>
              )}
              {selectedDaySlots.map(({ label, period, color, icon: Icon, data }) => {
                const count = data?.count || 0;
                const selfCt = data?.selfCount ?? 0;
                const partnerCt = data?.partnerCount ?? 0;
                return (
                  <Card key={label} className={cn(count > 0 && color.split(" ").slice(0, 2).join(" "))}>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center justify-between text-base">
                        <span className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-gray-500" />
                          {label}
                          <span className="text-xs font-normal text-gray-400">{period}</span>
                        </span>
                        <Badge
                          variant={count >= 4 ? "destructive" : count >= 2 ? "warning" : "outline"}
                          className="px-1.5 py-0 text-xs"
                        >
                          {count} delivery{count === 1 ? "" : "ies"}
                        </Badge>
                      </CardTitle>
                      {data && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge variant="success" className="px-1.5 py-0 text-[10px]">Self {selfCt}</Badge>
                          {partnerCt > 0 && (
                            <Badge variant="outline" className="border-blue-400 px-1.5 py-0 text-[10px] text-blue-600">
                              Partner {partnerCt}
                            </Badge>
                          )}
                          {data.distanceKm != null && (
                            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{data.distanceKm} km</Badge>
                          )}
                          {data.estimatedMinutes != null && (
                            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                              ~{Math.floor(data.estimatedMinutes / 60)}h {data.estimatedMinutes % 60}m
                            </Badge>
                          )}
                          {data.income != null && (
                            <Badge variant="default" className="px-1.5 py-0 text-[10px]">{formatPrice(data.income)}</Badge>
                          )}
                          {data.overloaded && (
                            <Badge variant="destructive" className="gap-1 px-1.5 py-0 text-[10px]">
                              <AlertTriangle className="h-3 w-3" /> High workload
                            </Badge>
                          )}
                        </div>
                      )}
                    </CardHeader>
                    {data?.deliveries?.length > 0 && (
                      <CardContent className="space-y-3 pt-0">
                        {data.deliveries.map((d: any, i: number) => (
                          <DeliveryRow key={i} d={d} />
                        ))}
                      </CardContent>
                    )}
                  </Card>
                );
              })}
              <Button size="sm" onClick={() => router.push("/farmer/route")}>
                <Truck className="mr-2 h-4 w-4" />
                View Route
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Today's Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between border-b pb-3">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Truck className="h-4 w-4" />
                  Deliveries
                </div>
                <span className="font-semibold">
                  {summary.totalDeliveries || 0}
                </span>
              </div>
              <div className="flex items-center justify-between border-b pb-3">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <MapPin className="h-4 w-4" />
                  Distance
                </div>
                <span className="font-semibold">
                  {summary.totalDistance || "0 km"}
                </span>
              </div>
              <div className="flex items-center justify-between border-b pb-3">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <DollarSign className="h-4 w-4" />
                  Fuel Cost
                </div>
                <span className="font-semibold">
                  {formatPrice(summary.fuelCost || 0)}
                </span>
              </div>
              <div className="flex items-center justify-between border-b pb-3">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <DollarSign className="h-4 w-4" />
                  Expected Income
                </div>
                <span className="font-semibold text-emerald-600">
                  {formatPrice(summary.expectedIncome || 0)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Clock className="h-4 w-4" />
                  Est. Time
                </div>
                <span className="font-semibold">
                  {summary.estimatedTime || "0 hrs"}
                </span>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3">
            <Card className="bg-emerald-50 border-emerald-200">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-emerald-600">
                  {slots.reduce(
                    (sum: number, s: any) => sum + (s.count || 0),
                    0
                  ) || 0}
                </p>
                <p className="text-xs text-emerald-700">Weekly Deliveries</p>
              </CardContent>
            </Card>
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-blue-600">
                  {new Set(
                    slots.flatMap((s: any) => s.deliveries?.map((d: any) => d.customerName) || [])
                  ).size || 0}
                </p>
                <p className="text-xs text-blue-700">Unique Customers</p>
              </CardContent>
            </Card>
          </div>

          <Button asChild className="w-full">
            <Link href="/farmer/smart-route">
              <Truck className="mr-2 h-4 w-4" />
              View Optimized Route
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
