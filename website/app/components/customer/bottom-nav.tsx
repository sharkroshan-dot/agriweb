"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Home, Search, ShoppingCart, Heart, User } from "lucide-react";
import { cn } from "../../lib/utils";

const navItems = [
  { name: "Home", href: "/customer/dashboard", icon: Home },
  { name: "Search", href: "/search", icon: Search },
  { name: "Cart", href: "/cart", icon: ShoppingCart },
  { name: "Wishlist", href: "/wishlist", icon: Heart },
  { name: "Profile", href: "/profile", icon: User },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-white md:hidden">
      <div className="grid h-16 grid-cols-5">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center space-y-0.5 text-xs transition-colors",
                isActive ? "text-emerald-600" : "text-slate-500 hover:text-slate-900"
              )}
            >
              <item.icon className="h-5 w-5" />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
