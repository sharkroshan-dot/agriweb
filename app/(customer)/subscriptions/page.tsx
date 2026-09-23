"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Loader2,
  CheckCircle2,
  Leaf,
  ShoppingBag,
  Trash2,
  Pause,
  Play,
  IndianRupee,
  PackageCheck,
  Star,
} from "lucide-react";
import { api } from "../../lib/api/client";
import { cn, formatPrice } from "../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import toast from "react-hot-toast";

interface BasketItem {
  productId: string;
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}

interface BasketPlan {
  id: string;
  name: string;
  description?: string;
  cadence: string;
  day: string;
  price: number;
  items: BasketItem[];
  farmerName: string;
  farmerId: string;
  status: "active" | "disabled";
  maxSubscribers: number;
  subscriberCount: number;
  deliveryMode: "delivery" | "pickup";
  rating?: number;
  distanceKm?: number;
}

export default function CustomerSubscriptionsPage() {
  const queryClient = useQueryClient();
  const [showSubscribe, setShowSubscribe] = useState(false);

  const { data: plansData, isLoading: plansLoading } = useQuery({
    queryKey: ["availableBasketPlans"],
    queryFn: () => api.get("/subscriptions/plans/available"),
    retry: 1,
  });

  const { data: subsData, isLoading } = useQuery({
    queryKey: ["customerSubscriptions"],
    queryFn: () => api.get("/subscriptions/me"),
    retry: 1,
  });

  const availablePlans: BasketPlan[] = useMemo(() => {
    const list = plansData?.data?.plans || plansData?.plans || [];
    return Array.isArray(list) ? list : [];
  }, [plansData]);

  const apiSubs = useMemo(() => {
    const list = subsData?.data?.subscriptions || subsData?.data || [];
    if (Array.isArray(list) && list.length > 0) return list;
    return [];
  }, [subsData]);

  const subscribeMutation = useMutation({
    mutationFn: (planId: string) => api.post("/subscriptions", { planId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customerSubscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["availableBasketPlans"] });
      setShowSubscribe(false);
      toast.success("Basket subscribed! Farmers now have predictable demand from you.");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to subscribe"),
  });

  const manageMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "pause" | "resume" | "cancel" }) =>
      api.post(`/subscriptions/${id}/${action}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customerSubscriptions"] });
      toast.success("Basket updated");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to update basket"),
  });

  const mySubs = apiSubs.map((s: any) => ({ ...s, id: s._id || s.id }));
  const subscribedPlanIds = new Set(mySubs.filter((s: any) => s.status !== "cancelled").map((s: any) => s.planId));
  const canSubscribe = availablePlans.filter((p) => !subscribedPlanIds.has(p.id));
  const full = (p: BasketPlan) => p.subscriberCount >= p.maxSubscribers;

  const itemLabel = (i: BasketItem) =>
    `${i.name}${i.quantity > 0 ? ` · ${i.quantity} ${i.unit}` : ""}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Farm Baskets & Subscriptions</h1>
          <p className="text-gray-500">Get fresh produce on a schedule. Farmers get predictable demand.</p>
        </div>
        <Button onClick={() => setShowSubscribe((v) => !v)} disabled={subscribeMutation.isPending}>
          {showSubscribe ? "Close" : "Browse Baskets"}
        </Button>
      </div>

      {showSubscribe && (
        <div>
          {plansLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : canSubscribe.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-14 text-center">
                <ShoppingBag className="h-10 w-10 text-gray-300" />
                <p className="mt-3 text-sm text-slate-500">
                  No new baskets available right now. Check back soon — farmers publish baskets regularly.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {canSubscribe.map((p) => (
                <Card key={p.id} className="flex flex-col">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                        <ShoppingBag className="h-5 w-5" />
                      </div>
                      <Badge variant="outline">{p.cadence}</Badge>
                    </div>
                    <CardTitle className="mt-3 text-base">{p.name}</CardTitle>
                    <CardDescription>
                      Every {p.day === "1st of month" ? p.day : p.day} · {p.farmerName}
                      {p.rating ? (
                        <span className="ml-1 inline-flex items-center gap-0.5 text-yellow-600">
                          <Star className="h-3 w-3 fill-current" /> {p.rating.toFixed(1)}
                        </span>
                      ) : null}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-3">
                    {p.description ? (
                      <p className="text-xs text-slate-500">{p.description}</p>
                    ) : null}
                    <ul className="flex flex-wrap gap-1.5">
                      {p.items.map((i) => (
                        <li key={i.productId} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          {itemLabel(i)}
                        </li>
                      ))}
                    </ul>
                    <div className="text-xs text-slate-500">
                      {p.subscriberCount} / {p.maxSubscribers} subscriptions
                    </div>
                    <div className="mt-auto pt-3">
                      <div className="mb-2 flex items-end justify-between">
                        <span className="text-xl font-bold text-emerald-700">{formatPrice(p.price)}</span>
                        <span className="text-xs text-gray-400">/ {p.cadence.toLowerCase()}</span>
                      </div>
                      <Button
                        className="w-full"
                        disabled={subscribeMutation.isPending || full(p)}
                        onClick={() => subscribeMutation.mutate(p.id)}
                      >
                        {subscribeMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Leaf className="mr-2 h-4 w-4" />}
                        {full(p) ? "Basket Full" : "Subscribe"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <h2 className="mb-3 text-lg font-semibold">Your baskets</h2>
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : mySubs.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center py-14 text-center">
              <CalendarClock className="h-10 w-10 text-gray-300" />
              <p className="mt-3 text-sm text-slate-500">
                You haven't subscribed to any farm basket yet. Browse baskets to get started.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {mySubs.map((s: any) => {
              const cancelled = s.status === "cancelled";
              const paused = s.status === "paused";
              return (
                <Card key={s.id} className={cn(cancelled && "opacity-60")}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-base">{s.planName}</CardTitle>
                        <CardDescription className="mt-1 flex items-center gap-2">
                          <span className="capitalize">{s.cadence}</span> · {s.day} · {s.farmerName}
                          {s.weekNumber > 0 && <span>· Week {s.weekNumber}</span>}
                        </CardDescription>
                      </div>
                      <Badge variant={s.status === "active" ? "success" : cancelled ? "destructive" : "secondary"}>
                        {s.status === "active" ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <Pause className="mr-1 h-3 w-3" />}
                        {s.status === "active" ? "Active" : s.status === "cancelled" ? "Cancelled" : "Paused"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-1.5">
                      {(s.items || []).map((i: any, idx: number) => (
                        <span key={idx} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          {itemLabel(i)}
                        </span>
                      ))}
                    </div>
                    {s.nextDelivery && s.status !== "cancelled" && (
                      <p className="flex items-center gap-1.5 text-sm text-gray-600">
                        <PackageCheck className="h-4 w-4 text-emerald-600" />
                        Next delivery:{" "}
                        <span className="font-medium">
                          {new Date(s.nextDelivery).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
                        </span>
                      </p>
                    )}
                    <div className="flex items-center justify-between border-t pt-3">
                      <span className="font-bold text-emerald-700">{formatPrice(s.price)}</span>
                      {!cancelled && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={manageMutation.isPending}
                            onClick={() => manageMutation.mutate({ id: s.id, action: paused ? "resume" : "pause" })}
                          >
                            {paused ? <Play className="mr-1.5 h-3.5 w-3.5" /> : <Pause className="mr-1.5 h-3.5 w-3.5" />}
                            {paused ? "Resume" : "Pause"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-600 hover:bg-red-50"
                            disabled={manageMutation.isPending}
                            onClick={() => manageMutation.mutate({ id: s.id, action: "cancel" })}
                          >
                            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Cancel
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50">
        <CardContent className="flex items-center gap-3 p-4">
          <IndianRupee className="h-6 w-6 shrink-0 text-emerald-600" />
          <p className="text-sm text-emerald-900/80">
            Subscriptions give farmers predictable income and reduce food waste — you always get the freshest harvest.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}