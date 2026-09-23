"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Star, RefreshCw, MessageSquare, Truck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { api } from "../../../lib/api/client";

const Stars = ({ value }: { value: number }) => (
  <span className="flex items-center gap-0.5">
    {[1, 2, 3, 4, 5].map((s) => (
      <Star key={s} className={`h-3.5 w-3.5 ${s <= value ? "fill-yellow-400 text-yellow-400" : "text-slate-300"}`} />
    ))}
  </span>
);

const CategoryRow = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-lg border p-3 text-center">
    <p className="text-2xl font-bold text-yellow-600">{value || 0}</p>
    <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    <div className="mt-2 flex items-center justify-center gap-0.5">
      <Stars value={Math.round(value || 0)} />
    </div>
  </div>
);

export default function DeliveryMyRatingsPage() {
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken as string | undefined;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["deliveryMyRatings"],
    queryFn: () => api.get("/delivery-ratings/partner/me", { params: { limit: 50 } }),
    enabled: Boolean(accessToken),
    retry: 1,
  });

  const result = useMemo(() => data?.data || {}, [data]);
  const ratings: any[] = result.ratings || [];
  const summary: any = result.summary || {};
  const total = result.pagination?.total ?? summary.count ?? ratings.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Performance</p>
          <h1 className="text-3xl font-semibold tracking-tight">My Ratings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Customer feedback on your deliveries. Personal details are never shared with you.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Average rating</p>
                    <p className="text-2xl font-bold text-yellow-600">{summary.overallAvg ?? 0}</p>
                  </div>
                  <div className="rounded-full bg-muted p-2 text-yellow-600"><Star className="h-5 w-5 fill-yellow-400 text-yellow-400" /></div>
                </div>
                <div className="mt-2"><Stars value={Math.round(summary.overallAvg || 0)} /></div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Total ratings</p>
                    <p className="text-2xl font-bold">{total}</p>
                  </div>
                  <div className="rounded-full bg-muted p-2 text-blue-600"><MessageSquare className="h-5 w-5" /></div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {ratings.filter((r: any) => r.feedback).length} with written feedback
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">On-time percentage</p>
                    <p className="text-2xl font-bold">{summary.onTimePercentage ?? 0}%</p>
                  </div>
                  <div className="rounded-full bg-muted p-2 text-green-600"><Truck className="h-5 w-5" /></div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Ratings marking on-time as 4+ stars</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">5-star share</p>
                    <p className="text-2xl font-bold">
                      {summary.count ? Math.round(((summary.distribution?.["5"] || 0) / summary.count) * 100) : 0}%
                    </p>
                  </div>
                  <div className="rounded-full bg-muted p-2 text-emerald-600"><Star className="h-5 w-5" /></div>
                </div>
                <div className="mt-2 flex items-center gap-1">
                  {[5, 4, 3, 2, 1].map((star) => (
                    <span key={star} className="text-xs text-muted-foreground">
                      {star}<span className="text-slate-400">★</span>
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Star className="h-5 w-5 text-yellow-500" /> Performance breakdown
              </CardTitle>
              <CardDescription>Average score across every rating category.</CardDescription>
            </CardHeader>
            <CardContent>
              {summary.count ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                    <CategoryRow label="Overall" value={summary.overallAvg} />
                    <CategoryRow label="On-time" value={summary.onTimeAvg} />
                    <CategoryRow label="Professionalism" value={summary.professionalismAvg} />
                    <CategoryRow label="Product handling" value={summary.handlingAvg} />
                    <CategoryRow label="Communication" value={summary.communicationAvg} />
                  </div>
                  <div>
                    <h4 className="mb-2 mt-6 text-sm font-semibold">Star distribution</h4>
                    <div className="space-y-1.5">
                      {[5, 4, 3, 2, 1].map((star) => {
                        const count = summary.distribution?.[String(star)] || 0;
                        const pct = summary.count ? Math.round((count / summary.count) * 100) : 0;
                        return (
                          <div key={star} className="flex items-center gap-2 text-sm">
                            <span className="w-3 font-medium">{star}</span>
                            <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                              <div className="h-full rounded-full bg-yellow-400" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="w-8 text-right text-xs text-muted-foreground">{count}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <p className="rounded-lg bg-muted/50 p-6 text-center text-sm text-muted-foreground">
                  No ratings yet. Once customers rate your deliveries, your breakdown will appear here.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-primary" /> Rating history
              </CardTitle>
              <CardDescription>Individual ratings left on your delivered orders.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {ratings.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No ratings to show yet.</p>
              ) : (
                ratings.map((r: any) => (
                  <div key={r.id} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{r.orderNumber || `Order ${String(r.orderId).slice(-6)}`}</p>
                        <Badge variant="secondary">Delivered</Badge>
                      </div>
                      {r.createdAt && (
                        <span className="text-xs text-muted-foreground">
                          {new Date(r.createdAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
                        <span className="text-muted-foreground">Overall</span>
                        <span className="flex items-center gap-2">{r.overallRating} <Stars value={r.overallRating} /></span>
                      </div>
                      <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
                        <span className="text-muted-foreground">On-time</span><Stars value={r.onTimeRating} />
                      </div>
                      <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
                        <span className="text-muted-foreground">Professionalism</span><Stars value={r.professionalismRating} />
                      </div>
                      <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
                        <span className="text-muted-foreground">Handling</span><Stars value={r.handlingRating} />
                      </div>
                      <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
                        <span className="text-muted-foreground">Communication</span><Stars value={r.communicationRating} />
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
        </>
      )}
    </div>
  );
}
