"use client";

import { useEffect, useRef, useState } from "react";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { PrefetchLink as Link } from "../shared/prefetch-link";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  MapPin,
  Landmark,
  Globe,
  ShoppingCart,
  Package,
  CreditCard,
  ArrowUpLeft,
  Ticket,
  MessageSquare,
  Truck,
  Leaf,
  Sparkles,
  ShieldCheck,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  User,
  Phone,
  Mail,
  CheckCircle2,
  Pencil,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { api } from "../../lib/api/client";

const navGroups = [
  {
    label: "Overview",
    items: [
      { name: "Dashboard", href: "/customer/dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Discover & Shop",
    items: [
      { name: "Marketplace", href: "/marketplace", icon: ShoppingCart },
      { name: "Trace a Lot", href: "/trace", icon: ShieldCheck },
    ],
  },
  {
    label: "Orders & Delivery",
    items: [
      { name: "My Orders", href: "/orders", icon: Package },
      { name: "Delivery Slots", href: "/delivery-slots", icon: Truck },
      { name: "Bulk & Event Orders", href: "/bulk-orders", icon: Sparkles },
    ],
  },
  {
    label: "Shopping & Benefits",
    items: [
      { name: "Farm Basket Subscriptions", href: "/subscriptions", icon: CalendarClock },
      { name: "AgriPoints", href: "/agripoints", icon: Leaf },
      { name: "Coupons", href: "/coupons", icon: Ticket },
      { name: "Payments & Wallet", href: "/payments", icon: CreditCard },
      { name: "Refunds & Returns", href: "/refunds", icon: ArrowUpLeft },
    ],
  },
  {
    label: "Community & Support",
    items: [
      { name: "Messages", href: "/customer/messages", icon: MessageSquare },
    ],
  },
];

export function CustomerSidebar() {
  const pathname = usePathname();
  const sidebarScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sidebarScrollRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname]);
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const { data: session } = useSession();
  const sessionUser = session?.user as any;
  const sessionName = sessionUser?.name || sessionUser?.email || "Customer";
  const sessionEmail = sessionUser?.email || "";

  const { data: profileData } = useQuery({
    queryKey: ["customerSidebarProfile"],
    queryFn: () => api.get("/users/me"),
    enabled: Boolean(session?.user?.role === "customer"),
  });

  const profile = profileData?.data || profileData;
  const profileUser = profile?.user || profile;
  const profileName = [profileUser?.first_name || profileUser?.firstName, profileUser?.last_name || profileUser?.lastName].filter(Boolean).join(" ");
  const userName = profileName || sessionName;
  const userEmail = profileUser?.email || sessionEmail;
  const userPhone = sessionUser?.phone || profileUser?.phone || "";
  const userImage = profileUser?.avatar_url || profileUser?.avatarUrl || sessionUser?.image || "";
  const initial = (userName || "C").charAt(0).toUpperCase();
  const emailVerified = profileUser?.is_verified === true || profileUser?.isVerified === true || profileUser?.email_verified === true;
  const phoneVerified = profileUser?.phone_verified === true || profileUser?.is_phone_verified === true || profileUser?.phoneVerified === true;
  const addresses = Array.isArray(profile?.addresses) ? profile.addresses : Array.isArray(profileUser?.addresses) ? profileUser.addresses : [];
  const homeAddress = useMemo(() => {
    if (addresses.length === 0) return null;
    return (
      addresses.find((a: any) => (a.address_type || "").toLowerCase() === "permanent")
      || addresses.find((a: any) => (a.address_type || "").toLowerCase() === "home")
      || addresses.find((a: any) => a.is_default)
      || addresses[0]
    );
  }, [addresses]);
  const homeLine = useMemo(() => {
    if (!homeAddress) return "";
    const line = [homeAddress.address_line1, homeAddress.city].filter(Boolean).join(", ");
    return line || [homeAddress.city, homeAddress.state].filter(Boolean).join(", ") || "";
  }, [homeAddress]);

  const { data: ordersData } = useQuery({
    queryKey: ["customerSidebarOrders"],
    queryFn: () => api.get("/orders", { params: { limit: 100 } }),
    enabled: Boolean(session?.user?.role === "customer"),
  });

  const customerOrders = useMemo(() => {
    const list = ordersData?.data?.orders || ordersData?.orders || (Array.isArray(ordersData) ? ordersData : []);
    return list.filter((o: any) => !["cancelled", "refunded"].includes((o.orderStatus || o.status || "").toLowerCase()));
  }, [ordersData]);
  const pickupCount = customerOrders.filter((o: any) => (o.deliveryType || "").toLowerCase() === "pickup").length;
  const deliveryCount = customerOrders.filter((o: any) => (o.deliveryType || "delivery").toLowerCase() !== "pickup").length;

  return (
    <aside className="role-sidebar hidden w-64 shrink-0 border-r border-slate-200/80 bg-white md:block">
      <div ref={sidebarScrollRef} className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto p-4 lg:p-5">
        <section aria-label="Customer profile" className="relative isolate mb-5 overflow-hidden rounded-2xl border border-emerald-900/20 bg-gradient-to-br from-emerald-950 via-emerald-800 to-green-700 p-4 text-white shadow-lg shadow-emerald-950/15">
          <div aria-hidden="true" className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/[0.06]" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-10 -left-8 h-28 w-28 rounded-full bg-green-300/[0.08]" />
          <div className="relative z-10">
            <div className="relative mx-auto mb-3 h-24 w-24">
              <div className="h-full w-full overflow-hidden rounded-full border-4 border-white/90 bg-emerald-100 shadow-md ring-2 ring-emerald-300/40">
                {userImage ? (
                  <img src={userImage} alt={userName} className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-emerald-700"><User className="h-11 w-11" /></div>
                )}
              </div>
              <Link href="/profile" aria-label="Edit profile photo" title="Edit profile photo" className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-emerald-800 bg-emerald-500 text-white shadow-md transition-colors hover:bg-emerald-400">
                <Pencil className="h-4 w-4" />
              </Link>
            </div>
            <div className="text-center">
              <p className="relative z-10 break-words text-base font-bold leading-5 tracking-tight text-white" title={userName}>{userName}</p>
              <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-100/80 bg-white px-3 py-1 text-xs font-semibold text-emerald-800 shadow-sm">
                <User className="h-3.5 w-3.5" /> Customer
              </span>
            </div>
            <div className="mt-4 space-y-2.5 border-t border-white/20 pt-3.5">
              {userPhone && (
                <div className="flex min-w-0 items-center gap-2.5 text-xs font-medium text-white/95">
                  <Phone className="h-4 w-4 shrink-0 text-emerald-200" />
                  <span className="min-w-0 flex-1 break-all">{userPhone}</span>
                  {phoneVerified && <CheckCircle2 className="h-4 w-4 shrink-0 fill-emerald-400 text-emerald-950" aria-label="Phone verified" />}
                </div>
              )}
              {userEmail && (
                <div className="flex min-w-0 items-center gap-2.5 text-xs font-medium text-white/95">
                  <Mail className="h-4 w-4 shrink-0 text-emerald-200" />
                  <span className="min-w-0 flex-1 break-all" title={userEmail}>{userEmail}</span>
                  {emailVerified && <CheckCircle2 className="h-4 w-4 shrink-0 fill-emerald-400 text-emerald-950" aria-label="Email verified" />}
                </div>
              )}
            </div>
            <Link href="/profile" className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-white/80 bg-white px-3 py-2.5 text-sm font-bold text-emerald-900 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-emerald-50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-emerald-800">
              <Pencil className="h-4 w-4" /> Edit Profile
            </Link>
          </div>
        </section>

        <nav className="space-y-4">
          {navGroups.filter((group) => group.items.some((item) => !["Reviews", "Notifications"].includes(item.name))).map((group) => {
            const hasActiveItem = group.items.some((item) =>
              pathname === item.href || pathname?.startsWith(item.href + "/")
            );
            const isCollapsed = collapsedGroups.includes(group.label) && !hasActiveItem;
            return (
              <section key={group.label} aria-label={group.label} className="space-y-1">
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() => setCollapsedGroups((current) => current.includes(group.label) ? current.filter((label) => label !== group.label) : [...current, group.label])}
                  className="group flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors hover:bg-slate-50"
                >
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 group-hover:text-slate-600">{group.label}</span>
                  {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
                </button>
                {!isCollapsed && (
                  <div className="ml-2 space-y-1 border-l border-slate-200 pl-2">
                {group.items.filter((item) => !["Reviews", "Notifications"].includes(item.name)).map((item) => {
                  const isMarketplaceRoute = item.href === "/marketplace" && (pathname === "/marketplace" || pathname?.startsWith("/marketplace/") || pathname === "/nearby");
                  const isActive = isMarketplaceRoute || pathname === item.href || pathname?.startsWith(item.href + "/");
                  const badge = item.name === "Farm Pickup" ? pickupCount : item.name === "Deliveries" ? deliveryCount : 0;
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
                      {badge > 0 && (
                        <span
                          className={cn(
                            "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold",
                            isActive ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-700"
                          )}
                        >
                          {badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
                )}
              </section>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
