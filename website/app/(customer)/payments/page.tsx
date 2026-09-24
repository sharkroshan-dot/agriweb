"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CreditCard, Loader2, CheckCircle, XCircle, RefreshCw, ArrowUpLeft, ShieldCheck, ReceiptText, WalletCards } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { formatPrice, formatDate } from "../../lib/utils";
import { api } from "../../lib/api/client";

const statusStyles: Record<string, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  pending: "border-yellow-200 bg-yellow-50 text-yellow-700",
  processing: "border-blue-200 bg-blue-50 text-blue-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  refunded: "border-orange-200 bg-orange-50 text-orange-700",
  partially_refunded: "border-purple-200 bg-purple-50 text-purple-700",
};

const methodLabels: Record<string, string> = {
  cash: "Cash on Delivery",
  cod: "Cash on Delivery",
  razorpay: "Razorpay",
  stripe: "Stripe",
  card: "Card",
  upi: "UPI",
  wallet: "Wallet",
};

const TABS = [
  { key: "all", label: "All" },
  { key: "success", label: "Successful" },
  { key: "pending", label: "Pending" },
  { key: "refunded", label: "Refunded" },
];

export default function CustomerPaymentsPage() {
  const [tab, setTab] = useState("all");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["customerPayments"],
    queryFn: () => api.get("/customers/me/payments", { params: { limit: 100 } }),
  });

  const { data: refundsData } = useQuery({
    queryKey: ["customerPaymentsRefunds"],
    queryFn: () => api.get("/customers/me/refunds", { params: { limit: 100 } }),
  });

  const payments = useMemo(() => {
    const list = data?.data || (Array.isArray(data) ? data : []);
    return list.map((p: any) => ({
      id: p._id || p.id,
      orderId: p.orderId,
      orderNumber: p.orderNumber || p.orderId,
      amount: p.amount || 0,
      method: p.paymentMethod || "",
      status: (p.status || "pending").toLowerCase(),
      transactionId: p.transactionId,
      refundAmount: p.refundAmount,
      date: p.paymentDate || p.createdAt,
    }));
  }, [data]);

  const refunds = useMemo(() => {
    const list = refundsData?.data || (Array.isArray(refundsData) ? refundsData : []);
    return list.map((r: any) => ({
      id: r.id || r._id,
      orderId: r.orderId,
      status: (r.status || "requested").toLowerCase(),
      amount:
        Number(r.approvedAmount ?? r.refundAmount ?? r.amount ?? r.requestedAmount) || 0,
      requestedAt: r.requestedAt || r.createdAt,
    }));
  }, [refundsData]);

  const filtered = useMemo(() => {
    if (tab === "all") return payments;
    if (tab === "refunded")
      return payments.filter((p: any) => p.status === "refunded" || p.status === "partially_refunded");
    return payments.filter((p: any) => p.status === tab);
  }, [payments, tab]);

  const totals = useMemo(() => {
    const totalPaid = payments
      .filter((p: any) => p.status === "success")
      .reduce((s: number, p: any) => s + p.amount, 0);
    // Committed refunds from the refunds collection: approved, processing, completed.
    const committedRefundOrders = new Set(
      refunds
        .filter((r: any) =>
          ["approved", "refund_processing", "refunded"].includes(r.status)
        )
        .map((r: any) => r.orderId)
    );
    const refundRequestTotal = refunds
      .filter((r: any) =>
        ["approved", "refund_processing", "refunded"].includes(r.status)
      )
      .reduce((s: number, r: any) => s + r.amount, 0);
    // Legacy refunds on payment records that have no matching refund request yet.
    const legacyRefundTotal = payments
      .filter(
        (p: any) =>
          (p.status === "refunded" || p.status === "partially_refunded") &&
          !committedRefundOrders.has(p.orderId)
      )
      .reduce((s: number, p: any) => s + (p.refundAmount || p.amount), 0);
    return {
      totalPaid,
      totalRefunded: refundRequestTotal + legacyRefundTotal,
      count: payments.length,
    };
  }, [payments, refunds]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/customer/dashboard">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">Payments</h1>
          <p className="text-sm text-muted-foreground">Track your payment history</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Transactions</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{totals.count}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Paid</p>
            <p className="mt-1 text-2xl font-bold text-emerald-700">{formatPrice(totals.totalPaid)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Refunded</p>
            <p className="mt-1 text-2xl font-bold text-orange-600">{formatPrice(totals.totalRefunded)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-emerald-200 bg-emerald-50/50"><CardContent className="p-5"><div className="flex items-start gap-3"><ShieldCheck className="h-5 w-5 text-emerald-600"/><div><h2 className="font-semibold text-emerald-900">Secure payment history</h2><p className="mt-1 text-sm text-emerald-800">Online payments are verified by the backend before they are marked successful.</p></div></div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="flex items-start gap-3"><WalletCards className="h-5 w-5 text-blue-600"/><div><h2 className="font-semibold">Wallet & refunds</h2><p className="mt-1 text-sm text-slate-500">Review wallet activity and follow refund requests from your order history.</p></div></div></CardContent></Card>
      </div>

      <div className="flex items-center gap-1 rounded-lg border bg-white p-1 shadow-sm">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-semibold transition-all ${
              tab === t.key
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <XCircle className="h-10 w-10 text-red-500" />
            <p className="font-medium">Failed to load payments</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <CreditCard className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">No payments yet</p>
            <p className="text-sm text-muted-foreground">Your online and cash payments will appear here.</p>
            <Button asChild>
              <Link href="/nearby">Browse products</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((payment: any) => (
            <Card key={payment.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={payment.orderId ? `/orders/${payment.orderId}` : "#"}
                      className="font-medium text-slate-900 hover:text-emerald-700"
                    >
                      Order {String(payment.orderNumber).slice(-8)}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(payment.date)} · {methodLabels[payment.method] || payment.method || "Payment"}
                    </p>
                    {payment.transactionId && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Txn ID: <span className="font-mono">{payment.transactionId}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span className="font-semibold text-slate-900">{formatPrice(payment.amount)}</span>
                    <Badge className={statusStyles[payment.status] || "border-gray-200 bg-gray-50 text-gray-700"}>
                      {payment.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </div>
                {payment.status === "refunded" && payment.refundAmount != null && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-700">
                    <ArrowUpLeft className="h-3.5 w-3.5" />
                    Refunded {formatPrice(payment.refundAmount)}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
