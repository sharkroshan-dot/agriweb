"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Package, MapPin, Clock, CreditCard, User, Phone, Hash, ShoppingBag, ChevronDown, ChevronUp, Store, CheckCircle, Loader2, ScanLine, X } from "lucide-react";
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
      address: o.deliveryAddress
        ? [o.deliveryAddress.addressLine1, o.deliveryAddress.addressLine2, o.deliveryAddress.city, o.deliveryAddress.state, o.deliveryAddress.zipCode].filter(Boolean).join(", ")
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

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-2">
          <Button variant="ghost" size="sm" asChild className="-ml-3 text-slate-500 hover:text-slate-900">
            <Link href="/farmer/orders" className="flex items-center gap-2"><ArrowLeft className="h-4 w-4" /> Back to orders</Link>
          </Button>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Order management</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Order details</h1>
            <p className="mt-1 text-sm text-slate-500">{order.orderNumber} <span className="mx-1.5 text-slate-300">•</span> Placed {formatDate(order.date)}</p>
          </div>
        </div>
        <Badge className={statusColors[order.status] || "border-slate-200 bg-slate-50 text-slate-700"}>
          {order.status.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="border-slate-200/80 shadow-sm"><CardContent className="flex items-center gap-3 p-4"><div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700"><ShoppingBag className="h-4 w-4" /></div><div className="min-w-0"><p className="text-xs text-slate-500">Products</p><p className="mt-0.5 text-lg font-semibold text-slate-900">{order.items.length} <span className="text-xs font-normal text-slate-500">items</span></p></div></CardContent></Card>
        <Card className="border-slate-200/80 shadow-sm"><CardContent className="flex items-center gap-3 p-4"><div className="rounded-xl bg-blue-50 p-2.5 text-blue-700"><CreditCard className="h-4 w-4" /></div><div className="min-w-0"><p className="text-xs text-slate-500">Order total</p><p className="mt-0.5 truncate text-lg font-semibold text-slate-900">{formatPrice(order.total)}</p></div></CardContent></Card>
        <Card className="border-slate-200/80 shadow-sm"><CardContent className="flex items-center gap-3 p-4"><div className="rounded-xl bg-violet-50 p-2.5 text-violet-700"><Clock className="h-4 w-4" /></div><div className="min-w-0"><p className="text-xs text-slate-500">Order date</p><p className="mt-0.5 truncate text-sm font-semibold text-slate-900">{formatDate(order.date)}</p></div></CardContent></Card>
        <Card className="border-slate-200/80 shadow-sm"><CardContent className="flex items-center gap-3 p-4"><div className="rounded-xl bg-amber-50 p-2.5 text-amber-700"><CreditCard className="h-4 w-4" /></div><div className="min-w-0"><p className="text-xs text-slate-500">Payment</p><p className="mt-0.5 truncate text-sm font-semibold capitalize text-slate-900">{order.paymentStatus || "Pending"}</p></div></CardContent></Card>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.85fr)]">
        <div className="space-y-6">
          <Card className="overflow-hidden border-slate-200/80 shadow-sm">
            <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-5 py-4">
              <CardTitle className="flex items-center gap-2 text-base text-slate-900"><Package className="h-4 w-4 text-emerald-700" /> Order items</CardTitle>
              <CardDescription>{order.items.length} product(s) included in this order</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-5">
              {order.items.map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:bg-slate-50/70">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{item.name}</p>
                    <p className="text-sm text-muted-foreground">Qty: {item.quantity} &times; {formatPrice(Number(item.unitPrice))}</p>
                  </div>
                  <span className="ml-4 font-semibold">{formatPrice(Number(item.price))}</span>
                </div>
              ))}
              <div className="space-y-2 border-t border-slate-100 pt-4">
                <div className="flex justify-between text-sm">
                  <span>Subtotal</span>
                  <span>{formatPrice(order.subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Delivery</span>
                  <span>{formatPrice(order.delivery)}</span>
                </div>
                {order.platformFee > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>Platform fee</span>
                    <span>{formatPrice(order.platformFee)}</span>
                  </div>
                )}
                {order.discount > 0 && (
                  <div className="flex justify-between text-sm text-emerald-600">
                    <span>Discount</span>
                    <span>-{formatPrice(order.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-slate-200 pt-3 text-base font-bold text-slate-900">
                  <span>Total</span>
                  <span>{formatPrice(order.total)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-slate-200/80 shadow-sm">
            <CardHeader className="border-b border-slate-100 px-5 py-4"><CardTitle className="flex items-center gap-2 text-base text-slate-900"><MapPin className="h-4 w-4 text-emerald-700" /> Delivery address</CardTitle></CardHeader>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">{order.address}</p>
              {order.specialInstructions && (
                <div className="mt-3 rounded-md bg-gray-50 p-3 text-sm">
                  <p className="text-xs font-medium text-gray-500">Special Instructions</p>
                  <p className="mt-1 text-gray-700">{order.specialInstructions}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {fulfillmentCheck && (
            <Card className={fulfillmentCheck.readyForDispatch ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-amber-50/40"}>
              <CardHeader className="pb-2"><CardTitle className="text-base">Packing & Dispatch Check</CardTitle><CardDescription>Every customer-order item must be packed before this order can leave the farm.</CardDescription></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between"><span>Order items</span><b>{fulfillmentCheck.packedItemCount || 0} / {fulfillmentCheck.itemCount || 0} packed</b></div>
                <div className="flex items-center justify-between"><span>Dispatch gate</span><Badge variant={fulfillmentCheck.readyForDispatch ? "success" : "warning"}>{fulfillmentCheck.readyForDispatch ? "Ready" : "Blocked"}</Badge></div>
                {!fulfillmentCheck.readyForDispatch && <p className="text-xs text-amber-800">Complete packing for every item before dispatch.</p>}
              </CardContent>
            </Card>
          )}

          {order.tracking && order.tracking.length > 0 && (
            <Card className="overflow-hidden border-slate-200/80 shadow-sm">
              <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-5 py-4">
                <button
                  onClick={() => setShowAllTracking(!showAllTracking)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <div><CardTitle className="flex items-center gap-2 text-base text-slate-900"><Clock className="h-4 w-4 text-emerald-700" /> Order activity</CardTitle><CardDescription className="mt-1">Latest fulfillment updates and status history</CardDescription></div>
                  {showAllTracking ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
              </CardHeader>
              <CardContent className="p-5">
                <div className="relative space-y-0">
                  {(showAllTracking ? order.tracking : order.tracking.slice(0, 2)).map((event: any, i: number, visibleEvents: any[]) => (
                    <div key={event.key} className="flex gap-4 pb-4 last:pb-0">
                      <div className="flex flex-col items-center">
                        <div className={`h-3 w-3 rounded-full border-2 ${i === 0 ? "border-emerald-500 bg-emerald-500" : "border-gray-300 bg-white"}`} />
                        {i < visibleEvents.length - 1 && (
                          <div className="mt-1 w-0.5 flex-1 bg-gray-200" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1 pt-0.5">
                        <p className={`text-sm font-medium ${i === 0 ? "text-emerald-700" : "text-gray-500"}`}>
                          {event.label || "Order update"}
                          {event.isDerived && <span className="ml-2 text-[10px] font-normal text-slate-400">Reconstructed from saved order details</span>}
                        </p>
                        {event.description && <p className="mt-1 text-xs text-muted-foreground">{event.description}</p>}
                        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                          {event.actorRole && <span>Updated by {humanizeRole(event.actorRole)}</span>}
                          {event.date && <span>{formatDate(event.date)}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                  {order.tracking.length > 2 && (
                    <button
                      onClick={() => setShowAllTracking(!showAllTracking)}
                      className="text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                    >
                      {showAllTracking ? "Show less" : `Show all ${order.tracking.length} updates`}
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card className="overflow-hidden border-slate-200/80 shadow-sm">
            <CardHeader className="border-b border-slate-100 px-5 py-4"><CardTitle className="flex items-center gap-2 text-base text-slate-900"><User className="h-4 w-4 text-emerald-700" /> Customer details</CardTitle></CardHeader>
            <CardContent className="space-y-3 p-5 text-sm">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="font-medium">{order.customerName}</span>
              </div>
              {order.customerPhone && (
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span>{order.customerPhone}</span>
                </div>
              )}
              {order.customerEmail && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{order.customerEmail}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-slate-200/80 shadow-sm">
            <CardHeader className="border-b border-slate-100 px-5 py-4"><CardTitle className="flex items-center gap-2 text-base text-slate-900"><Hash className="h-4 w-4 text-emerald-700" /> Order information</CardTitle></CardHeader>
            <CardContent className="space-y-3 p-5 text-sm">
              <div className="flex items-center gap-2">
                <ShoppingBag className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="font-medium">{order.orderNumber}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                <span>{formatDate(order.date)}</span>
              </div>
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="capitalize">{order.paymentMethod.replace(/_/g, " ")}</span>
                {order.paymentStatus === "paid" && <Badge variant="success">Paid</Badge>}
                {order.paymentStatus !== "paid" && <Badge variant="secondary">Pending</Badge>}
              </div>
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
        </div>
      </div>
    </div>
  );
}
