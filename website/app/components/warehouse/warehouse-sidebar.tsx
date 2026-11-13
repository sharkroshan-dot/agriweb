"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { PrefetchLink as Link } from "../shared/prefetch-link";
import {
  LayoutDashboard, Package, PackageCheck, ArrowDown, ArrowUp, Truck, Warehouse,
  Snowflake, ArrowLeftRight, BarChart, CreditCard, Settings, AlertTriangle,
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
  const totalItemsNumber = Number(stockSummary.totalItems);
  const lowStockNumber = Number(stockSummary.lowStock);
  const capacity = Number.isFinite(capacityNumber) ? Math.max(0, Math.round(capacityNumber)) : null;
  const totalItems = Number.isFinite(totalItemsNumber) ? totalItemsNumber : null;
  const lowStock = Number.isFinite(lowStockNumber) ? lowStockNumber : null;

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
            <div><p className="text-[11px] text-slate-500">Total Items</p><p className="font-bold">{totalItems === null ? "—" : totalItems.toLocaleString()}</p></div>
            <div><p className="text-[11px] text-slate-500">Low Stock</p><p className={cn("font-bold", lowStock && lowStock > 0 ? "text-amber-600" : "text-slate-900")}>{lowStock === null ? "—" : lowStock}</p></div>
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

        {lowStock !== null && lowStock > 0 && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
              <div><p className="text-sm font-medium text-amber-800">Low Stock Alert</p><p className="text-xs text-amber-700">{lowStock} item{lowStock === 1 ? "" : "s"} need restocking.</p></div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
