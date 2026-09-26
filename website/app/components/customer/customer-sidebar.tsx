"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  MapPin,
  Wheat,
  Landmark,
  Globe,
  ShoppingCart,
  Package,
  Heart,
  CreditCard,
  ArrowUpLeft,
  Ticket,
  MessageSquare,
  User,
  Truck,
  Leaf,
  Sparkles,
  ShieldCheck,
  CalendarClock,
  Wallet,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useWishlist } from "../../lib/hooks/use-wishlist";
import { useCartStore } from "../../lib/store/cart-store";
import { api } from "../../lib/api/client";

const navGroups = [
  {
    label: "Home",
    items: [{ name: "Upcoming Harvests", href: "/harvests", icon: Wheat },{ name: "Home", href: "/customer/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Marketplace",
    items: [
      { name: "Nearby Marketplace", href: "/nearby", icon: MapPin },
      { name: "State Marketplace", href: "/marketplace/state", icon: Landmark },
      { name: "National Marketplace", href: "/marketplace/national", icon: Globe },
      { name: "Trace a Lot", href: "/trace", icon: ShieldCheck },
    ],
  },
  {
    label: "Shopping",
    items: [
      { name: "Cart", href: "/cart", icon: ShoppingCart },
      { name: "Orders", href: "/orders", icon: Package },
      { name: "Delivery Slots", href: "/delivery-slots", icon: Truck },
      { name: "Wishlist", href: "/wishlist", icon: Heart },
      { name: "Bulk & Event Orders", href: "/bulk-orders", icon: Sparkles },
      { name: "Farm Baskets", href: "/subscriptions", icon: CalendarClock },
      { name: "AgriPoints", href: "/agripoints", icon: Leaf },
    ],
  },
  {
    label: "Account",
    items: [
      { name: "Wallet", href: "/wallet", icon: Wallet },
      { name: "Payments", href: "/customer/payments", icon: CreditCard },
      { name: "Refunds & Returns", href: "/refunds", icon: ArrowUpLeft },
      { name: "Coupons", href: "/coupons", icon: Ticket },
      { name: "Reviews", href: "/reviews", icon: MessageSquare },
      { name: "My Impact", href: "/impact", icon: Leaf },
      { name: "Profile", href: "/profile", icon: User },
    ],
  },
];

export function CustomerSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const userName = (session?.user as any)?.name || (session?.user as any)?.email || "Customer";
  const userEmail = (session?.user as any)?.email || "";
  const userImage = (session?.user as any)?.image;
  const { items: wishlistItems } = useWishlist();
  const cartCount = useCartStore((s: any) => s.items.reduce((sum: number, i: any) => sum + (i.quantity || 0), 0));
  const initial = (userName || "C").charAt(0).toUpperCase();

  const { data: profileData } = useQuery({
    queryKey: ["customerSidebarProfile"],
    queryFn: () => api.get("/users/me"),
    enabled: Boolean(session?.user?.role === "customer"),
  });

  const profile = profileData?.data || profileData;
  const userPhone = (session?.user as any)?.phone || profile?.user?.phone || "";
  const addresses = Array.isArray(profile?.addresses) ? profile.addresses : [];
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

  const { data: walletData } = useQuery({
    queryKey: ["customerSidebarWallet"],
    queryFn: () => api.get("/payments/wallet/info"),
    enabled: Boolean(session?.user?.role === "customer"),
  });
  const walletBalance = Number((walletData as any)?.data?.balance || 0);

  return (
    <aside className="hidden w-64 shrink-0 border-r border-slate-200/80 bg-white/80 md:block">
      <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto p-4 lg:p-5">
        <div className="mb-6 flex min-w-0 items-start gap-3 overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-500 to-teal-600 p-4 text-white shadow-sm">
          {userImage ? (
            <img
              src={userImage}
              alt={userName}
              className="h-11 w-11 rounded-full border-2 border-white/60 object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-white/60 bg-white/20 text-lg font-semibold">
              {initial}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight">{userName}</p>
            <p className="truncate text-xs text-emerald-50/90">{userPhone || userEmail}</p>
            {homeLine && (
              <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-emerald-50/80">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{homeLine}</span>
              </p>
            )}
          </div>
        </div>

        <nav className="space-y-4">
          {navGroups.map((group) => (
            <div key={group.label}>
              <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{group.label}</p>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
                  const badge = item.name === "Cart" ? cartCount : item.name === "Wishlist" ? wishlistItems.length : item.name === "Farm Pickup" ? pickupCount : item.name === "Deliveries" ? deliveryCount : item.name === "Wallet" && walletBalance > 0 ? "₹" + walletBalance : 0;
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
            </div>
          ))}
        </nav>
      </div>
    </aside>
  );
}
