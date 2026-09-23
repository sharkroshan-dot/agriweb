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
    businessName: "ABC Hotel",
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
    businessName: "GreenLeaf Restaurants",
    cropName: "Onion",
    quantityPerMonthKg: 500,
    pricePerKg: 32,
    durationMonths: 3,
    startDate: new Date().toISOString(),
    status: "pending",
  },
];

export default function FarmerB2bContractsPage() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<string | null>(null);

  const { data: contractsData, isLoading } = useQuery({
    queryKey: ["farmerContracts"],
    queryFn: () => api.get("/b2b/contracts/me"),
    retry: 1,
  });

  const apiContracts = useMemo(() => {
    const list = contractsData?.data?.contracts || contractsData?.data || [];
    if (Array.isArray(list) && list.length > 0) return list;
    return DEMO_CONTRACTS;
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

  const contracts: Contract[] = apiContracts.map((c: any) => ({ ...c, id: c._id || c.id }));
  const activeCount = contracts.filter((c) => c.status === "active").length;
  const monthlyKg = contracts.filter((c) => c.status === "active").reduce((s, c) => s + c.quantityPerMonthKg, 0);
  const monthlyValue = contracts.filter((c) => c.status === "active").reduce((s, c) => s + c.quantityPerMonthKg * c.pricePerKg, 0);

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
                      {c.status === "completed" && <Badge variant="secondary">Completed</Badge>}
                      {c.status === "cancelled" && <Badge variant="destructive">Cancelled</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-gray-500">{c.businessName}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-600">
                  <span className="flex items-center gap-1"><IndianRupee className="h-4 w-4 text-emerald-600" /> {c.pricePerKg}/kg</span>
                  <span className="flex items-center gap-1"><Users className="h-4 w-4 text-blue-600" /> {c.quantityPerMonthKg} kg/mo</span>
                  <span className="flex items-center gap-1"><CalendarRange className="h-4 w-4 text-amber-600" /> {c.durationMonths} months</span>
                </div>
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
