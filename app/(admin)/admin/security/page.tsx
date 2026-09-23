"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ShieldAlert,
  AlertTriangle,
  Shield,
  Search,
  Loader2,
  Eye,
  Ban,
  ArrowUpRight,
} from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { api } from "../../../lib/api/client";
import { formatPrice, formatDate } from "../../../lib/utils";

const riskBadge = (level: string) => {
  if (level === "HIGH") return <Badge variant="destructive">{level} RISK</Badge>;
  if (level === "MEDIUM") return <Badge variant="warning">{level} RISK</Badge>;
  return <Badge variant="success">{level} RISK</Badge>;
};

const riskBar = (score: number) => {
  const color = score > 70 ? "bg-red-500" : score > 30 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-slate-200">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${Math.min(100, score)}%` }} />
      </div>
      <span className="text-sm font-bold">{score}/100</span>
    </div>
  );
};

export default function AdminSecurityCenterPage() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["adminSecurityCenter"],
    queryFn: () => api.get("/ai/security-center"),
  });

  const security = (data as any)?.data ?? (data as any) ?? {};
  const fraudAlerts = security.fraudAlerts ?? [];
  const anomalies = security.anomalies ?? [];

  const fraudHigh = fraudAlerts.filter((f: any) => f.riskLevel === "HIGH").length;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 animate-pulse rounded bg-gray-200" />
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg bg-gray-200" />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-lg bg-gray-200" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Intelligence & protection</p>
          <h1 className="text-3xl font-semibold tracking-tight">Security Center</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Fraud alerts and system anomalies. High-risk items need manual review — AI never bans automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <Loader2 className="mr-1.5 h-4 w-4" /> Refresh
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/ai">
              <ArrowUpRight className="mr-1.5 h-4 w-4" /> AI Control Center
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <ShieldAlert className="h-6 w-6 text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{security.fraudAlertCount ?? fraudAlerts.length}</p>
              <p className="text-sm text-muted-foreground">Fraud alerts</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
              <AlertTriangle className="h-6 w-6 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{security.anomalyCount ?? anomalies.length}</p>
              <p className="text-sm text-muted-foreground">System anomalies</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-100">
              <Shield className="h-6 w-6 text-violet-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{fraudHigh}</p>
              <p className="text-sm text-muted-foreground">High-risk orders</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-red-600" /> Fraud Alerts
            </CardTitle>
            <CardDescription>
              Orders flagged for review based on COD cancellations, refunds, failed payments and unusual order value.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {fraudAlerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
                <Shield className="h-10 w-10 text-gray-300" />
                <p className="mt-3 text-sm text-gray-500">No fraud alerts right now.</p>
              </div>
            ) : (
              fraudAlerts.map((alert: any) => (
                <div key={alert.orderId} className="rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">Order #{alert.orderNumber || alert.orderId}</p>
                      <p className="text-sm text-muted-foreground">
                        {alert.customerName || "Customer"} · {formatPrice(alert.totalAmount)} · {alert.paymentMethod}
                        {alert.orderDate ? ` · ${formatDate(alert.orderDate)}` : ""}
                      </p>
                    </div>
                    {riskBadge(alert.riskLevel)}
                  </div>
                  {riskBar(alert.riskScore)}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(alert.flags || []).map((flag: string) => (
                      <Badge key={flag} variant="outline" className="text-xs">
                        {flag.replace(/_/g, " ")}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-amber-700">{alert.recommendation}</p>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="outline">
                      <Eye className="mr-1.5 h-3.5 w-3.5" /> Investigate
                    </Button>
                    <Button size="sm" variant="outline" className="text-amber-700">
                      <Ban className="mr-1.5 h-3.5 w-3.5" /> Hold Order
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" /> System Anomalies
            </CardTitle>
            <CardDescription>
              Unusual behavior compared with normal ranges. Anomaly ≠ fraud — flag for review, don't block.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {anomalies.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
                <Search className="h-10 w-10 text-gray-300" />
                <p className="mt-3 text-sm text-gray-500">No anomalies detected yet.</p>
              </div>
            ) : (
              anomalies.map((anomaly: any, index: number) => (
                <div key={index} className="rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{anomaly.entityName}</p>
                      <p className="text-xs text-muted-foreground">
                        {anomaly.entityType === "farmer_sales"
                          ? "Farmer daily sales"
                          : "Partner COD collection"}{" "}
                        · z-score {anomaly.zScore}
                      </p>
                    </div>
                    <Badge variant="warning">Anomaly</Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-sm">
                    <span className="text-slate-500">
                      Normal: <strong>₹{Math.round(anomaly.median)}</strong>
                    </span>
                    <span className="text-amber-600">
                      Today: <strong>₹{Math.round(anomaly.current)}</strong>
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-600">{anomaly.reason}</p>
                  <Button size="sm" variant="outline" className="mt-3">
                    <Eye className="mr-1.5 h-3.5 w-3.5" /> Investigate
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}