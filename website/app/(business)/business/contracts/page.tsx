"use client";

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileSignature,
  Plus,
  Loader2,
  CheckCircle2,
  Clock,
  CalendarRange,
  IndianRupee,
  Users,
} from "lucide-react";
import { api } from "../../../lib/api/client";
import { formatPrice } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import toast from "react-hot-toast";

interface Contract {
  id: string;
  contractNumber: string;
  farmerName: string;
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
  deliveryDistrict?: string;
  deliveryCity?: string;
  status: "active" | "pending" | "paused" | "completed" | "cancelled";
}

export default function BusinessContractsPage() {
  const queryClient = useQueryClient();
  const { data: contractsData, isLoading } = useQuery({
    queryKey: ["businessContracts"],
    queryFn: () => api.get("/b2b/contracts"),
    retry: 1,
  });

  const apiContracts = useMemo(() => {
    const list = contractsData?.data?.contracts || contractsData?.data || [];
    return Array.isArray(list) ? list : [];
  }, [contractsData]);

  const generateDueMutation = useMutation({
    mutationFn: () => api.post("/b2b/contracts/generate-due-orders", {}),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["businessContracts"] });
      const count = Number(res?.data?.count ?? res?.data?.data?.count ?? 0);
      toast.success(count ? `Generated ${count} scheduled B2B order(s).` : "No scheduled deliveries are due right now.");
    },
    onError: (err: any) => toast.error(err?.message || "Could not generate scheduled orders"),
  });

  const contracts: Contract[] = apiContracts.map((c: any) => ({ ...c, id: c._id || c.id }));
  const monthlyTotal = contracts.filter((c) => c.status === "active").reduce((s, c) => s + Number(c.quantityPerMonthKg ?? c.quantityPerDeliveryKg ?? 0), 0);
  const committedMonthly = contracts.filter((c) => c.status === "active").reduce((s, c) => s + Number(c.quantityPerMonthKg ?? c.quantityPerDeliveryKg ?? 0) * Number(c.pricePerKg ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Supply Contracts</h1>
          <p className="text-gray-500">Recurring RFQs become contracts after a quote is accepted. Farmers must accept contracts before scheduled orders can be generated.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={generateDueMutation.isPending} onClick={() => generateDueMutation.mutate()}>
            {generateDueMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarRange className="mr-2 h-4 w-4" />}
            Generate Due Orders
          </Button>
          <Button onClick={() => window.location.assign("/business/rfqs")}>
            <Plus className="mr-2 h-4 w-4" /> Create Recurring RFQ
          </Button>
        </div>
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
                      {c.status === "paused" && <Badge variant="warning">Paused</Badge>}
                      {c.status === "completed" && <Badge variant="secondary">Completed</Badge>}
                      {c.status === "cancelled" && <Badge variant="destructive">Cancelled</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-gray-500">{c.farmerName}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {c.deliveryDistrict || c.deliveryCity ? `Delivery: ${[c.deliveryDistrict, c.deliveryCity].filter(Boolean).join(", ")}` : "Delivery destination recorded on the contract"}
                      {c.endDate ? ` · Ends ${new Date(c.endDate).toLocaleDateString("en-IN")}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-600">
                  <span className="flex items-center gap-1"><IndianRupee className="h-4 w-4 text-emerald-600" /> {c.pricePerKg}/kg</span>
                  <span className="flex items-center gap-1"><Users className="h-4 w-4 text-blue-600" /> {Number(c.quantityPerDeliveryKg ?? c.quantityPerMonthKg ?? 0)} kg / delivery</span>
                  <span className="flex items-center gap-1"><CalendarRange className="h-4 w-4 text-amber-600" /> {c.frequency || "monthly"}{Number(c.recurrenceInterval || 1) > 1 ? ` · every ${c.recurrenceInterval}` : ""}</span>
                  {c.nextDeliveryAt && <span className="text-xs text-slate-500">Next delivery: {new Date(c.nextDeliveryAt).toLocaleDateString("en-IN")}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
