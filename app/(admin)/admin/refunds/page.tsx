"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  Banknote,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { api } from "../../../lib/api/client";
import { cn, formatDate, formatPrice, resolveBackendUrl } from "../../../lib/utils";

type RefundStatus = "requested" | "under_review" | "approved" | "refund_processing" | "refunded" | "rejected";

interface RefundItem {
  productId: string;
  productName?: string;
  quantity: number;
  unitPrice?: number;
  requestedAmount: number;
  approvedAmount?: number;
}

interface Refund {
  id: string;
  refundId: string;
  orderId: string;
  orderNumber?: string;
  customerId?: string;
  type: string;
  reason?: string;
  resolution?: string;
  description?: string;
  evidence: string[];
  affectedItems: RefundItem[];
  paymentMethod: string;
  requestedAmount: number;
  approvedAmount?: number;
  status: RefundStatus;
  rejectionReason?: string;
  refundTransactionId?: string;
  timeline: { status: string; note?: string; actorRole?: string; timestamp: string }[];
  requestedAt?: string;
  approvedAt?: string;
  processedAt?: string;
  completedAt?: string;
  createdAt?: string;
}

const statusConfig: Record<RefundStatus, { label: string; variant: "warning" | "default" | "success" | "destructive" | "secondary" }> = {
  requested: { label: "Requested", variant: "warning" },
  under_review: { label: "Under Review", variant: "default" },
  approved: { label: "Approved", variant: "success" },
  refund_processing: { label: "Processing", variant: "secondary" },
  refunded: { label: "Refunded", variant: "success" },
  rejected: { label: "Rejected", variant: "destructive" },
};

const statusTabs: { value: RefundStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "requested", label: "Requested" },
  { value: "under_review", label: "Under Review" },
  { value: "approved", label: "Approved" },
  { value: "refund_processing", label: "Processing" },
  { value: "refunded", label: "Refunded" },
  { value: "rejected", label: "Rejected" },
];

const PENDING_STATUSES: RefundStatus[] = ["requested", "under_review", "approved", "refund_processing"];

const pageSize = 10;

const titleCase = (value?: string) =>
  value ? value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "N/A";

export default function AdminRefundsPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<RefundStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Refund | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState<Refund | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["adminRefunds", page, statusFilter, query],
    queryFn: () =>
      api.get<{ success: boolean; data: { refunds: Refund[]; pagination: { page: number; limit: number; total: number; totalPages: number } } }>(
        "/refunds/admin/all",
        {
          params: {
            page,
            limit: pageSize,
            status: statusFilter !== "all" ? statusFilter : undefined,
            orderId: query || undefined,
          },
        }
      ),
  });

  const refunds = data?.data?.refunds ?? [];
  const pagination = data?.data?.pagination;
  const total = pagination?.total ?? refunds.length;
  const lastPage = pagination?.totalPages ?? Math.ceil(total / pageSize);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["adminRefunds"] });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/refunds/${id}/approve`, {}),
    onSuccess: () => {
      setSelected(null);
      invalidate();
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/refunds/${id}/reject`, { reason }),
    onSuccess: () => {
      setRejecting(null);
      setRejectReason("");
      setSelected(null);
      invalidate();
    },
  });

  const processMutation = useMutation({
    mutationFn: (id: string) => api.post(`/refunds/${id}/process`, {}),
    onSuccess: () => {
      setSelected(null);
      invalidate();
    },
  });

  const filtered = useMemo(() => {
    if (!query) return refunds;
    const q = query.toLowerCase();
    return refunds.filter(
      (r) =>
        String(r.refundId).toLowerCase().includes(q) ||
        String(r.orderNumber ?? "").toLowerCase().includes(q) ||
        String(r.orderId).toLowerCase().includes(q)
    );
  }, [refunds, query]);

  const actionFor = (status: RefundStatus) => {
    if (status === "requested" || status === "under_review") return "review";
    if (status === "approved" || status === "refund_processing") return "process";
    return "none";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Refunds</h1>
          <p className="text-sm text-muted-foreground">
            Review refund requests, approve or reject payouts, and track completed refunds.
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={() => invalidate()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search by refund ID, order number or order ID..."
            className="pl-9"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v as RefundStatus | "all");
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {statusTabs.map((tab) => (
              <SelectItem key={tab.value} value={tab.value}>
                {tab.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap gap-2">
        {statusTabs.map((tab) => {
          return (
            <button
              key={tab.value}
              onClick={() => {
                setStatusFilter(tab.value);
                setPage(1);
              }}
              className={cn(
                "rounded-full px-3 py-1 text-sm font-medium transition-colors",
                statusFilter === tab.value
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>All Refunds</CardTitle>
          <CardDescription>
            {total} refund{total !== 1 ? "s" : ""} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              Loading refunds...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              No refunds found.
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((refund) => {
                const statusConf = statusConfig[refund.status] ?? statusConfig.requested;
                const action = actionFor(refund.status);
                const isExpanded = expandedId === refund.id;
                return (
                  <div key={refund.id} className="rounded-lg border">
                    <div
                      className="flex cursor-pointer flex-wrap items-center gap-3 p-4 sm:flex-nowrap"
                      onClick={() => setExpandedId(isExpanded ? null : refund.id)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{refund.refundId}</p>
                          <Badge variant={statusConf.variant}>{statusConf.label}</Badge>
                          {refund.approvedAmount != null && refund.approvedAmount > 0 && (
                            <span className="text-sm font-semibold text-emerald-700">
                              {formatPrice(refund.approvedAmount)}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 truncate text-sm text-slate-700">
                          {titleCase(refund.type)}
                          {refund.reason ? ` · ${titleCase(refund.reason)}` : ""}
                          {refund.resolution ? ` · ${titleCase(refund.resolution)}` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Order {refund.orderNumber || String(refund.orderId).slice(-8)} &middot;{" "}
                          {formatDate(refund.requestedAt ?? refund.createdAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {action === "review" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelected(refund);
                            }}
                          >
                            Review
                          </Button>
                        )}
                        {action === "process" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              processMutation.mutate(refund.id);
                            }}
                            disabled={processMutation.isPending}
                          >
                            <Banknote className="mr-1.5 h-3.5 w-3.5" />
                            Process Payout
                          </Button>
                        )}
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="border-t px-4 pb-4 pt-3">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <p className="text-xs font-medium text-slate-500">Description</p>
                            <p className="mt-1 text-sm text-slate-600">{refund.description || "No description provided."}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-slate-500">Payment Method</p>
                            <p className="mt-1 text-sm capitalize text-slate-600">{refund.paymentMethod?.replace(/_/g, " ")}</p>
                          </div>
                          {refund.rejectionReason && (
                            <div className="sm:col-span-2">
                              <p className="text-xs font-medium text-red-500">Rejection Reason</p>
                              <p className="mt-1 text-sm text-red-600">{refund.rejectionReason}</p>
                            </div>
                          )}
                          {refund.refundTransactionId && (
                            <div>
                              <p className="text-xs font-medium text-slate-500">Refund Transaction</p>
                              <p className="mt-1 font-mono text-sm text-slate-600">{refund.refundTransactionId}</p>
                            </div>
                          )}
                        </div>
                        {refund.affectedItems.length > 0 && (
                          <div className="mt-3">
                            <p className="text-xs font-medium text-slate-500">Affected Items</p>
                            <div className="mt-1 overflow-x-auto rounded-lg border">
                              <table className="w-full text-sm">
                                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                                  <tr>
                                    <th className="px-3 py-2">Product</th>
                                    <th className="px-3 py-2">Qty</th>
                                    <th className="px-3 py-2 text-right">Amount</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {refund.affectedItems.map((item, i) => (
                                    <tr key={i} className="border-t">
                                      <td className="px-3 py-2">{item.productName || item.productId}</td>
                                      <td className="px-3 py-2">{item.quantity}</td>
                                      <td className="px-3 py-2 text-right">{formatPrice(item.approvedAmount ?? item.requestedAmount)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                        {refund.evidence.length > 0 && (
                          <div className="mt-3">
                            <p className="text-xs font-medium text-slate-500">Evidence ({refund.evidence.length})</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {refund.evidence.map((src, i) => (
                                <a key={i} href={resolveBackendUrl(src)} target="_blank" rel="noreferrer">
                                  <img
                                    src={resolveBackendUrl(src)}
                                    alt="Evidence"
                                    className="h-16 w-16 rounded-lg border object-cover"
                                  />
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {lastPage > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {lastPage}
          </span>
          <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }} wide>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selected?.refundId}</DialogTitle>
            <DialogDescription>
              {selected && (
                <>
                  {titleCase(selected.type)}
                  {selected.reason ? ` · ${titleCase(selected.reason)}` : ""} &middot;{" "}
                  {statusConfig[selected.status]?.label}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3">
                <div>
                  <p className="text-xs text-slate-500">Order</p>
                  <a
                    href={`/admin/orders`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline"
                  >
                    {selected.orderNumber || String(selected.orderId).slice(-8)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Payment</p>
                  <p className="text-sm capitalize">{selected.paymentMethod?.replace(/_/g, " ")}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Requested</p>
                  <p className="text-sm">{formatDate(selected.requestedAt)}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-slate-500">Requested Amount</p>
                  <p className="mt-1 text-lg font-semibold">{formatPrice(selected.requestedAmount)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-slate-500">Approved Amount</p>
                  <p className="mt-1 text-lg font-semibold text-emerald-700">
                    {formatPrice(selected.approvedAmount ?? selected.requestedAmount)}
                  </p>
                </div>
              </div>

              {selected.description && (
                <div>
                  <p className="text-xs font-medium text-slate-500">Customer Description</p>
                  <p className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{selected.description}</p>
                </div>
              )}

              {selected.affectedItems.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-slate-500">Affected Items</p>
                  <div className="mt-1 overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Product</th>
                          <th className="px-3 py-2">Qty</th>
                          <th className="px-3 py-2 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.affectedItems.map((item, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-3 py-2">{item.productName || item.productId}</td>
                            <td className="px-3 py-2">{item.quantity}</td>
                            <td className="px-3 py-2 text-right">{formatPrice(item.approvedAmount ?? item.requestedAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {selected.evidence.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-slate-500">Evidence</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selected.evidence.map((src, i) => (
                      <a key={i} href={resolveBackendUrl(src)} target="_blank" rel="noreferrer">
                        <img src={resolveBackendUrl(src)} alt="Evidence" className="h-20 w-20 rounded-lg border object-cover" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {selected.rejectionReason && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-xs font-medium text-red-600">Rejection Reason</p>
                  <p className="mt-1 text-sm text-red-700">{selected.rejectionReason}</p>
                </div>
              )}

              {selected.refundTransactionId && (
                <div>
                  <p className="text-xs font-medium text-slate-500">Refund Transaction ID</p>
                  <p className="mt-1 font-mono text-sm">{selected.refundTransactionId}</p>
                </div>
              )}

              {selected.timeline.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-slate-500">Timeline</p>
                  <ol className="mt-2 space-y-2">
                    {[...selected.timeline].reverse().map((entry, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                        <div>
                          <p className="capitalize text-slate-700">{titleCase(entry.status)}</p>
                          {entry.note && <p className="text-xs text-slate-500">{entry.note}</p>}
                          <p className="text-xs text-slate-400">
                            {formatDate(entry.timestamp)} {entry.actorRole ? `· ${entry.actorRole}` : ""}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                {(selected.status === "requested" || selected.status === "under_review") && (
                  <>
                    <Button
                      variant="outline"
                      className="border-red-300 text-red-600 hover:bg-red-50"
                      onClick={() => setRejecting(selected)}
                    >
                      <ShieldX className="mr-1.5 h-4 w-4" />
                      Reject
                    </Button>
                    <Button
                      onClick={() => approveMutation.mutate(selected.id)}
                      disabled={approveMutation.isPending}
                    >
                      {approveMutation.isPending ? "Approving..." : "Approve & Refund"}
                      <ShieldCheck className="ml-1.5 h-4 w-4" />
                    </Button>
                  </>
                )}
                {(selected.status === "approved" || selected.status === "refund_processing") && (
                  <Button
                    onClick={() => processMutation.mutate(selected.id)}
                    disabled={processMutation.isPending}
                  >
                    {processMutation.isPending ? "Processing..." : "Process Payout"}
                    <Banknote className="ml-1.5 h-4 w-4" />
                  </Button>
                )}
                {!PENDING_STATUSES.includes(selected.status) && (
                  <p className="text-sm text-slate-400">This refund has been finalized.</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejecting} onOpenChange={(open) => { if (!open) setRejecting(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject {rejecting?.refundId}</DialogTitle>
            <DialogDescription>Provide a reason for the customer. This is required.</DialogDescription>
          </DialogHeader>
          <textarea
            className="min-h-[100px] w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason for rejection..."
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || rejectMutation.isPending}
              onClick={() => rejecting && rejectMutation.mutate({ id: rejecting.id, reason: rejectReason.trim() })}
            >
              {rejectMutation.isPending ? "Rejecting..." : "Reject Request"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
