"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote, CalendarDays,
  CheckCircle2, Clock3, CreditCard, Download, RefreshCw, Search, ShieldCheck,
  Wallet, XCircle, Gift, Smartphone, Landmark, PackageCheck, ShoppingCart,
} from "lucide-react";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { formatDate, formatPrice } from "../../lib/utils";
import { api } from "../../lib/api/client";

type Row = {
  id: string; date?: string; type: string; description: string; reference: string;
  amount: number; direction: "credit" | "debit"; status: string; method: string;
};

const statusClasses: Record<string, string> = {
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  paid: "border-emerald-200 bg-emerald-50 text-emerald-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  processing: "border-blue-200 bg-blue-50 text-blue-700",
  failed: "border-rose-200 bg-rose-50 text-rose-700",
  refunded: "border-violet-200 bg-violet-50 text-violet-700",
  partially_refunded: "border-violet-200 bg-violet-50 text-violet-700",
};

function rowsFrom(payload: any): any[] {
  const candidates = [
    payload?.data?.transactions, payload?.data?.entries, payload?.data?.payments,
    payload?.data?.items, payload?.data?.data?.transactions, payload?.data?.data?.entries,
    payload?.data?.data?.payments, payload?.data?.data?.items, payload?.data?.data,
    payload?.transactions, payload?.entries, payload?.payments, payload?.items,
    payload?.data, payload,
  ];
  return candidates.find(Array.isArray) || [];
}

function paymentMethodLabel(item: any): string {
  const raw = item.paymentMethod ?? item.payment_method ?? item.method ??
    item.paymentMode ?? item.payment_mode ?? item.gateway ?? item.provider ??
    item.metadata?.paymentMethod ?? item.metadata?.payment_method ?? item.metadata?.method;
  if (!raw || typeof raw !== "string") return "Payment";
  const normalized = raw.trim().toLowerCase().replace(/[\\s-]+/g, "_");
  const labels: Record<string, string> = {
    cod: "Cash on Delivery (COD)",
    cash: "Cash",
    cash_on_delivery: "Cash on Delivery (COD)",
    upi: "UPI",
    razorpay: "Razorpay",
    card: "Debit / Credit Card",
    credit_card: "Credit Card",
    debit_card: "Debit Card",
    net_banking: "Net Banking",
    netbanking: "Net Banking",
    wallet: "Wallet",
    agriconnect_wallet: "AgriConnect Wallet",
  };
  return labels[normalized] || raw.trim().replaceAll("_", " ").replace(/\\b\\w/g, value => value.toUpperCase());
}

function Status({ value }: { value: string }) {
  const status = String(value || "completed").toLowerCase();
  const label = status.replaceAll("_", " ").replace(/\b\w/g, x => x.toUpperCase());
  return <Badge variant="outline" className={statusClasses[status] || "border-slate-200 bg-slate-50 text-slate-600"}>{label}</Badge>;
}

function Summary({ title, value, hint, icon: Icon, tone }: {
  title: string; value: string; hint: string; icon: any; tone: "green" | "amber" | "violet";
}) {
  const tones = {
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    violet: "bg-violet-50 text-violet-700",
  };
  return <Card className="min-h-[126px] border-slate-200/90 shadow-sm"><CardContent className="flex h-full min-h-[126px] items-center gap-3 p-4 sm:p-5">
    <span className={`rounded-xl p-3 ${tones[tone]}`}><Icon className="h-5 w-5"/></span>
    <div className="min-w-0"><p className="text-xs font-medium text-slate-500">{title}</p><p className="mt-1 truncate text-xl font-bold tracking-tight text-slate-950">{value}</p><p className="mt-0.5 text-[11px] text-slate-500">{hint}</p></div>
  </CardContent></Card>;
}

export default function CustomerPaymentsWallet() {
  const [tab, setTab] = useState<"all" | "wallet" | "payments" | "refunds">("all");
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("30");
  const [showAddMoney, setShowAddMoney] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState("500");
  const [topUpMethod, setTopUpMethod] = useState("upi");
  const [topUpBusy, setTopUpBusy] = useState(false);
  const [topUpError, setTopUpError] = useState("");
  const ledgerQuery = useQuery({
    queryKey: ["customer-payment-ledger"],
    queryFn: () => api.get("/customers/me/payments", { params: { page: 1, limit: 100 } }),
  });
  const refundsQuery = useQuery({
    queryKey: ["customer-payment-refunds"],
    queryFn: () => api.get("/customers/me/refunds", { params: { page: 1, limit: 100 } }),
    retry: 1,
  });
  const walletQuery = useQuery({
    queryKey: ["customerWallet", "payments-workspace"],
    queryFn: () => api.get("/payments/wallet/info"),
    retry: false,
  });
  const walletTransactionsQuery = useQuery({
    queryKey: ["customerWalletTransactions", "payments-workspace"],
    queryFn: () => api.get("/payments/wallet/transactions", { params: { page: 1, limit: 100 } }),
    retry: false,
  });

  const wallet = (walletQuery.data as any)?.data || walletQuery.data || {};
  const balance = Number(wallet.balance || 0);
  const paymentRows = useMemo<Row[]>(() => rowsFrom(ledgerQuery.data).map((item: any, index: number) => {
    const description = String(item.description || item.metadata?.description || item.type || "Payment transaction");
    const normalizedType = String(item.type || item.transactionType || item.transaction_type || "").toLowerCase();
    const isRefund = normalizedType.includes("refund") || String(item.status || "").toLowerCase().includes("refund");
    const isPoints = normalizedType.includes("point") || description.toLowerCase().includes("agripoint");
    const method = paymentMethodLabel(item);
    return {
      id: String(item.id || item._id || item.reference || item.transactionId || item.paymentId || `payment-${index}`),
      date: item.paymentDate || item.payment_date || item.createdAt || item.date,
      type: isRefund ? "Refund" : isPoints ? "AgriPoints Discount" : method,
      description,
      reference: String(item.reference || item.transactionId || item.transaction_id || item.paymentId || item.orderNumber || item.orderId || "—"),
      amount: Number(item.amount) || 0,
      direction: String(item.direction || (isRefund ? "credit" : "debit")).toLowerCase() === "credit" ? "credit" : "debit",
      status: String(item.status || "completed").toLowerCase(),
      method,
    };
  }), [ledgerQuery.data]);

  const refundRows = useMemo<Row[]>(() => rowsFrom(refundsQuery.data).map((item: any, index: number) => {
    const status = String(item.status || item.refundStatus || item.refund_status || "requested")
      .toLowerCase().replace(/[\\s-]+/g, "_");
    const orderNumber = String(item.orderNumber || item.order_number || item.order?.orderNumber || item.orderId || item.order_id || "");
    const refundId = String(item.refundId || item.refund_id || item.requestId || item.id || item._id || `refund-${index}`);
    const amount = Number(item.approvedAmount ?? item.refundAmount ?? item.refund_amount ?? item.amount ?? item.requestedAmount ?? item.requested_amount ?? 0) || 0;
    const reason = String(item.reason || item.description || "").replaceAll("_", " ");
    const transaction = String(item.refundTransactionId || item.refund_transaction_id || item.transactionId || item.transaction_id || "");
    const method = paymentMethodLabel(item);
    return {
      id: `refund:${refundId}`,
      date: item.processedAt || item.processed_at || item.refundedAt || item.refunded_at || item.updatedAt || item.updated_at || item.requestedAt || item.requested_at || item.createdAt || item.created_at,
      type: "Refund",
      description: `Refund${orderNumber ? ` for order #${orderNumber}` : ""}${reason ? ` · ${reason}` : ""}`,
      reference: transaction || orderNumber || refundId,
      amount,
      direction: "credit",
      status,
      method: method === "Payment" ? "Refund" : method,
    };
  }), [refundsQuery.data]);

  const walletRows = useMemo<Row[]>(() => {
    const transactionPayload = (walletTransactionsQuery.data as any)?.data || walletTransactionsQuery.data || {};
    const raw = rowsFrom(transactionPayload).length ? rowsFrom(transactionPayload) : Array.isArray(wallet.transactions) ? wallet.transactions : [];
    return raw.map((item: any, index: number) => ({
      id: String(item._id || item.id || `wallet-${index}`),
      date: item.createdAt || item.date,
      type: "Wallet",
      description: String(item.description || "Wallet transaction"),
      reference: String(item.reference || item.referenceId || item.referenceType || "—"),
      amount: Number(item.amount) || 0,
      direction: String(item.type || "credit").toLowerCase() === "debit" ? "debit" : "credit",
      status: String(item.status || "completed").toLowerCase(),
      method: "Wallet",
    }));
  }, [wallet.transactions, walletTransactionsQuery.data]);

  const allRows = useMemo(() => {
    const seen = new Set<string>();
    return [...refundRows, ...paymentRows, ...walletRows].filter(row => {
      const key = row.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  }, [refundRows, paymentRows, walletRows]);

  const visibleRows = useMemo(() => {
    const cutoff = period === "all" ? 0 : Date.now() - Number(period) * 86400000;
    const q = search.trim().toLowerCase();
    return allRows.filter(row => {
      const inPeriod = !row.date || new Date(row.date).getTime() >= cutoff;
      const matchesTab = tab === "all" || (tab === "wallet" ? row.type === "Wallet" : tab === "refunds" ? row.type === "Refund" : row.type !== "Wallet" && row.type !== "Refund");
      const matchesSearch = `${row.description} ${row.reference} ${row.type} ${row.method}`.toLowerCase().includes(q);
      return inPeriod && matchesTab && matchesSearch;
    });
  }, [allRows, period, search, tab]);

  const paid = paymentRows.filter(r => ["paid", "success", "completed"].includes(r.status) && r.type === "Payment").reduce((sum, r) => sum + r.amount, 0);
  const pending = paymentRows.filter(r => ["pending", "processing"].includes(r.status)).reduce((sum, r) => sum + r.amount, 0);
  const refunded = paymentRows.filter(r => r.type === "Refund" || ["refunded", "partially_refunded"].includes(r.status)).reduce((sum, r) => sum + r.amount, 0);
  const refresh = () => { void ledgerQuery.refetch(); void refundsQuery.refetch(); void walletQuery.refetch(); void walletTransactionsQuery.refetch(); };
  useEffect(() => {
    if (typeof window === "undefined" || (window as any).Razorpay) return;
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    document.body.appendChild(script);
    return () => { script.remove(); };
  }, []);
  const startWalletTopUp = async () => {
    const amount = Number(topUpAmount);
    if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
      setTopUpError("Enter an amount between ₹1 and ₹1,00,000.");
      return;
    }
    setTopUpBusy(true);
    setTopUpError("");
    try {
      const response: any = await api.post("/payments/wallet/add-funds", { amount, paymentMethod: topUpMethod });
      const payment = response?.data?.data || response?.data || response;
      if (!payment?.payment_id) throw new Error("Unable to start wallet top-up.");
      const verify = async (result: any) => {
        await api.post("/payments/wallet/verify-topup", {
          payment_id: payment.payment_id,
          razorpay_order_id: result.razorpay_order_id || payment.order_id,
          razorpay_payment_id: result.razorpay_payment_id || "simulated_payment",
          razorpay_signature: result.razorpay_signature || "simulated_signature",
        });
        setShowAddMoney(false);
        refresh();
      };
      if (payment.simulated) {
        await verify({});
        setTopUpBusy(false);
        return;
      }
      const Razorpay = (window as any).Razorpay;
      if (!Razorpay) throw new Error("Payment checkout is loading. Please try again.");
      const checkout = new Razorpay({
        key: payment.key_id, amount: payment.amount, currency: payment.currency || "INR",
        name: payment.name || "AgriConnect", description: payment.description || "Wallet top-up",
        order_id: payment.order_id,
        handler: async (result: any) => {
          try { await verify(result); }
          catch (error: any) { setTopUpError(error?.response?.data?.detail || error?.message || "Payment verification failed."); }
          finally { setTopUpBusy(false); }
        },
        theme: payment.theme || { color: "#059669" },
      });
      checkout.on("payment.failed", (event: any) => {
        setTopUpError(event?.error?.description || "Payment was not completed.");
        setTopUpBusy(false);
      });
      checkout.open();
    } catch (error: any) {
      setTopUpError(error?.response?.data?.detail || error?.message || "Unable to add money.");
      setTopUpBusy(false);
    }
  };
  const exportRows = () => {
    const columns = ["Date", "Type", "Description", "Reference", "Amount", "Direction", "Status", "Method"];
    const cell = (v: unknown) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const csv = [columns, ...visibleRows.map(r => [r.date ? formatDate(r.date) : "", r.type, r.description, r.reference, r.amount, r.direction, r.status, r.method])]
      .map(line => line.map(cell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "agriconnect-financial-transactions.csv"; anchor.click(); URL.revokeObjectURL(url);
  };

  const methods = Array.from(new Set(paymentRows.map(r => r.method).filter(m => m && m !== "—")));
  const methodIcon = (method: string) => /upi|phonepe|gpay|paytm/i.test(method) ? Smartphone : /bank|net/i.test(method) ? Landmark : CreditCard;

  return <div className="space-y-5 pb-8">
    <header className="relative isolate flex min-h-[160px] items-center overflow-hidden rounded-xl border border-slate-100 bg-white px-5 pb-4 pt-12 sm:px-7">
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
        <img src="/images/payments-wallet-banner.svg" alt="" className="h-full w-full object-cover object-center opacity-100"/>
        <div className="absolute inset-0 bg-gradient-to-r from-white via-white/95 via-[35%] to-white/0 to-[66%]"/>
      </div>
      <div className="relative z-10 flex w-full items-center gap-4 sm:gap-5">
        <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <Wallet className="h-11 w-11"/>
        </span>
        <div className="min-w-0 max-w-[58%] py-1">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-[34px]">Payments &amp; Wallet</h1>
          <p className="mt-1 text-sm font-semibold leading-5 text-slate-900 sm:text-base">Manage your wallet balance, payments, refunds and transaction history in one place.</p>
        </div>
      </div>
    </header>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1.65fr_1fr_1fr_1fr]">
      <Card className="overflow-hidden border-emerald-800 bg-gradient-to-br from-emerald-700 via-emerald-600 to-green-500 text-white shadow-md">
        <CardContent className="flex min-h-[150px] items-center justify-between gap-4 p-5 sm:p-7">
          <div className="flex min-w-0 items-center gap-4"><span className="hidden rounded-2xl bg-white/15 p-3 sm:block"><Wallet className="h-12 w-12 text-white"/></span><div><p className="text-base font-bold text-emerald-50">Wallet Balance <span className="ml-1 text-emerald-100">ⓘ</span></p><p className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">{walletQuery.isLoading ? "Loading…" : formatPrice(balance)}</p><p className="mt-1 text-xs text-emerald-50/90">{wallet.isActive === false ? "Wallet is currently inactive" : "Available for eligible wallet payments"}</p></div></div>
          <div className="flex shrink-0 flex-col items-center gap-2"><Wallet className="h-10 w-10 text-white/90"/><Button type="button" onClick={() => setShowAddMoney(true)} className="rounded-full bg-white px-5 font-bold text-emerald-800 shadow-sm hover:bg-emerald-50">＋ Add Money</Button></div>
        </CardContent>
      </Card>
      <Summary title="Total Paid" value={formatPrice(paid)} hint="Completed payments" icon={CheckCircle2} tone="green"/>
      <Summary title="Pending" value={formatPrice(pending)} hint="Awaiting confirmation" icon={Clock3} tone="amber"/>
      <Summary title="Refunded" value={formatPrice(refunded)} hint="Refund records in payment history" icon={ArrowDownLeft} tone="violet"/>
    </section>

    <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1 rounded-xl bg-slate-50 p-1">
            {([{id:"all",label:"All Transactions"},{id:"wallet",label:"Wallet Transactions"},{id:"payments",label:"Payments"},{id:"refunds",label:"Refunds"}] as const).map(item =>
              <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors sm:text-sm ${tab === item.id ? "bg-emerald-600 text-white shadow-sm" : "text-slate-600 hover:bg-white hover:text-slate-950"}`}>{item.label}</button>
            )}
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600"><CalendarDays className="h-4 w-4 text-emerald-700"/><select value={period} onChange={e => setPeriod(e.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="30">Last 30 Days</option><option value="90">Last 90 Days</option><option value="365">Last Year</option><option value="all">All Time</option></select></label>
        </div>

        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <div className="border-b border-slate-100 p-4 sm:p-5">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="text-lg font-bold text-slate-950">Transaction History</h2><p className="mt-1 text-sm text-slate-500">Search and review your wallet, payment and refund transactions.</p></div><div className="flex items-center gap-2"><Badge variant="outline">{visibleRows.length} records</Badge><Button size="sm" variant="outline" onClick={exportRows} disabled={!visibleRows.length}><Download className="mr-1.5 h-4 w-4"/>Export</Button></div></div>
            <div className="relative mt-4"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by order number, transaction ID or description..." className="h-10 pl-9"/></div>
          </div>
          {ledgerQuery.isLoading || refundsQuery.isLoading || walletQuery.isLoading || walletTransactionsQuery.isLoading ? <div className="space-y-3 p-5">{[1,2,3].map(i => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100"/>)}</div>
          : ledgerQuery.isError && refundsQuery.isError && walletQuery.isError && walletTransactionsQuery.isError ? <div className="p-8 text-center"><XCircle className="mx-auto h-8 w-8 text-rose-500"/><p className="mt-2 font-semibold">Unable to load financial history</p><Button className="mt-3" size="sm" variant="outline" onClick={refresh}>Try again</Button></div>
          : visibleRows.length === 0 ? <div className="p-10 text-center"><Wallet className="mx-auto h-8 w-8 text-slate-300"/><p className="mt-2 font-semibold text-slate-800">No transactions found</p><p className="mt-1 text-sm text-slate-500">Try another filter or your transactions will appear here when recorded.</p></div>
          : <><div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[760px] text-sm"><thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500"><tr><th className="px-4 py-3">Date &amp; Time</th><th className="px-3 py-3">Type</th><th className="px-3 py-3">Description</th><th className="px-3 py-3">Order ID / Reference</th><th className="px-3 py-3 text-right">Amount</th><th className="px-4 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{visibleRows.map(row => <tr key={row.id} className="hover:bg-emerald-50/30"><td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{row.date ? formatDate(row.date) : "—"}</td><td className="px-3 py-3"><span className="inline-flex items-center gap-2 font-medium text-slate-800">{row.type === "Wallet" ? <Wallet className="h-4 w-4 text-emerald-600"/> : row.type === "Refund" ? <ArrowDownLeft className="h-4 w-4 text-violet-600"/> : row.type === "AgriPoints Discount" ? <Gift className="h-4 w-4 text-amber-600"/> : <CreditCard className="h-4 w-4 text-sky-700"/>}{row.type}</span></td><td className="max-w-[230px] px-3 py-3 text-slate-700">{row.description}</td><td className="px-3 py-3 font-mono text-xs text-slate-600">{row.reference}</td><td className={`whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums ${row.direction === "credit" ? "text-emerald-700" : "text-rose-600"}`}>{row.direction === "credit" ? "+" : "−"}{formatPrice(row.amount)}</td><td className="px-4 py-3"><Status value={row.status}/></td></tr>)}</tbody></table></div><div className="divide-y divide-slate-100 md:hidden">{visibleRows.map(row => <div key={row.id} className="space-y-2 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold text-slate-900">{row.description}</p><p className="mt-1 text-xs text-slate-500">{row.type} · {row.reference}</p></div><Status value={row.status}/></div><div className="flex justify-between text-xs text-slate-500"><span>{row.date ? formatDate(row.date) : "—"}</span><strong className={row.direction === "credit" ? "text-emerald-700" : "text-rose-600"}>{row.direction === "credit" ? "+" : "−"}{formatPrice(row.amount)}</strong></div></div>)}</div></>}
        </Card>
      </div>

      <aside className="space-y-4">
        <Card className="border-slate-200 shadow-sm"><CardContent className="p-4"><div className="flex items-center justify-between"><h2 className="font-bold text-slate-900">Payment Methods</h2><CreditCard className="h-5 w-5 text-emerald-700"/></div>{methods.length ? <div className="mt-3 space-y-2">{methods.slice(0,4).map(method => {const Icon=methodIcon(method);return <div key={method} className="flex items-center gap-2 border-b border-slate-100 py-2 last:border-0"><Icon className="h-4 w-4 text-slate-600"/><span className="text-sm text-slate-700">{method.replaceAll("_"," ")}</span><span className="ml-auto text-[11px] text-slate-500">Used</span></div>})}</div> : <p className="mt-3 text-sm leading-5 text-slate-500">Payment methods will appear here as you complete transactions.</p>}</CardContent></Card>

        <Card className="border-emerald-100 bg-gradient-to-br from-emerald-50 to-white shadow-sm"><CardContent className="p-4"><div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-700"/><h2 className="font-bold text-slate-900">Payment Safety</h2></div><ul className="mt-3 space-y-2 text-sm text-slate-600"><li className="flex gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600"/>Secure and encrypted transactions.</li><li className="flex gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600"/>Payments are verified before an order is marked paid.</li><li className="flex gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600"/>Refunds follow the selected refund destination.</li></ul></CardContent></Card>

        <Card className="border-slate-200 shadow-sm"><CardContent className="p-4"><div className="flex items-center gap-2"><Activity className="h-5 w-5 text-emerald-700"/><h2 className="font-bold text-slate-900">Payment &amp; Refund Lifecycle</h2></div><div className="mt-4 space-y-3">{[{icon:ShoppingCart,label:"Place Order",desc:"Choose products and confirm your order."},{icon:CreditCard,label:"Make Payment",desc:"Pay using your selected payment method."},{icon:PackageCheck,label:"Order Processing",desc:"Your order is prepared and delivered."},{icon:ArrowDownLeft,label:"Refund (if applicable)",desc:"Refunds are processed according to the refund policy."}].map((step,index)=>{const Icon=step.icon;return <div key={step.label} className="flex items-start gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Icon className="h-4 w-4"/></span><div><p className="text-sm font-semibold text-slate-800">{step.label}</p><p className="text-xs leading-5 text-slate-500">{step.desc}</p></div></div>})}</div></CardContent></Card>
      </aside>
    </section>
    {showAddMoney && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="wallet-topup-title">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4"><div><h2 id="wallet-topup-title" className="text-xl font-extrabold text-slate-950">Add Money to Wallet</h2><p className="mt-1 text-sm text-slate-500">Wallet top-up is available through the payment gateway.</p></div><button type="button" onClick={() => setShowAddMoney(false)} className="rounded-full px-3 py-1 text-xl text-slate-500 hover:bg-slate-100" aria-label="Close">×</button></div>
        <label className="mt-5 block text-sm font-semibold text-slate-700">Amount (₹)</label><Input type="number" min="1" max="100000" value={topUpAmount} onChange={e => setTopUpAmount(e.target.value)} className="mt-2 h-12 text-lg font-semibold"/>
        <label className="mt-4 block text-sm font-semibold text-slate-700">Payment Method</label><select value={topUpMethod} onChange={e => setTopUpMethod(e.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="upi">UPI</option><option value="card">Credit / Debit Card</option><option value="netbanking">Net Banking</option></select>
        {topUpError && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{topUpError}</p>}
        <div className="mt-6 flex justify-end gap-3"><Button variant="outline" onClick={() => setShowAddMoney(false)} disabled={topUpBusy}>Cancel</Button><Button onClick={startWalletTopUp} disabled={topUpBusy} className="bg-emerald-700 hover:bg-emerald-800">{topUpBusy ? "Processing…" : "Continue to Pay"}</Button></div>
      </div>
    </div>}
  </div>;
}
