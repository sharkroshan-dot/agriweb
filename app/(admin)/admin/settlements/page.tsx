"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import { Loader2 } from "lucide-react";
import { api } from "../../../lib/api/client";
import toast from "react-hot-toast";

const inr = (v: number) => `Rs ${Number(v || 0).toLocaleString("en-IN")}`;

const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
  verified: "success",
  remitted: "success",
  submitted: "warning",
  pending_remit: "secondary",
  rejected: "destructive",
};

const STATUS_LABEL: Record<string, string> = {
  verified: "Verified",
  remitted: "Settled",
  submitted: "In verification",
  pending_remit: "Pending",
  rejected: "Rejected",
};

export default function AdminSettlementsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"overview" | "settlements">("overview");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [selected, setSelected] = useState<any>(null);

  const { data: statsData } = useQuery({
    queryKey: ["cashSettlementStats"],
    queryFn: () => api.get("/payments/admin/cash-settlements/stats"),
  });

  const { data: partnersData } = useQuery({
    queryKey: ["cashSettlementPartners"],
    queryFn: () => api.get("/payments/admin/cash-settlements/partners-outstanding"),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["cashSettlements", page, statusFilter],
    queryFn: () =>
      api.get("/payments/admin/cash-settlements", {
        params: { page, limit: 20, ...(statusFilter ? { status: statusFilter } : {}) },
      }),
    enabled: tab === "settlements",
  });

  const verifyMutation = useMutation({
    mutationFn: (id: string) => api.post(`/payments/admin/cash-settlements/${id}/verify`, {}),
    onSuccess: () => {
      toast.success("Settlement verified");
      queryClient.invalidateQueries({ queryKey: ["cashSettlements"] });
      queryClient.invalidateQueries({ queryKey: ["cashSettlementStats"] });
      queryClient.invalidateQueries({ queryKey: ["cashSettlementPartners"] });
      setSelected(null);
    },
    onError: () => toast.error("Failed to verify settlement"),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.post(`/payments/admin/cash-settlements/${id}/reject`, {}),
    onSuccess: () => {
      toast.success("Settlement rejected");
      queryClient.invalidateQueries({ queryKey: ["cashSettlements"] });
      queryClient.invalidateQueries({ queryKey: ["cashSettlementStats"] });
      queryClient.invalidateQueries({ queryKey: ["cashSettlementPartners"] });
      setSelected(null);
    },
    onError: () => toast.error("Failed to reject settlement"),
  });

  const stats = statsData?.data?.data ?? {};
  const partners = partnersData?.data?.data?.partners ?? [];
  const settlements = data?.data?.data?.settlements ?? [];
  const pagination = data?.data?.data?.pagination ?? { total: 0, totalPages: 1 };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-primary">Finance</p>
        <h1 className="text-3xl font-semibold tracking-tight">Cash Settlement</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track COD cash collected by delivery partners. A settlement only becomes verified after finance reconciles the partner&apos;s UTR/reference against the bank statement.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{inr(stats.todaysCOD)}</p><p className="text-xs text-muted-foreground">Today&apos;s COD</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{inr(stats.collected)}</p><p className="text-xs text-muted-foreground">Collected</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-amber-600">{inr(stats.pendingRemit)}</p><p className="text-xs text-muted-foreground">Pending</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-orange-600">{inr(stats.inVerification)}</p><p className="text-xs text-muted-foreground">In verification</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-green-600">{inr(stats.settled)}</p><p className="text-xs text-muted-foreground">Settled</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-red-600">{inr(stats.overdue)}</p><p className="text-xs text-muted-foreground">Overdue</p></CardContent></Card>
      </div>

      <Tabs<"overview" | "settlements"> defaultValue="overview" onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview" className={tab === "overview" ? "bg-white text-slate-900 shadow-sm" : ""}>
            Overview
          </TabsTrigger>
          <TabsTrigger value="settlements" className={tab === "settlements" ? "bg-white text-slate-900 shadow-sm" : ""}>
            Settlements
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "overview" ? (
        <Card>
          <CardHeader>
            <CardTitle>Outstanding by Delivery Partner</CardTitle>
            <CardDescription>COD cash each partner still owes to the platform (including pending verification).</CardDescription>
          </CardHeader>
          <CardContent>
            {partners.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">No outstanding COD cash.</p>
            ) : (
              <div className="space-y-3">
                {partners.map((p) => (
                  <div key={p.partnerId} className="flex items-center justify-between rounded-lg border p-4">
                    <div>
                      <p className="font-medium">{p.partner?.name || "Unknown partner"}</p>
                      <p className="text-sm text-muted-foreground">{p.partner?.phone || ""} • {p.orderCount} order{p.orderCount > 1 ? "s" : ""}</p>
                    </div>
                    <Badge variant={p.outstanding > 0 ? "warning" : "success"}>{inr(p.outstanding)}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>COD Settlements</CardTitle>
            <CardDescription>Verify a settlement once the transfer reference reconciles with the bank statement.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {["", "pending_remit", "submitted", "verified", "rejected"].map((s) => (
                <Button
                  key={s || "all"}
                  variant={statusFilter === s ? "default" : "outline"}
                  size="sm"
                  onClick={() => { setStatusFilter(s); setPage(1); }}
                >
                  {s === "" ? "All" : STATUS_LABEL[s] ?? s}
                </Button>
              ))}
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : settlements.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">No settlements found.</p>
            ) : (
              settlements.map((s) => {
                const status = (s.status || "pending_remit").toLowerCase();
                return (
                  <div key={s.id} className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">
                        {inr(s.amountToRemit ?? s.amount)} to settle
                        <span className="ml-2 text-xs font-normal text-muted-foreground">{inr(s.deliveryFee)} fee</span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {s.deliveryPartner?.name || "Delivery partner"} • Order {s.orderNumber || s.orderId}
                      </p>
                      {s.reference && <p className="text-xs text-muted-foreground">Ref: {s.reference} • {s.method}</p>}
                      {s.rejectionReason && <p className="text-xs text-red-600">Rejected: {s.rejectionReason}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>{STATUS_LABEL[status] ?? status}</Badge>
                      <Button variant="outline" size="sm" onClick={() => setSelected(s)}>
                        Details
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between border-t pt-4">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <span className="text-sm text-muted-foreground">Page {page} of {pagination.totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Settlement {selected?.id}</DialogTitle>
            <DialogDescription>
              {selected?.deliveryPartner?.name || "Delivery partner"} • Order {selected?.orderNumber || selected?.orderId}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-2 text-sm">
              <p>Cash collected: {inr(selected.amount)}</p>
              <p>Delivery fee: {inr(selected.deliveryFee)}</p>
              <p>Farmer share: {inr(selected.farmerShare)}</p>
              <p>Platform share: {inr(selected.platformShare)}</p>
              <p>Amount to settle: <strong>{inr(selected.amountToRemit)}</strong></p>
              <p>Status: <Badge variant={STATUS_VARIANT[selected.status] ?? "secondary"}>{STATUS_LABEL[selected.status] ?? selected.status}</Badge></p>
              {selected.reference && <p>Reference: {selected.reference}</p>}
              {selected.method && <p>Method: {selected.method}</p>}
              {selected.cashCollectedAt && <p>Collected: {new Date(selected.cashCollectedAt).toLocaleString()}</p>}
              {selected.rejectionReason && <p className="text-red-600">Rejected: {selected.rejectionReason}</p>}
            </div>
          )}
          {selected?.status === "submitted" && (
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="destructive"
                disabled={rejectMutation.isPending}
                onClick={() => rejectMutation.mutate(selected.id)}
              >
                {rejectMutation.isPending ? "Rejecting..." : "Reject"}
              </Button>
              <Button
                disabled={verifyMutation.isPending}
                onClick={() => verifyMutation.mutate(selected.id)}
              >
                {verifyMutation.isPending ? "Verifying..." : "Verify & settle"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
