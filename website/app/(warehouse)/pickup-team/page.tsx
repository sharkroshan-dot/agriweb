"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users, CheckCircle2, XCircle, Truck, ShieldCheck, Clock3,
  Search, RefreshCw, Package, Fuel, ClipboardCheck, AlertCircle,
} from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { WarehousePageHeader } from "../../components/warehouse/warehouse-page-header";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { api } from "../../lib/api/client";
import toast from "react-hot-toast";

type ApplicationStatus = "all" | "pending" | "approved" | "rejected";

export default function PickupTeamPage() {
  const [status, setStatus] = useState<ApplicationStatus>("all");
  const [search, setSearch] = useState("");
  const q = useQuery({
    queryKey: ["pickupTeamApplications"],
    queryFn: () => api.get("/warehouse/me/pickup-team/applications"),
    refetchInterval: 15000,
  });
  const apps = q.data?.data?.applications || [];
  const counts = useMemo(() => ({
    all: apps.length,
    pending: apps.filter((a: any) => a.status === "pending").length,
    approved: apps.filter((a: any) => a.status === "approved").length,
    rejected: apps.filter((a: any) => a.status === "rejected").length,
  }), [apps]);
  const filtered = useMemo(() => apps.filter((a: any) => {
    const matchesStatus = status === "all" || a.status === status;
    const term = search.trim().toLowerCase();
    const matchesSearch = !term || [a.vehicleNumber, a.vehicleType, a.vehicleModel, a.fuelType, a.id]
      .some((v) => String(v || "").toLowerCase().includes(term));
    return matchesStatus && matchesSearch;
  }), [apps, status, search]);

  const review = async (id: string, decision: "approve" | "reject") => {
    try {
      await api.put(`/warehouse/me/pickup-team/applications/${id}`, undefined, { params: { decision } });
      toast.success(decision === "approve" ? "Pickup partner approved and added to your team" : "Application rejected");
      await q.refetch();
    } catch (e: any) {
      toast.error(e?.message || "Review failed. Please try again.");
    }
  };

  const statusStyle: Record<string, string> = {
    pending: "border-amber-200 bg-amber-50 text-amber-800",
    approved: "border-emerald-200 bg-emerald-50 text-emerald-800",
    rejected: "border-rose-200 bg-rose-50 text-rose-800",
  };

  return (
    <main className="warehouse-pickup-team-page w-full space-y-6 pb-8">
      <WarehousePageHeader
        eyebrow="Warehouse team management"
        title="Pickup Partners"
        description="Review delivery partner applications and choose who can join your warehouse pickup team."
        meta={<span>{counts.approved} approved partners</span>}
        actions={<Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching} className="gap-2"><RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} /> Refresh</Button>}
      />
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-2 divide-x divide-slate-100 sm:grid-cols-4">
          {[
            { label: "All applications", value: counts.all, icon: ClipboardCheck, tone: "text-slate-600 bg-slate-100" },
            { label: "Awaiting review", value: counts.pending, icon: Clock3, tone: "text-amber-700 bg-amber-50" },
            { label: "Approved", value: counts.approved, icon: CheckCircle2, tone: "text-emerald-700 bg-emerald-50" },
            { label: "Rejected", value: counts.rejected, icon: XCircle, tone: "text-rose-700 bg-rose-50" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-3 px-4 py-4 sm:px-6">
              <span className={`rounded-lg p-2 ${item.tone}`}><item.icon className="h-4 w-4" /></span>
              <span><strong className="block text-xl font-semibold tabular-nums text-slate-900">{q.isError ? "—" : item.value}</strong><span className="text-xs text-slate-500">{item.label}</span></span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">Partner applications</h2>
            <p className="mt-1 text-sm text-slate-500">Check vehicle details and application status before making a decision.</p>
          </div>

        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1">
            {(["all", "pending", "approved", "rejected"] as ApplicationStatus[]).map((key) => (
              <button key={key} onClick={() => setStatus(key)} className={`rounded-lg px-3 py-2 text-xs font-semibold capitalize transition-colors ${status === key ? "bg-emerald-700 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}>
                {key === "all" ? "All applications" : key} <span className={status === key ? "ml-1 text-emerald-100" : "ml-1 text-slate-400"}>{counts[key]}</span>
              </button>
            ))}
          </div>
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vehicle or application…" aria-label="Search pickup partner applications" className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100" />
          </div>
        </div>

        {q.isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[1,2,3].map((n) => <div key={n} className="h-52 animate-pulse rounded-xl border bg-slate-100" />)}</div>
        ) : q.isError ? (
          <Card><CardContent className="flex flex-col items-center px-6 py-12 text-center"><AlertCircle className="h-9 w-9 text-rose-500" /><h3 className="mt-3 font-semibold text-slate-900">Unable to load applications</h3><p className="mt-1 text-sm text-slate-500">Check your connection and try again.</p><Button className="mt-4" onClick={() => q.refetch()}>Try again</Button></CardContent></Card>
        ) : filtered.length === 0 ? (
          <Card><CardContent className="flex flex-col items-center px-6 py-14 text-center">
            <span className="rounded-2xl bg-emerald-50 p-4"><Users className="h-8 w-8 text-emerald-700" /></span>
            <h3 className="mt-4 font-semibold text-slate-900">{search || status !== "all" ? "No matching applications" : "No pickup partner applications yet"}</h3>
            <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">{search || status !== "all" ? "Try changing the search term or status filter." : "When delivery partners apply to join your warehouse pickup team, their applications will appear here for review."}</p>
            {(search || status !== "all") && <Button variant="outline" size="sm" className="mt-4" onClick={() => { setSearch(""); setStatus("all"); }}>Clear filters</Button>}
          </CardContent></Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((a: any) => (
              <Card key={a.id} className="overflow-hidden border-slate-200 shadow-sm transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600"><Truck className="h-5 w-5" /></span>
                    <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{a.vehicleNumber || "Vehicle not specified"}</p><p className="mt-0.5 text-xs text-slate-500">{a.vehicleType || "Vehicle type unavailable"}</p></div>
                  </div>
                  <Badge className={`shrink-0 border capitalize ${statusStyle[a.status] || "border-slate-200 bg-slate-100 text-slate-700"}`}>{a.status || "unknown"}</Badge>
                </div>
                <CardContent className="space-y-4 p-5">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-slate-50 p-3"><div className="flex items-center gap-1.5 text-xs text-slate-500"><Truck className="h-3.5 w-3.5" /> Vehicle model</div><p className="mt-1.5 truncate text-sm font-semibold text-slate-800">{a.vehicleModel || "Not provided"}</p></div>
                    <div className="rounded-lg bg-slate-50 p-3"><div className="flex items-center gap-1.5 text-xs text-slate-500"><Package className="h-3.5 w-3.5" /> Load capacity</div><p className="mt-1.5 text-sm font-semibold text-slate-800">{a.capacity ? `${a.capacity} kg` : "Not provided"}</p></div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-600"><Fuel className="h-4 w-4 text-slate-400" /><span>Fuel type</span><strong className="ml-auto font-medium capitalize text-slate-800">{a.fuelType || "Not provided"}</strong></div>
                  <div className="border-t border-slate-100 pt-3"><p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Application reference</p><p className="mt-1 break-all font-mono text-xs text-slate-500">{a.id || "Not available"}</p></div>
                  {a.status === "pending" ? (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <Button onClick={() => review(a.id, "approve")} className="gap-1.5 bg-emerald-700 hover:bg-emerald-800"><CheckCircle2 className="h-4 w-4" /> Approve partner</Button>
                      <Button variant="outline" onClick={() => review(a.id, "reject")} className="gap-1.5 border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"><XCircle className="h-4 w-4" /> Reject</Button>
                    </div>
                  ) : a.status === "approved" ? (
                    <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs font-medium text-emerald-800"><CheckCircle2 className="h-4 w-4" /> Approved and added to pickup team</div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-600"><ShieldCheck className="h-4 w-4" /> Application review completed</div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        <p className="text-center text-xs text-slate-400">Application list refreshes automatically every 15 seconds.</p>
      </section>
    </main>
  );
}
