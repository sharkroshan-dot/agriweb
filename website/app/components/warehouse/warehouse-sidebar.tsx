"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard, Package, PackageCheck, ArrowDown, ArrowUp, Truck, Warehouse,
  Snowflake, ArrowLeftRight, BarChart, CreditCard, Settings, AlertTriangle,
  ClipboardCheck, MessageSquare, Boxes, Route,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api/client";
import { Button } from "../ui/button";

const navItems = [
  { name: "My Workflow", href: "/warehouse/workflow", icon: ClipboardCheck },
  { name: "Dashboard", href: "/warehouse/dashboard", icon: LayoutDashboard },
  { name: "Messages", href: "/warehouse/messages", icon: MessageSquare },
  { name: "Stock Management", href: "/stock", icon: Package },
  { name: "Farm Collection", href: "/collections", icon: Truck },
  { name: "Customer Orders", href: "/warehouse/orders", icon: ClipboardCheck },
  { name: "Farmer Fulfillment Transfers", href: "/warehouse/farmer-fulfillment", icon: Route },
  { name: "Incoming Stock", href: "/incoming", icon: ArrowDown },
  { name: "Quality Inspection", href: "/warehouse/quality-inspection", icon: ClipboardCheck },
  { name: "Order Packing", href: "/packing", icon: PackageCheck },
  { name: "Outgoing / Dispatch", href: "/outgoing", icon: ArrowUp },
  { name: "Consolidation", href: "/warehouse/consolidation", icon: Boxes },
  { name: "Cold Storage", href: "/cold-storage", icon: Snowflake },
  { name: "Transfers", href: "/transfers", icon: ArrowLeftRight },
  { name: "Analytics", href: "/warehouse/analytics", icon: BarChart },
  { name: "Payments", href: "/warehouse/payments", icon: CreditCard },
  { name: "Settings", href: "/warehouse/settings", icon: Settings },
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
    <aside className="hidden w-64 shrink-0 border-r border-slate-200/80 bg-white/80 md:block">
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

        <div className="mb-2 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Work Queue</div>
        <nav className="space-y-1.5">
          {navItems.slice(0, 12).map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link key={item.name} href={item.href} className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                isActive ? "bg-emerald-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
              )}>
                <item.icon className="h-4.5 w-4.5" />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="my-5 border-t border-slate-200" />
        <div className="mb-2 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Warehouse Management</div>
        <nav className="space-y-1.5">
          {navItems.slice(12).map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link key={item.name} href={item.href} className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                isActive ? "bg-emerald-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
              )}>
                <item.icon className="h-4.5 w-4.5" />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-5 rounded-xl border border-dashed border-slate-300 p-4">
          <p className="text-sm font-semibold text-slate-800">Need to receive stock?</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">Start a farm collection, then verify it in Receiving.</p>
          <Button asChild size="sm" className="mt-3 w-full"><Link href="/collections"><Truck className="mr-2 h-4 w-4" />Farm Collection</Link></Button>
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
