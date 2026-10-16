"use client";

import { FormEvent, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calendar, Search, CheckCircle, XCircle, Clock, ArrowDown, ArrowRight, RefreshCw, MoreVertical, Package, Info, ShieldCheck, Warehouse, Truck, Route } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { cn, formatDate } from "../../lib/utils";
import { PrefetchLink as Link } from "../../components/shared/prefetch-link";
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
  (isFarmerPackedIncoming(item) ? "farmer-fulfillment:" : "warehouse-fulfillment:") +
  String(item.farmId || item.farmerId || item.farmName || item.farmerName || item.pickupLocation?.name || item.pickupLocation?.address || "unknown-farm");

const isFarmerPackedIncoming = (item: any) => {
  // The farmer's explicit choice takes precedence over legacy route links.
  // Warehouse-fulfilled orders also have orderId + pickupRouteId, but they
  // must go through quality inspection, storage, packing, and shortage checks.
  const method = String(item?.fulfillmentMethod || "").trim().toLowerCase();
  if (method === "farmer") return true;
  if (method === "warehouse") return false;
  const sourceMode = String(item?.sourceMode || "").trim().toLowerCase();
  if (sourceMode === "farmer_fulfillment_transfer" || sourceMode === "farmer_fulfillment") return true;
  if (sourceMode === "warehouse_fulfillment_bulk" || sourceMode === "warehouse_fulfillment") return false;
  if (item?.packingRequired === false) return true;
  if (item?.packingRequired === true) return false;
  return Boolean(item?.orderId && item?.pickupRouteId);
};

const getFarmDisplayName = (item: any) =>
  item.farmName || item.farmerName || item.pickupLocation?.farmName ||
  item.pickupLocation?.name || "Farm details unavailable";

const getProductDisplayName = (item: any) =>
  humanIdFallback(item.productName || item.product?.name || item.productId, "Product details unavailable");

// Use the event date that best represents the shipment's current stage.
// For received shipments, prefer the actual receipt time; otherwise use the
// expected delivery date, then creation/update timestamps as fallbacks.
const getIncomingActivityDate = (item: any): Date | null => {
  const rawDate =
    (["received", "quality_check", "stored", "rejected"].includes(String(item?.status))
      ? item?.receivedAt || item?.qualityCheckedAt || item?.storedAt
      : null) ||
    item?.expectedDate ||
    item?.arrivedWarehouseAt ||
    item?.createdAt ||
    item?.updatedAt;
  if (!rawDate) return null;
  const parsed = new Date(rawDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const matchesIncomingDateFilter = (item: any, period: string): boolean => {
  if (period === "all") return true;
  const date = getIncomingActivityDate(item);
  if (!date) return false;

  // Calendar boundaries use the browser's local timezone so Today/Week/Month
  // match the dates shown to the warehouse manager.
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  if (period === "today") {
    end.setDate(start.getDate() + 1);
  } else if (period === "yesterday") {
    start.setDate(start.getDate() - 1);
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 1);
  } else if (period === "week") {
    const dayFromMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - dayFromMonday);
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 7);
  } else if (period === "month") {
    start.setDate(1);
    end.setFullYear(start.getFullYear(), start.getMonth() + 1, 1);
  }
  return date >= start && date < end;
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
  const [fulfillmentFilter, setFulfillmentFilter] = useState<"all" | "farmer" | "warehouse">("all");
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [showReceiveDialog, setShowReceiveDialog] = useState(false);
  const [showQualityDialog, setShowQualityDialog] = useState(false);
  const [showStoreDialog, setShowStoreDialog] = useState(false);
  const [storeForm, setStoreForm] = useState({ usableQuantity: "", storageLocation: "", storageType: "ambient" });
  const [showTrackDialog, setShowTrackDialog] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [incomingForm, setIncomingForm] = useState(emptyIncomingForm);
  const [receiveForm, setReceiveForm] = useState(emptyReceiveForm);
  const [selectedIncoming, setSelectedIncoming] = useState<any>(null);
  const [qualityNotes, setQualityNotes] = useState("");
  const [showBulkReceiveDialog, setShowBulkReceiveDialog] = useState(false);
  const [bulkFarmItems, setBulkFarmItems] = useState<any[]>([]);
  const [bulkMeasuredQuantities, setBulkMeasuredQuantities] = useState<Record<string, string>>({});
  const [bulkQualityChecks, setBulkQualityChecks] = useState<Record<string, "passed" | "failed">>({});
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

  const incomingTypeCounts = useMemo(() => {
    const rawIncoming = incomingData?.data?.incoming;
    const items: any[] = Array.isArray(rawIncoming)
      ? rawIncoming
      : Array.isArray(rawIncoming?.items)
        ? rawIncoming.items
        : Array.isArray(rawIncoming?.results)
          ? rawIncoming.results
          : [];
    return {
      all: items.length,
      farmer: items.filter((item: any) => isFarmerPackedIncoming(item)).length,
      warehouse: items.filter((item: any) => !isFarmerPackedIncoming(item)).length,
    };
  }, [incomingData]);

  const incomingList = useMemo(() => {
    const rawIncoming = incomingData?.data?.incoming;
    const items: any[] = Array.isArray(rawIncoming)
      ? rawIncoming
      : Array.isArray(rawIncoming?.items)
        ? rawIncoming.items
        : Array.isArray(rawIncoming?.results)
          ? rawIncoming.results
          : [];
    const query = searchTerm.trim().toLowerCase();

    const readableItems = items
      .map((item: any) => ({
        ...item,
        displayFarmName: getFarmDisplayName(item),
        displayProductName: getProductDisplayName(item),
        displayOrderNumber: humanIdFallback(item.orderNumber || item.order?.orderNumber, "Order reference unavailable"),
      }))
      .filter((item: any) => {
        if (fulfillmentFilter === "farmer") return isFarmerPackedIncoming(item);
        if (fulfillmentFilter === "warehouse") return !isFarmerPackedIncoming(item);
        return true;
      })
      .filter((item: any) => matchesIncomingDateFilter(item, dateFilter))
      .filter((item: any) =>
        !query || [
          item.displayFarmName, item.displayProductName, item.displayOrderNumber,
          item.pickupLocation?.address, item.batchNumber, statusLabels[item.status] || item.status,
        ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query))
      );

    // Keep work that still needs a warehouse action at the top. Shipments whose
    // receipt is complete appear after pending receipt/inspection work.
    const stagePriority = (item: any) => {
      if (["scheduled", "in_transit", "ready_for_pickup"].includes(String(item.status))) return 0;
      if (item.status === "received") return 1;
      if (item.status === "quality_check") return 2;
      if (item.status === "stored") return 3;
      if (item.status === "rejected") return 4;
      return 5;
    };
    return readableItems.sort((a: any, b: any) =>
      stagePriority(a) - stagePriority(b) ||
      new Date(a.expectedDate || a.createdAt || 0).getTime() - new Date(b.expectedDate || b.createdAt || 0).getTime()
    );
  }, [incomingData, searchTerm, fulfillmentFilter, dateFilter]);



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
    setBulkQualityChecks(Object.fromEntries(items.map((item) => [item.id, "passed" as const])));
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
    if (mismatches.length && !window.confirm(String(mismatches.length) + " order(s) have a weight difference. they will remain on hold. Continue?")) return;
    setIsSaving(true); let succeeded = 0;
    try {
      for (const item of bulkFarmItems) {
        const measured = Number(bulkMeasuredQuantities[item.id]);
        const mismatch = Math.abs(measured - Number(item.quantity || 0)) > 0.001;
        const qualityCheck = mismatch ? "pending" : (bulkQualityChecks[item.id] || "passed");
        await api.put("/warehouse/me/incoming/" + item.id + "/receive", undefined, { params: { quantity: measured, usableQuantity: measured, quality_check: qualityCheck, notes: bulkReceiveNotes.trim() || undefined } });
        succeeded++;
      }
      toast.success("Received " + succeeded + " shipment(s). Passed stock can continue to Store; failed stock is held for farm follow-up; weight discrepancies remain on hold.");
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

  const printIncomingPackingReceipt = (item: any, receivedQuantity: number, usableQuantity: number) => {
    const win = window.open("", "_blank", "width=800,height=900");
    if (!win) {
      toast.error("Allow pop-ups to print the packing receipt. The receipt was saved.");
      return;
    }
    const escapeHtml = (value: unknown) => String(value ?? "—").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[char] as string));
    const order = item?.order || {};
    const lines = Array.isArray(item?.orderItems) ? item.orderItems
      : Array.isArray(order?.items) ? order.items
      : Array.isArray(item?.items) ? item.items
      : [];
    const receiptLines = lines.length ? lines.map((line: any) => ({
      name: line.productName || line.name || line.product?.name || line.productId || "Product",
      quantity: line.quantity ?? line.quantityRequired ?? line.orderedQuantity ?? "—",
      unit: line.unit || "kg",
    })) : [{
      name: item?.displayProductName || item?.productName || item?.product?.name || item?.productId || "Product",
      quantity: item?.orderQuantity ?? item?.quantityRequired ?? receivedQuantity,
      unit: item?.unit || "kg",
    }];
    const receiptNumber = item?.receiptNumber || item?.batchNumber || item?.id || "—";
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>Warehouse Packing Receipt</title>
      <style>body{font-family:Arial,sans-serif;color:#111;padding:28px;max-width:760px;margin:auto}h1{margin-bottom:4px;font-size:24px}.muted{color:#555;font-size:12px}.panel{border:1px solid #777;padding:14px;margin-top:16px}.row{display:flex;justify-content:space-between;gap:20px;padding:10px 4px;border-bottom:1px solid #ddd}.row:last-child{border-bottom:0}.notice{margin-top:18px;padding:12px;background:#f3f4f6;font-size:13px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{text-align:left;border-bottom:1px solid #ccc;padding:10px}th:last-child,td:last-child{text-align:right}.sign{display:flex;justify-content:space-between;margin-top:42px;font-size:12px}</style></head><body>
      <h1>AGRICONNECT</h1><div class="muted">WAREHOUSE RECEIPT · PACKING TEAM COPY</div>
      <div class="panel"><div class="row"><strong>Order number</strong><span>${escapeHtml(item?.displayOrderNumber || item?.orderNumber || order?.orderNumber || item?.orderId)}</span></div>
      <div class="row"><strong>Receipt / batch reference</strong><span>${escapeHtml(receiptNumber)}</span></div>
      <div class="row"><strong>Farm</strong><span>${escapeHtml(item?.displayFarmName || item?.farmName || item?.farmerName)}</span></div>
      <div class="row"><strong>Received quantity</strong><span>${escapeHtml(receivedQuantity)} ${escapeHtml(item?.unit || "kg")}</span></div>
      <div class="row"><strong>Usable quantity for packing</strong><span>${escapeHtml(usableQuantity)} ${escapeHtml(item?.unit || "kg")}</span></div></div>
      <h2>Products to pack for this order</h2><table><thead><tr><th>Product</th><th>Order quantity</th></tr></thead><tbody>${receiptLines.map((line: any) => `<tr><td>${escapeHtml(line.name)}</td><td>${escapeHtml(line.quantity)} ${escapeHtml(line.unit)}</td></tr>`).join("")}</tbody></table>
      <div class="notice"><strong>Packing instruction:</strong> Match this receipt to the order and pack the product quantities listed above. Record actual packed quantities and report shortages before verification. Do not use the total received bulk quantity as the quantity for every order.</div>
      <div class="sign"><span>Packed by: __________________</span><span>Checked by: __________________</span></div>
      <script>window.onload=()=>window.print();</script></body></html>`);
    win.document.close();
  };

  const handleReceiveStock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedIncoming?.id) {
      toast.error("Select an incoming shipment first");
      return;
    }
    const expectedQuantity = Number(selectedIncoming.quantity || 0);
    const actualQuantity = Number(receiveForm.quantity || 0);
    const isFarmerPacked = isFarmerPackedIncoming(selectedIncoming);
    const quantityMismatch = Math.abs(actualQuantity - expectedQuantity) > 0.001;
    if (!isFarmerPacked && quantityMismatch && !receiveForm.notes.trim()) {
      toast.error("The weight differs from the farmer's declared quantity. Add a discrepancy note before saving.");
      return;
    }
    if (!isFarmerPacked && quantityMismatch) {
      const accepted = window.confirm("The measured weight differs from the declared quantity. Save the receipt as pending until the discrepancy is resolved?");
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
      if (!isFarmerPacked && !quantityMismatch && receiveForm.qualityCheck === "passed") {
        printIncomingPackingReceipt(selectedIncoming, actualQuantity, Number(receiveForm.usableQuantity));
      }
      if (isFarmerPacked) {
        toast.success("Packed farmer order received. Continue to Farmer Fulfillment Transfers / Consolidation.");
      } else if (quantityMismatch) {
        toast.success("Receipt saved with a quantity discrepancy. Stock remains on hold; contact the farm before storing.");
      } else if (receiveForm.qualityCheck === "passed") {
        toast.success("Receipt and quality check passed. Continue to Store.");
      } else if (receiveForm.qualityCheck === "failed") {
        toast.error("Receipt saved as rejected. Contact the farm about the damaged stock; do not store it.");
      } else {
        toast.success("Receipt saved as pending quality review. It cannot be stored until approved.");
      }
      setShowReceiveDialog(false);
      await refetch();
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

  const openStoreDialog = (item: any) => {
    setSelectedIncoming(item);
    const received = Number(item?.quantityReceived ?? item?.receivedQuantity ?? item?.actualQuantityReceived ?? item?.quantity ?? 0);
    setStoreForm({
      usableQuantity: String(Number(item?.usableQuantity ?? received)),
      storageLocation: String(item?.storageLocation || ""),
      storageType: String(item?.storageType || "ambient"),
    });
    setShowStoreDialog(true);
  };

  const storeAllApprovedShipments = async () => {
    const items = incomingList.filter((item: any) =>
      !isFarmerPackedIncoming(item) &&
      String(item.qualityCheck || "").toLowerCase() === "passed" &&
      item.status !== "stored" &&
      item.status !== "rejected"
    );
    if (!items.length) {
      toast("No quality-approved shipments are waiting to be stored.");
      return;
    }
    const location = window.prompt("Enter the storage location for these approved shipments (you can still store each shipment individually for different locations):");
    if (!location?.trim()) return;
    setIsSaving(true);
    let stored = 0;
    const failures: string[] = [];
    try {
      for (const item of items) {
        try {
          const received = Number(item.quantityReceived ?? item.receivedQuantity ?? item.actualQuantityReceived ?? item.quantity ?? 0);
          const usable = Number(item.usableQuantity ?? received);
          if (!item.id || received <= 0 || usable <= 0 || usable > received) {
            failures.push(item.displayOrderNumber || item.displayProductName || item.id || "Unknown shipment");
            continue;
          }
          await api.put(`/warehouse/me/incoming/${item.id}/store`, {
            usableQuantity: usable,
            storageLocation: location.trim(),
            storageType: item.storageType || "ambient",
          });
          stored += 1;
        } catch {
          failures.push(item.displayOrderNumber || item.displayProductName || item.id || "Unknown shipment");
        }
      }
      if (stored) toast.success(`Stored ${stored} approved shipment(s). Continue to Order Packing.`);
      if (failures.length) toast.error(`${failures.length} shipment(s) could not be stored. Open each shipment to review its location, quantity, or validation errors.`);
      await refetch();
    } finally {
      setIsSaving(false);
    }
  };

  const handleStoreIncoming = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedIncoming?.id) return;
    const received = Number(selectedIncoming?.quantityReceived ?? selectedIncoming?.receivedQuantity ?? selectedIncoming?.actualQuantityReceived ?? selectedIncoming?.quantity ?? 0);
    const usable = Number(storeForm.usableQuantity);
    if (!Number.isFinite(usable) || usable <= 0 || usable > received) {
      toast.error(`Usable quantity must be greater than zero and no more than the ${received} received.`);
      return;
    }
    if (!storeForm.storageLocation.trim()) {
      toast.error("Enter the storage location before confirming storage.");
      return;
    }
    try {
      setIsSaving(true);
      await api.put(`/warehouse/me/incoming/${selectedIncoming.id}/store`, {
        usableQuantity: usable,
        storageLocation: storeForm.storageLocation.trim(),
        storageType: storeForm.storageType,
      });
      toast.success("Stock stored and inventory updated. Continue to Order Packing.");
      setShowStoreDialog(false);
      await refetch();
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
      <Card className="border-slate-200 bg-slate-50/80"><CardContent className="flex gap-3 p-4"><Info className="mt-0.5 h-5 w-5 shrink-0 text-slate-600"/><div className="text-sm"><p className="font-semibold">Two fulfillment workflows</p><p className="mt-1 text-sm leading-6 text-muted-foreground"><b>Farmer Fulfillment:</b> Receive stock → confirm receipt → automatic distance/route split → assign pickup or delivery teams for warehouse/local-hub handoff. Orders are already packed, so skip bulk quality inspection and repacking. <b>Warehouse Fulfillment:</b> Receive stock → Quality Check → Store → pack each order → verify all order items and resolve shortages → dispatch through the warehouse fulfillment workflow.</p></div></CardContent></Card>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="text-3xl font-bold">Incoming Stock</h1><p className="text-muted-foreground">{incomingList.length} incoming shipments · {dateFilter === "today" ? "Today" : dateFilter === "yesterday" ? "Yesterday" : dateFilter === "week" ? "This Week" : dateFilter === "month" ? "This Month" : "All Time"}</p></div>
        <div className="flex flex-wrap items-center gap-2"><Button variant="outline" onClick={storeAllApprovedShipments} disabled={isSaving}><Package className="mr-2 h-4 w-4" />{isSaving ? "Storing..." : "Store All Approved"}</Button><Button asChild variant="outline"><Link href="/packing"><ArrowRight className="mr-2 h-4 w-4"/>Continue to Order Packing</Link></Button><Button asChild><Link href="/warehouse/farmer-fulfillment"><Route className="mr-2 h-4 w-4" />Farmer Fulfillment Transfer</Link></Button><Button asChild variant="outline"><Link href="/collections"><Truck className="mr-2 h-4 w-4" />Farm Collection & Route Planning</Link></Button><Button variant="outline" size="icon" aria-label="Refresh incoming stock" onClick={() => { void refetch(); }}><RefreshCw className="h-4 w-4" /></Button></div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3" role="tablist" aria-label="Incoming stock fulfillment type">
        {([
          { key: "all", label: "All", description: "Every incoming shipment", count: incomingTypeCounts.all },
          { key: "farmer", label: "Farmer Fulfillment", description: "Packed farmer orders", count: incomingTypeCounts.farmer },
          { key: "warehouse", label: "Warehouse Fulfillment", description: "Bulk stock for inventory", count: incomingTypeCounts.warehouse },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={fulfillmentFilter === tab.key}
            onClick={() => setFulfillmentFilter(tab.key)}
            className={cn(
              "rounded-xl border p-4 text-left transition-colors",
              fulfillmentFilter === tab.key
                ? "border-emerald-700 bg-emerald-50 ring-1 ring-emerald-700"
                : "border-slate-200 bg-white hover:border-emerald-300 hover:bg-slate-50"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{tab.label}</span>
              <span className={cn("rounded-full px-2.5 py-1 text-sm font-bold", fulfillmentFilter === tab.key ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-700")}>{tab.count}</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{tab.description}</p>
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <span className="font-semibold">Action-first order:</span> shipments waiting for receipt appear first, followed by receipt/quality work. Orders whose receipt is complete are shown after pending work.
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input placeholder="Search incoming shipments..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" /></div>
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="scheduled">Scheduled</SelectItem><SelectItem value="in_transit">In Transit</SelectItem><SelectItem value="received">Received</SelectItem><SelectItem value="quality_check">Quality Check</SelectItem><SelectItem value="stored">Stored</SelectItem><SelectItem value="rejected">Rejected</SelectItem></SelectContent></Select>
          <Select value={dateFilter} onValueChange={setDateFilter}><SelectTrigger className="w-[150px]"><SelectValue placeholder="Date" /></SelectTrigger><SelectContent><SelectItem value="today">Today</SelectItem><SelectItem value="yesterday">Yesterday</SelectItem><SelectItem value="week">This Week</SelectItem><SelectItem value="month">This Month</SelectItem><SelectItem value="all">All Time</SelectItem></SelectContent></Select>
        </div>
      </div>

      {incomingList.length === 0 ? (
        <Card className="p-12 text-center"><ArrowDown className="mx-auto h-12 w-12 text-muted-foreground" /><h3 className="mt-4 text-lg font-semibold">No incoming shipments</h3><p className="mt-2 text-muted-foreground">{statusFilter !== "all" ? `No ${statusLabels[statusFilter] || statusFilter} shipments` : "Shipments appear here after their farm pickup reaches the warehouse."}</p></Card>
      ) : (
        <div className="space-y-6">{Array.from(incomingList.reduce((groups: Map<string, any[]>, item: any) => { const key = getFarmGroupKey(item); if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(item); return groups; }, new Map<string, any[]>()).entries()).map(([farmKey, farmItems]) => {
          const packedFarmerGroup = farmItems.every((row: any) => isFarmerPackedIncoming(row));
          const expectedTotal = farmItems.reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0);
          const receivedCount = farmItems.filter((row: any) => row.status === "received" || row.status === "stored").length;
          const pendingCount = Math.max(0, farmItems.length - receivedCount);
          const receivedQuantityTotal = farmItems.reduce((sum: number, row: any) => sum + Number(row.quantityReceived ?? ((row.status === "received" || row.status === "stored") ? row.quantity : 0) ?? 0), 0);
          const declaredTotal = farmItems.reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0);
          const eligibleToReceive = farmItems.filter((row: any) => ["scheduled", "in_transit", "ready_for_pickup"].includes(String(row.status || "").toLowerCase()) && Boolean(row.arrivedWarehouseAt || row.warehouseArrivalConfirmed || String(row.collectionStatus || "").toLowerCase() === "arrived_warehouse"));
          const canConfirmAllPackets = packedFarmerGroup && eligibleToReceive.length > 0;
          const canReceiveAllBulk = !packedFarmerGroup && eligibleToReceive.length > 0;
          const allPackedOrdersReceived = packedFarmerGroup && farmItems.every((row: any) => row.status === "received" || row.status === "stored");
          // Incoming Stock is a receipt checkpoint, not the decision point for multi-farm
          // consolidation. Every farmer-packed order continues to the transfer router;
          // the transfer backend decides whether it needs nearby delivery, a local hub,
          // or an inter-district warehouse. Multi-Warehouse Consolidation is reached
          // only from its dedicated bulk/multi-source workflow.
          const farmContinueHref = packedFarmerGroup
            ? "/warehouse/farmer-fulfillment"
            : "/warehouse/multi-warehouse-consolidation";
          const farmContinueLabel = packedFarmerGroup
            ? "Farmer Fulfillment Transfer"
            : "Multi-Warehouse Consolidation";
          const confirmAllPackets = async () => {
            if (!window.confirm(`Confirm receipt of ${eligibleToReceive.length} eligible packed orders from ${farmItems[0].displayFarmName}? Only continue after physically counting every packet. Orders not yet physically arrived will remain pending.`)) return;
            setIsSaving(true);
            let succeeded = 0;
            try {
              for (const row of eligibleToReceive) {
                if (!row.id || !["scheduled", "in_transit", "ready_for_pickup"].includes(String(row.status || "").toLowerCase()) || !(row.arrivedWarehouseAt || row.warehouseArrivalConfirmed || String(row.collectionStatus || "").toLowerCase() === "arrived_warehouse")) continue;
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
          return <section key={farmKey} className="overflow-hidden rounded-xl border bg-white shadow-sm"><div className="border-b bg-slate-50/80 px-4 py-4 sm:px-5"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold tracking-tight">{farmItems[0].displayFarmName}</h2><Badge variant="outline">{packedFarmerGroup ? "Farmer Fulfillment · Packed orders" : "Normal Warehouse Fulfillment · Bulk stock"}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{farmItems[0].pickupLocation?.address || farmItems[0].farmAddress || "Farm address not available"}</p></div><div className="flex flex-wrap items-center gap-2">{canConfirmAllPackets && <Button size="sm" onClick={confirmAllPackets} disabled={isSaving}><CheckCircle className="mr-2 h-4 w-4" />{isSaving ? "Confirming..." : "Confirm All Packets Received"}</Button>}{allPackedOrdersReceived && <Button size="sm" onClick={() => { window.location.href = farmContinueHref; }}><ArrowRight className="mr-2 h-4 w-4" />Continue Farm Orders to {farmContinueLabel}</Button>}{canReceiveAllBulk && <Button size="sm" onClick={() => openBulkReceiveDialog(eligibleToReceive)} disabled={isSaving}><Package className="mr-2 h-4 w-4" />Receive All Bulk Stock</Button>}</div></div><div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4"><div className="rounded-lg border bg-white p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total orders</p><p className="mt-1 text-2xl font-semibold">{farmItems.length}</p></div><div className="rounded-lg border bg-white p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{packedFarmerGroup ? "Packed packets" : "Farmer-declared weight"}</p><p className="mt-1 text-2xl font-semibold">{packedFarmerGroup ? farmItems.length : declaredTotal.toLocaleString() + " kg"}</p></div><div className="rounded-lg border bg-white p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Received</p><p className="mt-1 text-2xl font-semibold">{receivedCount}</p><p className="text-xs text-muted-foreground">{packedFarmerGroup ? "packets received" : receivedQuantityTotal.toLocaleString() + " kg recorded"}</p></div><div className="rounded-lg border bg-white p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Remaining</p><p className="mt-1 text-2xl font-semibold">{pendingCount}</p><p className="text-xs text-muted-foreground">{packedFarmerGroup ? "packets to receive" : Math.max(0, declaredTotal - receivedQuantityTotal).toLocaleString() + " kg to reconcile"}</p></div></div></div><div className="space-y-3 p-3 sm:p-4">{farmItems.map((item: any) => {
          const productName = item.displayProductName || getProductDisplayName(item);
          const isPackedFarmerTransfer = isFarmerPackedIncoming(item);
          const hasPhysicallyArrived = Boolean(item.arrivedWarehouseAt || item.warehouseArrivalConfirmed || String(item.collectionStatus || "").toLowerCase() === "arrived_warehouse");
          const receivedQuantity = Number(item.quantityReceived ?? item.receivedQuantity ?? item.actualQuantityReceived ?? 0);
          const expectedQuantity = Number(item.quantity ?? 0);
          const receiptComplete = ["received", "quality_check", "stored", "rejected"].includes(String(item.status || "").toLowerCase()) ||
            Boolean(item.receivedAt || item.receivedDate || item.warehouseReceivedAt) ||
            (expectedQuantity > 0 && receivedQuantity >= expectedQuantity - 0.001);
          // Once the receipt is complete or quality has been approved, never
          // show Receive Stock again. Show the next outstanding workflow action.
          const canReceiveStock = ["scheduled", "in_transit", "ready_for_pickup"].includes(String(item.status || "").toLowerCase()) &&
            hasPhysicallyArrived &&
            !receiptComplete &&
            String(item.qualityCheck || "").toLowerCase() !== "passed";
          // Ordinary packed farmer orders always continue to Farmer Fulfillment Transfers.
          // Only records explicitly linked to a multi-source consolidation go to Consolidation.
          // A packed farmer-fulfillment order is always routed by the transfer
          // classifier. Consolidation is a separate bulk, multi-farm workflow.
          const requiresConsolidation = !isPackedFarmerTransfer && Boolean(
            item.consolidationId ||
            item.consolidationGroupId ||
            item.isMultiWarehouseConsolidation === true
          );
          // Use the actual warehouse sidebar routes (the (warehouse) route group
          // does not add a URL segment, but the nested /warehouse page does).
          const nextPage = isPackedFarmerTransfer
            ? (requiresConsolidation ? "/warehouse/multi-warehouse-consolidation" : "/warehouse/farmer-fulfillment")
            : "/stock";
          return (
            <Card key={item.id}><CardContent className="p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-3"><div><p className="font-semibold">{productName}</p><p className="mt-1 text-sm text-muted-foreground">Order: {item.displayOrderNumber || "Order reference unavailable"}</p></div><Badge variant="outline" className={cn("border", statusColors[item.status as keyof typeof statusColors])}>{statusLabels[item.status as keyof typeof statusLabels] || item.status}</Badge>{item.qualityCheck === "passed" && <Badge variant="success">Passed QC</Badge>}{item.qualityCheck === "failed" && <Badge variant="destructive">Failed QC</Badge>}</div><div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted-foreground"><span>From farm: {item.displayFarmName || "Farm details unavailable"}</span><span>Quantity: <span className="font-medium text-foreground">{item.quantity}</span></span><span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Expected: {formatDate(item.expectedDate)}</span></div>{item.batchNumber && <p className="mt-1 text-sm text-muted-foreground">Batch: {item.batchNumber}</p>}{item.qualityNotes && <p className="mt-1 text-sm text-yellow-600">{item.qualityNotes}</p>}</div><div className="flex items-center gap-2">{item.status === "scheduled" && <Button size="sm" variant="outline" onClick={() => { setSelectedIncoming(item); setShowTrackDialog(true); }}><Clock className="mr-2 h-4 w-4" />Track</Button>}{canReceiveStock && <Button size="sm" onClick={() => openReceiveDialog(item)}><CheckCircle className="mr-2 h-4 w-4" />Receive Stock</Button>}
                      {isPackedFarmerTransfer && !hasPhysicallyArrived && <Badge variant="outline" className="border-amber-300 text-amber-700">Awaiting Farm Pickup / Arrival</Badge>}
                      {isPackedFarmerTransfer && (item.status === "received" || item.status === "stored") && <Button size="sm" onClick={() => { window.location.href = nextPage; }}><ArrowRight className="mr-2 h-4 w-4" />{requiresConsolidation ? "Continue to Consolidation" : "Continue to Farmer Fulfillment Transfers"}</Button>}{!isPackedFarmerTransfer && receiptComplete && String(item.qualityCheck || "pending").toLowerCase() !== "passed" && String(item.qualityCheck || "").toLowerCase() !== "failed" && <Badge variant="outline">On hold · resolve receipt discrepancy</Badge>}{!isPackedFarmerTransfer && receiptComplete && String(item.qualityCheck || "").toLowerCase() === "passed" && <Button size="sm" onClick={() => openStoreDialog(item)} disabled={isSaving}><Package className="mr-2 h-4 w-4" />Continue to Store</Button>}{!isPackedFarmerTransfer && item.status === "stored" && item.orderId && <Button size="sm" onClick={() => { window.location.href = "/packing"; }}><ArrowRight className="mr-2 h-4 w-4" />Continue to Order Packing</Button>}{!isPackedFarmerTransfer && item.status === "stored" && !item.orderId && <Button size="sm" variant="outline" onClick={() => { window.location.href = "/stock"; }}><Warehouse className="mr-2 h-4 w-4" />View Inventory</Button>}{item.status === "quality_check" && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => openQualityDialog(item)}><XCircle className="mr-2 h-4 w-4" />Inspect</Button></div>}<div className="relative">
                        <Button type="button" variant="ghost" size="icon" aria-label={`Actions for ${productName}`} aria-expanded={openMenuId === item.id} onClick={() => setOpenMenuId((current) => current === item.id ? null : item.id)}><MoreVertical className="h-4 w-4" /></Button>
                        {openMenuId === item.id && <div className="absolute right-0 top-10 z-20 min-w-44 rounded-md border bg-background p-1 shadow-lg">
                          <button type="button" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { setSelectedIncoming(item); setShowTrackDialog(true); setOpenMenuId(null); }}>View shipment details</button>
                          {canReceiveStock && <button type="button" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { openReceiveDialog(item); setOpenMenuId(null); }}>Receive stock</button>}
                          {!isPackedFarmerTransfer && receiptComplete && String(item.qualityCheck || "pending").toLowerCase() !== "passed" && String(item.qualityCheck || "").toLowerCase() !== "failed" && <div className="px-3 py-2 text-xs text-muted-foreground">On hold until the receipt discrepancy is resolved.</div>}
                          {!isPackedFarmerTransfer && receiptComplete && String(item.qualityCheck || "").toLowerCase() === "passed" && <button type="button" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { openStoreDialog(item); setOpenMenuId(null); }}>Continue to Store</button>}
                          {!isPackedFarmerTransfer && item.status === "stored" && item.orderId && <button type="button" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { window.location.href = "/packing"; setOpenMenuId(null); }}>Continue to Order Packing</button>}
                          <button type="button" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { void refetch(); setOpenMenuId(null); }}>Refresh status</button>
                        </div>}
                      </div></div></div></CardContent></Card>
          );
        })}</div></section>;
        })}</div>
      )}

      <Dialog open={showBulkReceiveDialog} onOpenChange={setShowBulkReceiveDialog}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Receive All Bulk Stock — {bulkFarmItems[0]?.displayFarmName || "Farm"}</DialogTitle><DialogDescription>Enter actual measured weight and select quality result for every shipment, just like individual Receive Stock. Passed stock can continue to Store; failed stock is held for farm follow-up. Weight mismatches remain on hold.</DialogDescription></DialogHeader>
          <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-sm"><div><p className="text-muted-foreground">Orders</p><p className="text-lg font-bold">{bulkFarmItems.length}</p></div><div><p className="text-muted-foreground">Declared total</p><p className="text-lg font-bold">{bulkFarmItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0).toLocaleString()} kg</p></div><div><p className="text-muted-foreground">Measured total</p><p className="text-lg font-bold">{bulkFarmItems.reduce((sum, item) => sum + Number(bulkMeasuredQuantities[item.id] || 0), 0).toLocaleString()} kg</p></div></div>
          <form className="space-y-4" onSubmit={handleBulkReceive}>
            <div className="space-y-3">{bulkFarmItems.map((item) => <div key={item.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_150px] sm:items-center"><div><p className="font-semibold">{item.displayProductName || getProductDisplayName(item)}</p><p className="text-sm text-muted-foreground">Order {item.displayOrderNumber || "reference unavailable"} · Farmer declared: {item.quantity} {item.unit || "kg"}</p><p className={cn("mt-1 text-sm font-medium", Math.abs(Number(bulkMeasuredQuantities[item.id] || 0) - Number(item.quantity || 0)) > 0.001 ? "text-red-600" : "text-emerald-700")}>Difference: {(Number(bulkMeasuredQuantities[item.id] || 0) - Number(item.quantity || 0)).toFixed(2)} kg</p></div><div><label className="text-sm font-medium">Actual measured kg</label><Input type="number" min="0.01" step="0.01" value={bulkMeasuredQuantities[item.id] ?? ""} onChange={(e) => setBulkMeasuredQuantities((current) => ({ ...current, [item.id]: e.target.value }))} required /></div><div><label className="text-sm font-medium">Quality inspection</label><Select value={bulkQualityChecks[item.id] || "passed"} onValueChange={(value) => setBulkQualityChecks((current) => ({ ...current, [item.id]: value as "passed" | "failed" }))}><SelectTrigger><SelectValue placeholder="Select result" /></SelectTrigger><SelectContent><SelectItem value="passed">Passed — safe to store</SelectItem><SelectItem value="failed">Failed — damaged / reject</SelectItem></SelectContent></Select></div></div>)}</div>
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

      <Dialog open={showStoreDialog} onOpenChange={setShowStoreDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Storage</DialogTitle>
            <DialogDescription>Confirm the usable quantity and physical storage location. Only quality-approved stock can be added to warehouse inventory.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleStoreIncoming}>
            <div className="rounded-lg border bg-slate-50 p-3 text-sm">
              <p className="font-semibold">{selectedIncoming?.displayProductName || getProductDisplayName(selectedIncoming || {})}</p>
              <p className="mt-1 text-muted-foreground">Received: {Number(selectedIncoming?.quantityReceived ?? selectedIncoming?.receivedQuantity ?? selectedIncoming?.actualQuantityReceived ?? selectedIncoming?.quantity ?? 0)} {selectedIncoming?.unit || "kg"}</p>
              <p className="mt-1 text-muted-foreground">Quality: {String(selectedIncoming?.qualityCheck || "pending").toUpperCase()}</p>
            </div>
            <div>
              <label className="text-sm font-medium">Usable quantity</label>
              <Input type="number" min="0.01" max={Number(selectedIncoming?.quantityReceived ?? selectedIncoming?.receivedQuantity ?? selectedIncoming?.actualQuantityReceived ?? selectedIncoming?.quantity ?? 0)} step="0.01" value={storeForm.usableQuantity} onChange={(e) => setStoreForm((current) => ({ ...current, usableQuantity: e.target.value }))} required />
            </div>
            <div>
              <label className="text-sm font-medium">Storage location / bin</label>
              <Input placeholder="e.g. Cold Room A · Rack 02 · Bin 04" value={storeForm.storageLocation} onChange={(e) => setStoreForm((current) => ({ ...current, storageLocation: e.target.value }))} required />
            </div>
            <div>
              <label className="text-sm font-medium">Storage condition</label>
              <Select value={storeForm.storageType} onValueChange={(value) => setStoreForm((current) => ({ ...current, storageType: value }))}>
                <SelectTrigger><SelectValue placeholder="Choose storage condition" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ambient">Ambient / General</SelectItem>
                  <SelectItem value="cold">Cold Storage</SelectItem>
                  <SelectItem value="refrigerated">Refrigerated</SelectItem>
                  <SelectItem value="frozen">Frozen</SelectItem>
                  <SelectItem value="dry">Dry Storage</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowStoreDialog(false)} disabled={isSaving}>Cancel</Button>
              <Button type="submit" disabled={isSaving}>{isSaving ? "Storing..." : "Confirm Store Stock"}</Button>
            </div>
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
          <DialogHeader><DialogTitle>{isFarmerPackedIncoming(selectedIncoming) ? "Confirm Packed Order Receipt" : "Receive Stock & Quality Check"}</DialogTitle><DialogDescription>{selectedIncoming?.sourceMode === "farmer_fulfillment_transfer" ? "Verify the quantity physically received. This order is already packed, so bulk quality inspection and repacking are skipped." : "Record the actual quantity and complete the quality check here. If quality passes, save and print the receipt for the packing team, then continue to Store. Failed stock stays on hold."}</DialogDescription></DialogHeader>
          <form className="space-y-4" onSubmit={handleReceiveStock}>
            <div className="rounded-lg border bg-slate-50 p-3 text-sm"><p className="font-medium">Farmer declared quantity: {selectedIncoming?.quantity ?? "—"} {selectedIncoming?.unit || "kg"}</p><p className="mt-1 text-muted-foreground">{selectedIncoming?.sourceMode === "farmer_fulfillment_transfer" ? "Count the sealed packets and confirm the number of packed orders received." : "Weigh the bulk stock on the warehouse scale and enter the measured quantity below."}</p></div>
            <div><label className="text-sm font-medium">{selectedIncoming?.sourceMode === "farmer_fulfillment_transfer" ? "Received packet quantity / order units" : "Actual weight measured at warehouse (kg)"}</label><Input type="number" min="0.01" step="0.01" value={receiveForm.quantity} onChange={(event) => updateReceiveForm("quantity", event.target.value)} className="mt-1" required /><p className="mt-1 text-xs text-muted-foreground">Difference: {(Number(receiveForm.quantity || 0) - Number(selectedIncoming?.quantity || 0)).toFixed(2)} {selectedIncoming?.unit || "kg"}</p></div>
            <div><label className="text-sm font-medium">Usable Quantity for Packing</label><Input type="number" min="0" max={receiveForm.quantity} step="0.01" value={receiveForm.usableQuantity} onChange={(event) => updateReceiveForm("usableQuantity", event.target.value)} className="mt-1" required /><p className="mt-1 text-xs text-muted-foreground">A quantity mismatch requires a note and keeps the receipt pending. Failed stock is rejected and must not be stored.</p></div>
            {!isFarmerPackedIncoming(selectedIncoming) && <div>
              <label className="text-sm font-medium">Quality Result</label>
              <Select value={receiveForm.qualityCheck} onValueChange={(value) => updateReceiveForm("qualityCheck", value)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select quality result" /></SelectTrigger>
                <SelectContent><SelectItem value="passed">Passed — continue to Store</SelectItem><SelectItem value="pending">Pending — hold for review</SelectItem><SelectItem value="failed">Failed — contact farm</SelectItem></SelectContent>
              </Select>
            </div>}
            {selectedIncoming?.sourceMode === "farmer_fulfillment_transfer" && <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">After receipt, continue to Farmer Fulfillment Transfers / Multi-Warehouse Consolidation. Storage is optional and this order will not enter bulk inventory.</p>}
            <div><label className="text-sm font-medium">Notes</label><Input value={receiveForm.notes} onChange={(event) => updateReceiveForm("notes", event.target.value)} className="mt-1" /></div>
            <div className="flex justify-end gap-2 pt-4"><Button type="button" variant="outline" onClick={() => setShowReceiveDialog(false)}>Cancel</Button><Button type="submit" disabled={isSaving}>{isSaving ? "Saving..." : "Save & Print Receipt"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
