"use client";

import { useState, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Package, MapPin, Clock, CreditCard, ChevronDown, ChevronUp, Store, CheckCircle, Star, RefreshCw, Phone, Truck, X, MessageCircle, Navigation, Receipt, AlertTriangle, ImagePlus, ArrowUpLeft, Loader2 } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../../../components/ui/dialog";
import { Map as LiveMap } from "../../../components/shared/map";
import { QRCodeSVG } from "qrcode.react";
import { formatPrice, formatDate } from "../../../lib/utils";
import { api } from "../../../lib/api/client";
import { useCartStore } from "../../../lib/store/cart-store";
import toast from "react-hot-toast";
import { LiveChatDialog } from "../../../components/delivery/live-chat-dialog";

const statusColors: Record<string, string> = {
  pending: "border-yellow-200 bg-yellow-50 text-yellow-700",
  confirmed: "border-blue-200 bg-blue-50 text-blue-700",
  processing: "border-purple-200 bg-purple-50 text-purple-700",
  ready_for_delivery: "border-indigo-200 bg-indigo-50 text-indigo-700",
  dispatched: "border-purple-200 bg-purple-50 text-purple-700",
  in_transit: "border-blue-200 bg-blue-50 text-blue-700",
  delivered: "border-green-200 bg-green-50 text-green-700",
  cancelled: "border-red-200 bg-red-50 text-red-700",
  refunded: "border-orange-200 bg-orange-50 text-orange-700",
};

const StarPicker = ({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) => (
  <div className="flex items-center gap-1">
    {[1, 2, 3, 4, 5].map((s) => (
      <button
        key={s}
        type="button"
        disabled={disabled}
        onClick={() => onChange(s)}
        className={`text-2xl transition ${s <= value ? "text-yellow-500" : "text-slate-300 hover:text-yellow-300"} ${disabled ? "cursor-default" : ""}`}
        aria-label={`${s} stars`}
      >
        ★
      </button>
    ))}
  </div>
);

const RatedRow = ({ label, value }: { label: string; value: number }) => (
  <div className="flex items-center justify-between rounded-md bg-white p-2">
    <span className="text-sm text-muted-foreground">{label}</span>
    <span className="flex items-center gap-1 text-sm font-medium">
      {value} <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
    </span>
  </div>
);

export default function OrderDetailPage() {
  const params = useParams();
  const orderId = params.orderId as string;
  const router = useRouter();
  const addItem = useCartStore((s: any) => s.addItem);
  const [showAllTracking, setShowAllTracking] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelReasonCode, setCancelReasonCode] = useState("ordered_by_mistake");
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [showProblemDialog, setShowProblemDialog] = useState(false);
  const [problemReason, setProblemReason] = useState("damaged_product");
  const [problemResolution, setProblemResolution] = useState("partial_refund");
  const [problemDescription, setProblemDescription] = useState("");
  const [problemItems, setProblemItems] = useState<Record<string, number>>({});
  const [reporting, setReporting] = useState(false);
  const [problemEvidence, setProblemEvidence] = useState<string[]>([]);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const evidenceFileInputRef = useRef<HTMLInputElement>(null);
  const [reviews, setReviews] = useState<Record<string, { rating: number; comment: string; loading?: boolean; submitted?: boolean; error?: string }>>({});

  const updateReview = (productId: string, patch: Partial<{ rating: number; comment: string; error?: string }>) => {
    setReviews((prev) => ({
      ...prev,
      [productId]: { ...(prev[productId] || { rating: 0, comment: "" }), ...patch },
    }));
  };

  const submitReview = async (productId: string, itemName: string) => {
    if (!productId) return;
    const r = reviews[productId] || { rating: 0, comment: "" };
    if (r.rating < 1) {
      updateReview(productId, { error: "Please select a star rating." });
      return;
    }
    if (!r.comment.trim()) {
      updateReview(productId, { error: "Please write a short comment." });
      return;
    }
    setReviews((prev) => ({ ...prev, [productId]: { ...(prev[productId] || r), loading: true, error: "" } }));
    try {
      await api.post(`/products/${productId}/reviews`, {
        rating: r.rating,
        comment: r.comment.trim(),
        orderId: orderId,
      });
      setReviews((prev) => ({ ...prev, [productId]: { ...(prev[productId] || r), loading: false, submitted: true } }));
    } catch (e: any) {
      const msg = e.message || "Failed to submit review";
      const already = /already/.test(msg);
      setReviews((prev) => ({
        ...prev,
        [productId]: { ...(prev[productId] || r), loading: false, error: already ? "You already rated this product." : msg },
      }));
    }
  };

  const { data, isLoading, error, refetch: refetchOrder } = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => api.get(`/orders/${orderId}`),
    enabled: !!orderId,
  });

  const { data: cancelEligibilityData, refetch: refetchEligibility } = useQuery({
    queryKey: ["orderCancelEligibility", orderId],
    queryFn: () => api.get(`/refunds/orders/${orderId}/eligibility`, { params: { type: "cancellation" } }),
    enabled: !!orderId,
    retry: 1,
  });

  const { data: orderRefundsData, refetch: refetchOrderRefunds } = useQuery({
    queryKey: ["orderRefunds", orderId],
    queryFn: () => api.get(`/refunds/orders/${orderId}/refunds`),
    enabled: !!orderId,
    retry: 1,
  });

  const cancelEligibility = cancelEligibilityData?.data || null;
  const orderRefunds = useMemo(() => {
    const list = orderRefundsData?.data || (Array.isArray(orderRefundsData) ? orderRefundsData : []);
    return list.map((r: any) => ({
      id: r.id || r._id,
      refundId: r.refundId || r.id,
      status: (r.status || "requested").toLowerCase(),
      amount: Number(r.approvedAmount ?? r.requestedAmount ?? r.amount ?? 0),
      reason: r.reason || null,
    }));
  }, [orderRefundsData]);

  const [partnerRating, setPartnerRating] = useState<Record<string, number>>({});
  const [partnerFeedback, setPartnerFeedback] = useState("");
  const [partnerSubmitting, setPartnerSubmitting] = useState(false);

  const { data: deliveryRatingStatus, refetch: refetchDeliveryRating } = useQuery({
    queryKey: ["deliveryRating", orderId],
    queryFn: () => api.get(`/delivery-ratings/order/${orderId}`),
    enabled: !!orderId,
    retry: 1,
  });

  const partnerRatingData = deliveryRatingStatus?.data?.data || deliveryRatingStatus?.data || null;
  const partnerRated = partnerRatingData?.rated === true;

  const handleSubmitPartnerRating = async () => {
    if (!order?.deliveryRating?.partnerId) return;
    const required = ["overall", "onTime", "professionalism", "handling", "communication"];
    if (required.some((k) => !partnerRating[k] || partnerRating[k] < 1)) {
      toast.error("Please select a rating for every category.");
      return;
    }
    setPartnerSubmitting(true);
    try {
      await api.post("/delivery-ratings", {
        orderId: order.id,
        overallRating: partnerRating.overall,
        onTimeRating: partnerRating.onTime,
        professionalismRating: partnerRating.professionalism,
        handlingRating: partnerRating.handling,
        communicationRating: partnerRating.communication,
        feedback: partnerFeedback.trim() || undefined,
      });
      toast.success("Thanks! Your delivery partner rating has been submitted.");
      setPartnerFeedback("");
      setPartnerRating({});
      refetchDeliveryRating();
      refetchOrder();
    } catch (e: any) {
      const msg = e?.message || "Failed to submit rating";
      const already = /already/i.test(msg);
      toast.error(already ? "You already rated this delivery partner." : msg);
      if (already) refetchDeliveryRating();
    } finally {
      setPartnerSubmitting(false);
    }
  };

  const order = useMemo(() => {    const o = data?.data || data;
    if (!o) return null;
    return {
      id: o.id || o._id,
      orderNumber: o.orderNumber || o.id || o._id,
      status: (o.status || o.orderStatus || "pending").toLowerCase(),
      date: o.orderDate || o.createdAt,
      estimatedDelivery: o.deliveryDate || o.estimatedDeliveryDate,
      items: (o.items || []).map((i: any) => ({
        id: i.productId || i.product_id,
        name: i.productName || "Product",
        quantity: `${i.quantity}`,
        price: i.totalPrice || i.unitPrice * i.quantity || 0,
        unitPrice: i.unitPrice || 0,
        productImage: i.productImage,
        pickupAvailable: i.pickupAvailable ?? false,
        farmAddress: i.farmAddress || "",
      })),
      subtotal: o.subtotal || 0,
      delivery: o.deliveryCharge || 0,
      platformFee: o.platformFee || 0,
      discount: o.discount || 0,
      total: o.totalAmount || 0,
      address: o.deliveryAddress
        ? `${o.deliveryAddress.addressLine1 || ""}${o.deliveryAddress.addressLine2 ? ", " + o.deliveryAddress.addressLine2 : ""}, ${o.deliveryAddress.city || ""}, ${o.deliveryAddress.state || ""} - ${o.deliveryAddress.zipCode || ""}`
        : "Address not available",
      deliveryAddress: o.deliveryAddress,
      farmer: o.farmer || null,
      deliveryRating: o.deliveryRating || null,
      paymentMethod: o.paymentMethod || "cash",
      specialInstructions: o.specialInstructions,
      deliveryType: o.deliveryType || "delivery",
      pickupDate: o.pickupDate,
      pickupTimeSlot: o.pickupTimeSlot,
      requestedDeliveryDate: o.requestedDeliveryDate,
      deliveryTimeSlot: o.deliveryTimeSlot,
      farmAddress: o.farmAddress || "",
      farmLocation: o.farmLocation || null,
      pickupInstructions: o.pickupInstructions || "",
      pickupCode: o.pickupCode as string | undefined,
      isBulkOrder: o.isBulkOrder || false,
      tracking: (o.statusHistory || []).map((h: any) => ({
        status: (h.status || "").toLowerCase(),
        date: h.createdAt || h.date,
        description: h.note || h.status || "Status update",
      })),
    };
  }, [data]);

  const activeTrackingStatuses = new Set([
    "pending", "confirmed", "processing", "ready_for_delivery", "ready_for_pickup",
    "dispatched", "in_transit", "shipped", "out_for_delivery",
  ]);
  const isTrackable = !!order && activeTrackingStatuses.has(order.status);

  const { data: liveTrackingData, refetch: refetchTracking } = useQuery({
    queryKey: ["orderTracking", orderId],
    queryFn: () => api.get(`/orders/${orderId}/track`),
    enabled: isTrackable,
    refetchInterval: isTrackable ? 10000 : false,
    retry: 1,
  });

  const liveTracking = useMemo(() => {
    const t = liveTrackingData?.data || liveTrackingData;
    if (!t) return null;
    const coords = t.currentLocation?.coordinates;
    return {
      orderStatus: (t.orderStatus || "").toLowerCase(),
      currentLocation: coords ? { lat: coords[1], lng: coords[0] } : null,
      deliveryLocation: t.deliveryLocation,
      eta: t.eta,
      distanceRemaining: t.distanceRemaining,
      deliveryPartner: t.deliveryPartner,
      locationUpdatedAt: t.locationUpdatedAt || t.lastUpdated,
      statusHistory: t.statusHistory || [],
    };
  }, [liveTrackingData]);

  const deliveryDestination = useMemo(() => {
    const coords =
      liveTracking?.deliveryLocation?.coordinates ||
      order?.deliveryAddress?.location?.coordinates;
    return coords ? { lat: coords[1], lng: coords[0] } : null;
  }, [liveTracking, order]);

  const farmMapCenter = useMemo(() => {
    const loc = (order as any)?.farmLocation;
    const coords = loc?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      return { lat: Number(coords[1]), lng: Number(coords[0]) };
    }
    const lat = loc?.lat ?? loc?.latitude;
    const lng = loc?.lng ?? loc?.lon ?? loc?.longitude;
    return lat != null && lng != null ? { lat: Number(lat), lng: Number(lng) } : null;
  }, [order]);

  const trackingMapMarkers = useMemo(() => {
    const markers: any[] = [];
    if (liveTracking?.currentLocation) {
      markers.push({
        id: "partner",
        lat: liveTracking.currentLocation.lat,
        lng: liveTracking.currentLocation.lng,
        title: "Delivery partner",
        info: liveTracking.deliveryPartner?.name || "Out for delivery",
      });
    }
    if (deliveryDestination) {
      markers.push({
        id: "destination",
        lat: deliveryDestination.lat,
        lng: deliveryDestination.lng,
        title: "Delivery address",
        info: order?.deliveryAddress?.city || "Your address",
      });
    }
    if (markers.length === 0 && order?.deliveryType === "pickup" && farmMapCenter) {
      markers.push({
        id: "farm",
        lat: farmMapCenter.lat,
        lng: farmMapCenter.lng,
        title: "Farm pickup location",
        info: order?.farmAddress || "Farm",
      });
    }
    return markers;
  }, [liveTracking, deliveryDestination, farmMapCenter, order]);

  const trackingMapCenter = liveTracking?.currentLocation || deliveryDestination || farmMapCenter || { lat: 11.2322, lng: 77.34 };
  const trackingRoute =
    liveTracking?.currentLocation && deliveryDestination
      ? [liveTracking.currentLocation, deliveryDestination]
      : [];

  const timeAgo = (iso?: string) => {
    if (!iso) return "";
    const then = new Date(iso).getTime();
    if (isNaN(then)) return "";
    const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (seconds < 5) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

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
          <Link href="/orders" className="flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" /> Back to orders
          </Link>
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <Package className="h-10 w-10 text-red-400" />
            <p className="font-medium">Failed to load order</p>
            <p className="text-sm text-muted-foreground">Could not connect to the server. Please try again.</p>
            <Button asChild>
              <Link href="/orders">Back to orders</Link>
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
          <Link href="/orders" className="flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" /> Back to orders
          </Link>
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <Package className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">Order not found</p>
            <p className="text-sm text-muted-foreground">The order you are looking for does not exist.</p>
            <Button asChild>
              <Link href="/nearby">Browse products</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const timeline = (liveTracking?.statusHistory?.length ? liveTracking.statusHistory : order.tracking || []).map(
    (h: any) => ({
      status: h.status || "",
      date: h.createdAt || h.date,
      description: h.note || h.status || "Status update",
    })
  );
  const tracking = showAllTracking ? timeline : timeline.slice(0, 2);

  const canReorder = order.status === "delivered" || order.status === "picked_up";
  const canCancel = cancelEligibility?.eligible === true;
  const cancelRequiresReview = canCancel && cancelEligibility?.requiresReview === true;
  const cancelEstimate = Number(cancelEligibility?.estimatedRefund ?? 0);
  const hasRefund = orderRefunds.length > 0;
  const canReportProblem = !hasRefund && ["delivered", "picked_up"].includes(order.status);

  const CANCEL_REASONS = [
    { value: "ordered_by_mistake", label: "Ordered by mistake" },
    { value: "no_longer_needed", label: "No longer needed" },
    { value: "delivery_too_slow", label: "Delivery taking too long" },
    { value: "found_other", label: "Found another product" },
    { value: "other", label: "Other" },
  ];

  const PROBLEM_REASONS = [
    { value: "wrong_product", label: "Wrong product", type: "wrong_product" },
    { value: "missing_quantity", label: "Missing quantity", type: "missing_quantity" },
    { value: "damaged_product", label: "Damaged product", type: "damaged_product" },
    { value: "poor_quality", label: "Poor quality", type: "poor_quality" },
    { value: "spoiled_expired", label: "Spoiled/expired", type: "spoiled_expired" },
    { value: "other", label: "Other", type: "other" },
  ];

  const handleCancelOrder = async () => {
    setCancelling(true);
    try {
      await api.post(`/refunds/orders/${order.id}/cancel`, {
        reason: cancelReason.trim() || "Not specified",
        reasonCode: cancelReasonCode,
      });
      toast.success(
        cancelRequiresReview
          ? "Cancellation request submitted for review"
          : "Your order has been cancelled"
      );
      setShowCancelDialog(false);
      setCancelReason("");
      setCancelReasonCode("ordered_by_mistake");
      refetchOrder();
      refetchTracking();
      refetchOrderRefunds();
      refetchEligibility();
    } catch {
      // handled by api client toast
    } finally {
      setCancelling(false);
    }
  };

  const handleEvidenceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    const remaining = 10 - problemEvidence.length;
    const uploads = files.slice(0, Math.max(remaining, 0));
    if (uploads.length === 0) {
      setEvidenceError("You can upload at most 10 photos.");
      return;
    }
    setUploadingEvidence(true);
    setEvidenceError(null);
    const apiBaseUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1").replace(/\/api\/v1\/?$/, "");
    for (const file of uploads) {
      try {
        const res = await api.upload("/refunds/upload", file);
        const url = res?.data?.url;
        if (url) setProblemEvidence((prev) => [...prev, `${apiBaseUrl}${url}`]);
      } catch (err: any) {
        setEvidenceError(err?.message || "Photo upload failed. Please try again.");
      }
    }
    setUploadingEvidence(false);
  };

  const removeEvidence = (idx: number) => {
    setProblemEvidence((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleReportProblem = async () => {
    if (PROBLEM_REASONS.every((r) => r.type !== problemReason)) return;
    const reasonInfo = PROBLEM_REASONS.find((r) => r.type === problemReason)!;
    const affectedItems = order.items
      .filter((item: any) => (problemItems[item.id] || 0) > 0)
      .map((item: any) => ({
        productId: item.id,
        variantId: item.variantId || undefined,
        quantity: problemItems[item.id],
        requestedAmount: null,
      }));
    if (problemResolution !== "full_refund" && affectedItems.length === 0) {
      toast.error("Please select an affected product and quantity, or choose Full Refund.");
      return;
    }
    setReporting(true);
    try {
      await api.post(`/refunds/orders/${order.id}/refund-request`, {
        refundType: problemReason,
        reason: problemReason,
        resolution: problemResolution,
        description: problemDescription.trim() || undefined,
        affectedItems,
        evidence: problemEvidence,
        requestedAmount: null,
      });
      toast.success("Refund request submitted. You will be notified when it's reviewed.");
      setShowProblemDialog(false);
      setProblemReason("damaged_product");
      setProblemResolution("partial_refund");
      setProblemDescription("");
      setProblemItems({});
      setProblemEvidence([]);
      setEvidenceError(null);
      refetchOrderRefunds();
    } catch {
      // handled by api client toast
    } finally {
      setReporting(false);
    }
  };

  const handleBuyAgain = () => {
    const reorderable = order.items.filter((i: any) => i.id);
    if (reorderable.length === 0) {
      toast.error("This order has no items to reorder");
      return;
    }
    reorderable.forEach((item: any) => {
      const qty = Number(item.quantity) || 1;
      const unitPrice = Number(item.unitPrice) || Number(item.price) / qty || 0;
      addItem({
        id: item.id,
        name: item.name || "Product",
        price: unitPrice,
        quantity: qty,
        image: item.productImage || "/images/placeholder-product.jpg",
        farmerName: order.farmer?.name,
        originalPrice: unitPrice,
        pickupAvailable: item.pickupAvailable ?? false,
        farmAddress: item.farmAddress || "",
      });
    });
    toast.success(
      `${reorderable.length} item${reorderable.length > 1 ? "s" : ""} added to your cart`
    );
    router.push("/cart");
  };

  return (
    <div className="space-y-6 p-6">
      <Button variant="ghost" asChild>
        <Link href="/orders" className="flex items-center gap-2">
          <ArrowLeft className="h-4 w-4" /> Back to orders
        </Link>
      </Button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Order {order.orderNumber.slice(-8)}</h1>
          <p className="text-sm text-muted-foreground">Placed on {formatDate(order.date)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={statusColors[order.status] || "border-gray-200 bg-gray-50 text-gray-700"}>
            {order.status.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
          </Badge>
          {canReorder && (
            <Button onClick={handleBuyAgain}>
              <RefreshCw className="mr-2 h-4 w-4" /> Buy Again
            </Button>
          )}
          {canCancel && (
            <Button variant="outline" className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setShowCancelDialog(true)}>
              <X className="mr-2 h-4 w-4" /> Cancel Order
            </Button>
          )}
          {canReportProblem && (
            <Button variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800" onClick={() => setShowProblemDialog(true)}>
              <AlertTriangle className="mr-2 h-4 w-4" /> Report a Problem
            </Button>
          )}
          <Link href={`/orders/${orderId}/invoice`}>
            <Button variant="outline">
              <Receipt className="mr-2 h-4 w-4" /> Invoice
            </Button>
          </Link>
        </div>
      </div>

      {showCancelDialog && (
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <X className="h-5 w-5" /> Cancel Order {order.orderNumber.slice(-8)}
            </CardTitle>
            <CardDescription>
              {cancelRequiresReview
                ? "This order is out for delivery. Cancellation will be submitted for review by our support team."
                : cancelEstimate > 0
                  ? `If you cancel now, an estimated refund of ${formatPrice(cancelEstimate)} will be issued to your original payment method.`
                  : "Are you sure you want to cancel this order?"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium">Why are you cancelling?</p>
              <div className="grid gap-1.5">
                {CANCEL_REASONS.map((r) => (
                  <label
                    key={r.value}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                      cancelReasonCode === r.value
                        ? "border-red-300 bg-red-50"
                        : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="cancelReason"
                      value={r.value}
                      checked={cancelReasonCode === r.value}
                      onChange={() => setCancelReasonCode(r.value)}
                      className="accent-red-600"
                    />
                    {r.label}
                  </label>
                ))}
              </div>
            </div>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={2}
              placeholder="Tell us more (optional)"
              className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm outline-none focus:border-red-400"
            />
            {cancelEstimate > 0 && (
              <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3 text-sm">
                <span className="text-muted-foreground">Estimated refund</span>
                <span className="font-semibold text-emerald-700">{formatPrice(cancelEstimate)}</span>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowCancelDialog(false)} disabled={cancelling}>
                Keep Order
              </Button>
              <Button variant="destructive" onClick={handleCancelOrder} disabled={cancelling}>
                {cancelling ? "Cancelling..." : cancelRequiresReview ? "Submit Cancellation Request" : "Yes, Cancel Order"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {showProblemDialog && (
        <Dialog open={showProblemDialog} onOpenChange={setShowProblemDialog} wide>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" /> Report a Problem
              </DialogTitle>
              <DialogDescription>
                Let us know what's wrong with your order. A refund or replacement will be reviewed by our team.
              </DialogDescription>
            </DialogHeader>

            <div>
              <p className="mb-2 text-sm font-medium">What's wrong?</p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {PROBLEM_REASONS.map((r) => (
                  <label
                    key={r.value}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                      problemReason === r.type
                        ? "border-amber-300 bg-amber-50"
                        : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="problemReason"
                      value={r.type}
                      checked={problemReason === r.type}
                      onChange={() => setProblemReason(r.type)}
                      className="accent-amber-600"
                    />
                    {r.label}
                  </label>
                ))}
              </div>
            </div>

            {problemResolution !== "full_refund" && (
              <div>
                <p className="mb-2 text-sm font-medium">Affected products &amp; quantities</p>
                <div className="space-y-2">
                  {order.items.map((item: any) => (
                    <div key={item.id || item.name} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Ordered {item.quantity} · {formatPrice(item.unitPrice)}/unit
                        </p>
                      </div>
                      <input
                        type="number"
                        min={0}
                        max={Number(item.quantity)}
                        value={problemItems[item.id] ?? 0}
                        onChange={(e) => {
                          const v = Math.max(0, Math.min(Number(item.quantity), Number(e.target.value) || 0));
                          setProblemItems((prev) => ({ ...prev, [item.id]: v }));
                        }}
                        className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-center text-sm outline-none focus:border-amber-400"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="mb-2 text-sm font-medium">Requested resolution</p>
              <div className="grid gap-1.5 sm:grid-cols-3">
                {[
                  { value: "full_refund", label: "Refund" },
                  { value: "replacement", label: "Replacement" },
                  { value: "partial_refund", label: "Partial Refund" },
                ].map((r) => (
                  <label
                    key={r.value}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                      problemResolution === r.value
                        ? "border-amber-300 bg-amber-50"
                        : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="problemResolution"
                      value={r.value}
                      checked={problemResolution === r.value}
                      onChange={() => setProblemResolution(r.value)}
                      className="accent-amber-600"
                    />
                    {r.label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                <ImagePlus className="h-4 w-4" /> Upload Evidence ({problemEvidence.length}/10)
              </p>
              <div className="flex flex-wrap gap-2">
                {problemEvidence.map((src, idx) => (
                  <div key={idx} className="group relative overflow-hidden rounded-lg border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`Evidence ${idx + 1}`} className="h-20 w-20 object-cover" />
                    <button
                      type="button"
                      aria-label="Remove photo"
                      onClick={() => removeEvidence(idx)}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-red-600"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {problemEvidence.length < 10 && (
                  <button
                    type="button"
                    onClick={() => evidenceFileInputRef.current?.click()}
                    disabled={uploadingEvidence}
                    className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 text-muted-foreground transition hover:border-emerald-400 hover:text-emerald-600 disabled:opacity-60"
                  >
                    {uploadingEvidence ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <ImagePlus className="h-5 w-5" />
                    )}
                    <span className="text-[10px]">{uploadingEvidence ? "Uploading…" : "Add photo"}</span>
                  </button>
                )}
              </div>
              <input
                ref={evidenceFileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleEvidenceUpload}
              />
              {evidenceError && <p className="mt-1 text-xs text-red-600">{evidenceError}</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                Add photos of damaged or missing items to speed up review.
              </p>
            </div>

            <textarea
              value={problemDescription}
              onChange={(e) => setProblemDescription(e.target.value)}
              rows={2}
              placeholder="Describe what happened (optional)"
              className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm outline-none focus:border-amber-400"
            />

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowProblemDialog(false)} disabled={reporting}>
                Cancel
              </Button>
              <Button className="bg-amber-600 hover:bg-amber-700" onClick={handleReportProblem} disabled={reporting}>
                {reporting ? "Submitting..." : "Submit Request"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {orderRefunds.length > 0 && (
        <Card className="border-emerald-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowUpLeft className="h-5 w-5 text-emerald-600" /> Refund &amp; Return
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {orderRefunds.map((refund: any) => {
              const meta: Record<string, { label: string; className: string }> = {
                requested: { label: "Requested", className: "border-slate-200 bg-slate-50 text-slate-700" },
                under_review: { label: "Under Review", className: "border-yellow-200 bg-yellow-50 text-yellow-700" },
                approved: { label: "Approved", className: "border-blue-200 bg-blue-50 text-blue-700" },
                refund_processing: { label: "Refund Processing", className: "border-purple-200 bg-purple-50 text-purple-700" },
                refunded: { label: "Refund Completed", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
                rejected: { label: "Rejected", className: "border-red-200 bg-red-50 text-red-700" },
              };
              const m = meta[refund.status] || meta.requested;
              return (
                <div key={refund.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">{refund.refundId}</p>
                    <p className="text-xs text-muted-foreground">{refund.reason || "Refund request"}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="font-semibold text-emerald-700">{formatPrice(refund.amount)}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={m.className}>{m.label}</Badge>
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/refunds/${refund.id}`}>View</Link>
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" /> Items
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {order.items.map((item: any, i: number) => (
              <div key={i} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="font-medium text-slate-900">{item.name}</p>
                  <p className="text-sm text-muted-foreground">Qty: {item.quantity} × {formatPrice(item.unitPrice)}</p>
                </div>
                <span className="font-semibold">{formatPrice(item.price)}</span>
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
              <div className="mt-2 flex justify-between font-semibold">
                <span>Total</span>
                <span>{formatPrice(order.total)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {isTrackable && (
            <Card className="overflow-hidden">
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <span className="relative flex h-3 w-3">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
                    </span>
                    Live Tracking
                  </CardTitle>
                  <CardDescription>
                    {liveTracking?.locationUpdatedAt
                      ? `Updated ${timeAgo(liveTracking.locationUpdatedAt)}`
                      : "Waiting for the delivery partner to update their location"}
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => refetchTracking()}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border bg-slate-50 p-3 text-center">
                    <p className="text-xs text-muted-foreground">Status</p>
                    <p className="mt-1 text-sm font-semibold capitalize text-emerald-700">
                      {order.status.replace(/_/g, " ")}
                    </p>
                  </div>
                  <div className="rounded-xl border bg-slate-50 p-3 text-center">
                    <p className="text-xs text-muted-foreground">Estimated Arrival</p>
                    <p className="mt-1 text-sm font-semibold">{liveTracking?.eta || "Calculating..."}</p>
                  </div>
                  <div className="rounded-xl border bg-slate-50 p-3 text-center">
                    <p className="text-xs text-muted-foreground">Distance Remaining</p>
                    <p className="mt-1 text-sm font-semibold">
                      {liveTracking?.distanceRemaining != null ? `${liveTracking.distanceRemaining} km` : "—"}
                    </p>
                  </div>
                </div>

                {liveTracking?.deliveryPartner && (
                  <div className="flex items-center gap-3 rounded-xl border p-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100">
                      <Truck className="h-5 w-5 text-emerald-700" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{liveTracking.deliveryPartner.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {liveTracking.deliveryPartner.vehicleType}
                        {liveTracking.deliveryPartner.vehicleNumber
                          ? ` · ${liveTracking.deliveryPartner.vehicleNumber}`
                          : ""}
                      </p>
                    </div>
                    {liveTracking.deliveryPartner.phone && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={`tel:${liveTracking.deliveryPartner.phone}`}>
                          <Phone className="mr-1.5 h-3.5 w-3.5" /> Call
                        </a>
                      </Button>
                    )}
                  </div>
                )}

                {liveTracking?.currentLocation || deliveryDestination || (order.deliveryType === "pickup" && farmMapCenter) ? (
                  <div className="overflow-hidden rounded-xl border">
                    <LiveMap
                      center={trackingMapCenter}
                      zoom={13}
                      markers={trackingMapMarkers}
                      route={trackingRoute}
                      height={260}
                    />
                  </div>
                ) : (
                  <p className="rounded-lg bg-slate-50 p-4 text-center text-sm text-muted-foreground">
                    The map will appear here once the order is out for delivery.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {order.deliveryType === "pickup" ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Store className="h-5 w-5" /> Pickup Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="flex items-center gap-2 font-medium text-amber-800">
                    <Store className="h-4 w-4" /> Farm Pickup
                  </p>
                  {order.farmAddress && (
                    <p className="mt-1 text-amber-700">{order.farmAddress}</p>
                  )}
                  {order.pickupDate && (
                    <p className="mt-1 text-xs text-amber-600">
                      Pickup date: {formatDate(order.pickupDate)}
                      {order.pickupTimeSlot ? ` (${order.pickupTimeSlot})` : ""}
                    </p>
                  )}
                  {order.pickupInstructions && (
                    <p className="mt-1 text-xs text-amber-600">{order.pickupInstructions}</p>
                  )}
                </div>
                {farmMapCenter && (
                  <div className="overflow-hidden rounded-xl border">
                    <LiveMap
                      center={farmMapCenter}
                      zoom={14}
                      markers={[
                        {
                          id: "farm",
                          lat: farmMapCenter.lat,
                          lng: farmMapCenter.lng,
                          title: "Farm pickup location",
                          info: order.farmAddress || "Farm",
                        },
                      ]}
                      height={220}
                    />
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${farmMapCenter.lat},${farmMapCenter.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 border-t border-amber-100 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700 hover:bg-amber-100"
                    >
                      <Navigation className="h-4 w-4" /> Get Directions to Farm
                    </a>
                  </div>
                )}
                {order.status !== "ready_for_pickup" || !order.pickupCode ? (
                  <div className="rounded-lg border border-dashed border-emerald-300 bg-emerald-50/50 p-3 text-center">
                    <p className="text-xs font-medium text-emerald-700">
                      {order.status === "ready_for_pickup"
                        ? "Your pickup code is being issued — refresh the page in a moment."
                        : "Your pickup QR code will appear here once the farmer marks the order \"Pickup Ready\"."}
                    </p>
                  </div>
                ) : null}
                {order.status === "ready_for_pickup" && order.pickupCode && (
                  <div className="rounded-lg border border-emerald-200 bg-white p-4 text-center">
                    <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
                      Show this QR &amp; pickup code to the farmer
                    </p>
                    <div className="mx-auto mt-3 w-fit rounded-xl border border-emerald-100 bg-white p-3">
                      <QRCodeSVG
                        value={JSON.stringify({ t: "agripickup", o: order.orderNumber, c: order.pickupCode })}
                        size={176}
                        level="M"
                        marginSize={0}
                      />
                    </div>
                    <p className="mt-3 flex items-baseline justify-center gap-2">
                      <span className="font-mono text-3xl font-bold tracking-[0.4em] text-emerald-800">
                        {order.pickupCode}
                      </span>
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-600">
                      Order {String(order.orderNumber).slice(-8)} · {formatPrice(order.total)}
                    </p>
                    <p className="mt-2 text-xs text-emerald-700">
                      The farmer scans the QR (or enters the 6-digit code) to confirm the
                      hand-off. Only the farmer can confirm it — no one else can collect
                      your order.
                    </p>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                  <span className="capitalize">
                    {["cash", "cod", "cash_on_delivery"].includes((order.paymentMethod || "").toLowerCase())
                      ? "Cash on Pickup"
                      : order.paymentMethod.replace(/_/g, " ")}
                  </span>
                </div>
                {order.specialInstructions && (
                  <div className="mt-2 rounded-md bg-gray-50 p-2 text-xs text-muted-foreground">
                    <span className="font-medium">Instructions:</span> {order.specialInstructions}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5" /> Delivery Details
                </CardTitle>
                <CardDescription>{order.address}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span>Estimated delivery: {order.estimatedDelivery ? formatDate(order.estimatedDelivery) : "To be confirmed"}</span>
                </div>
                {order.requestedDeliveryDate && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-800">
                    <p className="flex items-center gap-2 font-medium"><Truck className="h-4 w-4" /> Fresh delivery window</p>
                    <p className="mt-1 text-xs">Preferred: {formatDate(order.requestedDeliveryDate)}{order.deliveryTimeSlot ? ` · ${order.deliveryTimeSlot.replace(/_/g, " ")}` : ""}</p>
                    <p className="mt-1 text-xs">We prioritize fresh produce for this delivery window.</p>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                  <span className="capitalize">{order.paymentMethod.replace(/_/g, " ")}</span>
                </div>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => setChatOpen(true)}>
                  <MessageCircle className="mr-2 h-4 w-4" /> Chat with delivery partner
                </Button>
                {order.specialInstructions && (
                  <div className="mt-2 rounded-md bg-gray-50 p-2 text-xs text-muted-foreground">
                    <span className="font-medium">Instructions:</span> {order.specialInstructions}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          {chatOpen && order && <LiveChatDialog orderId={orderId} customerName="Delivery partner" onClose={() => setChatOpen(false)} />}

          {order.tracking.length > 0 && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" /> Tracking
                </CardTitle>
                {order.tracking.length > 2 && (
                  <Button variant="ghost" size="sm" onClick={() => setShowAllTracking(!showAllTracking)}>
                    {showAllTracking ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                <div className="space-y-0">
                  {tracking.map((step: any, i: number) => (
                    <div key={i} className="relative flex gap-4 pb-4 last:pb-0">
                      {i < tracking.length - 1 && (
                        <div className="absolute left-[11px] top-5 h-full w-px bg-slate-200" />
                      )}
                      <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-emerald-500 bg-emerald-50">
                        <div className="h-2 w-2 rounded-full bg-emerald-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900">{step.description}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(step.date)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {order.status === "delivered" && (
        <Card id="rate">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Star className="h-5 w-5 text-yellow-500" /> Rate your order
            </CardTitle>
            <CardDescription>Thanks for ordering! Share a star rating and review for each item.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {order.items.map((item: any) => {
              const rv = reviews[item.id] || { rating: 0, comment: "" };
              return (
                <div key={item.id || item.name} className="rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-slate-900">{item.name}</p>
                    {rv.submitted ? (
                      <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        <CheckCircle className="h-3.5 w-3.5" /> Rated
                      </span>
                    ) : (
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => updateReview(item.id, { rating: s, error: "" })}
                            className={`text-2xl transition ${s <= rv.rating ? "text-yellow-500" : "text-slate-300 hover:text-yellow-300"}`}
                            aria-label={`${s} stars`}
                          >
                            ★
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {!rv.submitted && (
                    <>
                      <textarea
                        value={rv.comment}
                        onChange={(e) => updateReview(item.id, { comment: e.target.value, error: "" })}
                        rows={2}
                        placeholder={`How was the ${item.name}?`}
                        className="mt-3 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm outline-none focus:border-emerald-500"
                      />
                      {rv.error && <p className="mt-1 text-sm text-red-600">{rv.error}</p>}
                      <div className="mt-2 flex justify-end">
                        <Button size="sm" onClick={() => submitReview(item.id, item.name)} disabled={rv.loading}>
                          {rv.loading ? "Submitting..." : "Submit Rating"}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {order.status === "delivered" && order.deliveryRating?.partnerId && (
        <Card id="rate-delivery">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5 text-emerald-600" /> Rate your delivery partner
            </CardTitle>
            <CardDescription>
              {partnerRated
                ? "Thanks! Your rating for the delivery partner has been recorded."
                : `Tell us about ${order.deliveryRating.partnerName || "your delivery partner"}. Your personal details stay private.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {partnerRated ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-emerald-600" />
                  <p className="font-medium text-emerald-700">Rated</p>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <RatedRow label="Overall" value={partnerRatingData.overallRating} />
                  <RatedRow label="On-time" value={partnerRatingData.onTimeRating} />
                  <RatedRow label="Professionalism" value={partnerRatingData.professionalismRating} />
                  <RatedRow label="Product handling" value={partnerRatingData.handlingRating} />
                  <RatedRow label="Communication" value={partnerRatingData.communicationRating} />
                </div>
                {partnerRatingData.feedback && (
                  <p className="mt-3 rounded-md bg-white p-2 text-sm text-muted-foreground">
                    &ldquo;{partnerRatingData.feedback}&rdquo;
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  {[
                    { key: "overall", label: "Overall experience" },
                    { key: "onTime", label: "On-time delivery" },
                    { key: "professionalism", label: "Professionalism" },
                    { key: "handling", label: "Product handling" },
                    { key: "communication", label: "Communication" },
                  ].map((row) => (
                    <div key={row.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                      <p className="text-sm font-medium">{row.label}</p>
                      <StarPicker value={partnerRating[row.key] || 0} onChange={(v) => setPartnerRating((prev) => ({ ...prev, [row.key]: v }))} />
                    </div>
                  ))}
                </div>
                <textarea
                  value={partnerFeedback}
                  onChange={(e) => setPartnerFeedback(e.target.value)}
                  rows={2}
                  placeholder="Anything you'd like to share about the delivery? (optional)"
                  className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm outline-none focus:border-emerald-500"
                />
                <div className="flex justify-end">
                  <Button size="sm" onClick={handleSubmitPartnerRating} disabled={partnerSubmitting}>
                    {partnerSubmitting ? "Submitting..." : "Submit Rating"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
