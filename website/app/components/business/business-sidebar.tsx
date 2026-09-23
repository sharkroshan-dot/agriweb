"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  PlusCircle,
  FileText,
  MessagesSquare,
  ShoppingCart,
  Truck,
  CreditCard,
  Receipt,
  Users,
  BarChart3,
  Store,
  Briefcase,
  FileSignature,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { api } from "../../lib/api/client";

const navGroups = [
  {
    label: "Overview",
    items: [{ name: "Dashboard", href: "/business/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Procurement",
    items: [
      { name: "Create RFQ", href: "/business/rfqs/new", icon: PlusCircle },
      { name: "My RFQs", href: "/business/rfqs", icon: FileText },
      { name: "Farmer Quotes", href: "/business/quotes", icon: MessagesSquare },
      { name: "Supply Contracts", href: "/business/contracts", icon: FileSignature },
    ],
  },
  {
    label: "Orders",
    items: [
      { name: "B2B Orders", href: "/business/orders", icon: ShoppingCart },
      { name: "Deliveries", href: "/business/deliveries", icon: Truck },
    ],
  },
  {
    label: "Finance",
    items: [
      { name: "Payments", href: "/business/payments", icon: CreditCard },
      { name: "Invoices", href: "/business/invoices", icon: Receipt },
    ],
  },
  {
    label: "Relations",
    items: [
      { name: "My Suppliers", href: "/business/suppliers", icon: Users },
      { name: "Analytics", href: "/business/analytics", icon: BarChart3 },
      { name: "Business Profile", href: "/business/profile", icon: Store },
    ],
  },
];

export function BusinessSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken;
  const businessName = (session?.user as any)?.name || "Business";

  const { data: profileData } = useQuery({
    queryKey: ["businessProfile"],
    queryFn: () => api.get("/b2b/business/profile"),
    enabled: Boolean(accessToken),
    retry: false,
  });

  const displayName = profileData?.data?.businessName || businessName;

  return (
    <aside className="hidden w-64 shrink-0 border-r border-slate-200/80 bg-white/80 md:block">
      <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto p-4 lg:p-5">
        <div className="mb-6 rounded-lg bg-emerald-50 p-4 border border-emerald-100">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
              <Briefcase className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="truncate text-sm font-medium">{displayName}</p>
              <p className="truncate text-xs text-gray-500">Procurement Console</p>
            </div>
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
