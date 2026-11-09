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

type CalendarTab = "supply" | "delivery";
const toKey = (d: Date) => d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");

export default function FarmerSupplyDeliveryCalendarPage() {
  const [activeTab, setActiveTab] = useState<CalendarTab>("supply");
  const [selectedDate, setSelectedDate] = useState(toKey(new Date()));
  const [monthCursor, setMonthCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [eventFilter, setEventFilter] = useState("all");
  const { data: plansData } = useQuery({ queryKey: ["farmerSupplyCalendarFromHarvestPlans"], queryFn: () => api.get("/harvests/farmer/plans") });
  const { data: deliveryData } = useQuery({ queryKey: ["deliveryCalendar"], queryFn: () => api.get("/farmers/me/delivery-calendar") });
  const plans = plansData?.data?.plans || [];
  const deliverySlots = (deliveryData as any)?.slots || [];
  const supplyEvents = useMemo(() => plans.map((p: any) => ({ key: toKey(new Date(p.expectedHarvestDate || p.harvestDate || p.harvestedAt)), title: p.cropName || "Harvest", quantity: Number(p.expectedQuantityKg || p.actualQuantityKg || 0), kind: "supply" })).filter((e: any) => e.key !== "NaN-NaN-NaN"), [plans]);
  const deliveryEvents = useMemo(() => deliverySlots.map((slot: any) => ({ key: String(slot.dateKey || slot.date || "").slice(0,10), title: slot.timeSlot || "Delivery", quantity: Number(slot.count || 0), kind: "delivery" })), [deliverySlots]);
  const allEvents = [...supplyEvents, ...deliveryEvents];
  const firstDay = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
  const calendarCells = Array.from({ length: 42 }, (_, i) => new Date(monthCursor.getFullYear(), monthCursor.getMonth(), i - firstDay.getDay() + 1));
  const selectedSupplyEvents = allEvents.filter((e: any) => e.key === selectedDate && e.kind === "supply");
  const selectedDeliveryEvents = allEvents.filter((e: any) => e.key === selectedDate && e.kind === "delivery");

  const tabs = [
    { id: "supply" as const, label: "Supply Calendar", description: "Harvest plans and supply workflow", icon: Sprout },
    { id: "delivery" as const, label: "Delivery Calendar", description: "Customer and business deliveries", icon: Truck },
  ];

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 pb-8">
      <FarmerPageHeader
        eyebrow="Farm planning & logistics"
        title="Supply & Delivery Calendar"
        description="Switch between supply planning and delivery scheduling in one workspace. Each workflow keeps its own records and actions."
      />
      <section className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="tablist" aria-label="Calendar sections">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex min-w-0 items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                  selected
                    ? "border-emerald-700 bg-emerald-700 text-white shadow-sm"
                    : "border-transparent bg-slate-50 text-slate-700 hover:border-slate-200 hover:bg-slate-100"
                )}
              >
                <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", selected ? "bg-white/15" : "bg-white text-emerald-700")}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{tab.label}</span>
                  <span className={cn("mt-0.5 block truncate text-xs", selected ? "text-emerald-100" : "text-slate-500")}>{tab.description}</span>
                </span>
                {selected && <span className="ml-auto text-xs font-semibold">Selected</span>}
              </button>
            );
          })}
        </div>
      </section>

      {activeTab === "supply" && <FarmerSupplyCalendarContent />}
      {activeTab === "delivery" && <FarmerDeliveryCalendarContent />}
    </div>
  );
}
