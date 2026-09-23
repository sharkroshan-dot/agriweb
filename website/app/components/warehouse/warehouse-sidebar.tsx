"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  Package,
  ArrowDown,
  ArrowUp,
  Warehouse,
  Snowflake,
  BarChart,
  Settings,
  AlertTriangle,
  Plus,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

const navItems = [
  { name: "Dashboard", href: "/warehouse/dashboard", icon: LayoutDashboard },
  { name: "Stock Management", href: "/stock", icon: Package, badge: "24 items" },
  { name: "Incoming Stock", href: "/incoming", icon: ArrowDown, badge: 5 },
  { name: "Outgoing Stock", href: "/outgoing", icon: ArrowUp, badge: 3 },
  { name: "Cold Storage", href: "/cold-storage", icon: Snowflake, badge: "4°C" },
  { name: "Analytics", href: "/warehouse/analytics", icon: BarChart },
  { name: "Settings", href: "/warehouse/settings", icon: Settings },
];

export function WarehouseSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 border-r border-slate-200/80 bg-white/80 md:block">
      <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto p-4 lg:p-5">
        <div className="mb-6 rounded-lg bg-primary/5 p-4 border border-primary/20">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Warehouse className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">Delhi Central Warehouse</p>
              <p className="text-xs text-muted-foreground">Capacity: 75% used</p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total Items</span>
            <span className="font-bold">1,245</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="warning" className="w-full justify-center">
              ⚠️ 10 Low Stock Items
            </Badge>
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
            <p className="text-xs text-muted-foreground">Receive new inventory</p>
            <Button asChild size="sm" className="mt-3 w-full">
              <Link href="/incoming">
                <Plus className="mr-2 h-4 w-4" />
                Receive Stock
              </Link>
            </Button>
          </div>
        </div>

        <div className="mt-4 rounded-lg bg-red-50 p-3 border border-red-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-700">Expiry Alert</p>
              <p className="text-xs text-red-600">5 items expiring in 3 days</p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
