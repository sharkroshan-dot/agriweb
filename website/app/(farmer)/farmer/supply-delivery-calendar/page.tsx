"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sprout, Truck, ChevronLeft, ChevronRight } from "lucide-react";
import { FarmerPageHeader } from "../../../components/farmer/farmer-page-header";
import { FarmerSupplyCalendarContent } from "../supply-calendar/page";
import { FarmerDeliveryCalendarContent } from "../delivery-calendar/page";
import { cn } from "../../../lib/utils";
import { api } from "../../../lib/api/client";
import { Card, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";

const toKey = (d: Date) => d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");

export default function FarmerSupplyDeliveryCalendarPage() {
  const [selectedDate, setSelectedDate] = useState(toKey(new Date()));
  const [monthCursor, setMonthCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [eventFilter, setEventFilter] = useState("all");
  const [calendarView, setCalendarView] = useState("month");
  const { data: plansData } = useQuery({ queryKey: ["farmerSupplyCalendarFromHarvestPlans"], queryFn: () => api.get("/harvests/farmer/plans") });
  const { data: deliveryData } = useQuery({ queryKey: ["deliveryCalendar"], queryFn: () => api.get("/farmers/me/delivery-calendar") });
  const plans = plansData?.data?.plans || [];
  const deliverySlots = (deliveryData as any)?.slots || [];
  const supplyEvents = useMemo(() => plans.map((p: any) => ({ key: toKey(new Date(p.expectedHarvestDate || p.harvestDate || p.harvestedAt)), title: p.cropName || "Harvest", quantity: Number(p.expectedQuantityKg || p.actualQuantityKg || 0), kind: "supply" })).filter((e: any) => e.key !== "NaN-NaN-NaN"), [plans]);
  const deliveryEvents = useMemo(() => deliverySlots.map((slot: any) => ({ key: String(slot.dateKey || slot.date || "").slice(0,10), title: slot.timeSlot || "Delivery", quantity: Number(slot.count || 0), kind: "delivery" })), [deliverySlots]);
  const allEvents = [...supplyEvents, ...deliveryEvents];
  const firstDay = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
  const calendarCells = Array.from({ length: 42 }, (_, i) => new Date(monthCursor.getFullYear(), monthCursor.getMonth(), i - firstDay.getDay() + 1));
  const selectedDateObject = new Date(selectedDate + "T00:00:00");
  const weekStart = new Date(selectedDateObject);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekCells = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i));
  const visibleCalendarDays = calendarView === "month" ? calendarCells : calendarView === "week" ? weekCells : [selectedDateObject];
  const calendarTitle = calendarView === "month" ? monthCursor.toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : calendarView === "week" ? weekCells[0].toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + " – " + weekCells[6].toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : selectedDateObject.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const moveCalendar = (direction: number) => {
    if (calendarView === "month") { const next = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + direction, 1); setMonthCursor(next); setSelectedDate(toKey(next)); }
    else { const next = new Date(selectedDateObject); next.setDate(next.getDate() + direction * (calendarView === "week" ? 7 : 1)); setSelectedDate(toKey(next)); setMonthCursor(new Date(next.getFullYear(), next.getMonth(), 1)); }
  };
  const selectedSupplyEvents = allEvents.filter((e: any) => e.key === selectedDate && e.kind === "supply");
  const selectedDeliveryEvents = allEvents.filter((e: any) => e.key === selectedDate && e.kind === "delivery");

  const tabs = [
    { id: "supply" as const, label: "Supply Calendar", description: "Harvest plans and supply workflow", icon: Sprout },
    { id: "delivery" as const, label: "Delivery Calendar", description: "Customer and business deliveries", icon: Truck },
  ];

  return (
    <div className="mx-auto w-full max-w-none space-y-4 pb-8">
      <FarmerPageHeader
        eyebrow="Farm planning & logistics"
        title="Supply & Delivery Calendar"
        description="View supply and delivery commitments together, then manage each workflow in its own information panel."
      />
      <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => moveCalendar(-1)} aria-label="Previous period"><ChevronLeft className="h-4 w-4" /></Button>
              <h2 className="min-w-[190px] text-center text-lg font-semibold">{calendarTitle}</h2>
              <Button variant="outline" size="icon" onClick={() => moveCalendar(1)} aria-label="Next period"><ChevronRight className="h-4 w-4" /></Button>
              <Button variant="ghost" size="sm" onClick={() => { const today = new Date(); setMonthCursor(new Date(today.getFullYear(),today.getMonth(),1)); setSelectedDate(toKey(today)); }}>Today</Button>
              <div className="ml-1 flex rounded-lg border border-slate-200 bg-slate-50 p-1">{["month","week","day"].map((v) => <Button key={v} size="sm" variant={calendarView===v?"default":"ghost"} className={calendarView===v?"bg-emerald-700 text-white hover:bg-emerald-800":"capitalize"} onClick={() => setCalendarView(v)}>{v[0].toUpperCase()+v.slice(1)}</Button>)}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {["all","supply","delivery"].map((v) => <Button key={v} size="sm" variant={eventFilter===v?"default":"outline"} className={eventFilter===v?"bg-emerald-700 hover:bg-emerald-800":""} onClick={() => setEventFilter(v)}>{v==="all"?"All events":v==="supply"?"Supply only":"Delivery only"}</Button>)}
            </div>
          </div>
          <div className={cn("grid overflow-hidden rounded-xl border-l border-t border-slate-200", calendarView === "day" ? "grid-cols-1" : "grid-cols-7")}>
            {calendarView !== "day" && ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => <div key={d} className="border-b border-r border-slate-200 bg-slate-50 py-2 text-center text-xs font-semibold text-slate-600">{d}</div>)}
            {visibleCalendarDays.map((date) => {
              const key = toKey(date);
              const events = allEvents.filter((e) => e.key === key && (eventFilter === "all" || e.kind === eventFilter));
              return <button key={key} type="button" onClick={() => setSelectedDate(key)} className={cn("min-h-[100px] min-w-0 border-b border-r border-slate-200 bg-white p-2 text-left transition hover:bg-emerald-50 sm:min-h-[116px] sm:p-2.5", calendarView === "day" && "min-h-[220px] p-4", calendarView === "month" && date.getMonth() !== monthCursor.getMonth() && "bg-slate-50/70 text-slate-400", selectedDate === key && "bg-emerald-50 ring-2 ring-inset ring-emerald-600")}>
                <span className="text-xs font-semibold">{date.getDate()}</span>
                <div className="mt-1 space-y-1">{events.slice(0,2).map((e, i) => <span key={i} className={cn("block truncate rounded-md px-1.5 py-1 text-[10px] font-semibold leading-4 sm:text-[11px]", e.kind === "supply" ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800")}>{e.kind === "supply" ? "Supply" : "Delivery"} · {e.title}</span>)}{events.length > 2 && <span className="text-[9px] text-slate-500">+{events.length-2} more</span>}</div>
              </button>;
            })}
          </div>
          <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 pt-3 text-xs"><span className="font-semibold text-slate-600">Legend:</span><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Supply / harvest</span><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-blue-500" />Customer / business delivery</span><span className="text-slate-500">{allEvents.filter((e) => e.key === selectedDate).length} events on selected date</span></div>
        </CardContent>
      </Card>
      <div className="grid min-w-0 grid-cols-1 gap-5">
        <section className="min-w-0 space-y-4 rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Sprout className="h-5 w-5 text-emerald-700" /><div><h2 className="font-semibold text-slate-900">Supply Contract & Supply Information</h2><p className="text-xs text-slate-500">{selectedDate}</p></div></div></div>
          {selectedSupplyEvents.length ? selectedSupplyEvents.map((e, i) => <div key={i} className="flex items-center justify-between rounded-lg bg-emerald-50 p-3 text-sm"><span className="font-medium text-emerald-900">{e.title}</span><span className="text-emerald-800">{e.quantity} kg</span></div>) : <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">No supply events for this date.</p>}
          <FarmerSupplyCalendarContent compact selectedDate={selectedDate} />
        </section>
        <section className="min-w-0 space-y-4 rounded-2xl border border-blue-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Truck className="h-5 w-5 text-blue-700" /><div><h2 className="font-semibold text-slate-900">Delivery Calendar Information</h2><p className="text-xs text-slate-500">{selectedDate}</p></div></div></div>
          {selectedDeliveryEvents.length ? selectedDeliveryEvents.map((e, i) => <div key={i} className="flex items-center justify-between rounded-lg bg-blue-50 p-3 text-sm"><span className="font-medium text-blue-900">{e.title}</span><span className="text-blue-800">{e.quantity} deliveries</span></div>) : <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">No delivery events for this date.</p>}
          <FarmerDeliveryCalendarContent compact selectedDate={selectedDate} />
        </section>
      </div>
    </div>
  );
}
