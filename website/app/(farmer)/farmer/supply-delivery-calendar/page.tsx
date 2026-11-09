"use client";

import { useState } from "react";
import { CalendarDays, Sprout, Truck, Layers } from "lucide-react";
import { FarmerPageHeader } from "../../../components/farmer/farmer-page-header";
import { FarmerSupplyCalendarContent } from "../supply-calendar/page";
import { FarmerDeliveryCalendarContent } from "../delivery-calendar/page";
import { cn } from "../../../lib/utils";

type CalendarTab = "overview" | "supply" | "delivery";

export default function FarmerSupplyDeliveryCalendarPage() {
  const [activeTab, setActiveTab] = useState<CalendarTab>("overview");

  const tabs = [
    { id: "overview" as const, label: "Combined overview", description: "Supply + delivery", icon: Layers },
    { id: "supply" as const, label: "Supply calendar", description: "Harvest and supply workflow", icon: Sprout },
    { id: "delivery" as const, label: "Delivery calendar", description: "Customer and business deliveries", icon: Truck },
  ];

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 pb-8">
      <FarmerPageHeader
        eyebrow="Farm planning & logistics"
        title="Supply & Delivery Calendar"
        description="View your harvest supply plans and delivery commitments in one workspace. Each workflow keeps its own records and actions."
      />
      <section className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3" role="tablist" aria-label="Calendar sections">
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

      {activeTab === "overview" && (
        <section className="grid gap-4 xl:grid-cols-2">
          <button type="button" onClick={() => setActiveTab("supply")} className="group rounded-2xl border border-emerald-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-md">
            <div className="flex items-start justify-between gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Sprout className="h-5 w-5" /></span>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">Open supply</span>
            </div>
            <h2 className="mt-4 text-lg font-semibold text-slate-900">Supply calendar</h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-slate-500">Harvest plans, pre-harvest schedules, batch and quality progress, supply orders, recurring contracts, planning gaps and farmer action alerts.</p>
            <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700">View supply schedule <span aria-hidden="true">→</span></span>
          </button>
          <button type="button" onClick={() => setActiveTab("delivery")} className="group rounded-2xl border border-blue-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-md">
            <div className="flex items-start justify-between gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Truck className="h-5 w-5" /></span>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800">Open delivery</span>
            </div>
            <h2 className="mt-4 text-lg font-semibold text-slate-900">Delivery calendar</h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-slate-500">Customer and business delivery slots, self and partner assignments, route workload, distance, expected income, fuel estimates and optimized route actions.</p>
            <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-700">View delivery schedule <span aria-hidden="true">→</span></span>
          </button>
          <div className="xl:col-span-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            <Layers className="h-4 w-4 text-slate-500" />
            <span>One calendar workspace · two independent data sources · original actions and workflows preserved</span>
          </div>
        </section>
      )}

      {activeTab === "supply" && <FarmerSupplyCalendarContent />}
      {activeTab === "delivery" && <FarmerDeliveryCalendarContent />}
    </div>
  );
}
