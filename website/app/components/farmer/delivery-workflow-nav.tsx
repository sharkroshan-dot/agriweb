"use client";

import { PrefetchLink as Link } from "../shared/prefetch-link";
import { CalendarDays, Map, Navigation, Route as RouteIcon } from "lucide-react";
import { cn } from "../../lib/utils";

type DeliveryWorkflowStep = "order-map" | "calendar" | "smart-route" | "route";

const steps = [
  { id: "order-map" as const, label: "Order Map", href: "/farmer/order-map", icon: Map },
  { id: "calendar" as const, label: "Delivery Calendar", href: "/farmer/delivery-calendar", icon: CalendarDays },
  { id: "smart-route" as const, label: "Smart Route", href: "/farmer/smart-route", icon: Navigation },
  { id: "route" as const, label: "Route", href: "/farmer/route", icon: RouteIcon },
];

export function DeliveryWorkflowNav({ current, hideCalendar = false }: { current: DeliveryWorkflowStep; hideCalendar?: boolean }) {
  const visibleSteps = hideCalendar ? steps.filter((step) => step.id !== "calendar") : steps;
  const currentIndex = visibleSteps.findIndex((step) => step.id === current);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-1">
        {visibleSteps.map((step, index) => {
          const Icon = step.icon;
          const active = step.id === current;
          const completed = index < currentIndex;
          return (
            <Link
              key={step.id}
              href={step.href}
              className={cn(
                "flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-emerald-600 text-white shadow-sm"
                  : completed
                    ? "text-emerald-700 hover:bg-emerald-50"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{step.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
