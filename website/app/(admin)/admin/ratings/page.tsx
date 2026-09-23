"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Loader2, Star, Trash2 } from "lucide-react";
import { api } from "../../../lib/api/client";
import toast from "react-hot-toast";

const Stars = ({ value }: { value: number }) => (
  <span className="flex items-center gap-0.5">
    {[1, 2, 3, 4, 5].map((s) => (
      <Star key={s} className={`h-3.5 w-3.5 ${s <= value ? "fill-yellow-400 text-yellow-400" : "text-slate-300"}`} />
    ))}
  </span>
);

export default function AdminDeliveryRatingsPage() {
  const queryClient = useQueryClient();
  const [partnerFilter, setPartnerFilter] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: ratingsData, isLoading } = useQuery({
    queryKey: ["adminDeliveryRatings", partnerFilter],
    queryFn: () =>
      api.get("/delivery-ratings/admin", {
        params: { limit: 100, partnerId: partnerFilter || undefined },
      }),
  });

  const { data: partnersData } = useQuery({
    queryKey: ["adminDeliveryPartners"],
    queryFn: () => api.get("/delivery/admin/partners", { params: { limit: 100 } }),
  });

  const ratings = ratingsData?.data?.ratings || [];
  const partners = partnersData?.data?.partners || [];

  const summary = useMemo(() => {
    if (!ratings.length) return { total: 0, avg: 0, distribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 } };
    const total = ratings.length;
    const sum = ratings.reduce((acc: number, r: any) => acc + (r.overallRating || 0), 0);
    const dist: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    ratings.forEach((r: any) => {
      const key = String(r.overallRating);
      if (dist[key] !== undefined) dist[key] += 1;
    });
    return { total, avg: (sum / total).toFixed(2), distribution: dist };
  }, [ratings]);

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this delivery partner rating? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      await api.delete(`/delivery-ratings/${id}`);
      toast.success("Rating deleted");
      queryClient.invalidateQueries({ queryKey: ["adminDeliveryRatings"] });
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete rating");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-primary">Logistics</p>
        <h1 className="text-3xl font-semibold tracking-tight">Delivery partner ratings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage customer ratings left for delivery partners across delivered orders.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{summary.total}</p>
            <p className="text-xs text-muted-foreground">Total ratings</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-yellow-600">{summary.avg || "—"}</p>
            <p className="text-xs text-muted-foreground">Average overall rating</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{Object.values(summary.distribution).reduce((a: number, b: number) => a + b, 0)}</p>
            <p className="text-xs text-muted-foreground">5-star ratings</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Star className="h-5 w-5 text-yellow-500" /> All ratings
            </CardTitle>
            <CardDescription>
              One rating per delivered order. Remove ratings that violate guidelines.
            </CardDescription>
          </div>
          <select
            value={partnerFilter}
            onChange={(e) => setPartnerFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-emerald-500"
          >
            <option value="">All delivery partners</option>
            {partners.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.user?.name || p.name || "Partner"}
              </option>
            ))}
          </select>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : ratings.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No delivery partner ratings found.
            </p>
          ) : (
            ratings.map((r: any) => (
              <div key={r.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{r.deliveryPartnerName}</p>
                      <Badge variant="secondary">{r.orderNumber}</Badge>
                      {r.customerName && <span className="text-xs text-muted-foreground">by {r.customerName}</span>}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={deletingId === r.id}
                    onClick={() => handleDelete(r.id)}
                  >
                    {deletingId === r.id ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" />}
                    Remove
                  </Button>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Overall</span>
                    <span className="flex items-center gap-2">
                      {r.overallRating} <Stars value={r.overallRating} />
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">On-time</span>
                    <Stars value={r.onTimeRating} />
                  </div>
                  <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Professionalism</span>
                    <Stars value={r.professionalismRating} />
                  </div>
                  <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Handling</span>
                    <Stars value={r.handlingRating} />
                  </div>
                  <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Communication</span>
                    <Stars value={r.communicationRating} />
                  </div>
                </div>
                {r.feedback && (
                  <p className="mt-3 rounded-md bg-muted/30 p-2 text-sm text-muted-foreground">
                    &ldquo;{r.feedback}&rdquo;
                  </p>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
