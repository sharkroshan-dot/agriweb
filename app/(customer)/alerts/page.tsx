"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { AlertCircle, Bell, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { api } from "../../lib/api/client";
import { formatDate, formatPrice } from "../../lib/utils";

const alertTypeLabels: Record<string, string> = {
  back_in_stock: "Back in stock",
  price_drop: "Price drop",
};

export default function AlertsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["customerAlerts"],
    queryFn: () => api.get("/customers/me/alerts"),
  });

  const alerts = (data as any)?.data ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["customerAlerts"] });

  const removeAlert = async (alertId: string) => {
    try {
      await api.delete(`/customers/me/alerts/${alertId}`);
      refresh();
    } catch {
      // ignore - api client will handle display if needed
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Product Alerts</h1>
          <p className="text-sm text-muted-foreground">
            Manage your back-in-stock and price-drop alerts for products you care about.
          </p>
        </div>
        <Button asChild>
          <Link href="/nearby">
            <Bell className="mr-2 h-4 w-4" /> Browse products
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500" /> Active Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-10">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
            </div>
          ) : isError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700">
              Unable to load alerts. Please refresh the page.
            </div>
          ) : alerts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <AlertCircle className="h-10 w-10 text-slate-300" />
              <p className="font-medium text-slate-900">No alerts active yet</p>
              <p className="text-sm text-muted-foreground">
                Set back-in-stock or price-drop alerts on product pages so we can notify you.
              </p>
              <Button asChild>
                <Link href="/nearby">Browse products</Link>
              </Button>
            </div>
          ) : (
            <div className="grid gap-4">
              {alerts.map((alert: any) => (
                <div
                  key={alert.id}
                  className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="flex items-start gap-4">
                      <div className="h-16 w-16 overflow-hidden rounded-3xl bg-slate-100">
                        <img
                          src={alert.productImage || "/images/placeholder-product.jpg"}
                          alt={alert.productName}
                          className="h-full w-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = "/images/placeholder-product.jpg";
                          }}
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-base font-semibold text-slate-900">
                          <Link href={`/product/${alert.productId}`} className="hover:text-emerald-700">
                            {alert.productName}
                          </Link>
                        </p>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                          <span>{alertTypeLabels[alert.alertType] || alert.alertType}</span>
                          {alert.alertType === "price_drop" && alert.targetPrice != null && (
                            <span>
                              Target: {formatPrice(Number(alert.targetPrice))}
                            </span>
                          )}
                          <span>Created {formatDate(alert.createdAt)}</span>
                        </div>
                        <p className="mt-3 text-sm text-slate-700">
                          Current price: {formatPrice(Number(alert.price ?? alert.priceAtSubscribe ?? 0))}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-600"
                        onClick={() => removeAlert(alert.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" /> Remove
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
