"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Package,
  ArrowDown,
  ArrowUp,
  Warehouse,
  Snowflake,
  BarChart,
  Route,
  Settings,
  AlertTriangle,
  Plus,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { api } from "../../lib/api/client";

const navItems = [
  { name: "Dashboard", href: "/warehouse/dashboard", icon: LayoutDashboard },
  { name: "Stock Management", href: "/stock", icon: Package },
  { name: "Incoming Stock", href: "/incoming", icon: ArrowDown },
  { name: "Outgoing Stock", href: "/outgoing", icon: ArrowUp },
  { name: "Fulfillment Routing", href: "/fulfillment", icon: Route },
  { name: "Cold Storage", href: "/cold-storage", icon: Snowflake },
  { name: "Analytics", href: "/warehouse/analytics", icon: BarChart },
  { name: "Settings", href: "/warehouse/settings", icon: Settings },
];

export function WarehouseSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken as string | undefined;
  const { data: dashboardResponse, isLoading } = useQuery({
    queryKey: ["warehouseSidebarDashboard"],
    queryFn: () => api.get("/warehouse/me/dashboard"),
    enabled: Boolean(accessToken),
    retry: false,
  });

  const response = (dashboardResponse as any)?.data ?? dashboardResponse ?? {};
  const warehouse = response?.warehouse ?? response?.data?.warehouse ?? response?.summary ?? response;
  const totalCapacity = Number(warehouse?.totalCapacity ?? response?.totalCapacity ?? 0);
  const usedCapacity = Number(warehouse?.usedCapacity ?? response?.usedCapacity ?? 0);
  const capacityPercent = totalCapacity > 0
    ? Math.min(100, Math.max(0, Math.round((usedCapacity / totalCapacity) * 100)))
    : null;
  const totalItems = Number(
    warehouse?.totalItems ?? warehouse?.inventoryCount ?? response?.totalItems ?? response?.stats?.totalItems ?? 0
  );
  const lowStockItems = Number(
    warehouse?.lowStockItems ?? response?.lowStockItems ?? response?.stats?.lowStockItems ?? 0
  );
  const expiringSoon = Number(
    warehouse?.expiringSoon ?? response?.expiringSoon ?? response?.stats?.expiringSoon ?? 0
  );
  const warehouseName = warehouse?.name ?? warehouse?.warehouseName ?? response?.warehouseName ?? "My Warehouse";

  return (
    <aside className="hidden w-64 border-r border-slate-200/80 bg-white md:block">
      <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto p-4">
        <div className="mb-6 rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800">
              <Warehouse className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{warehouseName}</p>
              <p className="text-xs text-slate-500">
                {isLoading ? "Loading capacity…" : capacityPercent === null ? "Capacity unavailable" : `Capacity: ${capacityPercent}% used`}
              </p>
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-emerald-100">
            <div
              className="h-full rounded-full bg-emerald-600 transition-all"
              style={{ width: `${capacityPercent ?? 0}%` }}
              aria-label={capacityPercent === null ? "Capacity unavailable" : `${capacityPercent}% capacity used`}
            />
          </div>
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-slate-500">Inventory items</span>
            <span className="font-bold tabular-nums text-slate-900">{isLoading ? "—" : totalItems.toLocaleString("en-IN")}</span>
          </div>
          {lowStockItems > 0 && (
            <div className="mt-3">
              <Badge variant="warning" className="w-full justify-center">
                <AlertTriangle className="mr-1 h-3.5 w-3.5" /> {lowStockItems} low-stock items
              </Badge>
            </div>
          )}
        </div>

        <nav className="space-y-1" aria-label="Warehouse navigation">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.name}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-emerald-700 text-white shadow-sm"
                    : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-900"
                )}
              >
                <item.icon className="h-[18px] w-[18px] shrink-0" />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm">
              <Package className="h-5 w-5" />
            </div>
            <p className="mt-3 text-sm font-semibold text-slate-900">Receive inventory</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">Record incoming stock and continue the inspection workflow.</p>
            <Button asChild size="sm" className="mt-3 w-full rounded-xl">
              <Link href="/incoming">
                <Plus className="mr-2 h-4 w-4" />
                Receive stock
              </Link>
            </Button>
          </div>
        </div>

        {expiringSoon > 0 && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div>
              <p className="text-sm font-semibold text-amber-900">Expiry watch</p>
              <p className="text-xs leading-5 text-amber-800">{expiringSoon} inventory items expiring soon</p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
