"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  User,
  LogOut,
  LayoutDashboard,
  Settings,
  Heart,
  ShoppingCart,
  ArrowLeft,
  Search,
  ChevronDown,
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

const primaryLinks = [
  { href: "/", label: "Home" },
  { href: "/marketplace", label: "Marketplace" },
  { href: "/nearby", label: "Nearby" },
  { href: "/roadmap", label: "Roadmap" },
];

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
  const [liveAvatar, setLiveAvatar] = useState<string | null | undefined>(undefined);
  const [globalSearch, setGlobalSearch] = useState("");

  const role = (session?.user as any)?.role as string | undefined;
  const dashboardHref = role ? `/${role}/dashboard` : "/customer/dashboard";
  const roleLabel = role ? roleLabels[role] || "Workspace" : null;
  const userLabel = (session?.user?.name || session?.user?.email || "Account").trim();
  const canSearchProducts = !session?.user || role === "customer";
  const { items: wishlistItems } = useWishlist();
  const cartCount = useCartStore((s: any) =>
    s.items.reduce((sum: number, item: any) => sum + (item.quantity || 0), 0)
  );

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(session?.user ? dashboardHref : "/");
  };

  const handleProductSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = globalSearch.trim();
    router.push(query ? `/search?q=${encodeURIComponent(query)}` : "/search");
  };

  useEffect(() => {
    const handler = (event: CustomEvent) => setLiveAvatar(event.detail);
    window.addEventListener("avatar-updated" as any, handler as any);
    return () => window.removeEventListener("avatar-updated" as any, handler as any);
  }, []);

  useEffect(() => {
    const syncSearchFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      setGlobalSearch(params.get("q") || "");
    };

    syncSearchFromUrl();
    window.addEventListener("popstate", syncSearchFromUrl);
    return () => window.removeEventListener("popstate", syncSearchFromUrl);
  }, [pathname]);

  const avatarSrc = liveAvatar ?? session?.user?.image;
  const showBackButton = pathname !== "/";
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname?.startsWith(`${href}/`);

  return (
    <header className="agri-site-header" data-role={role || "guest"}>
      <div className={`agri-site-header-inner${canSearchProducts ? " has-product-search" : ""}`}>
        <div className="agri-site-header-leading">
          {showBackButton && (
            <button
              type="button"
              onClick={handleBack}
              aria-label="Go back to the previous page"
              title="Go back"
              className="agri-header-back"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
          )}

          <Link href="/" className="agri-header-brand" aria-label="AgriConnect home">
            <span className="agri-header-brand-mark" aria-hidden="true">A</span>
            <span className="agri-header-brand-copy">
              <span className="agri-header-brand-name">AgriConnect</span>
              <span className="agri-header-brand-tagline">Fresh daily · Farm to home</span>
            </span>
          </Link>
        </div>

        <nav className="agri-header-navigation" aria-label="Main navigation">
          {primaryLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={`agri-header-nav-link${isActive(item.href) ? " is-active" : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {canSearchProducts && (
          <form className="agri-header-search-form" role="search" aria-label="Search fresh products" onSubmit={handleProductSearch}>
            <Search className="agri-header-search-leading-icon h-[18px] w-[18px]" aria-hidden="true" />
            <input
              type="search"
              name="q"
              aria-label="Search products"
              placeholder="Search vegetables, fruits, grains..."
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
            />
            <button type="submit" aria-label="Submit product search" title="Search products">
              <Search className="h-[17px] w-[17px]" aria-hidden="true" />
              <span>Search</span>
            </button>
          </form>
        )}

        <div className="agri-site-header-actions">
          {!session?.user ? (
            <Link href="/login" className="agri-header-sign-in">Sign in</Link>
          ) : (
            <>
              {roleLabel && (
                <Link href={dashboardHref} className="agri-header-workspace" title={`Open ${roleLabel} dashboard`}>
                  <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                  <span>{roleLabel} workspace</span>
                </Link>
              )}

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
              <div className="agri-header-utility"><AICopilot /></div>
              <div className="agri-header-utility"><NotificationBell /></div>

              <DropdownMenu>
                <DropdownMenuTrigger className="agri-header-profile-trigger" aria-label="Open account menu">
                  {avatarSrc ? (
                    <img src={avatarSrc} alt="" className="agri-header-avatar" />
                  ) : (
                    <span className="agri-header-avatar agri-header-avatar--fallback">
                      {userLabel.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="agri-header-profile-copy">
                    <span className="agri-header-profile-name">{userLabel}</span>
                    <span className="agri-header-profile-role">{roleLabel || "Account"}</span>
                  </span>
                  <ChevronDown className="agri-header-profile-chevron h-4 w-4" aria-hidden="true" />
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
                    <Link href="/profile/addresses" className="flex items-center gap-2">
                      <Settings className="h-4 w-4" /> Addresses
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
