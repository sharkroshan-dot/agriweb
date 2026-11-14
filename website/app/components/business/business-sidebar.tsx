"use client";

import { useState } from "react";

import { usePathname } from "next/navigation";
import { PrefetchLink as Link } from "../shared/prefetch-link";
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
  FileSignature,
  MapPin,
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
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
      { name: "Messages", href: "/business/messages", icon: MessagesSquare },
      { name: "Supply Contracts", href: "/business/contracts", icon: FileSignature },
    ],
  },
  {
    label: "Orders",
    items: [
      { name: "Orders & Deliveries", href: "/business/orders", icon: ShoppingCart },
      { name: "Bulk Fulfillment", href: "/business/bulk-orders", icon: Truck },
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
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken;
  const userLabel = (session?.user?.name || session?.user?.email || "Account").trim();
  const businessName = (session?.user as any)?.name || "Business";

  const { data: profileData } = useQuery({
    queryKey: ["businessProfile"],
    queryFn: () => api.get("/b2b/business/profile"),
    enabled: Boolean(accessToken),
    retry: false,
  });

  const businessProfile = profileData?.data || {};
  const displayName = businessProfile.businessName || businessName;
  const businessTypeLabel = String(businessProfile.businessType || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  const businessLocation = [businessProfile.city || businessProfile.district, businessProfile.state]
    .filter(Boolean)
    .join(", ");
  const isVerified = businessProfile.isVerified === true;

  return (
    <aside className="role-sidebar hidden w-64 shrink-0 border-r border-slate-200/80 bg-white md:block">
      <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto p-4 lg:p-5">
        <div className="mb-6 overflow-hidden rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3.5 shadow-sm">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="agri-header-avatar agri-header-avatar--fallback" aria-hidden="true">
              {userLabel.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="truncate text-sm font-semibold leading-5 text-slate-900" title={displayName}>{displayName}</p>
              <p className="mt-0.5 text-[11px] font-medium text-slate-500">Procurement Console</p>
            </div>
          </div>

          <div className="mt-3 space-y-2 border-t border-emerald-100 pt-3">
            {businessTypeLabel ? (
              <p className="text-xs font-medium text-slate-700">{businessTypeLabel}</p>
            ) : null}
            {businessLocation ? (
              <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-slate-600">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
                <span className="truncate" title={businessLocation}>{businessLocation}</span>
              </div>
            ) : null}
            <div className="flex items-center gap-1.5">
              {isVerified ? (
                <>
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" />
                  <span className="text-[11px] font-semibold text-emerald-800">Verified Business</span>
                </>
              ) : (
                <>
                  <ShieldAlert className="h-3.5 w-3.5 text-amber-700" />
                  <span className="text-[11px] font-semibold text-amber-800">Unverified Business</span>
                </>
              )}
            </div>
          </div>
        </div>

        <nav className="space-y-4">
          {navGroups.map((group) => {
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
                {group.items.map((item) => {
                  const isCreateRfqRoute = pathname === "/business/rfqs/new" || pathname?.startsWith("/business/rfqs/new/");
                  const isActive =
                    pathname === item.href ||
                    (pathname?.startsWith(item.href + "/") &&
                      !(item.href === "/business/rfqs" && isCreateRfqRoute));
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
