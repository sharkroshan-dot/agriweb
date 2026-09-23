"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Banknote, CreditCard, Loader2, RefreshCw, Send, Landmark, ShieldAlert } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Select, SelectContent, SelectItem } from "../../../components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "../../../components/ui/tabs";
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

export default function DeliverySettlementPage() {
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken as string | undefined;
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"overview" | "today" | "settlements">("overview");
  const [settleOpen, setSettleOpen] = useState(false);
  const [method, setMethod] = useState("upi");
  const [reference, setReference] = useState("");
  const [selected, setSelected] = useState<any>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["deliveryCashSettlement"],
    queryFn: () => api.get("/delivery/me/cash-settlements/summary"),
    enabled: Boolean(accessToken),
    retry: 1,
  });

  const { data: pendingData } = useQuery({
    queryKey: ["deliveryPendingSettlements"],
    queryFn: () => api.get("/delivery/me/cash-settlements", { params: { status: "pending_remit", limit: 100 } }),
    enabled: Boolean(accessToken),
  });

  const { data: historyData } = useQuery({
    queryKey: ["deliverySettlementHistory"],
    queryFn: () => api.get("/delivery/me/cash-settlements", { params: { limit: 50 } }),
    enabled: Boolean(accessToken),
  });

  const d = data?.data || {};
  const today = d.today || {};
  const todaySettlements: any[] = d.todaySettlements || [];
  const account = d.collectionAccount || {};
  const pending: any[] = pendingData?.data?.settlements || [];
  const history: any[] = historyData?.data?.settlements || [];

  const pendingTotal = pending.reduce((s: number, x: any) => s + (Number(x.amountToRemit) || 0), 0);

  const submitMutation = useMutation({
    mutationFn: () =>
      api.post("/delivery/me/cash-settlements/submit", {
        settlementIds: pending.map((s) => s.id),
        method,
        reference,
      }),
    onSuccess: (res: any) => {
      toast.success(res?.message || "Settlement submitted for verification");
      setSettleOpen(false);
      setReference("");
      refetch();
      queryClient.invalidateQueries({ queryKey: ["deliveryPendingSettlements"] });
      queryClient.invalidateQueries({ queryKey: ["deliverySettlementHistory"] });
    },
    onError: (err: any) => toast.error(err?.message || "Failed to submit settlement"),
  });

  const handleSubmit = () => {
    if (method !== "collection_center" && !reference.trim()) {
      toast.error("Enter the transaction reference / UTR number");
      return;
    }
    submitMutation.mutate();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Payments</p>
          <h1 className="text-3xl font-semibold tracking-tight">Cash Settlement</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track the COD cash you collected, transfer it to the agriConnect account, and submit the UTR for verification.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>

      {d.codBlocked && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <p>{d.blockReason || "Settle your outstanding COD cash to continue receiving COD deliveries."}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-emerald-600">{inr(d.todayCash)}</p><p className="text-xs text-muted-foreground">Today&apos;s COD</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{d.todayCodOrders || 0}</p><p className="text-xs text-muted-foreground">COD orders today</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-amber-600">{inr(d.pendingSubmission)}</p><p className="text-xs text-muted-foreground">To settle</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-orange-600">{inr(d.inVerification)}</p><p className="text-xs text-muted-foreground">In verification</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-green-600">{inr(d.alreadyDeposited)}</p><p className="text-xs text-muted-foreground">Deposited</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-red-600">{inr(d.pendingRemit)}</p><p className="text-xs text-muted-foreground">Outstanding</p></CardContent></Card>
      </div>

      <Tabs<"overview" | "today" | "settlements"> defaultValue="overview" onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview" className={tab === "overview" ? "bg-white text-slate-900 shadow-sm" : ""}>Overview</TabsTrigger>
          <TabsTrigger value="today" className={tab === "today" ? "bg-white text-slate-900 shadow-sm" : ""}>Today&apos;s COD</TabsTrigger>
          <TabsTrigger value="settlements" className={tab === "settlements" ? "bg-white text-slate-900 shadow-sm" : ""}>Settlements</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "overview" && (
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Banknote className="h-5 w-5 text-primary" /> Today&apos;s Payment Breakdown</CardTitle>
                <CardDescription>How today&apos;s delivered orders were paid.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-amber-700">
                    <Banknote className="h-4 w-4" /> Cash on Delivery
                  </div>
                  <p className="mt-2 text-xs text-amber-700/80">{today.codOrders || 0} order{(today.codOrders || 0) === 1 ? "" : "s"}</p>
                  <p className="text-xl font-bold text-amber-700">{inr(today.codAmount)}</p>
                </div>
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-blue-700">
                    <CreditCard className="h-4 w-4" /> Online Payment
                  </div>
                  <p className="mt-2 text-xs text-blue-700/80">{today.onlineOrders || 0} order{(today.onlineOrders || 0) === 1 ? "" : "s"}</p>
                  <p className="text-xl font-bold text-blue-700">{inr(today.onlineAmount)}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Landmark className="h-5 w-5 text-primary" /> agriConnect collection account</CardTitle>
                <CardDescription>Transfer your collected COD cash into this account, then submit the UTR.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between rounded-lg border p-3"><span className="text-muted-foreground">UPI ID</span><span className="font-medium">{account.upiId || "-"}</span></div>
                <div className="flex justify-between rounded-lg border p-3"><span className="text-muted-foreground">Account</span><span className="font-medium">{(account.accountNumber || "-")}{account.accountName ? ` · ${account.accountName}` : ""}</span></div>
                <div className="flex justify-between rounded-lg border p-3"><span className="text-muted-foreground">IFSC</span><span className="font-medium">{account.ifsc || "-"}</span></div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Send className="h-5 w-5 text-primary" /> Settle collected cash</CardTitle>
              <CardDescription>Submit the transfer reference for finance to verify.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total to settle ({pending.length} order{pending.length === 1 ? "" : "s"})</p>
                <p className="text-3xl font-bold text-primary">{inr(pendingTotal)}</p>
                <p className="mt-1 text-xs text-muted-foreground">Cash collected minus your delivery fee. The farmer is paid from this.</p>
              </div>
              <Button onClick={() => setSettleOpen(true)} disabled={pending.length === 0}>
                Submit settlement for verification
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "today" && (
        <Card>
          <CardHeader>
            <CardTitle>Today&apos;s COD Orders</CardTitle>
            <CardDescription>Detailed split of every cash-on-delivery order you delivered today.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : todaySettlements.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">No COD orders delivered today yet.</p>
            ) : (
              todaySettlements.map((s) => {
                const status = (s.status || "pending_remit").toLowerCase();
                return (
                  <div key={s.id} className="flex flex-col gap-2 rounded-lg border p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">Order {s.orderNumber || s.orderId}</p>
                      <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>{STATUS_LABEL[status] ?? status}</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                      <div><p className="text-xs text-muted-foreground">Cash collected</p><p className="font-semibold">{inr(s.amount)}</p></div>
                      <div><p className="text-xs text-muted-foreground">Delivery fee (yours)</p><p className="font-semibold text-green-600">{inr(s.deliveryFee)}</p></div>
                      <div><p className="text-xs text-muted-foreground">Farmer share</p><p className="font-semibold">{inr(s.farmerShare)}</p></div>
                      <div><p className="text-xs text-muted-foreground">Platform share</p><p className="font-semibold">{inr(s.platformShare)}</p></div>
                    </div>
                    <div className="flex items-center justify-between border-t pt-2">
                      <p className="text-sm font-medium">Amount to remit</p>
                      <p className="text-sm font-bold text-amber-600">{inr(s.amountToRemit)}</p>
                    </div>
                    {s.reference && <p className="text-xs text-muted-foreground">Ref: {s.reference}</p>}
                    {s.rejectionReason && <p className="text-xs text-red-600">Rejected: {s.rejectionReason}</p>}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      )}

      {tab === "settlements" && (
        <Card>
          <CardHeader>
            <CardTitle>Settlement History</CardTitle>
            <CardDescription>Every COD settlement you have submitted.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : history.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">No settlements yet.</p>
            ) : (
              history.map((s) => {
                const status = (s.status || "pending_remit").toLowerCase();
                return (
                  <div key={s.id} className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">
                        {inr(s.amountToRemit ?? s.amount)} to settle
                        <span className="ml-2 text-xs font-normal text-muted-foreground">{inr(s.amount)} cash · {inr(s.deliveryFee)} fee</span>
                      </p>
                      <p className="text-sm text-muted-foreground">Order {s.orderNumber || s.orderId}</p>
                      {s.reference && <p className="text-xs text-muted-foreground">Ref: {s.reference} · {s.method}</p>}
                      {s.rejectionReason && <p className="text-xs text-red-600">Rejected: {s.rejectionReason}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>{STATUS_LABEL[status] ?? status}</Badge>
                      <Button variant="outline" size="sm" onClick={() => setSelected(s)}>Details</Button>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={settleOpen} onOpenChange={(open) => { if (!open) { setSettleOpen(false); setReference(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit settlement</DialogTitle>
            <DialogDescription>
              You will transfer {inr(pendingTotal)} to the agriConnect platform and it will be pending verification by finance.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Settlement method</label>
              <Select className="mt-1" value={method} onValueChange={(v) => setMethod(v)}>
                <SelectContent>
                  <SelectItem value="upi">UPI transfer</SelectItem>
                  <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                  <SelectItem value="collection_center">Collection center</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {method !== "collection_center" && (
              <div>
                <label className="text-sm font-medium">Transaction reference / UTR</label>
                <Input className="mt-1" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. 404812345678" />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSettleOpen(false)}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={submitMutation.isPending}>
                {submitMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Submit
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Settlement {selected?.orderNumber || selected?.id}</DialogTitle>
            <DialogDescription>Order {selected?.orderNumber || selected?.orderId}</DialogDescription>
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
        </DialogContent>
      </Dialog>
    </div>
  );
}
