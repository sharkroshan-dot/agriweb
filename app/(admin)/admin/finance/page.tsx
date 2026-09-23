"use client";

import { useQuery } from "@tanstack/react-query";
import { Link2, Loader2, RefreshCw, ShieldAlert, AlertTriangle, ArrowRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { api } from "../../../lib/api/client";

const inr = (v: number) => `Rs ${Number(v || 0).toLocaleString("en-IN")}`;

export default function AdminFinancePage() {
  const { data: paymentStatsData, refetch: refetchPayments, isFetching: fetchingPayments } = useQuery({
    queryKey: ["adminFinancePaymentStats"],
    queryFn: () => api.get("/payments/admin/stats"),
  });

  const { data: codData, refetch: refetchCod, isFetching: fetchingCod } = useQuery({
    queryKey: ["adminFinanceCodStats"],
    queryFn: () => api.get("/payments/admin/cash-settlements/stats"),
  });

  const { data: partnersData } = useQuery({
    queryKey: ["adminFinancePartnersOutstanding"],
    queryFn: () => api.get("/payments/admin/cash-settlements/partners-outstanding"),
  });

  const { data: transactionsData } = useQuery({
    queryKey: ["adminFinanceRecentTransactions"],
    queryFn: () => api.get("/payments/admin/transactions", { params: { page: 1, limit: 6 } }),
  });

  const { data: riskData } = useQuery({
    queryKey: ["adminFinanceRiskAlerts"],
    queryFn: () => api.get("/ai/security-center"),
    retry: 1,
  });

  const payments = paymentStatsData?.data?.stats ?? {};
  const cod = codData?.data?.data ?? {};
  const partners = partnersData?.data?.data?.partners ?? [];
  const transactions = transactionsData?.data?.payments ?? [];
  const risk = (riskData as any)?.data ?? {};
  const fraudAlerts = risk.fraudAlerts ?? [];
  const anomalies = risk.anomalies ?? [];
  const highFraud = fraudAlerts.filter((f: any) => f.riskLevel === "HIGH").length;

  const totalOutstanding = partners.reduce((sum: number, p: any) => sum + (p.outstanding || 0), 0);

  const handleRefresh = () => {
    refetchPayments();
    refetchCod();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary">Finance & Payments</p>
          <h1 className="text-3xl font-semibold tracking-tight">Finance Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Consolidated view of platform revenue, cash settlement (COD), and outstanding partner balances.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={fetchingPayments || fetchingCod}>
          {fetchingPayments || fetchingCod ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{inr(payments.totalRevenue ?? payments.totalAmount ?? 0)}</p><p className="text-xs text-muted-foreground">Platform Revenue</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{payments.totalTransactions ?? payments.totalCount ?? 0}</p><p className="text-xs text-muted-foreground">Transactions</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-green-600">{payments.completed ?? payments.successful ?? 0}</p><p className="text-xs text-muted-foreground">Completed Payments</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-amber-600">{payments.pending ?? 0}</p><p className="text-xs text-muted-foreground">Pending Payments</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>COD Cash Settlement</span>
            <Button asChild variant="outline" size="sm">
              <a href="/admin/settlements"><Link2 className="h-4 w-4" /> Manage settlements</a>
            </Button>
          </CardTitle>
          <CardDescription>Cash collected by delivery partners against cash-on-delivery orders.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <div className="rounded-lg border p-4 text-center"><p className="text-xl font-bold">{inr(cod.todaysCOD)}</p><p className="text-xs text-muted-foreground">Today&apos;s COD</p></div>
          <div className="rounded-lg border p-4 text-center"><p className="text-xl font-bold">{inr(cod.collected)}</p><p className="text-xs text-muted-foreground">Collected</p></div>
          <div className="rounded-lg border p-4 text-center"><p className="text-xl font-bold text-amber-600">{inr(cod.pendingRemit)}</p><p className="text-xs text-muted-foreground">Pending Remit</p></div>
          <div className="rounded-lg border p-4 text-center"><p className="text-xl font-bold text-orange-600">{inr(cod.inVerification)}</p><p className="text-xs text-muted-foreground">In Verification</p></div>
          <div className="rounded-lg border p-4 text-center"><p className="text-xl font-bold text-green-600">{inr(cod.settled)}</p><p className="text-xs text-muted-foreground">Settled</p></div>
          <div className="rounded-lg border p-4 text-center"><p className="text-xl font-bold text-red-600">{inr(cod.overdue)}</p><p className="text-xs text-muted-foreground">Overdue</p></div>
        </CardContent>
      </Card>

      {(fraudAlerts.length > 0 || anomalies.length > 0) && (
        <Card className="border-amber-200 bg-gradient-to-r from-amber-50/70 to-red-50/40">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-5 w-5 text-amber-600" />
              Risk Alerts
            </CardTitle>
            <Button asChild variant="outline" size="sm">
              <a href="/admin/security">
                Security Center <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </a>
            </Button>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="flex items-center gap-3 rounded-lg border bg-white p-3">
              <ShieldAlert className="h-8 w-8 text-red-600" />
              <div>
                <p className="text-lg font-bold">{highFraud}</p>
                <p className="text-xs text-muted-foreground">High-risk orders flagged</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg border bg-white p-3">
              <ShieldAlert className="h-8 w-8 text-amber-600" />
              <div>
                <p className="text-lg font-bold">{fraudAlerts.length}</p>
                <p className="text-xs text-muted-foreground">Fraud alerts for review</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg border bg-white p-3">
              <AlertTriangle className="h-8 w-8 text-violet-600" />
              <div>
                <p className="text-lg font-bold">{anomalies.length}</p>
                <p className="text-xs text-muted-foreground">System anomalies to investigate</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Outstanding by Delivery Partner</span>
              <Badge variant={totalOutstanding > 0 ? "warning" : "success"}>{inr(totalOutstanding)}</Badge>
            </CardTitle>
            <CardDescription>COD cash each partner still owes to the platform.</CardDescription>
          </CardHeader>
          <CardContent>
            {partners.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No outstanding COD cash.</p>
            ) : (
              <div className="space-y-3">
                {partners.map((p: any) => (
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

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Recent Transactions</span>
              <Button asChild variant="outline" size="sm">
                <a href="/admin/payments">View all</a>
              </Button>
            </CardTitle>
            <CardDescription>Latest payment activity across the platform.</CardDescription>
          </CardHeader>
          <CardContent>
            {transactions.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No transactions yet.</p>
            ) : (
              <div className="space-y-3">
                {transactions.map((t: any) => {
                  const status = (t.status || "pending").toLowerCase();
                  const userName = t.user?.name || t.customerName || "User";
                  return (
                    <div key={t.id || t._id} className="flex items-center justify-between rounded-lg border p-4">
                      <div>
                        <p className="font-medium">{userName}</p>
                        <p className="text-xs text-muted-foreground">{(t.method || "payment").toUpperCase()}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">{inr(t.amount || 0)}</p>
                        <Badge variant={status === "success" || status === "completed" ? "success" : status === "pending" ? "warning" : "secondary"}>
                          {status}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
