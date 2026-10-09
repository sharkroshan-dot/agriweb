"use client";

import { PrefetchLink as Link } from "./prefetch-link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  Bell,
  BarChart3,
  Boxes,
  CalendarDays,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  MapPinned,
  Package,
  Route,
  ShoppingCart,
  Truck,
  Users,
  Warehouse,
} from "lucide-react";

type Role = "farmer" | "warehouse" | "delivery" | "business" | "admin";
type Item = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
};

const navigation: Record<Role, Item[]> = {
  farmer: [
    { label: "Dashboard", href: "/farmer/dashboard", icon: LayoutDashboard },
    { label: "Orders", href: "/farmer/orders", icon: ShoppingCart },
    { label: "Products", href: "/farmer/products", icon: Package },
    { label: "Order Map", href: "/farmer/order-map", icon: MapPinned },
    { label: "Calendar", href: "/farmer/delivery-calendar", icon: CalendarDays },
    { label: "Smart Route", href: "/farmer/smart-route", icon: Route },
  ],
  warehouse: [
    { label: "Dashboard", href: "/warehouse/dashboard", icon: LayoutDashboard },
    { label: "Pickup Partners", href: "/pickup-team", icon: Users },
    { label: "Incoming", href: "/incoming", icon: ArrowDownToLine },
    { label: "Collections", href: "/collections", icon: Truck },
    { label: "Farmer Fulfillment", href: "/warehouse/farmer-fulfillment", icon: Route },
    { label: "Stock", href: "/stock", icon: Boxes },
    { label: "Packing", href: "/packing", icon: Package },
    { label: "Transfers", href: "/transfers", icon: ArrowLeftRight },
    { label: "Notifications", href: "/notifications", icon: Bell },
  ],
  delivery: [
    { label: "Dashboard", href: "/delivery/dashboard", icon: LayoutDashboard },
    { label: "Deliveries", href: "/delivery/deliveries", icon: Truck },
    { label: "Route", href: "/delivery/route", icon: Route },
    { label: "Earnings", href: "/delivery/earnings", icon: CreditCard },
    { label: "History", href: "/delivery/history", icon: ClipboardList },
  ],
  business: [
    { label: "Dashboard", href: "/business/dashboard", icon: LayoutDashboard },
    { label: "RFQs", href: "/business/rfqs", icon: ClipboardList },
    { label: "Orders", href: "/business/orders", icon: ShoppingCart },
    { label: "Deliveries", href: "/business/deliveries", icon: Truck },
    { label: "Suppliers", href: "/business/suppliers", icon: Users },
    { label: "Analytics", href: "/business/analytics", icon: BarChart3 },
  ],
  admin: [
    { label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
    { label: "Orders", href: "/admin/orders", icon: ShoppingCart },
    { label: "Farmers", href: "/admin/farmers", icon: Users },
    { label: "Warehouses", href: "/admin/warehouses", icon: Warehouse },
    { label: "Delivery", href: "/admin/delivery", icon: Truck },
    { label: "Analytics", href: "/admin/analytics", icon: BarChart3 },
  ],
};

export function RoleMobileNav({ role }: { role: Role }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={`${role} quick navigation`}
      className="border-b border-slate-200 bg-white px-3 py-2 md:hidden"
    >
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {navigation[role].map((item) => {
          const active =
            pathname === item.href || pathname?.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 ${
                active
                  ? "bg-emerald-700 text-white"
                  : "bg-slate-50 text-slate-600 hover:bg-emerald-50 hover:text-emerald-800"
              }`}
            >
              <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
