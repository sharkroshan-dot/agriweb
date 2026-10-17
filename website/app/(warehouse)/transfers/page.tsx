"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRight, Search, CheckCircle, XCircle, Clock, ArrowUpRight, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { formatDate } from "../../lib/utils";
import { api } from "../../lib/api/client";
import toast from "react-hot-toast";

const humanizeKey = (key: string) => {
  const labels: Record<string, string> = {
    orderNumber: "Order Number", orderId: "Order ID", displayOrderId: "Order Number",
    productName: "Product", productId: "Product ID", displayName: "Product",
    quantity: "Quantity", displayQuantity: "Quantity", totalQuantity: "Total Quantity",
    status: "Order Status", displayStatus: "Order Status", currentStage: "Current Stage",
    warehouseFulfillmentStage: "Warehouse Fulfillment Stage", transferStatus: "Transfer Status",
    fulfillmentMethod: "Fulfillment Type", fulfillmentType: "Fulfillment Type",
    sourceName: "From", sourceWarehouseName: "Source Warehouse", sourceWarehouseId: "Source Warehouse ID",
    destinationName: "To", destinationWarehouseName: "Destination Warehouse", destinationWarehouseId: "Destination Warehouse ID",
    destinationDistrict: "Delivery District", deliveryDistrict: "Delivery District", sourceDistrict: "Source District",
    customerName: "Customer", customerId: "Customer ID", customerPhone: "Customer Phone",
    deliveryAddress: "Delivery Address", shippingAddress: "Shipping Address", address: "Address",
    paymentStatus: "Payment Status", paymentMethod: "Payment Method", totalAmount: "Order Total",
    subtotal: "Subtotal", deliveryFee: "Delivery Fee", createdAt: "Order Created", updatedAt: "Last Updated",
    dispatchedAt: "Dispatched At", receivedAt: "Received At", deliveredAt: "Delivered At",
    routeDistanceKm: "Route Distance", nearbyThresholdKm: "Nearby Threshold",
    reason: "Transfer Reason", notes: "Notes", items: "Items", orderItems: "Order Items",
    batchNumber: "Batch Number", deliveryPartnerName: "Delivery Partner", trackingNumber: "Tracking Number",
    warehouseId: "Warehouse ID", farmerName: "Farmer", farmerId: "Farmer ID",
  };
  return labels[key] || key.replace(/([A-Z])/g, " $1").replace(/[_-]/g, " ").replace(/^./, s => s.toUpperCase()).trim();
};
const humanizeValue = (value: any, key = ""): string => {
  if (value === null || value === undefined || value === "") return "Not provided";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    if (!value.length) return "None";
    return value.map((item, index) => {
      if (item && typeof item === "object") {
        return Object.entries(item)
          .filter(([k, v]) => !["_id", "id", "__v", "deletedAt", "createdAt", "updatedAt"].includes(k) && v !== null && v !== undefined && typeof v !== "object")
          .map(([k, v]) => humanizeKey(k) + ": " + humanizeValue(v, k)).join(" · ");
      }
      return String(item);
    }).filter(Boolean).join("\\n");
  }
  if (typeof value === "object") {
    const parts = Object.entries(value)
      .filter(([k, v]) => !["_id", "id", "__v", "deletedAt", "createdAt", "updatedAt", "password", "token"].includes(k) && v !== null && v !== undefined)
      .map(([k, v]) => humanizeKey(k) + ": " + humanizeValue(v, k));
    return parts.length ? parts.join(" · ") : "Details available";
  }
  if (typeof value === "string") {
    const statusLabels: Record<string, string> = {
      pending: "Pending", in_transit: "In Transit", dispatched: "Dispatched",
      completed: "Completed", cancelled: "Cancelled", packed: "Packed",
      ready_for_dispatch: "Ready for Dispatch", received_transfer: "Received at Warehouse",
      quality_approved: "Quality Approved", stored: "Stored", local_hub_ready: "Received at Local Hub",
      hub_handoff_pending: "Local Hub Transfer Pending", hub_arrived_pending_receipt: "Awaiting Local Hub Receipt",
      warehouse: "Warehouse Fulfillment", farmer: "Farmer Fulfillment", farm_direct: "Farmer Fulfillment",
    };
    if (statusLabels[value.toLowerCase()]) return statusLabels[value.toLowerCase()];
    if (/^(19|20)\\d{2}-\\d{2}-\\d{2}T/.test(value)) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
    }
    return value.replace(/_/g, " ");
  }
  if (typeof value === "number" && /distance/i.test(key)) return value.toFixed(1) + " km";
  if (typeof value === "number" && /amount|price|fee|subtotal|total/i.test(key)) return "₹" + value.toLocaleString("en-IN");
  return String(value);
};

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
  completed: { label: "Completed", color: "border-green-200 bg-green-50 text-green-700", icon: CheckCircle },
  in_transit: { label: "In Transit", color: "border-blue-200 bg-blue-50 text-blue-700", icon: ArrowUpRight },
  pending: { label: "Pending", color: "border-yellow-200 bg-yellow-50 text-yellow-700", icon: Clock },
  cancelled: { label: "Cancelled", color: "border-red-200 bg-red-50 text-red-700", icon: XCircle },
};

export default function WarehouseTransfersPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [orderSection, setOrderSection] = useState<"all" | "warehouse" | "farmer">("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ toWarehouseId: "", productId: "", variantId: "", quantity: "1", reason: "" });
  const [saving, setSaving] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [orderDetail, setOrderDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["warehouseTransfers", statusFilter],
    queryFn: () => api.get("/warehouse/me/transfers", { params: { status: statusFilter === "all" ? undefined : statusFilter, limit: 100 } }),
  });

  const transfers = useMemo(() => data?.data?.transfers || [], [data]);

  const { data: outgoingData, isLoading: outgoingLoading, refetch: refetchOutgoing } = useQuery({
    queryKey: ["warehouseTransferOrders", statusFilter],
    queryFn: () => api.get("/warehouse/me/outgoing", { params: { status: statusFilter === "all" ? undefined : statusFilter, limit: 200 } }),
    refetchInterval: 20000,
  });
  const { data: farmerData, isLoading: farmerLoading, refetch: refetchFarmer } = useQuery({
    queryKey: ["farmerTransferOrders", statusFilter],
    queryFn: () => api.get("/warehouse/me/farmer-fulfillment-transfers", { params: { include_completed: true } }),
    refetchInterval: 20000,
  });
  const orderRows = useMemo(() => {
    const warehouseRows = (outgoingData?.data?.outgoing || []).map((o: any) => ({
      ...o,
      rowId: "warehouse-" + String(o.id || o._id || o.orderId),
      fulfillmentType: "warehouse",
      displayOrderId: o.orderNumber || o.orderId || o.id,
      displayStatus: o.status || o.warehouseFulfillmentStage || "pending",
      displayName: o.productName || o.orderTitle || "Warehouse fulfillment order",
      displayQuantity: o.quantity ?? o.totalQuantity ?? "—",
      sourceName: o.sourceWarehouseName || o.warehouseName || o.sourceDistrict || "Source warehouse",
      destinationName: o.destinationWarehouseName || o.destinationDistrict || o.deliveryDistrict || "Customer delivery",
      updated: o.updatedAt || o.dispatchedAt || o.createdAt,
      currentStage: o.warehouseFulfillmentStage || o.deliveryState || o.status || "pending",
    }));
    const farmerRows = (farmerData?.data?.orders || farmerData?.data?.transfers || farmerData?.data?.items || []).map((o: any) => ({
      ...o,
      rowId: "farmer-" + String(o.id || o._id || o.orderId),
      fulfillmentType: "farmer",
      displayOrderId: o.orderNumber || o.orderId || o.id || o._id,
      displayStatus: o.transferStatus || o.warehouseFulfillmentStage || o.status || o.stage || "pending",
      displayName: o.productName || o.orderTitle || (Array.isArray(o.items) ? o.items.map((i: any) => i.productName || i.name).filter(Boolean).join(", ") : "") || "Farmer fulfillment order",
      displayQuantity: o.totalQuantity ?? o.quantity ?? (Array.isArray(o.items) ? o.items.reduce((sum: number, i: any) => sum + Number(i.quantity || 0), 0) : "—"),
      sourceName: o.sourceWarehouseName || o.farmerName || o.sourceDistrict || "Farmer / source",
      destinationName: o.destinationWarehouseName || o.destinationDistrict || o.localHubName || o.deliveryDistrict || "Next destination pending",
      updated: o.updatedAt || o.receivedAt || o.createdAt,
      currentStage: o.transferStatus || o.stage || o.warehouseFulfillmentStage || o.status || "pending",
    }));
    return [...warehouseRows, ...farmerRows];
  }, [outgoingData, farmerData]);
  const visibleOrders = useMemo(() => {
    const rows = orderRows.filter((o: any) => {
      if (orderSection !== "all" && o.fulfillmentType !== orderSection) return false;
      if (statusFilter !== "all" && String(o.displayStatus).toLowerCase() !== statusFilter) return false;
      const q = search.toLowerCase().trim();
      return !q || [o.displayOrderId, o.displayName, o.productId, o.sourceName, o.destinationName, o.currentStage, o.displayStatus].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
    });
    return rows;
  }, [orderRows, orderSection, statusFilter, search]);
  const filtered = useMemo(() => transfers.filter((t: any) => {
    const q = search.toLowerCase();
    return !q || [t.id, t.productName, t.productId, t.reason, t.batchNumber].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
  }), [transfers, search]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.toWarehouseId || !form.productId || Number(form.quantity) <= 0 || !form.reason.trim()) {
      toast.error("Destination, product, quantity and reason are required");
      return;
    }
    setSaving(true);
    try {
      await api.post("/warehouse/me/transfers", {
        toWarehouseId: form.toWarehouseId.trim(),
        productId: form.productId.trim(),
        variantId: form.variantId.trim() || undefined,
        quantity: Number(form.quantity),
        reason: form.reason.trim(),
      });
      toast.success("Transfer created");
      setDialogOpen(false);
      setForm({ toWarehouseId: "", productId: "", variantId: "", quantity: "1", reason: "" });
      refetch(); refetchOutgoing(); refetchFarmer();
    } catch (e: any) {
      toast.error(e?.message || "Failed to create transfer");
    } finally {
      setSaving(false);
    }
  };

  const viewOrderDetails = async (order: any) => {
    setSelectedOrder(order);
    setOrderDetail(null);
    setDetailLoading(true);
    try {
      if (order.fulfillmentType === "warehouse" && order.orderId) {
        const response = await api.get(`/warehouse/me/orders/${order.orderId}/fulfillment-check`);
        setOrderDetail(response?.data?.data || response?.data || response);
      } else {
        setOrderDetail(order);
      }
    } catch (e: any) {
      // Keep the full list-row data available even if the optional dispatch audit is unavailable.
      setOrderDetail(order);
      toast.error(e?.message || "Some additional order details could not be loaded.");
    } finally {
      setDetailLoading(false);
    }
  };

  const complete = async (id: string) => {
    try {
      await api.put(`/warehouse/me/transfers/${id}/complete`);
      toast.success("Transfer completed");
      refetch(); refetchOutgoing(); refetchFarmer();
    } catch (e: any) {
      toast.error(e?.message || "Failed to complete transfer");
    }
  };

  const active = transfers.filter((t: any) => t.status === "in_transit").length;
  const pending = transfers.filter((t: any) => t.status === "pending").length;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Transfers</h1><p className="text-sm text-muted-foreground">Live stock movement between facilities</p></div>
        <Button onClick={() => setDialogOpen(true)}><Plus className="mr-2 h-4 w-4" /> New Transfer</Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{transfers.length}</p><p className="text-xs text-muted-foreground">Loaded Transfers</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-blue-600">{active}</p><p className="text-xs text-muted-foreground">In Transit</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-yellow-600">{pending}</p><p className="text-xs text-muted-foreground">Pending</p></CardContent></Card>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input placeholder="Search transfers..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" /></div>
        <div className="flex gap-2 overflow-x-auto">{["all","pending","in_transit","completed","cancelled"].map((s) => <Button key={s} variant={statusFilter === s ? "default" : "outline"} size="sm" onClick={() => setStatusFilter(s)}>{s === "in_transit" ? "In Transit" : s[0].toUpperCase()+s.slice(1)}</Button>)}</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[{key:"all",title:"All Orders",count:orderRows.length,desc:"Warehouse and farmer fulfillment"},{key:"warehouse",title:"Warehouse Fulfillment Orders",count:orderRows.filter((o:any)=>o.fulfillmentType==="warehouse").length,desc:"Orders packed and dispatched by warehouse"},{key:"farmer",title:"Farmer Fulfillment Orders",count:orderRows.filter((o:any)=>o.fulfillmentType==="farmer").length,desc:"Farmer-packed orders and warehouse transfer stages"}].map((s:any)=><button type="button" key={s.key} onClick={()=>setOrderSection(s.key)} className={"rounded-lg border p-4 text-left transition-colors "+(orderSection===s.key?"border-primary bg-primary/5 shadow-sm":"bg-card hover:bg-muted/40")}><div className="flex items-center justify-between gap-2"><span className="font-semibold">{s.title}</span><Badge variant={orderSection===s.key?"default":"outline"}>{s.count}</Badge></div><p className="mt-2 text-xs text-muted-foreground">{s.desc}</p></button>)}
      </div>
      {isLoading || outgoingLoading || farmerLoading ? <Card><CardContent className="p-8 text-center">Loading transfer and order details…</CardContent></Card> : visibleOrders.length === 0 ? <Card><CardContent className="p-8 text-center">No orders found in this section for the selected filters.</CardContent></Card> : <div className="space-y-3">{visibleOrders.map((o:any) => { const raw=String(o.displayStatus||"pending").toLowerCase(); const cfg=statusConfig[raw]|| (raw.includes("complete")||raw.includes("stored")||raw.includes("local_hub_ready")?statusConfig.completed:raw.includes("transit")||raw.includes("dispatched")||raw.includes("handoff")?statusConfig.in_transit:raw.includes("cancel")?statusConfig.cancelled:statusConfig.pending); const Icon=cfg.icon; return <Card key={o.rowId}><CardContent className="p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="flex min-w-0 items-start gap-3"><div className="rounded-full bg-slate-100 p-2"><ArrowLeftRight className="h-5 w-5 text-slate-600"/></div><div className="min-w-0 space-y-2"><div className="flex flex-wrap items-center gap-2"><p className="break-all font-semibold">{o.displayOrderId}</p><Badge className={cfg.color}><Icon className="mr-1 h-3 w-3"/>{String(o.displayStatus).replace(/_/g," ")}</Badge><Badge variant="outline">{o.fulfillmentType==="farmer"?"Farmer Fulfillment":"Warehouse Fulfillment"}</Badge></div><p className="text-sm">{o.displayName} · Quantity: {o.displayQuantity}</p><p className="text-sm text-muted-foreground">{o.sourceName} → {o.destinationName}</p><p className="text-xs text-muted-foreground">Current stage: <span className="font-medium text-foreground">{String(o.currentStage).replace(/_/g," ")}</span></p>{o.routeDistanceKm!=null&&<p className="text-xs text-muted-foreground">Route distance: {Number(o.routeDistanceKm).toFixed(1)} km · Threshold: {o.nearbyThresholdKm||15} km</p>}</div></div><div className="shrink-0 text-right text-sm"><p className="text-muted-foreground">{o.updated?formatDate(o.updated):"—"}</p><p className="mt-1 text-xs text-muted-foreground">Last updated</p><Button className="mt-2" variant="outline" size="sm" onClick={()=>viewOrderDetails(o)}>View Full Order Details</Button></div></div></CardContent></Card>})}</div>}
      <div className="border-t pt-4"><h2 className="mb-2 font-semibold">Stock Transfers</h2>{filtered.length===0?<p className="text-sm text-muted-foreground">No stock-to-stock transfers match the filters.</p>:<div className="space-y-2">{filtered.map((t:any)=>{const cfg=statusConfig[t.status]||statusConfig.pending;const Icon=cfg.icon;return <Card key={t.id}><CardContent className="p-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{t.id}</span><Badge className={cfg.color}><Icon className="mr-1 h-3 w-3"/>{cfg.label}</Badge></div><p className="text-sm">{t.productName||t.productId} · {t.quantity}</p><p className="text-xs text-muted-foreground">{t.fromWarehouseName||t.fromWarehouseId} → {t.toWarehouseName||t.toWarehouseId}</p></div><div className="text-right text-sm"><p>{t.createdAt?formatDate(t.createdAt):"—"}</p>{t.status!=="completed"&&t.status!=="cancelled"&&t.toWarehouseId&&<Button variant="outline" size="sm" onClick={()=>complete(t.id)}>Mark Received</Button>}</div></div></CardContent></Card>})}</div>}</div>
      <Dialog open={!!selectedOrder} onOpenChange={(open)=>{if(!open){setSelectedOrder(null);setOrderDetail(null);}}}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Full Order Details</DialogTitle></DialogHeader>{selectedOrder&&<div className="space-y-4"><div className="rounded-lg border p-3"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{selectedOrder.displayOrderId||selectedOrder.orderNumber||selectedOrder.orderId||selectedOrder.id}</p><Badge variant="outline">{selectedOrder.fulfillmentType==="farmer"?"Farmer Fulfillment":"Warehouse Fulfillment"}</Badge><Badge>{String(selectedOrder.displayStatus||"pending").replace(/_/g," ")}</Badge></div><p className="mt-1 text-sm text-muted-foreground">Current stage: {String(selectedOrder.currentStage||"—").replace(/_/g," ")}</p></div>{detailLoading?<p className="p-4 text-center text-sm text-muted-foreground">Loading additional order details…</p>:<div className="grid gap-3 sm:grid-cols-2">{Object.entries({...selectedOrder,...(orderDetail&&typeof orderDetail==="object"?orderDetail:{})}).filter(([key,value])=>!["rowId","_id","id","__v","fulfillmentType","displayOrderId","displayStatus","displayName","displayQuantity","sourceName","destinationName","updated","currentStage","password","token","deletedAt"].includes(key)&&value!==null&&value!==undefined&&typeof value!=="function"&&!key.toLowerCase().endsWith("userid")&&!key.toLowerCase().endsWith("objectid")).map(([key,value])=><div key={key} className="min-w-0 rounded-md border p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{humanizeKey(key)}</p><p className="mt-1 whitespace-pre-line break-words text-sm">{humanizeValue(value,key)}</p></div>)}</div>}<div className="flex justify-end"><Button variant="outline" onClick={()=>{setSelectedOrder(null);setOrderDetail(null);}}>Close</Button></div></div>}</DialogContent></Dialog>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent><DialogHeader><DialogTitle>Create Transfer</DialogTitle></DialogHeader><form className="space-y-3" onSubmit={submit}><Input placeholder="Destination warehouse ID" value={form.toWarehouseId} onChange={e=>setForm({...form,toWarehouseId:e.target.value})} required/><Input placeholder="Product ID" value={form.productId} onChange={e=>setForm({...form,productId:e.target.value})} required/><Input placeholder="Variant ID (optional)" value={form.variantId} onChange={e=>setForm({...form,variantId:e.target.value})}/><Input type="number" min="1" placeholder="Quantity" value={form.quantity} onChange={e=>setForm({...form,quantity:e.target.value})} required/><Input placeholder="Reason" value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})} required/><Button type="submit" disabled={saving} className="w-full">{saving ? "Creating…" : "Create Transfer"}</Button></form></DialogContent></Dialog>
    </div>
  );
}
