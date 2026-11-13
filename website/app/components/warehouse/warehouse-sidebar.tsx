"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { PrefetchLink as Link } from "../shared/prefetch-link";
import {
  LayoutDashboard, Package, PackageCheck, ArrowDown, ArrowUp, Truck, Warehouse,
  Snowflake, ArrowLeftRight, BarChart, CreditCard, Settings, AlertTriangle, Gauge,
  ClipboardCheck, MessageSquare, Boxes, Route, Users, ChevronDown, ChevronRight,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api/client";
import { Button } from "../ui/button";

const navSections = [
  {
    title: "Overview",
    items: [
      { name: "Dashboard", href: "/warehouse/dashboard", icon: LayoutDashboard },
      { name: "Messages", href: "/warehouse/messages", icon: MessageSquare },
    ],
  },
  {
    title: "Shared Pickup & Receiving",
    items: [
      { name: "Pickup Partners", href: "/pickup-team", icon: Users },
      { name: "Farm Collection", href: "/collections", icon: Truck },
      { name: "Pickup Routes", href: "/pickup-routes", icon: Route },
      { name: "Incoming Stock", href: "/incoming", icon: ArrowDown },
      { name: "B2B Pickup & Fulfillment", href: "/warehouse/b2b-fulfillment", icon: Truck },
      { name: "B2B Fulfillment Workspace", href: "/warehouse/b2b-fulfillment-workspace", icon: PackageCheck },
    ],
  },
  {
    title: "Unified Fulfillment Operations",
    items: [
      { name: "Fulfillment & Dispatch", href: "/warehouse/fulfillment-dispatch", icon: Truck },
    ],
  },
  {
    title: "Farmer Fulfillment Orders",
    items: [
      { name: "Farmer Fulfillment (Existing)", href: "/warehouse/farmer-fulfillment", icon: Route },
      { name: "Multi-Warehouse Consolidation", href: "/warehouse/consolidation", icon: Boxes },
    ],
  },
  {
    title: "Warehouse Fulfillment Orders",
    items: [
      { name: "Quality Inspection", href: "/warehouse/quality-inspection", icon: ClipboardCheck },

      { name: "Customer Orders", href: "/warehouse/orders", icon: PackageCheck },
      { name: "Order Packing", href: "/packing", icon: PackageCheck },
      { name: "Outgoing / Dispatch (Existing)", href: "/outgoing", icon: ArrowUp },
    ],
  },
  {
    title: "Local Hub Operations",
    items: [
      { name: "Local Hub Orders & Receiving", href: "/fulfillment", icon: PackageCheck },
      { name: "Consolidation & Hub Handoff", href: "/warehouse/consolidation", icon: Boxes },
    ],
  },
  {
    title: "Warehouse Management",
    items: [
      { name: "Cold Storage", href: "/cold-storage", icon: Snowflake },
      { name: "Transfers", href: "/transfers", icon: ArrowLeftRight },
      { name: "Analytics", href: "/warehouse/analytics", icon: BarChart },
      { name: "Payments", href: "/warehouse/payments", icon: CreditCard },
      { name: "Settings", href: "/warehouse/settings", icon: Settings },
    ],
  },
];

export function WarehouseSidebar() {
  const pathname = usePathname();
  const [collapsedSections, setCollapsedSections] = useState<string[]>([]);
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const isLocalHubManager = (session?.user as any)?.facilityType === "local_hub";
  const visibleSections = isLocalHubManager ? [
    { title: "Local Hub", items: [
      { name: "Dashboard", href: "/hub-management", icon: LayoutDashboard },
      { name: "Incoming Orders", href: "/hub-management?view=incoming", icon: PackageCheck },
      { name: "Delivery Status", href: "/hub-management?view=delivery", icon: Truck },
    ] },
  ] : [{ title: "Local Hub Management", items: [
    { name: "Manage Local Hubs", href: "/hub-management", icon: Warehouse },
  ] }, ...navSections.filter((section) => section.title !== "Local Hub Operations")];
  const dashboardQuery = useQuery({
    queryKey: ["warehouseSidebarDashboard"],
    queryFn: () => api.get("/warehouse/me/dashboard"),
    staleTime: 30000,
    refetchInterval: 60000,
    retry: 1,
  });
  const dashboard: any = dashboardQuery.data || {};
  const warehouse = dashboard.warehouse || {};
  const stockSummary = dashboard.stockSummary || {};
  const warehouseName = warehouse.name || "Warehouse";
  const capacityNumber = Number(dashboard.capacityUtilization);
  const totalCapacityNumber = Number(warehouse.totalCapacity ?? dashboard.totalCapacity);
  const usedCapacityNumber = Number(warehouse.usedCapacity ?? dashboard.usedCapacity);
  const totalItemsNumber = Number(stockSummary.totalItems);
  const hasCapacityUnits = Number.isFinite(totalCapacityNumber) && totalCapacityNumber > 0 &&
    Number.isFinite(usedCapacityNumber) && usedCapacityNumber >= 0;
  const rawCapacityUsed = hasCapacityUnits
    ? (usedCapacityNumber / totalCapacityNumber) * 100
    : capacityNumber;
  const capacity = Number.isFinite(rawCapacityUsed) ? Math.max(0, Math.min(100, rawCapacityUsed)) : null;
  const capacityLeft = capacity === null ? null : Math.max(0, 100 - capacity);
  const totalCapacity = hasCapacityUnits ? totalCapacityNumber : null;
  const usedCapacity = hasCapacityUnits ? usedCapacityNumber : null;
  const availableCapacity = hasCapacityUnits ? Math.max(0, totalCapacityNumber - usedCapacityNumber) : null;
  const totalItems = Number.isFinite(totalItemsNumber) ? totalItemsNumber : null;
  const capacityTone = capacity === null ? "neutral" : capacity >= 90 ? "critical" : capacity >= 80 ? "warning" : "healthy";

  return (
    <aside className="role-sidebar warehouse-sidebar hidden w-[276px] shrink-0 border-r border-slate-200/80 bg-white md:block">
      <div className="warehouse-sidebar-inner sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto p-4 lg:p-5">
        <div className="warehouse-identity mb-5 overflow-hidden rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100">
              <Warehouse className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">{dashboardQuery.isLoading ? "Loading warehouse..." : warehouseName}</p>
              <p className="text-[11px] text-slate-500">{capacity === null ? "Capacity unavailable" : `Capacity: ${capacity}% used`}</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-emerald-100 pt-3">
            <div><p className="text-[11px] text-slate-500">Total Items</p><p className="font-bold tabular-nums">{totalItems === null ? "—" : totalItems.toLocaleString()}</p></div>
            <div><p className="text-[11px] text-slate-500">Capacity left</p><p className={cn("font-bold tabular-nums", capacityTone === "critical" ? "text-rose-600" : capacityTone === "warning" ? "text-amber-600" : "text-emerald-700")}>{capacityLeft === null ? "—" : `${Math.round(capacityLeft)}%`}</p></div>
          </div>
        </div>

        <nav aria-label="Warehouse navigation" className="warehouse-nav space-y-5">
          {visibleSections.map((section) => {
            const hasActiveItem = section.items.some((item) => {
              const view = searchParams.get("view");
              const expectedView = item.href.includes("?view=") ? item.href.split("?view=")[1] : null;
              return pathname === item.href.split("?")[0] && (expectedView ? view === expectedView : view !== "incoming" && view !== "delivery");
            });
            const isCollapsed = collapsedSections.includes(section.title) && !hasActiveItem;
            return (
              <section key={section.title} aria-label={section.title} className="space-y-1">
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() => setCollapsedSections((current) => current.includes(section.title) ? current.filter((title) => title !== section.title) : [...current, section.title])}
                  className="group flex w-full items-center justify-between rounded-lg px-2 py-2 text-left transition-colors hover:bg-slate-50"
                >
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 group-hover:text-slate-600">{section.title}</span>
                  {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
                </button>
                {!isCollapsed && (
                  <div className="ml-2 space-y-1 border-l border-slate-200 pl-2">
                    {section.items.map((item) => {
                      const view = searchParams.get("view");
                      const expectedView = item.href.includes("?view=") ? item.href.split("?view=")[1] : null;
                      const isActive = pathname === item.href.split("?")[0] && (expectedView ? view === expectedView : view !== "incoming" && view !== "delivery");
                      return (
                        <Link
                          key={item.name}
                          href={item.href}
                          aria-current={isActive ? "page" : undefined}
                          className={cn(
                            "warehouse-nav-link flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150",
                            isActive ? "bg-emerald-700 text-white shadow-sm shadow-emerald-900/10" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                          )}
                        >
                          <item.icon className="h-4.5 w-4.5 shrink-0" />
                          <span>{item.name}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </nav>

        <div className={cn(
          "mt-4 overflow-hidden rounded-xl border p-3 shadow-sm",
          capacityTone === "critical" ? "border-rose-200 bg-rose-50" :
            capacityTone === "warning" ? "border-amber-200 bg-amber-50" :
              capacityTone === "healthy" ? "border-emerald-200 bg-emerald-50/80" :
                "border-slate-200 bg-slate-50"
        )}>
          <div className="flex items-start gap-2.5">
            <div className={cn(
              "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              capacityTone === "critical" ? "bg-rose-100 text-rose-700" :
                capacityTone === "warning" ? "bg-amber-100 text-amber-700" :
                  capacityTone === "healthy" ? "bg-emerald-100 text-emerald-700" :
                    "bg-slate-200 text-slate-600"
            )}>
              {capacityTone === "healthy" || capacityTone === "neutral"
                ? <Gauge className="h-4 w-4" />
                : <AlertTriangle className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className={cn(
                  "text-xs font-semibold",
                  capacityTone === "critical" ? "text-rose-800" :
                    capacityTone === "warning" ? "text-amber-800" :
                      capacityTone === "healthy" ? "text-emerald-800" : "text-slate-700"
                )}>Capacity status</p>
                {capacity !== null && (
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    capacityTone === "critical" ? "bg-rose-100 text-rose-700" :
                      capacityTone === "warning" ? "bg-amber-100 text-amber-700" :
                        "bg-emerald-100 text-emerald-700"
                  )}>{Math.round(capacity)}% used</span>
                )}
              </div>
              <p className={cn(
                "mt-1 text-[11px] leading-4",
                capacityTone === "critical" ? "text-rose-700" :
                  capacityTone === "warning" ? "text-amber-700" :
                    capacityTone === "healthy" ? "text-emerald-700" : "text-slate-600"
              )}>
                {capacityTone === "critical" ? "Critical: warehouse capacity is almost full. Review incoming stock and transfers." :
                  capacityTone === "warning" ? "High utilization. Check available space before accepting more incoming stock." :
                    capacityTone === "healthy" ? "Capacity is within a healthy range. Space is available for incoming stock." :
                      "Capacity data is unavailable. Check the warehouse capacity configuration."}
              </p>
              {capacity !== null && (
                <div className={cn(
                  "mt-2 h-1.5 overflow-hidden rounded-full",
                  capacityTone === "critical" ? "bg-rose-200" :
                    capacityTone === "warning" ? "bg-amber-200" : "bg-emerald-200"
                )}>
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width] duration-300",
                      capacityTone === "critical" ? "bg-rose-600" :
                        capacityTone === "warning" ? "bg-amber-500" : "bg-emerald-600"
                    )}
                    style={{ width: `${capacity}%` }}
                  />
                </div>
              )}
              {hasCapacityUnits && (
                <p className="mt-1.5 text-[10px] text-slate-600">
                  {usedCapacity?.toLocaleString()} used · {availableCapacity?.toLocaleString()} available of {totalCapacity?.toLocaleString()}
                </p>
              )}
              <p className="mt-2 text-[10px] font-medium text-slate-600">Warning at 80% · Critical at 90%</p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
