"use client";

import { Suspense, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  Clock,
  MapPin,
  ShoppingBag,
  CalendarDays,
  UserPlus,
  CheckCircle,
  Loader2,
  SearchX,
  ChevronRight,
} from "lucide-react";
import { api } from "../../../lib/api/client";
import { formatPrice, formatTime, formatDate, cn } from "../../../lib/utils";
import { Card, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { usePageParams } from "../../../lib/hooks/use-page-params";
import toast from "react-hot-toast";

interface GroupBuy {
  id: string;
  farmerName: string;
  farmerImage?: string;
  deliveryArea: string;
  day: string;
  time: string;
  cutoffTime: string;
  products: { name: string; price: number; unit: string; quantity: number }[];
  subscriberCount: number;
  maxSubscribers: number;
  isSubscribed?: boolean;
}

function CommunityBuyingInner() {
  const { params, update } = usePageParams();
  const activeTab = params.tab === "subscribed" ? "subscribed" : "available";
  const queryClient = useQueryClient();

  const { data: availableData, isLoading: availableLoading } = useQuery({
    queryKey: ["community-buying", "available"],
    queryFn: () => api.get("/community-buying/available"),
  });

  const { data: subscribedData, isLoading: subscribedLoading } = useQuery({
    queryKey: ["community-buying", "my-schedules"],
    queryFn: () => api.get("/community-buying/my-schedules"),
  });

  const joinMutation = useMutation({
    mutationFn: (scheduleId: string) =>
      api.post("/community-buying/join", { scheduleId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community-buying"] });
      toast.success("Joined the group buy! You'll get delivery updates soon.");
    },
    onError: () => {
      toast.error("Failed to join the group buy. Please try again.");
    },
  });

  const leaveMutation = useMutation({
    mutationFn: (scheduleId: string) =>
      api.post("/community-buying/leave", { scheduleId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community-buying"] });
      toast.success("Left the group buy.");
    },
    onError: () => {
      toast.error("Failed to leave the group buy. Please try again.");
    },
  });

  const availableGroups: GroupBuy[] = useMemo(() => {
    const raw = availableData?.data?.groups || availableData?.groups || [];
    return raw.map((g: any) => ({
      id: g._id || g.id,
      farmerName: g.farmerName || "Local Farmer",
      farmerImage: g.farmerImage,
      deliveryArea: g.deliveryArea || "Your Area",
      day: g.day || "Saturday",
      time: g.time || "10:00 AM",
      cutoffTime: g.cutoffTime || "Friday 6:00 PM",
      products: g.products?.map((p: any) => ({
        name: p.name || "Product",
        price: p.price,
        unit: p.unit || "kg",
        quantity: p.quantity || 1,
      })) || [],
      subscriberCount: g.subscriberCount || g.subscriber_count || 0,
      maxSubscribers: g.maxSubscribers || g.max_subscribers || 20,
      isSubscribed: g.isSubscribed || false,
    }));
  }, [availableData]);

  const myGroups: GroupBuy[] = useMemo(() => {
    const raw = subscribedData?.data?.groups || subscribedData?.groups || [];
    return raw.map((g: any) => ({
      id: g._id || g.id,
      farmerName: g.farmerName || "Local Farmer",
      farmerImage: g.farmerImage,
      deliveryArea: g.deliveryArea || "Your Area",
      day: g.day || "Saturday",
      time: g.time || "10:00 AM",
      cutoffTime: g.cutoffTime || "Friday 6:00 PM",
      products: g.products?.map((p: any) => ({
        name: p.name || "Product",
        price: p.price,
        unit: p.unit || "kg",
        quantity: p.quantity || 1,
      })) || [],
      subscriberCount: g.subscriberCount || g.subscriber_count || 0,
      maxSubscribers: g.maxSubscribers || g.max_subscribers || 20,
      isSubscribed: true,
    }));
  }, [subscribedData]);

  const displayGroups = activeTab === "available" ? availableGroups : myGroups;
  const isLoading = activeTab === "available" ? availableLoading : subscribedLoading;

  return (
    <div className="space-y-8 p-6">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100">
          <Users className="h-7 w-7 text-emerald-700" />
        </div>
        <h1 className="text-3xl font-bold text-slate-900">Community Group Buying</h1>
        <p className="max-w-2xl text-slate-500">
          Join forces with your neighbours to buy fresh produce directly from farmers in bulk.
          Everyone gets farm-fresh quality at lower prices, and farmers get larger, predictable orders.
        </p>
      </div>

      {/* How it works */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { step: "1", title: "Find a Group", desc: "Browse group buys happening near you" },
          { step: "2", title: "Join & Order", desc: "Subscribe before the cutoff time" },
          { step: "3", title: "Pick Up & Save", desc: "Collect your share at the delivery point" },
        ].map((s) => (
          <Card key={s.step} className="border-0 bg-emerald-50/50 text-center shadow-sm">
            <CardContent className="p-5">
              <span className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
                {s.step}
              </span>
              <h3 className="text-sm font-semibold text-slate-900">{s.title}</h3>
              <p className="mt-1 text-xs text-slate-500">{s.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => update({ tab: "available" })}
          className={cn(
            "rounded-xl px-5 py-2.5 text-sm font-medium transition",
            activeTab === "available"
              ? "selection-item-active"
              : "selection-item-inactive",
          )}
        >
          Available Group Buys
          {availableGroups.length > 0 && (
            <span className="ml-2 rounded-full bg-white/20 px-2 py-0.5 text-xs">
              {availableGroups.length}
            </span>
          )}
        </button>
        <button
          onClick={() => update({ tab: "subscribed" })}
          className={cn(
            "rounded-xl px-5 py-2.5 text-sm font-medium transition",
            activeTab === "subscribed"
              ? "selection-item-active"
              : "selection-item-inactive",
          )}
        >
          My Subscriptions
          {myGroups.length > 0 && (
            <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
              {myGroups.length}
            </span>
          )}
        </button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : displayGroups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            {activeTab === "available" ? (
              <>
                <ShoppingBag className="h-12 w-12 text-slate-300" />
                <p className="text-lg font-medium text-slate-700">No group buys available</p>
                <p className="text-sm text-slate-500">
                  There are no active group buys in your area right now. Check back soon!
                </p>
              </>
            ) : (
              <>
                <Users className="h-12 w-12 text-slate-300" />
                <p className="text-lg font-medium text-slate-700">No subscriptions yet</p>
                <p className="text-sm text-slate-500">
                  Join a group buy to see your subscriptions here.
                </p>
                <Button onClick={() => update({ tab: "available" })}>
                  Browse Group Buys
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {displayGroups.map((group) => {
            const spotsLeft = group.maxSubscribers - group.subscriberCount;
            const isFull = spotsLeft <= 0;

            return (
              <Card key={group.id} className="overflow-hidden border-0 shadow-md transition-all hover:shadow-lg">
                <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 p-5 text-white">
                  <div className="flex items-center gap-3">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20 text-xl backdrop-blur">
                      {group.farmerImage || "👨‍🌾"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <h3 className="truncate text-lg font-bold">{group.farmerName}</h3>
                      <p className="flex items-center gap-1 text-sm text-emerald-100">
                        <MapPin className="h-3.5 w-3.5" />
                        {group.deliveryArea}
                      </p>
                    </div>
                  </div>
                </div>

                <CardContent className="space-y-4 p-5">
                  {/* Schedule */}
                  <div className="flex flex-wrap gap-4 text-sm text-slate-600">
                    <span className="flex items-center gap-1.5">
                      <CalendarDays className="h-4 w-4 text-emerald-600" />
                      {group.day}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Clock className="h-4 w-4 text-emerald-600" />
                      {group.time}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Clock className="h-4 w-4 text-amber-600" />
                      Cutoff: {group.cutoffTime}
                    </span>
                  </div>

                  {/* Products */}
                  <div>
                    <p className="mb-2 text-xs font-medium text-slate-500">Products in this buy:</p>
                    <div className="space-y-1.5">
                      {group.products.map((p, idx) => (
                        <div key={idx} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                          <span className="text-slate-700">{p.name}</span>
                          <span className="font-medium text-emerald-700">
                            {formatPrice(p.price)}/{p.unit}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Subscribers */}
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-slate-400" />
                      <span className="text-slate-600">
                        {group.subscriberCount}/{group.maxSubscribers} subscribed
                      </span>
                    </div>
                    {isFull ? (
                      <Badge variant="destructive">Full</Badge>
                    ) : (
                      <Badge variant="success">{spotsLeft} spot{spotsLeft > 1 ? "s" : ""} left</Badge>
                    )}
                  </div>

                  {/* CTA */}
                  {group.isSubscribed ? (
                    <Button
                      variant="outline"
                      className="w-full rounded-full border-emerald-300 text-emerald-700"
                      onClick={() => leaveMutation.mutate(group.id)}
                      disabled={leaveMutation.isPending}
                    >
                      {leaveMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle className="mr-2 h-4 w-4" />
                      )}
                      {leaveMutation.isPending ? "Leaving..." : "Subscribed"}
                    </Button>
                  ) : (
                    <Button
                      className="w-full rounded-full"
                      disabled={isFull || joinMutation.isPending}
                      onClick={() => joinMutation.mutate(group.id)}
                    >
                      {joinMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <UserPlus className="mr-2 h-4 w-4" />
                      )}
                      {joinMutation.isPending ? "Joining..." : isFull ? "Group Full" : "Join Group Buy"}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Bottom info */}
      <Card className="border-emerald-100 bg-emerald-50/50">
        <CardContent className="p-6 text-center text-sm text-slate-600">
          <p>
            <strong className="text-emerald-700">How group buying works:</strong> Farmers set a minimum order
            quantity and delivery schedule. When enough neighbors join, the order is confirmed and
            delivered to a central pickup point in your area. Everyone pays the same low bulk price.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function CommunityBuyingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      }
    >
      <CommunityBuyingInner />
    </Suspense>
  );
}
