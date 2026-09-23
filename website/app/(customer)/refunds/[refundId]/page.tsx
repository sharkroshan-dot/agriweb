"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUpLeft,
  CheckCircle2,
  Circle,
  Clock,
  CreditCard,
  Loader2,
  Package,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { formatPrice, formatDate, formatTime } from "../../../lib/utils";
import { api } from "../../../lib/api/client";

const statusMeta: Record<string, { label: string; className: string }> = {
  requested: { label: "Requested", className: "border-slate-200 bg-slate-50 text-slate-700" },
  under_review: { label: "Under Review", className: "border-yellow-200 bg-yellow-50 text-yellow-700" },
  approved: { label: "Approved", className: "border-blue-200 bg-blue-50 text-blue-700" },
  refund_processing: { label: "Refund Processing", className: "border-purple-200 bg-purple-50 text-purple-700" },
  refunded: { label: "Refund Completed", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  rejected: { label: "Rejected", className: "border-red-200 bg-red-50 text-red-700" },
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

const typeLabels: Record<string, string> = {
  full: "Full Refund",
  partial: "Partial Refund",
  cancellation: "Cancellation",
  damaged_product: "Damaged Product",
  missing_quantity: "Missing Quantity",
  wrong_product: "Wrong Product",
  poor_quality: "Poor Quality",
  spoiled_expired: "Spoiled/Expired",
  product_unavailable: "Product Unavailable",
  delivery_failed: "Delivery Failed",
  bulk_event: "Bulk / Event",
  other: "Other",
};

const timelineStepMeta: Record<string, { label: string; done: boolean }> = {
  requested: { label: "Request Submitted", done: true },
  under_review: { label: "Under Review", done: true },
  approved: { label: "Refund Approved", done: true },
  refund_processing: { label: "Refund Processing", done: true },
  refunded: { label: "Refund Completed", done: true },
  rejected: { label: "Refund Rejected", done: true },
};

export default function RefundDetailPage() {
  const params = useParams();
  const refundId = params.refundId as string;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["refund", refundId],
    queryFn: () => api.get(`/refunds/${refundId}`),
    enabled: !!refundId,
  });

  const refund = useMemo(() => {
    const r = data?.data || data;
    if (!r) return null;
    return {
      id: r.id || r._id,
      refundId: r.refundId || r.id || r._id,
      orderId: r.orderId,
      orderNumber: r.orderNumber || r.orderId,
      status: (r.status || "requested").toLowerCase(),
      reason: reasonLabels[r.reason] || r.reason || null,
      type: typeLabels[r.type] || r.type || "Refund",
      description: r.description || null,
      evidence: r.evidence || [],
      affectedItems: r.affectedItems || [],
      paymentMethod: r.paymentMethod || "",
      requestedAmount: Number(r.requestedAmount) || 0,
      approvedAmount: Number(r.approvedAmount) || 0,
      rejectionReason: r.rejectionReason || null,
      refundTransactionId: r.refundTransactionId || null,
      timeline: r.timeline || [],
      requestedAt: r.requestedAt || r.createdAt,
      approvedAt: r.approvedAt,
      completedAt: r.completedAt || r.refundedAt,
    };
  }, [data]);

  const isWalletPayout = useMemo(
    () =>
      !!refund &&
      refund.status === "refunded" &&
      ["wallet", "cash", "cod", "cash_on_delivery"].includes(String(refund.paymentMethod || "").toLowerCase()),
    [refund]
  );

  const { data: walletData } = useQuery({
    queryKey: ["walletInfo"],
    queryFn: () => api.get("/payments/wallet/info"),
    enabled: isWalletPayout,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (error || !refund) {
    return (
      <div className="space-y-6 p-6">
        <Button variant="ghost" asChild>
          <Link href="/refunds" className="flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" /> Back to refunds
          </Link>
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <ArrowUpLeft className="h-10 w-10 text-red-400" />
            <p className="font-medium">Failed to load refund</p>
            <Button asChild>
              <Link href="/refunds">Back to refunds</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const meta = statusMeta[refund.status] || statusMeta.requested;
  const timeline = [...refund.timeline].reverse();

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/refunds">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{refund.refundId}</h1>
          <p className="text-sm text-muted-foreground">
            {refund.type} · {refund.reason || "Refund request"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowUpLeft className="h-5 w-5" /> Refund Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge variant="outline" className={meta.className}>{meta.label}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Order</span>
                <Link
                  href={refund.orderId ? `/orders/${refund.orderId}` : "#"}
                  className="font-medium text-emerald-700 hover:underline"
                >
                  {String(refund.orderNumber).slice(-8)}
                </Link>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Type</span>
                <span className="font-medium capitalize">{refund.type}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Payment method</span>
                <span className="flex items-center gap-1.5 font-medium capitalize">
                  <CreditCard className="h-3.5 w-3.5" />
                  {refund.paymentMethod.replace(/_/g, " ")}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Requested</span>
                <span>{formatDate(refund.requestedAt)} at {formatTime(refund.requestedAt)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Approved amount</span>
                <span className="text-lg font-bold text-emerald-700">
                  {formatPrice(refund.approvedAmount)}
                </span>
              </div>
              {refund.refundTransactionId && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Refund transaction</span>
                  <span className="font-mono text-xs">{refund.refundTransactionId}</span>
                </div>
              )}
              {refund.description && (
                <p className="rounded-md bg-slate-50 p-2 text-muted-foreground">
                  {refund.description}
                </p>
              )}
            </CardContent>
          </Card>

          {refund.status === "rejected" && (
            <Card className="border-red-200">
              <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
                <XCircle className="h-10 w-10 text-red-500" />
                <p className="font-semibold text-red-700">Refund Rejected</p>
                {refund.rejectionReason && (
                  <p className="text-sm text-muted-foreground">Reason: {refund.rejectionReason}</p>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/refunds">View Policy</Link>
                  </Button>
                  <Button size="sm" asChild>
                    <Link href="/customer/settings">Contact Support</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {isWalletPayout && (
            <Card className="border-emerald-200 bg-emerald-50/40">
              <CardContent className="flex items-start gap-3 p-6">
                <div className="rounded-full bg-emerald-600/10 p-2">
                  <ArrowUpLeft className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <p className="font-semibold text-emerald-800">Refunded to your Wallet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatPrice(refund.approvedAmount)} has been credited to your wallet.
                  </p>
                  <p className="mt-1 text-sm font-medium text-emerald-700">
                    Wallet balance: {formatPrice((walletData as any)?.data?.balance)}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {refund.affectedItems.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" /> Affected Items
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {refund.affectedItems.map((item: any, i: number) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                    <div>
                      <p className="font-medium text-slate-900">{item.productName}</p>
                      <p className="text-xs text-muted-foreground">
                        Qty {item.quantity} × {formatPrice(item.unitPrice)}
                      </p>
                    </div>
                    <span className="font-semibold text-emerald-700">
                      {formatPrice(item.approvedAmount ?? item.requestedAmount)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {refund.evidence.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Evidence ({refund.evidence.length})</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-2">
                {refund.evidence.map((src: string, i: number) => (
                  <a key={i} href={src} target="_blank" rel="noopener noreferrer" className="overflow-hidden rounded-lg border">
                    <img src={src} alt={`Evidence ${i + 1}`} className="h-20 w-full object-cover" />
                  </a>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" /> Refund Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-0">
              {timeline.length === 0 ? (
                <p className="text-sm text-muted-foreground">No timeline entries yet.</p>
              ) : (
                timeline.map((step: any, i: number) => {
                  const meta = timelineStepMeta[(step.status || "").toLowerCase()];
                  const label = meta?.label || step.note || step.status || "Update";
                  const isLast = i === timeline.length - 1;
                  return (
                    <div key={i} className="relative flex gap-4 pb-5 last:pb-0">
                      {!isLast && <div className="absolute left-[11px] top-6 h-full w-px bg-slate-200" />}
                      <div className="mt-0.5">
                        {meta?.done ? (
                          <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                        ) : (
                          <Circle className="h-6 w-6 text-slate-300" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900">{label}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(step.timestamp)} at {formatTime(step.timestamp)}
                          {step.actorRole && step.actorRole !== "system" ? ` · by ${step.actorRole}` : ""}
                        </p>
                        {step.note && meta && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{step.note}</p>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}