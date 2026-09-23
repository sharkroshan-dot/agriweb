"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  completed: "success",
  processed: "success",
  paid: "success",
  succeeded: "success",
  pending: "warning",
  processing: "warning",
  queued: "warning",
  failed: "destructive",
  cancelled: "destructive",
  reversed: "destructive",
  refunded: "secondary",
};

export default function AdminPaymentsPage() {
  const [selectedPayment, setSelectedPayment] = useState<any>(null);
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<"transactions" | "withdrawals">("transactions");

  const { data: statsData } = useQuery({
    queryKey: ["adminPaymentStats"],
    queryFn: () => api.get("/payments/admin/stats"),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["adminTransactions", page],
    queryFn: () =>
      api.get("/payments/admin/transactions", {
        params: { page, limit: 20 },
      }),
  });

  const { data: withdrawalsData, isLoading: isLoadingWithdrawals } = useQuery({
    queryKey: ["adminWithdrawals", page, tab],
    queryFn: () =>
      api.get("/payments/admin/withdrawals", {
        params: { page, limit: 20 },
      }),
    enabled: tab === "withdrawals",
  });

  const stats = statsData?.data?.stats ?? {};
  const payments = data?.data?.payments ?? [];
  const pagination = data?.data?.pagination ?? { total: 0, totalPages: 1 };
  const withdrawals = withdrawalsData?.data?.withdrawals ?? [];
  const withdrawalPagination = withdrawalsData?.data?.pagination ?? { total: 0, totalPages: 1 };

  const withdrawalMethod = (bankAccount: any) =>
    bankAccount?.upiId ? "UPI" : bankAccount?.accountNumber ? "Bank transfer" : "—";

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-primary">Finance</p>
        <h1 className="text-3xl font-semibold tracking-tight">Payments</h1>
        <p className="mt-1 text-sm text-muted-foreground">Review settlements, withdrawals, pending invoices, and failed transactions.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{inr(stats.totalRevenue ?? stats.totalAmount ?? 0)}</p><p className="text-xs text-muted-foreground">Revenue</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{stats.totalTransactions ?? stats.totalCount ?? 0}</p><p className="text-xs text-muted-foreground">Transactions</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-green-600">{stats.completed ?? stats.successful ?? 0}</p><p className="text-xs text-muted-foreground">Completed</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-amber-600">{stats.pending ?? 0}</p><p className="text-xs text-muted-foreground">Pending</p></CardContent></Card>
      </div>

      <Tabs<"transactions" | "withdrawals"> defaultValue="transactions" onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="transactions" className={tab === "transactions" ? "bg-white text-slate-900 shadow-sm" : ""}>
            Transactions
          </TabsTrigger>
          <TabsTrigger value="withdrawals" className={tab === "withdrawals" ? "bg-white text-slate-900 shadow-sm" : ""}>
            Withdrawals
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "transactions" ? (
        <Card>
          <CardHeader>
            <CardTitle>Transactions</CardTitle>
            <CardDescription>Latest payment activity across the platform.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : payments.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">No transactions found.</p>
            ) : (
              payments.map((payment) => {
                const status = (payment.status || "pending").toLowerCase();
                const userName = payment.user?.name || payment.customerName || "User";
                return (
                  <div key={payment.id} className="flex items-center justify-between rounded-lg border p-4">
                    <div>
                      <p className="font-medium">{payment.id}</p>
                      <p className="text-sm text-muted-foreground">{inr(payment.amount)} • {userName}</p>
                      {payment.gateway && <p className="text-xs text-muted-foreground">{payment.gateway}</p>}
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>{status}</Badge>
                      <Button variant="outline" size="sm" onClick={() => setSelectedPayment(payment)}>
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
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Farmer Withdrawals</CardTitle>
            <CardDescription>Wallet withdrawal requests settled via RazorpayX payouts.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoadingWithdrawals ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : withdrawals.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">No withdrawal requests found.</p>
            ) : (
              withdrawals.map((w) => {
                const status = (w.status || "processing").toLowerCase();
                const user = w.user ?? {};
                return (
                  <div key={w.id} className="flex items-center justify-between rounded-lg border p-4">
                    <div>
                      <p className="font-medium">{inr(w.amount)}</p>
                      <p className="text-sm text-muted-foreground">
                        {user.name || "Farmer"} • {user.phone || user.email || ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {withdrawalMethod(w.bankAccount)}
                        {w.simulated ? " • simulated" : ""}
                        {w.razorpayPayoutId ? " • payout " + w.razorpayPayoutId : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={STATUS_VARIANT[status] ?? "secondary"} className="capitalize">{status}</Badge>
                      <Button variant="outline" size="sm" onClick={() => setSelectedWithdrawal(w)}>
                        Details
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
            {withdrawalPagination.totalPages > 1 && (
              <div className="flex items-center justify-between border-t pt-4">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <span className="text-sm text-muted-foreground">Page {page} of {withdrawalPagination.totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= withdrawalPagination.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={Boolean(selectedPayment)} onOpenChange={(open) => !open && setSelectedPayment(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedPayment?.id}</DialogTitle>
            <DialogDescription>{selectedPayment?.user?.name}</DialogDescription>
          </DialogHeader>
          {selectedPayment && (
            <div className="space-y-2 text-sm">
              <p>Amount: {inr(selectedPayment.amount)}</p>
              <p>Status: {selectedPayment.status}</p>
              {selectedPayment.gateway && <p>Gateway: {selectedPayment.gateway}</p>}
              {selectedPayment.paymentMethod && <p>Method: {selectedPayment.paymentMethod}</p>}
              {selectedPayment.createdAt && <p>Date: {new Date(selectedPayment.createdAt).toLocaleString()}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedWithdrawal)} onOpenChange={(open) => !open && setSelectedWithdrawal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdrawal {selectedWithdrawal?.id}</DialogTitle>
            <DialogDescription>{selectedWithdrawal?.user?.name || "Farmer"}</DialogDescription>
          </DialogHeader>
          {selectedWithdrawal && (
            <div className="space-y-2 text-sm">
              <p>Amount: {inr(selectedWithdrawal.amount)}</p>
              <p>Status: <Badge variant={STATUS_VARIANT[selectedWithdrawal.status] ?? "secondary"} className="capitalize">{selectedWithdrawal.status}</Badge></p>
              {selectedWithdrawal.razorpayPayoutId && <p>Payout ID: {selectedWithdrawal.razorpayPayoutId}</p>}
              {selectedWithdrawal.bankAccount && (
                <p>Method: {withdrawalMethod(selectedWithdrawal.bankAccount)}</p>
              )}
              {selectedWithdrawal.createdAt && <p>Date: {new Date(selectedWithdrawal.createdAt).toLocaleString()}</p>}
              {selectedWithdrawal.error && <p className="text-red-600">Error: {selectedWithdrawal.error}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
