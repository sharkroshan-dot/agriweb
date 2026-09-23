"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText, Printer, RefreshCw, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Select, SelectContent, SelectItem } from "../../../components/ui/select";
import { api } from "../../../lib/api/client";
import toast from "react-hot-toast";

const inr = (v: number) => `Rs ${Number(v || 0).toLocaleString("en-IN")}`;

export default function AdminReportsPage() {
  const [period, setPeriod] = useState("weekly");
  const [isGenerating, setIsGenerating] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["adminReports", period],
    queryFn: () => api.get("/admin/reports", { params: { period } }),
  });

  const report = data ?? {};
  const totalRevenue = report.totalRevenue || 0;
  const totalOrders = report.totalOrders || 0;
  const newUsers = report.newUsers || 0;
  const newFarmers = report.newFarmers || 0;
  const topProducts: any[] = report.topProducts || [];

  const handleGenerateReport = () => {
    setIsGenerating(true);
    const rows = [
      ["Metric", "Value"],
      ["Period", period],
      ["Total Revenue", inr(totalRevenue)],
      ["Total Orders", String(totalOrders)],
      ["New Users", String(newUsers)],
      ["New Farmers", String(newFarmers)],
      ...topProducts.map((p) => [`Top product ${p.productId}`, `${p.totalSold} sold`]),
    ];
    const blob = new Blob([rows.map((row) => row.join(",")).join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `admin-report-${period}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setIsGenerating(false);
    toast.success("Report generated");
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-primary">Reporting</p>
        <h1 className="text-3xl font-semibold tracking-tight">Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">Generate operational, financial, and performance summaries.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Weekly operations</CardTitle>
            <CardDescription>Fulfillment, inventory, and delivery snapshot.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select value={period} onValueChange={setPeriod}>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="yearly">Yearly</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-3">
              <Button onClick={handleGenerateReport} disabled={isGenerating}>
                <Download className="mr-2 h-4 w-4" />
                {isGenerating ? "Generating..." : "Generate report"}
              </Button>
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="mr-2 h-4 w-4" />
                Print
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Finance summary</CardTitle>
            <CardDescription>Payments, invoices, and reconciliation overview.</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-3">
            <Button variant="outline" onClick={handleGenerateReport}>
              <FileText className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
            <Button variant="ghost" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{period.charAt(0).toUpperCase() + period.slice(1)} summary</CardTitle>
          <CardDescription>Real data for the selected reporting period.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">Total Revenue</p><p className="mt-1 text-2xl font-semibold text-emerald-600">{inr(totalRevenue)}</p></div>
              <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">Total Orders</p><p className="mt-1 text-2xl font-semibold">{totalOrders}</p></div>
              <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">New Users</p><p className="mt-1 text-2xl font-semibold">{newUsers}</p></div>
              <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">New Farmers</p><p className="mt-1 text-2xl font-semibold">{newFarmers}</p></div>
            </div>
          )}
          {topProducts.length > 0 && (
            <div className="mt-6">
              <p className="mb-2 text-sm font-medium">Top products</p>
              <div className="space-y-2">
                {topProducts.map((p) => (
                  <div key={p.productId} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                    <span className="text-muted-foreground">{p.productId}</span>
                    <span className="font-medium">{p.totalSold} sold • {inr(p.revenue)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
