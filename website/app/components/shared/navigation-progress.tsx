"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Tiny, immediate navigation feedback. It does not wait for the destination
 * page's API requests and disappears as soon as the route changes.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const [state, setState] = useState<"idle" | "loading" | "finishing">("idle");

  useEffect(() => {
    const start = () => setState("loading");
    window.addEventListener("agri:navigation-start", start);
    return () => window.removeEventListener("agri:navigation-start", start);
  }, []);

  useEffect(() => {
    if (state !== "loading") return;
    setState("finishing");
    const timeout = window.setTimeout(() => setState("idle"), 180);
    return () => window.clearTimeout(timeout);
    // A pathname change means the destination route has arrived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (state === "idle") return null;

  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-1 overflow-hidden bg-emerald-100/70"
    >
      <div
        className={`h-full bg-emerald-600 transition-all duration-200 ease-out ${state === "finishing" ? "w-full opacity-0" : "w-3/5 opacity-100"}`}
      />
    </div>
  );
}
