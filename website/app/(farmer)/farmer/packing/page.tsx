"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  MapPin,
  Package,
  Printer,
  QrCode,
  Truck,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Tab = "to_pack" | "packed" | "shortage";

function extractOrders(response: any): any[] {
  const candidates = [response?.orders, response?.data?.orders, response?.data, response];
  return candidates.find((value: any) => Array.isArray(value)) || [];
}

function orderTime(order: any) {
  for (const value of [order?.orderDate, order?.createdAt]) {
    if (!value) continue;
    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function formatAddress(order: any) {
  const a = order?.deliveryAddress || order?.shippingAddress || {};
  return [
    a?.addressLine1 || a?.line1 || a?.street,
    a?.addressLine2 || a?.line2,
    a?.area || a?.locality,
    a?.city,
    a?.district,
    a?.state,
    a?.postalCode || a?.pincode || a?.zipCode,
  ].filter(Boolean).join(", ") || "Delivery address not available";
}

export default function FarmerPackingPage() {
  const [tab, setTab] = useState<Tab>("to_pack");
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [packedQuantities, setPackedQuantities] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const ordersQuery = useQuery({
    queryKey: ["farmer-packing-orders"],
    queryFn: () => api.get("/farmers/me/orders", { params: { limit: 500 } }),
  });

  const orders = useMemo(() => {
    return extractOrders(ordersQuery.data)
      .filter((order: any) => {
        const method = String(order?.fulfillmentMethod || "").toLowerCase();
        return method === "farmer";
      })
      .sort((a: any, b: any) => orderTime(b) - orderTime(a));
  }, [ordersQuery.data]);

  const toPack = orders.filter((o: any) => {
    const stage = String(o?.fulfillmentStage || "pending").toLowerCase();
    return !["packed", "dispatched"].includes(stage) && !o?.packingComplete;
  });

  const packed = orders.filter((o: any) => {
    const stage = String(o?.fulfillmentStage || "").toLowerCase();
    return stage === "packed" || stage === "dispatched" || o?.packingComplete;
  });

  const shortage = orders.filter((o: any) => {
    const items = Array.isArray(o?.items) ? o.items : [];
    return Boolean(o?.packingShortage) || Boolean(o?.shortageCaseId) ||
      items.some((item: any) => Number(item?.packedQuantity ?? item?.actualPackedQuantity ?? item?.quantity) < Number(item?.quantity ?? 0));
  });

  const visibleOrders = tab === "to_pack" ? toPack : tab === "packed" ? packed : shortage;
  const total = orders.length;
  const progress = total ? Math.round((packed.length / total) * 100) : 0;
  const allPacked = total > 0 && packed.length >= total;

  const startPacking = (order: any) => {
    setSelectedOrder(order);
    const initial: Record<string, string> = {};
    (Array.isArray(order.items) ? order.items : []).forEach((item: any, index: number) => {
      const key = `${item.productId || item.productName || "item"}:${item.variantId || ""}:${index}`;
      initial[key] = String(item.packedQuantity ?? item.actualPackedQuantity ?? item.quantity ?? 0);
    });
    setPackedQuantities(initial);
  };

  const finalizePacking = async () => {
    if (!selectedOrder) return;
    const orderId = selectedOrder.id || selectedOrder._id;
    const items = Array.isArray(selectedOrder.items) ? selectedOrder.items : [];
    const packedItems = items.map((item: any, index: number) => {
      const key = `${item.productId || item.productName || "item"}:${item.variantId || ""}:${index}`;
      const value = Number(packedQuantities[key]);
      const ordered = Number(item.quantity ?? 0);
      if (!Number.isFinite(value) || value < 0 || value > ordered) {
        throw new Error(`Invalid packed quantity for ${item.productName || "product"}`);
      }
      return {
        productId: item.productId,
        variantId: item.variantId || null,
        packedQuantity: value,
      };
    });

    try {
      setSaving(true);
      const response = await api.post(`/orders/${orderId}/farmer-packing-finalize`, { items: packedItems });
      const result = response?.data || response;
      const shortageCount = Array.isArray(result?.shortageCancelledItems) ? result.shortageCancelledItems.length : 0;
      toast.success(shortageCount ? `Packed with ${shortageCount} shortage line(s) resolved.` : "Order packed successfully.");
      setSelectedOrder(null);
      await ordersQuery.refetch();
    } catch (error: any) {
      toast.error(error?.message || "Failed to complete packing");
    } finally {
      setSaving(false);
    }
  };

  const printLabel = (order: any) => {
    setSelectedOrder(order);
    window.setTimeout(() => window.print(), 50);
  };

  if (ordersQuery.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading packing orders...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50/70 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/farmer/orders" className="mb-2 inline-flex items-center text-xs font-medium text-slate-500 hover:text-emerald-700">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back to Orders
            </Link>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Packing & Checking</h1>
            <p className="mt-1 text-sm text-slate-500">Check every Farmer Fulfillment order, record actual packed quantities, and prepare parcels for delivery.</p>
          </div>
          {allPacked && (
            <Button asChild className="bg-emerald-600 hover:bg-emerald-700">
              <Link href="/farmer/order-map?delivery=required">
                <Truck className="mr-2 h-4 w-4" /> Open Farmer Order Map
              </Link>
            </Button>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <Card><CardContent className="p-4"><p className="text-xs text-slate-500">Farmer Orders</p><p className="mt-1 text-2xl font-bold">{total}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-slate-500">To Pack</p><p className="mt-1 text-2xl font-bold text-amber-600">{toPack.length}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-slate-500">Packed</p><p className="mt-1 text-2xl font-bold text-emerald-600">{packed.length}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-slate-500">Shortage</p><p className="mt-1 text-2xl font-bold text-red-600">{shortage.length}</p></CardContent></Card>
        </div>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Packing progress</p>
                <p className="text-xs text-slate-500">{packed.length} of {total} orders packed</p>
              </div>
              <span className="text-sm font-semibold text-emerald-700">{progress}%</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
            {allPacked && <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800"><CheckCircle2 className="h-4 w-4" /> All Farmer Fulfillment orders are packed and ready for delivery routing.</div>}
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2">
          {([
            ["to_pack", `To Pack ${toPack.length}`],
            ["packed", `Packed ${packed.length}`],
            ["shortage", `Shortage ${shortage.length}`],
          ] as const).map(([value, label]) => (
            <Button key={value} size="sm" variant={tab === value ? "default" : "outline"} onClick={() => setTab(value)} className={tab === value ? "bg-emerald-600 hover:bg-emerald-700" : ""}>
              {label}
            </Button>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {visibleOrders.map((order: any) => {
            const orderId = order.id || order._id;
            const items = Array.isArray(order.items) ? order.items : [];
            const isPacked = packed.includes(order);
            return (
              <Card key={orderId} className="overflow-hidden border-slate-200 bg-white shadow-sm">
                <CardHeader className="border-b bg-white pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-sm font-bold text-slate-900">{order.orderNumber || `Order #${orderId}`}</CardTitle>
                      <p className="mt-1 text-xs text-slate-500">{order.orderDate ? new Date(order.orderDate).toLocaleString() : "Recent order"}</p>
                    </div>
                    <Badge className={isPacked ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : "bg-amber-100 text-amber-800 hover:bg-amber-100"}>
                      {isPacked ? "Packed" : "To Pack"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Customer</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{order.customerName || order.customer?.name || "Customer"}</p>
                      <p className="text-xs text-slate-500">{order.customerPhone || order.customer?.phone || "Phone not available"}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400"><MapPin className="h-3 w-3" /> Delivery</p>
                      <p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-700">{formatAddress(order)}</p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200">
                    <div className="flex items-center justify-between border-b px-3 py-2">
                      <p className="text-xs font-semibold text-slate-700">Items to check</p>
                      <span className="text-[11px] text-slate-500">{items.length} item(s)</span>
                    </div>
                    <div className="divide-y">
                      {items.map((item: any, index: number) => {
                        const key = `${item.productId || item.productName || "item"}:${item.variantId || ""}:${index}`;
                        const ordered = Number(item.quantity ?? 0);
                        return (
                          <div key={key} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-2.5">
                            <div><p className="text-xs font-medium text-slate-900">{item.productName || "Product"}</p><p className="text-[11px] text-slate-500">Ordered: {ordered}</p></div>
                            {isPacked ? <span className="text-xs font-semibold text-emerald-700">{item.packedQuantity ?? item.actualPackedQuantity ?? ordered} packed</span> : <label className="text-[11px] text-slate-500">Actual <input aria-label={`Actual packed quantity for ${item.productName || "product"}`} type="number" min="0" max={ordered} step="0.01" value={packedQuantities[key] ?? String(item.quantity ?? 0)} onChange={(e) => setPackedQuantities((prev) => ({ ...prev, [key]: e.target.value }))} className="ml-1 w-20 rounded-md border border-slate-300 px-2 py-1 text-right text-xs text-slate-900 outline-none focus:border-emerald-500" /></label>}
                            <span className="text-[11px] text-slate-500">{item.unit || "kg"}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/farmer/orders/${orderId}`} className="inline-flex items-center text-xs font-medium text-slate-600 hover:text-emerald-700">
                      <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" /> Full order details <ChevronRight className="ml-0.5 h-3 w-3" />
                    </Link>
                    <div className="flex flex-wrap gap-2">
                      {isPacked ? (
                        <Button size="sm" variant="outline" onClick={() => printLabel(order)}><Printer className="mr-1.5 h-4 w-4" /> Print Label</Button>
                      ) : (
                        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => { try { startPacking(order); } catch (e: any) { toast.error(e.message); } }}>
                          <Package className="mr-1.5 h-4 w-4" /> Start / Check Packing
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {visibleOrders.length === 0 && (
          <Card><CardContent className="flex flex-col items-center justify-center p-10 text-center">
            {tab === "to_pack" ? <CheckCircle2 className="h-10 w-10 text-emerald-500" /> : <Package className="h-10 w-10 text-slate-300" />}
            <p className="mt-3 text-sm font-semibold text-slate-900">{tab === "to_pack" ? "No orders waiting for packing" : "No orders in this section"}</p>
            <p className="mt-1 max-w-md text-xs text-slate-500">{tab === "to_pack" ? "All available Farmer Fulfillment orders are packed. Continue to the Farmer Order Map when ready." : "Orders will appear here automatically as their packing stage changes."}</p>
          </CardContent></Card>
        )}

        {selectedOrder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
            <Card className="max-h-[90vh] w-full max-w-2xl overflow-auto shadow-2xl">
              <CardHeader className="border-b">
                <div className="flex items-center justify-between gap-3">
                  <div><CardTitle className="text-base">Check & Pack {selectedOrder.orderNumber}</CardTitle><p className="mt-1 text-xs text-slate-500">Enter the actual quantity placed in the parcel. Shortages are handled automatically.</p></div>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedOrder(null)}>Close</Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg bg-slate-50 p-3"><p className="text-[10px] uppercase tracking-wide text-slate-400">Customer</p><p className="mt-1 text-sm font-semibold">{selectedOrder.customerName || selectedOrder.customer?.name || "Customer"}</p><p className="text-xs text-slate-500">{selectedOrder.customerPhone || selectedOrder.customer?.phone || ""}</p></div>
                  <div className="rounded-lg bg-slate-50 p-3"><p className="text-[10px] uppercase tracking-wide text-slate-400">Deliver to</p><p className="mt-1 text-xs leading-5">{formatAddress(selectedOrder)}</p></div>
                </div>
                <div className="space-y-2">
                  {(Array.isArray(selectedOrder.items) ? selectedOrder.items : []).map((item: any, index: number) => {
                    const key = `${item.productId || item.productName || "item"}:${item.variantId || ""}:${index}`;
                    return <div key={key} className="flex items-center justify-between gap-3 rounded-lg border p-3"><div><p className="text-xs font-semibold">{item.productName || "Product"}</p><p className="text-[11px] text-slate-500">Ordered: {item.quantity} {item.unit || "kg"}</p></div><input type="number" min="0" max={Number(item.quantity ?? 0)} step="0.01" value={packedQuantities[key] ?? String(item.quantity ?? 0)} onChange={(e) => setPackedQuantities((prev) => ({ ...prev, [key]: e.target.value }))} className="w-28 rounded-md border px-3 py-2 text-right text-sm" /></div>;
                  })}
                </div>
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> If actual quantity is lower than ordered, the backend shortage workflow recalculates the final payable amount.</div>
                <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setSelectedOrder(null)}>Cancel</Button><Button disabled={saving} className="bg-emerald-600 hover:bg-emerald-700" onClick={finalizePacking}>{saving ? "Saving..." : "Confirm Packed"}</Button></div>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="hidden print:block">
          <div className="mx-auto max-w-md border-2 border-slate-900 p-5 text-black">
            <div className="text-center"><p className="text-xl font-bold">AGRICONNECT</p><p className="text-xs">FARM DELIVERY</p></div>
            <div className="my-3 border-t border-slate-900" />
            <p className="text-xs font-bold">ORDER</p>
            <p className="text-sm font-bold">{selectedOrder?.orderNumber || ""}</p>
            <p className="mt-3 text-xs font-bold">CUSTOMER</p>
            <p className="text-sm">{selectedOrder?.customerName || selectedOrder?.customer?.name || "Customer"}</p>
            <p className="text-xs">{selectedOrder?.customerPhone || selectedOrder?.customer?.phone || ""}</p>
            <p className="mt-3 text-xs font-bold">DELIVER TO</p>
            <p className="text-sm leading-5">{selectedOrder ? formatAddress(selectedOrder) : ""}</p>
            <p className="mt-3 text-xs font-bold">PAYMENT</p>
            <p className="text-sm">{String(selectedOrder?.paymentMethod || "").toUpperCase() === "COD" ? `COD ₹${Number(selectedOrder?.totalAmount ?? selectedOrder?.total ?? 0).toFixed(2)}` : "PAID ONLINE"}</p>
            <p className="mt-3 text-xs font-bold">ITEMS</p>
            {(Array.isArray(selectedOrder?.items) ? selectedOrder.items : []).map((item: any, index: number) => <p key={index} className="text-sm">{item.productName || "Product"} — {item.packedQuantity ?? item.actualPackedQuantity ?? item.quantity} {item.unit || "kg"}</p>)}
            <div className="mt-5 flex justify-center">
              <QRCodeSVG
                value={selectedOrder ? String(selectedOrder.orderNumber || selectedOrder.id || selectedOrder._id || "") : ""}
                size={96}
                level="M"
              />
            </div>
            <p className="mt-2 text-center text-[10px]">Scan order ID: {selectedOrder?.orderNumber || ""}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
