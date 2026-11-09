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
        <div className="space-y-6">
          <section className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3">
            <div className="flex items-start gap-3">
              <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
              <div>
                <p className="text-sm font-semibold text-emerald-950">Combined calendar workspace</p>
                <p className="mt-1 text-xs leading-5 text-emerald-800">Both existing calendars are shown below. Supply records and delivery records remain independent; use the tabs above to focus on either workflow.</p>
              </div>
            </div>
          </section>
          <div className="space-y-3">
            <div className="flex items-center gap-2"><Sprout className="h-5 w-5 text-emerald-700" /><h2 className="text-lg font-semibold text-slate-900">Supply calendar</h2></div>
            <FarmerSupplyCalendarContent />
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-2"><Truck className="h-5 w-5 text-blue-700" /><h2 className="text-lg font-semibold text-slate-900">Delivery calendar</h2></div>
            <FarmerDeliveryCalendarContent />
          </div>
        </div>
      )}

      {activeTab === "supply" && <FarmerSupplyCalendarContent />}
      {activeTab === "delivery" && <FarmerDeliveryCalendarContent />}
    </div>
  );
}
