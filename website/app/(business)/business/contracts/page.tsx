"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  ExternalLink,
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
    approvedQuantityKg?: number;
    isRescheduledOccurrence?: boolean;
    rescheduledFromDate?: string;
    rescheduledTo?: string;
    replacementOrderId?: string;
    replacementQuantityKg?: number;
    replacementOrderNumber?: string;
    replacementOrderStatus?: string;
    originalOrderCancelledId?: string;
  }>;
}

interface ReplacementOffer {
  id: string;
  farmerId: string;
  farmerName: string;
  productName?: string;
  quotedQuantityKg: number;
  availableQuantityKg: number;
  liveAvailableQuantityKg?: number;
  assignableQuantityKg: number;
  shortageQuantityKg: number;
  eligible: boolean;
  ineligibleReason?: string | null;
  pricePerKg: number;
  status: string;
  quoteType?: "current" | "previously_submitted";
  stockCheckedAt?: string;
}

interface ReplacementMeta {
  scheduledDate: string;
  requestedQuantityKg: number;
  shortageKg: number;
  benchmarkPricePerKg: number;
  benchmarkQuantityKg: number;
  rfqId?: string;
  rfqNumber?: string;
  replacementSourcingOpen?: boolean;
  replacementMode?: "shortage" | "full";
  stockCheckedAt?: string;
}

export default function BusinessContractsPage() {
  const queryClient = useQueryClient();
  const autoOpenedReplacementKey = useRef<string | null>(null);
  const [requestedReplacementRoute, setRequestedReplacementRoute] = useState<{ contractId: string; scheduledDate: string } | null>(null);
  useEffect(() => {
    // Read deep-link parameters client-side to avoid forcing a Next.js
    // static-rendered page into a useSearchParams suspense boundary.
    const params = new URLSearchParams(window.location.search);
    const contractId = params.get("replacementContractId");
    const scheduledDate = params.get("scheduledDate");
    if (contractId && scheduledDate) setRequestedReplacementRoute({ contractId, scheduledDate });
  }, []);
  const { data: contractsData, isLoading } = useQuery({
    queryKey: ["businessContracts"],
    queryFn: () => api.get("/b2b/contracts"),
    retry: 1,
  });

  const apiContracts = useMemo(() => {
    const list = contractsData?.data?.contracts || contractsData?.data || [];
    return Array.isArray(list) ? list : [];
  }, [contractsData]);

  const [replacementPanelContractId, setReplacementPanelContractId] = useState<string | null>(null);
  const [replacementPanelDate, setReplacementPanelDate] = useState<string | null>(null);
  const [replacementOffers, setReplacementOffers] = useState<ReplacementOffer[]>([]);
  const [replacementMeta, setReplacementMeta] = useState<ReplacementMeta | null>(null);
  const [replacementLoading, setReplacementLoading] = useState(false);
  const [replacementRankingMode, setReplacementRankingMode] = useState<"rate" | "quantity" | "combined">("combined");

  const loadReplacementOffers = async (contract: Contract, requestedScheduleDate?: string) => {
    const scheduledDate = requestedScheduleDate
      || contract.latestDeliveryDate
      || contract.deliveryHistory?.find((delivery) => ["shortage", "backup_required", "partial_approved"].includes(String(delivery.status || "").toLowerCase()))?.scheduledDate
      || (contract.nextDeliveryAt ? String(contract.nextDeliveryAt).slice(0, 10) : "");
    if (!scheduledDate) {
      toast.error("Scheduled delivery date is unavailable. Refresh the contract and try again.");
      return;
    }
    setReplacementPanelContractId(contract.id);
    setReplacementPanelDate(scheduledDate);
    const delivery = contract.deliveryHistory?.find((item) => item.scheduledDate === scheduledDate);
    const partialApproved = String(delivery?.resolution || "").toLowerCase() === "partial"
      || String(delivery?.status || "").toLowerCase() === "partial_approved";
    const replacementMode = partialApproved ? "shortage" : "full";
    setReplacementLoading(true);
    setReplacementOffers([]);
    setReplacementMeta(null);
    try {
      const response = await api.get(`/b2b/contracts/${contract.id}/replacement-offers?scheduledDate=${encodeURIComponent(scheduledDate)}&replacementMode=${replacementMode}`);
      const result = response?.data || {};
      setReplacementOffers(Array.isArray(result.offers) ? result.offers : []);
      setReplacementMeta({
        scheduledDate: String(result.scheduledDate || scheduledDate),
        requestedQuantityKg: Number(result.requestedQuantityKg || 0),
        shortageKg: Number(result.shortageKg || 0),
        replacementMode: result.replacementMode === "shortage" ? "shortage" : "full",
        benchmarkPricePerKg: Number(result.benchmarkPricePerKg || 0),
        benchmarkQuantityKg: Number(result.benchmarkQuantityKg || 0),
        rfqId: String(result.rfqId || result.data?.rfqId || ""),
        rfqNumber: String(result.rfqNumber || result.data?.rfqNumber || ""),
        replacementSourcingOpen: Boolean(result.replacementSourcingOpen || result.data?.replacementSourcingOpen),
        stockCheckedAt: result.stockCheckedAt || result.data?.stockCheckedAt,
      });
    } catch (error: any) {
      setReplacementPanelContractId(null);
      setReplacementPanelDate(null);
      toast.error(error?.message || "Could not load replacement quotes. Refresh and try again.");
    } finally {
      setReplacementLoading(false);
    }
  };

  const compareLabel = (value: number, benchmark: number, label: string) => {
    if (value < benchmark) return `${label} is below the original accepted quote`;
    if (value > benchmark) return `${label} is above the original accepted quote`;
    return `${label} matches the original accepted quote`;
  };

  const rankedReplacementOffers = useMemo(() => {
    const benchmark = Number(replacementMeta?.benchmarkPricePerKg || 0);
    const rateTier = (offer: ReplacementOffer) =>
      offer.pricePerKg < benchmark ? 0 : offer.pricePerKg === benchmark ? 1 : 2;
    return [...replacementOffers].sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      if (replacementRankingMode === "quantity") {
        return b.availableQuantityKg - a.availableQuantityKg
          || a.pricePerKg - b.pricePerKg
          || a.farmerName.localeCompare(b.farmerName);
      }
      if (replacementRankingMode === "rate") {
        return rateTier(a) - rateTier(b)
          || a.pricePerKg - b.pricePerKg
          || b.assignableQuantityKg - a.assignableQuantityKg
          || a.farmerName.localeCompare(b.farmerName);
      }
      return rateTier(a) - rateTier(b)
        || b.assignableQuantityKg - a.assignableQuantityKg
        || a.pricePerKg - b.pricePerKg
        || a.farmerName.localeCompare(b.farmerName);
    });
  }, [replacementOffers, replacementRankingMode, replacementMeta?.benchmarkPricePerKg]);

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
      setReplacementPanelContractId(null);
      setReplacementPanelDate(null);
      setReplacementOffers([]);
      setReplacementMeta(null);
      toast.success(res?.data?.message || "Delivery shortage resolution saved.");
    },
    onError: (err: any) => toast.error(err?.message || "Could not resolve delivery shortage"),
  });

  const requestReplacementSourcingMutation = useMutation({
    mutationFn: ({ contractId, scheduledDate }: { contractId: string; scheduledDate: string }) =>
      api.post(`/b2b/contracts/${contractId}/replacement-sourcing`, { scheduledDate }),
    onSuccess: async (res: any, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["businessContracts"] });
      const payload = res?.data?.data ?? res?.data ?? res;
      const rfqId = String(payload?.rfqId || "");
      if (!payload?.replacementSourcingOpen || !rfqId) {
        toast.error("The replacement request was saved but the originating RFQ ID was not returned. Refresh the contract and retry.");
        return;
      }
      // Send the user directly to the exact awarded RFQ, with its quote panel
      // expanded in replacement-only mode. No generic RFQ list handoff.
      window.location.assign(
        `/business/rfqs?rfqId=${encodeURIComponent(rfqId)}&replacementContractId=${encodeURIComponent(variables.contractId)}&scheduledDate=${encodeURIComponent(variables.scheduledDate)}`,
      );
    },
    onError: (err: any) => toast.error(err?.message || "Could not open replacement sourcing for this delivery"),
  });

  const requestedReplacementContractId = requestedReplacementRoute?.contractId;
  const requestedReplacementDate = requestedReplacementRoute?.scheduledDate;
  useEffect(() => {
    if (!requestedReplacementContractId || !requestedReplacementDate || apiContracts.length === 0) return;
    const key = `${requestedReplacementContractId}:${requestedReplacementDate}`;
    if (autoOpenedReplacementKey.current === key) return;
    const matching = apiContracts.find((item: any) => String(item._id || item.id) === requestedReplacementContractId);
    if (!matching) {
      toast.error("The requested shortage contract could not be found. Refresh the contracts list.");
      autoOpenedReplacementKey.current = key;
      return;
    }
    autoOpenedReplacementKey.current = key;
    void loadReplacementOffers({ ...matching, id: String(matching._id || matching.id) }, requestedReplacementDate);
  }, [requestedReplacementContractId, requestedReplacementDate, apiContracts]);

  const contracts: Contract[] = apiContracts.map((c: any) => ({ ...c, id: c._id || c.id }));
  const monthlyTotal = contracts.filter((c) => c.status === "active").reduce((s, c) => s + Number(c.quantityPerMonthKg ?? c.quantityPerDeliveryKg ?? 0), 0);
  const committedMonthly = contracts.filter((c) => c.status === "active").reduce((s, c) => s + Number(c.quantityPerMonthKg ?? c.quantityPerDeliveryKg ?? 0) * Number(c.pricePerKg ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="business-page-header flex flex-wrap items-center justify-between gap-3">
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
                        const deliveryStatus = String(delivery.status || "awaiting_confirmation").toLowerCase();
                        const resolution = String(delivery.resolution || "").toLowerCase();
                        const hasApprovedSplit = delivery.approvedQuantityKg != null && ["partial", "replacement_supplier"].includes(resolution);
                        const originalContribution = hasApprovedSplit
                          ? Math.min(available, packed, Number(delivery.approvedQuantityKg || 0))
                          : Math.min(available, packed);
                        const shortage = ["shortage", "partial_approved", "backup_required", "replacement_assigned"].includes(deliveryStatus)
                          ? Math.max(0, required - originalContribution)
                          : 0;
                        const state = deliveryStatus.replace(/_/g, " ");
                        const isShort = ["shortage", "backup_required", "at risk", "rescheduled", "partial_approved"].includes(deliveryStatus);
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
                            {shortage > 0 && <p className="mt-2 text-sm font-medium text-red-700">{deliveryStatus === "replacement_assigned" ? "Original farmer shortfall (replacement assigned)" : "Shortage"}: {shortage} kg</p>}
                            {delivery.notes && <p className="mt-1 text-sm text-slate-600">Farmer note: {delivery.notes}</p>}
                            {delivery.resolution && <p className="mt-1 text-sm text-blue-700">Business resolution: {delivery.resolution.replace(/_/g, " ")}{delivery.resolutionNotes ? " — " + delivery.resolutionNotes : ""}</p>}
                            {delivery.replacementOrderId && (
                              <p className="mt-1 text-sm font-medium text-indigo-700">
                                Replacement order: {delivery.replacementOrderNumber || delivery.replacementOrderId}
                                {delivery.replacementQuantityKg != null ? ` · ${delivery.replacementQuantityKg} kg` : ""}
                                {delivery.replacementOrderStatus ? ` · Status: ${delivery.replacementOrderStatus.replace(/_/g, " ")}` : " · Status unavailable"}
                              </p>
                            )}
                            {["shortage", "backup_required", "partial_approved"].includes(deliveryStatus) && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Button size="sm" variant="outline" disabled={resolveShortageMutation.isPending} onClick={() => {
                                  const raw = window.prompt(`How many kg should be approved for the delivery on ${delivery.scheduledDate}?`);
                                  if (raw === null) return;
                                  const quantity = Number(raw);
                                  if (!Number.isFinite(quantity) || quantity <= 0) {
                                    toast.error("Enter a valid quantity greater than zero.");
                                    return;
                                  }
                                  resolveShortageMutation.mutate({
                                    id: c.id,
                                    payload: {
                                      action: "partial",
                                      scheduledDate: delivery.scheduledDate,
                                      approvedQuantityKg: quantity,
                                      notes: "Business approved partial supply",
                                    },
                                  });
                                }}>Approve partial supply</Button>
                                <Button size="sm" variant="outline" disabled={resolveShortageMutation.isPending} onClick={() => {
                                  const raw = window.prompt("Enter the new delivery date (YYYY-MM-DD):");
                                  if (!raw) return;
                                  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) {
                                    toast.error("Use date format YYYY-MM-DD.");
                                    return;
                                  }
                                  resolveShortageMutation.mutate({
                                    id: c.id,
                                    payload: {
                                      action: "reschedule",
                                      scheduledDate: delivery.scheduledDate,
                                      newDeliveryDate: raw + "T09:00:00",
                                      notes: "Business approved rescheduling",
                                    },
                                  });
                                }}>Reschedule delivery</Button>
                                <Button size="sm" disabled={replacementLoading || resolveShortageMutation.isPending} onClick={() => {
                                  if (replacementPanelContractId === c.id && replacementPanelDate === delivery.scheduledDate) {
                                    setReplacementPanelContractId(null);
                                    setReplacementPanelDate(null);
                                    setReplacementOffers([]);
                                    setReplacementMeta(null);
                                  } else {
                                    loadReplacementOffers(c, delivery.scheduledDate);
                                  }
                                }}>
                                  {replacementLoading && replacementPanelDate === delivery.scheduledDate ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Users className="mr-1 h-4 w-4" />}
                                  {replacementPanelContractId === c.id && replacementPanelDate === delivery.scheduledDate ? "Close replacement quotes" : "Find replacement farmer"}
                                </Button>
                              </div>
                            )}
                            {delivery.confirmedAt && <p className="mt-1 text-xs text-slate-400">Updated {new Date(delivery.confirmedAt).toLocaleString("en-IN")}</p>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {["shortage", "backup_required", "partial_approved"].includes(String(c.latestDeliveryStatus || "").toLowerCase())
                  && !c.deliveryHistory?.some((delivery) => delivery.scheduledDate === c.latestDeliveryDate
                    && ["shortage", "backup_required", "partial_approved"].includes(String(delivery.status || "").toLowerCase()))
                  && (
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
                        resolveShortageMutation.mutate({ id: c.id, payload: { action: "partial", scheduledDate: c.latestDeliveryDate || (c.nextDeliveryAt ? String(c.nextDeliveryAt).slice(0, 10) : undefined), approvedQuantityKg: qty, notes: "Business approved partial supply" } });
                      }}>Approve partial supply</Button>
                      <Button size="sm" variant="outline" disabled={resolveShortageMutation.isPending} onClick={() => {
                        const raw = window.prompt("Enter the new delivery date (YYYY-MM-DD):");
                        if (!raw) return;
                        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) { toast.error("Use date format YYYY-MM-DD."); return; }
                        resolveShortageMutation.mutate({ id: c.id, payload: { action: "reschedule", scheduledDate: c.latestDeliveryDate || (c.nextDeliveryAt ? String(c.nextDeliveryAt).slice(0, 10) : undefined), newDeliveryDate: raw + "T09:00:00", notes: "Business approved rescheduling" } });
                      }}>Reschedule delivery</Button>
                      <Button
                        size="sm"
                        disabled={replacementLoading || resolveShortageMutation.isPending}
                        onClick={() => replacementPanelContractId === c.id && replacementPanelDate === (c.latestDeliveryDate || c.deliveryHistory?.find((delivery) => ["shortage", "backup_required", "partial_approved"].includes(String(delivery.status || "").toLowerCase()))?.scheduledDate)
                          ? (setReplacementPanelContractId(null), setReplacementPanelDate(null), setReplacementOffers([]), setReplacementMeta(null))
                          : loadReplacementOffers(c, c.latestDeliveryDate || c.deliveryHistory?.find((delivery) => ["shortage", "backup_required", "partial_approved"].includes(String(delivery.status || "").toLowerCase()))?.scheduledDate)}
                      >
                        {replacementLoading && replacementPanelContractId === c.id
                          ? <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                          : <Users className="mr-1 h-4 w-4" />}
                        {replacementPanelContractId === c.id ? "Close replacement quotes" : "Replace full delivery with another farmer"}
                      </Button>
                    </div>
                  </div>
                )}
                {replacementPanelContractId === c.id && replacementPanelDate && (
                  <div className="mt-3 w-full rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">Replacement Farmer Selection</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {String(c.deliveryHistory?.find((delivery) => delivery.scheduledDate === replacementPanelDate)?.resolution || "").toLowerCase() === "partial"
                            || String(c.deliveryHistory?.find((delivery) => delivery.scheduledDate === replacementPanelDate)?.status || "").toLowerCase() === "partial_approved"
                            ? "Partial delivery was approved. The replacement farmer will receive only the remaining shortage; the original farmer can still pack and deliver the approved quantity."
                            : "Full replacement mode: the selected farmer receives the entire scheduled quantity. The original farmer's order will be cancelled and they will be told not to deliver this date. Future contract dates remain unchanged."}
                          {" "}Live stock is checked from the farmer inventory and revalidated before assignment.
                        </p>
                        {replacementMeta?.replacementSourcingOpen && (
                          <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
                            Replacement sourcing is open for RFQ {replacementMeta.rfqNumber || replacementMeta.rfqId}. Previously submitted award-declined quotes are included; new quotes for this delivery will appear here after submission.
                          </p>
                        )}
                      </div>
                      <Button size="sm" variant="outline" disabled={replacementLoading} onClick={() => loadReplacementOffers(c)}>
                        {replacementLoading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                        Refresh live stock
                      </Button>
                    </div>

                    {replacementMeta && (
                      <div className="mt-3 grid gap-2 rounded-md bg-slate-50 p-3 text-sm sm:grid-cols-4">
                        <p><span className="text-slate-500">Scheduled date:</span> {replacementMeta.scheduledDate || "Not available"}</p>
                        <p><span className="text-slate-500">Original rate:</span> ₹{replacementMeta.benchmarkPricePerKg}/kg</p>
                        <p><span className="text-slate-500">Original quoted quantity:</span> {replacementMeta.benchmarkQuantityKg} kg</p>
                        <p className="font-semibold text-red-700"><span className="font-normal text-slate-500">{replacementMeta.replacementMode === "full" ? "Full quantity replacement farmer must supply:" : "Remaining shortage:"}</span> {replacementMeta.shortageKg} kg</p>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-700">Rank quotes by:</span>
                      <Button size="sm" variant={replacementRankingMode === "rate" ? "default" : "outline"} onClick={() => setReplacementRankingMode("rate")}>Rate</Button>
                      <Button size="sm" variant={replacementRankingMode === "quantity" ? "default" : "outline"} onClick={() => setReplacementRankingMode("quantity")}>Quantity</Button>
                      <Button size="sm" variant={replacementRankingMode === "combined" ? "default" : "outline"} onClick={() => setReplacementRankingMode("combined")}>Rate + Quantity</Button>
                      <span className="text-xs text-slate-500">Eligible farmers appear first in every mode.</span>
                    </div>

                    {!replacementLoading && rankedReplacementOffers.length > 0 && !rankedReplacementOffers.some((offer) => offer.eligible) && (
                      <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        None of the existing quotes currently covers the {replacementMeta?.replacementMode === "full" ? "full required quantity" : "remaining shortage"} of {replacementMeta?.shortageKg ?? 0} kg using both quoted quantity and live stock. Invite more farmers to submit quotes for this RFQ, then refresh live stock.
                        <div className="mt-2">
                          {replacementMeta?.replacementSourcingOpen && replacementMeta.rfqId ? (
                          <Button size="sm" variant="outline" onClick={() => window.location.assign(`/business/rfqs?rfqId=${encodeURIComponent(replacementMeta.rfqId || "")}&replacementContractId=${encodeURIComponent(c.id)}&scheduledDate=${encodeURIComponent(replacementMeta.scheduledDate)}`)}>
                            <ExternalLink className="mr-1.5 h-4 w-4" /> Open RFQ {replacementMeta.rfqNumber || ""}
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" disabled={requestReplacementSourcingMutation.isPending} onClick={() => {
                            const date = replacementMeta?.scheduledDate || replacementPanelDate;
                            if (!date) { toast.error("Choose the exact scheduled delivery before requesting replacement quotes."); return; }
                            requestReplacementSourcingMutation.mutate({ contractId: c.id, scheduledDate: date });
                          }}>
                            {requestReplacementSourcingMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Users className="mr-1.5 h-4 w-4" />}
                            Request more quotes for this delivery
                          </Button>
                        )}
                        </div>
                      </div>
                    )}

                    {replacementLoading ? (
                      <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin" /> Checking current farmer inventory…
                      </div>
                    ) : rankedReplacementOffers.length === 0 ? (
                      <div className="py-5 text-sm text-slate-600">
                        <p>No pending replacement quotes were found for other farmers on this RFQ. Ask additional farmers to quote, then refresh to recheck current stock.</p>
                        {replacementMeta?.replacementSourcingOpen && replacementMeta.rfqId ? (
                          <Button size="sm" variant="outline" onClick={() => window.location.assign(`/business/rfqs?rfqId=${encodeURIComponent(replacementMeta.rfqId || "")}&replacementContractId=${encodeURIComponent(c.id)}&scheduledDate=${encodeURIComponent(replacementMeta.scheduledDate)}`)}>
                            <ExternalLink className="mr-1.5 h-4 w-4" /> Open RFQ {replacementMeta.rfqNumber || ""}
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" disabled={requestReplacementSourcingMutation.isPending} onClick={() => {
                            const date = replacementMeta?.scheduledDate || replacementPanelDate;
                            if (!date) { toast.error("Choose the exact scheduled delivery before requesting replacement quotes."); return; }
                            requestReplacementSourcingMutation.mutate({ contractId: c.id, scheduledDate: date });
                          }}>
                            {requestReplacementSourcingMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Users className="mr-1.5 h-4 w-4" />}
                            Request more quotes for this delivery
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {rankedReplacementOffers.map((offer, index) => (
                          <div key={offer.id} className={`rounded-md border p-3 ${offer.eligible ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-slate-50"}`}>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-xs font-semibold text-slate-500">#{index + 1}</span>
                                  <p className="font-semibold text-slate-900">{offer.farmerName}</p>
                                   {offer.quoteType === "previously_submitted" && <Badge variant="outline">Previously quoted</Badge>}
                                  <Badge variant={offer.eligible ? "success" : "secondary"}>{offer.eligible ? "Eligible now" : "Not eligible"}</Badge>
                                </div>
                                <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
                                  <p><span className="text-slate-500">Quoted rate:</span> ₹{offer.pricePerKg}/kg</p>
                                  <p><span className="text-slate-500">Quantity in quote:</span> {offer.quotedQuantityKg} kg</p>
                                  <p><span className="font-medium text-emerald-700">Live available stock:</span> {offer.availableQuantityKg} kg</p>
                                  <p><span className="text-slate-500">Currently assignable:</span> {offer.assignableQuantityKg} kg</p>
                                  <p className="text-xs text-slate-500">{compareLabel(offer.pricePerKg, Number(replacementMeta?.benchmarkPricePerKg || 0), "Rate")}</p>
                                  <p className="text-xs text-slate-500">{compareLabel(offer.availableQuantityKg, Number(replacementMeta?.benchmarkQuantityKg || 0), "Live stock")}</p>
                                </div>
                                {offer.ineligibleReason && <p className="mt-2 text-sm text-amber-800">{offer.ineligibleReason}</p>}
                                {offer.stockCheckedAt && <p className="mt-1 text-xs text-slate-400">Stock checked: {new Date(offer.stockCheckedAt).toLocaleString("en-IN")}</p>}
                              </div>
                              <Button
                                size="sm"
                                disabled={!offer.eligible || resolveShortageMutation.isPending}
                                onClick={() => {
                                  if (!replacementMeta?.scheduledDate) {
                                    toast.error("Scheduled delivery date is unavailable. Refresh the contract and try again.");
                                    return;
                                  }
                                  resolveShortageMutation.mutate({
                                    id: c.id,
                                    payload: {
                                      action: "assign_replacement",
                                      scheduledDate: replacementMeta.scheduledDate,
                                      replacementOfferId: offer.id,
                                      replacementMode: replacementMeta.replacementMode || "full",
                                      notes: "Business selected a replacement using live stock and quote ranking",
                                    },
                                  });
                                }}
                              >
                                {resolveShortageMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}
                                {replacementMeta?.replacementMode === "shortage" ? "Assign farmer for shortage only" : "Replace full delivery"}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
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
