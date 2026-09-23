import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <main className="site-main" aria-busy="true" aria-live="polite">
      <div className="page-container">
        <div className="mb-6 space-y-2">
          <div className="h-8 w-56 animate-pulse rounded-lg bg-slate-200" />
          <div className="h-4 w-96 max-w-full animate-pulse rounded bg-slate-100" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1,2,3,4].map((item) => <div key={item} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="h-4 w-24 animate-pulse rounded bg-slate-100"/><div className="mt-4 h-8 w-28 animate-pulse rounded bg-slate-200"/></div>)}
        </div>
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin text-emerald-600"/>Loading AgriConnect...</div>
          <div className="mt-5 space-y-3"><div className="h-4 animate-pulse rounded bg-slate-100"/><div className="h-4 w-5/6 animate-pulse rounded bg-slate-100"/><div className="h-4 w-2/3 animate-pulse rounded bg-slate-100"/></div>
        </div>
      </div>
    </main>
  );
}
