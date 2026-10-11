"use client";

import { FormEvent, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calendar, Search, CheckCircle, XCircle, Clock, ArrowDown, ArrowRight, RefreshCw, MoreVertical, Package, Info, ShieldCheck, Warehouse } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { cn, formatDate } from "../../lib/utils";
import { api } from "../../lib/api/client";
import toast from "react-hot-toast";

const statusColors: Record<string, string> = {
  scheduled: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  ready_for_pickup: "bg-amber-500/10 text-amber-700 border-amber-500/20",
  in_transit: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  received: "bg-green-500/10 text-green-600 border-green-500/20",
  quality_check: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  stored: "bg-green-500/10 text-green-600 border-green-500/20",
  rejected: "bg-red-500/10 text-red-600 border-red-500/20",
};

const statusLabels: Record<string, string> = {
  scheduled: "Scheduled",
  in_transit: "In Transit",
  received: "Received",
  quality_check: "Quality Check",
  stored: "Stored",
  rejected: "Rejected",
};

const humanIdFallback = (value: any, label: string) => {
  if (!value) return label;
  const text = String(value);
  return /^[a-f0-9]{24}$/i.test(text) ? label : text;
};

const getFarmGroupKey = (item: any) =>
  String(item.farmId || item.farmerId || item.farmName || item.farmerName || item.pickupLocation?.name || item.pickupLocation?.address || "unknown-farm");

const getFarmDisplayName = (item: any) =>
  item.farmName || item.farmerName || item.pickupLocation?.farmName ||
  item.pickupLocation?.name || "Farm details unavailable";

const getProductDisplayName = (item: any) =>
  humanIdFallback(item.productName || item.product?.name || item.productId, "Product details unavailable");

const emptyIncomingForm = {
  productId: "",
  farmerId: "",
  variantId: "",
  orderId: "",
  quantity: "1",
  expectedDate: "",
  batchNumber: "",
  qualityGrade: "",
  storageType: "ambient",
};

const emptyReceiveForm = {
  quantity: "1",
  usableQuantity: "1",
  qualityCheck: "pending",
  notes: "",
};

export default function WarehouseIncomingPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("today");
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [showReceiveDialog, setShowReceiveDialog] = useState(false);
  const [showQualityDialog, setShowQualityDialog] = useState(false);
  const [showTrackDialog, setShowTrackDialog] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [incomingForm, setIncomingForm] = useState(emptyIncomingForm);
  const [receiveForm, setReceiveForm] = useState(emptyReceiveForm);
  const [selectedIncoming, setSelectedIncoming] = useState<any>(null);
  const [qualityNotes, setQualityNotes] = useState("");
  const [showBulkReceiveDialog, setShowBulkReceiveDialog] = useState(false);
  const [bulkFarmItems, setBulkFarmItems] = useState<any[]>([]);
  const [bulkMeasuredQuantities, setBulkMeasuredQuantities] = useState<Record<string, string>>({});
  const [bulkReceiveNotes, setBulkReceiveNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const { data: incomingData, isLoading, refetch } = useQuery({
    queryKey: ["warehouseIncoming", statusFilter, dateFilter],
    queryFn: () =>
      api.get("/warehouse/me/incoming", {
        params: {
          status: statusFilter !== "all" ? statusFilter : undefined,
          limit: 50,
        },
      }),
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
  });

  const incomingList = useMemo(() => {
    const items = incomingData?.data?.incoming || [];
    const query = searchTerm.trim().toLowerCase();

    const readableItems = items.map((item: any) => ({
      ...item,
      displayFarmName: getFarmDisplayName(item),
      displayProductName: getProductDisplayName(item),
      displayOrderNumber: humanIdFallback(item.orderNumber || item.order?.orderNumber, "Order reference unavailable"),
    }));

    if (!query) return readableItems;

    return readableItems.filter((item: any) =>
      [item.displayFarmName, item.displayProductName, item.displayOrderNumber, item.pickupLocation?.address, item.batchNumber, statusLabels[item.status] || item.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [incomingData, searchTerm]);



  const updateIncomingForm = (field: keyof typeof incomingForm, value: string) => {
    setIncomingForm((current) => ({ ...current, [field]: value }));
  };

  const updateReceiveForm = (field: keyof typeof receiveForm, value: string) => {
    setReceiveForm((current) => ({ ...current, [field]: value }));
  };

  const openScheduleDialog = () => {
    setIncomingForm({
      ...emptyIncomingForm,
      expectedDate: new Date().toISOString().slice(0, 10),
    });
    setShowScheduleDialog(true);
  };

  const openReceiveDialog = (item: any) => {
    setSelectedIncoming(item);
    setReceiveForm({
      quantity: String(item.quantity || 1),
      usableQuantity: String(item.quantity || 1),
      qualityCheck: "pending",
      notes: "",
    });
    setShowReceiveDialog(true);
  };

  const openBulkReceiveDialog = (items: any[]) => {
    setBulkFarmItems(items);
    setBulkMeasuredQuantities(Object.fromEntries(items.map((item) => [item.id, String(item.quantity ?? "")])));
    setBulkReceiveNotes("");
    setShowBulkReceiveDialog(true);
  };

  const handleBulkReceive = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!bulkFarmItems.length) return;
    const invalid = bulkFarmItems.find((item) => !Number.isFinite(Number(bulkMeasuredQuantities[item.id])) || Number(bulkMeasuredQuantities[item.id]) <= 0);
    if (invalid) { toast.error("Enter a valid measured quantity for every order before confirming."); return; }
    const mismatches = bulkFarmItems.filter((item) => Math.abs(Number(bulkMeasuredQuantities[item.id]) - Number(item.quantity || 0)) > 0.001);
    if (mismatches.length && !bulkReceiveNotes.trim()) { toast.error("Add a note explaining the weight difference before saving."); return; }
    if (mismatches.length && !window.confirm(String(mismatches.length) + " order(s) have a weight difference. They will remain pending quality review. Continue?")) return;
    setIsSaving(true); let succeeded = 0;
    try {
      for (const item of bulkFarmItems) {
        const measured = Number(bulkMeasuredQuantities[item.id]);
        await api.put("/warehouse/me/incoming/" + item.id + "/receive", undefined, { params: { quantity: measured, usableQuantity: measured, quality_check: "pending", notes: bulkReceiveNotes.trim() || undefined } });
        succeeded++;
      }
      toast.success("Received " + succeeded + " shipment(s). Weight differences remain pending quality review.");
      setShowBulkReceiveDialog(false); await refetch();
    } catch (error: any) {
      toast.error("Processed " + succeeded + " of " + bulkFarmItems.length + ". Refresh and review remaining shipments before retrying."); await refetch();
    } finally { setIsSaving(false); }
  };
  const handleScheduleIncoming = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!incomingForm.productId.trim() || !incomingForm.farmerId.trim()) {
      toast.error("Product ID and Farmer ID are required");
      return;
    }

    try {
      setIsSaving(true);
      await api.post("/warehouse/me/incoming", {
        warehouseId: "current",
        productId: incomingForm.productId.trim(),
        farmerId: incomingForm.farmerId.trim(),
        variantId: incomingForm.variantId.trim() || undefined,
        orderId: incomingForm.orderId.trim() || undefined,
        quantity: Number(incomingForm.quantity),
        expectedDate: new Date(incomingForm.expectedDate).toISOString(),
        batchNumber: incomingForm.batchNumber.trim() || undefined,
        qualityGrade: incomingForm.qualityGrade.trim() || undefined,
        storageType: incomingForm.storageType,
      });
      toast.success("Incoming stock scheduled");
      setShowScheduleDialog(false);
      refetch();
    } catch (error) {
      toast.error("Failed to schedule incoming stock");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReceiveStock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedIncoming?.id) {
      toast.error("Select an incoming shipment first");
      return;
    }
    const expectedQuantity = Number(selectedIncoming.quantity || 0);
    const actualQuantity = Number(receiveForm.quantity || 0);
    const isFarmerPacked = selectedIncoming.sourceMode === "farmer_fulfillment_transfer";
    const quantityMismatch = Math.abs(actualQuantity - expectedQuantity) > 0.001;
    if (!isFarmerPacked && quantityMismatch && !receiveForm.notes.trim()) {
      toast.error("The weight differs from the farmer's declared quantity. Add a discrepancy note before saving.");
      return;
    }
    if (!isFarmerPacked && quantityMismatch) {
      const accepted = window.confirm("The measured weight does not match the declared quantity. This receipt will remain pending quality review. Continue?");
      if (!accepted) return;
    }

    try {
      setIsSaving(true);
      await api.put(`/warehouse/me/incoming/${selectedIncoming.id}/receive`, undefined, {
        params: {
          quantity: Number(receiveForm.quantity),
          usableQuantity: Number(receiveForm.usableQuantity),
          quality_check: !isFarmerPacked && quantityMismatch ? "pending" : receiveForm.qualityCheck,
          notes: receiveForm.notes.trim() || undefined,
        },
      });
      toast.success(isFarmerPacked ? "Packed farmer order received. Continue to Farmer Fulfillment Transfers / Consolidation." : quantityMismatch ? "Weight discrepancy recorded. Keep stock on hold and contact the farm before quality approval." : "Bulk stock received. Continue to Quality Inspection, then Store.");
      setShowReceiveDialog(false);
      refetch();
    } catch (error) {
      toast.error("Failed to receive stock");
    } finally {
      setIsSaving(false);
    }
  };

  const handleQuality = async (qualityCheck: "passed" | "failed") => {
    if (!selectedIncoming?.id) return;
    try {
      setIsSaving(true);
      await api.put(`/warehouse/me/incoming/${selectedIncoming.id}/quality`, {
        qualityCheck,
        usableQuantity: Number(selectedIncoming.quantityReceived || selectedIncoming.quantity || 0),
        notes: qualityNotes.trim() || undefined,
      });
      toast.success(qualityCheck === "passed" ? "Quality approved. You can now store this stock." : "Quality rejected. Shipment is on hold.");
      setShowQualityDialog(false); setQualityNotes(""); await refetch();
    } catch (error: any) { toast.error(error?.message || "Failed to update quality result"); }
    finally { setIsSaving(false); }
  };

  const openQualityDialog = (item: any) => { setSelectedIncoming(item); setQualityNotes(""); setShowQualityDialog(true); };

  const handleStoreIncoming = async (item: any) => {
    if (!item?.id) return;
    try {
      setIsSaving(true);
      await api.put(`/warehouse/me/incoming/${item.id}/store`);
      toast.success("Stock stored successfully");
      refetch();
    } catch (error: any) {
      toast.error(error?.message || "Failed to store incoming stock");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between"><div><h1 className="text-3xl font-bold">Incoming Stock</h1><p className="text-muted-foreground">Receive shipments after farm collection; inspect and store accepted stock.</p></div></div>
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-slate-200 bg-slate-50/80"><CardContent className="flex gap-3 p-4"><Info className="mt-0.5 h-5 w-5 shrink-0 text-slate-600"/><div className="text-sm"><p className="font-semibold">Two fulfillment workflows</p><p className="mt-1 text-sm leading-6 text-muted-foreground"><b>Farmer Fulfillment:</b> verify packed orders and quantities → optional temporary storage → Transfers / Multi-Warehouse Consolidation. Skip normal warehouse QC and repacking. <b>Normal Warehouse Fulfillment:</b> Receive → Quality Inspection → Store → Stock Management → Order Packing → Outgoing / Dispatch.</p></div></CardContent></Card>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="text-3xl font-bold">Incoming Stock</h1><p className="text-muted-foreground">{incomingList.length} incoming shipments</p></div>
        <div className="flex items-center gap-2"><Button variant="outline" size="icon" onClick={() => { void refetch(); }}><RefreshCw className="h-4 w-4" /></Button></div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input placeholder="Search incoming shipments..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" /></div>
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="scheduled">Scheduled</SelectItem><SelectItem value="in_transit">In Transit</SelectItem><SelectItem value="received">Received</SelectItem><SelectItem value="quality_check">Quality Check</SelectItem><SelectItem value="stored">Stored</SelectItem><SelectItem value="rejected">Rejected</SelectItem></SelectContent></Select>
          <Select value={dateFilter} onValueChange={setDateFilter}><SelectTrigger className="w-[150px]"><SelectValue placeholder="Date" /></SelectTrigger><SelectContent><SelectItem value="today">Today</SelectItem><SelectItem value="week">This Week</SelectItem><SelectItem value="month">This Month</SelectItem><SelectItem value="all">All Time</SelectItem></SelectContent></Select>
        </div>
      </div>

      {incomingList.length === 0 ? (
        <Card className="p-12 text-center"><ArrowDown className="mx-auto h-12 w-12 text-muted-foreground" /><h3 className="mt-4 text-lg font-semibold">No incoming shipments</h3><p className="mt-2 text-muted-foreground">{statusFilter !== "all" ? `No ${statusLabels[statusFilter] || statusFilter} shipments` : "Shipments appear here after their farm pickup reaches the warehouse."}</p></Card>
      ) : (
        <div className="space-y-6">{Array.from(incomingList.reduce((groups: Map<string, any[]>, item: any) => { const key = getFarmGroupKey(item); if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(item); return groups; }, new Map<string, any[]>()).entries()).map(([farmKey, farmItems]) => {
          const packedFarmerGroup = farmItems.every((row: any) => row.sourceMode === "farmer_fulfillment_transfer");
          const expectedTotal = farmItems.reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0);
          const receivedCount = farmItems.filter((row: any) => row.status === "received" || row.status === "stored").length;
          const eligibleToReceive = farmItems.filter((row: any) => ["scheduled", "in_transit"].includes(row.status) && (row.sourceMode !== "farmer_fulfillment_transfer" || Boolean(row.arrivedWarehouseAt)));
          const canConfirmAllPackets = packedFarmerGroup && eligibleToReceive.length > 0;
          const canReceiveAllBulk = !packedFarmerGroup && eligibleToReceive.length > 0;
          const confirmAllPackets = async () => {
            if (!window.confirm(`Confirm receipt of all ${farmItems.length} packed orders from ${farmItems[0].displayFarmName}? Only continue after physically counting every packet.`)) return;
            setIsSaving(true);
            let succeeded = 0;
            try {
              for (const row of farmItems) {
                if (!row.id || !["scheduled", "in_transit"].includes(row.status)) continue;
                await api.put(`/warehouse/me/incoming/${row.id}/receive`, undefined, { params: { quantity: Number(row.quantity || 0), usableQuantity: Number(row.quantity || 0), quality_check: "passed", notes: "Bulk packet receipt confirmed by warehouse staff after physical count." } });
                succeeded++;
              }
              toast.success(`Received ${succeeded} of ${farmItems.length} packed orders. Review any remaining orders below.`);
              await refetch();
            } catch (error: any) {
              toast.error(`Received ${succeeded} orders before an error. Refresh and review remaining packets.`);
              await refetch();
            } finally { setIsSaving(false); }
          };
          return <section key={farmKey} className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-slate-50 px-4 py-3"><div><h2 className="text-lg font-semibold">{farmItems[0].displayFarmName}</h2><p className="text-sm text-muted-foreground">{farmItems[0].pickupLocation?.address || farmItems[0].farmAddress || "Farm address not available"}</p><p className="mt-1 text-sm font-medium">{farmItems.length} orders · {packedFarmerGroup ? `${farmItems.length} packed packets` : `Expected bulk weight: ${expectedTotal.toLocaleString()} kg`} · {receivedCount}/{farmItems.length} received</p></div><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{farmItems.length} {farmItems.length === 1 ? "order" : "orders"}</Badge>{canConfirmAllPackets && <Button size="sm" onClick={confirmAllPackets} disabled={isSaving}><CheckCircle className="mr-2 h-4 w-4" />{isSaving ? "Confirming..." : "Confirm All Packets Received"}</Button>}{canReceiveAllBulk && <Button size="sm" onClick={() => openBulkReceiveDialog(eligibleToReceive)} disabled={isSaving}><Package className="mr-2 h-4 w-4" />Receive All Bulk Stock</Button>}</div></div><div className="space-y-3">{farmItems.map((item: any) => {
          const productName = item.displayProductName || getProductDisplayName(item);
          const isPackedFarmerTransfer = item.sourceMode === "farmer_fulfillment_transfer";
          const hasPhysicallyArrived = Boolean(item.arrivedWarehouseAt);
          const canReceiveStock = ["scheduled", "in_transit"].includes(item.status) &&
            (!isPackedFarmerTransfer || hasPhysicallyArrived);
          const nextPage = isPackedFarmerTransfer
            ? (item.orderId ? "/farmer-fulfillment" : "/consolidation")
            : (item.status === "stored" ? "/stock" : "/quality-inspection");
          return (
            <Card key={item.id}><CardContent className="p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-3"><div><p className="font-semibold">{productName}</p><p className="mt-1 text-sm text-muted-foreground">Order: {item.displayOrderNumber || "Order reference unavailable"}</p></div><Badge variant="outline" className={cn("border", statusColors[item.status as keyof typeof statusColors])}>{statusLabels[item.status as keyof typeof statusLabels] || item.status}</Badge>{item.qualityCheck === "passed" && <Badge variant="success">Passed QC</Badge>}{item.qualityCheck === "failed" && <Badge variant="destructive">Failed QC</Badge>}</div><div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted-foreground"><span>From farm: {item.displayFarmName || "Farm details unavailable"}</span><span>Quantity: <span className="font-medium text-foreground">{item.quantity}</span></span><span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Expected: {formatDate(item.expectedDate)}</span></div>{item.batchNumber && <p className="mt-1 text-sm text-muted-foreground">Batch: {item.batchNumber}</p>}{item.qualityNotes && <p className="mt-1 text-sm text-yellow-600">{item.qualityNotes}</p>}</div><div className="flex items-center gap-2">{item.status === "scheduled" && <Button size="sm" variant="outline" onClick={() => { setSelectedIncoming(item); setShowTrackDialog(true); }}><Clock className="mr-2 h-4 w-4" />Track</Button>}{canReceiveStock && <Button size="sm" onClick={() => openReceiveDialog(item)}><CheckCircle className="mr-2 h-4 w-4" />Receive Stock</Button>}
                      {isPackedFarmerTransfer && !hasPhysicallyArrived && <Badge variant="outline" className="border-amber-300 text-amber-700">Awaiting Farm Pickup / Arrival</Badge>}
                      {isPackedFarmerTransfer && item.status === "received" && <Button size="sm" onClick={() => { window.location.href = nextPage; }}><ArrowRight className="mr-2 h-4 w-4" />Continue to Transfers</Button>}{!isPackedFarmerTransfer && item.status === "received" && <Button size="sm" onClick={() => openQualityDialog(item)}><ShieldCheck className="mr-2 h-4 w-4" />Quality Check</Button>}{!isPackedFarmerTransfer && item.status === "received" && item.qualityCheck === "passed" && <Button size="sm" onClick={() => handleStoreIncoming(item)}><Package className="mr-2 h-4 w-4" />Store</Button>}{!isPackedFarmerTransfer && item.status === "stored" && <Button size="sm" variant="outline" onClick={() => { window.location.href = "/stock"; }}><Warehouse className="mr-2 h-4 w-4" />View Inventory</Button>}{item.status === "quality_check" && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => openQualityDialog(item)}><XCircle className="mr-2 h-4 w-4" />Inspect</Button></div>}<div className="relative">
                        <Button type="button" variant="ghost" size="icon" aria-label={`Actions for ${productName}`} aria-expanded={openMenuId === item.id} onClick={() => setOpenMenuId((current) => current === item.id ? null : item.id)}><MoreVertical className="h-4 w-4" /></Button>
                        {openMenuId === item.id && <div className="absolute right-0 top-10 z-20 min-w-44 rounded-md border bg-background p-1 shadow-lg">
                          <button type="button" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { setSelectedIncoming(item); setShowTrackDialog(true); setOpenMenuId(null); }}>View shipment details</button>
                          {canReceiveStock && <button type="button" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { openReceiveDialog(item); setOpenMenuId(null); }}>Receive stock</button>}
                          {item.status === "received" && <button type="button" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { openQualityDialog(item); setOpenMenuId(null); }}>Quality inspection</button>}
                          {item.status === "received" && item.qualityCheck === "passed" && <button type="button" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { void handleStoreIncoming(item); setOpenMenuId(null); }}>Store stock</button>}
                          <button type="button" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { void refetch(); setOpenMenuId(null); }}>Refresh status</button>
                        </div>}
                      </div></div></div></CardContent></Card>
          );
        })}</div></section>;
        })}</div>
      )}

      <Dialog open={showBulkReceiveDialog} onOpenChange={setShowBulkReceiveDialog}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Receive All Bulk Stock — {bulkFarmItems[0]?.displayFarmName || "Farm"}</DialogTitle><DialogDescription>Enter the scale-measured weight for each bulk shipment. Matching quantities can proceed to quality inspection; discrepancies stay pending review.</DialogDescription></DialogHeader>
          <form className="space-y-4" onSubmit={handleBulkReceive}>
            <div className="space-y-3">{bulkFarmItems.map((item) => <div key={item.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_150px] sm:items-center"><div><p className="font-semibold">{item.displayProductName || getProductDisplayName(item)}</p><p className="text-sm text-muted-foreground">Order {item.displayOrderNumber || "reference unavailable"} · Farmer declared: {item.quantity} {item.unit || "kg"}</p></div><div><label className="text-sm font-medium">Measured kg</label><Input type="number" min="0.01" step="0.01" value={bulkMeasuredQuantities[item.id] ?? ""} onChange={(e) => setBulkMeasuredQuantities((current) => ({ ...current, [item.id]: e.target.value }))} required /></div></div>)}</div>
            <div><label className="text-sm font-medium">Notes / discrepancy details</label><Input value={bulkReceiveNotes} onChange={(e) => setBulkReceiveNotes(e.target.value)} placeholder="Required if any measured weight differs" /></div>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setShowBulkReceiveDialog(false)}>Cancel</Button><Button type="submit" disabled={isSaving}>{isSaving ? "Saving receipts..." : "Confirm All Receipts"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={showTrackDialog} onOpenChange={setShowTrackDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Shipment Tracking</DialogTitle><DialogDescription>Current warehouse receiving status and shipment details.</DialogDescription></DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border p-4">
              <p className="text-lg font-semibold">{selectedIncoming?.productName || selectedIncoming?.productId || "Incoming shipment"}</p>
              <p className="mt-1 text-muted-foreground">Shipment reference: {selectedIncoming?.orderNumber || selectedIncoming?.batchNumber || "Available in shipment record"}</p>
              <p className="mt-1">Status: <span className="font-semibold">{statusLabels[selectedIncoming?.status] || selectedIncoming?.status || "Unknown"}</span></p>
              <p className="mt-1">Expected quantity: {selectedIncoming?.quantity ?? "—"}</p>
              <p className="mt-1">Received quantity: {selectedIncoming?.quantityReceived ?? "Not received yet"}</p>
              <p className="mt-1">Farm: {selectedIncoming?.displayFarmName || getFarmDisplayName(selectedIncoming || {})}</p>
              <p className="mt-1">Expected date: {formatDate(selectedIncoming?.expectedDate)}</p>
              {selectedIncoming?.arrivedWarehouseAt && <p className="mt-1">Warehouse arrival: {formatDate(selectedIncoming.arrivedWarehouseAt)}</p>}
              {selectedIncoming?.pickupRouteNumber && <p className="mt-1">Pickup route: {selectedIncoming.pickupRouteNumber}</p>}
            </div>
            <div className="flex justify-end"><Button variant="outline" onClick={() => setShowTrackDialog(false)}>Close</Button></div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Schedule Incoming Stock</DialogTitle><DialogDescription>Create an expected shipment for this warehouse.</DialogDescription></DialogHeader>
          <form className="space-y-4" onSubmit={handleScheduleIncoming}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className="text-sm font-medium">Product ID</label><Input value={incomingForm.productId} onChange={(event) => updateIncomingForm("productId", event.target.value)} className="mt-1" required /></div>
              <div><label className="text-sm font-medium">Farmer ID</label><Input value={incomingForm.farmerId} onChange={(event) => updateIncomingForm("farmerId", event.target.value)} className="mt-1" required /></div>
              <div><label className="text-sm font-medium">Quantity</label><Input type="number" min="1" value={incomingForm.quantity} onChange={(event) => updateIncomingForm("quantity", event.target.value)} className="mt-1" required /></div>
              <div><label className="text-sm font-medium">Expected Date</label><Input type="date" value={incomingForm.expectedDate} onChange={(event) => updateIncomingForm("expectedDate", event.target.value)} className="mt-1" required /></div>
              <div><label className="text-sm font-medium">Batch Number</label><Input value={incomingForm.batchNumber} onChange={(event) => updateIncomingForm("batchNumber", event.target.value)} className="mt-1" /></div>
              <div><label className="text-sm font-medium">Quality Grade</label><Input value={incomingForm.qualityGrade} onChange={(event) => updateIncomingForm("qualityGrade", event.target.value)} className="mt-1" /></div>
            </div>
            <div>
              <label className="text-sm font-medium">Storage Type</label>
              <Select value={incomingForm.storageType} onValueChange={(value) => updateIncomingForm("storageType", value)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select storage type" /></SelectTrigger>
                <SelectContent><SelectItem value="ambient">Ambient</SelectItem><SelectItem value="chilled">Chilled</SelectItem><SelectItem value="frozen">Frozen</SelectItem><SelectItem value="controlled_atmosphere">Controlled Atmosphere</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-4"><Button type="button" variant="outline" onClick={() => setShowScheduleDialog(false)}>Cancel</Button><Button type="submit" disabled={isSaving}>{isSaving ? "Saving..." : "Schedule Incoming"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showQualityDialog} onOpenChange={setShowQualityDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Quality Inspection</DialogTitle><DialogDescription>Receiving is complete. Decide whether this shipment can enter warehouse inventory.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 p-4 text-sm"><p className="font-semibold">{selectedIncoming?.productName || selectedIncoming?.productId}</p><p className="mt-1 text-muted-foreground">Received: {selectedIncoming?.quantityReceived || selectedIncoming?.quantity || 0}</p></div>
            <Input placeholder="Inspection notes" value={qualityNotes} onChange={e=>setQualityNotes(e.target.value)} />
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>setShowQualityDialog(false)}>Cancel</Button><Button variant="destructive" onClick={()=>handleQuality("failed")} disabled={isSaving}>Reject / Hold</Button><Button onClick={()=>handleQuality("passed")} disabled={isSaving}><CheckCircle className="mr-2 h-4 w-4"/>Approve Quality</Button></div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showReceiveDialog} onOpenChange={setShowReceiveDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{selectedIncoming?.sourceMode === "farmer_fulfillment_transfer" ? "Confirm Packed Order Receipt" : "Receive Bulk Stock"}</DialogTitle><DialogDescription>{selectedIncoming?.sourceMode === "farmer_fulfillment_transfer" ? "Verify the quantity physically received. This order is already packed, so warehouse quality inspection and repacking are skipped." : "Record the received quantity. After receipt, complete Quality Inspection and Store before order packing."}</DialogDescription></DialogHeader>
          <form className="space-y-4" onSubmit={handleReceiveStock}>
            <div className="rounded-lg border bg-slate-50 p-3 text-sm"><p className="font-medium">Farmer declared quantity: {selectedIncoming?.quantity ?? "—"} {selectedIncoming?.unit || "kg"}</p><p className="mt-1 text-muted-foreground">{selectedIncoming?.sourceMode === "farmer_fulfillment_transfer" ? "Count the sealed packets and confirm the number of packed orders received." : "Weigh the bulk stock on the warehouse scale and enter the measured quantity below."}</p></div>
            <div><label className="text-sm font-medium">{selectedIncoming?.sourceMode === "farmer_fulfillment_transfer" ? "Received packet quantity / order units" : "Actual weight measured at warehouse (kg)"}</label><Input type="number" min="0.01" step="0.01" value={receiveForm.quantity} onChange={(event) => updateReceiveForm("quantity", event.target.value)} className="mt-1" required /><p className="mt-1 text-xs text-muted-foreground">Difference: {(Number(receiveForm.quantity || 0) - Number(selectedIncoming?.quantity || 0)).toFixed(2)} {selectedIncoming?.unit || "kg"}</p></div>
            <div><label className="text-sm font-medium">Usable Quantity for Packing</label><Input type="number" min="0" max={receiveForm.quantity} step="0.01" value={receiveForm.usableQuantity} onChange={(event) => updateReceiveForm("usableQuantity", event.target.value)} className="mt-1" required /><p className="mt-1 text-xs text-muted-foreground">If measured weight differs from declared weight, add a note. The stock stays pending quality review until the discrepancy is resolved.</p></div>
            {selectedIncoming?.sourceMode !== "farmer_fulfillment_transfer" && <div>
              <label className="text-sm font-medium">Quality Result</label>
              <Select value={receiveForm.qualityCheck} onValueChange={(value) => updateReceiveForm("qualityCheck", value)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select quality result" /></SelectTrigger>
                <SelectContent><SelectItem value="passed">Passed</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="failed">Failed</SelectItem></SelectContent>
              </Select>
            </div>}
            {selectedIncoming?.sourceMode === "farmer_fulfillment_transfer" && <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">After receipt, continue to Farmer Fulfillment Transfers / Multi-Warehouse Consolidation. Storage is optional and this order will not enter bulk inventory.</p>}
            <div><label className="text-sm font-medium">Notes</label><Input value={receiveForm.notes} onChange={(event) => updateReceiveForm("notes", event.target.value)} className="mt-1" /></div>
            <div className="flex justify-end gap-2 pt-4"><Button type="button" variant="outline" onClick={() => setShowReceiveDialog(false)}>Cancel</Button><Button type="submit" disabled={isSaving}>{isSaving ? "Saving..." : "Save Receipt"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
