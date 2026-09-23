"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Boxes,
  Plus,
  CalendarDays,
  Wheat,
  Loader2,
  Sprout,
  XCircle,
  TrendingUp,
  Bell,
  IndianRupee,
} from "lucide-react";
import { api } from "../../../lib/api/client";
import { formatDate, cn } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import toast from "react-hot-toast";

interface SupplyEntry {
  id: string;
  cropName: string;
  expectedDate: string;
  quantityKg: number;
  pricePerKg?: number;
  preOrderCount?: number;
  status: string;
}

const DEMO_ENTRIES: SupplyEntry[] = [
  { id: "s1", cropName: "Tomato", expectedDate: "2026-08-20", quantityKg: 300, pricePerKg: 40, preOrderCount: 12, status: "planned" },
  { id: "s2", cropName: "Onion", expectedDate: "2026-08-22", quantityKg: 500, pricePerKg: 35, preOrderCount: 8, status: "planned" },
  { id: "s3", cropName: "Potato", expectedDate: "2026-08-25", quantityKg: 700, pricePerKg: 28, preOrderCount: 5, status: "planned" },
  { id: "s4", cropName: "Carrot", expectedDate: "2026-08-28", quantityKg: 200, pricePerKg: 45, preOrderCount: 3, status: "planned" },
];

export default function FarmerSupplyCalendarPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    cropName: "",
    expectedDate: "",
    quantityKg: "100",
    pricePerKg: "",
  });

  const { data: supplyData, isLoading } = useQuery({
    queryKey: ["farmerSupplyCalendar"],
    queryFn: () => api.get("/harvests/farmer/supply-calendar"),
    retry: 1,
  });

  const { data: plansData } = useQuery({
    queryKey: ["farmerHarvestPlansForSupply"],
    queryFn: () => api.get("/harvests/farmer/plans"),
    retry: 1,
  });

  const apiEntries = useMemo(() => {
    const list = supplyData?.data?.entries || supplyData?.data?.plans || [];
    if (Array.isArray(list) && list.length > 0) return list;
    const plans = plansData?.data?.plans || [];
    if (Array.isArray(plans) && plans.length > 0) {
      return plans.map((p: any) => ({
        id: p._id || p.id,
        cropName: p.cropName,
        expectedDate: p.expectedHarvestDate,
        quantityKg: p.expectedQuantityKg,
        pricePerKg: p.preOrderPricePerKg,
        preOrderCount: p.preorderCount,
        status: p.status,
      }));
    }
    return DEMO_ENTRIES;
  }, [supplyData, plansData]);

  const createMutation = useMutation({
    mutationFn: (payload: any) => api.post("/harvests/supply-calendar", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farmerSupplyCalendar"] });
      setShowForm(false);
      setForm({ cropName: "", expectedDate: "", quantityKg: "100", pricePerKg: "" });
      toast.success("Supply calendar entry added!");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to add entry"),
  });

  const entries = apiEntries.map((e: any) => ({ ...e, id: e._id || e.id }));
  const upcoming = entries
    .filter((e: any) => e.status !== "cancelled")
    .sort((a: any, b: any) => new Date(a.expectedDate).getTime() - new Date(b.expectedDate).getTime());

  const totalKg = upcoming.reduce((s: number, e: any) => s + Number(e.quantityKg || 0), 0);
  const totalPreorders = upcoming.reduce((s: number, e: any) => s + Number(e.preOrderCount || 0), 0);

  const monthLabel = new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Supply Calendar</h1>
          <p className="text-gray-500">
            What will be available and when. Feeds pre-orders, demand forecasts and B2B RFQs.
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? <XCircle className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
          {showForm ? "Cancel" : "Add Supply"}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-gray-500">{monthLabel} — planned supply</p>
              <p className="text-2xl font-bold text-emerald-700">{totalKg} kg</p>
            </div>
            <Boxes className="h-8 w-8 text-emerald-600" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-gray-500">Upcoming harvests</p>
              <p className="text-2xl font-bold text-blue-700">{upcoming.length}</p>
            </div>
            <Sprout className="h-8 w-8 text-blue-600" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-gray-500">Pre-orders already booked</p>
              <p className="text-2xl font-bold text-amber-700">{totalPreorders}</p>
            </div>
            <TrendingUp className="h-8 w-8 text-amber-600" />
          </CardContent>
        </Card>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add Future Supply</CardTitle>
            <CardDescription>Tell the platform what will become available — pre-orders and RFQs will be matched to it.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Crop *</label>
              <Input value={form.cropName} onChange={(e) => setForm({ ...form, cropName: e.target.value })} placeholder="e.g. Tomato" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Expected availability date *</label>
              <Input type="date" value={form.expectedDate} onChange={(e) => setForm({ ...form, expectedDate: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Quantity (kg) *</label>
              <Input type="number" min="1" value={form.quantityKg} onChange={(e) => setForm({ ...form, quantityKg: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Planned price (₹/kg)</label>
              <Input type="number" min="0" value={form.pricePerKg} onChange={(e) => setForm({ ...form, pricePerKg: e.target.value })} placeholder="optional" />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <Button
                disabled={!form.cropName || !form.expectedDate || !form.quantityKg || createMutation.isPending}
                onClick={() =>
                  createMutation.mutate({
                    cropName: form.cropName,
                    expectedDate: new Date(form.expectedDate).toISOString(),
                    quantityKg: Number(form.quantityKg),
                    pricePerKg: form.pricePerKg ? Number(form.pricePerKg) : undefined,
                  })
                }
              >
                {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Add to Calendar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : upcoming.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <CalendarDays className="h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm text-slate-500">No upcoming supply. Add your future harvests to unlock pre-orders and RFQ matching.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {upcoming.map((e: any) => {
            const isSoon = new Date(e.expectedDate).getTime() - Date.now() < 3 * 86400000;
            return (
              <Card key={e.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className={cn("flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg", isSoon ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600")}>
                      <span className="text-base font-bold leading-none">{new Date(e.expectedDate).getDate()}</span>
                      <span className="text-[10px] uppercase">{new Date(e.expectedDate).toLocaleDateString("en-IN", { month: "short" })}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-medium">{e.cropName}</p>
                        {isSoon && <Badge variant="success"><Bell className="mr-1 h-3 w-3" /> Within 3 days</Badge>}
                        {e.status === "harvested" && <Badge variant="secondary">Harvested</Badge>}
                      </div>
                      <p className="text-sm text-gray-500">
                        {e.quantityKg} kg available · {formatDate(e.expectedDate)}
                        {e.preOrderCount > 0 && ` · ${e.preOrderCount} pre-orders`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {e.pricePerKg ? (
                      <span className="flex items-center gap-1 text-sm font-semibold text-emerald-700">
                        <IndianRupee className="h-4 w-4" />{e.pricePerKg}/kg
                      </span>
                    ) : (
                      <Badge variant="outline">Price TBD</Badge>
                    )}
                    <Wheat className="h-4 w-4 text-slate-300" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-5 w-5 text-emerald-600" />
            How Supply Calendar powers the platform
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { title: "Pre-orders", desc: "Customers book ahead of harvest using these dates & quantities." },
              { title: "Demand forecasting", desc: "AI predicts demand and helps you plan what to grow next." },
              { title: "B2B RFQ matching", desc: "Open RFQs needing your crop are shown with your supply dates." },
            ].map((c) => (
              <div key={c.title} className="rounded-lg border border-emerald-200 bg-white/70 p-3">
                <p className="text-sm font-semibold text-emerald-800">{c.title}</p>
                <p className="mt-1 text-xs text-emerald-900/70">{c.desc}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
