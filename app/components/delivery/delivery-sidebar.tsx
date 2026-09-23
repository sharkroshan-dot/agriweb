"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Truck,
  Map,
  MapPin,
  Settings,
  History,
  CheckCircle,
  Wallet,
  Banknote,
  LifeBuoy,
  Star,
  RefreshCcw,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { api } from "../../lib/api/client";

export function DeliverySidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken;
  const userName = (session?.user as any)?.name || (session?.user as any)?.firstName + " " + (session?.user as any)?.lastName || "Delivery Partner";

  const { data: stats } = useQuery({
    queryKey: ["deliveryStats"],
    queryFn: () => api.get("/delivery/me/stats"),
    enabled: Boolean(accessToken),
  });

  const { data: today } = useQuery({
    queryKey: ["deliveryToday"],
    queryFn: () => api.get("/delivery/me/today"),
    enabled: Boolean(accessToken),
  });

  const totalDeliveries = stats?.data?.totalDeliveries || 0;
  const averageRating = stats?.data?.averageRating || 0;
  const totalEarnings = stats?.data?.totalEarnings || 0;
  const onTimeRate = stats?.data?.onTimeDelivery;
  const todayCount = today?.data?.count || 0;
  const isAvailable = stats?.data?.isAvailable;

  const navGroups = [
    {
      label: "Overview",
      items: [
        { name: "Dashboard", href: "/delivery/dashboard", icon: LayoutDashboard },
        { name: "My Deliveries", href: "/delivery/deliveries", icon: Truck, badge: todayCount > 0 ? todayCount : undefined },
        { name: "Order Map", href: "/delivery/order-map", icon: Map },
        { name: "Live Route", href: "/delivery/route", icon: MapPin },
        { name: "Auto-Reassignment", href: "/delivery/reassignments", icon: RefreshCcw },
        { name: "History", href: "/delivery/history", icon: History },
        { name: "My Ratings", href: "/delivery/ratings", icon: Star },
      ],
    },
    {
      label: "Finance",
      items: [
        { name: "Earnings", href: "/delivery/earnings", icon: Wallet },
        { name: "COD Collection", href: "/delivery/settlements", icon: Banknote },
      ],
    },
    {
      label: "Support",
      items: [
        { name: "Support", href: "/delivery/support", icon: LifeBuoy },
        { name: "Settings", href: "/delivery/settings", icon: Settings },
      ],
    },
  ];

  return (
    <aside className="hidden w-64 border-r bg-muted/20 md:block">
      <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto p-4">
        <div className="mb-6 rounded-lg bg-primary/5 p-4 border border-primary/20">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Truck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">{userName}</p>
              <p className="text-xs text-muted-foreground">⭐ {averageRating} ({totalDeliveries} deliveries)</p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total Earnings</span>
            <span className="font-bold text-primary">{new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(totalEarnings)}</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="success" className="w-full justify-center">
              {isAvailable ? "🟢 Available" : "🔴 Offline"}
            </Badge>
          </div>
        </div>

        <nav className="space-y-4">
          {navGroups.map((group) => (
            <div key={group.label}>
              <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      className={cn(
                        "flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                        isActive
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <item.icon className="h-5 w-5" />
                        <span>{item.name}</span>
                      </div>
                      {item.badge && (
                        <Badge
                          variant={isActive ? "secondary" : "default"}
                          className="px-2 py-0 text-xs"
                        >
                          {item.badge}
                        </Badge>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {onTimeRate !== undefined && (
          <div className="mt-6 rounded-lg bg-muted/50 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
                <CheckCircle className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm font-medium">On Time Rate</p>
                <p className="text-lg font-bold text-green-600">{onTimeRate}%</p>
              </div>
            </div>
            <div className="mt-3 h-2 w-full rounded-full bg-muted">
              <div className="h-2 rounded-full bg-green-600" style={{ width: `${onTimeRate}%` }} />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
