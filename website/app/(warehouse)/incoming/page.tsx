"use client";

import { FormEvent, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calendar, Search, CheckCircle, XCircle, Clock, ArrowDown, RefreshCw, Plus, MoreVertical, Package, Info, ShieldCheck, AlertTriangle } from "lucide-react";
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
  const [incomingForm, setIncomingForm] = useState(emptyIncomingForm);
  const [receiveForm, setReceiveForm] = useState(emptyReceiveForm);
  const [selectedIncoming, setSelectedIncoming] = useState<any>(null);
  const [qualityNotes, setQualityNotes] = useState("");
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

    if (!query) {
      return items;
    }

    return items.filter((item: any) =>
      [item.productName, item.productId, item.farmerName, item.farmerId, item.batchNumber]
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

    try {
      setIsSaving(true);
      await api.put(`/warehouse/me/incoming/${selectedIncoming.id}/receive`, undefined, {
        params: {
          quantity: Number(receiveForm.quantity),
          usableQuantity: Number(receiveForm.usableQuantity),
          quality_check: receiveForm.qualityCheck,
          notes: receiveForm.notes.trim() || undefined,
        },
      });
      toast.success(receiveForm.qualityCheck === "failed" ? "Incoming stock rejected" : "Shipment received. Continue to Quality Inspection / Store.");
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
      <Card className="border-slate-200 bg-slate-50/80"><CardContent className="flex gap-3 p-4"><Info className="mt-0.5 h-5 w-5 shrink-0 text-slate-600"/><div className="text-sm"><p className="font-semibold">Incoming is the warehouse receiving stage.</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Farm Collection brings the shipment to the warehouse. Staff then Receive → Quality Check → Store. Do not mark a collection as received until the physical shipment has arrived.</p></div></CardContent></Card>
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
        <div className="space-y-4">{incomingList.map((item: any) => {
          const productName = item.productName || item.productId || "Incoming product";
          const isPackedFarmerTransfer = item.sourceMode === "farmer_fulfillment_transfer";
          const hasPhysicallyArrived = Boolean(item.arrivedWarehouseAt);
          const canReceiveStock = ["scheduled", "in_transit"].includes(item.status) &&
            (!isPackedFarmerTransfer || hasPhysicallyArrived);
          return (
            <Card key={item.id}><CardContent className="p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-3"><span className="font-medium">{productName}</span><Badge variant="outline" className={cn("border", statusColors[item.status as keyof typeof statusColors])}>{statusLabels[item.status as keyof typeof statusLabels] || item.status}</Badge>{item.qualityCheck === "passed" && <Badge variant="success">Passed QC</Badge>}{item.qualityCheck === "failed" && <Badge variant="destructive">Failed QC</Badge>}</div><div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted-foreground"><span>From: {item.farmerName || item.farmerId || "Unknown Farmer"}</span><span>Quantity: <span className="font-medium text-foreground">{item.quantity}</span></span><span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Expected: {formatDate(item.expectedDate)}</span></div>{item.batchNumber && <p className="mt-1 text-sm text-muted-foreground">Batch: {item.batchNumber}</p>}{item.qualityNotes && <p className="mt-1 text-sm text-yellow-600">{item.qualityNotes}</p>}</div><div className="flex items-center gap-2">{item.status === "scheduled" && <Button size="sm" variant="outline"><Clock className="mr-2 h-4 w-4" />Track</Button>}{canReceiveStock && <Button size="sm" onClick={() => openReceiveDialog(item)}><CheckCircle className="mr-2 h-4 w-4" />Receive Stock</Button>}
                      {isPackedFarmerTransfer && !hasPhysicallyArrived && <Badge variant="outline" className="border-amber-300 text-amber-700">Awaiting Farm Pickup / Arrival</Badge>}
                      {item.status === "received" && <Button size="sm" onClick={() => openQualityDialog(item)}><ShieldCheck className="mr-2 h-4 w-4" />Quality Check</Button>}{item.status === "received" && item.qualityCheck === "passed" && <Button size="sm" onClick={() => handleStoreIncoming(item)}><Package className="mr-2 h-4 w-4" />Store</Button>}{item.status === "quality_check" && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => openQualityDialog(item)}><XCircle className="mr-2 h-4 w-4" />Inspect</Button></div>}<Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button></div></div></CardContent></Card>
          );
        })}</div>
      )}

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
          <DialogHeader><DialogTitle>Receive Stock</DialogTitle><DialogDescription>Record the received quantity and quality result for {selectedIncoming?.productName || selectedIncoming?.productId}.</DialogDescription></DialogHeader>
          <form className="space-y-4" onSubmit={handleReceiveStock}>
            <div><label className="text-sm font-medium">Received Quantity</label><Input type="number" min="0.01" step="0.01" value={receiveForm.quantity} onChange={(event) => updateReceiveForm("quantity", event.target.value)} className="mt-1" required /></div>
            <div><label className="text-sm font-medium">Usable Quantity for Packing</label><Input type="number" min="0" max={receiveForm.quantity} step="0.01" value={receiveForm.usableQuantity} onChange={(event) => updateReceiveForm("usableQuantity", event.target.value)} className="mt-1" required /><p className="mt-1 text-xs text-muted-foreground">Example: received 100 kg, usable 95 kg → the system creates a 5 kg shortage and blocks packing until resolved.</p></div>
            <div>
              <label className="text-sm font-medium">Quality Result</label>
              <Select value={receiveForm.qualityCheck} onValueChange={(value) => updateReceiveForm("qualityCheck", value)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select quality result" /></SelectTrigger>
                <SelectContent><SelectItem value="passed">Passed</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="failed">Failed</SelectItem></SelectContent>
              </Select>
            </div>
            <div><label className="text-sm font-medium">Notes</label><Input value={receiveForm.notes} onChange={(event) => updateReceiveForm("notes", event.target.value)} className="mt-1" /></div>
            <div className="flex justify-end gap-2 pt-4"><Button type="button" variant="outline" onClick={() => setShowReceiveDialog(false)}>Cancel</Button><Button type="submit" disabled={isSaving}>{isSaving ? "Saving..." : "Save Receipt"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
