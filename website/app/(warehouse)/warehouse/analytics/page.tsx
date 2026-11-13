"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  Clock3,
  PackageCheck,
  RefreshCw,
  Route,
  ShieldAlert,
  Warehouse,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { cn } from "../../../lib/utils";
import { api } from "../../../lib/api/client";
import { WarehousePageHeader } from "../../../components/warehouse/warehouse-page-header";

type Period = "week" | "month" | "year";
type AnyRow = Record<string, any>;

const asRows = (value: any, key: string): AnyRow[] => {
  const rows = value?.data?.[key] ?? value?.[key] ?? [];
  return Array.isArray(rows) ? rows : [];
};

const statusOf = (row: AnyRow) => String(row?.status ?? row?.stage ?? "unknown").toLowerCase().replaceAll("-", "_");
const qualityOf = (row: AnyRow) => String(row?.qualityCheck ?? row?.qualityStatus ?? row?.inspectionStatus ?? "pending").toLowerCase();
const fulfillmentOf = (row: AnyRow) => {
  const value = String(row?.fulfillmentMethod ?? row?.fulfillmentType ?? row?.sourceMode ?? "").toLowerCase();
  if (value.includes("farmer")) return "Farmer fulfillment";
  if (value.includes("warehouse")) return "Warehouse fulfillment";
  return "Not classified";
};
const localDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dateOf = (row: AnyRow) => {
  const value = row?.receivedAt ?? row?.dispatchedAt ?? row?.createdAt ?? row?.updatedAt ?? row?.expectedDate;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const countMatching = (rows: AnyRow[], predicate: (row: AnyRow) => boolean) => rows.filter(predicate).length;
const number = (value: any) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const formatNumber = (value: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(value);

function MetricCard({
  title,
  value,
  description,
  icon: Icon,
  tone = "slate",
}: {
  title: string;
  value: string | number;
  description: string;
  icon: any;
  tone?: "slate" | "green" | "blue" | "amber";
}) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-50 text-emerald-700",
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
  };
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <span className={cn("rounded-xl p-3", tones[tone])}><Icon className="h-5 w-5" /></span>
      </CardContent>
    </Card>
  );
}

function ProgressRow({ label, value, total, color = "bg-emerald-500" }: { label: string; value: number; total: number; color?: string }) {
  const percent = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold tabular-nums text-slate-900">{value} <span className="font-normal text-slate-400">/ {total}</span></span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export default function WarehouseAnalyticsPage() {
  const [period, setPeriod] = useState<Period>("month");

  const dashboardQuery = useQuery({
    queryKey: ["warehouseAnalyticsDashboard"],
    queryFn: () => api.get("/warehouse/me/dashboard"),
  });
  const incomingQuery = useQuery({
    queryKey: ["warehouseAnalyticsIncoming", period],
    queryFn: () => api.get("/warehouse/me/incoming", {
      params: { limit: 100, date: period === "week" ? "week" : period === "month" ? "month" : "all" },
    }),
  });
  const outgoingQuery = useQuery({
    queryKey: ["warehouseAnalyticsOutgoing"],
    queryFn: () => api.get("/warehouse/me/outgoing", { params: { limit: 100 } }),
  });

  const dashboard = dashboardQuery.data?.data ?? dashboardQuery.data ?? {};
  const incomingItems = useMemo(() => asRows(incomingQuery.data, "incoming"), [incomingQuery.data]);
  const outgoingItems = useMemo(() => asRows(outgoingQuery.data, "outgoing"), [outgoingQuery.data]);
  const isLoading = dashboardQuery.isLoading || incomingQuery.isLoading || outgoingQuery.isLoading;
  const hasError = dashboardQuery.isError || incomingQuery.isError || outgoingQuery.isError;

  const incomingStats = useMemo(() => ({
    total: incomingItems.length,
    received: countMatching(incomingItems, row => ["received", "quality_check", "quality_checked", "accepted", "completed"].includes(statusOf(row)) || Boolean(row.receivedAt)),
    inTransit: countMatching(incomingItems, row => ["in_transit", "assigned", "dispatched"].includes(statusOf(row))),
    passed: countMatching(incomingItems, row => ["passed", "pass", "approved"].includes(qualityOf(row))),
    failed: countMatching(incomingItems, row => ["failed", "fail", "rejected"].includes(qualityOf(row))),
    pendingQuality: countMatching(incomingItems, row => !["passed", "pass", "approved", "failed", "fail", "rejected"].includes(qualityOf(row)) && (["received", "quality_check", "quality_checked"].includes(statusOf(row)) || Boolean(row.receivedAt))),
  }), [incomingItems]);

  const outgoingStats = useMemo(() => ({
    total: outgoingItems.length,
    ready: countMatching(outgoingItems, row => ["pending", "packed", "ready_for_dispatch", "verified"].includes(statusOf(row))),
    dispatched: countMatching(outgoingItems, row => ["dispatched", "in_transit", "delivered", "completed"].includes(statusOf(row))),
  }), [outgoingItems]);

  const qualityDecisionCount = incomingStats.passed + incomingStats.failed;
  const receiptRate = incomingStats.total > 0 ? Math.round((incomingStats.received / incomingStats.total) * 100) : 0;
  const qualityPassRate = qualityDecisionCount > 0 ? Math.round((incomingStats.passed / qualityDecisionCount) * 100) : 0;
  const dispatchProgressRate = outgoingStats.total > 0 ? Math.round((outgoingStats.dispatched / outgoingStats.total) * 100) : 0;

  const fulfillmentStats = useMemo(() => {
    const rows = [...incomingItems, ...outgoingItems];
    return [
      { label: "Farmer fulfillment", count: countMatching(rows, row => fulfillmentOf(row) === "Farmer fulfillment") },
      { label: "Warehouse fulfillment", count: countMatching(rows, row => fulfillmentOf(row) === "Warehouse fulfillment") },
      { label: "Not classified", count: countMatching(rows, row => fulfillmentOf(row) === "Not classified") },
    ];
  }, [incomingItems, outgoingItems]);

  const activityData = useMemo(() => {
    const now = new Date();
    const days = period === "week" ? 7 : period === "month" ? 30 : 12;
    const buckets = Array.from({ length: days }, (_, index) => {
      const date = new Date(now);
      if (period === "year") date.setMonth(now.getMonth() - (days - 1 - index), 1);
      else date.setDate(now.getDate() - (days - 1 - index));
      const key = period === "year"
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
        : localDateKey(date);
      return { key, label: period === "year" ? date.toLocaleDateString("en-IN", { month: "short" }) : date.toLocaleDateString("en-IN", { day: "numeric", month: "short" }), incoming: 0, outgoing: 0 };
    });
    const byKey = new Map(buckets.map(bucket => [bucket.key, bucket]));
    incomingItems.forEach(row => {
      const date = dateOf(row);
      if (!date) return;
      const key = period === "year" ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` : localDateKey(date);
      const bucket = byKey.get(key);
      if (bucket) bucket.incoming += 1;
    });
    outgoingItems.forEach(row => {
      const date = dateOf(row);
      if (!date) return;
      const key = period === "year" ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` : localDateKey(date);
      const bucket = byKey.get(key);
      if (bucket) bucket.outgoing += 1;
    });
    return buckets;
  }, [incomingItems, outgoingItems, period]);

  const capacity = number(dashboard?.capacityUtilization);
  const totalCapacity = number(dashboard?.warehouse?.totalCapacity);
  const usedCapacity = number(dashboard?.warehouse?.usedCapacity);
  const refreshAll = () => {
    dashboardQuery.refetch();
    incomingQuery.refetch();
    outgoingQuery.refetch();
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map(item => <div key={item} className="h-32 animate-pulse rounded-xl bg-slate-100" />)}</div>
        <div className="grid gap-5 lg:grid-cols-3"><div className="h-80 animate-pulse rounded-xl bg-slate-100 lg:col-span-2" /><div className="h-80 animate-pulse rounded-xl bg-slate-100" /></div>
      </div>
    );
  }

  return (
    <div className="min-h-full space-y-6 bg-slate-50/50 pb-8">
      <WarehousePageHeader
        eyebrow="Operations overview"
        title="Warehouse Analytics"
        description="Monitor incoming receipts, quality outcomes and dispatch performance."
        meta={<span>{dashboard?.warehouse?.name || "Warehouse"} · Operational activity summary</span>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="selection-control flex rounded-lg border">
              {(["week", "month", "year"] as const).map(item => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setPeriod(item)}
                  aria-pressed={period === item}
                  className={cn(
                    "selection-item rounded-md px-3 py-1.5 text-sm font-medium capitalize",
                    period === item ? "selection-item-active" : "selection-item-inactive"
                  )}
                >
                  {item}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={refreshAll}
              disabled={dashboardQuery.isFetching || incomingQuery.isFetching || outgoingQuery.isFetching}
              aria-label="Refresh analytics"
              title="Refresh analytics"
            >
              <RefreshCw className={cn("h-4 w-4", (dashboardQuery.isFetching || incomingQuery.isFetching || outgoingQuery.isFetching) && "animate-spin")} />
            </Button>
          </div>
        }
      />

      {hasError && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div><p className="font-semibold">Some analytics could not be loaded</p><p className="mt-1 text-amber-800">The figures below use the records that loaded successfully. Refresh to retry the failed requests.</p></div>
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Incoming records" value={incomingStats.total} description={`${incomingStats.inTransit} currently in transit / assigned`} icon={ArrowDownToLine} tone="blue" />
        <MetricCard title="Received at warehouse" value={incomingStats.received} description="Records marked as received or further along" icon={PackageCheck} tone="green" />
        <MetricCard title="Quality passed" value={incomingStats.passed} description={`${incomingStats.failed} failed · ${incomingStats.pendingQuality} awaiting a quality outcome`} icon={CheckCircle2} tone="green" />
        <MetricCard title="Outgoing records" value={outgoingStats.total} description={`${outgoingStats.dispatched} dispatched or beyond`} icon={ArrowUpFromLine} tone="amber" />
      </section>

      <section aria-label="Operational performance" className="grid gap-3 sm:grid-cols-3">
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Receipt completion</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{receiptRate}%</p></div>
              <span className="rounded-lg bg-blue-50 p-2.5 text-blue-700"><PackageCheck className="h-5 w-5" /></span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-500" style={{ width: `${receiptRate}%` }} /></div>
            <p className="mt-2 text-xs text-slate-500">{incomingStats.received} of {incomingStats.total} incoming records received</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Quality pass rate</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{qualityDecisionCount > 0 ? `${qualityPassRate}%` : "—"}</p></div>
              <span className="rounded-lg bg-emerald-50 p-2.5 text-emerald-700"><CheckCircle2 className="h-5 w-5" /></span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${qualityPassRate}%` }} /></div>
            <p className="mt-2 text-xs text-slate-500">{qualityDecisionCount} completed quality decisions; pending checks excluded</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Dispatch progress</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{outgoingStats.total > 0 ? `${dispatchProgressRate}%` : "—"}</p></div>
              <span className="rounded-lg bg-amber-50 p-2.5 text-amber-700"><Route className="h-5 w-5" /></span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-amber-500" style={{ width: `${dispatchProgressRate}%` }} /></div>
            <p className="mt-2 text-xs text-slate-500">{outgoingStats.dispatched} of {outgoingStats.total} outgoing records dispatched or beyond</p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        <Card className="border-slate-200 shadow-sm xl:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div><CardTitle className="text-base font-semibold">Warehouse activity</CardTitle><CardDescription className="mt-1">Recorded receipts and dispatches across the selected time window. Counts reflect the records currently returned by the APIs.</CardDescription></div>
            <Badge variant="outline" className="capitalize">{period === "year" ? "Rolling 12 months" : period === "month" ? "Last 30 days" : "Last 7 days"}</Badge>
          </CardHeader>
          <CardContent>
            <div className="h-[290px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={activityData} margin={{ top: 10, right: 10, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="incomingFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0f766e" stopOpacity={0.2} /><stop offset="95%" stopColor="#0f766e" stopOpacity={0.01} /></linearGradient>
                    <linearGradient id="outgoingFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2563eb" stopOpacity={0.16} /><stop offset="95%" stopColor="#2563eb" stopOpacity={0.01} /></linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#64748b", fontSize: 11 }} minTickGap={20} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "#64748b", fontSize: 11 }} />
                  <Tooltip contentStyle={{ borderRadius: 12, borderColor: "#e2e8f0", fontSize: 12 }} />
                  <Area type="monotone" dataKey="incoming" name="Incoming" stroke="#0f766e" strokeWidth={2} fill="url(#incomingFill)" />
                  <Area type="monotone" dataKey="outgoing" name="Outgoing" stroke="#2563eb" strokeWidth={2} fill="url(#outgoingFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {activityData.every(row => row.incoming === 0 && row.outgoing === 0) && <p className="text-center text-xs text-slate-400">No dated activity records are available for this period.</p>}
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader><CardTitle className="text-base font-semibold">Quality overview</CardTitle><CardDescription>Quality outcomes recorded on incoming shipments.</CardDescription></CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-sm text-slate-500">Quality decisions recorded</p>
              <p className="mt-1 text-3xl font-semibold text-slate-950">{incomingStats.passed + incomingStats.failed}</p>
              <p className="mt-1 text-xs text-slate-500">Based on the loaded incoming records</p>
            </div>
            <ProgressRow label="Passed" value={incomingStats.passed} total={qualityDecisionCount} color="bg-emerald-500" />
            <ProgressRow label="Failed / rejected" value={incomingStats.failed} total={qualityDecisionCount} color="bg-rose-500" />
            <ProgressRow label="Awaiting outcome" value={incomingStats.pendingQuality} total={incomingStats.total} color="bg-amber-400" />
            <p className="text-xs leading-5 text-slate-400">A pending result is not counted as a pass or failure. Inspection should follow physical receipt.</p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader><CardTitle className="text-base font-semibold">Dispatch readiness</CardTitle><CardDescription>Current status distribution from outgoing shipment records.</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between rounded-xl border border-slate-100 p-4">
              <div className="flex items-center gap-3"><span className="rounded-lg bg-amber-50 p-2 text-amber-700"><Clock3 className="h-5 w-5" /></span><div><p className="font-medium text-slate-800">Ready / awaiting dispatch</p><p className="text-xs text-slate-500">Pending, packed or verified</p></div></div>
              <span className="text-2xl font-semibold tabular-nums text-slate-900">{outgoingStats.ready}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-slate-100 p-4">
              <div className="flex items-center gap-3"><span className="rounded-lg bg-blue-50 p-2 text-blue-700"><Route className="h-5 w-5" /></span><div><p className="font-medium text-slate-800">Dispatched / beyond</p><p className="text-xs text-slate-500">Dispatched, in transit or completed</p></div></div>
              <span className="text-2xl font-semibold tabular-nums text-slate-900">{outgoingStats.dispatched}</span>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-500">Dispatch readiness is based on outgoing shipment status. It does not assume that a shipment is delivered unless its record says so.</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader><CardTitle className="text-base font-semibold">Fulfillment source mix</CardTitle><CardDescription>Source labels found on incoming and outgoing records.</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            {fulfillmentStats.map((item, index) => (
              <ProgressRow key={item.label} label={item.label} value={item.count} total={incomingItems.length + outgoingItems.length} color={index === 0 ? "bg-emerald-500" : index === 1 ? "bg-blue-500" : "bg-slate-300"} />
            ))}
            <p className="text-xs leading-5 text-slate-400">Records without a recognized fulfillment field remain unclassified; they are not assigned to either workflow.</p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader><CardTitle className="text-base font-semibold">Warehouse capacity</CardTitle><CardDescription>Shown only when physical capacity has been configured.</CardDescription></CardHeader>
          <CardContent>
            {totalCapacity > 0 ? (
              <div className="space-y-4">
                <div className="flex items-end justify-between"><div><p className="text-sm text-slate-500">Used capacity</p><p className="mt-1 text-3xl font-semibold text-slate-950">{formatNumber(usedCapacity)}</p></div><p className="text-lg font-semibold text-emerald-700">{Math.round(capacity)}%</p></div>
                <div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.max(0, Math.min(100, capacity))}%` }} /></div>
                <div className="flex justify-between text-xs text-slate-500"><span>Used</span><span>Total capacity: {formatNumber(totalCapacity)}</span></div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
                <Warehouse className="mx-auto h-7 w-7 text-slate-400" />
                <p className="mt-3 text-sm font-medium text-slate-700">Capacity not configured</p>
                <p className="mt-1 text-xs text-slate-500">Set the warehouse's physical capacity to display utilization here.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader><CardTitle className="text-base font-semibold">Data coverage</CardTitle><CardDescription>Records currently available to this dashboard.</CardDescription></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Incoming loaded</p><p className="mt-1 text-2xl font-semibold text-slate-900">{incomingItems.length}</p></div>
            <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Outgoing loaded</p><p className="mt-1 text-2xl font-semibold text-slate-900">{outgoingItems.length}</p></div>
            <div className="col-span-2 rounded-lg border border-slate-100 p-3 text-xs leading-5 text-slate-500">This view uses up to 100 incoming records for the selected filter and up to 100 outgoing records returned by the API. It is an operational snapshot, not a complete historical ledger.</div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
