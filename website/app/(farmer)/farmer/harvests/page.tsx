"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sprout,
  Plus,
  CalendarDays,
  Wheat,
  IndianRupee,
  Loader2,
  CheckCircle2,
  Users,
  BellRing,
  XCircle,
} from "lucide-react";
import { api } from "../../../lib/api/client";
import { formatDate, formatPrice, cn } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import { LocationPicker, LocationValue } from "../../../components/farmer/location-picker";
import toast from "react-hot-toast";

interface HarvestPlan {
  id: string;
  cropName: string;
  expectedHarvestDate: string;
  expectedQuantityKg: number;
  preOrderPricePerKg?: number;
  status: string;
  preorderCount?: number;
  notifyCount?: number;
  notes?: string;
  productCreated?: boolean;
}

export default function FarmerHarvestsPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [location, setLocation] = useState<LocationValue | null>(null);
  const [form, setForm] = useState({
    cropName: "",
    expectedHarvestDate: "",
    expectedQuantityKg: "100",
    preOrderPricePerKg: "",
    preOrderEnabled: true,
    notes: "",
  });

  const { data: plansData, isLoading } = useQuery({
    queryKey: ["farmerHarvests"],
    queryFn: () => api.get("/harvests/farmer/plans", { params: { source: "calendar" } }),
  });

  const createMutation = useMutation({
    mutationFn: (payload: any) => api.post("/harvests/plans", { ...payload, source: "calendar" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farmerHarvests"] });
      setShowForm(false);
      setLocation(null);
      setForm({
        cropName: "",
        expectedHarvestDate: "",
        expectedQuantityKg: "100",
        preOrderPricePerKg: "",
        preOrderEnabled: true,
        notes: "",
      });
      toast.success("Harvest plan created!");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to create plan"),
  });

  const harvestMutation = useMutation({
    mutationFn: (planId: string) => api.post(`/harvests/plans/${planId}/harvest`),
    onSuccess: (_data, planId) => {
      queryClient.invalidateQueries({ queryKey: ["farmerHarvests"] });
      const plan = plans.find((p) => p.id === planId);
      const params = new URLSearchParams({
        name: plan?.cropName || "",
        price: plan?.preOrderPricePerKg ? String(plan.preOrderPricePerKg) : "",
        quantity: plan?.expectedQuantityKg != null ? String(plan.expectedQuantityKg) : "",
        unit: "kg",
        harvestDate: plan?.expectedHarvestDate || "",
        fromHarvest: planId,
      });
      router.push(`/farmer/products/new?${params.toString()}`);
      toast.success("Harvest marked! Now finish creating your product.");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to mark harvest"),
  });

  const cancelMutation = useMutation({
    mutationFn: (planId: string) => api.post(`/harvests/plans/${planId}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farmerHarvests"] });
      toast.success("Harvest plan cancelled");
    },
  });

  const plans: HarvestPlan[] = (plansData?.data?.plans || []).map((p: any) => ({ ...p, id: p._id || p.id }));

  const statusBadge = (s: string) => {
    if (s === "harvested") return <Badge variant="success">Harvested</Badge>;
    if (s === "cancelled") return <Badge variant="destructive">Cancelled</Badge>;
    if (s === "preorder") return <Badge variant="outline">Pre-order open</Badge>;
    return <Badge variant="secondary">Planned</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Harvest Calendar</h1>
          <p className="text-gray-500">Publish planned harvests, accept pre-orders, and notify customers.</p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? <XCircle className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
          {showForm ? "Cancel" : "New Harvest Plan"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New Harvest Plan</CardTitle>
            <CardDescription>Customers will see this and can pre-order before harvest.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Crop name *</label>
              <Input
                value={form.cropName}
                onChange={(e) => setForm({ ...form, cropName: e.target.value })}
                placeholder="e.g. Tomato"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Expected harvest date *</label>
              <Input
                type="date"
                value={form.expectedHarvestDate}
                onChange={(e) => setForm({ ...form, expectedHarvestDate: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Expected quantity (kg) *</label>
              <Input
                type="number"
                min={1}
                value={form.expectedQuantityKg}
                onChange={(e) => setForm({ ...form, expectedQuantityKg: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Pre-order price (₹/kg)</label>
              <Input
                type="number"
                min={0}
                value={form.preOrderPricePerKg}
                onChange={(e) => setForm({ ...form, preOrderPricePerKg: e.target.value })}
                placeholder="e.g. 42"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-medium text-gray-500">Notes (optional)</label>
              <Input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="e.g. Organically grown, harvested early morning"
              />
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <input
                type="checkbox"
                id="preorderToggle"
                checked={form.preOrderEnabled}
                onChange={(e) => setForm({ ...form, preOrderEnabled: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-emerald-600"
              />
              <label htmlFor="preorderToggle" className="text-sm text-gray-600">
                Accept pre-orders (requires a price)
              </label>
            </div>
            <div className="sm:col-span-2">
              <LocationPicker value={location} onChange={setLocation} />
            </div>
            <div className="sm:col-span-2">
              <Button
                className="w-full sm:w-auto"
                disabled={!form.cropName || !form.expectedHarvestDate || createMutation.isPending}
                onClick={() =>
                  createMutation.mutate({
                    cropName: form.cropName,
                    expectedHarvestDate: new Date(form.expectedHarvestDate).toISOString(),
                    expectedQuantityKg: Number(form.expectedQuantityKg),
                    preOrderPricePerKg: form.preOrderPricePerKg ? Number(form.preOrderPricePerKg) : null,
                    preOrderEnabled: form.preOrderEnabled,
                    notes: form.notes || null,
                    location: location
                      ? {
                          type: "Point",
                          coordinates: [location.lng, location.lat],
                          address: location.address,
                        }
                      : null,
                  })
                }
              >
                {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Create Plan
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : plans.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <Sprout className="h-10 w-10 text-gray-300" />
            <p className="mt-3 font-medium text-gray-600">No harvest plans yet</p>
            <p className="text-sm text-gray-400">Create your first plan to start collecting pre-orders.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <Card key={plan.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Sprout className="h-5 w-5 text-emerald-600" />
                    <CardTitle className="text-base">{plan.cropName}</CardTitle>
                  </div>
                  {statusBadge(plan.status)}
                </div>
                <CardDescription className="flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" /> Harvest: {formatDate(plan.expectedHarvestDate)}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Wheat className="h-4 w-4 text-emerald-600" />
                    {plan.expectedQuantityKg} kg
                  </div>
                  <div className="flex items-center gap-2 text-gray-600">
                    <IndianRupee className="h-4 w-4 text-emerald-600" />
                    {plan.preOrderPricePerKg ? `${formatPrice(plan.preOrderPricePerKg)}/kg` : "No price"}
                  </div>
                  <div className="flex items-center gap-2 text-gray-600">
                    <Users className="h-4 w-4 text-emerald-600" />
                    {plan.preorderCount ?? 0} pre-orders
                  </div>
                  <div className="flex items-center gap-2 text-gray-600">
                    <BellRing className="h-4 w-4 text-emerald-600" />
                    {plan.notifyCount ?? 0} notified
                  </div>
                </div>
                {plan.notes ? <p className="text-sm text-gray-500">{plan.notes}</p> : null}
                {plan.productCreated ? (
                  <div className="rounded-lg bg-emerald-50 px-3 py-2 text-center text-xs font-medium text-emerald-700">
                    Product created — this harvest plan is complete
                  </div>
                ) : plan.status !== "harvested" && plan.status !== "cancelled" ? (
                  <div className="flex gap-2 pt-1">
                    <Button
                      className="flex-1"
                      size="sm"
                      disabled={harvestMutation.isPending}
                      onClick={() => harvestMutation.mutate(plan.id)}
                    >
                      {harvestMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      )}
                      Mark Harvested
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => cancelMutation.mutate(plan.id)}>
                      Cancel
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}