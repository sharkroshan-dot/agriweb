"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRight, BadgeCheck, CalendarDays, Check, CheckCircle2, ChevronLeft,
  ChevronRight, CircleDollarSign, Clock3, Eye, Headphones, Loader2, Package,
  PackageCheck, Plus, RefreshCw, RotateCcw, Search, SearchX, ShieldCheck,
  Truck, Wallet, XCircle,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { formatDate, formatPrice, formatTime } from "../../lib/utils";
import { api } from "../../lib/api/client";

type RefundRow = {
  id: string;
  refundId: string;
  orderId?: string;
  orderNumber: string;
  product: string;
  quantity?: string;
  requestType: "return" | "refund";
  amount: number;
  status: string;
  reason?: string;
  requestedAt?: string;
  transactionId?: string;
  rejectionReason?: string;
};

const statusMeta: Record<string, { label: string; className: string }> = {
  requested: { label: "Requested", className: "border-slate-200 bg-slate-100 text-slate-700" },
  under_review: { label: "Under Review", className: "border-amber-200 bg-amber-100 text-amber-800" },
  approved: { label: "Approved", className: "border-emerald-200 bg-emerald-100 text-emerald-800" },
  refund_processing: { label: "Refund in Progress", className: "border-amber-200 bg-amber-100 text-amber-800" },
  refund_in_progress: { label: "Refund in Progress", className: "border-amber-200 bg-amber-100 text-amber-800" },
  refunded: { label: "Refunded", className: "border-emerald-200 bg-emerald-100 text-emerald-800" },
  rejected: { label: "Rejected", className: "border-rose-200 bg-rose-100 text-rose-800" },
  return_received: { label: "Return Received", className: "border-sky-200 bg-sky-100 text-sky-800" },
  returned: { label: "Return Received", className: "border-sky-200 bg-sky-100 text-sky-800" },
  not_applicable: { label: "Not Applicable", className: "border-slate-200 bg-slate-100 text-slate-600" },
};

const reasonLabels: Record<string, string> = {
  ordered_by_mistake: "Ordered by mistake",
  no_longer_needed: "No longer needed",
  delivery_too_slow: "Delivery taking too long",
  found_other: "Found another product",
  wrong_product: "Wrong product",
  missing_quantity: "Missing quantity",
  damaged_product: "Damaged product",
  poor_quality: "Poor quality",
  spoiled_expired: "Spoiled / expired",
  other: "Other",
};

function extractRows(payload: any): any[] {
  const candidates = [
    payload?.data?.refunds, payload?.data?.items, payload?.data?.results,
    payload?.refunds, payload?.items, payload?.results, payload?.data, payload,
  ];
  return candidates.find(Array.isArray) || [];
}

function toTimestamp(value: any): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number" || (typeof value === "string" && /^\\d+$/.test(value))) {
    const numeric = Number(value);
    return numeric < 1000000000000 ? numeric * 1000 : numeric;
  }
  if (typeof value === "object" && value.$date) return toTimestamp(value.$date);
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getRequestType(item: any): "return" | "refund" {
  const value = String(item.requestType || item.request_type || item.requestKind || item.category || item.type || "").toLowerCase();
  const resolution = String(item.resolution || item.requestedResolution || "").toLowerCase();
  return item.isReturn === true || item.returnRequested === true ||
    value.includes("return") || resolution === "replacement" ? "return" : "refund";
}

function getProduct(item: any): { name: string; quantity?: string } {
  const first = Array.isArray(item.affectedItems) ? item.affectedItems[0] : null;
  const product = first?.product || first?.productDetails || first;
  const name = product?.productName || product?.name || product?.title || item.productName || item.product?.name;
  const quantity = first?.quantity ?? first?.requestedQuantity ?? item.quantity;
  return {
    name: name ? String(name) : "Order item",
    quantity: quantity != null ? String(quantity) : undefined,
  };
}

function SummaryCard({ title, value, icon: Icon, tone }: {
  title: string; value: number; icon: any; tone: "green" | "mint" | "amber" | "violet";
}) {
  const styles = {
    green: "border-emerald-100 !bg-gradient-to-br !from-emerald-50 !to-green-100",
    mint: "border-teal-100 !bg-gradient-to-br !from-teal-50 !to-emerald-50",
    amber: "border-amber-100 !bg-gradient-to-br !from-amber-50 !to-orange-50",
    violet: "border-violet-100 !bg-gradient-to-br !from-violet-50 !to-indigo-50",
  };
  const iconStyles = {
    green: "bg-green-100 text-green-700",
    mint: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    violet: "bg-violet-100 text-violet-700",
  };
  return (
    <Card className={`h-[108px] min-h-[108px] self-start rounded-2xl shadow-sm transition-shadow hover:shadow-md ${styles[tone]}`}>
      <CardContent className="flex h-full items-center gap-3 !p-3 sm:gap-4 sm:!p-4">
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full sm:h-[52px] sm:w-[52px] ${iconStyles[tone]}`}>
          <Icon className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={2.5} />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold leading-4 text-slate-800 sm:text-sm">{title}</p>
          <p className="mt-0.5 text-[27px] font-extrabold leading-none tracking-tight text-slate-950 sm:text-[30px]">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CustomerRefundsPage() {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"all" | "returns" | "refunds" | "completed">("all");
  const [period, setPeriod] = useState("30");
  const [page, setPage] = useState(1);
  const pageSize = 5;

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["customerRefunds"],
    queryFn: () => api.get("/customers/me/refunds", { params: { limit: 100 } }),
  });

  const refunds = useMemo<RefundRow[]>(() => extractRows(data).map((item: any, index: number) => {
    const product = getProduct(item);
    const status = String(item.status || item.refundStatus || item.refund_status || "requested").toLowerCase().replace(/[\\s-]+/g, "_");
    return {
      id: String(item.id || item._id || item.refundId || `refund-${index}`),
      refundId: String(item.refundId || item.requestId || item.transactionId || item.id || item._id || `Request ${index + 1}`),
      orderId: item.orderId ? String(item.orderId) : undefined,
      orderNumber: String(item.orderNumber || item.order_number || item.order?.orderNumber || item.orderId || item.order_id || "—"),
      product: product.name,
      quantity: product.quantity,
      requestType: getRequestType(item),
      amount: Number(item.approvedAmount ?? item.refundAmount ?? item.amount ?? item.requestedAmount ?? 0) || 0,
      status,
      reason: reasonLabels[item.reason] || item.reason || undefined,
      requestedAt: item.requestedAt || item.requested_at || item.requestDate || item.request_date || item.createdAt || item.created_at,
      transactionId: item.refundTransactionId || item.transactionId,
      rejectionReason: item.rejectionReason,
    };
  }), [data]);

  const counts = useMemo(() => ({
    all: refunds.length,
    returns: refunds.filter(item => item.requestType === "return").length,
    refunds: refunds.filter(item => item.requestType === "refund" && item.status !== "refunded").length,
    completed: refunds.filter(item => item.status === "refunded").length,
    inProgress: refunds.filter(item => ["requested", "under_review", "approved", "refund_processing", "refund_in_progress"].includes(item.status)).length,
  }), [refunds]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const cutoff = period === "all" ? 0 : Date.now() - Number(period) * 86400000;
    return refunds.filter(item => {
      const matchesTab =
        tab === "all" ||
        (tab === "returns" && item.requestType === "return") ||
        (tab === "refunds" && item.requestType === "refund" && item.status !== "refunded") ||
        (tab === "completed" && item.status === "refunded");
      const matchesSearch = !query || [
        item.refundId, item.orderNumber, item.product, item.requestType, item.status, item.reason,
      ].join(" ").toLowerCase().includes(query);
      const dateValue = toTimestamp(item.requestedAt);
      const matchesPeriod = !cutoff || !dateValue || dateValue >= cutoff;
      return matchesTab && matchesSearch && matchesPeriod;
    });
  }, [refunds, search, tab, period]);

  useEffect(() => {
    if (isLoading || period === "all" || refunds.length === 0) return;
    const cutoff = Date.now() - Number(period) * 86400000;
    const hasRequestsInRange = refunds.some(item => {
      const timestamp = toTimestamp(item.requestedAt);
      return !timestamp || timestamp >= cutoff;
    });
    // If the account has history but none falls inside the selected range,
    // switch to All Time rather than leaving the transaction table misleadingly empty.
    if (!hasRequestsInRange) setPeriod("all");
  }, [isLoading, period, refunds]);

  const totalRefunded = refunds.filter(item => item.status === "refunded").reduce((sum, item) => sum + item.amount, 0);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const tabs = [
    { id: "all" as const, label: "All Requests", count: counts.all },
    { id: "returns" as const, label: "Return Requests", count: counts.returns },
    { id: "refunds" as const, label: "Refunds", count: counts.refunds },
    { id: "completed" as const, label: "Completed", count: counts.completed },
  ];

  return (
    <div className="space-y-4 p-3 sm:space-y-5 sm:p-4 lg:p-5">
      <header className="relative isolate flex h-[190px] min-h-[190px] items-center overflow-hidden rounded-2xl border border-slate-100 bg-white px-5 py-5 shadow-sm sm:px-7">
        <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
          <img src="/images/refunds-returns-banner.svg" alt="" className="h-full w-full object-cover object-center" />
        </div>
        <div className="relative z-10 flex max-w-[72%] items-center gap-4 sm:gap-5">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 shadow-sm sm:h-[76px] sm:w-[76px]">
            <Package className="h-9 w-9 sm:h-10 sm:w-10" />
          </span>
          <div className="min-w-0">
            <h1 className="text-[28px] font-extrabold tracking-tight text-slate-950 sm:text-[34px] lg:text-[38px]">Refunds &amp; Returns</h1>
            <p className="mt-1 max-w-2xl text-sm font-semibold leading-5 text-slate-800 sm:text-base">
              Request a return, track your refund, and check the status of your return requests.
            </p>
          </div>
        </div>
      </header>

      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid grid-cols-2 content-start items-start gap-2.5 lg:grid-cols-4">
          <SummaryCard title="Total Requests" value={counts.all} icon={Package} tone="green" />
          <SummaryCard title="Return Requests" value={counts.returns} icon={RotateCcw} tone="mint" />
          <SummaryCard title="Refunds in Progress" value={counts.inProgress} icon={CircleDollarSign} tone="amber" />
          <SummaryCard title="Completed" value={counts.completed} icon={CheckCircle2} tone="violet" />
        </div>
        <Card className="h-[190px] min-h-[190px] border-slate-200/80 !bg-gradient-to-br !from-white !to-emerald-50/70 shadow-sm">
          <CardContent className="flex h-full flex-col justify-center !p-4">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-emerald-100 p-2 text-emerald-700"><PackageCheck className="h-5 w-5" /></span>
              <h2 className="font-extrabold text-slate-950">Request a Return / Refund</h2>
            </div>
            <p className="mt-2 text-sm leading-5 text-slate-600">Facing an issue with your order? Start a return or refund request from the order details.</p>
            <Button asChild className="mt-3 w-full bg-emerald-700 font-bold hover:bg-emerald-800">
              <Link href="/orders"><Plus className="mr-2 h-4 w-4" />Create Request</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0 overflow-hidden rounded-2xl border-slate-200/90 shadow-sm xl:-mt-[82px]">
          <CardContent className="p-0">
            <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/70 p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
              <div className="flex flex-wrap items-center gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-sm">
                {tabs.map(item => (
                  <button key={item.id} type="button" onClick={() => { setTab(item.id); setPage(1); }}
                    className={`rounded-full px-3 py-2 text-xs font-bold transition sm:px-4 ${tab === item.id ? "bg-emerald-600 text-white shadow-sm" : "text-slate-700 hover:bg-emerald-50 hover:text-emerald-800"}`}>
                    {item.label} ({item.count})
                  </button>
                ))}
              </div>
              <label className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm">
                <CalendarDays className="h-4 w-4 text-emerald-700" />
                <select value={period} onChange={event => { setPeriod(event.target.value); setPage(1); }} className="max-w-[118px] bg-transparent outline-none">
                  <option value="30">Last 30 Days</option>
                  <option value="90">Last 90 Days</option>
                  <option value="all">All Time</option>
                </select>
              </label>
            </div>

            <div className="p-3 sm:p-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <Input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }}
                  placeholder="Search by order number, product, or request ID..."
                  className="h-10 rounded-full border-slate-200 pl-10 text-sm" />
              </div>
            </div>

            {isLoading ? (
              <div className="flex min-h-[280px] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>
            ) : isError ? (
              <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 p-6 text-center">
                <XCircle className="h-10 w-10 text-rose-500" />
                <p className="font-semibold text-slate-800">Unable to load refund requests</p>
                <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="mr-2 h-4 w-4" />Try Again</Button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 p-6 text-center">
                <SearchX className="h-10 w-10 text-slate-400" />
                <p className="font-semibold text-slate-800">{search ? "No matching requests" : "No refund or return requests yet"}</p>
                <p className="max-w-md text-sm text-slate-500">{search ? "Try another search term or change the filters." : "When you request a return or refund from an order, its progress will appear here."}</p>
                <Button asChild className="bg-emerald-700 hover:bg-emerald-800"><Link href="/orders">View Orders</Link></Button>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1020px] border-collapse text-left text-xs sm:text-[13px]">
                    <thead><tr className="bg-slate-100 text-slate-800">
                      {["Request ID", "Order ID", "Product", "Request Type", "Amount", "Request Date", "Status", "Actions"].map(label =>
                        <th key={label} className="whitespace-nowrap px-4 py-4 font-extrabold text-slate-900">{label}</th>
                      )}
                    </tr></thead>
                    <tbody>
                      {visible.map(item => {
                        const meta = statusMeta[item.status] || statusMeta.requested;
                        return (
                          <tr key={item.id} className="border-b border-slate-100 transition-colors hover:bg-emerald-50/50">
                            <td className="whitespace-nowrap px-4 py-4 font-bold text-slate-800">{item.refundId}</td>
                            <td className="whitespace-nowrap px-4 py-4">
                              {item.orderId ? <Link href={`/orders/${item.orderId}`} className="font-bold text-blue-900 hover:text-emerald-700">{item.orderNumber}</Link> : <span className="font-semibold text-slate-700">{item.orderNumber}</span>}
                            </td>
                            <td className="px-4 py-3.5">
                              <div className="flex min-w-[135px] items-center gap-2.5">
                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-2xl" aria-hidden="true">
                                  {/(tomato)/i.test(item.product) ? "🍅" : /(spinach|greens|leaf)/i.test(item.product) ? "🥬" : /(carrot)/i.test(item.product) ? "🥕" : /(potato)/i.test(item.product) ? "🥔" : /(onion)/i.test(item.product) ? "🧅" : "🥦"}
                                </span>
                                <span className="min-w-0"><p className="max-w-[110px] truncate font-bold text-slate-900">{item.product}</p>{item.quantity && <p className="text-slate-500">({item.quantity})</p>}</span>
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-4 py-4">
                              <span className="inline-flex items-center gap-2 font-semibold text-slate-800">
                                <span className={`rounded-full p-1.5 ${item.requestType === "return" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{item.requestType === "return" ? <RotateCcw className="h-3.5 w-3.5" /> : <Wallet className="h-3.5 w-3.5" />}</span>
                                {item.requestType === "return" ? "Return" : "Refund"}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-4 font-extrabold text-slate-900">{formatPrice(item.amount)}</td>
                            <td className="whitespace-nowrap px-4 py-4 text-slate-700">{item.requestedAt ? <>{formatDate(item.requestedAt)}, {formatTime(item.requestedAt)}</> : "—"}</td>
                            <td className="whitespace-nowrap px-4 py-4"><Badge variant="outline" className={`rounded-full px-2.5 py-1 font-bold ${meta.className}`}>{meta.label}</Badge></td>
                            <td className="whitespace-nowrap px-4 py-4">
                              <Button asChild size="sm" variant="outline" className="h-8 rounded-full border-slate-300 px-3 font-semibold text-blue-900 hover:border-emerald-300 hover:text-emerald-800">
                                <Link href={`/refunds/${item.id}`}><Eye className="mr-1.5 h-3.5 w-3.5" />View</Link>
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs font-medium text-slate-600">Showing {filtered.length ? (currentPage - 1) * pageSize + 1 : 0} – {Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} requests</p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" className="h-9 w-9" disabled={currentPage <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}><ChevronLeft className="h-4 w-4" /></Button>
                    {Array.from({ length: pageCount }, (_, index) => index + 1).slice(0, 5).map(number =>
                      <Button key={number} variant={number === currentPage ? "default" : "outline"} size="icon" className={`h-9 w-9 ${number === currentPage ? "bg-emerald-700 hover:bg-emerald-800" : ""}`} onClick={() => setPage(number)}>{number}</Button>
                    )}
                    <Button variant="outline" size="icon" className="h-9 w-9" disabled={currentPage >= pageCount} onClick={() => setPage(value => Math.min(pageCount, value + 1))}><ChevronRight className="h-4 w-4" /></Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <aside className="space-y-3">
          <Card className="border-slate-200/90 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-2"><span className="rounded-full bg-emerald-100 p-2 text-emerald-700"><ArrowLeftRight className="h-5 w-5" /></span><h2 className="font-extrabold text-slate-950">Return &amp; Refund Process</h2></div>
              <div className="mt-4 space-y-4">
                <div className="flex gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Package className="h-5 w-5" /></span><div><p className="text-sm font-bold text-slate-900">Raise Request</p><p className="text-xs leading-4 text-slate-600">Select the order and reason for return or refund.</p></div></div>
                <div className="ml-[17px] h-3 border-l-2 border-emerald-300" />
                <div className="flex gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Truck className="h-5 w-5" /></span><div><p className="text-sm font-bold text-slate-900">Pickup / Verification</p><p className="text-xs leading-4 text-slate-600">Product pickup (if required) and quality check.</p></div></div>
                <div className="ml-4 h-3 border-l-2 border-dashed border-emerald-300" />
                <div className="flex gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><CircleDollarSign className="h-5 w-5" /></span><div><p className="text-sm font-bold text-slate-900">Refund Processing</p><p className="text-xs leading-4 text-slate-600">Approved refunds are credited to the original payment method or wallet.</p></div></div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/90 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-2"><span className="rounded-full bg-emerald-100 p-2 text-emerald-700"><Headphones className="h-5 w-5" /></span><h2 className="font-extrabold text-slate-950">Need Help?</h2></div>
              <p className="mt-2 text-sm text-slate-600">Have questions about returns or refunds?</p>
              <Button asChild variant="outline" className="mt-3 w-full border-emerald-600 font-bold text-emerald-800 hover:bg-emerald-50"><Link href="/messages"><Headphones className="mr-2 h-4 w-4" />Contact Support</Link></Button>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
