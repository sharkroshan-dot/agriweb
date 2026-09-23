"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { User, LogOut, LayoutDashboard, Settings, Heart, ShoppingCart } from "lucide-react";
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

export function Header() {
  const { data: session, status } = useSession();
  const [liveAvatar, setLiveAvatar] = useState<string | null | undefined>(undefined);

  const role = (session?.user as any)?.role as string | undefined;
  const dashboardHref = role ? `/${role}/dashboard` : "/customer/dashboard";
  const { items: wishlistItems } = useWishlist();
  const cartCount = useCartStore((s: any) => s.items.reduce((sum: number, i: any) => sum + (i.quantity || 0), 0));

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      setLiveAvatar(e.detail);
    };
    window.addEventListener("avatar-updated" as any, handler as any);
    return () => window.removeEventListener("avatar-updated" as any, handler as any);
  }, []);

  const avatarSrc = liveAvatar ?? session?.user?.image;

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-slate-200/70 bg-white/80 shadow-sm shadow-slate-900/5 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-green-700 text-lg font-bold text-white shadow-md shadow-emerald-200">
            A
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight text-slate-900">AgriConnect</p>
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-emerald-700">Fresh daily</p>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 rounded-full border border-slate-200/80 bg-slate-50/70 p-1 text-sm font-medium text-slate-600 md:flex">
          <Link href="/" className="rounded-full px-3 py-1.5 transition hover:bg-white hover:text-emerald-700">Home</Link>
          <Link href="/marketplace" className="rounded-full px-3 py-1.5 transition hover:bg-white hover:text-emerald-700">Marketplace</Link>
          <Link href="/nearby" className="rounded-full px-3 py-1.5 transition hover:bg-white hover:text-emerald-700">Nearby</Link>
          <Link href="/roadmap" className="rounded-full px-3 py-1.5 transition hover:bg-white hover:text-emerald-700">Roadmap</Link>
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          {!session?.user ? (
            <>
              <Link href="/search" className="hidden rounded-full border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-emerald-200 hover:text-emerald-700 sm:inline-flex">
                Browse
              </Link>
              <Link href="/login" className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-emerald-200 transition hover:-translate-y-px hover:bg-emerald-700">
                Sign In
              </Link>
            </>
          ) : (
            <>
              {role === "customer" && (
                <>
                  <Link href="/cart" className="relative flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-slate-100" title="Cart">
                    <ShoppingCart className="h-5 w-5 text-slate-600" />
                    {cartCount > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-semibold text-white">
                        {cartCount}
                      </span>
                    )}
                  </Link>
                  <Link href="/wishlist" className="relative flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-slate-100" title="Wishlist">
                    <Heart className="h-5 w-5 text-slate-600" />
                    {wishlistItems.length > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                        {wishlistItems.length}
                      </span>
                    )}
                  </Link>
                </>
              )}
              <AICopilot />
              <NotificationBell />
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-2 rounded-full p-1 transition hover:bg-slate-100">
                  {avatarSrc ? (
                    <img src={avatarSrc} alt="" className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-medium text-white">
                      {(session.user.name || session.user.email || "U").charAt(0).toUpperCase()}
                    </div>
                  )}
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>{(session.user as any).name || (session.user as any).email}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/profile" className="flex items-center gap-2">
                      <User className="h-4 w-4" />
                      My Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={dashboardHref} className="flex items-center gap-2">
                      <LayoutDashboard className="h-4 w-4" />
                      Dashboard
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/profile/addresses" className="flex items-center gap-2">
                      <Settings className="h-4 w-4" />
                      Addresses
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/" })} className="flex items-center gap-2 text-red-600">
                    <LogOut className="h-4 w-4" />
                    Sign Out
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
