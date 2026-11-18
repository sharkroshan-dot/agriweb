"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BadgePercent, History, Loader2, Search, ShoppingBasket } from "lucide-react";
import { api } from "../../../lib/api/client";

type Filter = "all" | "earned" | "used";

export default function AgriPointsHistoryPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["loyalty", "me"],
    queryFn: () => api.get("/loyalty/me"),
    retry: 2,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const transactions = useMemo(() => {
    const raw = Array.isArray(data?.data?.transactions) ? data.data.transactions : [];
    return raw.slice().sort((a: any, b: any) =>
      new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
    );
  }, [data]);

  const filtered = transactions.filter((txn: any) => {
    const points = Number(txn.points ?? 0);
    const matchesType = filter === "all" || (filter === "earned" ? points > 0 : points < 0);
    const term = search.trim().toLowerCase();
    const reference = String(txn.orderId || txn.referenceId || "");
    const description = String(txn.description || txn.reason || "");
    return matchesType && (!term || reference.toLowerCase().includes(term) || description.toLowerCase().includes(term));
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const formatDate = (value: string) => {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  };

  return (
    <main className="min-w-0 space-y-5 pb-8">
      <Link href="/agripoints" className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to AgriPoints
      </Link>
      <section className="rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50 to-white p-5">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold text-slate-950"><History className="h-7 w-7 text-emerald-700" /> All Points Transactions</h1>
        <p className="mt-1 text-sm text-slate-600">Review your earned and redeemed AgriPoints.</p>
      </section>
      {isError && <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><span>Transaction history could not be loaded.</span><button onClick={() => void refetch()} className="rounded-lg border border-amber-300 bg-white px-3 py-2 font-semibold">Retry</button></div>}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
          <div className="flex gap-2">
            {(["all", "earned", "used"] as Filter[]).map((value) => (
              <button key={value} onClick={() => { setFilter(value); setPage(1); }} aria-pressed={filter === value}
                className={`rounded-full border px-4 py-2 text-sm font-bold capitalize ${filter === value ? "border-emerald-700 bg-emerald-700 text-white" : "border-slate-200 text-slate-700 hover:bg-emerald-50"}`}>
                {value === "all" ? "All" : value === "earned" ? "Earned" : "Used"}
              </button>
            ))}
          </div>
          <label className="flex min-w-[220px] items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search order ID" className="w-full bg-transparent text-sm outline-none" />
          </label>
        </div>
        {isLoading ? <div className="flex justify-center p-12"><Loader2 className="h-7 w-7 animate-spin text-emerald-600" /></div> : visible.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500">No transactions match your filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[650px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Date &amp; Time</th><th className="px-4 py-3">Activity</th><th className="px-4 py-3">Order ID</th><th className="px-4 py-3 text-right">Points</th><th className="px-4 py-3 text-center">Status</th></tr></thead>
              <tbody>{visible.map((txn: any, index: number) => {
                const points = Number(txn.points ?? 0);
                const used = points < 0;
                return <tr key={txn.id ?? txn._id ?? `${txn.createdAt ?? "txn"}-${index}`} className="border-t border-slate-100">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(txn.createdAt)}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{txn.description || txn.reason || (used ? "Points used at checkout" : "Points earned for order")}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{txn.orderId || txn.referenceId || "—"}</td>
                  <td className={`whitespace-nowrap px-4 py-3 text-right font-extrabold ${used ? "text-red-600" : "text-emerald-700"}`}>{used ? "−" : "+"}{Math.abs(points).toLocaleString("en-IN")} pts</td>
                  <td className="px-4 py-3 text-center"><span className={`rounded-full px-3 py-1 text-xs font-bold ${used ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{used ? "Used" : "Earned"}</span></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm">
          <span className="text-slate-500">Showing {filtered.length ? (currentPage - 1) * pageSize + 1 : 0}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} transactions</span>
          <div className="flex items-center gap-2">
            <button disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-lg border border-slate-200 px-3 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
            <span className="tabular-nums text-slate-600">Page {currentPage} of {totalPages}</span>
            <button disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="rounded-lg border border-slate-200 px-3 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-40">Next</button>
          </div>
        </div>
      </section>
    </main>
  );
}
