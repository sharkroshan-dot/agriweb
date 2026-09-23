"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sprout,
  Bell,
  BellRing,
  CalendarDays,
  MapPin,
  IndianRupee,
  ShoppingBag,
  CheckCircle,
  Loader2,
  SearchX,
  Wheat,
} from "lucide-react";
import { api } from "../../lib/api/client";
import { formatPrice, formatDate, cn } from "../../lib/utils";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { PlaceSelector, PlaceSelection } from "../../components/customer/place-selector";
import toast from "react-hot-toast";

interface HarvestPlan {
  id: string;
  cropName: string;
  expectedHarvestDate: string;
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

function HarvestCard({
  plan,
  onPreorder,
  onNotify,
  busy,
}: {
  plan: HarvestPlan;
  onPreorder: (plan: HarvestPlan, qty: number) => void;
  onNotify: (plan: HarvestPlan) => void;
  busy: boolean;
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
          {plan.status === "harvested" ? (
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
            <span>Harvest: <strong>{formatDate(plan.expectedHarvestDate)}</strong></span>
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

        <div className="flex flex-col gap-2 border-t p-4">
          {plan.status === "preorder" || plan.status === "open" ? (
            <>
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
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default function HarvestMarketplacePage() {
  const queryClient = useQueryClient();
  const [coords, setCoords] = useState<{ lat: string; lng: string } | null>(null);
  const [place, setPlace] = useState<PlaceSelection>({ country: "", state: "", district: "", city: "" });
  const [radius, setRadius] = useState(20);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: plansData, isLoading } = useQuery({
    queryKey: ["harvests", "upcoming", radius, coords, place],
    queryFn: () =>
      api.get("/harvests/upcoming", {
        params: {
          radius,
          ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
          ...(coords ? {} : place.state ? { state: place.state } : {}),
          ...(coords ? {} : place.district ? { district: place.district } : {}),
        },
      }),
  });

  const { data: myPreordersData } = useQuery({
    queryKey: ["harvests", "my-preorders"],
    queryFn: () => api.get("/harvests/my/preorders"),
  });

  const plans: HarvestPlan[] = useMemo(() => {
    const raw = plansData?.data?.plans || plansData?.data || [];
    return raw.map((p: any) => ({ ...p, id: p._id || p.id }));
  }, [plansData]);

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Fresh Harvest Coming Soon</h1>
        <p className="text-gray-500">
          Pre-order planned harvests from nearby farms, or get notified when fresh produce is ready.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4">
        <PlaceSelector
          value={place}
          onChange={(p) => {
            setPlace(p);
            if (p.country || p.state || p.district) setCoords(null);
          }}
          className="min-w-64 flex-1"
        />
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Radius</label>
          <select
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="h-9 rounded-md border border-gray-200 px-2 text-sm"
          >
            {[2, 5, 10, 20, 50, 100].map((r) => (
              <option key={r} value={r}>
                {r} km
              </option>
            ))}
          </select>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            if (navigator.geolocation) {
              navigator.geolocation.getCurrentPosition((pos) => {
                setCoords({
                  lat: String(pos.coords.latitude),
                  lng: String(pos.coords.longitude),
                });
                setPlace({ country: "", state: "", district: "", city: "" });
              });
            }
          }}
        >
          <MapPin className="mr-2 h-4 w-4" /> Use My Location
        </Button>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : plans.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <SearchX className="h-10 w-10 text-gray-300" />
          <p className="mt-3 font-medium text-gray-600">No upcoming harvests nearby yet</p>
          <p className="text-sm text-gray-400">Farmers list their planned harvests here before they're ready.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
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

      {myPreordersData?.data?.preorders?.length ? (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Your Pre-orders</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {(myPreordersData.data.preorders as any[]).map((po: any) => (
              <Card key={po.id}>
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-medium">
                      {po.cropName} <span className="text-gray-400">({po.quantityKg} kg)</span>
                    </p>
                    <p className="text-sm text-gray-500">
                      ₹{po.total} • Status: <Badge variant="outline">{po.status}</Badge>
                    </p>
                  </div>
                  <CheckCircle className="h-5 w-5 text-emerald-600" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}