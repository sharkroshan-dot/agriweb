"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { useParams } from "next/navigation";
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

const pickupPaymentLabel = (method: string) => {
  const m = (method || "").toLowerCase();
  if (m === "cash" || m === "cod" || m === "cash_on_delivery") return "Cash on Pickup";
  return m.replace(/_/g, " ");
};

export default function FarmerOrderDetailPage() {
  const params = useParams();
  const orderId = params.orderId as string;
  const [showAllTracking, setShowAllTracking] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["farmerOrder", orderId],
    queryFn: () => api.get(`/orders/${orderId}`),
    enabled: !!orderId,
  });

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
        name: i.productName || "Product",
        quantity: String(i.quantity || 0),
        price: Number(i.totalPrice || i.unitPrice * i.quantity || 0),
        unitPrice: Number(i.unitPrice || 0),
      })),
      subtotal: Number(o.subtotal || 0),
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
      tracking: (o.statusHistory || []).map((h: any) => ({
        status: (h.status || "").toLowerCase(),
        date: h.createdAt || h.date,
        description: h.note || h.changedByName ? `${h.note || ""}${h.changedByName ? " by " + h.changedByName : ""}` : h.status || "Status update",
      })),
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
            <p className="mt-2 text-xs text-muted-foreground">API: http://localhost:8000/api/v1/orders/{orderId}</p>
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
    <div className="space-y-6 p-6">
      <Button variant="ghost" asChild>
        <Link href="/farmer/orders" className="flex items-center gap-2">
          <ArrowLeft className="h-4 w-4" /> Back to orders
        </Link>
      </Button>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Order {order.orderNumber.slice(-8)}</h1>
          <p className="text-sm text-muted-foreground">Placed on {formatDate(order.date)}</p>
        </div>
        <Badge className={statusColors[order.status] || "border-gray-200 bg-gray-50 text-gray-700"}>
          {order.status.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" /> Items
              </CardTitle>
              <CardDescription>{order.items.length} product(s) in this order</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {order.items.map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between rounded-lg border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{item.name}</p>
                    <p className="text-sm text-muted-foreground">Qty: {item.quantity} &times; {formatPrice(Number(item.unitPrice))}</p>
                  </div>
                  <span className="ml-4 font-semibold">{formatPrice(Number(item.price))}</span>
                </div>
              ))}
              <div className="border-t pt-3 space-y-1.5">
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
                <div className="flex justify-between border-t pt-2 font-semibold">
                  <span>Total</span>
                  <span>{formatPrice(order.total)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" /> Delivery Address
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{order.address}</p>
              {order.specialInstructions && (
                <div className="mt-3 rounded-md bg-gray-50 p-3 text-sm">
                  <p className="text-xs font-medium text-gray-500">Special Instructions</p>
                  <p className="mt-1 text-gray-700">{order.specialInstructions}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {order.tracking && order.tracking.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <button
                  onClick={() => setShowAllTracking(!showAllTracking)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="h-5 w-5" /> Tracking
                  </CardTitle>
                  {showAllTracking ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
              </CardHeader>
              <CardContent>
                <div className="relative space-y-0">
                  {(showAllTracking ? order.tracking : order.tracking.slice(-2)).map((event: any, i: number) => (
                    <div key={i} className="flex gap-4 pb-4 last:pb-0">
                      <div className="flex flex-col items-center">
                        <div className={`h-3 w-3 rounded-full border-2 ${i === 0 ? "border-emerald-500 bg-emerald-500" : "border-gray-300 bg-white"}`} />
                        {i < (showAllTracking ? order.tracking.length : Math.min(2, order.tracking.length)) - 1 && (
                          <div className="mt-1 w-0.5 flex-1 bg-gray-200" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1 pt-0.5">
                        <p className={`text-sm font-medium ${i === 0 ? "text-emerald-700" : "text-gray-500"}`}>
                          {event.status.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                        </p>
                        {event.description && <p className="text-xs text-muted-foreground">{event.description}</p>}
                        {event.date && <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(event.date)}</p>}
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
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" /> Customer Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Hash className="h-5 w-5" /> Order Info
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
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
