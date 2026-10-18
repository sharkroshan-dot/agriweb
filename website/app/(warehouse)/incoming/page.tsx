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
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [fulfillmentFilter, setFulfillmentFilter] = useState<"all" | "farmer" | "warehouse">("all");
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
  const [qualityNotes, setQualityNotes] = useState("");
  const [showBulkReceiveDialog, setShowBulkReceiveDialog] = useState(false);
  const [bulkFarmItems, setBulkFarmItems] = useState<any[]>([]);
  const [bulkMeasuredTotal, setBulkMeasuredTotal] = useState("");
  const [bulkQualityResult, setBulkQualityResult] = useState<"passed" | "pending" | "failed">("passed");
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
        const receiveResponse = await api.put("/warehouse/me/incoming/" + item.id + "/receive", undefined, { params: { quantity: Number(item.quantity || 0), usableQuantity: Number(item.quantity || 0), quality_check: bulkQualityResult, notes: [bulkReceiveNotes.trim(), `Bulk shipment receipt: declared ${declaredTotal} kg; measured ${measuredTotal} kg; overall quality ${bulkQualityResult}. Per-order quantities are labels/packing references and were not individually weighed at receipt.`].filter(Boolean).join(" | ") } });
        succeeded++;
        const savedIncoming = receiveResponse?.data?.data || receiveResponse?.data || item;
        // Print all order labels together after the farm receipt is saved.
      }
      toast.success(`Recorded bulk receipt for ${succeeded} order labels. Overall quality: ${bulkQualityResult}. Total measured: ${measuredTotal} kg. Individual order weighing belongs in Order Packing.`);
      setShowBulkReceiveDialog(false); setBulkMeasuredTotal(""); setBulkQualityResult("passed"); await refetch();
    } catch (error: any) {
      toast.error("Processed " + succeeded + " of " + bulkFarmItems.length + " label records. Refresh and review remaining records before retrying."); await refetch();
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
      <style>body{font-family:Arial,sans-serif;color:#111;padding:28px;max-width:760px;margin:auto}h1{margin-bottom:4px;font-size:24px}.muted{color:#555;font-size:12px}.panel{border:1px solid #777;padding:14px;margin-top:16px}.row{display:flex;justify-content:space-between;gap:20px;padding:12px 4px;border-bottom:1px solid #ddd}.row:last-child{border-bottom:0}.label{font-weight:700;min-width:190px}.value{text-align:right;overflow-wrap:anywhere}</style></head><body>
      <h1>AGRICONNECT</h1><div class="muted">WAREHOUSE RECEIPT</div>
      <div class="panel">
      <div class="row"><span class="label">Receipt number</span><span class="value">${escapeHtml(receiptNumber)}</span></div>
      <div class="row"><span class="label">Order ID / order number</span><span class="value">${escapeHtml(orderNumber)}${item?.orderId ? " / " + escapeHtml(item.orderId) : ""}</span></div>
      <div class="row"><span class="label">Receipt date and time</span><span class="value">${escapeHtml(receiptDateTime ? new Date(receiptDateTime).toLocaleString() : "Date/time unavailable")}</span></div>
      <div class="row"><span class="label">Warehouse name</span><span class="value">${escapeHtml(warehouseName)}</span></div>
      <div class="row"><span class="label">Farm / farmer name</span><span class="value">${escapeHtml(farmName)}</span></div>
      <div class="row"><span class="label">Customer name</span><span class="value">${escapeHtml(customerName)}</span></div>
      <div class="row"><span class="label">Customer phone number</span><span class="value">${escapeHtml(customerPhone)}</span></div>
      <div class="row"><span class="label">Complete delivery address</span><span class="value">${escapeHtml(addressText || "Delivery address unavailable")}</span></div>
      </div><script>window.onload=()=>window.print();</script></body></html>`);
    win.document.close();
  };

  const printFarmPackingLabels = (items: any[]) => {
    if (!items.length) { toast.error("No received order labels are available for this farm."); return; }
    const win = window.open("", "_blank", "width=900,height=900");
    if (!win) { toast.error("Allow pop-ups to print farm packing labels."); return; }
    const esc = (value: unknown) => String(value ?? "—").replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char] as string));
    const farm = items[0]?.displayFarmName || getFarmDisplayName(items[0]);
    const labels = items.map((item) => {
      const order = item.order || {};
      const address = item.deliveryAddress || item.shippingAddress || order.deliveryAddress || order.shippingAddress || order.address || item.customer?.address || order.customer?.address || {};
      const addressText = typeof address === "string" ? address : [
        address.formattedAddress, address.fullAddress, address.addressLine1, address.addressLine2,
        address.line1, address.line2, address.streetAddress, address.street, address.village,
        address.locality, address.area, address.city, address.district, address.state,
        address.pinCode || address.pincode || address.postalCode || address.zipCode,
        typeof address.location === "string" ? address.location : ""
      ].filter(Boolean).join(", ");
      const customer = item.customerName || order.customerName || order.customer?.name || item.customer?.name || "Customer details unavailable";
      const phone = item.customerPhone || order.customerPhone || order.customer?.phone || item.customer?.phone || "Phone unavailable";
      const product = item.displayProductName || getProductDisplayName(item);
      const number = item.displayOrderNumber || item.orderNumber || order.orderNumber || item.orderId || item.id;
      return "<section class='label'><h2>AGRICONNECT — ORDER PACKING LABEL</h2><p><b>Farm:</b> " + esc(farm) + "</p><p><b>Order:</b> " + esc(number) + "</p><p><b>Order ID:</b> " + esc(item.orderId || order._id || item.id) + "</p><p><b>Product:</b> " + esc(product) + "</p><p><b>Quantity to pack:</b> " + esc(item.quantity) + " " + esc(item.unit || "kg") + "</p><p><b>Customer:</b> " + esc(customer) + "</p><p><b>Phone:</b> " + esc(phone) + "</p><p><b>Delivery address:</b> " + esc(addressText || "Not available") + "</p><p class='note'>Verify allocated quantity and attach this label to the finished order.</p></section>";
    }).join("");
    win.document.write("<!doctype html><html><head><meta charset='utf-8'/><title>Farm Packing Labels</title><style>body{font-family:Arial,sans-serif;color:#111;margin:20px}.label{border:2px solid #222;padding:18px;margin:0 0 20px;break-inside:avoid;page-break-after:always}.label:last-child{page-break-after:auto}h2{font-size:17px;margin-top:0}p{font-size:14px;margin:9px 0}.note{border-top:1px solid #aaa;padding-top:10px;font-size:12px}@media print{body{margin:0}.label{margin:0;border:1px solid #222;min-height:90vh}}</style></head><body>" + labels + "<script>window.onload=function(){window.print();}</script></body></html>");
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
      const receiveResponse = await api.put(`/warehouse/me/incoming/${selectedIncoming.id}/receive`, undefined, {
        params: {
          quantity: Number(receiveForm.quantity),
          usableQuantity: Number(receiveForm.usableQuantity),
          quality_check: !isFarmerPacked && quantityMismatch ? "pending" : receiveForm.qualityCheck,
          notes: receiveForm.notes.trim() || undefined,
        },
      });
      const savedIncoming = receiveResponse?.data?.data || receiveResponse?.data || selectedIncoming;
      if (!isFarmerPacked && !quantityMismatch && receiveForm.qualityCheck === "passed") {
        printIncomingPackingReceipt({ ...selectedIncoming, ...savedIncoming }, actualQuantity, Number(receiveForm.usableQuantity));
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

  const isReceiptQualityPassed = (row: any) => { const qc = String(row.qualityCheck || row.quality_check || "").toLowerCase(); if (qc === "failed") return false; if (qc === "passed") return true; const status = String(row.status || "").toLowerCase(); const declared = Number(row.quantity || 0); const actual = Number(row.quantityReceived ?? row.receivedQuantity ?? row.actualQuantityReceived ?? 0); return ["received", "quality_check", "stored"].includes(status) && declared > 0 && actual >= declared - 0.001; };

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
          const receivedCount = farmItems.filter((row: any) => ["received", "quality_check", "stored", "rejected"].includes(String(row.status || "").toLowerCase()) || Boolean(row.receivedAt || row.receivedDate || row.warehouseReceivedAt)).length;
          const passedBulkItems = farmItems.filter((row: any) => !isFarmerPackedIncoming(row) && ["received", "quality_check"].includes(String(row.status || "").toLowerCase()) && isReceiptQualityPassed(row));
          const storedBulkItems = farmItems.filter((row: any) => !isFarmerPackedIncoming(row) && String(row.status || "").toLowerCase() === "stored");
          const pendingCount = Math.max(0, farmItems.length - receivedCount);
          const receivedQuantityTotal = farmItems.reduce((sum: number, row: any) => sum + Number(row.quantityReceived ?? ((row.status === "received" || row.status === "stored") ? row.quantity : 0) ?? 0), 0);
          const declaredTotal = farmItems.reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0);
          const eligibleToReceive = farmItems.filter((row: any) => ["scheduled", "in_transit", "ready_for_pickup"].includes(String(row.status || "").toLowerCase()) && Boolean(row.arrivedWarehouseAt || row.warehouseArrivalConfirmed || String(row.collectionStatus || "").toLowerCase() === "arrived_warehouse"));
          const canConfirmAllPackets = packedFarmerGroup && eligibleToReceive.length > 0;
          const canReceiveAllBulk = !packedFarmerGroup && eligibleToReceive.length > 0;
          const canReceiveAnyFarmStock = eligibleToReceive.length > 0;
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
          return <section key={farmKey} className="overflow-hidden rounded-xl border bg-white shadow-sm"><div className="border-b bg-slate-50/80 px-4 py-4 sm:px-5"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold tracking-tight">{farmItems[0].displayFarmName}</h2><Badge variant="outline">{packedFarmerGroup ? "Farmer Fulfillment · Packed orders" : "Normal Warehouse Fulfillment · Bulk stock"}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{farmItems[0].pickupLocation?.address || farmItems[0].farmAddress || "Farm address not available"}</p></div><div className="flex flex-wrap items-center gap-2">{canConfirmAllPackets && <Button size="sm" onClick={confirmAllPackets} disabled={isSaving}><CheckCircle className="mr-2 h-4 w-4" />{isSaving ? "Confirming..." : "Confirm All Packets Received"}</Button>}{allPackedOrdersReceived && <Button size="sm" onClick={() => { window.location.href = farmContinueHref; }}><ArrowRight className="mr-2 h-4 w-4" />Continue Farm Orders to {farmContinueLabel}</Button>}{canReceiveAnyFarmStock && <Button size="sm" onClick={() => packedFarmerGroup ? confirmAllPackets() : openBulkReceiveDialog(eligibleToReceive)} disabled={isSaving}><Package className="mr-2 h-4 w-4" />{isSaving ? "Processing..." : packedFarmerGroup ? "Confirm All Packets Received" : "Receive All Stock"}</Button>} {!packedFarmerGroup && receivedCount > 0 && <Button size="sm" variant="outline" onClick={() => printFarmPackingLabels(farmItems.filter((row: any) => ["received", "quality_check", "stored"].includes(String(row.status || "").toLowerCase()) && isReceiptQualityPassed(row)))}><Package className="mr-2 h-4 w-4" />Save & Print Farm Order Labels</Button>}{!packedFarmerGroup && farmItems.some((row: any) => Boolean(row.orderId)) && farmItems.every((row: any) => ["received", "quality_check", "stored"].includes(String(row.status || "").toLowerCase()) && isReceiptQualityPassed(row)) && <Button size="sm" variant="outline" onClick={() => { window.location.href = "/packing"; }}>Continue to Order Packing ({farmItems.filter((row: any) => Boolean(row.orderId)).length})</Button>}</div></div><div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4"><div className="rounded-lg border bg-white p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total orders</p><p className="mt-1 text-2xl font-semibold">{farmItems.length}</p></div><div className="rounded-lg border bg-white p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{packedFarmerGroup ? "Packed packets" : "Farmer-declared weight"}</p><p className="mt-1 text-2xl font-semibold">{packedFarmerGroup ? farmItems.length : declaredTotal.toLocaleString() + " kg"}</p></div><div className="rounded-lg border bg-white p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Received</p><p className="mt-1 text-2xl font-semibold">{receivedCount}</p><p className="text-xs text-muted-foreground">{packedFarmerGroup ? "packets received" : receivedQuantityTotal.toLocaleString() + " kg recorded"}</p></div><div className="rounded-lg border bg-white p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Remaining</p><p className="mt-1 text-2xl font-semibold">{pendingCount}</p><p className="text-xs text-muted-foreground">{packedFarmerGroup ? "packets to receive" : Math.max(0, declaredTotal - receivedQuantityTotal).toLocaleString() + " kg to reconcile"}</p></div></div></div><div className="space-y-3 p-3 sm:p-4">{farmItems.map((item: any) => {
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
            <Card key={item.id}><CardContent className="p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-3"><div><p className="font-semibold">{productName}</p><p className="mt-1 text-sm text-muted-foreground">Order: {item.displayOrderNumber || "Order reference unavailable"}</p></div><Badge variant="outline" className={cn("border", statusColors[item.status as keyof typeof statusColors])}>{statusLabels[item.status as keyof typeof statusLabels] || item.status}</Badge>{item.qualityCheck === "passed" && <Badge variant="success">Passed QC</Badge>}{item.qualityCheck === "failed" && <Badge variant="destructive">Failed QC</Badge>}</div><div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted-foreground"><span>From farm: {item.displayFarmName || "Farm details unavailable"}</span><span>Quantity: <span className="font-medium text-foreground">{item.quantity}</span></span><span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Expected: {formatDate(item.expectedDate)}</span></div>{item.batchNumber && <p className="mt-1 text-sm text-muted-foreground">Batch: {item.batchNumber}</p>}{item.qualityNotes && <p className="mt-1 text-sm text-yellow-600">{item.qualityNotes}</p>}</div><div className="flex items-center gap-2">{item.status === "scheduled" && <Button size="sm" variant="outline" onClick={() => { setSelectedIncoming(item); setShowTrackDialog(true); }}><Clock className="mr-2 h-4 w-4" />Track</Button>}{canReceiveStock && (isPackedFarmerTransfer ? <Button size="sm" onClick={() => openReceiveDialog(item)}><CheckCircle className="mr-2 h-4 w-4" />Receive Order</Button> : <Badge variant="outline">Use Receive All Stock</Badge>)}{receiptComplete && <Button size="sm" variant="outline" onClick={() => { setSelectedIncoming(item); setShowReceiptDialog(true); }}><Package className="mr-2 h-4 w-4" />View / Reprint Receipt</Button>}
                      {isPackedFarmerTransfer && !hasPhysicallyArrived && <Badge variant="outline" className="border-amber-300 text-amber-700">Awaiting Farm Pickup / Arrival</Badge>}
                      {isPackedFarmerTransfer && (item.status === "received" || item.status === "stored") && <Button size="sm" onClick={() => { window.location.href = nextPage; }}><ArrowRight className="mr-2 h-4 w-4" />{requiresConsolidation ? "Continue to Consolidation" : "Continue to Farmer Fulfillment Transfers"}</Button>}{!isPackedFarmerTransfer && receiptComplete && String(item.qualityCheck || item.quality_check || "").toLowerCase() === "failed" && <Badge variant="destructive">Rejected · contact farm</Badge>}{!isPackedFarmerTransfer && receiptComplete && !isReceiptQualityPassed(item) && String(item.qualityCheck || item.quality_check || "").toLowerCase() !== "failed" && <Badge variant="outline">On hold · resolve receipt discrepancy</Badge>}{!isPackedFarmerTransfer && receiptComplete && isReceiptQualityPassed(item) && item.orderId && <Button size="sm" onClick={() => { window.location.href = "/packing"; }}><ArrowRight className="mr-2 h-4 w-4" />Continue to Order Packing</Button>}{!isPackedFarmerTransfer && item.status === "stored" && !item.orderId && <Button size="sm" variant="outline" onClick={() => { window.location.href = "/stock"; }}><Warehouse className="mr-2 h-4 w-4" />View Inventory</Button>}{item.status === "quality_check" && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => openQualityDialog(item)}><XCircle className="mr-2 h-4 w-4" />Inspect</Button></div>}<div className="relative">
                        <Button type="button" variant="ghost" size="icon" aria-label={`Actions for ${productName}`} aria-expanded={openMenuId === item.id} onClick={() => setOpenMenuId((current) => current === item.id ? null : item.id)}><MoreVertical className="h-4 w-4" /></Button>
                        {openMenuId === item.id && <div className="absolute right-0 top-10 z-20 min-w-44 rounded-md border bg-background p-1 shadow-lg">
                          <button type="button" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { setSelectedIncoming(item); setShowTrackDialog(true); setOpenMenuId(null); }}>View shipment details</button>
                          {canReceiveStock && isPackedFarmerTransfer && <button type="button" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { openReceiveDialog(item); setOpenMenuId(null); }}>Receive order</button>}
                          {!isPackedFarmerTransfer && receiptComplete && !isReceiptQualityPassed(item) && String(item.qualityCheck || item.quality_check || "").toLowerCase() !== "failed" && <div className="px-3 py-2 text-xs text-muted-foreground">On hold until the receipt discrepancy is resolved.</div>}
                          
                          {!isPackedFarmerTransfer && receiptComplete && isReceiptQualityPassed(item) && item.orderId && <button type="button" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { window.location.href = "/packing"; setOpenMenuId(null); }}>Continue to Order Packing</button>}
                          <button type="button" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { void refetch(); setOpenMenuId(null); }}>Refresh status</button>
                        </div>}
                      </div></div></div></CardContent></Card>
          );
        })}</div></section>;
        })}</div>
      )}

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
