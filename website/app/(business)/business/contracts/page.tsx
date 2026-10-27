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
  AlertTriangle,
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
  latestDeliveryStatus?: string;
  latestDeliveryDate?: string;
  deliveryHistory?: Array<{
    scheduledDate: string;
    requestedQuantityKg?: number;
    availableQuantityKg?: number;
    packedQuantityKg?: number;
    status?: string;
    readyForPickup?: boolean;
    notes?: string | null;
    resolution?: string;
    resolutionNotes?: string;
    resolvedAt?: string;
    confirmedAt?: string;
  }>;
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

  const resolveShortageMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      api.post(`/b2b/contracts/${id}/delivery-resolution`, payload),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["businessContracts"] });
      toast.success(res?.data?.message || "Delivery shortage resolution saved.");
    },
    onError: (err: any) => toast.error(err?.message || "Could not resolve delivery shortage"),
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
                {c.deliveryHistory && c.deliveryHistory.length > 0 && (
                  <div className="mt-3 w-full rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-slate-900">Daily supply updates</p>
                        <p className="text-xs text-slate-500">Each scheduled delivery is tracked separately. Availability confirmation is not the same as warehouse receipt or business delivery.</p>
                      </div>
                      <Badge variant="outline">{c.deliveryHistory.length} recorded update{c.deliveryHistory.length === 1 ? "" : "s"}</Badge>
                    </div>
                    <div className="space-y-2">
                      {c.deliveryHistory.map((delivery, index) => {
                        const required = Number(delivery.requestedQuantityKg || c.quantityPerDeliveryKg || 0);
                        const available = Number(delivery.availableQuantityKg || 0);
                        const packed = Number(delivery.packedQuantityKg || 0);
                        const shortage = Math.max(0, required - Math.min(available, packed));
                        const state = String(delivery.status || "awaiting_confirmation").replace(/_/g, " ");
                        const isShort = ["shortage", "backup required", "at risk", "rescheduled"].includes(String(delivery.status || "").toLowerCase());
                        return (
                          <div key={delivery.scheduledDate || index} className="rounded-md border border-slate-200 bg-white p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="font-medium text-slate-800">{delivery.scheduledDate ? new Date(delivery.scheduledDate + "T00:00:00").toLocaleDateString("en-IN", { dateStyle: "medium" }) : "Scheduled delivery"}</p>
                              <Badge variant={isShort ? "destructive" : delivery.status === "confirmed" ? "success" : "secondary"}>{state}</Badge>
                            </div>
                            <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
                              <p><span className="text-slate-500">Required:</span> {required} kg</p>
                              <p><span className="text-slate-500">Available:</span> {available} kg</p>
                              <p><span className="text-slate-500">Packed:</span> {packed} kg</p>
                            </div>
                            {shortage > 0 && <p className="mt-2 text-sm font-medium text-red-700">Shortage: {shortage} kg</p>}
                            {delivery.notes && <p className="mt-1 text-sm text-slate-600">Farmer note: {delivery.notes}</p>}
                            {delivery.resolution && <p className="mt-1 text-sm text-blue-700">Business resolution: {delivery.resolution.replace(/_/g, " ")}{delivery.resolutionNotes ? " — " + delivery.resolutionNotes : ""}</p>}
                            {delivery.confirmedAt && <p className="mt-1 text-xs text-slate-400">Updated {new Date(delivery.confirmedAt).toLocaleString("en-IN")}</p>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {c.latestDeliveryStatus === "shortage" && (
                  <div className="mt-3 w-full rounded-lg border border-amber-300 bg-amber-50 p-3">
                    <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900">
                      <AlertTriangle className="h-4 w-4" /> Delivery shortage — choose how to proceed
                    </p>
                    <p className="mb-3 text-sm text-amber-800">The farmer reported insufficient stock. Approve a partial delivery, reschedule it, or request backup farmer sourcing.</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" disabled={resolveShortageMutation.isPending} onClick={() => {
                        const raw = window.prompt("How many kg should be approved for this delivery?");
                        if (raw === null) return;
                        const qty = Number(raw);
                        if (!Number.isFinite(qty) || qty <= 0) { toast.error("Enter a valid quantity greater than zero."); return; }
                        resolveShortageMutation.mutate({ id: c.id, payload: { action: "partial", approvedQuantityKg: qty, notes: "Business approved partial supply" } });
                      }}>Approve partial supply</Button>
                      <Button size="sm" variant="outline" disabled={resolveShortageMutation.isPending} onClick={() => {
                        const raw = window.prompt("Enter the new delivery date (YYYY-MM-DD):");
                        if (!raw) return;
                        if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) { toast.error("Use date format YYYY-MM-DD."); return; }
                        resolveShortageMutation.mutate({ id: c.id, payload: { action: "reschedule", newDeliveryDate: raw + "T09:00:00", notes: "Business approved rescheduling" } });
                      }}>Reschedule delivery</Button>
                      <Button size="sm" disabled={resolveShortageMutation.isPending} onClick={async () => {
                        try {
                          const response: any = await api.get(`/b2b/contracts/${c.id}/replacement-offers`);
                          const offers = response?.data?.data?.offers || response?.data?.offers || [];
                          if (!offers.length) {
                            toast.error("No eligible replacement quotes were found for this RFQ. Invite another farmer to quote first.");
                            return;
                          }
                          const menu = offers.map((offer: any, index: number) => `${index + 1}. ${offer.farmerName} — ${offer.availableQuantityKg} kg available at ₹${offer.pricePerKg}/kg`).join("\\n");
                          const choice = window.prompt("Choose a replacement farmer by number:\\n" + menu);
                          if (choice === null) return;
                          const index = Number(choice) - 1;
                          if (!Number.isInteger(index) || index < 0 || index >= offers.length) {
                            toast.error("Choose a valid replacement farmer number.");
                            return;
                          }
                          resolveShortageMutation.mutate({
                            id: c.id,
                            payload: {
                              action: "assign_replacement",
                              replacementOfferId: offers[index].id,
                              notes: "Business approved replacement supplier for this scheduled shortage",
                            },
                          });
                        } catch (error: any) {
                          toast.error(error?.message || "Could not load replacement farmers");
                        }
                      }}>Find & assign replacement farmer</Button>
                    </div>
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
