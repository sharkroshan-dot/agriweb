"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Truck,
  BarChart,
  Settings,
  ShieldCheck,
  Users,
  Leaf,
  Plus,
  Calendar,
  Map,
  MapPin,
  Star,
  Wallet,
  Sprout,
  FileText,
  Briefcase,
  Layers,
  GraduationCap,
  Users2,
  Boxes,
  CalendarClock,
  Sparkles,
  CloudSun,
  MessageSquare,
  PackagePlus,
  BadgePercent,
  BadgeCheck,
  Bot,
  ShoppingBasket,
  ThumbsUp,
  Flame,
  FileSignature,
} from "lucide-react";
import { cn, formatPrice } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { api } from "../../lib/api/client";

const navGroups = [
  {
    label: "Management",
    items: [
      { name: "Dashboard", href: "/farmer/dashboard", icon: LayoutDashboard },
      { name: "Products", href: "/farmer/products", icon: Package },
      { name: "Restock & Inventory", href: "/farmer/restock", icon: PackagePlus },
      { name: "Orders", href: "/farmer/orders", icon: ShoppingCart },
      { name: "Farm Baskets", href: "/farmer/farm-baskets", icon: ShoppingBasket },
      { name: "Customers", href: "/farmer/customers", icon: Users },
      { name: "Ratings & Reviews", href: "/farmer/reviews", icon: Star },
      { name: "Harvest Calendar", href: "/farmer/harvests", icon: Sprout },
      { name: "Harvest Planner", href: "/farmer/harvest-planner", icon: CalendarClock },
      { name: "Batches & Traceability", href: "/farmer/batches", icon: Layers },
    ],
  },
  {
    label: "Farming & Supply",
    items: [
      { name: "Crop Advisor", href: "/farmer/crop-advisor", icon: Sparkles },
      { name: "Weather & Perishability", href: "/farmer/weather", icon: CloudSun },
      { name: "Supply Calendar", href: "/farmer/supply-calendar", icon: Boxes },
      { name: "Cooperative", href: "/farmer/cooperative", icon: Users2 },
      { name: "Education Center", href: "/farmer/education", icon: GraduationCap },
    ],
  },
  {
    label: "Deliveries",
    items: [
      { name: "Route", href: "/farmer/route", icon: Truck },
      { name: "Order Map", href: "/farmer/order-map", icon: MapPin },
      { name: "Delivery Calendar", href: "/farmer/delivery-calendar", icon: Calendar },
      { name: "Smart Route", href: "/farmer/smart-route", icon: Map },
      { name: "Delivery Slots", href: "/farmer/delivery-slots", icon: Truck },
    ],
  },
  {
    label: "Insights",
    items: [
      { name: "Analytics", href: "/farmer/analytics", icon: BarChart },
      { name: "AI Predictions", href: "/farmer/ai-predictions", icon: Bot },
      { name: "Farm Impact", href: "/farmer/impact", icon: Leaf },
      { name: "AI Farm Advisor", href: "/farmer/advisor", icon: Sparkles },
      { name: "Demand Heatmap", href: "/farmer/demand-heatmap", icon: Flame },
    ],
  },
  {
    label: "AI Assistant",
    items: [
      { name: "Voice Assistant", href: "/farmer/assistant", icon: Bot },
      { name: "Messages", href: "/farmer/messages", icon: MessageSquare },
    ],
  },
  {
    label: "Finance & Earnings",
    items: [
      { name: "Earnings", href: "/farmer/earnings", icon: Wallet },
      { name: "Offers & Coupons", href: "/farmer/coupons", icon: BadgePercent },
    ],
  },
  {
    label: "B2B & Bulk",
    items: [
      { name: "Bulk RFQ", href: "/farmer/purchase-requests", icon: FileText },
      { name: "Business RFQs", href: "/farmer/b2b/rfqs", icon: Briefcase },
      { name: "Business Contracts", href: "/farmer/b2b/contracts", icon: FileSignature },
      { name: "Bulk & B2B Orders", href: "/farmer/bulk-orders", icon: Truck },
    ],
  },
  {
    label: "System",
    items: [
      { name: "AgriConnect Score", href: "/farmer/agri-score", icon: BadgeCheck },
      { name: "Settings", href: "/farmer/settings", icon: Settings },
      { name: "Security", href: "/farmer/security", icon: ShieldCheck },
    ],
  },
];

export function FarmerSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken;
  const farmerName = (session?.user as any)?.name || "Farmer";

  const { data: profileData } = useQuery({
    queryKey: ["farmerProfile"],
    queryFn: () => api.get("/farmers/me/profile"),
    enabled: Boolean(accessToken),
  });

  const { data: ordersData } = useQuery({
    queryKey: ["farmerOrderCount"],
    queryFn: () => api.get("/farmers/me/orders", { params: { limit: 1 } }),
    enabled: Boolean(accessToken),
  });

  const { data: todayData } = useQuery({
    queryKey: ["farmerTodaySummary"],
    queryFn: () => api.get("/farmers/me/dashboard", { params: { period: "today" } }),
    enabled: Boolean(accessToken),
  });

  const orderCount = (ordersData as any)?.data?.pagination?.total ?? 0;
  const todayStats = (todayData as any)?.stats ?? {};
  const todayRevenue = todayStats?.totalRevenue?.value ?? 0;
  const displayName = profileData?.data?.farmName || profileData?.data?.ownerName || farmerName;
  const farmerEmail = (session?.user as any)?.email || profileData?.data?.email || "";
  const farmerRating = profileData?.data?.rating;
  const farmerRatingCount = profileData?.data?.ratingCount ?? 0;

  return (
    <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white/95 md:block">
      <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto px-3 py-4 lg:px-4">
        <div className="mb-4 overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-3.5 shadow-sm">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
              <Leaf className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900" title={displayName}>{displayName}</p>
              <p className="mt-0.5 break-all text-[11px] leading-4 text-slate-500" title={farmerEmail}>{farmerEmail}</p>
              {farmerRating ? (
                <p className="mt-0.5 text-xs font-medium text-yellow-600">★ {Number(farmerRating).toFixed(1)} ({farmerRatingCount} reviews)</p>
              ) : (
                <p className="mt-0.5 text-xs text-gray-400">No ratings yet</p>
              )}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-emerald-100 pt-3 text-sm">
            <span className="text-gray-500">Today's Revenue</span>
            <span className="shrink-0 font-bold text-emerald-700">{formatPrice(todayRevenue)}</span>
          </div>
        </div>

        <nav aria-label="Farmer navigation" className="space-y-2">
          {navGroups.map((group, groupIndex) => {
            const groupActive = group.items.some(
              (item) => pathname === item.href || pathname?.startsWith(item.href + "/")
            );

            if (groupIndex === 0) {
              return (
                <section key={group.label} className="rounded-xl border border-slate-100 bg-white/70 p-1">
                  <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                    {group.label}
                  </p>
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
                      return (
                        <Link
                          key={item.name}
                          href={item.href}
                          aria-current={isActive ? "page" : undefined}
                          className={cn(
                            "flex min-h-10 items-center justify-between rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                            isActive
                              ? "bg-emerald-600 text-white shadow-sm"
                              : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-800"
                          )}
                        >
                          <span className="flex min-w-0 items-center gap-2.5">
                            <item.icon className="h-[18px] w-[18px] shrink-0" />
                            <span className="truncate">{item.name}</span>
                          </span>
                          {item.name === "Orders" && orderCount > 0 && (
                            <Badge
                              variant={isActive ? "secondary" : "default"}
                              className="ml-2 shrink-0 px-1.5 py-0 text-[10px]"
                            >
                              {orderCount}
                            </Badge>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </section>
              );
            }

            return (
              <details
                key={group.label}
                open={groupActive}
                className="group/nav overflow-hidden rounded-xl border border-transparent transition-colors open:border-slate-100 open:bg-white/60"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                  <span>{group.label}</span>
                  <span className="text-base font-normal leading-none text-slate-300 transition-transform group-open/nav:rotate-180">⌄</span>
                </summary>
                <div className="space-y-0.5 px-1 pb-1">
                  {group.items.map((item) => {
                    const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
                    return (
                      <Link
                        key={item.name}
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                          isActive
                            ? "bg-emerald-600 text-white shadow-sm"
                            : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-800"
                        )}
                      >
                        <item.icon className="h-[18px] w-[18px] shrink-0" />
                        <span className="truncate">{item.name}</span>
                      </Link>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </nav>

        <div className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-700 shadow-sm">
              <Plus className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-900">Add a product</p>
              <p className="text-[11px] text-slate-500">List fresh produce</p>
            </div>
          </div>
          <Link href="/farmer/products/new" className="mt-3 block">
            <Button size="sm" className="w-full bg-emerald-600 hover:bg-emerald-700">
              Add New Product
            </Button>
          </Link>
        </div>
      </div>
    </aside>
  );
}
