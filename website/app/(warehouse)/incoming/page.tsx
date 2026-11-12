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
  quality_passed: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  quality_check: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  ready_to_store: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  rejected: "bg-red-500/10 text-red-600 border-red-500/20",
};

const hasWarehouseReceipt = (item: any) =>
  ["received", "quality_check", "quality_passed", "ready_to_store", "stored", "rejected"].includes(String(item?.status || "").toLowerCase()) ||
  Boolean(item?.receivedAt || item?.receivedDate || item?.warehouseReceivedAt || item?.bulkShipmentReceivedAt);

const getIncomingDisplayStatus = (item: any) => {
  const rawStatus = String(item?.status || "").toLowerCase();
  if (!hasWarehouseReceipt(item)) return rawStatus === "ready_to_store" ? "quality_passed" : rawStatus || "scheduled";
  if (rawStatus === "rejected") return "rejected";
  const quality = String(item?.qualityCheck || item?.quality_check || "").toLowerCase();
  if (quality === "failed") return "rejected";
  // Legacy "stored" records were quality-approved before the Store step was removed.
  // Keep their historical backend value, but show the current workflow stage.
  if (quality === "passed" || rawStatus === "stored" || item?.storedAt || rawStatus === "quality_passed" || rawStatus === "ready_to_store") return "quality_passed";
  if (quality === "pending" || rawStatus === "quality_check") return "quality_check";
  return "received";
};

const getHumanReceiptNumber = (item: any) => {
  const receipt = item?.receipt || {};
  const existing = String(receipt.receiptNumber || item?.receiptNumber || "").trim();
  if (/^RCP-\\d{8}-[A-Z0-9]{4,10}$/i.test(existing)) return existing.toUpperCase();
  const orderReference = String(
    receipt.orderNumber || item?.orderNumber || item?.displayOrderNumber ||
    item?.order?.orderNumber || item?.orderId || item?.id || item?._id || "ORDER"
  ).replace(/[^a-z0-9]/gi, "").toUpperCase();
  const rawDate = receipt.receivedAt || item?.receivedAt || item?.receivedDate || item?.createdAt;
  const parsedDate = rawDate ? new Date(rawDate) : null;
  const datePart = parsedDate && !Number.isNaN(parsedDate.getTime())
    ? parsedDate.toISOString().slice(0, 10).replace(/-/g, "")
    : "00000000";
  const referencePart = (orderReference.slice(-6) || "ORDER1").padStart(6, "0");
  return `RCP-${datePart}-${referencePart}`;
};

const getReceiptQuality = (item: any) => {
  const raw = String(item?.receipt?.qualityResult || item?.qualityCheck || item?.quality_check || "").toLowerCase();
  if (raw === "passed" || ["quality_passed", "stored"].includes(String(item?.status || "").toLowerCase())) return "passed";
  if (raw === "failed" || String(item?.status || "").toLowerCase() === "rejected") return "failed";
  return "pending";
};

const statusLabels: Record<string, string> = {
  scheduled: "Scheduled",
  in_transit: "In Transit",
  received: "Received",
  quality_passed: "Quality Passed",
  ready_to_store: "Quality Passed",
  quality_check: "Quality Checking",
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
  const [fulfillmentFilter, setFulfillmentFilter] = useState<"received_warehouse" | "farmer" | "warehouse">("farmer");
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [showReceiveDialog, setShowReceiveDialog] = useState(false);
  const [showQualityDialog, setShowQualityDialog] = useState(false);
  const [showTrackDialog, setShowTrackDialog] = useState(false);
  const [showReceiptDialog, setShowReceiptDialog] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [incomingForm, setIncomingForm] = useState(emptyIncomingForm);
  const [receiveForm, setReceiveForm] = useState(emptyReceiveForm);
  const [selectedIncoming, setSelectedIncoming] = useState<any>(null);
  const [selectedDetailId, setSelectedDetailId] = useState<string | null>(null);
  const [pickupSourceFilter, setPickupSourceFilter] = useState("all");
  const [pickupAreaFilter, setPickupAreaFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState("newest");
  const [shipmentPage, setShipmentPage] = useState(1);
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
      if (["stored", "quality_passed", "ready_to_store"].includes(String(item.status || "").toLowerCase()) || getIncomingDisplayStatus(item) === "quality_passed") return 3;
      if (item.status === "rejected") return 4;
      return 5;
    };
    return readableItems.sort((a: any, b: any) =>
      stagePriority(a) - stagePriority(b) ||
      new Date(a.expectedDate || a.createdAt || 0).getTime() - new Date(b.expectedDate || b.createdAt || 0).getTime()
    );
  }, [incomingData, searchTerm, fulfillmentFilter, dateFilter]);



  const getPickupSource = (item: any) => String(item.pickupPartnerName || item.pickupPartner?.name || item.collectionPartnerName || item.deliveryPartnerName || item.partnerName || "Not assigned");
  const getPickupArea = (item: any) => String(item.pickupLocation?.area || item.pickupLocation?.village || item.pickupLocation?.town || item.pickupLocation?.address || item.farmAddress || item.district || "Area unavailable");
  const pickupSourceOptions = Array.from(new Set(incomingList.map((item: any) => getPickupSource(item)))).sort();
  const pickupAreaOptions = Array.from(new Set(incomingList.map((item: any) => getPickupArea(item)))).sort();
  const visibleShipments = incomingList.filter((item: any) => pickupSourceFilter === "all" || getPickupSource(item) === pickupSourceFilter).filter((item: any) => pickupAreaFilter === "all" || getPickupArea(item) === pickupAreaFilter).slice().sort((a: any,b: any) => { const da=new Date(a.expectedDate || a.createdAt || 0).getTime(); const db=new Date(b.expectedDate || b.createdAt || 0).getTime(); return sortOrder === "newest" ? db-da : da-db; });
  const shipmentPageSize = 5;
  const shipmentPageCount = Math.max(1, Math.ceil(visibleShipments.length / shipmentPageSize));
  const pagedShipments = visibleShipments.slice((shipmentPage-1)*shipmentPageSize, shipmentPage*shipmentPageSize);
  const selectedShipment = visibleShipments.find((item: any) => String(item.id || item._id) === selectedDetailId) || visibleShipments[0] || null;
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
      setShowBulkReceiveDialog(false); setBulkMeasuredTotal(""); setBulkQualityResult("passed"); await refetch();
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
    const receiptNumber = getHumanReceiptNumber(item);
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
      if (!isFarmerPacked && !quantityMismatch && receiveForm.qualityCheck === "passed") {
        printIncomingPackingReceipt({ ...selectedIncoming, ...savedIncoming }, actualQuantity, Number(receiveForm.usableQuantity));
      }
      if (quantityMismatch) {
        toast.success("Receipt saved with a quantity discrepancy. Resolve it before quality approval.");
      } else if (receiveForm.qualityCheck === "passed") {
        toast.success("Receipt recorded. Quality inspection is complete; continue to the correct fulfillment workflow.");
      } else if (receiveForm.qualityCheck === "failed") {
        toast.error("Receipt saved as rejected. The order remains on hold.");
      } else {
        toast.success("Receipt saved. Complete quality inspection before continuing.");
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
      setSelectedIncoming((current: any) => current ? { ...current, qualityCheck, quality_check: qualityCheck, receipt: { ...(current.receipt || {}), qualityResult: qualityCheck, qualityNotes: qualityNotes.trim() || current.receipt?.qualityNotes } } : current);
      toast.success(qualityCheck === "passed" ? "Quality approved. Receipt is now available to reprint." : "Quality rejected. Shipment is on hold.");
      setShowQualityDialog(false); setQualityNotes(""); await refetch();
    } catch (error: any) { toast.error(error?.message || "Failed to update quality result"); }
    finally { setIsSaving(false); }
  };

  const openQualityDialog = (item: any) => { setSelectedIncoming(item); setQualityNotes(""); setShowQualityDialog(true); };

  const isReceiptQualityPassed = (row: any) => { const qc = String(row.qualityCheck || row.quality_check || "").toLowerCase(); return qc === "passed" || String(row.status || "").toLowerCase() === "stored"; };


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
        description={`${incomingList.length} incoming shipments · ${dateFilter === "today" ? "Today" : dateFilter === "yesterday" ? "Yesterday" : dateFilter === "week" ? "This Week" : dateFilter === "month" ? "This Month" : "All Time"}`}
        actions={
          <>
            <Button asChild variant="outline"><Link href="/packing"><ArrowRight className="mr-2 h-4 w-4"/>Continue to Order Packing</Link></Button>
            <Button asChild><Link href="/warehouse/farmer-fulfillment"><Route className="mr-2 h-4 w-4" />Farmer Fulfillment Transfer</Link></Button>
            <Button variant="outline" size="icon" aria-label="Refresh incoming stock" onClick={() => { void refetch(); }}><RefreshCw className="h-4 w-4" /></Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Total Incoming", value: incomingList.length, tone: "emerald", icon: Package },
          { label: "Awaiting Receipt", value: incomingList.filter((item: any) => ["scheduled", "in_transit", "ready_for_pickup"].includes(String(item.status || "").toLowerCase())).length, tone: "amber", icon: Clock },
          { label: "In Quality Check", value: incomingList.filter((item: any) => ["received", "quality_check"].includes(String(item.status || "").toLowerCase())).length, tone: "blue", icon: ShieldCheck },
          { label: "Quality Passed", value: incomingList.filter((item: any) => String(item.qualityCheck || item.quality_check || "").toLowerCase() === "passed").length, tone: "violet", icon: CheckCircle },
          { label: "Shortage / Hold", value: incomingList.filter((item: any) => ["rejected"].includes(String(item.status || "").toLowerCase()) || String(item.qualityCheck || item.quality_check || "").toLowerCase() === "failed").length, tone: "red", icon: XCircle },
        ].map((metric) => {
          const MetricIcon = metric.icon;
          const tones: Record<string, string> = { emerald: "bg-emerald-50 text-emerald-700", amber: "bg-amber-50 text-amber-700", blue: "bg-blue-50 text-blue-700", violet: "bg-violet-50 text-violet-700", red: "bg-red-50 text-red-700" };
          return <Card key={metric.label} className="group rounded-2xl border-slate-200/90 bg-white shadow-[0_2px_10px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-md"><CardContent className="flex items-center gap-3 p-4"><span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full", tones[metric.tone])}><MetricIcon className="h-5 w-5"/></span><div className="min-w-0"><p className="text-xs font-medium text-slate-500">{metric.label}</p><p className="text-2xl font-bold tracking-tight text-slate-900">{metric.value}</p></div></CardContent></Card>;
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-3" role="tablist" aria-label="Incoming stock fulfillment type">
        {([
          { key: "received_warehouse", label: "Received from Other Warehouse", description: "Already-packed inter-district orders", count: incomingTypeCounts.received_warehouse },
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
              "min-h-[88px] rounded-2xl border p-4 text-left shadow-[0_2px_10px_rgba(15,23,42,0.035)] transition-all",
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

      <div className="rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-white px-5 py-4 shadow-sm">
        <div className="grid gap-4 md:grid-cols-[190px_1fr_1fr_1fr] md:items-center">
          <p className="font-semibold text-slate-900">Incoming Stock Workflow</p>
          {(fulfillmentFilter === "received_warehouse"
            ? [{number:"1",title:"Confirm Destination Receipt",description:"Verify the packed transfer arrived"},{number:"2",title:"Send to Local Hub",description:"Handoff for last-mile delivery"},{number:"3",title:"Final-mile Delivery",description:"Continue the delivery workflow"}]
            : fulfillmentFilter === "farmer"
              ? [{number:"1",title:"Receive Packed Collection",description:"Confirm physically received packets"},{number:"2",title:"Review Receipt",description:"Verify order references and quantities"},{number:"3",title:"Transfer Routing",description:"Continue to Farmer Fulfillment Transfers"}]
              : [{number:"1",title:"Receive Bulk Stock",description:"Record measured quantity and receipt"},{number:"2",title:"Quality Check",description:"Inspect quality and usable quantity"},{number:"3",title:"Continue to Order Packing",description:"Proceed after quality approval"}]
          ).map((step,index)=><div key={step.number} className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-800">{step.number}</span><div><p className="text-sm font-semibold text-slate-900">{step.title}</p><p className="text-xs text-slate-600">{step.description}</p></div>{index<2&&<ArrowRight className="ml-auto hidden h-4 w-4 text-emerald-600 lg:block"/>}</div>)}
        </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[250px_minmax(0,1fr)_360px]">
        <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:sticky xl:top-4">
          <div className="mb-4 flex items-center gap-2"><Search className="h-4 w-4 text-emerald-700"/><h2 className="font-semibold text-slate-900">Filter Collections</h2></div>
          <Input placeholder="Search collection, order, farm..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          <div className="mt-4 space-y-4">
            <div><label className="mb-2 block text-sm font-semibold">Order Type</label><p className="text-xs text-slate-500">Choose a fulfillment tab above to switch order type.</p></div>
            <div><label className="mb-2 block text-sm font-semibold">Pickup Source</label><Select value={pickupSourceFilter} onValueChange={(v)=>{setPickupSourceFilter(v);setShipmentPage(1);}}><SelectTrigger className="w-full"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">All Pickup Sources</SelectItem>{pickupSourceOptions.map((v)=><SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="mb-2 block text-sm font-semibold">Pickup Area</label><Select value={pickupAreaFilter} onValueChange={(v)=>{setPickupAreaFilter(v);setShipmentPage(1);}}><SelectTrigger className="w-full"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">All Areas</SelectItem>{pickupAreaOptions.map((v)=><SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="mb-2 block text-sm font-semibold">Status</label><Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-full"><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="scheduled">Scheduled</SelectItem><SelectItem value="in_transit">In Transit</SelectItem><SelectItem value="received">Received</SelectItem><SelectItem value="quality_check">Quality Check</SelectItem><SelectItem value="rejected">Rejected</SelectItem></SelectContent></Select></div>
            <div><label className="mb-2 block text-sm font-semibold">Date range</label><Select value={dateFilter} onValueChange={setDateFilter}><SelectTrigger className="w-full"><SelectValue placeholder="Date" /></SelectTrigger><SelectContent><SelectItem value="today">Today</SelectItem><SelectItem value="yesterday">Yesterday</SelectItem><SelectItem value="week">This Week</SelectItem><SelectItem value="month">This Month</SelectItem><SelectItem value="all">All Time</SelectItem></SelectContent></Select></div>
            <Button type="button" variant="outline" className="w-full" onClick={() => {setSearchTerm("");setStatusFilter("all");setDateFilter("all");setPickupSourceFilter("all");setPickupAreaFilter("all");setShipmentPage(1);}}> <RefreshCw className="mr-2 h-4 w-4"/>Reset Filters</Button>
          </div>
        </aside>
        <main className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900">{fulfillmentFilter === "received_warehouse" ? "Warehouse Transfers" : "Incoming Shipments"}</h2>
          <p className="mt-0.5 text-xs text-slate-500">{fulfillmentFilter === "received_warehouse" ? receivedWarehouseOrders.length + " packed transfers requiring destination handling" : incomingList.length + " collections matching the selected filters"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">{fulfillmentFilter === "received_warehouse" ? "Transfer queue" : "Live receiving queue"}</Badge>
          <Button type="button" variant="ghost" size="icon" aria-label="Refresh shipments" onClick={() => { void refetch(); }}><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </div>
      {fulfillmentFilter !== "received_warehouse" && (
        <section className="mb-4 overflow-hidden rounded-xl border border-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-3 py-3">
            <div><h3 className="font-bold text-slate-900">Incoming Shipments ({visibleShipments.length})</h3><p className="text-xs text-slate-500">Records from the current warehouse incoming API</p></div>
            <Select value={sortOrder} onValueChange={(v)=>{setSortOrder(v);setShipmentPage(1);}}><SelectTrigger className="h-9 w-[145px]"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="oldest">Oldest First</SelectItem><SelectItem value="newest">Newest First</SelectItem></SelectContent></Select>
          </div>
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3">Order / Reference</th><th className="px-3 py-3">Type</th><th className="px-3 py-3">Farm / Product</th><th className="px-3 py-3">Quantity</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Expected</th><th className="px-3 py-3 text-right">Action</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {pagedShipments.map((item: any) => {
                const packed = isFarmerPackedIncoming(item);
                const arrived = Boolean(item.arrivedWarehouseAt || item.warehouseArrivalConfirmed || String(item.collectionStatus || "").toLowerCase() === "arrived_warehouse");
                const received = hasWarehouseReceipt(item);
                const active = String(item.id || item._id) === String(selectedDetailId || selectedShipment?.id || selectedShipment?._id);
                return <tr key={String(item.id || item._id)} onClick={() => {setSelectedIncoming(item);setSelectedDetailId(String(item.id || item._id));}} className={cn("cursor-pointer transition-colors hover:bg-emerald-50/50",active && "bg-emerald-50/70")}>
                  <td className="whitespace-nowrap px-3 py-3 font-semibold text-slate-900">{item.displayOrderNumber || item.id || "Reference unavailable"}</td>
                  <td className="px-3 py-3"><Badge variant="outline" className={packed?"border-emerald-200 bg-emerald-50 text-emerald-700":"border-violet-200 bg-violet-50 text-violet-700"}>{packed?"Farmer":"Warehouse"}</Badge></td>
                  <td className="px-3 py-3"><p className="font-medium text-slate-800">{item.displayFarmName}</p><p className="text-xs text-slate-500">{item.displayProductName}</p><p className="text-xs text-slate-500">{getPickupArea(item)}</p></td>
                  <td className="whitespace-nowrap px-3 py-3 font-semibold">{item.quantity ?? "—"} {item.unit || "kg"}</td>
                  <td className="px-3 py-3"><Badge variant="outline" className={cn("whitespace-nowrap",statusColors[getIncomingDisplayStatus(item)] || "border-slate-200 bg-slate-50 text-slate-700")}>{statusLabels[getIncomingDisplayStatus(item)] || getIncomingDisplayStatus(item).replace(/_/g," ")}</Badge></td>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-600">{formatDate(item.expectedDate)}</td>
                  <td className="px-3 py-3 text-right" onClick={(event)=>event.stopPropagation()}>{arrived && !received && packed ? <Button size="sm" onClick={()=>openReceiveDialog(item)}>Receive</Button> : received ? <Button size="sm" variant="outline" onClick={()=>{setSelectedIncoming(item);setShowReceiptDialog(true);}}>View</Button> : <Button size="sm" variant="outline" onClick={()=>{setSelectedIncoming(item);setSelectedDetailId(String(item.id || item._id));setShowTrackDialog(true);}}>Details</Button>}</td>
                </tr>;
              })}
              {!pagedShipments.length && <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500">No shipments match the selected filters.</td></tr>}
            </tbody></table></div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-3 py-3 text-xs text-slate-500">
            <span>Showing {visibleShipments.length ? (shipmentPage-1)*shipmentPageSize+1 : 0}–{Math.min(shipmentPage*shipmentPageSize,visibleShipments.length)} of {visibleShipments.length} shipments</span>
            <div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={shipmentPage<=1} onClick={()=>setShipmentPage((p)=>Math.max(1,p-1))}>Previous</Button><span className="font-semibold text-slate-700">{shipmentPage} / {shipmentPageCount}</span><Button size="sm" variant="outline" disabled={shipmentPage>=shipmentPageCount} onClick={()=>setShipmentPage((p)=>Math.min(shipmentPageCount,p+1))}>Next</Button></div>
          </div>
        </section>
      )}
      {fulfillmentFilter === "received_warehouse" ? (
        <div className="space-y-3">
          {isLoadingTransfers ? <Card className="p-8 text-center">Loading received warehouse transfers…</Card> : receivedWarehouseOrders.length === 0 ? <Card className="p-10 text-center"><Warehouse className="mx-auto h-10 w-10 text-muted-foreground" /><h3 className="mt-3 font-semibold">No orders received from another warehouse</h3><p className="mt-1 text-sm text-muted-foreground">Confirmed destination-warehouse receipts appear here. These orders are already packed, so they should continue to the local hub and final-mile delivery without bulk receiving or repacking.</p><Button asChild variant="outline" className="mt-4"><Link href="/warehouse/farmer-fulfillment">Open Farmer Fulfillment Transfers</Link></Button></Card> : receivedWarehouseOrders.map((order: any) => <Card key={String(order.id || order.orderId || order._id || order.orderNumber)}><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">{order.orderNumber || order.displayOrderNumber || "Order number unavailable"}</p><p className="text-sm text-muted-foreground">{order.productName || (Array.isArray(order.items) ? order.items.map((item: any) => item.productName || item.name).filter(Boolean).join(", ") : "") || "Packed customer order"}</p><p className="mt-1 text-xs text-muted-foreground">Already packed · {String(order.transferStatus || order.status || "received").replace(/_/g, " ")}</p></div>{String(order.transferStatus || order.status || "").toLowerCase() === "destination_warehouse_arrived_pending_receipt" ? <Button onClick={() => handleInboundTransferAction(order, "receive")} disabled={transferActionBusy === String(order.id || order.orderId || order._id) + ":receive"}><CheckCircle className="mr-2 h-4 w-4"/>{transferActionBusy === String(order.id || order.orderId || order._id) + ":receive" ? "Confirming…" : "Confirm Destination Receipt"}</Button> : String(order.transferStatus || order.status || "").toLowerCase() === "destination_warehouse_received" ? <Button onClick={() => handleInboundTransferAction(order, "hub")} disabled={transferActionBusy === String(order.id || order.orderId || order._id) + ":hub"}><ArrowRight className="mr-2 h-4 w-4"/>{transferActionBusy === String(order.id || order.orderId || order._id) + ":hub" ? "Sending…" : "Send to Local Hub"}</Button> : <Button asChild variant="outline"><Link href="/warehouse/farmer-fulfillment">Open Transfer Details</Link></Button>}</CardContent></Card>)}
        </div>
      ) : incomingList.length === 0 ? (
        <Card className="p-12 text-center"><ArrowDown className="mx-auto h-12 w-12 text-muted-foreground" /><h3 className="mt-4 text-lg font-semibold">No incoming shipments</h3><p className="mt-2 text-muted-foreground">{statusFilter !== "all" ? `No ${statusLabels[statusFilter] || statusFilter} shipments` : "Shipments appear here after their farm pickup reaches the warehouse."}</p></Card>
      ) : (
        <div className="space-y-4">{Array.from(incomingList.reduce((groups: Map<string, any[]>, item: any) => { const key = getFarmGroupKey(item); if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(item); return groups; }, new Map<string, any[]>()).entries()).map(([farmKey, farmItems]) => {
          const eventFulfillmentGroup = farmItems.every((row: any) => isEventFulfillmentIncoming(row));
          const packedFarmerGroup = !eventFulfillmentGroup && farmItems.every((row: any) => isFarmerPackedIncoming(row));
          const expectedTotal = farmItems.reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0);
          const isBulkLotReceived = (row: any) => Boolean(row.bulkShipmentReceivedAt || row.bulkShipmentMeasuredTotal !== undefined || /Bulk lot receipt:/i.test(String(row.notes || row.qualityNotes || "")));
          const isPhysicallyReceived = (row: any) => ["received", "quality_check", "stored", "rejected"].includes(String(row.status || "").toLowerCase()) || Boolean(row.receivedAt || row.receivedDate || row.warehouseReceivedAt || row.bulkShipmentReceivedAt);
          const receivedCount = farmItems.filter((row: any) => isPhysicallyReceived(row)).length;
          const pendingCount = Math.max(0, farmItems.length - receivedCount);
          // Bulk lot measured weight is duplicated across its product-reference rows;
          // count the lot-level measured total once, not once per product line.
          const bulkLotMeasuredTotal = farmItems.reduce((max: number, row: any) => Math.max(max, Number(row.bulkShipmentMeasuredTotal || 0)), 0);
          const receivedQuantityTotal = bulkLotMeasuredTotal > 0 ? bulkLotMeasuredTotal : farmItems.reduce((sum: number, row: any) => sum + Number(row.quantityReceived ?? ((["received", "stored"].includes(String(row.status || "").toLowerCase()) && !isBulkLotReceived(row)) ? row.quantity : 0) ?? 0), 0);
          const declaredTotal = farmItems.reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0);
          const eligibleToReceive = farmItems.filter((row: any) => {
            const status = String(row.status || "").toLowerCase();
            const alreadyReceived = ["received", "quality_check", "stored", "rejected", "packed", "completed"].includes(status) ||
              Boolean(row.receivedAt || row.receivedDate || row.warehouseReceivedAt) ||
              String(row.qualityCheck || row.quality_check || "").toLowerCase() === "passed";
            return ["scheduled", "in_transit", "ready_for_pickup"].includes(status) &&
              Boolean(row.arrivedWarehouseAt || row.warehouseArrivalConfirmed || String(row.collectionStatus || "").toLowerCase() === "arrived_warehouse") &&
              !alreadyReceived;
          });
          const canConfirmAllPackets = packedFarmerGroup && eligibleToReceive.length > 0;
          const canReceiveAllBulk = !packedFarmerGroup && eligibleToReceive.length > 0;
          const canReceiveAnyFarmStock = eligibleToReceive.length > 0;
          const allPackedOrdersReceived = (packedFarmerGroup || eventFulfillmentGroup) && farmItems.length > 0 && farmItems.every((row: any) => {
            const status = String(row.status || "").toLowerCase();
            const physicallyReceived = ["received", "quality_check", "stored"].includes(status) ||
              Boolean(row.receivedAt || row.receivedDate || row.warehouseReceivedAt || row.bulkShipmentReceivedAt);
            const rejected = status === "rejected" || String(row.qualityCheck || row.quality_check || "").toLowerCase() === "failed";
            return physicallyReceived && !rejected && isReceiptQualityPassed(row);
          });
          // Both normal farmer-packed orders and Bulk/Event product portions
          // continue through the same warehouse fulfillment routing screen.
          // Multi-Warehouse Consolidation is not the next step for these receipts:
          // Farmer Fulfillment Transfers determines the customer-district destination
          // and coordinates the source-warehouse portions into one complete order.
          const farmContinueHref = "/warehouse/farmer-fulfillment";
          const farmContinueLabel = "Farmer Fulfillment Transfers";
          const confirmAllPackets = async () => {
            const receiptDescription = eventFulfillmentGroup
              ? `Confirm receipt of ${eligibleToReceive.length} event product lines from ${farmItems[0].displayFarmName}? Verify each product and its received quantity against the bulk/event order. Items not physically arrived remain pending.`
              : `Confirm receipt of ${eligibleToReceive.length} eligible packed orders from ${farmItems[0].displayFarmName}? Only continue after physically counting every packet. Orders not yet physically arrived will remain pending.`;
            if (!window.confirm(receiptDescription)) return;
            setIsSaving(true);
            let succeeded = 0;
            try {
              for (const row of eligibleToReceive) {
                if (!row.id || !["scheduled", "in_transit", "ready_for_pickup"].includes(String(row.status || "").toLowerCase()) || !(row.arrivedWarehouseAt || row.warehouseArrivalConfirmed || String(row.collectionStatus || "").toLowerCase() === "arrived_warehouse")) continue;
                await api.put(`/warehouse/me/incoming/${row.id}/receive`, undefined, { params: { quantity: Number(row.quantity || 0), usableQuantity: Number(row.quantity || 0), quality_check: "passed", notes: eventFulfillmentGroup ? "Bulk/event product receipt confirmed by warehouse staff after physical quantity verification." : "Bulk packet receipt confirmed by warehouse staff after physical count." } });
                succeeded++;
              }
              toast.success(eventFulfillmentGroup ? `Received ${succeeded} of ${eligibleToReceive.length} event product lines.` : `Received ${succeeded} of ${farmItems.length} packed orders. Review any remaining orders below.`);
              await refetch();
            } catch (error: any) {
              toast.error(eventFulfillmentGroup ? `Received ${succeeded} event product lines before an error. Refresh and review remaining items.` : `Received ${succeeded} orders before an error. Refresh and review remaining packets.`);
              await refetch();
            } finally { setIsSaving(false); }
          };
          return <section key={farmKey} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.045)] transition-shadow hover:shadow-md"><div className="border-b border-slate-100 bg-slate-50/70 px-4 py-4 sm:px-5"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold tracking-tight">{farmItems[0].displayFarmName}</h2><Badge variant="outline">{eventFulfillmentGroup ? "Bulk/Event Order · Product receipt" : packedFarmerGroup ? "Farmer Fulfillment · Packed orders" : "Normal Warehouse Fulfillment · Bulk stock"}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{farmItems[0].pickupLocation?.address || farmItems[0].farmAddress || "Farm address not available"}</p></div><div className="flex flex-wrap items-center gap-2">{canConfirmAllPackets && <Button size="sm" onClick={confirmAllPackets} disabled={isSaving}><CheckCircle className="mr-2 h-4 w-4" />{isSaving ? "Confirming..." : eventFulfillmentGroup ? "Confirm All Products Received" : "Confirm All Packets Received"}</Button>}{allPackedOrdersReceived && <Button size="sm" onClick={() => { window.location.href = farmContinueHref; }}><ArrowRight className="mr-2 h-4 w-4" />{farmContinueLabel}</Button>}{canReceiveAnyFarmStock && !packedFarmerGroup && <Button size="sm" onClick={() => openBulkReceiveDialog(eligibleToReceive)} disabled={isSaving}><Package className="mr-2 h-4 w-4" />{isSaving ? "Processing..." : "Receive All Stock"}</Button>} {!packedFarmerGroup && receivedCount > 0 && <Button size="sm" variant="outline" onClick={() => printFarmPackingLabels(farmItems.filter((row: any) => {
              const status = String(row.status || "").toLowerCase();
              const hasReceipt = Boolean(row.receiptNumber || row.receipt?.receiptNumber || row.receivedAt || row.receivedDate || row.warehouseReceivedAt || row.quantityReceived !== undefined);
              return ["received", "quality_check", "stored"].includes(status) || hasReceipt;
            }))}><Package className="mr-2 h-4 w-4" />Save & Print Farm Order Labels</Button>}{!packedFarmerGroup && farmItems.some((row: any) => Boolean(row.orderId)) && farmItems.every((row: any) => { const status = String(row.status || "").toLowerCase(); const received = Boolean(row.bulkShipmentReceivedAt || row.receivedAt || row.receivedDate || row.warehouseReceivedAt) || ["received", "quality_check", "stored"].includes(status); const quality = String(row.qualityCheck || row.quality_check || "").toLowerCase(); return received && quality === "passed"; }) && <Button size="sm" variant="outline" onClick={() => { window.location.href = "/packing?farm=" + encodeURIComponent(String(farmKey)); }}><ArrowRight className="mr-2 h-4 w-4" />Continue to Order Packing ({farmItems.filter((row: any) => Boolean(row.orderId)).length})</Button>}</div></div><div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4"><div className="rounded-lg border bg-white p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total orders</p><p className="mt-1 text-2xl font-semibold">{farmItems.length}</p></div><div className="rounded-lg border bg-white p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{packedFarmerGroup ? "Packed packets" : "Farmer-declared weight"}</p><p className="mt-1 text-2xl font-semibold">{packedFarmerGroup ? farmItems.length : declaredTotal.toLocaleString() + " kg"}</p></div><div className="rounded-lg border bg-white p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Received</p><p className="mt-1 text-2xl font-semibold">{receivedCount}</p><p className="text-xs text-muted-foreground">{packedFarmerGroup ? "packets received" : receivedQuantityTotal.toLocaleString() + " kg recorded"}</p></div><div className="rounded-lg border bg-white p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Remaining</p><p className="mt-1 text-2xl font-semibold">{pendingCount}</p><p className="text-xs text-muted-foreground">{packedFarmerGroup ? "packets to receive" : Math.max(0, declaredTotal - receivedQuantityTotal).toLocaleString() + " kg to reconcile"}</p></div></div></div><div className="space-y-3 p-3 sm:p-4">{farmItems.map((item: any) => {
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
            <Card key={item.id} className="border-slate-200/90 shadow-none transition-all hover:border-emerald-300 hover:shadow-sm"><CardContent className="p-3 sm:p-4"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-3"><div><p className="font-semibold">{productName}</p><p className="mt-1 text-sm text-muted-foreground">Order: {item.displayOrderNumber || "Order reference unavailable"}</p></div><Badge variant="outline" className={cn("border", statusColors[(isBulkLotReceived(item) && ["scheduled", "in_transit", "ready_for_pickup"].includes(String(item.status || "").toLowerCase()) ? "received" : item.status) as keyof typeof statusColors])}>{statusLabels[(isBulkLotReceived(item) && ["scheduled", "in_transit", "ready_for_pickup"].includes(String(item.status || "").toLowerCase()) ? "received" : item.status) as keyof typeof statusLabels] || item.status}</Badge>{item.qualityCheck === "passed" && <Badge variant="success">Passed QC</Badge>}{item.qualityCheck === "failed" && <Badge variant="destructive">Failed QC</Badge>}</div><div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted-foreground"><span>From farm: {item.displayFarmName || "Farm details unavailable"}</span><span>Quantity: <span className="font-medium text-foreground">{item.quantity}</span></span><span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Expected: {formatDate(item.expectedDate)}</span></div>{item.batchNumber && <p className="mt-1 text-sm text-muted-foreground">Batch: {item.batchNumber}</p>}{item.qualityNotes && <p className="mt-1 text-sm text-yellow-600">{item.qualityNotes}</p>}</div><div className="flex items-center gap-2">{item.status === "scheduled" && <Button size="sm" variant="outline" onClick={() => { setSelectedIncoming(item); setShowTrackDialog(true); }}><Clock className="mr-2 h-4 w-4" />Track</Button>}{canReceiveStock && (isPackedFarmerTransfer ? <Button size="sm" onClick={() => openReceiveDialog(item)}><CheckCircle className="mr-2 h-4 w-4" />Receive Order</Button> : <Badge variant="outline">Use Receive All Stock</Badge>)}{receiptComplete && <Button size="sm" variant="outline" onClick={() => { setSelectedIncoming(item); setShowReceiptDialog(true); }}><Package className="mr-2 h-4 w-4" />View / Reprint Receipt</Button>}
                      {isPackedFarmerTransfer && !hasPhysicallyArrived && <Badge variant="outline" className="border-amber-300 text-amber-700">Awaiting Farm Pickup / Arrival</Badge>}
                      {isPackedFarmerTransfer && (["received", "quality_check", "stored"].includes(String(item.status || "").toLowerCase()) && isReceiptQualityPassed(item)) && <Button size="sm" onClick={() => { window.location.href = nextPage; }}><ArrowRight className="mr-2 h-4 w-4" />{requiresConsolidation ? "Continue to Consolidation" : "Continue to Farmer Fulfillment Transfers"}</Button>}{!isPackedFarmerTransfer && receiptComplete && String(item.qualityCheck || item.quality_check || "").toLowerCase() === "failed" && <Badge variant="destructive">Rejected · contact farm</Badge>}{!isPackedFarmerTransfer && receiptComplete && !isReceiptQualityPassed(item) && String(item.qualityCheck || item.quality_check || "").toLowerCase() !== "failed" && <Badge variant="outline">On hold · resolve receipt discrepancy</Badge>}{!isPackedFarmerTransfer && receiptComplete && isReceiptQualityPassed(item) && item.orderId && <Button size="sm" onClick={() => { window.location.href = "/packing?orderId=" + encodeURIComponent(String(item.orderId)); }}><ArrowRight className="mr-2 h-4 w-4" />Continue to Order Packing</Button>}{!isPackedFarmerTransfer && item.status === "stored" && !item.orderId && <Button size="sm" variant="outline" onClick={() => { window.location.href = "/stock"; }}><Warehouse className="mr-2 h-4 w-4" />View Inventory</Button>}{item.status === "quality_check" && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => openQualityDialog(item)}><XCircle className="mr-2 h-4 w-4" />Inspect</Button></div>}<div className="relative">
                        <Button type="button" variant="ghost" size="icon" aria-label={`Actions for ${productName}`} aria-expanded={openMenuId === item.id} onClick={() => setOpenMenuId((current) => current === item.id ? null : item.id)}><MoreVertical className="h-4 w-4" /></Button>
                        {openMenuId === item.id && <div className="absolute right-0 top-10 z-20 min-w-44 rounded-md border bg-background p-1 shadow-lg">
                          <button type="button" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { setSelectedIncoming(item); setSelectedDetailId(String(item.id || item._id || "")); setShowTrackDialog(true); setOpenMenuId(null); }}>View shipment details</button>
                          {canReceiveStock && isPackedFarmerTransfer && <button type="button" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { openReceiveDialog(item); setOpenMenuId(null); }}>Receive order</button>}
                          {!isPackedFarmerTransfer && receiptComplete && !isReceiptQualityPassed(item) && String(item.qualityCheck || item.quality_check || "").toLowerCase() !== "failed" && <div className="px-3 py-2 text-xs text-muted-foreground">On hold until the receipt discrepancy is resolved.</div>}
                          
                          {!isPackedFarmerTransfer && receiptComplete && isReceiptQualityPassed(item) && item.orderId && <button type="button" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { window.location.href = "/packing?orderId=" + encodeURIComponent(String(item.orderId)); setOpenMenuId(null); }}>Continue to Order Packing</button>}
                          <button type="button" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { void refetch(); setOpenMenuId(null); }}>Refresh status</button>
                        </div>}
                      </div></div></div></CardContent></Card>
          );
        })}</div></section>;
        })}</div>
      )}

        </main>
        <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:sticky xl:top-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-bold tracking-tight text-slate-900">Collection Details</h2>
            {fulfillmentFilter !== "received_warehouse" && <Badge variant="outline">Selected</Badge>}
          </div>
          {fulfillmentFilter === "received_warehouse" ? (
            receivedWarehouseOrders[0] ? <div className="space-y-3"><div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Warehouse transfer</p><p className="mt-1 font-bold text-slate-900">{receivedWarehouseOrders[0].orderNumber || receivedWarehouseOrders[0].displayOrderNumber || "Order reference"}</p><p className="text-sm text-slate-600">{receivedWarehouseOrders[0].productName || "Packed customer order"}</p><p className="text-xs text-slate-500">{String(receivedWarehouseOrders[0].transferStatus || receivedWarehouseOrders[0].status || "received").replace(/_/g," ")}</p></div><Button className="w-full" asChild><Link href="/warehouse/farmer-fulfillment">Open Transfer Details</Link></Button></div> : <p className="text-sm text-slate-500">Destination warehouse transfers will appear here when available.</p>
          ) : incomingList.length ? (() => {
            const item = incomingList.find((row: any) => String(row.id || row._id || "") === selectedDetailId) || incomingList[0];
            const arrived = Boolean(item.arrivedWarehouseAt || item.warehouseArrivalConfirmed || String(item.collectionStatus || "").toLowerCase() === "arrived_warehouse");
            const received = ["received","quality_check","stored","rejected"].includes(String(item.status || "").toLowerCase()) || Boolean(item.receivedAt || item.receivedDate || item.warehouseReceivedAt);
            const rawQuality = String(item.qualityCheck || item.quality_check || "").toLowerCase();
            const quality = received ? (rawQuality || (getIncomingDisplayStatus(item) === "quality_passed" ? "passed" : "pending")) : "not_started";
            const displayStatus = getIncomingDisplayStatus(item);
            const isPacked = isFarmerPackedIncoming(item);
            return <div className="space-y-4">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Truck className="h-6 w-6"/></span>
                <div className="min-w-0"><p className="break-all font-bold text-slate-900">{item.displayOrderNumber || item.id || "Collection"}</p><p className="text-sm font-medium text-slate-700">{item.displayFarmName || getFarmDisplayName(item)}</p><p className="mt-0.5 text-xs text-slate-500">{item.pickupLocation?.address || item.farmAddress || "Farm location unavailable"}</p></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-slate-200 p-3"><p className="text-xs text-slate-500">Expected quantity</p><p className="mt-1 text-lg font-bold text-slate-900">{item.quantity ?? "—"} {item.unit || "kg"}</p></div>
                <div className="rounded-xl border border-slate-200 p-3"><p className="text-xs text-slate-500">Current status</p><p className="mt-1 text-sm font-semibold capitalize text-slate-900">{(statusLabels[displayStatus] || displayStatus.replace(/_/g," "))}</p></div>
              </div>
              <div><p className="mb-2 text-sm font-semibold text-slate-900">Shipment information</p><div className="space-y-2.5 text-sm">
                <div className="flex justify-between gap-3"><span className="text-slate-500">Product</span><span className="text-right font-medium text-slate-800">{item.displayProductName || getProductDisplayName(item)}</span></div>
                <div className="flex justify-between gap-3"><span className="text-slate-500">Expected date</span><span className="text-right font-medium text-slate-800">{formatDate(item.expectedDate)}</span></div>
                <div className="flex justify-between gap-3"><span className="text-slate-500">Arrival confirmed</span><span className={cn("font-semibold",arrived?"text-emerald-700":"text-amber-700")}>{arrived ? "Yes" : "No"}</span></div>
                <div className="flex justify-between gap-3"><span className="text-slate-500">Receipt</span><span className="font-medium text-slate-800">{received ? "Recorded" : "Pending"}</span></div>
                <div className="flex justify-between gap-3"><span className="text-slate-500">Quality</span><span className={cn("font-semibold capitalize",quality==="passed"?"text-emerald-700":quality==="failed"?"text-red-700":"text-amber-700")}>{quality === "not_started" ? "Not started — awaiting receipt" : quality}</span></div>
              </div></div>
              <div><p className="mb-2 text-sm font-semibold text-slate-900">Workflow progress</p><div className="space-y-2">
                {[
                  {label:"Farm collection / arrival",done:arrived},
                  {label:"Receive collection",done:received},
                  {label:isPacked?"Farmer fulfillment transfer":"Quality check passed",done:isPacked?received:quality==="passed"},
                ].map((step,index)=><div key={step.label} className="flex items-center gap-2.5"><span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",step.done?"bg-emerald-100 text-emerald-800":"bg-slate-100 text-slate-500")}>{step.done?<CheckCircle className="h-3.5 w-3.5"/>:index+1}</span><span className={cn("text-xs",step.done?"font-medium text-slate-800":"text-slate-500")}>{step.label}</span></div>)}
              </div></div>
              <div className="space-y-2 border-t border-slate-100 pt-3">
                {arrived && !received && isPacked && <Button className="w-full" onClick={()=>openReceiveDialog(item)}><CheckCircle className="mr-2 h-4 w-4"/>Receive Collection</Button>}
                {received && <Button variant="outline" className="w-full" onClick={()=>{setSelectedIncoming(item);setShowReceiptDialog(true);}}>View Receipt Details</Button>}
                {received && getReceiptQuality(item) === "pending" && !isPacked && <Button className="w-full" onClick={()=>openQualityDialog(item)}><ShieldCheck className="mr-2 h-4 w-4"/>Complete Quality Check</Button>}
                {received && getReceiptQuality(item) !== "pending" && <Button className="w-full" onClick={()=>printIncomingPackingReceipt(item, Number(item.receipt?.receivedQuantity ?? item.quantityReceived ?? item.quantity ?? 0), Number(item.receipt?.usableQuantity ?? item.usableQuantity ?? item.quantityReceived ?? item.quantity ?? 0))}><Package className="mr-2 h-4 w-4"/>Reprint Receipt</Button>}
                <Button variant="outline" className="w-full" onClick={()=>{setSelectedIncoming(item);setShowTrackDialog(true);}}>View Shipment Details</Button>
              </div>
            </div>;
          })() : <p className="text-sm text-slate-500">No collection matches the current filters.</p>}
        </aside>
      </div>
      <Dialog open={showBulkReceiveDialog} onOpenChange={setShowBulkReceiveDialog}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Receive Bulk Stock — {bulkFarmItems[0]?.displayFarmName || "Farm"}</DialogTitle><DialogDescription>Receive and inspect the farmer’s shipment as one bulk lot. Measure the total bulk weight and perform one overall quality check here. Individual customer orders are not weighed or quality-checked at receipt; use their order details later to print labels and pack the correct quantities in Order Packing.</DialogDescription></DialogHeader>
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-3"><div><p className="text-muted-foreground">Order labels</p><p className="text-lg font-bold">{bulkFarmItems.length}</p></div><div><p className="text-muted-foreground">Declared bulk total</p><p className="text-lg font-bold">{bulkFarmItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0).toLocaleString()} kg</p></div><div><p className="text-muted-foreground">Actual measured total</p><p className="text-lg font-bold">{bulkMeasuredTotal ? `${Number(bulkMeasuredTotal).toLocaleString()} kg` : "Not entered"}</p></div></div>
          <form className="space-y-4" onSubmit={handleBulkReceive}>
            <div className="rounded-lg border bg-slate-50 p-3"><p className="font-semibold">{bulkFarmItems[0]?.displayFarmName || getFarmDisplayName(bulkFarmItems[0] || {})}</p><p className="text-sm text-muted-foreground">{bulkFarmItems[0]?.pickupLocation?.address || bulkFarmItems[0]?.farmAddress || "Farm address not available"}</p><div className="mt-2 text-sm text-muted-foreground">This bulk receipt contains {bulkFarmItems.length} order label references. The warehouse packing team will weigh/allocate each order and attach its printed label after the bulk stock has been accepted.</div><div className="mt-3 space-y-2">{bulkFarmItems.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded border bg-white px-3 py-2"><div><p className="font-medium">{item.displayProductName || getProductDisplayName(item)}</p><p className="text-xs text-muted-foreground">Order {item.displayOrderNumber || item.orderNumber || item.order?.orderNumber || "reference unavailable"}</p></div><Badge variant="outline">Label / packing reference</Badge></div>)}</div></div>
            <div className="grid gap-3 sm:grid-cols-2"><div><label className="text-sm font-medium">Actual total bulk weight received (kg)</label><Input type="number" min="0.01" step="0.01" value={bulkMeasuredTotal} onChange={(e) => setBulkMeasuredTotal(e.target.value)} placeholder="e.g. 100" required /></div><div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">Quality inspection will be completed separately after the warehouse receipt is recorded.</div></div>
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
              <p className="mt-1">Status: <span className="font-semibold">{statusLabels[getIncomingDisplayStatus(selectedIncoming)] || getIncomingDisplayStatus(selectedIncoming) || "Unknown"}</span></p>
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

      <Dialog open={showReceiptDialog} onOpenChange={setShowReceiptDialog} contentClassName="!w-[min(96vw,980px)] !max-w-[980px] !max-h-[calc(100dvh-2rem)] !overflow-hidden !p-0 sm:!p-0">
        <DialogContent
          className="!w-[92vw] !max-w-[980px] sm:!max-w-[980px] overflow-hidden rounded-2xl border-slate-200 p-0 shadow-2xl"
          style={{ width: "min(96vw, 980px)", minWidth: "min(96vw, 980px)", maxWidth: "980px", height: "auto", maxHeight: "calc(100dvh - 32px)" }}
        >
          {selectedIncoming && (() => {
            const receipt = selectedIncoming.receipt || {};
            const order = selectedIncoming.order || {};
            const receiptNumber = getHumanReceiptNumber(selectedIncoming);
            const receivedAt = receipt.receivedAt || selectedIncoming.receivedAt || selectedIncoming.receivedDate;
            const quality = getReceiptQuality(selectedIncoming);
            const qualityLabel = quality === "passed" ? "Quality passed" : quality === "failed" ? "Quality failed" : "Quality inspection pending";
            const quantityUnit = receipt.unit || selectedIncoming.unit || "kg";
            const deliveryAddress = receipt.deliveryAddress || selectedIncoming.deliveryAddress || order.deliveryAddress || order.shippingAddress;
            const addressText = typeof deliveryAddress === "string" ? deliveryAddress : [
              deliveryAddress?.addressLine1, deliveryAddress?.addressLine2, deliveryAddress?.area,
              deliveryAddress?.city, deliveryAddress?.district, deliveryAddress?.state,
              deliveryAddress?.postalCode || deliveryAddress?.pincode,
            ].filter(Boolean).join(", ");
            const orderReference = receipt.orderNumber || selectedIncoming.orderNumber || order.orderNumber || selectedIncoming.displayOrderNumber || selectedIncoming.orderId || "Order reference unavailable";
            const customerName = receipt.customerName || selectedIncoming.customerName || order.customerName || order.customer?.name || "Customer details unavailable";
            const customerPhone = receipt.customerPhone || selectedIncoming.customerPhone || order.customerPhone || order.customer?.phone;
            const warehouseName = receipt.warehouseName || selectedIncoming.warehouseName || selectedIncoming.warehouse?.name || "Warehouse details unavailable";
            const farmName = receipt.farmName || getFarmDisplayName(selectedIncoming);
            const declared = receipt.declaredQuantity ?? selectedIncoming.quantity ?? "—";
            const receivedQuantity = Number(receipt.receivedQuantity ?? selectedIncoming.quantityReceived ?? selectedIncoming.quantity ?? 0);
            const usable = Number(receipt.usableQuantity ?? selectedIncoming.usableQuantity ?? selectedIncoming.quantityReceived ?? selectedIncoming.quantity ?? 0);
            const rejected = receipt.rejectedQuantity ?? selectedIncoming.quantityRejected ?? Math.max(0, receivedQuantity - usable);
            const productName = selectedIncoming.displayProductName || selectedIncoming.productName || selectedIncoming.product?.name || "Product details unavailable";
            const compactCard = "min-w-0 rounded-xl border border-slate-200 bg-white p-3";
            return <div className="flex min-h-0 flex-col overflow-hidden">
              <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-3.5 sm:px-6">
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700"><Package className="h-3.5 w-3.5"/>AgriConnect · Warehouse</div>
                  <DialogHeader className="space-y-0 text-left">
                    <DialogTitle className="text-lg font-bold tracking-tight text-slate-900">Warehouse receipt</DialogTitle>
                    <DialogDescription className="text-xs text-slate-500">Receipt, shipment and quality inspection details</DialogDescription>
                  </DialogHeader>
                </div>
                <Badge variant="outline" className={cn("shrink-0 px-3 py-1 text-xs font-semibold", quality === "passed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : quality === "failed" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800")}>{qualityLabel}</Badge>
              </div>

              <div className="grid min-w-0 grid-cols-2 gap-2 overflow-hidden p-3 sm:gap-3 sm:p-4">
                <div className="col-span-2 flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-emerald-800">Receipt number</p>
                    <p className="break-all font-mono text-sm font-bold tracking-wide text-slate-900 sm:text-base">{receiptNumber}</p>
                    <p className="text-[9px] text-slate-600">Use this reference for receipt enquiries</p>
                  </div>
                  <div className="min-w-0 text-right">
                    <p className="text-[9px] text-slate-500">Received on</p>
                    <p className="text-[10px] font-semibold text-slate-800 sm:text-xs">{receivedAt ? new Date(receivedAt).toLocaleString() : "Not recorded"}</p>
                  </div>
                </div>

                <div className="col-span-2 grid min-w-0 grid-cols-2 gap-2">
                  <div className="min-w-0 rounded-lg border border-slate-200 p-2">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Order & product</p>
                    <p className="mt-0.5 break-all text-[10px] font-semibold leading-tight text-slate-900 sm:text-xs">{orderReference}</p>
                    <p className="mt-0.5 break-words text-[10px] text-slate-600">{productName}</p>
                  </div>
                  <div className="min-w-0 rounded-lg border border-slate-200 p-2">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Warehouse & farm</p>
                    <p className="mt-0.5 break-words text-[10px] font-semibold leading-tight text-slate-900 sm:text-xs">{warehouseName}</p>
                    <p className="mt-0.5 break-words text-[10px] text-slate-600">Farm: {farmName}</p>
                  </div>
                  <div className="min-w-0 rounded-lg border border-slate-200 p-2">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Customer</p>
                    <p className="mt-0.5 break-words text-[10px] font-semibold leading-tight text-slate-900 sm:text-xs">{customerName}</p>
                    <p className="mt-0.5 break-words text-[10px] text-slate-600">{customerPhone || "Phone not available"}</p>
                  </div>
                  <div className="min-w-0 rounded-lg border border-slate-200 p-2">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Delivery address</p>
                    <p className="mt-0.5 break-words text-[9px] leading-snug text-slate-700 sm:text-[10px]">{addressText || "Address not available"}</p>
                  </div>
                </div>

                <section className="min-w-0 rounded-lg border border-slate-200 p-2">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1"><h3 className="text-[10px] font-bold text-slate-900">Quantity summary</h3><span className="text-[9px] text-slate-500">{quantityUnit}</span></div>
                  <div className="grid grid-cols-2 gap-1">
                    {[{label:"Declared",value:declared},{label:"Received",value:receivedQuantity},{label:"Usable",value:usable},{label:"Rejected",value:rejected}].map((metric)=> <div key={metric.label} className="rounded-md bg-slate-50 px-1.5 py-1"><p className="text-[8px] font-medium text-slate-500">{metric.label}</p><p className="text-xs font-bold tabular-nums text-slate-900">{metric.value} <span className="text-[8px] font-medium text-slate-500">{quantityUnit}</span></p></div>)}
                  </div>
                </section>

                <section className="min-w-0 rounded-lg border border-slate-200 p-2">
                  <div className="flex flex-wrap items-center justify-between gap-1"><h3 className="text-[10px] font-bold text-slate-900">Quality inspection</h3><Badge variant="outline" className={cn("px-1.5 py-0 text-[8px]", quality === "passed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : quality === "failed" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800")}>{qualityLabel}</Badge></div>
                  <p className="mt-1 text-[9px] leading-snug text-slate-600">{receipt.qualityNotes || selectedIncoming.qualityNotes || selectedIncoming.notes || (quality === "pending" ? "Inspection has not been completed." : "No inspection notes recorded.")}</p>
                  {quality === "pending" && !isFarmerPackedIncoming(selectedIncoming) && <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2">
                    <Input className="h-7 px-2 text-[9px]" value={qualityNotes} onChange={(event) => setQualityNotes(event.target.value)} placeholder="Inspection notes (optional)"/>
                    <div className="flex flex-col gap-1">
                      <Button type="button" size="sm" variant="destructive" className="h-7 w-full px-1 text-[9px]" disabled={isSaving} onClick={() => handleQuality("failed")}><ShieldAlert className="mr-1 h-3 w-3"/>{isSaving ? "Saving..." : "Mark Failed"}</Button>
                      <Button type="button" size="sm" className="h-7 w-full px-1 text-[9px]" disabled={isSaving} onClick={() => handleQuality("passed")}><CheckCircle className="mr-1 h-3 w-3"/>{isSaving ? "Saving..." : "Approve Quality"}</Button>
                    </div>
                  </div>}
                </section>
                {!selectedIncoming.receipt && <p className="col-span-2 rounded-md border border-blue-200 bg-blue-50 p-2 text-[9px] leading-snug text-blue-900">Legacy receipt: details are reconstructed from the shipment information currently available.</p>}
              </div>

              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:px-5">
                <Button type="button" size="sm" variant="outline" onClick={() => setShowReceiptDialog(false)}>Close</Button>
                {quality !== "pending" ? <Button type="button" size="sm" onClick={() => printIncomingPackingReceipt(selectedIncoming, receivedQuantity, usable)}><Package className="mr-2 h-4 w-4"/>Reprint Receipt</Button> : <p className="text-[10px] text-amber-700">Complete quality inspection to enable reprinting.</p>}
              </div>
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
