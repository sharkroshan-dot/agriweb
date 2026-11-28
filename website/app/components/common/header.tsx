"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  User,
  LogOut,
  LayoutDashboard,
  Settings,
  Heart,
  ShoppingCart,
  Search,
} from "lucide-react";
import { useWishlist } from "../../lib/hooks/use-wishlist";
import { useCartStore } from "../../lib/store/cart-store";
import { NotificationBell } from "../customer/notification-bell";
import { AICopilot } from "./ai-copilot";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu";

type HeaderLink = { href: string; label: string };

const publicLinks: HeaderLink[] = [
  { href: "/", label: "Home" },
  { href: "/marketplace", label: "Marketplace" },
  { href: "/nearby", label: "Nearby" },
  { href: "/roadmap", label: "Roadmap" },
];

const roleNavigation: Record<string, HeaderLink[]> = {
  farmer: [
    { href: "/farmer/orders", label: "Orders" },
    { href: "/farmer/products", label: "Products" },
    { href: "/farmer/packing", label: "Fulfillment" },
    { href: "/farmer/analytics", label: "Analytics" },
  ],
  warehouse: [
    { href: "/incoming", label: "Incoming Stock" },
    { href: "/packing", label: "Packing" },
    { href: "/outgoing", label: "Dispatch" },
    { href: "/warehouse/analytics", label: "Analytics" },
  ],
  delivery: [
    { href: "/delivery/pickup-team", label: "Pickup" },
    { href: "/delivery/deliveries", label: "Deliveries" },
    { href: "/delivery/earnings", label: "Earnings" },
    { href: "/delivery/dashboard", label: "Analytics" },
  ],
  business: [
    { href: "/business/rfqs", label: "RFQs & Contracts" },
    { href: "/business/orders", label: "Orders" },
    { href: "/business/deliveries", label: "Deliveries" },
    { href: "/business/analytics", label: "Analytics" },
  ],
  admin: [
    { href: "/admin/users", label: "Users & Roles" },
    { href: "/workflow", label: "Operations" },
    { href: "/admin/reports", label: "Reports" },
    { href: "/admin/analytics", label: "Analytics" },
  ],
};

// Search targets mirror existing role sidebar destinations. This is navigation
// search only; it does not pretend to search private order or inventory records.
const roleSearchItems: Record<string, HeaderLink[]> = {
  farmer: [
    ...roleNavigation.farmer,
    { href: "/farmer/batches", label: "Batches & Traceability" },
    { href: "/farmer/warehouse-returns", label: "Warehouse Returns" },
    { href: "/farmer/order-map", label: "Order Map" },
    { href: "/farmer/smart-route", label: "Smart Route Planner" },
    { href: "/farmer/route", label: "My Delivery Route" },
    { href: "/farmer/supply-delivery-calendar", label: "Supply & Delivery Calendar" },
    { href: "/farmer/delivery-slots", label: "Delivery Slots" },
    { href: "/farmer/farm-baskets", label: "Farm Baskets" },
    { href: "/farmer/harvests", label: "Harvest Calendar" },
    { href: "/farmer/b2b/rfqs", label: "Business RFQs" },
    { href: "/farmer/b2b/contracts", label: "B2B Supply Contracts" },
    { href: "/farmer/bulk-orders", label: "B2B Fulfillment Orders" },
    { href: "/farmer/earnings", label: "Earnings" },
    { href: "/farmer/customers", label: "Customers" },
    { href: "/farmer/reviews", label: "Ratings & Reviews" },
    { href: "/farmer/messages", label: "Messages" },
  ],
  warehouse: [
    ...roleNavigation.warehouse,
    { href: "/pickup-team", label: "Pickup Partners" },
    { href: "/collections", label: "Farm Collection" },
    { href: "/pickup-routes", label: "Pickup Routes" },
    { href: "/warehouse/b2b-fulfillment", label: "B2B Pickup & Fulfillment" },
    { href: "/warehouse/fulfillment-dispatch", label: "Fulfillment & Dispatch" },
    { href: "/warehouse/farmer-fulfillment", label: "Farmer Fulfillment" },
    { href: "/warehouse/consolidation", label: "Multi-Warehouse Consolidation" },
    { href: "/warehouse/quality-inspection", label: "Quality Inspection" },
    { href: "/warehouse/orders", label: "Customer Orders" },
    { href: "/transfers", label: "Transfers" },
    { href: "/warehouse/payments", label: "Payments" },
  ],
  delivery: [
    ...roleNavigation.delivery,
    { href: "/delivery/pickup-routes", label: "Pickup Routes" },
    { href: "/delivery/pickup-history", label: "Pickup History" },
    { href: "/delivery/orders", label: "Order Map & My Deliveries" },
    { href: "/delivery/order-map", label: "Order Map" },
    { href: "/delivery/route", label: "Delivery Routes" },
    { href: "/delivery/ratings", label: "My Ratings" },
    { href: "/delivery/settlements", label: "COD Collection" },
    { href: "/delivery/support", label: "Support" },
  ],
  business: [
    ...roleNavigation.business,
    { href: "/business/rfqs/new", label: "Create RFQ" },
    { href: "/business/contracts", label: "Supply Contracts" },
    { href: "/business/bulk-orders", label: "Bulk Fulfillment" },
    { href: "/business/payments", label: "Payments" },
    { href: "/business/invoices", label: "Invoices" },
    { href: "/business/suppliers", label: "My Suppliers" },
  ],
  admin: [
    ...roleNavigation.admin,
    { href: "/admin/farmers", label: "Farmers" },
    { href: "/admin/delivery", label: "Delivery Partners" },
    { href: "/admin/warehouses", label: "Warehouses" },
    { href: "/admin/products", label: "Products" },
    { href: "/admin/orders", label: "Orders" },
    { href: "/admin/complaints", label: "Complaints" },
    { href: "/admin/finance", label: "Finance" },
    { href: "/admin/payments", label: "Payments" },
    { href: "/admin/settings", label: "System Settings" },
  ],
};

const roleLabels: Record<string, string> = {
  customer: "Customer",
  farmer: "Farmer",
  business: "Business",
  warehouse: "Warehouse",
  delivery: "Delivery",
  admin: "Admin",
};

export function Header() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [globalSearch, setGlobalSearch] = useState("");
  const [searchMessage, setSearchMessage] = useState("");

  const role = (session?.user as any)?.role as string | undefined;
  const dashboardHref = role ? `/${role}/dashboard` : "/customer/dashboard";
  const roleLabel = role ? roleLabels[role] || "Workspace" : null;
  const userLabel = (session?.user?.name || session?.user?.email || "Account").trim();
  const canSearchProducts = !session?.user || role === "customer";
  const useCustomerHeaderStyle =
    role === "customer" ||
    (!session?.user && (pathname === "/" || pathname === "/login" || pathname === "/register"));
  const isRoleWorkspace = Boolean(session?.user && role && role !== "customer");
  const navigationLinks = isRoleWorkspace ? roleNavigation[role] || [] : publicLinks;
  const searchItems = useMemo(
    () => (role ? roleSearchItems[role] || navigationLinks : navigationLinks),
    [role, navigationLinks]
  );
  const { items: wishlistItems } = useWishlist();
  const cartCount = useCartStore((s: any) =>
    s.items.reduce((sum: number, item: any) => sum + (item.quantity || 0), 0)
  );

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = globalSearch.trim();
    if (!query) {
      if (canSearchProducts) router.push("/marketplace");
      return;
    }

    if (isRoleWorkspace) {
      const normalized = query.toLowerCase();
      const match =
        searchItems.find((item) => item.label.toLowerCase() === normalized) ||
        searchItems.find((item) => item.label.toLowerCase().includes(normalized)) ||
        searchItems.find((item) => normalized.includes(item.label.toLowerCase()));
      if (match) {
        setSearchMessage("");
        router.push(match.href);
      } else {
        setSearchMessage("No matching page found in your workspace.");
      }
      return;
    }

    router.push(`/search?q=${encodeURIComponent(query)}`);
  };

  useEffect(() => {
    const syncSearchFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      setGlobalSearch(params.get("search") || params.get("q") || "");
    };

    syncSearchFromUrl();
    window.addEventListener("popstate", syncSearchFromUrl);
    return () => window.removeEventListener("popstate", syncSearchFromUrl);
  }, [pathname]);

  const isActive = (href: string) =>
    pathname === href || pathname?.startsWith(`${href}/`);

  return (
    <header
      className="agri-site-header"
      data-role={useCustomerHeaderStyle ? "customer" : role || "guest"}
      data-home={pathname === "/" ? "true" : "false"}
      data-login={pathname === "/login" ? "true" : "false"}
    >
      <div className={`agri-site-header-inner${canSearchProducts || isRoleWorkspace ? " has-product-search" : ""}`}>
        <div className="agri-site-header-leading">
          <Link href="/" className="agri-header-brand" aria-label="AgriConnect home">
            <span className="agri-header-brand-mark" aria-hidden="true">A</span>
            <span className="agri-header-brand-copy">
              <span className="agri-header-brand-name">AgriConnect</span>
              <span className="agri-header-brand-tagline">Fresh daily · Farm to home</span>
            </span>
          </Link>
        </div>

        <nav
          className={`agri-header-navigation${useCustomerHeaderStyle ? " flex items-center justify-center gap-1 rounded-full border border-emerald-100 bg-emerald-50/60 p-1" : ""}${isRoleWorkspace ? " is-role-navigation" : ""}`}
          aria-label="Main navigation"
        >
          {navigationLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={`agri-header-nav-link${isActive(item.href) ? " is-active" : ""}${useCustomerHeaderStyle ? " rounded-full px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-white hover:text-emerald-800" : ""}${useCustomerHeaderStyle && isActive(item.href) ? " bg-white text-emerald-800 shadow-sm" : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {(canSearchProducts || isRoleWorkspace) && (
          <form
            className="agri-header-search-form"
            role="search"
            aria-label={isRoleWorkspace ? "Search workspace pages" : "Search fresh products"}
            onSubmit={handleSearch}
          >
            <Search className="agri-header-search-leading-icon h-[18px] w-[18px]" aria-hidden="true" />
            <input
              type="search"
              name={isRoleWorkspace ? "workspaceSearch" : "search"}
              aria-label={isRoleWorkspace ? "Search workspace pages and tools" : "Search products"}
              placeholder={isRoleWorkspace ? "Search anything (orders, products, inventory, etc...)" : "Search vegetables, fruits, grains..."}
              value={globalSearch}
              onChange={(event) => {
                setGlobalSearch(event.target.value);
                setSearchMessage("");
              }}
              list={isRoleWorkspace ? "agri-role-search-options" : undefined}
            />
            {isRoleWorkspace && (
              <datalist id="agri-role-search-options">
                {searchItems.map((item) => <option key={item.href} value={item.label} />)}
              </datalist>
            )}
            <button type="submit" aria-label="Submit search" title="Search">
              <Search className="h-[17px] w-[17px]" aria-hidden="true" />
              <span>Search</span>
            </button>
            {searchMessage && <span className="agri-header-search-feedback" role="status">{searchMessage}</span>}
          </form>
        )}

        <div className="agri-site-header-actions">
          {!session?.user ? (
            <>
              <span className="agri-header-action-divider" aria-hidden="true" />
              <Link href={pathname === "/login" ? "/register" : "/login"} className="agri-header-sign-in">
                {pathname === "/login" ? "Sign up" : "Sign in"}
              </Link>
            </>
          ) : (
            <>
              {role === "customer" && (
                <>
                  <Link href="/cart" aria-label={`Cart, ${cartCount} items`} title="Cart" className="agri-header-icon-link agri-header-count-link">
                    <ShoppingCart className="h-[18px] w-[18px]" />
                    {cartCount > 0 && <span className="agri-header-count">{cartCount > 99 ? "99+" : cartCount}</span>}
                  </Link>
                  <Link href="/wishlist" aria-label={`Wishlist, ${wishlistItems.length} items`} title="Wishlist" className="agri-header-icon-link agri-header-count-link">
                    <Heart className="h-[18px] w-[18px]" />
                    {wishlistItems.length > 0 && <span className="agri-header-count agri-header-count--wishlist">{wishlistItems.length > 99 ? "99+" : wishlistItems.length}</span>}
                  </Link>
                </>
              )}

              <span className="agri-header-action-divider" aria-hidden="true" />
              {isRoleWorkspace && (
                <Link
                  href={dashboardHref}
                  className="agri-header-workspace"
                  aria-label={`Open ${roleLabel} Workspace`}
                  title={`Open ${roleLabel} Workspace`}
                >
                  <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                  <span>{roleLabel} Workspace</span>
                </Link>
              )}
              <div className="agri-header-utility"><AICopilot /></div>
              <div className="agri-header-utility"><NotificationBell /></div>

              <DropdownMenu>
                <DropdownMenuTrigger className="agri-header-profile-trigger" aria-label={`Open ${roleLabel || "account"} menu for ${userLabel}`} title={userLabel}>
                  <span className="agri-header-avatar agri-header-avatar--fallback" aria-hidden="true">
                    {userLabel.charAt(0).toUpperCase()}
                  </span>
                </DropdownMenuTrigger>

                <DropdownMenuContent align="end" className="min-w-56">
                  <DropdownMenuLabel>
                    <span className="block max-w-56 truncate">{userLabel}</span>
                    <span className="mt-0.5 block text-xs font-normal text-slate-500">{roleLabel ? `${roleLabel} workspace` : "AgriConnect account"}</span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/profile" className="flex items-center gap-2">
                      <User className="h-4 w-4" /> My Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={dashboardHref} className="flex items-center gap-2">
                      <LayoutDashboard className="h-4 w-4" /> Dashboard
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={role === "customer" ? "/settings" : "/profile/addresses"} className="flex items-center gap-2">
                      <Settings className="h-4 w-4" /> {role === "customer" ? "Settings" : "Addresses"}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/" })} className="flex items-center gap-2 text-red-600">
                    <LogOut className="h-4 w-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
