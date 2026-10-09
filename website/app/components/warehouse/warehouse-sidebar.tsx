"use client";

import { usePathname } from "next/navigation";
import { PrefetchLink as Link } from "../shared/prefetch-link";
import {
  LayoutDashboard, Package, PackageCheck, ArrowDown, ArrowUp, Truck, Warehouse,
  Snowflake, ArrowLeftRight, BarChart, CreditCard, Settings, AlertTriangle,
  ClipboardCheck, MessageSquare, Boxes, Route, Bell, Users,
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
      { name: "My Workflow", href: "/warehouse/workflow", icon: ClipboardCheck },
      { name: "Dashboard", href: "/warehouse/dashboard", icon: LayoutDashboard },
      { name: "Messages", href: "/warehouse/messages", icon: MessageSquare },
    ],
  },
  {
    title: "Shared Pickup & Receiving",
    items: [
      { name: "Pickup Partners", href: "/pickup-team", icon: Users },
      { name: "Farm Collection", href: "/collections", icon: Truck },
      { name: "Incoming Stock", href: "/incoming", icon: ArrowDown },
    ],
  },
  {
    title: "Farmer Fulfillment Orders",
    items: [
      { name: "Farmer Fulfillment Transfers", href: "/warehouse/farmer-fulfillment", icon: Route },
      { name: "Multi-Warehouse Consolidation", href: "/warehouse/consolidation", icon: Boxes },
    ],
  },
  {
    title: "Warehouse Fulfillment Orders",
    items: [
      { name: "Quality Inspection", href: "/warehouse/quality-inspection", icon: ClipboardCheck },
      { name: "Stock Management", href: "/stock", icon: Package },
      { name: "Customer Orders", href: "/warehouse/orders", icon: PackageCheck },
      { name: "Order Packing", href: "/packing", icon: PackageCheck },
      { name: "Outgoing / Dispatch", href: "/outgoing", icon: ArrowUp },
    ],
  },
  {
    title: "Warehouse Management",
    items: [
      { name: "Cold Storage", href: "/cold-storage", icon: Snowflake },
      { name: "Transfers", href: "/transfers", icon: ArrowLeftRight },
      { name: "Analytics", href: "/warehouse/analytics", icon: BarChart },
      { name: "Payments", href: "/warehouse/payments", icon: CreditCard },
      { name: "Notifications", href: "/notifications", icon: Bell },
      { name: "Settings", href: "/warehouse/settings", icon: Settings },
    ],
  },
];

export function WarehouseSidebar() {
  const pathname = usePathname();
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
    <aside className="hidden w-64 shrink-0 border-r border-slate-200/80 bg-white md:block">
      <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto p-4 lg:p-5">
        <div className="mb-5 overflow-hidden rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 shadow-sm">
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

        <nav aria-label="Warehouse navigation" className="space-y-5">
          {navSections.map((section) => (
            <section key={section.title} aria-label={section.title}>
              <div className="mb-2 px-2">
                <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{section.title}</h2>
              </div>
              <div className="space-y-1">
                {section.items.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-150",
                        isActive ? "bg-emerald-700 text-white shadow-sm shadow-emerald-900/10" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                      )}
                    >
                      <item.icon className="h-4.5 w-4.5 shrink-0" />
                      <span>{item.name}</span>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>

        <div className="mt-5 rounded-xl border border-dashed border-slate-300 p-4">
          <p className="text-sm font-semibold text-slate-800">Warehouse Workflow</p>
          <Button asChild size="sm" className="mt-3 w-full"><Link href="/warehouse/workflow"><ClipboardCheck className="mr-2 h-4 w-4" />My Workflow</Link></Button>
        </div>

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
