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
  PackageCheck,
  Star,
  Truck,
  CalendarDays,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  Sprout,
  Apple,
  Carrot,
  Gift,
  ChevronRight,
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
  category?: string;
}

type PlanFilter = "all" | "vegetables" | "fruits" | "mixed" | "organic";

const filterOptions: { id: PlanFilter; label: string; Icon: typeof Leaf }[] = [
  { id: "all", label: "All Plans", Icon: ShoppingBag },
  { id: "vegetables", label: "Vegetables", Icon: Carrot },
  { id: "fruits", label: "Fruits", Icon: Apple },
  { id: "mixed", label: "Mixed", Icon: Gift },
  { id: "organic", label: "Organic", Icon: Sprout },
];

function getPlanCategory(plan: BasketPlan): PlanFilter {
  const text = `${plan.category || ""} ${plan.name || ""} ${plan.description || ""}`.toLowerCase();
  if (text.includes("organic")) return "organic";
  const names = (plan.items || []).map((item) => item.name.toLowerCase()).join(" ");
  const fruitWords = /fruit|apple|banana|mango|orange|grape|papaya|guava|watermelon|pineapple|pomegranate/;
  const vegetableWords = /vegetable|brinjal|tomato|potato|onion|carrot|beans|spinach|cabbage|cauliflower|okra|ladies finger/;
  const hasFruit = fruitWords.test(names);
  const hasVegetable = vegetableWords.test(names);
  if (text.includes("fruit") && !text.includes("vegetable")) return "fruits";
  if (text.includes("vegetable") && !text.includes("fruit")) return "vegetables";
  if (hasFruit && !hasVegetable) return "fruits";
  if (hasVegetable && !hasFruit) return "vegetables";
  return "mixed";
}

function getBasketItemImage(item: any): string | undefined {
  return item?.imageUrl || item?.image_url || item?.photoUrl || item?.photo_url ||
    item?.thumbnailUrl || item?.thumbnail || item?.image || item?.product?.imageUrl ||
    item?.product?.image_url || item?.product?.image;
}

function planArtwork(plan: BasketPlan | any) {
  const category = getPlanCategory(plan as BasketPlan);
  if (category === "fruits") return { emoji: "🍎 🍌 🍊 🍇", className: "from-amber-50 via-orange-50 to-yellow-100", image: "https://images.unsplash.com/photo-1610832958506-aa56368176cf?auto=format&fit=crop&w=900&q=85" };
  if (category === "organic") return { emoji: "🥬 🥕 🥦 🍅", className: "from-emerald-50 via-lime-50 to-green-100", image: "https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=900&q=85" };
  if (category === "vegetables") return { emoji: "🥕 🥦 🍅 🥬", className: "from-green-50 via-emerald-50 to-lime-100", image: "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=900&q=85" };
  return { emoji: "🥬 🍅 🍎 🥕", className: "from-lime-50 via-green-50 to-amber-100", image: "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=900&q=85" };
}

function subscriptionArtwork(subscription: any, plans: BasketPlan[]) {
  const planId = String(subscription?.planId?._id || subscription?.planId || "");
  const plan = plans.find((candidate) => String(candidate.id) === planId) ||
    plans.find((candidate) => candidate.name === subscription?.planName);
  return planArtwork(plan || {
    name: subscription?.planName || "",
    description: subscription?.description || "",
    category: subscription?.category,
    items: Array.isArray(subscription?.items) ? subscription.items : [],
  });
}

function BasketProduceImage({ src, alt, className, fallbackEmoji = "🥬 🥕 🍅" }: {
  src: string;
  alt: string;
  className: string;
  fallbackEmoji?: string;
}) {
  const fallback = "https://images.pexels.com/photos/1300972/pexels-photo-1300972.jpeg?auto=compress&cs=tinysrgb&w=1000";
  return (
    <div className={cn("relative overflow-hidden bg-gradient-to-br from-emerald-50 to-lime-100", className)}>
      <div className="absolute inset-0 flex items-center justify-center text-3xl tracking-widest" aria-hidden="true">{fallbackEmoji}</div>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className="relative z-10 h-full w-full object-cover"
        onError={(event) => {
          const image = event.currentTarget;
          if (image.dataset.fallbackTried !== "true" && image.src !== fallback) {
            image.dataset.fallbackTried = "true";
            image.src = fallback;
          } else {
            image.style.display = "none";
          }
        }}
      />
    </div>
  );
}

export default function CustomerSubscriptionsPage() {
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState<PlanFilter>("all");

  const { data: plansData, isLoading: plansLoading, isError: plansError } = useQuery({
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
    const payload = plansData?.data?.data ?? plansData?.data;
    const list = payload?.plans ?? plansData?.plans ?? payload ?? [];
    if (!Array.isArray(list)) return [];
    return list.map((plan: any) => ({ ...plan, id: plan._id || plan.id, items: Array.isArray(plan.items) ? plan.items : [] }));
  }, [plansData]);

  const apiSubs = useMemo(() => {
    const payload = subsData?.data?.data ?? subsData?.data;
    const list = payload?.subscriptions ?? payload ?? [];
    return Array.isArray(list) ? list : [];
  }, [subsData]);

  const subscribeMutation = useMutation({
    mutationFn: (planId: string) => api.post("/subscriptions", { planId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customerSubscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["availableBasketPlans"] });
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

  const mySubs = apiSubs.map((subscription: any) => ({
    ...subscription,
    id: subscription._id || subscription.id,
  }));
  const subscribedPlanIds = new Set(mySubs.filter((s: any) => s.status !== "cancelled").map((s: any) => String(s.planId?._id || s.planId)));
  const canSubscribe = availablePlans.filter((plan) => !subscribedPlanIds.has(String(plan.id)));
  const visiblePlans = canSubscribe.filter((plan) => activeFilter === "all" || getPlanCategory(plan) === activeFilter);
  const activeSubscription = mySubs.find((subscription: any) => subscription.status === "active") || mySubs.find((subscription: any) => subscription.status === "paused");
  const full = (plan: BasketPlan) => Number(plan.maxSubscribers || 0) > 0 && Number(plan.subscriberCount || 0) >= Number(plan.maxSubscribers);

  const itemLabel = (item: BasketItem) =>
    `${item.name}${item.quantity > 0 ? ` · ${item.quantity} ${item.unit}` : ""}`;

  return (
    <div className="subscription-workspace w-full min-w-0 space-y-4 pb-6 text-base">
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <span className="text-emerald-700">Home</span><ChevronRight className="h-3 w-3" />
          <span className="text-slate-700">Farm Basket Subscriptions</span>
        </div>
        <div className="relative min-h-[150px] overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-r from-white via-emerald-50 to-green-100 px-5 py-6 shadow-sm sm:px-7">
          <div className="relative z-10 max-w-3xl">
            <div className="flex items-center gap-3">
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                <ShoppingBag className="h-8 w-8" />
              </span>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Farm Basket Subscriptions</h1>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                  Get fresh, seasonal produce regularly from verified farmers. Choose a plan, subscribe once, and enjoy hassle-free deliveries at your doorstep.
                </p>
              </div>
            </div>
          </div>
          <div className="absolute inset-y-0 right-0 hidden w-[34%] overflow-hidden rounded-l-[5rem] sm:block">
            <img src="https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=90" alt="Fresh seasonal vegetables from local farms" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-r from-emerald-50/30 via-transparent to-transparent" />
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { Icon: Truck, title: "Regular Delivery", detail: "On your chosen days" },
          { Icon: Leaf, title: "Farm Fresh", detail: "Direct from farmers" },
          { Icon: CalendarDays, title: "Flexible Plans", detail: "Weekly / Bi-weekly / Monthly" },
          { Icon: RefreshCw, title: "Modify Anytime", detail: "Pause, change or cancel" },
          { Icon: ShieldCheck, title: "Quality Assured", detail: "Fresh, safe and traceable" },
        ].map(({ Icon, title, detail }) => (
          <Card key={title} className="border-slate-200/80 shadow-sm">
            <CardContent className="flex items-center gap-3 p-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><Icon className="h-5 w-5" /></span>
              <div className="min-w-0"><p className="text-sm font-bold text-slate-900">{title}</p><p className="text-xs text-slate-500">{detail}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid w-full min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_365px]">
        <section className="min-w-0">
          <div className="mb-4">
            <h2 className="text-xl font-bold text-slate-900">Choose Your Farm Basket Plan</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {filterOptions.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveFilter(id)}
                  className={cn(
                    "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition",
                    activeFilter === id
                      ? "border-emerald-700 bg-emerald-700 text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50",
                  )}
                >
                  <Icon className="h-4 w-4" />{label}
                </button>
              ))}
            </div>
          </div>

          {plansLoading ? (
            <div className="flex min-h-64 items-center justify-center rounded-2xl border border-slate-200 bg-white"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>
          ) : plansError ? (
            <Card className="border-red-100"><CardContent className="py-12 text-center"><p className="font-semibold text-slate-800">Unable to load farm basket plans</p><p className="mt-1 text-sm text-slate-500">Please refresh the page and try again.</p></CardContent></Card>
          ) : visiblePlans.length === 0 ? (
            <Card className="border-dashed border-slate-300 shadow-none">
              <CardContent className="flex min-h-64 flex-col items-center justify-center px-5 text-center">
                <ShoppingBag className="h-10 w-10 text-slate-300" />
                <p className="mt-3 font-semibold text-slate-800">{canSubscribe.length === 0 ? "No new baskets available right now" : "No plans in this category"}</p>
                <p className="mt-1 max-w-md text-sm text-slate-500">Farmers publish basket plans as produce becomes available. Try another category or check back soon.</p>
                {activeFilter !== "all" && <Button variant="outline" className="mt-4" onClick={() => setActiveFilter("all")}>View all plans</Button>}
              </CardContent>
            </Card>
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {visiblePlans.map((plan, index) => {
                const artwork = planArtwork(plan);
                return (
                  <Card key={plan.id} className={cn("flex min-w-0 flex-col overflow-hidden rounded-2xl border-slate-200 bg-white shadow-[0_3px_12px_rgba(15,23,42,0.08)] transition hover:-translate-y-0.5 hover:shadow-lg", index === 0 && "border-emerald-400 ring-1 ring-emerald-100")}>
                    <div className="relative h-32 overflow-hidden sm:h-36">
                      <BasketProduceImage src={artwork.image} alt={`${plan.name} fresh produce`} className="h-full w-full" fallbackEmoji={artwork.emoji} />
                      {index === 0 && <Badge className="absolute left-2 top-2 z-20 border-emerald-200 bg-emerald-700 text-white">Most Popular</Badge>}
                      {getPlanCategory(plan) === "organic" && <Badge className="absolute right-3 top-3 z-20 bg-white text-emerald-800"><Leaf className="mr-1 h-3 w-3" /> Organic</Badge>}
                    </div>
                    <CardHeader className="space-y-1 p-3 pb-2">
                      <CardTitle className="text-[15px] font-extrabold leading-5">{plan.name}</CardTitle>
                      <CardDescription className="min-h-10 text-[13px] leading-[1.35rem] line-clamp-2">{plan.description || `A fresh farm basket from ${plan.farmerName || "a local farmer"}.`}</CardDescription>
                      <p className="flex items-center gap-1 text-xs text-slate-500">Farmer: <span className="font-semibold text-slate-700">{plan.farmerName || "Verified farmer"}</span>
                        {plan.rating ? <span className="ml-1 inline-flex items-center gap-0.5 text-amber-600"><Star className="h-3 w-3 fill-current" />{plan.rating.toFixed(1)}</span> : null}
                      </p>
                    </CardHeader>
                    <CardContent className="flex flex-1 flex-col gap-2 px-3 pb-3 pt-1">
                      <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto pr-1">{(plan.items || []).map((item, itemIndex) => <span key={item.productId || `${item.name}-${itemIndex}`} className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800">{item.name}{item.quantity ? ` · ${item.quantity} ${item.unit || ""}`.trim() : ""}</span>)}</div>
                      <div className="space-y-1.5 border-t border-slate-100 pt-2 text-[13px] text-slate-700">
                        <p className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-emerald-600" /> Delivery: {plan.cadence}{plan.day ? ` · ${plan.day}` : ""}</p>
                        <p className="flex items-center gap-2"><PackageCheck className="h-4 w-4 text-emerald-600" /> {(plan.items || []).length} varieties included</p>
                        <p className="flex items-center gap-2"><Truck className="h-4 w-4 text-emerald-600" /> {plan.deliveryMode === "pickup" ? "Farmer pickup" : "Home delivery"}</p>
                      </div>
                      <div className="mt-auto border-t border-slate-100 pt-2">
                        <div className="mb-3 flex items-end justify-between gap-2">
                          <span className="text-[22px] font-extrabold leading-7 text-emerald-700">{formatPrice(plan.price)}</span>
                          <span className="text-sm text-slate-500">/ {String(plan.cadence || "schedule").toLowerCase()}</span>
                        </div>
                        <Button className="h-9 w-full rounded-lg bg-emerald-700 px-2 text-[13px] font-bold text-white hover:bg-emerald-800" disabled={subscribeMutation.isPending || full(plan) || !plan.id} onClick={() => subscribeMutation.mutate(plan.id)}>
                          {subscribeMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                          {full(plan) ? "Basket Full" : "Subscribe Now"}
                        </Button>
                        {Number(plan.maxSubscribers || 0) > 0 && <p className="mt-2 text-center text-[11px] text-slate-400">{plan.subscriberCount || 0} / {plan.maxSubscribers} subscribers</p>}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <Card className="overflow-hidden border-emerald-100 shadow-sm">
            <CardHeader className="bg-gradient-to-r from-emerald-50 to-green-50 p-4">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-lg"><ShoppingBag className="h-5 w-5 text-emerald-700" /> My Subscription</CardTitle>
                {activeSubscription ? <Badge className="bg-emerald-700 text-white">{activeSubscription.status === "active" ? "Active" : "Paused"}</Badge> : <Badge variant="secondary">No active plan</Badge>}
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {isLoading ? <div className="flex justify-center py-5"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div> : activeSubscription ? (
                <div className="flex items-center gap-3">
                  <BasketProduceImage src={subscriptionArtwork(activeSubscription, availablePlans).image} alt={`${activeSubscription.planName || "Farm basket"} vegetables and produce`} className="h-16 w-16 shrink-0 rounded-xl" fallbackEmoji={subscriptionArtwork(activeSubscription, availablePlans).emoji} />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-900">{activeSubscription.planName || "Farm Basket"}</p>
                    {activeSubscription.nextDelivery && <p className="mt-1 text-xs text-slate-600">Next delivery: {new Date(activeSubscription.nextDelivery).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>}
                    <p className="mt-1 text-xs text-slate-500">Plan: {activeSubscription.cadence || "Recurring"} · {activeSubscription.farmerName || "Local farmer"}</p>
                  </div>
                </div>
              ) : (
                <div className="py-3 text-center">
                  <CalendarClock className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-2 text-sm font-semibold text-slate-700">No active subscription yet</p>
                  <p className="mt-1 text-xs text-slate-500">Choose a farmer-published basket to start regular deliveries.</p>
                </div>
              )}
              {mySubs.length > 0 && <Button variant="outline" className="mt-4 w-full" onClick={() => document.getElementById("my-subscriptions")?.scrollIntoView({ behavior: "smooth" })}>Manage my subscriptions <ChevronRight className="ml-1 h-4 w-4" /></Button>}
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="p-4 pb-2"><CardTitle className="flex items-center gap-2 text-base"><Gift className="h-5 w-5 text-emerald-700" /> Subscription Benefits</CardTitle></CardHeader>
            <CardContent className="space-y-3 p-4 pt-2">
              {["Fresh and seasonal produce", "Planned and reliable delivery", "Support local farmers", "Flexible pause and cancellation", "Traceable farm-to-home sourcing"].map((benefit) => (
                <p key={benefit} className="flex items-start gap-2 text-sm text-slate-700"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{benefit}</p>
              ))}
            </CardContent>
          </Card>
        </aside>
      </div>

      <section id="my-subscriptions">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="text-lg font-bold text-slate-900">My Subscriptions</h2><p className="text-xs text-slate-500">Manage the farm baskets you have joined.</p></div>
          <Badge variant="outline">{mySubs.length} subscription{mySubs.length === 1 ? "" : "s"}</Badge>
        </div>
        {isLoading ? <div className="flex justify-center py-8"><Loader2 className="h-7 w-7 animate-spin text-emerald-600" /></div> : mySubs.length === 0 ? (
          <Card className="border-dashed border-slate-300 shadow-none"><CardContent className="flex items-center gap-3 p-5"><ShoppingBag className="h-8 w-8 text-slate-300" /><div><p className="font-semibold text-slate-800">Your subscriptions will appear here</p><p className="text-sm text-slate-500">Subscribe to a published basket plan to see its schedule and manage it here.</p></div></CardContent></Card>
        ) : (
          <div className="space-y-3">
            {mySubs.map((subscription: any) => {
              const cancelled = subscription.status === "cancelled";
              const paused = subscription.status === "paused";
              return (
                <Card key={subscription.id} className={cn("overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm", cancelled && "opacity-60")}>
                  <CardContent className="flex flex-col gap-4 p-3 sm:flex-row sm:items-center sm:gap-5 sm:px-5">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <BasketProduceImage src={subscriptionArtwork(subscription, availablePlans).image} alt={`${subscription.planName || "Farm basket"} vegetables and produce`} className="h-14 w-14 shrink-0 rounded-xl" fallbackEmoji={subscriptionArtwork(subscription, availablePlans).emoji} />
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-extrabold text-slate-900">{subscription.planName || "Farm Basket"}</p>
                        <p className="mt-1 text-xs text-slate-600">{subscription.cadence || "Recurring"} · {subscription.day || "Scheduled"} · {subscription.items?.length || 0} varieties</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
                      <div className="min-w-[130px]">
                        <p className="flex items-center gap-2 text-xs text-slate-500"><CalendarDays className="h-4 w-4 text-emerald-700" />Next Delivery</p>
                        <p className="pl-6 text-sm font-semibold text-slate-800">{subscription.nextDelivery ? new Date(subscription.nextDelivery).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "To be scheduled"}</p>
                      </div>
                      <div className="min-w-[120px]">
                        <p className="flex items-center gap-2 text-xs text-slate-500"><Truck className="h-4 w-4 text-emerald-700" />Delivery Day</p>
                        <p className="pl-6 text-sm font-semibold text-slate-800">{subscription.day || "As per plan"}</p>
                      </div>
                      <Badge className="border-0 bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-800" variant="secondary">{paused ? "Paused" : cancelled ? "Cancelled" : "Active"}</Badge>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2 sm:ml-auto">
                      {!cancelled && <Button size="sm" variant="outline" className="rounded-xl" disabled={manageMutation.isPending} onClick={() => manageMutation.mutate({ id: subscription.id, action: paused ? "resume" : "pause" })}>{paused ? <Play className="mr-1 h-3.5 w-3.5" /> : <Pause className="mr-1 h-3.5 w-3.5" />}{paused ? "Resume" : "Pause"}</Button>}
                      {!cancelled && <Button size="sm" variant="outline" className="rounded-xl border-red-200 text-red-600 hover:bg-red-50" disabled={manageMutation.isPending} onClick={() => manageMutation.mutate({ id: subscription.id, action: "cancel" })}><Trash2 className="mr-1 h-3.5 w-3.5" />Cancel</Button>}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <div className="overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50 via-green-50 to-lime-50 px-5 py-5 sm:px-7">
        <div className="flex items-center gap-4">
          <span className="hidden text-4xl sm:block">🌱</span>
          <div><h2 className="text-lg font-bold text-emerald-950">Farm to Home, Regularly</h2><p className="mt-1 text-sm text-emerald-900/75">Subscribe to a farm basket and enjoy fresh, seasonal produce from local farmers on a schedule that works for you.</p></div>
          <span className="ml-auto hidden text-4xl sm:block">🏡</span>
        </div>
      </div>
    </div>
  );
}
