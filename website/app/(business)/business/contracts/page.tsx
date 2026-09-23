"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileSignature,
  Plus,
  Loader2,
  CheckCircle2,
  Clock,
  XCircle,
  CalendarRange,
  IndianRupee,
  Users,
} from "lucide-react";
import { api } from "../../../lib/api/client";
import { cn, formatPrice } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import toast from "react-hot-toast";

interface Contract {
  id: string;
  contractNumber: string;
  farmerName: string;
  cropName: string;
  quantityPerMonthKg: number;
  pricePerKg: number;
  durationMonths: number;
  startDate: string;
  status: "active" | "pending" | "completed" | "cancelled";
}

const DEMO_CONTRACTS: Contract[] = [
  {
    id: "c1",
    contractNumber: "CTR-2026-0081",
    farmerName: "Kumar Farms",
    cropName: "Tomato",
    quantityPerMonthKg: 1000,
    pricePerKg: 38,
    durationMonths: 6,
    startDate: new Date().toISOString(),
    status: "active",
  },
  {
    id: "c2",
    contractNumber: "CTR-2026-0077",
    farmerName: "Green Valley Farm",
    cropName: "Onion",
    quantityPerMonthKg: 500,
    pricePerKg: 32,
    durationMonths: 3,
    startDate: new Date().toISOString(),
    status: "pending",
  },
];

export default function BusinessContractsPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    farmerName: "",
    cropName: "",
    quantityPerMonthKg: "500",
    pricePerKg: "",
    durationMonths: "6",
    startDate: "",
  });

  const { data: contractsData, isLoading } = useQuery({
    queryKey: ["businessContracts"],
    queryFn: () => api.get("/b2b/contracts"),
    retry: 1,
  });

  const apiContracts = useMemo(() => {
    const list = contractsData?.data?.contracts || contractsData?.data || [];
    if (Array.isArray(list) && list.length > 0) return list;
    return DEMO_CONTRACTS;
  }, [contractsData]);

  const createMutation = useMutation({
    mutationFn: (payload: any) => api.post("/b2b/contracts", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["businessContracts"] });
      setShowForm(false);
      setForm({ farmerName: "", cropName: "", quantityPerMonthKg: "500", pricePerKg: "", durationMonths: "6", startDate: "" });
      toast.success("Contract sent to farmer for confirmation!");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to create contract"),
  });

  const contracts: Contract[] = apiContracts.map((c: any) => ({ ...c, id: c._id || c.id }));
  const monthlyTotal = contracts.filter((c) => c.status === "active").reduce((s, c) => s + c.quantityPerMonthKg, 0);
  const committedMonthly = contracts.filter((c) => c.status === "active").reduce((s, c) => s + c.quantityPerMonthKg * c.pricePerKg, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Supply Contracts</h1>
          <p className="text-gray-500">Long-term supply agreements with farmers for predictable procurement.</p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? <XCircle className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
          {showForm ? "Cancel" : "New Contract"}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-gray-500">Active contracts</p>
            <p className="text-2xl font-bold text-emerald-700">{contracts.filter((c) => c.status === "active").length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-gray-500">Committed supply / month</p>
            <p className="text-2xl font-bold text-blue-700">{monthlyTotal} kg</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-gray-500">Committed spend / month</p>
            <p className="text-2xl font-bold text-amber-700">{formatPrice(committedMonthly)}</p>
          </CardContent>
        </Card>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New Supply Contract</CardTitle>
            <CardDescription>The farmer will confirm before the contract starts.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Farmer / farm name *</label>
              <Input value={form.farmerName} onChange={(e) => setForm({ ...form, farmerName: e.target.value })} placeholder="e.g. Kumar Farms" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Crop *</label>
              <Input value={form.cropName} onChange={(e) => setForm({ ...form, cropName: e.target.value })} placeholder="e.g. Tomato" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Quantity / month (kg) *</label>
              <Input type="number" min="1" value={form.quantityPerMonthKg} onChange={(e) => setForm({ ...form, quantityPerMonthKg: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Agreed price (â‚¹/kg) *</label>
              <Input type="number" min="0" value={form.pricePerKg} onChange={(e) => setForm({ ...form, pricePerKg: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Duration (months) *</label>
              <Input type="number" min="1" max="24" value={form.durationMonths} onChange={(e) => setForm({ ...form, durationMonths: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Start date *</label>
              <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <Button
                disabled={!form.farmerName || !form.cropName || !form.quantityPerMonthKg || !form.pricePerKg || !form.startDate || createMutation.isPending}
                onClick={() =>
                  createMutation.mutate({
                    farmerName: form.farmerName,
                    cropName: form.cropName,
                    quantityPerMonthKg: Number(form.quantityPerMonthKg),
                    pricePerKg: Number(form.pricePerKg),
                    durationMonths: Number(form.durationMonths),
                    startDate: new Date(form.startDate).toISOString(),
                  })
                }
              >
                {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSignature className="mr-2 h-4 w-4" />}
                Send Contract
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : contracts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <FileSignature className="h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm text-slate-500">No contracts yet. Create one to lock in supply for months ahead.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {contracts.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                    <FileSignature className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-sm font-semibold">{c.contractNumber}</p>
                      <Badge variant="outline">{c.cropName}</Badge>
                      {c.status === "active" && <Badge variant="success"><CheckCircle2 className="mr-1 h-3 w-3" /> Active</Badge>}
                      {c.status === "pending" && <Badge variant="warning"><Clock className="mr-1 h-3 w-3" /> Awaiting farmer</Badge>}
                      {c.status === "completed" && <Badge variant="secondary">Completed</Badge>}
                      {c.status === "cancelled" && <Badge variant="destructive">Cancelled</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-gray-500">{c.farmerName}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-600">
                  <span className="flex items-center gap-1"><IndianRupee className="h-4 w-4 text-emerald-600" /> {c.pricePerKg}/kg</span>
                  <span className="flex items-center gap-1"><Users className="h-4 w-4 text-blue-600" /> {c.quantityPerMonthKg} kg/mo</span>
                  <span className="flex items-center gap-1"><CalendarRange className="h-4 w-4 text-amber-600" /> {c.durationMonths} months</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
