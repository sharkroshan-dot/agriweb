"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUpLeft,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  SearchX,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { formatPrice, formatDate, formatTime } from "../../lib/utils";
import { api } from "../../lib/api/client";

const statusMeta: Record<string, { label: string; className: string }> = {
  requested: { label: "Requested", className: "border-slate-200 bg-slate-50 text-slate-700" },
  under_review: { label: "Under Review", className: "border-yellow-200 bg-yellow-50 text-yellow-700" },
  approved: { label: "Approved", className: "border-blue-200 bg-blue-50 text-blue-700" },
  refund_processing: { label: "Refund Processing", className: "border-purple-200 bg-purple-50 text-purple-700" },
  refunded: { label: "Refund Completed", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  rejected: { label: "Rejected", className: "border-red-200 bg-red-50 text-red-700" },
  not_applicable: { label: "Not Applicable", className: "border-gray-200 bg-gray-50 text-gray-600" },
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
  spoiled_expired: "Spoiled/expired",
  other: "Other",
};

export default function CustomerRefundsPage() {
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["customerRefunds"],
    queryFn: () => api.get("/customers/me/refunds", { params: { limit: 100 } }),
  });

  const refunds = useMemo(() => {
    const list = data?.data || (Array.isArray(data) ? data : []);
    return list.map((p: any) => {
      const status = (p.status || "refunded").toLowerCase();
      const amount =
        p.approvedAmount ?? p.refundAmount ?? p.amount ?? p.requestedAmount ?? 0;
      return {
        id: p.id || p._id,
        refundId: p.refundId || p.transactionId || p.id || p._id,
        orderId: p.orderId,
        orderNumber: p.orderNumber || p.orderId,
        amount: Number(amount) || 0,
        method: p.paymentMethod || "",
        status,
        reason: reasonLabels[p.reason] || p.reason || null,
        type: p.type || "full",
        rejectionReason: p.rejectionReason || null,
        transactionId: p.refundTransactionId || p.transactionId,
        requestedAt: p.requestedAt || p.createdAt,
        approvedAt: p.approvedAt,
        completedAt: p.completedAt || p.refundedAt,
        timeline: p.timeline || [],
        affectedItems: p.affectedItems || [],
      };
    });
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return refunds;
    return refunds.filter(
      (r: any) =>
        String(r.refundId).toLowerCase().includes(q) ||
        String(r.orderNumber).toLowerCase().includes(q) ||
        String(r.status).toLowerCase().includes(q) ||
        String(r.reason || "").toLowerCase().includes(q)
    );
  }, [refunds, search]);

  const totalRefunded = useMemo(
    () =>
      refunds
        .filter((r: any) => r.status === "refunded")
        .reduce((s: number, r: any) => s + r.amount, 0),
    [refunds]
  );
  const activeCount = useMemo(
    () =>
      refunds.filter((r: any) =>
        ["requested", "under_review", "approved", "refund_processing"].includes(r.status)
      ).length,
    [refunds]
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/customer/dashboard">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">Refunds &amp; Returns</h1>
          <p className="text-sm text-muted-foreground">Track your refund requests, returns and payouts</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-emerald-50 p-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Refunded</p>
              <p className="text-xl font-bold text-emerald-700">{formatPrice(totalRefunded)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-yellow-50 p-2">
              <ArrowUpLeft className="h-5 w-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Active Requests</p>
              <p className="text-xl font-bold text-yellow-700">{activeCount}</p>
            </div>
          </div>
          <p className="flex items-center text-xs text-muted-foreground">
            Total Refunded counts refunds once the payout completes. Pending payouts are shown under
            Active Requests and update after the refund is processed.
          </p>
        </CardContent>
      </Card>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by refund ID, order number or reason…"
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <ArrowUpLeft className="h-10 w-10 text-red-500" />
            <p className="font-medium">Failed to load refunds</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            {search ? (
              <SearchX className="h-10 w-10 text-muted-foreground" />
            ) : (
              <ArrowUpLeft className="h-10 w-10 text-muted-foreground" />
            )}
            <p className="font-medium">{search ? "No matching refunds" : "No refunds yet"}</p>
            <p className="text-sm text-muted-foreground">
              {search
                ? "Try a different search term."
                : "Refund requests and completed refunds will appear here. You can cancel an order or report a problem from the order page."}
            </p>
            <Button asChild>
              <Link href="/orders">View orders</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((refund: any) => {
            const meta = statusMeta[refund.status] || statusMeta.refunded;
            return (
              <Card key={refund.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/refunds/${refund.id}`}
                        className="font-medium text-slate-900 hover:text-emerald-700"
                      >
                        {refund.refundId}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        Order{" "}
                        <Link href={refund.orderId ? `/orders/${refund.orderId}` : "#"} className="hover:text-emerald-700">
                          {String(refund.orderNumber).slice(-8)}
                        </Link>
                        {refund.reason ? ` · ${refund.reason}` : ""}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Requested {formatDate(refund.requestedAt)} at {formatTime(refund.requestedAt)}
                        {refund.transactionId && (
                          <span className="font-mono"> · TXN {refund.transactionId}</span>
                        )}
                      </p>
                      {refund.status === "rejected" && refund.rejectionReason && (
                        <p className="mt-1 text-xs text-red-600">Reason: {refund.rejectionReason}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <span className="font-semibold text-emerald-700">{formatPrice(refund.amount)}</span>
                      <Badge variant="outline" className={meta.className}>
                        {meta.label}
                      </Badge>
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/refunds/${refund.id}`}>View Details</Link>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}