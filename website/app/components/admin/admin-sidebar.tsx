"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import {
  LayoutDashboard,
  Users,
  User,
  Package,
  ShoppingCart,
  Truck,
  Warehouse,
  BarChart,
  Brain,
  Settings,
  Shield,
  ShieldAlert,
  Bell,
  FileText,
  CreditCard,
  Banknote,
  MessageSquare,
  Ticket,
  Landmark,
  Star,
  ShoppingBasket,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { api } from "../../lib/api/client";

const compact = (v: number) => {
  if (v == null) return null;
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(v);
};

export function AdminSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken as string | undefined;

  const { data: dashboardData } = useQuery({
    queryKey: ["adminSidebarStats"],
    queryFn: () => api.get("/admin/dashboard"),
    enabled: Boolean(accessToken),
  });
  const { data: complaintsData } = useQuery({
    queryKey: ["adminSidebarComplaints"],
    queryFn: () => api.get("/complaints"),
    enabled: Boolean(accessToken),
  });
  const { data: refundsData } = useQuery({
    queryKey: ["adminSidebarRefunds"],
    queryFn: () =>
      api.get<{ data: { refunds: { status: string }[] } }>("/refunds/admin/all", {
        params: { limit: 100 },
      }),
    enabled: Boolean(accessToken),
  });

  const stats = dashboardData?.stats ?? {};
  const complaints = Array.isArray(complaintsData) ? complaintsData : complaintsData?.complaints ?? [];
  const pendingRefunds = (refundsData?.data?.refunds ?? []).filter((r) =>
    ["requested", "under_review", "approved", "refund_processing"].includes(r.status)
  ).length;

  const navGroups = [
    {
      label: "Operations",
      items: [
        { name: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
        { name: "Customers", href: "/admin/users", icon: Users, badge: compact(stats.totalCustomers) },
        { name: "Farmers", href: "/admin/farmers", icon: User, badge: compact(stats.totalFarmers) },
        { name: "Delivery", href: "/admin/delivery", icon: Truck, badge: compact(stats.totalDelivery) },
        { name: "Warehouses", href: "/admin/warehouses", icon: Warehouse, badge: compact(stats.totalWarehouse) },
        { name: "Products", href: "/admin/products", icon: Package, badge: compact(stats.totalProducts) },
        { name: "Orders", href: "/admin/orders", icon: ShoppingCart, badge: compact(stats.totalOrders) },
        { name: "Complaints", href: "/admin/complaints", icon: MessageSquare, badge: complaints.length ? String(complaints.length) : undefined },
        { name: "Ratings", href: "/admin/ratings", icon: Star },
        { name: "Coupons", href: "/admin/coupons", icon: Ticket },
        { name: "Farm Baskets", href: "/admin/subscriptions", icon: ShoppingBasket },
        { name: "Admins", href: "/admin/users", icon: Shield, badge: compact(stats.totalAdmins) },
        { name: "Security Center", href: "/admin/security", icon: ShieldAlert },
      ],
    },
    {
      label: "Insights",
      items: [
        { name: "Analytics", href: "/admin/analytics", icon: BarChart },
        { name: "AI Dashboard", href: "/admin/ai", icon: Brain },
      ],
    },
    {
      label: "Finance & Payments",
      items: [
        { name: "Finance Overview", href: "/admin/finance", icon: Landmark },
        { name: "Payments", href: "/admin/payments", icon: CreditCard },
        { name: "Refunds", href: "/admin/refunds", icon: Banknote, badge: pendingRefunds ? String(pendingRefunds) : undefined },
        { name: "COD Settlement", href: "/admin/settlements", icon: Banknote },
        { name: "Reports", href: "/admin/reports", icon: FileText },
      ],
    },
    {
      label: "System",
      items: [{ name: "Settings", href: "/admin/settings", icon: Settings }],
    },
  ];

  return (
    <aside className="hidden w-64 shrink-0 border-r border-slate-200/80 bg-white/80 md:block">
      <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto p-4 lg:p-5">
        <div className="mb-6 overflow-hidden rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 shadow-sm">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100">
              <Shield className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">Admin Panel</p>
              <p className="truncate text-[11px] text-slate-500">Super Admin</p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-emerald-100 pt-3 text-sm">
            <span className="text-slate-500">Platform Status</span>
            <Badge variant="success" className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
              Live
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
                        "flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                        isActive ? "bg-emerald-600 text-white shadow-sm" : "text-gray-600 hover:bg-slate-100"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <item.icon className="h-5 w-5" />
                        <span>{item.name}</span>
                        {item.badge !== undefined && item.badge !== "Live" && (
                          <span
                            className={cn(
                              "rounded-md px-1.5 py-0.5 text-xs font-semibold",
                              isActive ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary/10 text-primary"
                            )}
                          >
                            {item.badge}
                          </span>
                        )}
                        {item.badge === "Live" && (
                          <Badge variant="secondary" className="px-2 py-0 text-xs animate-pulse bg-red-500 text-white">
                            Live
                          </Badge>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-6 rounded-lg border border-primary/20 bg-gradient-to-br from-primary/10 to-primary/5 p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-primary/20 p-2">
              <Bell className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">2 New Alerts</p>
              <p className="text-xs text-muted-foreground">Pending actions</p>
              <Link href="/admin/alerts">
                <Button size="sm" variant="link" className="h-auto p-0 text-xs">
                  View alerts →
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
