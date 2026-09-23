"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ShoppingBasket, ToggleLeft, ToggleRight, Trash2, Users, Star } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { api } from "../../../lib/api/client";
import { formatPrice, formatDate } from "../../../lib/utils";

interface BasketPlan {
  id: string;
  name: string;
  description?: string;
  cadence: string;
  day: string;
  price: number;
  items: { productId: string; name: string; quantity: number; unit: string; unitPrice: number }[];
  farmerId: string;
  farmerName: string;
  maxSubscribers: number;
  subscriberCount: number;
  deliveryMode: "delivery" | "pickup";
  status: "active" | "disabled";
  rating?: number;
  createdAt: string;
}

export default function AdminSubscriptionsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["adminBasketPlans", statusFilter],
    queryFn: () =>
      api.get("/subscriptions/plans", {
        params: { status: statusFilter !== "all" ? statusFilter : undefined, limit: 100 },
      }),
  });

  const plans: BasketPlan[] = data?.data?.plans || [];

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "disabled" }) =>
      api.put(`/subscriptions/plans/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminBasketPlans"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/subscriptions/plans/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminBasketPlans"] });
    },
  });

  const itemLabel = (i: BasketPlan["items"][number]) =>
    `${i.name} · ${i.quantity} ${i.unit}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Farm Baskets</h1>
          <p className="text-sm text-muted-foreground">Monitor farmer-created basket plans and subscriptions across the platform.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => queryClient.invalidateQueries({ queryKey: ["adminBasketPlans"] })}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        {["all", "active", "disabled"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
              statusFilter === s ? "bg-primary text-primary-foreground" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>All Basket Plans</CardTitle>
          <CardDescription>{plans.length} plan{plans.length !== 1 ? "s" : ""} found</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">Loading baskets...</div>
          ) : plans.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">No basket plans found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-6 py-3 font-medium">Basket</th>
                    <th className="px-6 py-3 font-medium">Farmer</th>
                    <th className="px-6 py-3 font-medium">Schedule</th>
                    <th className="px-6 py-3 font-medium">Price</th>
                    <th className="px-6 py-3 font-medium">Subscribers</th>
                    <th className="px-6 py-3 font-medium">Rating</th>
                    <th className="px-6 py-3 font-medium">Status</th>
                    <th className="px-6 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((p) => (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-slate-50/50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <ShoppingBasket className="h-4 w-4 text-emerald-600" />
                          <div>
                            <p className="font-medium">{p.name}</p>
                            <p className="text-xs text-slate-500">{p.items.map(itemLabel).join(", ")}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-600">{p.farmerName}</td>
                      <td className="px-6 py-4 capitalize text-slate-600">{p.cadence} · {p.day}</td>
                      <td className="px-6 py-4 font-medium">{formatPrice(p.price)}</td>
                      <td className="px-6 py-4">
                        <span className="flex items-center gap-1">
                          <Users className="h-3.5 w-3.5 text-slate-400" />
                          {p.subscriberCount} / {p.maxSubscribers}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {p.rating ? (
                          <span className="flex items-center gap-1 text-yellow-600">
                            <Star className="h-3.5 w-3.5 fill-current" /> {p.rating.toFixed(1)}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant={p.status === "active" ? "success" : "secondary"} className="capitalize">{p.status}</Badge>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              toggleMutation.mutate({
                                id: p.id,
                                status: p.status === "active" ? "disabled" : "active",
                              })
                            }
                            title={p.status === "active" ? "Disable" : "Activate"}
                          >
                            {p.status === "active" ? (
                              <ToggleRight className="h-4 w-4 text-emerald-600" />
                            ) : (
                              <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-600"
                            title="Delete"
                            onClick={() => {
                              if (window.confirm(`Delete "${p.name}"?`)) deleteMutation.mutate(p.id);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}