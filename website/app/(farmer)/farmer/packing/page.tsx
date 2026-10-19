"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api/client";
import toast from "react-hot-toast";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  ChevronRight,
  MapPin,
  Package,
  Printer,
  Truck,
  AlertTriangle,
} from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";

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
  const [completedOrder, setCompletedOrder] = useState<any | null>(null);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const [pickupSubmittingOrderId, setPickupSubmittingOrderId] = useState<string | null>(null);

  const ordersQuery = useQuery({
    queryKey: ["farmer-packing-orders"],
    queryFn: () => api.get("/farmers/me/orders", { params: { limit: 500 } }),
  });

  const orders = useMemo(() => {
    return extractOrders(ordersQuery.data)
      .filter((order: any) => {
        const method = String(order?.fulfillmentMethod || order?.fulfillment_route || "").toLowerCase();
        return method === "farmer" || method === "farm_direct";
      })
      .sort((a: any, b: any) => orderTime(b) - orderTime(a));
  }, [ordersQuery.data]);

  const isPackingCancelled = (order: any) =>
    String(order?.orderStatus || order?.status || "").toLowerCase() === "cancelled" ||
    Boolean(order?.packingCancelled);

  const hasPackingShortage = (order: any) => {
    const items = Array.isArray(order?.items) ? order.items : [];
    return Boolean(order?.packingShortage) ||
      Boolean(order?.packingCancelled) ||
      Boolean(order?.shortageCaseId) ||
      Boolean(order?.shortageDetected) ||
      Boolean(order?.shortageCancelledItems?.length) ||
      Boolean(order?.shortageAdjustment) ||
      items.some((item: any) => Number(item?.packedQuantity ?? item?.actualPackedQuantity ?? item?.quantity) < Number(item?.quantity ?? 0));
  };

  const toPack = orders.filter((o: any) => {
    const stage = String(o?.fulfillmentStage || "pending").toLowerCase();
    return !isPackingCancelled(o) && !["packed", "dispatched"].includes(stage) && !o?.packingComplete;
  });

  const packed = orders.filter((o: any) => {
    const stage = String(o?.fulfillmentStage || "").toLowerCase();
    return !isPackingCancelled(o) && (stage === "packed" || stage === "dispatched" || o?.packingComplete);
  });

  const shortage = orders.filter((o: any) => hasPackingShortage(o));

  const visibleOrders = tab === "to_pack" ? toPack : tab === "packed" ? packed : shortage;
  const total = orders.length;
  const progress = total ? Math.round((packed.length / total) * 100) : 0;
  const allPacked = total > 0 && packed.length >= total;

  const packingPreview = useMemo(() => {
    if (!selectedOrder) return { shortageLines: 0, shortageValue: 0, finalAmount: 0 };
    const items = Array.isArray(selectedOrder.items) ? selectedOrder.items : [];
    let shortageLines = 0;
    let shortageValue = 0;
    let subtotal = 0;
    for (const [index, item] of items.entries()) {
      const key = `${item.productId || item.productName || "item"}:${item.variantId || ""}:${index}`;
      const ordered = Number(item.quantity ?? 0);
      const packed = Number(packedQuantities[key] ?? ordered);
      const safePacked = Number.isFinite(packed) ? Math.max(0, Math.min(ordered, packed)) : 0;
      const unitPrice = Number(item.unitPrice ?? 0);
      subtotal += safePacked * unitPrice;
      if (safePacked < ordered) {
        shortageLines += 1;
        shortageValue += (ordered - safePacked) * unitPrice;
      }
    }
    const discount = Math.min(Number(selectedOrder.discount ?? 0), subtotal);
    const finalAmount = Math.max(
      0,
      subtotal + Number(selectedOrder.deliveryCharge ?? 0) + Number(selectedOrder.platformFee ?? 0) - discount
    );
    return { shortageLines, shortageValue, finalAmount };
  }, [selectedOrder, packedQuantities]);

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
    try {
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

      setSaving(true);
      const response = await api.post(`/orders/${orderId}/farmer-packing-finalize`, { items: packedItems });
      const result = response?.data || response;
      const shortageCount = Array.isArray(result?.shortageCancelledItems) ? result.shortageCancelledItems.length : 0;
      toast.success(shortageCount ? `Packed with ${shortageCount} shortage line(s) resolved.` : "Order packed successfully.");
      const completed = {
        ...selectedOrder,
        packingComplete: true,
        fulfillmentStage: "packed",
        items: items.map((item: any, index: number) => ({
          ...item,
          packedQuantity: packedItems[index]?.packedQuantity ?? 0,
          actualPackedQuantity: packedItems[index]?.packedQuantity ?? 0,
        })),
      };
      setSelectedOrder(null);
      setCompletedOrder(completed);
      await ordersQuery.refetch();
    } catch (error: any) {
      toast.error(error?.message || "Failed to complete packing");
    } finally {
      setSaving(false);
    }
  };

  const markReadyForPickup = async (order: any) => {
    const orderId = order?.id || order?._id;
    if (!orderId) { toast.error("Order ID is missing"); return; }
    if (!order?.packingComplete || !["packed", "dispatched"].includes(String(order?.fulfillmentStage || "").toLowerCase())) {
      toast.error("Confirm Packed before requesting pickup.");
      return;
    }
    try {
      setPickupSubmittingOrderId(orderId);
      const response = await api.post("/orders/" + orderId + "/farmer-fulfillment-ready-for-pickup");
      const result = response?.data || response;
      toast.success(result?.message || "Order marked Ready for Pickup. Warehouse collection is now available.");
      await ordersQuery.refetch();
    } catch (error: any) {
      toast.error(error?.message || "Unable to mark this order Ready for Pickup");
    } finally {
      setPickupSubmittingOrderId(null);
    }
  };
  const cancelForShortage = async (order: any) => {
    const orderId = order?.id || order?._id;
    if (!orderId) return;
    const confirmed = window.confirm(`Cancel ${order.orderNumber || "this order"} because the required quantity cannot be fulfilled? Reserved stock will be released and the order will be cancelled.`);
    if (!confirmed) return;
    try {
      setCancellingOrderId(orderId);
      await api.post(`/orders/${orderId}/farmer-packing-cancel`, { reason: "Farmer packing shortage - required quantity cannot be fulfilled" });
      toast.success("Order cancelled due to packing shortage and reserved stock released.");
      await ordersQuery.refetch();
    } catch (error: any) {
      toast.error(error?.message || "Failed to cancel the order");
    } finally {
      setCancellingOrderId(null);
    }
  };
  const printLabel = async (order: any) => {
    const orderId = order?.id || order?._id;
    if (!orderId) { toast.error("Order ID is missing"); return; }
    try {
      const response = await api.post("/orders/" + orderId + "/farmer-delivery-label");
      const labelOrder = response?.data || response;
      setSelectedOrder(labelOrder);
      window.setTimeout(() => window.print(), 50);
    } catch (error: any) {
      toast.error(error?.message || "Delivery label is not ready. Confirm packing first.");
    }
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
            <p className="mt-1 text-sm text-slate-500">Check every Farmer Fulfillment order → enter actual packed quantity → resolve shortages → Confirm Packed → print the label → Mark Ready for Pickup when warehouse collection is required.</p>
          </div>
          {allPacked && (
            <Button asChild className="bg-emerald-600 hover:bg-emerald-700">
              <Link href="/farmer/order-map?delivery=required">
                <Truck className="mr-2 h-4 w-4" /> Open Farmer Order Map
              </Link>
            </Button>
          )}
        </div>

        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-emerald-950">Packing is preparation only</p>
            <p className="mt-1 text-xs text-emerald-800">
              After Confirm Packed, the order becomes Ready for Delivery. Select orders, group physical stops, calculate distance, and choose Self Delivery or the delivery-partner route only in the Farmer Order Map.
            </p>
          </div>
          <Button asChild size="sm" className="bg-emerald-600 hover:bg-emerald-700">
            <Link href="/farmer/order-map?delivery=required">
              <Truck className="mr-2 h-4 w-4" /> Open Farmer Order Map
            </Link>
          </Button>
        </div>
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
                    <Badge className={shortage.includes(order) ? "bg-red-100 text-red-800 hover:bg-red-100" : isPacked ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : "bg-amber-100 text-amber-800 hover:bg-amber-100"}>
                      {isPackingCancelled(order) ? "Cancelled · Shortage" : shortage.includes(order) ? "Packed · Shortage" : isPacked ? "Packed" : "To Pack"}
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
                      {isPackingCancelled(order) ? (
                        <span className="text-xs font-medium text-red-700">Order cancelled during packing</span>
                      ) : isPacked ? (
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => void printLabel(order)}><Printer className="mr-1.5 h-4 w-4" /> Print Delivery Label</Button>
                          {String(order?.warehouseCollectionStatus || "").toLowerCase() === "ready_for_pickup" || String(order?.orderStatus || "").toLowerCase() === "ready_for_pickup" ? (
                            <Button size="sm" variant="outline" disabled><CheckCircle2 className="mr-1.5 h-4 w-4" /> Ready for Pickup</Button>
                          ) : (
                            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={pickupSubmittingOrderId === orderId} onClick={() => void markReadyForPickup(order)}>
                              <Truck className="mr-1.5 h-4 w-4" /> {pickupSubmittingOrderId === orderId ? "Preparing Pickup..." : "Mark Ready for Pickup"}
                            </Button>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" disabled={cancellingOrderId === orderId} onClick={() => void cancelForShortage(order)} className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800">
                            {cancellingOrderId === orderId ? "Cancelling..." : "Cancel Order"}
                          </Button>
                          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => { try { startPacking(order); } catch (e: any) { toast.error(e.message); } }}>
                            <Package className="mr-1.5 h-4 w-4" /> Start / Check Packing
                          </Button>
                        </div>
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

        {completedOrder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
            <Card className="w-full max-w-md shadow-2xl">
              <CardHeader className="border-b text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
                  <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                </div>
                <CardTitle className="mt-2 text-base">Packing Completed</CardTitle>
                <p className="text-xs text-slate-500">{completedOrder.orderNumber || "Order"} is packed and ready for labeling.</p>
              </CardHeader>
              <CardContent className="space-y-3 p-4">
                <div className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">
                  Confirm Packed is complete. Print the delivery label now and paste it on the top of this package before continuing to the next order.
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" onClick={() => setCompletedOrder(null)}>Continue Packing</Button>
                  <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={async () => { const order = completedOrder; setCompletedOrder(null); await printLabel(order); }}>
                    <Printer className="mr-1.5 h-4 w-4" /> Print Delivery Label
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
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
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Shortage Check</p>
                  {packingPreview.shortageLines > 0 ? (
                    <div className="mt-2 space-y-1 text-xs text-amber-900">
                      <p><span className="font-semibold">{packingPreview.shortageLines}</span> line(s) are short by the quantity you entered.</p>
                      <p>Amount removed from unavailable stock: <span className="font-semibold">₹{packingPreview.shortageValue.toFixed(2)}</span></p>
                      <p>The backend will release the missing quantity from inventory and recalculate the final amount before the order is marked Packed.</p>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-emerald-700">No shortage. The full ordered quantity will be confirmed as packed.</p>
                  )}
                  <div className="mt-3 flex items-center justify-between border-t pt-3 text-sm">
                    <span className="font-medium text-slate-700">Final amount</span>
                    <span className="font-bold text-slate-900">₹{packingPreview.finalAmount.toFixed(2)}</span>
                  </div>
                </div>
                <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setSelectedOrder(null)} disabled={saving}>Cancel</Button><Button disabled={saving} className="bg-emerald-600 hover:bg-emerald-700" onClick={finalizePacking}>{saving ? "Saving..." : "Confirm Packed"}</Button></div>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="hidden print:block">
          <div className="mx-auto w-full max-w-[384px] rounded border border-slate-300 px-[9px] pb-[7px] pt-2 text-black" style={{ fontFamily: "Arial, sans-serif" }}>
            <div className="text-center"><p className="text-base font-extrabold tracking-[0.2px]">AGRICONNECT</p><p className="text-[7px] text-gray-600">FARM-TO-HOME · DELIVERY LABEL</p></div>
            <div className="my-[9px] border-t border-gray-300" />
            <p className="text-[7px] font-medium tracking-[0.25px] text-gray-500">ORDER NUMBER</p>
            <p className="text-[11px] font-bold">{selectedOrder?.orderNumber || selectedOrder?.id || selectedOrder?._id || "Order number unavailable"}</p>
            <p className="text-[7px] leading-[1.4] text-gray-600">Package / Label ID: PKG-{String(selectedOrder?.id || selectedOrder?._id || selectedOrder?.orderNumber || "").slice(-8)} · Printed: {new Date().toLocaleString()}</p>
            <div className="mt-[5px] grid grid-cols-2 gap-[14px]">
              {(selectedOrder?.farmName || selectedOrder?.farmerName || selectedOrder?.farm?.name) && <div className="min-w-0"><p className="mb-1 mt-[9px] text-[7px] font-medium tracking-[0.25px] text-gray-500">SOURCE FARM</p><p className="break-words text-[9px] leading-[1.45]">{selectedOrder?.farmName || selectedOrder?.farmerName || selectedOrder?.farm?.name}</p></div>}
              
            </div>
            <p className="mb-1 mt-[9px] text-[7px] font-medium tracking-[0.25px] text-gray-500">DELIVER TO</p>
            {(selectedOrder?.customerName || selectedOrder?.customer?.name) && <p className="break-words text-[9px] font-semibold leading-[1.45]">{selectedOrder?.customerName || selectedOrder?.customer?.name}</p>}
            {(selectedOrder?.customerPhone || selectedOrder?.customer?.phone) && <p className="break-words text-xs">{selectedOrder?.customerPhone || selectedOrder?.customer?.phone}</p>}
            {selectedOrder && formatAddress(selectedOrder) && <p className="break-words text-[9px] leading-[1.45]">{formatAddress(selectedOrder)}</p>}
            <p className="mb-1 mt-[9px] text-[7px] font-medium tracking-[0.25px] text-gray-500">PACKED ITEMS · ACTUAL QUANTITY</p>
            {(Array.isArray(selectedOrder?.items) ? selectedOrder.items : []).map((item: any, index: number) => <div key={index} className="flex justify-between gap-3 border-b border-gray-200 py-[7px] text-[9px]"><span className="break-words">{item.productName || item.name || "Product"}</span><b className="shrink-0">{item.packedQuantity ?? item.actualPackedQuantity ?? item.quantity} {item.unit || "kg"}</b></div>)}
            <p className="mb-1 mt-[9px] border-t border-gray-200 pt-[9px] text-[7px] font-medium tracking-[0.25px] text-gray-500">PAYMENT</p>
            {/^(COD|CASH_ON_DELIVERY|CASHONDELIVERY|PAY_ON_DELIVERY|PAY_LATER)$/.test(String(selectedOrder?.paymentMethod || selectedOrder?.payment_method || selectedOrder?.paymentMode || selectedOrder?.paymentType || selectedOrder?.payment?.method || (selectedOrder?.cashOnDelivery ? "COD" : "")).trim().toUpperCase().replace(/[ -]+/g, "_")) ? <><p className="text-[9px]">COD · Payable on delivery</p>{(selectedOrder?.totalAmount ?? selectedOrder?.grandTotal ?? selectedOrder?.payableAmount ?? selectedOrder?.total) != null && <p className="text-[9px] font-semibold">₹{Number(selectedOrder?.totalAmount ?? selectedOrder?.grandTotal ?? selectedOrder?.payableAmount ?? selectedOrder?.total).toFixed(2)}</p>}</> : <p className="text-[9px]">ONLINE PAYMENT{(selectedOrder?.paymentStatus || selectedOrder?.payment_status || selectedOrder?.payment?.status) ? " · " + String(selectedOrder?.paymentStatus || selectedOrder?.payment_status || selectedOrder?.payment?.status).replace(/_/g, " ").toUpperCase() : ""}{(selectedOrder?.totalAmount ?? selectedOrder?.grandTotal ?? selectedOrder?.payableAmount ?? selectedOrder?.total) != null ? " · Order total: ₹" + Number(selectedOrder?.totalAmount ?? selectedOrder?.grandTotal ?? selectedOrder?.payableAmount ?? selectedOrder?.total).toFixed(2) : ""}</p>}
            <div className="mt-[10px] flex justify-center border-t border-gray-300 pt-2">
              <QRCodeSVG value={typeof window !== "undefined" && selectedOrder ? window.location.origin + "/delivery/deliveries?orderId=" + encodeURIComponent(String(selectedOrder.id || selectedOrder._id || selectedOrder.orderNumber || "")) : ""} size={40} level="M" />
            </div>
            <p className="text-center text-[6.5px] font-bold">DELIVERY PARTNER QR</p>
            <p className="text-center text-[6.5px] leading-[1.4]">Scan to open the delivery workspace. Login and assignment management authorization are required to access delivery actions and POD.</p>
            <p className="mt-2 text-center text-[6.5px] text-gray-600">Verify the order reference before handover.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
