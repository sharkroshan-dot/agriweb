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
  FlaskConical,
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
  ShoppingBasket,\n  ThumbsUp,\n  Flame,\n  FileSignature,
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
      { name: "Reviews", href: "/farmer/reviews", icon: Star },\n      { name: "Ratings", href: "/farmer/ratings", icon: ThumbsUp },
      { name: "Harvest Calendar", href: "/farmer/harvests", icon: Sprout },
      { name: "Harvest Planner", href: "/farmer/harvest-planner", icon: CalendarClock },
      { name: "Batches & Traceability", href: "/farmer/batches", icon: Layers },
      { name: "Quality Inspection", href: "/farmer/quality", icon: FlaskConical },
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
      { name: "Farm Impact", href: "/farmer/impact", icon: Leaf },\n      { name: "AI Farm Advisor", href: "/farmer/advisor", icon: Sparkles },\n      { name: "Demand Heatmap", href: "/farmer/demand-heatmap", icon: Flame },
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
      { name: "Business RFQs", href: "/farmer/b2b/rfqs", icon: Briefcase },\n      { name: "Business Contracts", href: "/farmer/b2b/contracts", icon: FileSignature },
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
    <aside className="hidden w-64 shrink-0 border-r border-slate-200/80 bg-white/80 md:block">
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
                      className={cn(
                        "flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                        isActive ? "bg-emerald-600 text-white shadow-sm" : "text-gray-600 hover:bg-slate-100"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <item.icon className="h-5 w-5" />
                        <span>{item.name}</span>
                      </div>
                      {item.name === "Orders" && orderCount > 0 && (
                        <Badge variant={isActive ? "secondary" : "default"} className="px-2 py-0 text-xs">
                          {orderCount}
                        </Badge>
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
