"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
import { WarehousePageHeader } from "../../components/warehouse/warehouse-page-header";
import { QRCodeSVG } from "qrcode.react";

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
  quality_check: "Quality Check Pending",
  stored: "Approved (Quality Passed)",
  rejected: "Rejected",
};

const humanIdFallback = (value: any, label: string) => {
  if (!value) return label;
  const text = String(value);
  return /^[a-f0-9]{24}$/i.test(text) ? label : text;
};

const isEventFulfillmentIncoming = (item: any) => {
  const sourceMode = String(item?.sourceMode || "").trim().toLowerCase();
  const collectionType = String(item?.collectionType || "").trim().toLowerCase();
  return sourceMode === "event_fulfillment_transfer" ||
    collectionType === "event_fulfillment_transfer" ||
    Boolean(item?.eventFulfillmentId || item?.eventRequestId || item?.eventOrderNumber);
};

const getFarmGroupKey = (item: any) =>
  (isEventFulfillmentIncoming(item)
    ? "event-fulfillment:"
    : isFarmerPackedIncoming(item) ? "farmer-fulfillment:" : "warehouse-fulfillment:") +
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
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(5);
  const [fulfillmentFilter, setFulfillmentFilter] = useState<"all" | "received_warehouse" | "farmer" | "warehouse">("all");
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [showReceiveDialog, setShowReceiveDialog] = useState(false);
  const [showQualityDialog, setShowQualityDialog] = useState(false);
  const [showStoreDialog, setShowStoreDialog] = useState(false);
  const [storeForm, setStoreForm] = useState({ usableQuantity: "", storageLocation: "", storageType: "ambient" });
  const [bulkStoreItems, setBulkStoreItems] = useState<any[]>([]);
  const [bulkStoreForm, setBulkStoreForm] = useState({ storageLocation: "", storageType: "ambient", usableQuantities: {} as Record<string, string> });
  const [showBulkStoreDialog, setShowBulkStoreDialog] = useState(false);
  const [bulkStoreErrors, setBulkStoreErrors] = useState<string[]>([]);
  const [showTrackDialog, setShowTrackDialog] = useState(false);
  const [showReceiptDialog, setShowReceiptDialog] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [incomingForm, setIncomingForm] = useState(emptyIncomingForm);
  const [receiveForm, setReceiveForm] = useState(emptyReceiveForm);
  const [selectedIncoming, setSelectedIncoming] = useState<any>(null);
  const [selectedIncomingId, setSelectedIncomingId] = useState<string | null>(null);
  const [selectedIncomingIds, setSelectedIncomingIds] = useState<string[]>([]);
  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null);
  const [qualityNotes, setQualityNotes] = useState("");
  const [showBulkReceiveDialog, setShowBulkReceiveDialog] = useState(false);
  const [bulkFarmItems, setBulkFarmItems] = useState<any[]>([]);
  const [bulkMeasuredTotal, setBulkMeasuredTotal] = useState("");
  const [bulkQualityResult, setBulkQualityResult] = useState<"passed" | "pending" | "failed">("passed");
  const [bulkReceiveNotes, setBulkReceiveNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [transferActionBusy, setTransferActionBusy] = useState<string | null>(null);
  const [farmLabelPrintItems, setFarmLabelPrintItems] = useState<any[]>([]);
  const farmLabelPrintWindowRef = useRef<Window | null>(null);

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

  const { data: transferPayload, isLoading: isLoadingTransfers } = useQuery({
    queryKey: ["incomingStockInterDistrictTransfers"],
    queryFn: () => api.get("/warehouse/me/farmer-fulfillment-transfers"),
    refetchInterval: 15000,
  });
  const receivedWarehouseOrders = useMemo(() => {
    const raw = transferPayload?.data?.transfers ?? transferPayload?.transfers ?? [];
    const rows: any[] = Array.isArray(raw) ? raw : [];
    return rows.filter((row: any) => {
      const role = String(row.currentWarehouseRole || "").toLowerCase();
      return role === "destination";
    });
  }, [transferPayload]);
  const handleInboundTransferAction = async (order: any, action: "receive" | "hub") => {
    const id = String(order.id || order.orderId || order._id || "");
    if (!id) { toast.error("Transfer is missing its order identifier."); return; }
    const key = id + ":" + action;
    try {
      setTransferActionBusy(key);
      const endpoint = action === "receive" ? "receive-at-destination" : "handoff-local-hub";
      await api.post("/warehouse/me/farmer-fulfillment/" + id + "/" + endpoint);
      toast.success(action === "receive" ? "Destination warehouse receipt confirmed." : "Order sent to the local hub.");
      await refetch();
    } catch (error: any) { toast.error(error?.message || (action === "receive" ? "Could not confirm destination receipt." : "Could not send order to local hub.")); }
    finally { setTransferActionBusy(null); }
  };
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
      received_warehouse: receivedWarehouseOrders.length,
      farmer: items.filter((item: any) => isFarmerPackedIncoming(item)).length,
      warehouse: items.filter((item: any) => !isFarmerPackedIncoming(item)).length,
    };
  }, [incomingData, receivedWarehouseOrders]);

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
        displayOrderNumber: humanIdFallback(
          item.orderNumber || item.order_number || item.order?.orderNumber ||
          item.eventOrderNumber || item.event_order_number ||
          item.requestNumber || item.request_number ||
          item.eventRequest?.requestNumber || item.eventRequest?.orderNumber,
          (item.eventRequestId || item.event_request_id)
            ? "EVENT-" + String(item.eventRequestId || item.event_request_id).slice(-6).toUpperCase()
            : (item.eventFulfillmentId || item.event_fulfillment_id)
              ? "EVENT-" + String(item.eventFulfillmentId || item.event_fulfillment_id).slice(-6).toUpperCase()
              : (item.orderId || item.order_id)
                ? "ORDER-" + String(item.orderId || item.order_id).slice(-6).toUpperCase()
                : "RECEIPT-" + String(item.incomingStockId || item.incoming_stock_id || item.id || item._id || "UNKNOWN").slice(-6).toUpperCase()
        ),
      }))
      .filter((item: any) => {
        if (fulfillmentFilter === "received_warehouse") return false;
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

  const selectedIncomingRow =
    incomingList.find((item: any) => String(item.id || item._id) === selectedIncomingId) ||
    incomingList[0] ||
    null;
  const selectedTransfer =
    receivedWarehouseOrders.find((item: any) => String(item.id || item.orderId || item._id) === selectedTransferId) ||
    receivedWarehouseOrders[0] ||
    null;
  const selectedFarmItems = selectedIncomingRow
    ? incomingList.filter((item: any) => getFarmGroupKey(item) === getFarmGroupKey(selectedIncomingRow))
    : [];
  const selectedEligibleToReceive = selectedFarmItems.filter((item: any) => {
    const status = String(item.status || "").toLowerCase();
    const alreadyReceived = ["received", "quality_check", "stored", "rejected", "packed", "completed"].includes(status) ||
      Boolean(item.receivedAt || item.receivedDate || item.warehouseReceivedAt) ||
      String(item.qualityCheck || item.quality_check || "").toLowerCase() === "passed";
    return ["scheduled", "in_transit", "ready_for_pickup"].includes(status) &&
      Boolean(item.arrivedWarehouseAt || item.warehouseArrivalConfirmed || String(item.collectionStatus || "").toLowerCase() === "arrived_warehouse") &&
      !alreadyReceived;
  });
  const selectedBatchItems = incomingList.filter((item: any) => selectedIncomingIds.includes(String(item.id || item._id)));
  const selectedBatchType = selectedBatchItems.length ? isFarmerPackedIncoming(selectedBatchItems[0]) : null;
  const batchEligibleItems = selectedBatchItems.filter((item: any) => {
    const status = String(item.status || "").toLowerCase();
    const arrived = Boolean(item.arrivedWarehouseAt || item.warehouseArrivalConfirmed || String(item.collectionStatus || "").toLowerCase() === "arrived_warehouse");
    const received = ["received", "quality_check", "stored", "rejected", "packed", "completed"].includes(status) || Boolean(item.receivedAt || item.receivedDate || item.warehouseReceivedAt);
    return arrived && !received && ["scheduled", "in_transit", "ready_for_pickup"].includes(status) && isFarmerPackedIncoming(item) === selectedBatchType;
  });
  const canSelectForBatchReceipt = (item: any) => {
    const status = String(item.status || "").toLowerCase();
    const arrived = Boolean(item.arrivedWarehouseAt || item.warehouseArrivalConfirmed || String(item.collectionStatus || "").toLowerCase() === "arrived_warehouse");
    const received = ["received", "quality_check", "stored", "rejected", "packed", "completed"].includes(status) ||
      Boolean(item.receivedAt || item.receivedDate || item.warehouseReceivedAt) ||
      String(item.qualityCheck || item.quality_check || "").toLowerCase() === "passed";
    return arrived && !received && ["scheduled", "in_transit", "ready_for_pickup"].includes(status);
  };
  const toggleIncomingSelection = (id: string) => {
    const item = incomingList.find((row: any) => String(row.id || row._id) === id);
    if (!item || !canSelectForBatchReceipt(item)) return;
    setSelectedIncomingIds((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      const existing = incomingList.find((row: any) => current.includes(String(row.id || row._id)));
      if (existing && isFarmerPackedIncoming(existing) !== isFarmerPackedIncoming(item)) {
        toast.error("Select orders from one fulfillment type at a time.");
        return current;
      }
      return [...current, id];
    });
  };
  const toggleAllVisibleIncoming = () => {
    const selectedType = selectedBatchType;
    const eligibleVisible = incomingList
      .filter((item: any) => canSelectForBatchReceipt(item))
      .filter((item: any) => selectedType === null || isFarmerPackedIncoming(item) === selectedType)
      .map((item: any) => String(item.id || item._id));
    if (!eligibleVisible.length) {
      toast.error("There are no arrived, unreceived shipments available for batch receipt.");
      return;
    }
    setSelectedIncomingIds((current) => eligibleVisible.every((id) => current.includes(id))
      ? current.filter((id) => !eligibleVisible.includes(id))
      : Array.from(new Set([...current, ...eligibleVisible])));
  };
  const handleBatchFarmerReceipt = async () => {
    const eligible = batchEligibleItems.filter((item: any) => isFarmerPackedIncoming(item));
    if (!eligible.length) { toast.error("Select arrived, packed farmer orders that are awaiting warehouse receipt."); return; }
    if (!window.confirm("Confirm warehouse receipt for " + eligible.length + " selected packed farmer orders? This will process each selected order without a second quality inspection or repacking.")) return;
    setIsSaving(true);
    let succeeded = 0;
    try {
      for (const item of eligible) {
        const id = String(item.id || item._id);
        await api.put("/warehouse/me/incoming/" + id + "/receive", undefined, { params: { quantity: Number(item.quantity || 0), usableQuantity: Number(item.quantity || 0), quality_check: "pending", notes: "Batch warehouse receipt confirmed. Awaiting warehouse quality inspection." } });
        succeeded += 1;
      }
      toast.success("Warehouse receipt confirmed for " + succeeded + " farmer orders.");
      setSelectedIncomingIds([]);
      await refetch();
    } catch (error: any) {
      toast.error("Receipt completed for " + succeeded + " of " + eligible.length + " selected orders. " + (error?.response?.data?.detail || error?.message || "Refresh and review before retrying."));
      await refetch();
    } finally { setIsSaving(false); }
  };
  const selectedPackedFarmer = selectedIncomingRow ? isFarmerPackedIncoming(selectedIncomingRow) : false;
  const selectedStatus = String(selectedIncomingRow?.status || "").toLowerCase();
  const selectedPhysicallyArrived = Boolean(selectedIncomingRow?.arrivedWarehouseAt || selectedIncomingRow?.warehouseArrivalConfirmed || String(selectedIncomingRow?.collectionStatus || "").toLowerCase() === "arrived_warehouse");
  const selectedReceiptComplete = selectedIncomingRow ? (
    ["received", "quality_check", "stored", "rejected"].includes(selectedStatus) ||
    Boolean(selectedIncomingRow.receivedAt || selectedIncomingRow.receivedDate || selectedIncomingRow.warehouseReceivedAt) ||
    (Number(selectedIncomingRow.quantity || 0) > 0 && Number(selectedIncomingRow.quantityReceived ?? selectedIncomingRow.receivedQuantity ?? selectedIncomingRow.actualQuantityReceived ?? 0) >= Number(selectedIncomingRow.quantity || 0) - 0.001)
  ) : false;
  const selectedQualityPassed = selectedIncomingRow ? isReceiptQualityPassed(selectedIncomingRow) : false;
  const selectedCanReceive = Boolean(selectedIncomingRow && ["scheduled", "in_transit", "ready_for_pickup"].includes(selectedStatus) && selectedPhysicallyArrived && !selectedReceiptComplete);
  const selectedCanQualityCheck = Boolean(selectedIncomingRow && selectedReceiptComplete && !selectedQualityPassed && selectedStatus !== "rejected" && ["received", "quality_check"].includes(selectedStatus));
  useEffect(() => {
    if (fulfillmentFilter === "received_warehouse") {
      if (!receivedWarehouseOrders.some((item: any) => String(item.id || item.orderId || item._id) === selectedTransferId)) {
        setSelectedTransferId(receivedWarehouseOrders[0] ? String(receivedWarehouseOrders[0].id || receivedWarehouseOrders[0].orderId || receivedWarehouseOrders[0]._id) : null);
      }
      return;
    }
    if (!incomingList.some((item: any) => String(item.id || item._id) === selectedIncomingId)) {
      setSelectedIncomingId(incomingList[0] ? String(incomingList[0].id || incomingList[0]._id) : null);
    }
  }, [fulfillmentFilter, incomingList, receivedWarehouseOrders, selectedIncomingId, selectedTransferId]);




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
    setBulkMeasuredTotal(String(items.reduce((sum, item) => sum + Number(item.quantity || 0), 0) || ""));
    setBulkQualityResult("passed");
    setBulkReceiveNotes("");
    setShowBulkReceiveDialog(true);
  };

  const handleBulkReceive = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!bulkFarmItems.length) return;
    const declaredTotal = bulkFarmItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const measuredTotal = Number(bulkMeasuredTotal);
    if (!Number.isFinite(measuredTotal) || measuredTotal <= 0) { toast.error("Enter the actual total weight received for this bulk shipment."); return; }
    const mismatch = Math.abs(measuredTotal - declaredTotal) > 0.001;
    if (mismatch && !bulkReceiveNotes.trim()) { toast.error("Add a note explaining the bulk weight difference before saving."); return; }
    if (mismatch && !window.confirm("The bulk measured weight differs from the declared total. Record the shipment-level discrepancy and continue?")) return;
    setIsSaving(true); let succeeded = 0;
    try {
      for (const item of bulkFarmItems) {
        await api.put("/warehouse/me/incoming/" + item.id + "/receive-bulk-reference", undefined, { params: { declaredTotal, measuredTotal, quality_check: "pending", notes: [bulkReceiveNotes.trim(), `Bulk lot: ${bulkFarmItems.length} order label references; declared total ${declaredTotal} kg; measured total ${measuredTotal} kg; overall quality ${bulkQualityResult}. Per-order quantities are not weighed at receipt and must be allocated during Order Packing.`].filter(Boolean).join(" | ") } });
        succeeded++;
        // Each row is marked as a packing reference for this accepted bulk lot.
      }
      toast.success(`Bulk receipt saved for ${succeeded} order references. Overall quality: ${bulkQualityResult}. Total measured: ${measuredTotal} kg. Individual order weighing belongs in Order Packing.`);
      setShowBulkReceiveDialog(false); setBulkMeasuredTotal(""); setBulkQualityResult("passed"); setSelectedIncomingIds([]); await refetch();
    } catch (error: any) {
      const detail = error?.response?.data?.detail || error?.message || "Unknown error"; toast.error(`Bulk receipt saved for ${succeeded} of ${bulkFarmItems.length} order references. Error: ${detail}. Refresh to review the records before retrying.`); await refetch();
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
    const savedReceipt = item?.receipt && typeof item.receipt === "object" ? item.receipt : {};
    const receiptItem = { ...item, ...savedReceipt, receiptNumber: savedReceipt.receiptNumber || item?.receiptNumber || item?.id, receivedAt: savedReceipt.receivedAt || item?.receivedAt || item?.receivedDate, qualityCheck: savedReceipt.qualityResult || item?.qualityCheck || item?.quality_check };
    item = receiptItem;
    receivedQuantity = Number(savedReceipt.receivedQuantity ?? item?.quantityReceived ?? receivedQuantity);
    usableQuantity = Number(savedReceipt.usableQuantity ?? item?.usableQuantity ?? usableQuantity);
    const win = window.open("", "_blank", "width=800,height=900");
    if (!win) {
      toast.error("Allow pop-ups to print the packing receipt. The receipt was saved.");
      return;
    }
    const escapeHtml = (value: unknown) => String(value ?? "—").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[char] as string));
    const order = item?.order || {};
    const address = item?.deliveryAddress || item?.shippingAddress || order?.deliveryAddress || order?.shippingAddress || order?.address || item?.customer?.address || order?.customer?.address || {};
    const addressValue = (keys: string[]) => {
      if (!address || typeof address !== "object") return "";
      for (const key of keys) {
        const value = address[key];
        if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
      }
      return "";
    };
    const addressParts = typeof address === "string" ? [address] : [
      addressValue(["addressLine1", "line1", "streetAddress", "street"]),
      addressValue(["addressLine2", "line2", "landmark", "area", "locality", "village"]),
      addressValue(["district", "districtName"]),
      addressValue(["city", "town", "cityName"]),
      addressValue(["state", "stateName", "province"]),
      addressValue(["pinCode", "pincode", "postalCode", "zipCode", "zip"]),
    ].filter(Boolean);
    const addressText = addressParts.join(", ");
    const customerName = item?.customerName || item?.customer?.name || order?.customerName || order?.customer?.name || [order?.customer?.firstName, order?.customer?.lastName].filter(Boolean).join(" ") || "Customer details unavailable";
    const customerPhone = item?.customerPhone || item?.customer?.phone || order?.customerPhone || order?.customer?.phone || order?.phone || "Phone not available";
    const receiptNumber = item?.receiptNumber || item?.receipt?.receiptNumber || item?.id || "Receipt number unavailable";
    const orderNumber = item?.orderNumber || item?.receipt?.orderNumber || order?.orderNumber || (item?.orderId ? String(item.orderId) : "Order number unavailable");
    const receiptDateTime = item?.receivedAt || item?.receivedDate || item?.receipt?.receivedAt;
    const warehouseName = item?.warehouseName || item?.receipt?.warehouseName || item?.warehouse?.name || "Warehouse details unavailable";
    const farmName = item?.displayFarmName || item?.farmName || item?.farmerName || item?.receipt?.farmName || "Farm details unavailable";
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>AgriConnect Delivery Receipt</title>
      <style>*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;padding:12px;margin:0}.receipt-label{max-width:384px;width:100%;margin:0 auto 12px;border:1px solid #222;border-radius:4px;padding:12px;break-inside:avoid;page-break-after:always}.receipt-label:last-child{page-break-after:auto}.brand{text-align:center;font-size:17px;font-weight:800;letter-spacing:.3px}.subtitle{text-align:center;font-size:8px;color:#444}.rule{border-top:1px solid #ccc;margin:9px 0}.section{font-size:8px;font-weight:700;color:#555;letter-spacing:.3px;margin:10px 0 4px}.row{display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid #eee;font-size:9px;line-height:1.4}.row:last-child{border-bottom:0}.label{font-weight:700;min-width:105px}.value{text-align:right;overflow-wrap:anywhere}.muted{color:#555;font-size:8px;line-height:1.4}@media print{body{padding:0}.receipt-label{margin:0 auto;border:1px solid #222}}</style></head><body>
      <main class="receipt-label"><div class="brand">AGRICONNECT</div><div class="subtitle">WAREHOUSE RECEIPT · FARM-TO-HOME</div><div class="rule"></div>
      <div class="section">RECEIPT NUMBER</div><div style="font-size:12px;font-weight:700;overflow-wrap:anywhere">${escapeHtml(receiptNumber)}</div>
      <div class="section">PRODUCT / ORDER</div><div class="row"><span class="label">Order reference</span><span class="value">${escapeHtml(orderNumber)}</span></div>
      <div class="row"><span class="label">Product</span><span class="value">${escapeHtml(item?.displayProductName || item?.productName || item?.product?.name || "Product details unavailable")}</span></div>
      <div class="row"><span class="label">Received quantity</span><span class="value">${escapeHtml(receivedQuantity)} ${escapeHtml(item?.unit || "kg")}</span></div>
      <div class="row"><span class="label">Usable quantity</span><span class="value">${escapeHtml(usableQuantity)} ${escapeHtml(item?.unit || "kg")}</span></div>
      <div class="row"><span class="label">Receipt date</span><span class="value">${escapeHtml(receiptDateTime ? new Date(receiptDateTime).toLocaleString() : "Date/time unavailable")}</span></div>
      <div class="section">ROUTE DETAILS</div>
      <div class="row"><span class="label">Warehouse</span><span class="value">${escapeHtml(warehouseName)}</span></div>
      <div class="row"><span class="label">Source farm</span><span class="value">${escapeHtml(farmName)}</span></div>
      <div class="row"><span class="label">Customer</span><span class="value">${escapeHtml(customerName)}</span></div>
      <div class="row"><span class="label">Phone</span><span class="value">${escapeHtml(customerPhone)}</span></div>
      <div class="section">DELIVERY ADDRESS</div><div class="value">${escapeHtml(addressText || "Delivery address unavailable")}</div>
      <div class="rule"></div><div class="muted">Keep this receipt with the order records. Verify product and quantity before transfer.</div>
      </main><script>window.onload=()=>window.print();</script></body></html>`);
    win.document.close();
  };

  const printFarmPackingLabels = (items: any[]) => {
    if (!items.length) { toast.error("No received order labels are available for this farm."); return; }
    const win = window.open("", "_blank", "width=900,height=900");
    if (!win) { toast.error("Allow pop-ups to print farm packing labels."); return; }
    farmLabelPrintWindowRef.current = win;
    setFarmLabelPrintItems(items);
  };

  useEffect(() => {
    if (!farmLabelPrintItems.length || !farmLabelPrintWindowRef.current) return;
    const win = farmLabelPrintWindowRef.current;
    const esc = (value: unknown) => String(value ?? "—").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char] as string));
    const labels = farmLabelPrintItems.map((item, index) => {
      const order = item.order || {};
      const address = item.deliveryAddress || item.shippingAddress || order.deliveryAddress || order.shippingAddress || order.address || item.customer?.address || order.customer?.address || {};
      const addressText = typeof address === "string" ? address : [
        address.formattedAddress, address.fullAddress, address.addressLine1, address.addressLine2,
        address.line1, address.line2, address.streetAddress, address.street, address.area, address.locality,
        address.village, address.district, address.city, address.state,
        address.pinCode || address.pincode || address.postalCode || address.zipCode,
      ].filter(Boolean).join(", ");
      const customer = item.customerName || order.customerName || order.customer?.name || item.customer?.name || "";
      const phone = item.customerPhone || order.customerPhone || order.customer?.phone || item.customer?.phone || "";
      const product = item.displayProductName || item.productName || item.product?.name || "";
      const number = humanIdFallback(order.orderNumber || item.orderNumber || item.displayOrderNumber || item.orderId, "");
      const packageId = item.packageId || item.labelId || (item.id || item._id || item.orderId ? "PKG-" + String(item.id || item._id || item.orderId).slice(-8) : "");
      const paymentRaw = String(item.paymentMethod || item.payment_method || item.paymentMode || item.paymentType || item.payment?.method || order.paymentMethod || order.payment_method || order.paymentMode || order.paymentType || order.payment?.method || (item.cashOnDelivery || order.cashOnDelivery ? "cash" : "")).trim().toLowerCase().replace(/[ -]+/g, "_");
      const isCod = ["cash", "cod", "cash_on_delivery", "cashondelivery", "pay_on_delivery", "pay_later"].includes(paymentRaw);
      const isOnline = ["online", "razorpay", "upi", "card", "netbanking", "wallet", "net_banking"].includes(paymentRaw);
      const payment = isCod ? "COD" : isOnline ? "ONLINE" : "";
      const rawPaymentStatus = String(item.paymentStatus || item.payment_status || item.payment?.status || order.paymentStatus || order.payment_status || order.payment?.status || "").trim().toLowerCase().replace(/[ -]+/g, "_");
      const paymentStatus = ["paid", "success", "successful", "captured", "completed"].includes(rawPaymentStatus) ? "PAID" : "";
      const rawAmount = item.totalAmount ?? item.total ?? order.totalAmount ?? order.total;
      const amount = Number(rawAmount);
      const qr = document.querySelector('[data-farm-label-qr="' + index + '"] svg')?.outerHTML || "";
      const qty = item.quantity ?? item.allocatedQuantity ?? item.orderQuantity;
      const unit = item.unit || item.product?.unit || "";
      const farm = item.displayFarmName || item.farmName || item.farmerName || item.pickupLocation?.farmName || item.pickupLocation?.name || "";
      const warehouse = "";
      const farmAddress = item.pickupLocation?.address || item.farmAddress || item.pickupLocation?.city || "";
      const warehouseAddress = item.warehouseAddress || item.warehouse?.address || "";
      return "<main class='label'><div class='brand'>AGRICONNECT</div><div class='subtitle'>FARM-TO-HOME · DELIVERY LABEL</div><div class='rule'></div>" +
        (number ? "<div class='heading'>ORDER NUMBER</div><div class='order'>" + esc(number) + "</div>" : "") + (packageId ? "<div class='muted'>Package ID: " + esc(packageId) + " · " : "") + "Printed: " + esc(new Date().toLocaleString()) + "</div>" +
        "<div class='heading'>SOURCE FARM</div><div class='value'>" + esc(farm) + "</div>" + (farmAddress ? "<div class='muted'>" + esc(farmAddress) + "</div>" : "") +
        "<div class='heading'>DELIVER TO</div>" + (customer ? "<div class='value'><b>" + esc(customer) + "</b></div>" : "") + (phone ? "<div class='value'>Phone: " + esc(phone) + "</div>" : "") + "<div class='value'>Address: " + esc(addressText || "Delivery address unavailable") + "</div>" +
        (product || qty !== undefined && qty !== null ? "<div class='heading'>PACKED ITEMS · ACTUAL QUANTITY</div><table><tr><td><div class='item-name'>" + esc(product) + "</div><div class='muted'>Fresh produce</div></td><td class='qty'>" + esc(qty ?? "") + (unit ? " " + esc(unit) : "") + "</td></tr></table><div class='muted'>Incoming allocation; final packed quantity is confirmed in Order Packing.</div>" : "") +
       ("<div class='heading'>PAYMENT</div>" + (payment === "COD" ? "<div class='value'>COD · Payable on delivery</div>" + (Number.isFinite(amount) && rawAmount !== undefined && rawAmount !== null ? "<div class='value'><b>₹" + amount.toFixed(2) + "</b></div>" : "") : payment === "ONLINE" && paymentStatus === "PAID" ? "<div class='value'>ONLINE PAYMENT · PAID</div>" : "<div class='value'>PAYMENT DETAILS UNCONFIRMED · Do not dispatch until verified</div>")) +
        "<div class='qr'>" + qr + "<div class='muted'><b>DELIVERY PARTNER QR</b></div><div class='muted'>Scan to open the delivery workspace. Login and assignment authorization are required to access delivery actions and POD.</div><div class='muted' style='margin-top:8px'>Verify the order reference before handover.</div></div></main>";
    }).join("");
    win.document.open();
    win.document.write("<!doctype html><html><head><meta charset='utf-8'/><title>AgriConnect Farm Order Labels</title><style>*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;padding:12px;margin:0}.label{max-width:384px;margin:0 auto 12px;border:1px solid #ddd;border-radius:4px;padding:8px 9px 7px;break-inside:avoid;page-break-after:always}.label:last-child{page-break-after:auto}.brand{text-align:center;font-size:16px;font-weight:800;letter-spacing:.2px}.subtitle{text-align:center;font-size:7px;color:#444}.rule{border-top:1px solid #d5d5d5;margin:9px 0}.heading{font-size:7px;font-weight:500;color:#777;letter-spacing:.25px;margin:9px 0 4px}.value{font-size:9px;line-height:1.45;overflow-wrap:anywhere}.order{font-size:11px;font-weight:700}.muted{font-size:7px;color:#666;line-height:1.4;overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:5px}.origin{min-width:0}.item-name{font-size:9px}.qty{text-align:right;font-size:9px;font-weight:700;white-space:nowrap}table{width:100%;border-collapse:collapse;font-size:9px}td{padding:7px 0;border-bottom:1px solid #e5e5e5;vertical-align:top}.qr{text-align:center;margin-top:10px;border-top:1px solid #ddd;padding-top:8px}.qr svg{width:40px;height:40px}.qr .muted{font-size:6.5px}@media print{body{padding:0}.label{max-width:384px;width:100%;margin:0 auto;border:1px solid #ddd}}</style></head><body>" + labels + "<script>window.onload=()=>window.print();</script></body></html>");
    win.document.close();
    farmLabelPrintWindowRef.current = null;
    setFarmLabelPrintItems([]);
  }, [farmLabelPrintItems]);

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
      const receiveResponse = await api.put(`/warehouse/me/incoming/${selectedIncoming.id}/receive`, undefined, {
        params: {
          quantity: Number(receiveForm.quantity),
          usableQuantity: Number(receiveForm.usableQuantity),
          quality_check: "pending",
          notes: receiveForm.notes.trim() || undefined,
        },
      });
      const savedIncoming = receiveResponse?.data?.data || receiveResponse?.data || selectedIncoming;
      if (!isFarmerPacked && !quantityMismatch) {
        printIncomingPackingReceipt({ ...selectedIncoming, ...savedIncoming }, actualQuantity, Number(receiveForm.usableQuantity));
      }
      toast.success("Warehouse receipt recorded. Complete Quality Check and approve or reject this shipment before the next process.");
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
      toast.success(qualityCheck === "passed" ? "Quality approved. Continue to the next fulfillment process." : "Quality rejected. Shipment is on hold and cannot proceed.");
      setShowQualityDialog(false); setQualityNotes(""); await refetch();
    } catch (error: any) { toast.error(error?.message || "Failed to update quality result"); }
    finally { setIsSaving(false); }
  };

  const openQualityDialog = (item: any) => { setSelectedIncoming(item); setQualityNotes(""); setShowQualityDialog(true); };

  function isReceiptQualityPassed(row: any) { const qc = String(row.qualityCheck || row.quality_check || "").toLowerCase(); return qc === "passed" || String(row.status || "").toLowerCase() === "stored"; }

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

  const openBulkStoreDialog = (items: any[]) => {
    const eligible = items.filter((item) => !isFarmerPackedIncoming(item) && isReceiptQualityPassed(item) && String(item.status || "").toLowerCase() !== "stored");
    if (!eligible.length) { toast("No quality-approved shipments are waiting to be stored."); return; }
    setBulkStoreItems(eligible);
    setBulkStoreErrors([]);
    setBulkStoreForm({
      storageLocation: "",
      storageType: "ambient",
      usableQuantities: Object.fromEntries(eligible.map((item) => [item.id, String(item.usableQuantity ?? item.quantityReceived ?? item.receivedQuantity ?? item.actualQuantityReceived ?? item.quantity ?? "")])),
    });
    setShowBulkStoreDialog(true);
  };

  const handleBulkStoreIncoming = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!bulkStoreItems.length) return;
    if (!bulkStoreForm.storageLocation.trim()) { toast.error("Enter the storage location before confirming storage."); return; }
    const invalid = bulkStoreItems.find((item) => {
      const received = Number(item.quantityReceived ?? item.receivedQuantity ?? item.actualQuantityReceived ?? item.quantity ?? 0);
      const usable = Number(bulkStoreForm.usableQuantities[item.id] || 0);
      return !Number.isFinite(usable) || usable <= 0 || usable > received;
    });
    if (invalid) { toast.error("Check each usable quantity. It must be greater than zero and no more than the received quantity."); return; }
    setIsSaving(true);
    let stored = 0;
    const failures: string[] = [];
    try {
      for (const item of bulkStoreItems) {
        try {
          await api.put("/warehouse/me/incoming/" + item.id + "/store", {
            usableQuantity: Number(bulkStoreForm.usableQuantities[item.id]),
            storageLocation: bulkStoreForm.storageLocation.trim(),
            storageType: bulkStoreForm.storageType,
          });
          stored++;
        } catch (error: any) {
          const detail = error?.response?.data?.detail || error?.message || "Storage request failed";
          failures.push((item.displayOrderNumber || item.displayProductName || item.id || "Unknown shipment") + ": " + detail);
        }
      }
      if (stored) toast.success("Stored " + stored + " approved shipment(s). Continue to Order Packing.");
      if (failures.length) {
        toast.error(failures.length + " shipment(s) could not be stored. Review the errors below and correct the affected orders.");
        setBulkStoreItems((current) => current.filter((item) => failures.some((failure) => failure.startsWith(String(item.displayOrderNumber || item.displayProductName || item.id || "Unknown shipment") + ":"))));
        setBulkStoreErrors(failures);
      } else {
        setShowBulkStoreDialog(false);
        setBulkStoreErrors([]);
      }
      await refetch();
    } finally { setIsSaving(false); }
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
      {farmLabelPrintItems.length > 0 && <div aria-hidden="true" style={{ position: "fixed", left: "-10000px", top: 0 }}>{farmLabelPrintItems.map((item: any, index: number) => <div key={String(item.id || item._id || item.orderId || index)} data-farm-label-qr={index}><QRCodeSVG value={typeof window !== "undefined" ? window.location.origin + "/delivery/deliveries?orderId=" + encodeURIComponent(String(item.orderId || item.order?.id || item.order?._id || item.id || item._id || item.orderNumber || "")) : ""} size={160} level="M" /></div>)}</div>}
        <WarehousePageHeader eyebrow="Inventory receiving" title="Incoming Stock" description="Receive shipments after farm collection; inspect and store accepted stock." />
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />)}
      </div>
    );
  }

  return (
    <div className="warehouse-incoming-page mx-auto w-full max-w-[1800px] space-y-5 pb-8">
      <WarehousePageHeader
        eyebrow="Inventory receiving"
        title="Incoming Stock"
        description="Review arrivals, confirm receipts and continue each shipment to its next warehouse step."
        actions={
          <>
            <Button type="button" variant="outline" size="icon" aria-label="Refresh incoming stock" onClick={() => { void refetch(); }}><RefreshCw className="h-4 w-4" /></Button>
          </>
        }
      />

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { number: "1", title: "Receive from Partner", detail: "Confirm physical warehouse handover", tone: "emerald" },
            { number: "2", title: "Quality Inspection", detail: "Required for warehouse bulk stock", tone: "blue" },
            { number: "3", title: "Accept & Store", detail: "Add approved stock to inventory", tone: "violet" },
            { number: "4", title: "Next Process", detail: "Farmer Transfers or Order Packing", tone: "amber" },
          ].map((step) => (
            <div key={step.number} className={cn("flex min-w-0 items-center gap-3 rounded-xl border p-3", step.tone === "emerald" ? "border-emerald-200 bg-emerald-50/70" : step.tone === "blue" ? "border-blue-200 bg-blue-50/70" : step.tone === "violet" ? "border-violet-200 bg-violet-50/70" : "border-amber-200 bg-amber-50/70")}>
              <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-sm font-bold shadow-sm", step.tone === "emerald" ? "text-emerald-700" : step.tone === "blue" ? "text-blue-700" : step.tone === "violet" ? "text-violet-700" : "text-amber-700")}>{step.number}</span>
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{step.title}</p><p className="text-xs leading-5 text-slate-600">{step.detail}</p></div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid items-start gap-3 2xl:grid-cols-[270px_minmax(620px,1fr)_410px] xl:grid-cols-[245px_minmax(0,1fr)_350px]">
        <aside className="space-y-4 xl:sticky xl:top-4">
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="space-y-4 p-4">
              <div className="flex items-center justify-between"><h2 className="font-semibold text-slate-900">Filter Shipments</h2><Button type="button" variant="ghost" size="sm" onClick={() => { setSearchTerm(""); setStatusFilter("all"); setDateFilter("all"); setFulfillmentFilter("all"); }}>Reset</Button></div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fulfillment Type</p>
                {([
                  { key: "all", label: "All Incoming", count: incomingTypeCounts.all },
                  { key: "farmer", label: "Farmer Fulfillment", count: incomingTypeCounts.farmer },
                  { key: "warehouse", label: "Warehouse Fulfillment", count: incomingTypeCounts.warehouse },
                  { key: "received_warehouse", label: "Received from Other WH", count: incomingTypeCounts.received_warehouse },
                ] as const).map((tab) => (
                  <button key={tab.key} type="button" onClick={() => setFulfillmentFilter(tab.key)} className={cn("flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-colors", fulfillmentFilter === tab.key ? "border-emerald-600 bg-emerald-50 font-semibold text-emerald-800" : "border-slate-200 text-slate-700 hover:border-emerald-300 hover:bg-slate-50")}>
                    <span>{tab.label}</span><span className={cn("rounded-full px-2 py-0.5 text-xs", fulfillmentFilter === tab.key ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-600")}>{tab.count}</span>
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Shipment Status</label>
                {[
                  { key: "scheduled", label: "Awaiting Receipt" },
                  { key: "quality_check", label: "Quality Pending" },
                  { key: "stored", label: "Quality Passed / Stored" },
                  { key: "rejected", label: "Quality Failed" },
                  { key: "received", label: "Received" },
                ].map((option) => (
                  <button key={option.key} type="button" onClick={() => { setStatusFilter(statusFilter === option.key ? "all" : option.key); setCurrentPage(1); }} className="flex w-full items-center gap-3 rounded-md px-1.5 py-1.5 text-left text-sm hover:bg-slate-50">
                    <span className={cn("flex h-4 w-4 items-center justify-center rounded border", statusFilter === option.key ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-400 bg-white")}>{statusFilter === option.key ? "✓" : ""}</span>
                    <span className="min-w-0 flex-1">{option.label}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{incomingList.filter((row: any) => String(row.status || "").toLowerCase() === option.key).length}</span>
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date Range</label>
                <Select value={dateFilter} onValueChange={(value) => { setDateFilter(value); setCurrentPage(1); }}><SelectTrigger><SelectValue placeholder="All time" /></SelectTrigger><SelectContent><SelectItem value="all">All time</SelectItem><SelectItem value="today">Today</SelectItem><SelectItem value="yesterday">Yesterday</SelectItem><SelectItem value="week">This week</SelectItem><SelectItem value="month">This month</SelectItem></SelectContent></Select>
              </div>
              <div className="flex gap-2 border-t pt-3"><Button type="button" className="flex-1" onClick={() => setCurrentPage(1)}><Search className="mr-2 h-4 w-4" />Apply Filters</Button><Button type="button" variant="outline" onClick={() => { setSearchTerm(""); setStatusFilter("all"); setDateFilter("all"); setFulfillmentFilter("all"); setCurrentPage(1); }}><RefreshCw className="mr-2 h-4 w-4" />Reset</Button></div>
            </CardContent>
          </Card>
        </aside>

        <main className="min-w-0">
          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-slate-50/70 px-4 py-3">
              <div><h2 className="font-semibold text-slate-900">{fulfillmentFilter === "received_warehouse" ? "Incoming Warehouse Transfers" : "Incoming Shipments (" + incomingList.length + ")"}</h2><p className="text-xs text-muted-foreground">{fulfillmentFilter === "received_warehouse" ? receivedWarehouseOrders.length + " destination transfer(s)" : selectedIncomingIds.length + " selected · Select rows to process multiple orders together"}</p></div>
              {fulfillmentFilter !== "received_warehouse" && <div className="relative w-full sm:max-w-[290px]"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input value={searchTerm} onChange={(event) => { setSearchTerm(event.target.value); setCurrentPage(1); }} placeholder="Search by order, farm or product..." className="pl-9" /></div>}
            </div>
            {fulfillmentFilter !== "received_warehouse" && selectedIncomingIds.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-emerald-50/70 px-4 py-3"><div><p className="text-sm font-semibold text-emerald-900">{selectedIncomingIds.length} orders selected</p><p className="text-xs text-emerald-800">Only arrived orders of the same fulfillment type can be processed together. One batch action applies to every eligible selected order.</p></div><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setSelectedIncomingIds([])}>Clear selection</Button>{selectedBatchType === true && <Button type="button" size="sm" disabled={isSaving || !batchEligibleItems.length} onClick={handleBatchFarmerReceipt}><CheckCircle className="mr-2 h-4 w-4" />{isSaving ? "Processing…" : "Confirm Receipt for " + batchEligibleItems.length + " Orders"}</Button>}{selectedBatchType === false && <Button type="button" size="sm" disabled={isSaving || !batchEligibleItems.length} onClick={() => openBulkReceiveDialog(batchEligibleItems)}><Package className="mr-2 h-4 w-4" />Receive Bulk for {batchEligibleItems.length} Orders</Button>}</div></div>}
            {fulfillmentFilter === "received_warehouse" ? (
              isLoadingTransfers ? <div className="p-10 text-center text-sm text-muted-foreground">Loading warehouse transfers…</div> :
              receivedWarehouseOrders.length === 0 ? <div className="p-10 text-center"><Warehouse className="mx-auto h-9 w-9 text-slate-300" /><p className="mt-3 font-semibold">No incoming warehouse transfers</p><p className="mt-1 text-sm text-muted-foreground">Destination warehouse transfers will appear here.</p></div> :
              <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3 font-semibold">Order</th><th className="px-4 py-3 font-semibold">Products</th><th className="px-4 py-3 font-semibold">Transfer status</th><th className="px-4 py-3 font-semibold">Action</th></tr></thead><tbody className="divide-y">{receivedWarehouseOrders.map((order: any) => { const id = String(order.id || order.orderId || order._id || order.orderNumber); const active = id === String(selectedTransfer?.id || selectedTransfer?.orderId || selectedTransfer?._id || selectedTransfer?.orderNumber); return <tr key={id} onClick={() => setSelectedTransferId(id)} className={cn("cursor-pointer transition-colors hover:bg-slate-50", active && "bg-emerald-50/70")}><td className="px-4 py-3 font-semibold text-slate-900">{order.orderNumber || order.displayOrderNumber || "Order reference unavailable"}</td><td className="max-w-[180px] truncate px-4 py-3 text-slate-600">{order.productName || (Array.isArray(order.items) ? order.items.map((item: any) => item.productName || item.name).filter(Boolean).join(", ") : "") || "Packed customer order"}</td><td className="px-4 py-3"><Badge variant="outline">{String(order.transferStatus || order.status || "received").replace(/_/g, " ")}</Badge></td><td className="px-4 py-3 text-xs font-medium text-emerald-700">View operations →</td></tr>; })}</tbody></table></div>
            ) : isLoading ? <div className="p-10 text-center text-sm text-muted-foreground">Loading incoming shipments…</div> :
            incomingList.length === 0 ? <div className="p-10 text-center"><Package className="mx-auto h-9 w-9 text-slate-300" /><p className="mt-3 font-semibold">No incoming shipments found</p><p className="mt-1 text-sm text-muted-foreground">Try changing the filters or search terms.</p></div> :
            <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="w-10 px-3 py-3"><input aria-label="Select all visible shipments" type="checkbox" checked={incomingList.some((item: any) => canSelectForBatchReceipt(item)) && incomingList.filter((item: any) => canSelectForBatchReceipt(item)).filter((item: any) => selectedBatchType === null || isFarmerPackedIncoming(item) === selectedBatchType).every((item: any) => selectedIncomingIds.includes(String(item.id || item._id)))} onChange={toggleAllVisibleIncoming} className="h-4 w-4 rounded border-slate-300 accent-emerald-600" /></th><th className="px-4 py-3 font-semibold">Order / Shipment</th><th className="px-4 py-3 font-semibold">Farm / Product</th><th className="px-4 py-3 font-semibold">Quantity</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Expected</th></tr></thead><tbody className="divide-y divide-slate-100">{incomingList.map((item: any) => { const id = String(item.id || item._id); const active = id === String(selectedIncomingRow?.id || selectedIncomingRow?._id); const status = String(item.status || "scheduled").toLowerCase(); return <tr key={id} onClick={() => setSelectedIncomingId(id)} className={cn("cursor-pointer transition-colors hover:bg-slate-50", active && "bg-emerald-50/70", selectedIncomingIds.includes(id) && "bg-emerald-50/50")}><td className="px-3 py-3" onClick={(event) => event.stopPropagation()}><input aria-label={"Select " + item.displayOrderNumber} type="checkbox" checked={selectedIncomingIds.includes(id)} disabled={!canSelectForBatchReceipt(item) || (selectedBatchType !== null && isFarmerPackedIncoming(item) !== selectedBatchType)} title={!canSelectForBatchReceipt(item) ? "Available for batch receipt after arrival at this warehouse" : selectedBatchType !== null && isFarmerPackedIncoming(item) !== selectedBatchType ? "Select one fulfillment type per batch" : "Select this order for batch receipt"} onChange={() => toggleIncomingSelection(id)} className="h-4 w-4 rounded border-slate-300 accent-emerald-600 disabled:cursor-not-allowed disabled:opacity-40" /></td><td className="px-4 py-3"><p className="font-semibold text-slate-900">{item.displayOrderNumber || "Order reference unavailable"}</p><p className="mt-0.5 text-xs text-slate-500">{isFarmerPackedIncoming(item) ? "Farmer fulfillment" : "Warehouse fulfillment"}</p></td><td className="px-4 py-3"><p className="font-medium text-slate-800">{item.displayFarmName || getFarmDisplayName(item)}</p><p className="mt-0.5 max-w-[190px] truncate text-xs text-slate-500">{item.displayProductName || getProductDisplayName(item)}</p></td><td className="whitespace-nowrap px-4 py-3 font-medium">{item.quantity ?? "—"} {item.unit || "kg"}</td><td className="px-4 py-3"><Badge variant="outline" className={cn("border", statusColors[status] || "border-slate-200 bg-slate-50 text-slate-700")}>{statusLabels[status] || status.replace(/_/g, " ")}</Badge></td><td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(item.expectedDate)}</td></tr>; })}</tbody></table></div>}
          </Card>
          <p className="mt-2 text-xs text-muted-foreground">Select a shipment row to view its details and available actions.</p>
        </main>

        <aside className="xl:sticky xl:top-4">
          <Card className="border-slate-200 shadow-sm">
            <div className="border-b bg-slate-50/70 px-4 py-3"><div className="flex items-center justify-between gap-2"><h2 className="font-semibold text-slate-900">Operations</h2><Badge variant="outline">{fulfillmentFilter === "received_warehouse" ? "Transfer" : "Selected shipment"}</Badge></div></div>
            <CardContent className="space-y-4 p-4">
              {fulfillmentFilter === "received_warehouse" ? !selectedTransfer ? <p className="text-sm text-muted-foreground">Select a warehouse transfer to see its next action.</p> : (() => { const transferStatus = String(selectedTransfer.transferStatus || selectedTransfer.status || "").toLowerCase(); const transferId = String(selectedTransfer.id || selectedTransfer.orderId || selectedTransfer._id || ""); return <><div><p className="text-xs text-muted-foreground">Order number</p><p className="mt-1 break-words font-semibold">{selectedTransfer.orderNumber || selectedTransfer.displayOrderNumber || "Order reference unavailable"}</p><p className="mt-1 text-sm text-muted-foreground">{selectedTransfer.productName || "Packed customer order"}</p></div><div className="rounded-lg border bg-slate-50 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current stage</p><p className="mt-1 font-semibold capitalize">{transferStatus.replace(/_/g, " ") || "Received"}</p><p className="mt-1 text-xs text-muted-foreground">Already packed · No bulk receiving or repacking required.</p></div>{transferStatus === "destination_warehouse_arrived_pending_receipt" ? <Button className="w-full" onClick={() => handleInboundTransferAction(selectedTransfer, "receive")} disabled={transferActionBusy === transferId + ":receive" || !transferId}><CheckCircle className="mr-2 h-4 w-4" />{transferActionBusy === transferId + ":receive" ? "Confirming…" : "Confirm Destination Receipt"}</Button> : transferStatus === "destination_warehouse_received" ? <Button className="w-full" onClick={() => handleInboundTransferAction(selectedTransfer, "hub")} disabled={transferActionBusy === transferId + ":hub" || !transferId}><ArrowRight className="mr-2 h-4 w-4" />{transferActionBusy === transferId + ":hub" ? "Sending…" : "Send to Local Hub"}</Button> : <Button asChild variant="outline" className="w-full"><Link href="/warehouse/farmer-fulfillment">Open Transfer Workspace</Link></Button>}<p className="text-xs leading-5 text-muted-foreground">After destination receipt, hand the packed order to the Local Hub for final-mile delivery.</p></>; })() :
              !selectedIncomingRow ? <p className="text-sm text-muted-foreground">Select a shipment from the table to view its operations.</p> : <>
                <div><p className="text-xs text-muted-foreground">Selected shipment</p><p className="mt-1 break-words font-semibold text-slate-900">{selectedIncomingRow.displayOrderNumber || "Order reference unavailable"}</p><div className="mt-2 flex flex-wrap items-center gap-2"><Badge variant="outline" className={isFarmerPackedIncoming(selectedIncomingRow) ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-blue-200 bg-blue-50 text-blue-800"}>{isFarmerPackedIncoming(selectedIncomingRow) ? "Farmer Fulfillment" : "Warehouse Fulfillment"}</Badge><Badge variant="outline" className={cn("border", statusColors[selectedStatus] || "border-slate-200")}>{statusLabels[selectedStatus] || selectedStatus.replace(/_/g, " ") || "Status unavailable"}</Badge></div><p className="mt-2 text-sm text-muted-foreground">{selectedIncomingRow.displayProductName || getProductDisplayName(selectedIncomingRow)} · {selectedIncomingRow.displayFarmName || getFarmDisplayName(selectedIncomingRow)}</p></div>
                <div className="rounded-lg border bg-slate-50 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current stage</p><div className="mt-1 flex flex-wrap items-center gap-2"><Badge variant="outline" className={cn("border", statusColors[selectedStatus] || "border-slate-200")}>{statusLabels[selectedStatus] || selectedStatus.replace(/_/g, " ")}</Badge>{selectedIncomingRow.qualityCheck && <Badge variant="outline">QC: {String(selectedIncomingRow.qualityCheck).toUpperCase()}</Badge>}</div><p className="mt-2 text-xs leading-5 text-slate-600">{!selectedPhysicallyArrived && !selectedReceiptComplete ? "Waiting for the delivery partner to confirm physical arrival at this warehouse." : selectedPackedFarmer ? (selectedReceiptComplete ? "Packed farmer order received. No second quality inspection or repacking is required." : "Count the sealed packets and confirm the physical receipt.") : selectedStatus === "quality_check" ? "Receipt recorded. Complete the quality inspection before storing stock." : selectedReceiptComplete && selectedQualityPassed ? "Receipt and quality requirements are complete. Continue to storage or order packing." : selectedReceiptComplete ? "Receipt recorded. Resolve the quality or quantity hold before continuing." : "Shipment is in the receiving workflow."}</p></div>
                <div className="space-y-1 text-sm"><div className="flex justify-between gap-2"><span className="text-muted-foreground">Declared quantity</span><span className="font-medium">{selectedIncomingRow.quantity ?? "—"} {selectedIncomingRow.unit || "kg"}</span></div><div className="flex justify-between gap-2"><span className="text-muted-foreground">Received quantity</span><span className="font-medium">{selectedIncomingRow.quantityReceived ?? selectedIncomingRow.receivedQuantity ?? "—"} {selectedIncomingRow.unit || "kg"}</span></div><div className="flex justify-between gap-2"><span className="text-muted-foreground">Expected date</span><span className="font-medium">{formatDate(selectedIncomingRow.expectedDate)}</span></div></div>
                <div className="space-y-2 border-t pt-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Available actions</p>
                  {selectedStatus === "scheduled" && <Button type="button" variant="outline" className="w-full" onClick={() => { setSelectedIncoming(selectedIncomingRow); setShowTrackDialog(true); }}><Clock className="mr-2 h-4 w-4" />Track Shipment</Button>}
                  {selectedCanReceive && (selectedPackedFarmer ? <Button type="button" className="w-full" onClick={() => openReceiveDialog(selectedIncomingRow)}><CheckCircle className="mr-2 h-4 w-4" />Confirm Packed Order Receipt</Button> : <Button type="button" className="w-full" onClick={() => openBulkReceiveDialog(selectedEligibleToReceive)} disabled={!selectedEligibleToReceive.length || isSaving}><Package className="mr-2 h-4 w-4" />Record Bulk Receipt</Button>)}
                  {selectedCanReceive && <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs leading-5 text-amber-900">{selectedPackedFarmer ? "Verify the sealed packets and confirm the warehouse handover. No second quality inspection is required for packed farmer orders." : "Record the actual bulk weight and complete the initial quality result before storage."}</p>}
                  {selectedCanQualityCheck && <Button type="button" className="w-full" onClick={() => openQualityDialog(selectedIncomingRow)}><ShieldCheck className="mr-2 h-4 w-4" />Quality Check (Approve / Reject)</Button>}
                  {!selectedPackedFarmer && selectedReceiptComplete && selectedQualityPassed && selectedStatus !== "stored" && <Button type="button" className="w-full" onClick={() => openStoreDialog(selectedIncomingRow)}><Warehouse className="mr-2 h-4 w-4" />Store Approved Stock</Button>}
                  {selectedReceiptComplete && <Button type="button" variant="outline" className="w-full" onClick={() => { setSelectedIncoming(selectedIncomingRow); setShowReceiptDialog(true); }}><Package className="mr-2 h-4 w-4" />View / Reprint Receipt</Button>}
                  {selectedPackedFarmer && selectedReceiptComplete && selectedQualityPassed && <Button type="button" className="w-full" onClick={() => { window.location.href = "/warehouse/farmer-fulfillment"; }}><Route className="mr-2 h-4 w-4" />Continue to Farmer Fulfillment</Button>}
                  {!selectedPackedFarmer && selectedReceiptComplete && selectedQualityPassed && <Button type="button" className="w-full" onClick={() => { window.location.href = selectedIncomingRow.orderId ? "/packing?orderId=" + encodeURIComponent(String(selectedIncomingRow.orderId)) : "/packing"; }}><ArrowRight className="mr-2 h-4 w-4" />Continue to Order Packing</Button>}
                  {!selectedCanReceive && !selectedReceiptComplete && !selectedStatus.includes("quality") && !selectedPhysicallyArrived && <p className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">No receipt action is available until the delivery partner confirms warehouse arrival.</p>}
                  {selectedStatus === "rejected" && <p className="rounded-lg bg-red-50 p-3 text-xs text-red-700">This shipment is rejected or on hold. Contact the farm before further processing.</p>}
                  <Button type="button" variant="ghost" className="w-full" onClick={() => { setSelectedIncoming(selectedIncomingRow); setShowTrackDialog(true); }}>View Shipment Details</Button>
                </div>
              </>}
            </CardContent>
          </Card>
        </aside>
      </div>

      <Dialog open={showBulkReceiveDialog} onOpenChange={setShowBulkReceiveDialog}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Receive Bulk Stock — {bulkFarmItems[0]?.displayFarmName || "Farm"}</DialogTitle><DialogDescription>Receive and inspect the farmer’s shipment as one bulk lot. Measure the total bulk weight and perform one overall quality check here. Individual customer orders are not weighed or quality-checked at receipt; use their order details later to print labels and pack the correct quantities in Order Packing.</DialogDescription></DialogHeader>
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-3"><div><p className="text-muted-foreground">Order labels</p><p className="text-lg font-bold">{bulkFarmItems.length}</p></div><div><p className="text-muted-foreground">Declared bulk total</p><p className="text-lg font-bold">{bulkFarmItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0).toLocaleString()} kg</p></div><div><p className="text-muted-foreground">Actual measured total</p><p className="text-lg font-bold">{bulkMeasuredTotal ? `${Number(bulkMeasuredTotal).toLocaleString()} kg` : "Not entered"}</p></div></div>
          <form className="space-y-4" onSubmit={handleBulkReceive}>
            <div className="rounded-lg border bg-slate-50 p-3"><p className="font-semibold">{bulkFarmItems[0]?.displayFarmName || getFarmDisplayName(bulkFarmItems[0] || {})}</p><p className="text-sm text-muted-foreground">{bulkFarmItems[0]?.pickupLocation?.address || bulkFarmItems[0]?.farmAddress || "Farm address not available"}</p><div className="mt-2 text-sm text-muted-foreground">This bulk receipt contains {bulkFarmItems.length} order label references. The warehouse packing team will weigh/allocate each order and attach its printed label after the bulk stock has been accepted.</div><div className="mt-3 space-y-2">{bulkFarmItems.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded border bg-white px-3 py-2"><div><p className="font-medium">{item.displayProductName || getProductDisplayName(item)}</p><p className="text-xs text-muted-foreground">Order {item.displayOrderNumber || item.orderNumber || item.order?.orderNumber || "reference unavailable"}</p></div><Badge variant="outline">Label / packing reference</Badge></div>)}</div></div>
            <div className="grid gap-3 sm:grid-cols-2"><div><label className="text-sm font-medium">Actual total bulk weight received (kg)</label><Input type="number" min="0.01" step="0.01" value={bulkMeasuredTotal} onChange={(e) => setBulkMeasuredTotal(e.target.value)} placeholder="e.g. 100" required /></div><div><label className="text-sm font-medium">Overall bulk quality result</label><Select value={bulkQualityResult} onValueChange={(value) => setBulkQualityResult(value as "passed" | "pending" | "failed")}><SelectTrigger><SelectValue placeholder="Select overall quality" /></SelectTrigger><SelectContent><SelectItem value="passed">Passed — bulk lot accepted</SelectItem><SelectItem value="pending">Pending — hold for review</SelectItem><SelectItem value="failed">Failed — hold and contact farm</SelectItem></SelectContent></Select></div></div>
            <div><label className="text-sm font-medium">Bulk receipt notes / weight discrepancy</label><Input value={bulkReceiveNotes} onChange={(e) => setBulkReceiveNotes(e.target.value)} placeholder="Required if actual total differs from declared total" /></div>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setShowBulkReceiveDialog(false)}>Cancel</Button><Button type="submit" disabled={isSaving || !bulkMeasuredTotal || Number(bulkMeasuredTotal) <= 0}>{isSaving ? "Saving bulk receipt…" : "Confirm Bulk Receipt & Quality"}</Button></div>
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

      <Dialog open={showBulkStoreDialog} onOpenChange={setShowBulkStoreDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Continue to Store — Farm Orders</DialogTitle>
            <DialogDescription>Review the order count, total quantity, and order IDs for this farm before continuing.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleBulkStoreIncoming}>
            <div className="rounded-lg border p-4">
              <p className="font-semibold">{bulkStoreItems[0]?.displayFarmName || getFarmDisplayName(bulkStoreItems[0] || {})}</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div><p className="text-xs text-muted-foreground">Total orders</p><p className="text-xl font-semibold">{bulkStoreItems.length}</p></div>
                <div><p className="text-xs text-muted-foreground">Total quantity</p><p className="text-xl font-semibold">{bulkStoreItems.reduce((sum, item) => sum + Number(bulkStoreForm.usableQuantities[item.id] || item.quantityReceived || item.receivedQuantity || item.actualQuantityReceived || item.quantity || 0), 0).toLocaleString()} kg</p></div>
              </div>
            </div>
            <div className="space-y-2">
              <p className="font-medium">Orders included</p>
              {bulkStoreItems.map((item) => {
                const order = item.order || {};
                return <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div><p className="font-medium">{item.displayOrderNumber || item.orderNumber || order.orderNumber || item.orderId || item.id || "Order ID unavailable"}</p><p className="text-sm text-muted-foreground">{item.displayProductName || getProductDisplayName(item)}</p></div>
                  <p className="whitespace-nowrap text-sm font-semibold">{bulkStoreForm.usableQuantities[item.id] || item.quantityReceived || item.receivedQuantity || item.actualQuantityReceived || item.quantity || 0} {item.unit || "kg"}</p>
                </div>;
              })}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="text-sm font-medium">Storage location / bin</label><Input placeholder="e.g. Rack A · Bin 04" value={bulkStoreForm.storageLocation} onChange={(e) => setBulkStoreForm((current) => ({ ...current, storageLocation: e.target.value }))} required /></div>
              <div><label className="text-sm font-medium">Storage condition</label><Select value={bulkStoreForm.storageType} onValueChange={(value) => setBulkStoreForm((current) => ({ ...current, storageType: value }))}><SelectTrigger><SelectValue placeholder="Choose storage condition" /></SelectTrigger><SelectContent><SelectItem value="ambient">Ambient / General</SelectItem><SelectItem value="cold">Cold Storage</SelectItem><SelectItem value="refrigerated">Refrigerated</SelectItem><SelectItem value="frozen">Frozen</SelectItem><SelectItem value="dry">Dry Storage</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div>
            </div>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setShowBulkStoreDialog(false)} disabled={isSaving}>Cancel</Button><Button type="submit" disabled={isSaving}>{isSaving ? "Storing..." : "Continue to Store (" + bulkStoreItems.length + " orders)"}</Button></div>
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

      <Dialog open={showReceiptDialog} onOpenChange={setShowReceiptDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Warehouse Receipt History</DialogTitle>
            <DialogDescription>Review the saved receipt for this shipment and reprint it without receiving the stock again.</DialogDescription>
          </DialogHeader>
          {selectedIncoming && (() => {
            const receipt = selectedIncoming.receipt || {};
            const order = selectedIncoming.order || {};
            const receiptNumber = receipt.receiptNumber || selectedIncoming.receiptNumber || selectedIncoming.id;
            const receivedAt = receipt.receivedAt || selectedIncoming.receivedAt || selectedIncoming.receivedDate;
            return <div className="space-y-4">
              <div className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm text-muted-foreground">Receipt number</p><p className="text-lg font-semibold">{receiptNumber || "Receipt number unavailable"}</p></div><Badge variant="outline">{String(receipt.qualityResult || selectedIncoming.qualityCheck || selectedIncoming.quality_check || "pending").toUpperCase()}</Badge></div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div><p className="text-xs text-muted-foreground">Receipt date / time</p><p className="font-medium">{receivedAt ? new Date(receivedAt).toLocaleString() : "Not recorded"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Order ID / number</p><p className="font-medium break-all">{receipt.orderNumber || selectedIncoming.orderNumber || order.orderNumber || selectedIncoming.orderId || selectedIncoming.id}</p><p className="text-xs text-muted-foreground break-all">{receipt.orderId || selectedIncoming.orderId || "Order ID unavailable"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Farm</p><p className="font-medium">{receipt.farmName || getFarmDisplayName(selectedIncoming)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Warehouse</p><p className="font-medium">{receipt.warehouseName || "Warehouse details unavailable"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Customer</p><p className="font-medium">{receipt.customerName || selectedIncoming.customerName || "Customer details unavailable"}</p><p className="text-sm">{receipt.customerPhone || selectedIncoming.customerPhone || "Phone not available"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Delivery address</p><p className="font-medium">{typeof (receipt.deliveryAddress || selectedIncoming.deliveryAddress) === "string" ? (receipt.deliveryAddress || selectedIncoming.deliveryAddress) : [((receipt.deliveryAddress || selectedIncoming.deliveryAddress) || {}).addressLine1, ((receipt.deliveryAddress || selectedIncoming.deliveryAddress) || {}).addressLine2, ((receipt.deliveryAddress || selectedIncoming.deliveryAddress) || {}).city, ((receipt.deliveryAddress || selectedIncoming.deliveryAddress) || {}).district, ((receipt.deliveryAddress || selectedIncoming.deliveryAddress) || {}).state, ((receipt.deliveryAddress || selectedIncoming.deliveryAddress) || {}).postalCode].filter(Boolean).join(", ") || "Address not available"}</p></div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-md bg-muted p-3"><p className="text-xs text-muted-foreground">Declared</p><p className="text-lg font-semibold">{receipt.declaredQuantity ?? selectedIncoming.quantity ?? "—"} {receipt.unit || selectedIncoming.unit || "kg"}</p></div>
                <div className="rounded-md bg-muted p-3"><p className="text-xs text-muted-foreground">Received</p><p className="text-lg font-semibold">{receipt.receivedQuantity ?? selectedIncoming.quantityReceived ?? selectedIncoming.quantity ?? "—"} {receipt.unit || selectedIncoming.unit || "kg"}</p></div>
                <div className="rounded-md bg-muted p-3"><p className="text-xs text-muted-foreground">Usable</p><p className="text-lg font-semibold">{receipt.usableQuantity ?? selectedIncoming.usableQuantity ?? "—"} {receipt.unit || selectedIncoming.unit || "kg"}</p></div>
                <div className="rounded-md bg-muted p-3"><p className="text-xs text-muted-foreground">Rejected</p><p className="text-lg font-semibold">{receipt.rejectedQuantity ?? selectedIncoming.quantityRejected ?? "—"} {receipt.unit || selectedIncoming.unit || "kg"}</p></div>
              </div>
              {receipt.qualityNotes || selectedIncoming.qualityNotes || selectedIncoming.notes ? <p className="text-sm text-muted-foreground">Notes: {receipt.qualityNotes || selectedIncoming.qualityNotes || selectedIncoming.notes}</p> : null}
              {!selectedIncoming.receipt && <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">This is a legacy shipment without a saved receipt snapshot. The receipt preview uses the shipment's current stored fields; new receipts are saved permanently.</p>}
              <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setShowReceiptDialog(false)}>Close</Button><Button type="button" onClick={() => printIncomingPackingReceipt(selectedIncoming, Number(receipt.receivedQuantity ?? selectedIncoming.quantityReceived ?? selectedIncoming.quantity ?? 0), Number(receipt.usableQuantity ?? selectedIncoming.usableQuantity ?? selectedIncoming.quantityReceived ?? selectedIncoming.quantity ?? 0))}><Package className="mr-2 h-4 w-4" />Reprint Receipt</Button></div>
            </div>;
          })()}
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
