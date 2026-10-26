"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileSignature,
  Loader2,
  CheckCircle2,
  Clock,
  XCircle,
  CalendarRange,
  IndianRupee,
  Users,
  Check,
} from "lucide-react";
import { api } from "../../../../lib/api/client";
import { formatPrice } from "../../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Button } from "../../../../components/ui/button";
import { Badge } from "../../../../components/ui/badge";
import toast from "react-hot-toast";

interface Contract {
  id: string;
  contractNumber: string;
  businessName: string;
  cropName: string;
  quantityPerMonthKg?: number;
  quantityPerDeliveryKg?: number;
  pricePerKg: number;
  durationMonths: number;
  frequency?: string;
  recurrenceInterval?: number;
  startDate: string;
  endDate?: string;
  nextDeliveryAt?: string;
  status: "active" | "pending" | "paused" | "completed" | "cancelled";\n  latestDeliveryStatus?: string;
}

export default function FarmerB2bContractsPage() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<string | null>(null);\n  const [availableQty, setAvailableQty] = useState<Record<string, string>>({});\n  const [stockNotes, setStockNotes] = useState<Record<string, string>>({});

  const { data: contractsData, isLoading } = useQuery({
    queryKey: ["farmerContracts"],
    queryFn: () => api.get("/b2b/contracts/me"),
    retry: 1,
  });

  const apiContracts = useMemo(() => {
    const list = contractsData?.data?.contracts || contractsData?.data || [];
    return Array.isArray(list) ? list : [];
  }, [contractsData]);

  const confirmMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.put(`/b2b/contracts/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farmerContracts"] });
      setConfirming(null);
      toast.success("Contract updated!");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to update contract"),
  });

  const stockMutation = useMutation({
    mutationFn: ({ id, quantity, notes }: { id: string; quantity: number; notes?: string }) =>
      api.post(`/b2b/contracts/${id}/delivery-confirmation`, { availableQuantityKg: quantity, notes }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["farmerContracts"] });
      const status = res?.data?.data?.status || res?.data?.status;
      toast.success(status === "shortage" ? "Shortage reported. The business must choose a solution." : "Stock confirmed for the next delivery.");
    },
    onError: (err: any) => toast.error(err?.message || "Could not confirm delivery stock"),
  });

  const contracts: Contract[] = apiContracts.map((c: any) => ({ ...c, id: c._id || c.id }));
  const activeCount = contracts.filter((c) => c.status === "active").length;
  const monthlyKg = contracts.filter((c) => c.status === "active").reduce((s, c) => s + Number(c.quantityPerMonthKg ?? c.quantityPerDeliveryKg ?? 0), 0);
  const monthlyValue = contracts.filter((c) => c.status === "active").reduce((s, c) => s + Number(c.quantityPerMonthKg ?? c.quantityPerDeliveryKg ?? 0) * Number(c.pricePerKg ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Supply Contracts</h1>
        <p className="text-gray-500">Predictable monthly income from businesses through supply agreements.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-gray-500">Active contracts</p>
            <p className="text-2xl font-bold text-emerald-700">{activeCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-gray-500">Committed supply / month</p>
            <p className="text-2xl font-bold text-blue-700">{monthlyKg} kg</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-gray-500">Predictable income / month</p>
            <p className="text-2xl font-bold text-amber-700">{formatPrice(monthlyValue)}</p>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : contracts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <FileSignature className="h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm text-slate-500">No contracts yet. Businesses will send you supply agreements to confirm.</p>
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
                      {c.status === "pending" && <Badge variant="warning"><Clock className="mr-1 h-3 w-3" /> Needs your confirmation</Badge>}
                      {c.status === "paused" && <Badge variant="warning">Paused</Badge>}
                      {c.status === "completed" && <Badge variant="secondary">Completed</Badge>}
                      {c.status === "cancelled" && <Badge variant="destructive">Cancelled</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-gray-500">{c.businessName}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-600">
                  <span className="flex items-center gap-1"><IndianRupee className="h-4 w-4 text-emerald-600" /> {c.pricePerKg}/kg</span>
                  <span className="flex items-center gap-1"><Users className="h-4 w-4 text-blue-600" /> {Number(c.quantityPerDeliveryKg ?? c.quantityPerMonthKg ?? 0)} kg / delivery</span>
                  <span className="flex items-center gap-1"><CalendarRange className="h-4 w-4 text-amber-600" /> {c.frequency || "monthly"}{Number(c.recurrenceInterval || 1) > 1 ? ` · every ${c.recurrenceInterval}` : ""}</span>
                  {c.nextDeliveryAt && <span className="text-xs text-slate-500">Next delivery: {new Date(c.nextDeliveryAt).toLocaleDateString("en-IN")}</span>}
                </div>
                {c.status === "active" && (
                  <div className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                      <PackageCheck className="h-4 w-4" /> Confirm stock for next delivery
                    </p>
                    <p className="mb-2 text-xs text-slate-600">
                      Enter the actual kilograms you can supply on {c.nextDeliveryAt ? new Date(c.nextDeliveryAt).toLocaleDateString("en-IN") : "the next scheduled date"}. If it is less than the agreed quantity, the business will be notified.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="number" min="0" step="0.1" inputMode="decimal"
                        className="w-36 rounded-md border bg-white px-3 py-2 text-sm"
                        placeholder="Available kg"
                        value={availableQty[c.id] ?? ""}
                        onChange={(e) => setAvailableQty((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      />
                      <input
                        className="min-w-40 flex-1 rounded-md border bg-white px-3 py-2 text-sm"
                        placeholder="Optional note"
                        value={stockNotes[c.id] ?? ""}
                        onChange={(e) => setStockNotes((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      />
                      <Button
                        size="sm"
                        disabled={stockMutation.isPending || availableQty[c.id] === undefined || availableQty[c.id].trim() === "" || Number(availableQty[c.id]) < 0}
                        onClick={() => stockMutation.mutate({ id: c.id, quantity: Number(availableQty[c.id]), notes: stockNotes[c.id] })}
                      >
                        {stockMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-1 h-4 w-4" />}
                        Confirm stock
                      </Button>
                    </div>
                    {c.latestDeliveryStatus === "shortage" && (
                      <p className="mt-2 flex items-center gap-1 text-sm text-amber-700"><AlertTriangle className="h-4 w-4" /> Shortage reported. Wait for the business to approve a solution.</p>
                    )}
                  </div>
                )}
                {c.status === "pending" && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={confirmMutation.isPending}
                      onClick={() => confirmMutation.mutate({ id: c.id, status: "active" })}
                    >
                      {confirmMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
                      Accept
                    </Button>
                    <Button size="sm" variant="outline" className="text-red-600" onClick={() => confirmMutation.mutate({ id: c.id, status: "cancelled" })}>
                      <XCircle className="mr-1.5 h-4 w-4" /> Decline
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
