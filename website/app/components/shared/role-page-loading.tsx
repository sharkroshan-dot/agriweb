"use client";

type RolePageLoadingProps = {
  role: "farmer" | "customer" | "delivery" | "warehouse" | "business" | "admin";
};

const roleLabel: Record<RolePageLoadingProps["role"], string> = {
  farmer: "Farmer workspace",
  customer: "Customer workspace",
  delivery: "Delivery workspace",
  warehouse: "Warehouse workspace",
  business: "Business workspace",
  admin: "Admin workspace",
};

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200/80 ${className}`} />;
}

/**
 * Fast route fallback shown while Next.js loads the next page segment.
 * It deliberately avoids data/API requests so navigation feedback is immediate.
 */
export function RolePageLoading({ role }: RolePageLoadingProps) {
  return (
    <main
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={`Loading ${roleLabel[role]}`}
      className="min-h-[60vh] space-y-5"
    >
      <span className="sr-only">Opening {roleLabel[role]}…</span>
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
      </div>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[58px] rounded-xl" />
          ))}
        </div>
      </section>
      <section className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <Skeleton className="mb-4 h-5 w-44" />
          <div className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </section>
    </main>
  );
}
