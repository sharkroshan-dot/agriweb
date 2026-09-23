"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sprout,
  Bell,
  BellRing,
  CalendarDays,
  MapPin,
  IndianRupee,
  ShoppingBag,
  ShoppingCart,
  CheckCircle,
  Loader2,
  SearchX,
  Star,
  Wheat,
  Flower2,
} from "lucide-react";
import { api } from "../../lib/api/client";
import { formatDate, formatPrice } from "../../lib/utils";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { useCartStore } from "../../lib/store/cart-store";
import toast from "react-hot-toast";

interface HarvestPlan {
  id: string;
  cropName: string;
  expectedHarvestDate: string;
  harvestedAt?: string;
  expectedQuantityKg: number;
  preOrderPricePerKg?: number;
  preOrderCutoff?: string;
  status: string;
  farmerInfo?: { name?: string; farmName?: string; rating?: number };
  distanceKm?: number;
  preorderCount?: number;
  notes?: string;
  imageUrl?: string;
  myPreorder?: any;
  myNotify?: boolean;
}

interface HarvestSectionsProps {
  country?: string;
  state?: string;
  district?: string;
  city?: string;
  coords?: { lat?: string; lng?: string } | null;
  radius?: number;
}

function HarvestCard({
  plan,
  onPreorder,
  onNotify,
  busy,
  harvested,
}: {
  plan: HarvestPlan;
  onPreorder: (plan: HarvestPlan, qty: number) => void;
  onNotify: (plan: HarvestPlan) => void;
  busy: boolean;
  harvested?: boolean;
}) {
  const [qty, setQty] = useState<number>(plan.myPreorder?.quantityKg || 1);
  const preordering = busy;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="flex items-start justify-between gap-3 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50">
              <Sprout className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">{plan.cropName}</h3>
              <p className="text-sm text-gray-500">
                {plan.farmerInfo?.farmName || plan.farmerInfo?.name || "Local Farm"}
              </p>
              {plan.farmerInfo?.rating ? (
                <p className="mt-0.5 text-xs text-yellow-600">★ {Number(plan.farmerInfo.rating).toFixed(1)}</p>
              ) : null}
            </div>
          </div>
          {harvested ? (
            <Badge variant="success">Harvested</Badge>
          ) : plan.status === "harvested" ? (
            <Badge variant="success">Harvested</Badge>
          ) : plan.status === "closed" ? (
            <Badge variant="secondary">Closed</Badge>
          ) : (
            <Badge variant="outline">Pre-order Open</Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 border-t px-5 py-4 text-sm">
          <div className="flex items-center gap-2 text-gray-600">
            <CalendarDays className="h-4 w-4 text-emerald-600" />
            <span>
              {harvested ? "Harvested:" : "Harvest:"}{" "}
              <strong>{formatDate(plan.harvestedAt || plan.expectedHarvestDate)}</strong>
            </span>
          </div>
          <div className="flex items-center gap-2 text-gray-600">
            <Wheat className="h-4 w-4 text-emerald-600" />
            <span>{plan.expectedQuantityKg} kg planned</span>
          </div>
          <div className="flex items-center gap-2 text-gray-600">
            <IndianRupee className="h-4 w-4 text-emerald-600" />
            <span>₹{plan.preOrderPricePerKg ?? "--"}/kg</span>
          </div>
          <div className="flex items-center gap-2 text-gray-600">
            <MapPin className="h-4 w-4 text-emerald-600" />
            <span>{plan.distanceKm ? `${plan.distanceKm} km away` : "Nearby"}</span>
          </div>
        </div>

        {plan.notes ? <p className="border-t px-5 py-3 text-sm text-gray-500">{plan.notes}</p> : null}

        {!harvested && (plan.status === "preorder" || plan.status === "open") ? (
          <div className="flex flex-col gap-2 border-t p-4">
            {!plan.myPreorder ? (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  value={qty}
                  onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
                  className="w-24"
                />
                <Button
                  className="flex-1"
                  onClick={() => onPreorder(plan, qty)}
                  disabled={preordering}
                >
                  {preordering ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShoppingBag className="mr-2 h-4 w-4" />}
                  Pre-order {qty} kg
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
                <CheckCircle className="h-5 w-5" />
                <span>
                  Your pre-order: {plan.myPreorder.quantityKg} kg for ₹{plan.myPreorder.total}
                </span>
              </div>
            )}
            {!plan.myNotify ? (
              <Button variant="outline" onClick={() => onNotify(plan)} disabled={busy}>
                <Bell className="mr-2 h-4 w-4" />
                Notify me when harvested
              </Button>
            ) : (
              <Button variant="ghost" className="text-emerald-600" disabled>
                <BellRing className="mr-2 h-4 w-4" />
                You'll be notified on harvest
              </Button>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function HarvestSections({
  country,
  state,
  district,
  city,
  coords,
  radius = 20,
}: HarvestSectionsProps) {
  const queryClient = useQueryClient();
  const addItem = useCartStore((s) => s.addItem);
  const [busyId, setBusyId] = useState<string | null>(null);

  const baseParams = useMemo(
    () => ({
      ...(coords?.lat && coords?.lng ? { lat: coords.lat, lng: coords.lng, radius } : {}),
      ...(!coords?.lat && state ? { state } : {}),
      ...(!coords?.lat && district ? { district } : {}),
      ...(!coords?.lat && city ? { city } : {}),
    }),
    [coords, radius, state, district, city],
  );

  const { data: preorderData, isLoading: preorderLoading } = useQuery({
    queryKey: ["harvests", "preorder", baseParams],
    queryFn: () => api.get("/harvests/upcoming", { params: baseParams }),
  });

  // The "Harvested" section shows the farmer's normal products (everything
  // available now) rather than harvested plan records.
  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: ["harvests", "products", baseParams, country],
    queryFn: () =>
      api.get("/products/search", {
        params: {
          ...baseParams,
          ...(country ? { country } : {}),
          limit: 12,
          sortBy: "createdAt",
          sortOrder: "desc",
        },
      }),
  });

  const preorderPlans: HarvestPlan[] = useMemo(() => {
    const raw = preorderData?.data?.plans || preorderData?.data || [];
    return raw.map((p: any) => ({ ...p, id: p._id || p.id }));
  }, [preorderData]);

  const harvestedProducts = useMemo(() => {
    const raw = productsData?.data?.products || productsData?.products || [];
    return raw.map((p: any) => ({
      id: p._id || p.id,
      name: p.name || "Fresh Produce",
      farmerName: p.farmerName || p.farmer?.name || p.farmName || "Local Farmer",
      price: Number(p.price) || 0,
      unit: p.unit || "kg",
      image: p.images?.[0] || p.image || "/images/placeholder-product.jpg",
      rating: Number(p.ratings?.average ?? p.rating ?? 0) || 0,
      isOrganic: p.isOrganic || p.tags?.includes?.("organic") || false,
      verificationStatus: p.verificationStatus || "farmer_declared",
      effectiveGrade: p.effectiveGrade || p.qualityGrade,
      grade: p.grade,
    }));
  }, [productsData]);

  const handleAddToCart = (product: any) => {
    addItem({
      id: product.id,
      name: product.name,
      price: product.price,
      quantity: 1,
      image: product.image,
      farmerName: product.farmerName,
      unit: product.unit,
    });
    toast.success(`${product.name} added to cart!`);
  };

  const preorderMutation = useMutation({
    mutationFn: ({ planId, quantityKg }: { planId: string; quantityKg: number }) =>
      api.post(`/harvests/${planId}/preorder`, { quantityKg }),
    onSuccess: (_data, vars) => {
      setBusyId(null);
      queryClient.invalidateQueries({ queryKey: ["harvests"] });
      toast.success(`Pre-order placed for ${vars.quantityKg} kg!`);
    },
    onError: (err: any) => {
      setBusyId(null);
      toast.error(err?.message || "Failed to place pre-order");
    },
  });

  const notifyMutation = useMutation({
    mutationFn: (planId: string) => api.post(`/harvests/${planId}/notify`),
    onSuccess: () => {
      setBusyId(null);
      queryClient.invalidateQueries({ queryKey: ["harvests"] });
      toast.success("We'll notify you when it's harvested!");
    },
    onError: (err: any) => {
      setBusyId(null);
      toast.error(err?.message || "Failed to subscribe");
    },
  });

  const sectionClass = "rounded-3xl border bg-white p-6";
  const headingClass = "flex items-center gap-3 text-xl font-bold text-slate-900";
  const countClass = "text-sm text-slate-500";

  const [activeTab, setActiveTab] = useState<"preorder" | "harvested">("harvested");

  return (
    <div className="space-y-4">
      {/* Tabs like nearby page */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
        <button
          onClick={() => setActiveTab("harvested")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition ${
            activeTab === "harvested"
              ? "bg-white text-emerald-700 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <Flower2 className="h-4 w-4" />
          Harvested
          {!productsLoading && harvestedProducts.length > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
              {harvestedProducts.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("preorder")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition ${
            activeTab === "preorder"
              ? "bg-white text-emerald-700 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <Sprout className="h-4 w-4" />
          Pre Harvest
          {!preorderLoading && preorderPlans.length > 0 && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
              {preorderPlans.length}
            </span>
          )}
        </button>
      </div>

      {/* Pre Harvest tab */}
      {activeTab === "preorder" && (
        <section className={sectionClass}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className={headingClass}>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100">
                <Sprout className="h-5 w-5 text-emerald-600" />
              </span>
              Pre Harvest
            </h2>
            <p className={countClass}>Reserve upcoming harvests from farms</p>
          </div>

          {preorderLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
            </div>
          ) : preorderPlans.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed py-12 text-center">
              <SearchX className="h-9 w-9 text-gray-300" />
              <p className="mt-3 font-medium text-gray-600">No pre-harvest items available yet</p>
              <p className="text-sm text-gray-400">Farmers list planned harvests here before they're ready.</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {preorderPlans.map((plan) => (
                <HarvestCard
                  key={plan.id}
                  plan={plan}
                  busy={busyId === plan.id}
                  onPreorder={(p, q) => {
                    setBusyId(p.id);
                    preorderMutation.mutate({ planId: p.id, quantityKg: q });
                  }}
                  onNotify={(p) => {
                    setBusyId(p.id);
                    notifyMutation.mutate(p.id);
                  }}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Harvested tab */}
      {activeTab === "harvested" && (
        <section className={sectionClass}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className={headingClass}>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100">
                <Flower2 className="h-5 w-5 text-amber-600" />
              </span>
              Harvested
            </h2>
            <p className={countClass}>Fresh produce available now from farms</p>
          </div>

          {productsLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
            </div>
          ) : harvestedProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed py-12 text-center">
              <Flower2 className="h-9 w-9 text-gray-300" />
              <p className="mt-3 font-medium text-gray-600">No harvested produce yet</p>
              <p className="text-sm text-gray-400">Farmers' fresh products will show up here.</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {harvestedProducts.map((product) => (
                <Card key={product.id} className="group overflow-hidden transition-all hover:shadow-lg">
                  <Link href={`/product/${product.id}`}>
                    <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
                      <Image
                        src={product.image}
                        alt={product.name}
                        fill
                        className="object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      {product.isOrganic && (
                        <Badge variant="success" className="absolute left-2 top-2">
                          Organic
                        </Badge>
                      )}
                      {product.verificationStatus === "verified" || product.verificationStatus === "buyer_verified" ? (
                        <Badge variant="success" className="absolute bottom-2 left-2 bg-emerald-600">
                          ✓ Grade {product.effectiveGrade || product.grade} Verified
                        </Badge>
                      ) : (
                        <Badge variant="warning" className="absolute bottom-2 left-2">
                          ⚠ Farmer Declared
                        </Badge>
                      )}
                    </div>
                  </Link>
                  <CardContent className="space-y-2 p-4">
                    <Link href={`/product/${product.id}`}>
                      <h3 className="truncate text-sm font-semibold text-slate-900 group-hover:text-emerald-600">
                        {product.name}
                      </h3>
                    </Link>
                    <p className="text-xs text-slate-500">{product.farmerName}</p>
                    <div className="flex items-center gap-1 text-xs text-slate-500">
                      <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                      <span className="font-medium text-slate-600">
                        {product.rating > 0 ? product.rating.toFixed(1) : "New"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-lg font-bold text-emerald-700">
                        {formatPrice(product.price)}
                        <span className="ml-0.5 text-xs font-normal text-slate-400">
                          /{product.unit}
                        </span>
                      </span>
                      <Button
                        className="rounded-full"
                        size="sm"
                        onClick={() => handleAddToCart(product)}
                      >
                        <ShoppingCart className="mr-1.5 h-4 w-4" />
                        Add
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
