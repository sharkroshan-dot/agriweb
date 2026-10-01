"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  Package,
  PackageCheck,
  ArrowDown,
  ArrowUp,
  Truck,
  Warehouse,
  Snowflake,
  ArrowLeftRight,
  BarChart,
  CreditCard,
  Settings,
  AlertTriangle,
  Plus,
  ClipboardCheck,
  MessageSquare,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api/client";
import { Button } from "../ui/button";

const navItems = [
  { name: "My Workflow", href: "/workflow", icon: ClipboardCheck },
  { name: "Dashboard", href: "/warehouse/dashboard", icon: LayoutDashboard },
  { name: "Messages", href: "/warehouse/messages", icon: MessageSquare },
  { name: "Stock Management", href: "/stock", icon: Package },
  { name: "Farm Collection", href: "/collections", icon: Truck },
  { name: "Incoming Stock", href: "/incoming", icon: ArrowDown },
  { name: "Quality Inspection", href: "/warehouse/quality-inspection", icon: ClipboardCheck },
  { name: "Order Packing", href: "/packing", icon: PackageCheck },
  { name: "Outgoing Stock", href: "/outgoing", icon: ArrowUp },
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
        <div className="mb-6 overflow-hidden rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 shadow-sm">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100">
              <Warehouse className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">{dashboardQuery.isLoading ? "Loading warehouse..." : warehouseName}</p>
              <p className="truncate text-[11px] text-slate-500">{capacity === null ? "Capacity: unavailable" : "Capacity: " + capacity + "% used"}</p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-emerald-100 pt-3 text-sm">
            <span className="text-slate-500">Total Items</span>
            <span className="font-bold">{totalItems === null ? "—" : totalItems.toLocaleString()}</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            {lowStock === null ? (
              <Badge variant="secondary" className="w-full justify-center">Low stock: unavailable</Badge>
            ) : lowStock > 0 ? (
              <Badge variant="warning" className="w-full justify-center">⚠️ {lowStock} Low Stock {lowStock === 1 ? "Item" : "Items"}</Badge>
            ) : (
              <Badge variant="secondary" className="w-full justify-center">✓ No Low Stock Items</Badge>
            )}
          </div>
        </div>

        <nav className="space-y-4">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                  isActive ? "bg-emerald-600 text-white shadow-sm" : "text-gray-600 hover:bg-slate-100"
                )}
              >
                <div className="flex items-center gap-3">
                  <item.icon className="h-5 w-5" />
                  <span>{item.name}</span>
                </div>
                {item.badge && (
                  <Badge
                    variant={isActive ? "secondary" : "default"}
                    className={cn("px-2 py-0 text-xs", typeof item.badge === "string" && item.badge.includes("°C") && "bg-blue-500 text-white")}
                  >
                    {item.badge}
                  </Badge>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="mt-6 rounded-lg border border-dashed p-4">
          <div className="flex flex-col items-center text-center">
            <Package className="h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">Add Stock</p>
            <p className="text-xs text-muted-foreground">Manage farm pickups</p>
            <Button asChild size="sm" className="mt-3 w-full">
              <Link href="/collections">
                <Truck className="mr-2 h-4 w-4" />
                Farm Collection
              </Link>
            </Button>
          </div>
        </div>

        {lowStock !== null && lowStock > 0 && <div className="mt-4 rounded-lg bg-amber-50 p-3 border border-amber-200"><div className="flex items-start gap-2"><AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" /><div><p className="text-sm font-medium text-amber-700">Low Stock Alert</p><p className="text-xs text-amber-600">{lowStock} {lowStock === 1 ? "item needs" : "items need"} restocking.</p></div></div></div>}
      </div>
    </aside>
  );
}
