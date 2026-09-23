"use client";

import { usePathname } from "next/navigation";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";

const HIDDEN_LAYOUT_PREFIXES = ["/admin", "/login", "/register", "/verify"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const currentPath = pathname ?? "/";
  const hideChrome = HIDDEN_LAYOUT_PREFIXES.some((prefix) => currentPath.startsWith(prefix));

  if (hideChrome) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
