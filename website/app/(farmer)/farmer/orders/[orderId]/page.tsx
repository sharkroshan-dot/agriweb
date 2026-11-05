"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Package, MapPin, Clock, CreditCard, User, Phone, Hash, ShoppingBag, ChevronDown, ChevronUp, Store, CheckCircle, Loader2, ScanLine, X, Truck, CheckCircle2, CalendarDays, Mail, ExternalLink, ClipboardList } from "lucide-react";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Badge } from "../../../../components/ui/badge";
import { Input } from "../../../../components/ui/input";
import { formatPrice, formatDate } from "../../../../lib/utils";
import { api } from "../../../../lib/api/client";
import toast from "react-hot-toast";

const statusColors: Record<string, string> = {
  pending: "border-yellow-200 bg-yellow-50 text-yellow-700",
  confirmed: "border-blue-200 bg-blue-50 text-blue-700",
  processing: "border-purple-200 bg-purple-50 text-purple-700",
  ready_for_delivery: "border-indigo-200 bg-indigo-50 text-indigo-700",
  ready_for_pickup: "border-amber-200 bg-amber-50 text-amber-700",
  dispatched: "border-purple-200 bg-purple-50 text-purple-700",
  in_transit: "border-blue-200 bg-blue-50 text-blue-700",
  delivered: "border-green-200 bg-green-50 text-green-700",
  picked_up: "border-green-200 bg-green-50 text-green-700",
  cancelled: "border-red-200 bg-red-50 text-red-700",
  refunded: "border-orange-200 bg-orange-50 text-orange-700",
};

const humanizeRole = (role: string) => String(role || "")
  .replace(/_/g, " ")
  .replace(/\\b\\w/g, (letter: string) => letter.toUpperCase());

const getOrderProgress = (status: string, deliveryType: string) => {
  const isPickup = String(deliveryType || "").toLowerCase() === "pickup";
  const steps = [
    { label: "Order placed", description: "Order received", icon: ShoppingBag },
    { label: "Confirmed", description: "Order accepted", icon: CheckCircle2 },
    { label: "Preparing", description: "Getting products ready", icon: Package },
    { label: isPickup ? "Ready for pickup" : "Ready for delivery", description: isPickup ? "Waiting for collection" : "Waiting for dispatch", icon: isPickup ? Store : Package },
    { label: isPickup ? "Picked up" : "Delivered", description: isPickup ? "Handed over to customer" : "Order delivered", icon: isPickup ? CheckCircle2 : Truck },
  ];
  const ranks: Record<string, number> = {
    pending: 0, confirmed: 1, processing: 2, quality_check: 2,
    ready_for_pickup: 3, ready_for_delivery: 3, dispatched: 4,
    in_transit: 4, picked_up: 5, delivered: 5,
  };
  return { steps, activeIndex: ranks[status] ?? 0, terminal: status === "cancelled" || status === "refunded" };
};

const pickupPaymentLabel = (method: string) => {
  const m = (method || "").toLowerCase();
  if (m === "cash" || m === "cod" || m === "cash_on_delivery") return "Cash on Pickup";
  return m.replace(/_/g, " ");
};

export default function FarmerOrderDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const orderId = params.orderId as string;
  const isB2BOrder = searchParams.get("source") === "b2b";
  const [showAllTracking, setShowAllTracking] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["farmerOrder", isB2BOrder ? "b2b" : "retail", orderId],
    queryFn: () => api.get(isB2BOrder ? `/b2b/orders/${orderId}` : `/orders/${orderId}`),
    enabled: !!orderId,
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const { data: fulfillmentCheckData } = useQuery({
    queryKey: ["farmerFulfillmentCheck", orderId],
    queryFn: () => api.get(`/farmers/me/orders/${orderId}/fulfillment-check`),
    enabled: !!orderId && !isB2BOrder,
    refetchInterval: 10000,
  });
  const fulfillmentCheck = fulfillmentCheckData?.data || fulfillmentCheckData || null;

  const queryClient = useQueryClient();
  const [pickupCode, setPickupCode] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [scanError, setScanError] = useState("");
  const scannerRef = useRef<any>(null);
  const scanRequestedRef = useRef(false);

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {
        // already stopped
      }
      try {
        scannerRef.current.clear();
      } catch {
        // no container
      }
      scannerRef.current = null;
    }
  };

  useEffect(() => {
    (async () => {
      if (!scanOpen) return;
      setScanError("");
      scanRequestedRef.current = true;
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (!scanRequestedRef.current) return;
        const scanner = new Html5Qrcode("farmer-qr-reader");
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (text: string) => {
            if (!scanRequestedRef.current) return;
            scanRequestedRef.current = false;
            stopScanner();
            setScanOpen(false);
            const decoded = decodePickupQr(text);
            if (decoded) {
              setPickupCode(decoded);
              toast.success("QR scanned — review & confirm the hand-off");
            } else {
              toast.error("QR not recognized. Ask the customer to show their pickup QR.");
            }
          },
          () => {}
        );
      } catch (e: any) {
        setScanOpen(false);
        setScanError(
          e?.name === "NotAllowedError"
            ? "Camera permission denied. Allow camera access or enter the pickup code manually."
            : "Could not start the camera. Enter the pickup code manually."
        );
      }
    })();
    return () => {
      scanRequestedRef.current = false;
      void stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanOpen]);

  const decodePickupQr = (text: string): string | null => {
    try {
      const payload = JSON.parse(text);
      if (payload?.t === "agripickup" && payload.c) {
        const code = String(payload.c).trim();
        return /^\d{4,12}$/.test(code) ? code : null;
      }
    } catch {
      // fall through to plain-code handling below
    }
    const digits = text.replace(/\s/g, "");
    return /^\d{4,12}$/.test(digits) ? digits : null;
  };

  const confirmPickup = useMutation({
    mutationFn: (code: string) => api.put(`/farmers/me/orders/${orderId}/confirm-pickup`, { code }),
    onSuccess: () => {
      toast.success("Pickup confirmed successfully");
      queryClient.invalidateQueries({ queryKey: ["farmerOrder", orderId] });
      setPickupCode("");
    },
    onError: (err: any) => {
      const message = err?.message || "Failed to confirm pickup";
      toast.error(message.replace(/^"|"$/g, ""));
    },
  });

  const order = useMemo(() => {
    const o = data?.data || data;
    if (!o) return null;
    const items = Array.isArray(o.items) ? o.items : [];
    return {
      id: o.id || o._id,
      orderNumber: o.orderNumber || o.id || o._id,
      status: (o.status || o.orderStatus || "pending").toLowerCase(),
      deliveryType: o.deliveryType || "delivery",
      date: o.orderDate || o.createdAt,
      items: items.map((i: any) => ({
        name: i.productName || i.cropName || i.name || "Product",
        quantity: String(i.quantity ?? i.quantityKg ?? i.approvedQuantityKg ?? 0),
        price: Number(i.totalPrice || i.lineTotal || i.unitPrice * (i.quantity ?? i.quantityKg ?? 0) || 0),
        unitPrice: Number(i.unitPrice || i.pricePerKg || 0),
      })),
      subtotal: Number(o.subtotal ?? o.subtotalAmount ?? o.totalAmount ?? 0),
      delivery: Number(o.deliveryCharge || 0),
      platformFee: Number(o.platformFee || 0),
      platformCommission: Number(o.platformCommission || 0),
      discount: Number(o.discount || 0),
      total: Number(o.totalAmount || 0),
      farmAddress: o.farmAddress || "",
      customerName: o.customer?.name || "Customer",
      customerPhone: o.customer?.phone || "",
      customerEmail: o.customer?.email || "",
      address: typeof o.deliveryAddress === "string"
        ? o.deliveryAddress
        : o.deliveryAddress
          ? [o.deliveryAddress.addressLine1, o.deliveryAddress.addressLine2, o.deliveryAddress.city || o.deliveryAddress.town, o.deliveryAddress.district, o.deliveryAddress.state, o.deliveryAddress.zipCode || o.deliveryAddress.postalCode].filter(Boolean).join(", ")
          : o.shippingAddress
            ? (typeof o.shippingAddress === "string" ? o.shippingAddress : [o.shippingAddress.addressLine1, o.shippingAddress.addressLine2, o.shippingAddress.city, o.shippingAddress.state, o.shippingAddress.zipCode].filter(Boolean).join(", "))
            : "Address not available",
      paymentMethod: o.paymentMethod || "cash",
      paymentStatus: o.paymentStatus || "pending",
      specialInstructions: o.specialInstructions,
      tracking: (Array.isArray(o.statusHistory) ? o.statusHistory : [])
        .filter((h: any) => h && typeof h === "object" && h.isInvalidTransition !== true)
        .map((h: any, index: number) => {
          const action = String(h.action || h.eventType || "").trim().toLowerCase();
          const status = String(h.status || o.status || o.orderStatus || "updated").trim().toLowerCase();
          const actionLabels: Record<string, string> = {
            order_created: "Order placed",
            quality_check: "Quality inspection updated",
            assign_pickup: "Farm pickup team assigned",
            confirm_pickup: "Produce collected from farm",
            receive_stock: "Produce received at warehouse",
            set_fulfillment_route: "Delivery route selected",
            dispatch_transfer: "Warehouse transfer dispatched",
            receive_at_destination: "Received at destination warehouse",
            complete_consolidation: "Farmer orders consolidated",
            dispatch_to_buyer: "Final delivery assigned and dispatched",
            confirm_delivery: "Delivered to business",
            reschedule_delivery: "Delivery schedule changed",
            complete_order: "Order completed",
            cancel_order: "Order cancelled",
          };
          const humanize = (value: string) => value
            .replace(/_/g, " ")
            .replace(/\\b\\w/g, (letter: string) => letter.toUpperCase());
          const date = h.timestamp || h.createdAt || h.date || h.updatedAt || null;
          const parsedDate = date ? new Date(date).getTime() : 0;
          return {
            key: String(h._id || h.id || `${action || status}-${date || index}-${index}`),
            status,
            label: String(h.title || actionLabels[action] || (action ? humanize(action) : humanize(status))),
            actorRole: h.actorRole || "",
            date,
            sortTime: Number.isFinite(parsedDate) ? parsedDate : 0,
            description: String(h.details || h.description || h.note || h.message || ""),
            isDerived: h.isDerived === true,
          };
        })
        .sort((a: any, b: any) => b.sortTime - a.sortTime),
    };
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6 p-6">
        <Button variant="ghost" asChild>
          <Link href="/farmer/orders" className="flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" /> Back to orders
          </Link>
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <Package className="h-10 w-10 text-destructive" />
            <p className="font-medium text-destructive">Failed to load order</p>
            <p className="text-sm text-muted-foreground">{(error as any)?.message || "An unexpected error occurred"}</p>
            <p className="mt-2 text-xs text-muted-foreground">orderId: {orderId}</p>
            <p className="mt-2 text-xs text-muted-foreground">API: http://localhost:8000/api/v1/{isB2BOrder ? "b2b/orders" : "orders"}/{orderId}</p>
            <Button asChild>
              <Link href="/farmer/orders">Back to orders</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="space-y-6 p-6">
        <Button variant="ghost" asChild>
          <Link href="/farmer/orders" className="flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" /> Back to orders
          </Link>
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <Package className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">Order not found</p>
            <p className="text-sm text-muted-foreground">The order you are looking for does not exist or you don't have access.</p>
            <Button asChild>
              <Link href="/farmer/orders">Back to orders</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const progress = getOrderProgress(order.status, order.deliveryType);
  const mapUrl = order.address && order.address !== "Address not available"
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.address)}`
    : null;
  const paymentMethodLabel = pickupPaymentLabel(order.paymentMethod);
  const statusLabel = order.status.replace(/_/g, " ").replace(/\\b\\w/g, (letter: string) => letter.toUpperCase());

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" asChild className="-ml-3 mb-2 text-slate-500 hover:text-slate-900">
            <Link href="/farmer/orders" className="flex items-center gap-2"><ArrowLeft className="h-4 w-4" /> Back to orders</Link>
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><Package className="h-7 w-7" /></div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Orders / Order details</p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Order #{order.orderNumber}</h1>
              <p className="mt-1 text-sm text-slate-500">Placed on {formatDate(order.date)}</p>
            </div>
            <Badge className={`ml-0 sm:ml-2 border px-3 py-1 text-xs ${statusColors[order.status] || "border-slate-200 bg-slate-50 text-slate-700"}`}>{statusLabel}</Badge>
          </div>
        </div>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.75fr)_minmax(300px,0.8fr)]">
        <div className="min-w-0 space-y-5">
          {!progress.terminal ? (
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="p-5 sm:p-6">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-slate-900">Order progress</h2>
                    <p className="mt-1 text-xs text-slate-500">Follow each step until the order is complete.</p>
                  </div>
                  <span className="text-xs font-medium text-emerald-700">{progress.activeIndex >= 5 ? "Completed" : `Step ${Math.min(progress.activeIndex + 1, 5)} of 5`}</span>
                </div>
                <div className="grid grid-cols-5 gap-1 sm:gap-3">
                  {progress.steps.map((step: any, index: number) => {
                    const StepIcon = step.icon;
                    const complete = order.status === "delivered" || order.status === "picked_up" || index < progress.activeIndex;
                    const active = index === progress.activeIndex && !complete;
                    return (
                      <div key={step.label} className="relative min-w-0 text-center">
                        {index > 0 && <div className={`absolute left-[-50%] top-4 h-0.5 w-full ${complete || index <= progress.activeIndex ? "bg-emerald-500" : "bg-slate-200"}`} />}
                        <div className={`relative mx-auto flex h-8 w-8 items-center justify-center rounded-full border-2 ${complete ? "border-emerald-600 bg-emerald-600 text-white" : active ? "border-emerald-600 bg-emerald-50 text-emerald-700 ring-4 ring-emerald-50" : "border-slate-200 bg-white text-slate-400"}`}>
                          {complete ? <CheckCircle2 className="h-4 w-4" /> : <StepIcon className="h-4 w-4" />}
                        </div>
                        <p className={`mt-2 text-[11px] font-semibold leading-tight sm:text-xs ${complete || active ? "text-slate-900" : "text-slate-400"}`}>{step.label}</p>
                        <p className="mt-1 hidden text-[10px] text-slate-400 sm:block">{complete ? "Completed" : active ? "In progress" : "Pending"}</p>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-amber-200 bg-amber-50/60 shadow-sm"><CardContent className="flex items-center gap-3 p-4"><div className="rounded-full bg-amber-100 p-2 text-amber-700"><Package className="h-5 w-5" /></div><div><p className="font-semibold capitalize text-amber-900">Order {order.status}</p><p className="text-sm text-amber-800">This order is no longer moving through the regular delivery steps.</p></div></CardContent></Card>
          )}

          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100 px-5 py-4">
              <CardTitle className="flex items-center gap-2 text-base text-slate-900"><ShoppingBag className="h-5 w-5 text-emerald-700" /> Order items</CardTitle>
              <CardDescription>{order.items.length} product{order.items.length === 1 ? "" : "s"} in this order</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-5">
              <div className="hidden grid-cols-[minmax(0,1fr)_100px_120px_120px] gap-3 rounded-lg bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:grid">
                <span>Product</span><span className="text-center">Quantity</span><span className="text-right">Unit price</span><span className="text-right">Amount</span>
              </div>
              {order.items.map((item: any, index: number) => (
                <div key={index} className="grid grid-cols-2 items-center gap-2 rounded-lg border border-slate-200 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_100px_120px_120px] sm:gap-3 sm:border-0 sm:px-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{item.name}</p>
                    <p className="text-xs text-slate-500 sm:hidden">Qty: {item.quantity}</p>
                  </div>
                  <span className="hidden text-center text-sm text-slate-700 sm:block">{item.quantity}</span>
                  <span className="text-right text-sm text-slate-600 sm:text-right">{formatPrice(Number(item.unitPrice))}</span>
                  <span className="text-right text-sm font-semibold text-slate-900">{formatPrice(Number(item.price))}</span>
                </div>
              ))}
              <div className="ml-auto max-w-sm space-y-2 border-t border-slate-100 pt-4 text-sm">
                <div className="flex justify-between gap-4 text-slate-600"><span>Subtotal</span><span>{formatPrice(order.subtotal)}</span></div>
                <div className="flex justify-between gap-4 text-slate-600"><span>Delivery</span><span>{formatPrice(order.delivery)}</span></div>
                {order.platformFee > 0 && <div className="flex justify-between gap-4 text-slate-600"><span>Platform fee</span><span>{formatPrice(order.platformFee)}</span></div>}
                {order.discount > 0 && <div className="flex justify-between gap-4 text-emerald-700"><span>Discount</span><span>-{formatPrice(order.discount)}</span></div>}
                <div className="flex justify-between gap-4 border-t border-slate-200 pt-3 text-base font-bold text-slate-950"><span>Total</span><span>{formatPrice(order.total)}</span></div>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 px-5 py-4">
              <div><CardTitle className="flex items-center gap-2 text-base text-slate-900"><Clock className="h-5 w-5 text-emerald-700" /> Tracking & activity</CardTitle><CardDescription className="mt-1">Updates recorded for this order, newest first</CardDescription></div>
              {order.tracking.length > 0 && <Button type="button" variant="outline" size="sm" onClick={() => setShowAllTracking(!showAllTracking)}>{showAllTracking ? "Show latest" : "View all activity"} <ChevronDown className="ml-1 h-4 w-4" /></Button>}
            </CardHeader>
            <CardContent className="p-5">
              {order.tracking.length > 0 ? (
                <div className="space-y-0">
                  {(showAllTracking ? order.tracking : order.tracking.slice(0, 4)).map((event: any, index: number, visibleEvents: any[]) => (
                    <div key={event.key} className="flex gap-3 pb-5 last:pb-0">
                      <div className="flex w-5 shrink-0 flex-col items-center">
                        <span className={`mt-1 h-3 w-3 rounded-full border-2 ${index === 0 ? "border-emerald-600 bg-emerald-600" : "border-slate-300 bg-white"}`} />
                        {index < visibleEvents.length - 1 && <span className="mt-1 w-px flex-1 bg-slate-200" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className={`text-sm font-semibold ${index === 0 ? "text-emerald-800" : "text-slate-800"}`}>{event.label || "Order update"}</p>
                          {event.date && <time className="text-xs text-slate-500">{formatDate(event.date)}</time>}
                        </div>
                        {event.description && <p className="mt-1 text-sm leading-relaxed text-slate-600">{event.description}</p>}
                        {event.actorRole && <p className="mt-1 text-xs text-slate-500">Updated by {humanizeRole(event.actorRole)}</p>}
                        {event.isDerived && <p className="mt-1 text-[11px] text-slate-400">Reconstructed from saved order details</p>}
                      </div>
                    </div>
                  ))}
                  {order.tracking.length > 4 && <button type="button" onClick={() => setShowAllTracking(!showAllTracking)} className="mt-4 text-sm font-semibold text-emerald-700 hover:text-emerald-800">{showAllTracking ? "Show fewer updates" : `Show all ${order.tracking.length} updates`}</button>}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-8 text-center">
                  <Clock className="mx-auto h-7 w-7 text-slate-400" /><p className="mt-2 text-sm font-medium text-slate-700">No tracking updates yet</p><p className="mt-1 text-xs text-slate-500">New activity will appear here when the order progresses.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {fulfillmentCheck && (
            <Card className={fulfillmentCheck.readyForDispatch ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-amber-50/40"}>
              <CardHeader className="pb-2"><CardTitle className="text-base">Packing & dispatch check</CardTitle><CardDescription>Every item must be packed before this order can leave the farm.</CardDescription></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between"><span>Order items packed</span><b>{fulfillmentCheck.packedItemCount || 0} / {fulfillmentCheck.itemCount || 0}</b></div>
                <div className="flex items-center justify-between"><span>Dispatch status</span><Badge variant={fulfillmentCheck.readyForDispatch ? "success" : "warning"}>{fulfillmentCheck.readyForDispatch ? "Ready" : "Not ready"}</Badge></div>
                {!fulfillmentCheck.readyForDispatch && <p className="text-xs text-amber-800">Complete packing for every item before dispatch.</p>}
              </CardContent>
            </Card>
          )}

          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100 px-5 py-4"><CardTitle className="flex items-center gap-2 text-base text-slate-900"><MapPin className="h-5 w-5 text-emerald-700" /> Delivery address</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
              <p className="min-w-0 flex-1 text-sm leading-relaxed text-slate-700">{order.address}</p>
              {mapUrl && <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-emerald-200 px-3 py-2 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-50"><MapPin className="h-4 w-4" /> View map <ExternalLink className="h-3.5 w-3.5" /></a>}
              {order.specialInstructions && <div className="w-full rounded-lg bg-slate-50 p-3 text-sm"><p className="text-xs font-semibold text-slate-500">Delivery instructions</p><p className="mt-1 text-slate-700">{order.specialInstructions}</p></div>}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-5">
          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100 bg-emerald-50/50 px-5 py-4"><CardTitle className="flex items-center gap-2 text-base text-slate-900"><User className="h-5 w-5 text-emerald-700" /> Customer details</CardTitle></CardHeader>
            <CardContent className="space-y-4 p-5 text-sm">
              <div className="flex items-center gap-3"><User className="h-4 w-4 shrink-0 text-slate-400" /><span className="font-medium text-slate-800">{order.customerName}</span></div>
              {order.customerPhone && <a href={`tel:${order.customerPhone}`} className="flex items-center gap-3 text-slate-700 hover:text-emerald-700"><Phone className="h-4 w-4 shrink-0 text-slate-400" />{order.customerPhone}</a>}
              {order.customerEmail && <a href={`mailto:${order.customerEmail}`} className="flex items-center gap-3 break-all text-slate-700 hover:text-emerald-700"><Mail className="h-4 w-4 shrink-0 text-slate-400" />{order.customerEmail}</a>}
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100 px-5 py-4"><CardTitle className="flex items-center gap-2 text-base text-slate-900"><ClipboardList className="h-5 w-5 text-emerald-700" /> Order summary</CardTitle></CardHeader>
            <CardContent className="space-y-3 p-5 text-sm">
              <div className="flex items-start justify-between gap-3"><span className="text-slate-500">Order ID</span><span className="break-all text-right font-medium text-slate-800">{order.orderNumber}</span></div>
              <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-slate-500"><CalendarDays className="h-4 w-4" /> Date</span><span className="text-right font-medium text-slate-800">{formatDate(order.date)}</span></div>
              <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-slate-500"><CreditCard className="h-4 w-4" /> Payment</span><span className="text-right font-medium capitalize text-slate-800">{paymentMethodLabel}</span></div>
              <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3"><span className="text-slate-500">Payment status</span><Badge variant={order.paymentStatus === "paid" ? "success" : "secondary"}>{String(order.paymentStatus || "pending").replace(/_/g, " ")}</Badge></div>
            </CardContent>
          </Card>

                    {order.deliveryType === "pickup" && order.status === "ready_for_pickup" && (
            <Card className="border-amber-200 bg-amber-50/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Store className="h-5 w-5 text-amber-700" /> Confirm Farm Pickup
                </CardTitle>
                <CardDescription>
                  Scan the customer's QR code — or ask for the 6-digit pickup code — to confirm the hand-off.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3 rounded-lg border bg-white p-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Customer</p>
                    <p className="font-medium">{order.customerName}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Order</p>
                    <p className="font-medium">{order.orderNumber}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Amount</p>
                    <p className="font-medium">{formatPrice(order.total)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Payment</p>
                    <p className="font-medium">{pickupPaymentLabel(order.paymentMethod)}</p>
                  </div>
                </div>

                {scanOpen && (
                  <div className="space-y-2">
                    <div className="overflow-hidden rounded-lg border bg-slate-900">
                      <div id="farmer-qr-reader" className="mx-auto max-w-xs" />
                    </div>
                    <p className="text-center text-xs text-muted-foreground">
                      Point the camera at the QR code on the customer's phone.
                    </p>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        scanRequestedRef.current = false;
                        void stopScanner();
                        setScanOpen(false);
                      }}
                    >
                      <X className="mr-2 h-4 w-4" /> Close Scanner
                    </Button>
                  </div>
                )}

                {scanError && (
                  <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{scanError}</p>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 border-amber-300 text-amber-700 hover:bg-amber-100"
                    onClick={() => setScanOpen(true)}
                    disabled={scanOpen}
                  >
                    <ScanLine className="mr-2 h-4 w-4" /> Scan QR
                  </Button>
                  <div className="flex items-center text-xs font-medium text-muted-foreground">
                    or enter code
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Pickup Code</label>
                  <Input
                    value={pickupCode}
                    onChange={(e) => setPickupCode(e.target.value.trim())}
                    placeholder="Enter 6-digit code"
                    maxLength={12}
                    inputMode="numeric"
                    className="font-mono text-center text-lg tracking-[0.4em]"
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={pickupCode.length < 4 || confirmPickup.isPending}
                  onClick={() => confirmPickup.mutate(pickupCode)}
                >
                  {confirmPickup.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="mr-2 h-4 w-4" /> Confirm Pickup
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}

          {order.deliveryType === "pickup" && order.status === "picked_up" && (
            <Card className="border-green-200 bg-green-50/40">
              <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
                <CheckCircle className="h-8 w-8 text-green-600" />
                <p className="font-medium text-green-800">Pickup Completed</p>
                <p className="text-sm text-green-700">Order handed over to the customer.</p>
              </CardContent>
            </Card>
          )}

        </aside>
      </div>
    </div>
  );
}
