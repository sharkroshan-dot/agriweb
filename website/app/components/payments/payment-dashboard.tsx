"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownLeft,
  Banknote,
  CheckCircle2,
  Clock3,
  CreditCard,
  Download,
  RefreshCw,
  Search,
  ShieldCheck,
  Wallet,
  XCircle,
} from "lucide-react";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { formatPrice, formatDate } from "../../lib/utils";
import { api } from "../../lib/api/client";
import { WarehousePageHeader } from "../warehouse/warehouse-page-header";

type PaymentRole = "customer" | "farmer" | "delivery" | "business" | "warehouse";
type PaymentRow = {
  id: string;
  orderNumber?: string;
  amount: number;
  direction: string;
  status: string;
  reference: string;
  date?: string;
  description: string;
  paymentMethod: string;
  refundAmount: number;
};

const statusMap: Record<string, [string, string]> = {
  success: ["Paid", "border-emerald-200 bg-emerald-50 text-emerald-700"],
  paid: ["Paid", "border-emerald-200 bg-emerald-50 text-emerald-700"],
  completed: ["Completed", "border-emerald-200 bg-emerald-50 text-emerald-700"],
  pending: ["Pending", "border-amber-200 bg-amber-50 text-amber-700"],
  processing: ["Processing", "border-blue-200 bg-blue-50 text-blue-700"],
  failed: ["Failed", "border-rose-200 bg-rose-50 text-rose-700"],
  refunded: ["Refunded", "border-violet-200 bg-violet-50 text-violet-700"],
  partially_refunded: ["Partially refunded", "border-violet-200 bg-violet-50 text-violet-700"],
};

function PaymentStatus({ value }: { value: string }) {
  const normalized = String(value || "unknown").toLowerCase();
  const [label, classes] = statusMap[normalized] || [
    normalized.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase()),
    "border-slate-200 bg-slate-50 text-slate-700",
  ];
  return <Badge variant="outline" className={classes}>{label}</Badge>;
}

function readRows(payload: any, role: PaymentRole): any[] {
  const candidates = role === "customer"
    ? [payload?.data, payload]
    : [payload?.data?.entries, payload?.data?.ledger, payload?.data?.items, payload?.data, payload?.entries, payload?.ledger];
  return candidates.find(Array.isArray) || [];
}

function readWithdrawals(payload: any): any[] {
  const candidates = [payload?.data?.withdrawals, payload?.withdrawals, payload?.data?.items, payload?.data];
  return candidates.find(Array.isArray) || [];
}

function Metric({
  label, value, note, icon: Icon, tone,
}: {
  label: string; value: string; note: string; icon: any; tone: "green" | "blue" | "amber" | "violet";
}) {
  const palette = {
    green: "bg-emerald-50 text-emerald-700",
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    violet: "bg-violet-50 text-violet-700",
  };
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardContent className="flex min-w-0 items-start justify-between gap-3 p-4 sm:p-5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 truncate text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{note}</p>
        </div>
        <span className={`shrink-0 rounded-xl p-2.5 ${palette[tone]}`}><Icon className="h-5 w-5" /></span>
      </CardContent>
    </Card>
  );
}

export default function PaymentDashboard({ role }: { role: PaymentRole }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const ledgerQuery = useQuery({
    queryKey: ["payment-ledger", role],
    queryFn: () => role === "customer"
      ? api.get("/customers/me/payments", { params: { page: 1, limit: 100 } })
      : api.get("/payments/ledger/me", { params: { page: 1, limit: 100 } }),
  });
  const walletQuery = useQuery({
    queryKey: ["payment-wallet"],
    queryFn: () => api.get("/payments/wallet/info"),
    retry: false,
  });
  const payoutQuery = useQuery({
    queryKey: ["payment-withdrawals"],
    queryFn: () => api.get("/payments/wallet/withdrawals", { params: { page: 1, limit: 20 } }),
    retry: false,
    enabled: role !== "customer",
  });

  const rows = useMemo<PaymentRow[]>(() => readRows(ledgerQuery.data, role).map((item: any, index: number) => ({
    id: String(item.id || item._id || item.reference || item.transactionId || item.paymentId || `payment-${index}`),
    orderNumber: item.orderNumber || item.order?.orderNumber,
    amount: Number(item.amount) || 0,
    direction: String(item.direction || "debit").toLowerCase(),
    status: String(item.status || "completed").toLowerCase(),
    reference: String(item.reference || item.transactionId || item.paymentId || item.orderId || "—"),
    date: item.paymentDate || item.createdAt || item.date,
    description: item.description || item.metadata?.description || item.type || "Payment transaction",
    paymentMethod: item.paymentMethod || item.method || "Online",
    refundAmount: Number(item.refundAmount) || 0,
  })), [ledgerQuery.data, role]);

  const withdrawals = useMemo(() => readWithdrawals(payoutQuery.data), [payoutQuery.data]);
  const pendingAmount = rows.filter(row => ["pending", "processing"].includes(row.status)).reduce((sum, row) => sum + row.amount, 0);
  const paidAmount = rows.filter(row => ["paid", "success", "completed"].includes(row.status)).reduce((sum, row) => sum + row.amount, 0);
  const refundedAmount = rows.reduce((sum, row) => sum + row.refundAmount, 0);
  const failedRows = rows.filter(row => row.status === "failed");
  const pendingRows = rows.filter(row => ["pending", "processing"].includes(row.status));
  const paidRows = rows.filter(row => ["paid", "success", "completed"].includes(row.status));
  const matchesStatusFilter = (row: PaymentRow, value: string) => {
    if (value === "all") return true;
    if (value === "paid") return ["paid", "success", "completed"].includes(row.status);
    if (value === "pending") return ["pending", "processing"].includes(row.status);
    if (value === "refunded") return ["refunded", "partially_refunded"].includes(row.status) || row.refundAmount > 0;
    return row.status === value;
  };
  const filterCounts = {
    all: rows.length,
    paid: paidRows.length,
    pending: pendingRows.length,
    refunded: rows.filter(row => ["refunded", "partially_refunded"].includes(row.status) || row.refundAmount > 0).length,
    failed: failedRows.length,
  };
  const visibleRows = rows.filter(row => {
    const query = `${row.description} ${row.reference} ${row.orderNumber || ""} ${row.paymentMethod}`.toLowerCase();
    const matchesSearch = query.includes(search.trim().toLowerCase());
    return matchesSearch && matchesStatusFilter(row, filter);
  });

  const exportVisibleTransactions = () => {
    const columns = ["Transaction", "Order number", "Reference", "Date", "Payment method", "Direction", "Amount", "Status"];
    const safeCell = (value: unknown) => {
      const text = String(value ?? "");
      const protectedText = /^[=+@\- \t\r]/.test(text) ? "'" + text : text;
      return '"' + protectedText.replace(/"/g, '""') + '"';
    };
    const lines = [
      columns.map(safeCell).join(","),
      ...visibleRows.map(row => [
        row.description,
        row.orderNumber || "",
        row.reference,
        row.date || "",
        row.paymentMethod,
        row.direction,
        row.amount,
        row.status,
      ].map(safeCell).join(",")),
    ];
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "warehouse-transactions.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const title = role === "customer" ? "Payments & Wallet"
    : role === "farmer" ? "Payments & Settlements"
    : role === "delivery" ? "Earnings & Payouts"
    : role === "business" ? "Business Payments" : "Warehouse Finance";
  const isWarehouse = role === "warehouse";
  const isLoading = ledgerQuery.isLoading;
  const refresh = () => {
    void ledgerQuery.refetch();
    void walletQuery.refetch();
    if (role !== "customer") void payoutQuery.refetch();
  };

  const headerActions = (
    <Button variant="outline" size="sm" onClick={refresh} disabled={ledgerQuery.isFetching || walletQuery.isFetching || payoutQuery.isFetching}>
      <RefreshCw className={`mr-2 h-4 w-4 ${ledgerQuery.isFetching || walletQuery.isFetching || payoutQuery.isFetching ? "animate-spin" : ""}`} />
      Refresh
    </Button>
  );

  return (
    <div className="min-h-full bg-slate-50/60 p-4 pb-8 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {isWarehouse ? (
          <WarehousePageHeader
            eyebrow="Finance & transactions"
            title="Warehouse Finance"
            description="Track warehouse-related payments, refunds and settlement activity."
            meta={<span>Financial activity · {rows.length} transactions loaded</span>}
            actions={headerActions}
          />
        ) : (
          <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-emerald-700">Account</p>
              <h1 className="text-2xl font-bold text-slate-950 sm:text-3xl">{title}</h1>
              <p className="mt-1 text-sm text-slate-500">View payments, refunds and transaction details in one place.</p>
            </div>
            {headerActions}
          </header>
        )}

        {ledgerQuery.isError && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <div className="flex items-center gap-2"><XCircle className="h-5 w-5 shrink-0" /><span>Payment history could not be loaded. Other available finance information may still be shown.</span></div>
            <Button size="sm" variant="outline" onClick={() => void ledgerQuery.refetch()}>Retry</Button>
          </div>
        )}

        <section aria-label="Payment summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label={isWarehouse ? "Successful payments" : "Total paid"} value={formatPrice(paidAmount)} note={isWarehouse ? `${paidRows.length} completed transactions` : "Successfully completed transactions"} icon={Banknote} tone="green" />
          <Metric label="Pending" value={formatPrice(pendingAmount)} note={isWarehouse ? `${pendingRows.length} awaiting confirmation` : "Awaiting payment confirmation"} icon={Clock3} tone="amber" />
          <Metric label="Refunded" value={formatPrice(refundedAmount)} note="Refund amounts recorded in ledger" icon={ArrowDownLeft} tone="violet" />
          <Metric label={isWarehouse ? "Failed payments" : "Transactions"} value={isWarehouse ? formatPrice(failedRows.reduce((sum, row) => sum + row.amount, 0)) : String(rows.length)} note={isWarehouse ? `${failedRows.length} failed transactions` : "Records returned by payment history"} icon={isWarehouse ? XCircle : Activity} tone={isWarehouse ? "amber" : "blue"} />
        </section>

        <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="min-w-0 overflow-hidden border-slate-200 shadow-sm">
            <div className="border-b border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">{isWarehouse ? "Warehouse transaction ledger" : "Transaction history"}</h2>
                  <p className="mt-1 text-sm text-slate-500">{isWarehouse ? "Review successful, pending, failed and refunded transactions recorded for this warehouse." : "Search and review payment records and their current status."}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{visibleRows.length} of {rows.length} records</Badge>{isWarehouse && <Button type="button" size="sm" variant="outline" onClick={exportVisibleTransactions} disabled={visibleRows.length === 0}><Download className="mr-2 h-4 w-4" />Export CSV</Button>}</div>
              </div>
              <div className="mt-4 flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  {(["all", "paid", "pending", "refunded", "failed"] as const).map(value => (
                    <Button key={value} type="button" size="sm" variant={filter === value ? "default" : "outline"} className="capitalize" onClick={() => setFilter(value)}>
                      <span>{value === "all" ? "All transactions" : value.replace("_", " ")}</span>
                      <span className={cn("ml-2 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums", filter === value ? "bg-white/20 text-current" : "bg-slate-100 text-slate-600")}>{filterCounts[value]}</span>
                    </Button>
                  ))}
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input className="h-10 pl-9" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by order number, transaction ID or payment method" />
                </div>
              </div>
            </div>

            {isLoading ? (
              <div className="space-y-3 p-5">{[1, 2, 3, 4].map(item => <div key={item} className="h-16 animate-pulse rounded-lg bg-slate-100" />)}</div>
            ) : visibleRows.length === 0 ? (
              <div className="flex min-h-[300px] flex-col items-center justify-center px-6 py-12 text-center">
                <span className="rounded-2xl bg-slate-100 p-4 text-slate-500"><CreditCard className="h-7 w-7" /></span>
                <h3 className="mt-4 text-base font-semibold text-slate-900">{rows.length === 0 ? "No payment transactions yet" : "No matching transactions"}</h3>
                <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">
                  {rows.length === 0
                    ? "When a payment or refund is recorded for this warehouse, the transaction will appear here with its reference and status."
                    : "Try another status filter or change your search terms."}
                </p>
                {(search || filter !== "all") && <Button className="mt-4" variant="outline" size="sm" onClick={() => { setSearch(""); setFilter("all"); }}>Clear filters</Button>}
              </div>
            ) : (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-5 py-3">Transaction</th>
                        <th className="px-4 py-3">Reference</th>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Method</th>
                        <th className="px-4 py-3 text-right">Amount</th>
                        <th className="px-5 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visibleRows.map(row => (
                        <tr key={row.id} className="transition-colors hover:bg-emerald-50/30">
                          <td className="px-5 py-4"><p className="font-semibold text-slate-900">{row.description}</p>{row.orderNumber && <p className="mt-0.5 text-xs text-slate-500">Order {row.orderNumber}</p>}</td>
                          <td className="px-4 py-4 font-mono text-xs text-slate-600">{row.reference}</td>
                          <td className="px-4 py-4 text-slate-600">{row.date ? formatDate(row.date) : "—"}</td>
                          <td className="px-4 py-4 capitalize text-slate-600">{String(row.paymentMethod).replaceAll("_", " ")}</td>
                          <td className="px-4 py-4 text-right font-semibold tabular-nums text-slate-900">{row.direction === "credit" ? "+" : "−"}{formatPrice(row.amount)}</td>
                          <td className="px-5 py-4"><PaymentStatus value={row.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="divide-y divide-slate-100 md:hidden">
                  {visibleRows.map(row => (
                    <div key={row.id} className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0"><p className="truncate font-semibold text-slate-900">{row.description}</p><p className="mt-1 break-all font-mono text-xs text-slate-500">{row.reference}</p></div>
                        <PaymentStatus value={row.status} />
                      </div>
                      <div className="flex items-end justify-between gap-3 text-xs text-slate-500"><span>{row.date ? formatDate(row.date) : "Date unavailable"} · {String(row.paymentMethod).replaceAll("_", " ")}</span><strong className="text-sm tabular-nums text-slate-900">{row.direction === "credit" ? "+" : "−"}{formatPrice(row.amount)}</strong></div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>

          <aside className="space-y-4">
            {role !== "customer" && (
              <Card className="border-slate-200 shadow-sm">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div><h2 className="font-semibold text-slate-900">{isWarehouse ? "Recent settlements" : "Recent payouts"}</h2><p className="mt-1 text-sm text-slate-500">{isWarehouse ? "Latest withdrawal and settlement requests" : "Withdrawal and settlement requests"}</p></div>
                    <span className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><Wallet className="h-5 w-5" /></span>
                  </div>
                  {payoutQuery.isError ? (
                    <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-500">Payout information is currently unavailable.</p>
                  ) : withdrawals.length === 0 ? (
                    <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/70 px-3 py-5 text-center">
                      <Wallet className="mx-auto h-5 w-5 text-slate-400" />
                      <p className="mt-2 text-sm font-medium text-slate-700">No payout requests yet</p>
                      <p className="mt-1 text-xs text-slate-500">Payout requests will appear here when recorded.</p>
                    </div>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {withdrawals.slice(0, 5).map((item: any, index: number) => (
                        <div key={String(item.id || item._id || index)} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 p-3">
                          <div><p className="font-semibold text-slate-900">{formatPrice(Number(item.amount) || 0)}</p><p className="mt-0.5 text-xs text-slate-500">{item.createdAt ? formatDate(item.createdAt) : "Date unavailable"}</p></div>
                          <PaymentStatus value={String(item.status || "pending").toLowerCase()} />
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {role === "customer" && (
              <Card className="border-slate-200 shadow-sm">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-700" /><h2 className="font-semibold text-slate-900">Payment safety</h2></div>
                  <p className="mt-2 text-sm leading-6 text-slate-500">Online payments are verified server-side before an order is marked as paid.</p>
                  <Button variant="outline" className="mt-4 w-full" onClick={() => window.location.assign("/refunds")}>View refunds</Button>
                </CardContent>
              </Card>
            )}

            <Card className="border-slate-200 shadow-sm">
              <CardContent className="p-5">
                {isWarehouse ? (
                  <>
                    <div className="flex items-center gap-2"><Activity className="h-5 w-5 text-emerald-700" /><h2 className="font-semibold text-slate-900">Payment status guide</h2></div>
                    <p className="mt-1 text-sm text-slate-500">Use the status to decide what needs follow-up.</p>
                    <div className="mt-4 space-y-3">
                      <div className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /><div><p className="text-sm font-medium text-slate-800">Paid / completed</p><p className="text-xs leading-5 text-slate-500">Payment confirmation is recorded in the ledger.</p></div></div>
                      <div className="flex items-start gap-2"><Clock3 className="mt-0.5 h-4 w-4 text-amber-600" /><div><p className="text-sm font-medium text-slate-800">Pending / processing</p><p className="text-xs leading-5 text-slate-500">Wait for gateway confirmation before treating it as paid.</p></div></div>
                      <div className="flex items-start gap-2"><XCircle className="mt-0.5 h-4 w-4 text-rose-600" /><div><p className="text-sm font-medium text-slate-800">Failed</p><p className="text-xs leading-5 text-slate-500">Review the transaction reference before taking further action.</p></div></div>
                      <div className="flex items-start gap-2"><ArrowDownLeft className="mt-0.5 h-4 w-4 text-violet-600" /><div><p className="text-sm font-medium text-slate-800">Refunded</p><p className="text-xs leading-5 text-slate-500">Refund activity is shown when recorded in the ledger.</p></div></div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2"><Activity className="h-5 w-5 text-emerald-700" /><h2 className="font-semibold text-slate-900">Payment lifecycle</h2></div>
                    <p className="mt-1 text-sm text-slate-500">How a transaction is processed</p>
                    <ol className="mt-4 space-y-3">
                      {["Payment created", "Gateway verification", "Ledger entry", "Settlement / refund"].map((step, index) => (
                        <li key={step} className="flex items-center gap-3 text-sm text-slate-700">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xs font-semibold text-emerald-700">{index + 1}</span>{step}
                        </li>
                      ))}
                    </ol>
                  </>
                )}
              </CardContent>
            </Card>

            {isWarehouse && (
              <Card className="border-emerald-100 bg-emerald-50/50 shadow-sm">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 text-emerald-800"><ShieldCheck className="h-5 w-5" /><h2 className="font-semibold">Finance records</h2></div>
                  <p className="mt-2 text-sm leading-6 text-emerald-900/75">This page is a read-only finance workspace. Use the search, status filters and CSV export to review the loaded ledger records. Totals reflect only the records returned by the finance APIs.</p>
                </CardContent>
              </Card>
            )}
          </aside>
        </section>
      </div>
    </div>
  );
}
