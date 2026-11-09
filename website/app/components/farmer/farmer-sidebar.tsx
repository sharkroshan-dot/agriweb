"use client";

import { usePathname } from "next/navigation";
import { PrefetchLink as Link } from "../shared/prefetch-link";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  ClipboardList,
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
  PackageCheck,
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
    label: "Overview",
    items: [
      { name: "Dashboard", href: "/farmer/dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Orders & Fulfillment",
    items: [
      { name: "Customer Orders", href: "/farmer/orders", icon: ShoppingCart },
      { name: "Packing & Checking", href: "/farmer/packing", icon: PackageCheck },
      { name: "Batches & Traceability", href: "/farmer/batches", icon: Layers },
      { name: "Warehouse Returns", href: "/farmer/warehouse-returns", icon: PackageCheck },
    ],
  },
  {
    label: "Delivery & Routes",
    items: [
      { name: "Order Map", href: "/farmer/order-map", icon: MapPin },
      { name: "Smart Route Planner", href: "/farmer/smart-route", icon: Map },
      { name: "My Delivery Route", href: "/farmer/route", icon: Truck },
      { name: "Supply & Delivery Calendar", href: "/farmer/supply-delivery-calendar", icon: Calendar },
      { name: "Delivery Slots", href: "/farmer/delivery-slots", icon: CalendarClock },
    ],
  },
  {
    label: "Products & Inventory",
    items: [
      { name: "Products & Inventory", href: "/farmer/products", icon: Package },
      { name: "Farm Baskets", href: "/farmer/farm-baskets", icon: ShoppingBasket },
      { name: "Harvest Calendar", href: "/farmer/harvests", icon: Sprout },
      { name: "Harvest Planner", href: "/farmer/harvest-planner", icon: CalendarClock },
      
    ],
  },
  {
    label: "B2B & Cooperative",
    items: [
      { name: "Business RFQs", href: "/farmer/b2b/rfqs", icon: Briefcase },
      { name: "Bulk Purchase Requests", href: "/farmer/purchase-requests", icon: FileText },
      { name: "B2B Supply Contracts", href: "/farmer/b2b/contracts", icon: FileSignature },
      { name: "B2B Fulfillment Orders", href: "/farmer/bulk-orders", icon: Truck },
      { name: "Farmer Cooperative", href: "/farmer/cooperative", icon: Users2 },
    ],
  },
  {
    label: "Earnings & Customers",
    items: [
      { name: "Earnings", href: "/farmer/earnings", icon: Wallet },
      { name: "Customers", href: "/farmer/customers", icon: Users },
      { name: "Ratings & Reviews", href: "/farmer/reviews", icon: Star },
      { name: "Offers & Coupons", href: "/farmer/coupons", icon: BadgePercent },
    ],
  },
  {
    label: "Insights & Planning",
    items: [
      { name: "Analytics", href: "/farmer/analytics", icon: BarChart },
      { name: "Demand Heatmap", href: "/farmer/demand-heatmap", icon: Flame },
      { name: "AI Predictions", href: "/farmer/ai-predictions", icon: Bot },
      { name: "Farm Impact", href: "/farmer/impact", icon: Leaf },
      { name: "Crop Advisor", href: "/farmer/crop-advisor", icon: Sparkles },
      { name: "Weather & Perishability", href: "/farmer/weather", icon: CloudSun },
    ],
  },
  {
    label: "Support & Learning",
    items: [
      { name: "Messages", href: "/farmer/messages", icon: MessageSquare },
      { name: "AI Farm Advisor", href: "/farmer/advisor", icon: Sparkles },
      { name: "Voice Assistant", href: "/farmer/assistant", icon: Bot },
      { name: "Education Center", href: "/farmer/education", icon: GraduationCap },
    ],
  },
  {
    label: "Account & Security",
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

  const { data: todayData } = useQuery({
    queryKey: ["farmerTodaySummary"],
    queryFn: () => api.get("/farmers/me/dashboard", { params: { period: "today" } }),
    enabled: Boolean(accessToken),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const todayStats = (todayData as any)?.stats ?? {};
  const orderCount = Math.max(0, Number(todayStats?.totalOrders?.value ?? 0));
  const todayRevenue = todayStats?.totalRevenue?.value ?? 0;
  const displayName = profileData?.data?.farmName || profileData?.data?.ownerName || farmerName;
  const farmerEmail = (session?.user as any)?.email || profileData?.data?.email || "";
  const farmerRating = profileData?.data?.rating;
  const farmerRatingCount = profileData?.data?.ratingCount ?? 0;

  return (
    <aside className="role-sidebar hidden w-64 shrink-0 border-r border-slate-200/80 bg-white md:block">
      <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto p-4 lg:p-5">
        <div className="mb-6 overflow-hidden rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 shadow-sm">
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

        <nav className="space-y-4">
          {navGroups.map((group) => (
            <div key={group.label}>
              <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{group.label}</p>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-150",
                        isActive ? "bg-emerald-700 text-white shadow-sm shadow-emerald-900/10" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <item.icon className="h-5 w-5" />
                        <span>{item.name}</span>
                      </div>
                      {item.name === "Orders" && orderCount > 0 && (
                        <span
                          aria-label={`${orderCount} orders today`}
                          title={`${orderCount} orders today`}
                          className={cn(
                            "inline-flex h-5 min-w-6 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none tabular-nums",
                            isActive
                              ? "bg-white text-emerald-800 ring-1 ring-inset ring-white/70"
                              : "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-100"
                          )}
                        >
                          {orderCount}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-6 rounded-lg border border-dashed p-4">
          <div className="flex flex-col items-center text-center">
            <Plus className="h-8 w-8 text-gray-500" />
            <p className="mt-2 text-sm font-medium">Add New Product</p>
            <p className="text-xs text-gray-500">List your fresh produce</p>
            <Link href="/farmer/products/new" className="mt-3 w-full">
              <Button size="sm" className="w-full">
                Add Product
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </aside>
  );
}
