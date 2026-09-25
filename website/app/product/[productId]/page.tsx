"use client";

import { useMemo, useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";


import { Star, ShoppingCart, MapPin, Bell, AlertCircle, Package, Minus, Plus, Store, Truck, LogIn, Heart } from "lucide-react";
import Link from "next/link";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { api } from "../../lib/api/client";
import { useCartStore } from "../../lib/store/cart-store";
import { useInventoryStore } from "../../lib/store/inventory-store";
import { useWishlist } from "../../lib/hooks/use-wishlist";
import { useNavigationStore } from "../../lib/store/navigation-store";
import { isListingPath } from "../../lib/utils/listing-routes";
import { formatPrice, haversineDistance, cn } from "../../lib/utils";
import toast from "react-hot-toast";

const fallbackProducts: Record<string, any> = {
  "tomatoes-01": { name: "Organic Tomatoes", price: 35, unit: "kg", description: "Fresh tomatoes sourced from nearby farms.", rating: 4.7, farmerName: "Annur Fresh Basket", image: "/images/placeholder-product.jpg" },
  "oranges-02": { name: "Sweet Oranges", price: 120, unit: "kg", description: "Juicy oranges picked for same-day delivery.", rating: 4.8, farmerName: "Pollachi Organic Farm", image: "/images/placeholder-product.jpg" },
  "greens-03": { name: "Leafy Greens", price: 18, unit: "bunch", description: "Crisp greens for daily cooking and juicing.", rating: 4.6, farmerName: "Mettupalayam Greens", image: "/images/placeholder-product.jpg" },
};

export default function ProductDetailPage() {
  const params = useParams<{ productId: string }>();
  const productId = params?.productId || "";
  const router = useRouter();
  const listingReferrer = useNavigationStore((s) => s.listingReferrer);
  // Return to the exact listing (with its filters/pagination) the user came
  // from. Deep links and fresh tabs fall back to the default marketplace.
  const backHref =
    listingReferrer && isListingPath(listingReferrer.pathname)
      ? listingReferrer.href
      : "/nearby";
  const backLabel = listingReferrer?.label ?? "Nearby Markets";
  const { data: session, status: authStatus } = useSession();
  const isAuthenticated = authStatus === "authenticated";
  const addItem = useCartStore((state) => state.addItem);
  const stockInfo = useInventoryStore((state) => state.stockByProduct[productId]);
  const { isWishlisted, toggle } = useWishlist();
  const wishlisted = isWishlisted(productId);
  const [quantity, setQuantity] = useState(1);
  const [userLocation, setUserLocation] = useState<{lat: number; lng: number} | null>(null);
  const [deliveryEstimate, setDeliveryEstimate] = useState<{minutes: number; confidence: number} | null>(null);
  const connectProductStock = useInventoryStore((state) => state.connectProductStock);
  const setStock = useInventoryStore((state) => state.setStock);


  const requireAuth = useCallback(() => {
    if (!isAuthenticated) {
      toast.error("Please sign in to buy products");
      router.push(`/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
      return false;
    }
    return true;
  }, [isAuthenticated, router]);

  const { data, isLoading } = useQuery({
    queryKey: ["product", productId],
    queryFn: () => api.get(`/products/${productId}`),
  });

  useEffect(() => {
    if (typeof window !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {}
      );
    }
  }, []);

  useEffect(() => {
    api.get(`/inventory/stock/${productId}`).then((res) => {
      const stock = res?.data || res;
      if (stock) setStock(productId, stock);
    }).catch(() => {});
  }, [productId, setStock]);

  useEffect(() => {
    const apiProduct = (data as any)?.data || data;
    const coords = apiProduct?.location?.coordinates;
    if (!userLocation || !Array.isArray(coords) || coords.length < 2 || !isAuthenticated) {
      setDeliveryEstimate(null);
      return;
    }
    let cancelled = false;
    api.post("/ai/delivery-time", {
      originLat: Number(coords[1]),
      originLng: Number(coords[0]),
      destinationLat: userLocation.lat,
      destinationLng: userLocation.lng,
      vehicleType: "truck",
      timeOfDay: new Date().getHours(),
      dayOfWeek: new Date().getDay(),
    }).then((res: any) => {
      if (cancelled) return;
      const body = res?.data || res;
      if (body?.estimatedMinutes != null) {
        setDeliveryEstimate({ minutes: Number(body.estimatedMinutes), confidence: Number(body.confidence || 0) });
      }
    }).catch(() => {
      if (!cancelled) setDeliveryEstimate(null);
    });
    return () => { cancelled = true; };
  }, [data, userLocation, isAuthenticated]);

  useEffect(() => {
    const disconnect = connectProductStock(productId);
    return disconnect;
  }, [productId, connectProductStock]);

  const product = useMemo(() => {
    const apiProduct = data?.data || data;
    if (apiProduct) {
      let distance = apiProduct.farmDistanceKm || 0;
      if (!distance && userLocation && apiProduct.location?.coordinates) {
        const [lng, lat] = apiProduct.location.coordinates;
        distance = haversineDistance(userLocation.lat, userLocation.lng, lat, lng);
      }
      return {
        ...apiProduct,
        rating: apiProduct.ratings?.average || apiProduct.rating || 0,
        image: apiProduct.images?.[0] || apiProduct.image || "/images/placeholder-product.jpg",
        pickupAvailable: apiProduct.pickupAvailable ?? false,
        farmAddress: apiProduct.farmAddress || "",
        farmDistanceKm: distance,
        pickupInstructions: apiProduct.pickupInstructions || "",
        minBulkQty: apiProduct.minBulkQty || 0,
        bulkPrice: apiProduct.bulkPrice || 0,
        bulkDiscountPercent: apiProduct.bulkDiscountPercent || 0,
      };
    }
    return fallbackProducts[productId] || {
      name: "Fresh Produce",
      price: null,
      unit: "unit",
      description: "Product details will appear here.",
      rating: 4.5,
      farmerName: "Local Farmer",
      images: ["/images/placeholder-product.jpg"],
      image: "/images/placeholder-product.jpg",
    };
  }, [data, productId, userLocation]);

  const stockLoaded = Boolean(stockInfo);
  const available = stockLoaded
    ? Math.max(0, Number(stockInfo?.available_stock ?? 0))
    : Math.max(0, Number(product.quantity ?? 0));
  const totalStock = stockLoaded
    ? Math.max(0, Number(stockInfo?.total_stock ?? 0))
    : available;
  const unit = stockInfo?.unit || product.unit || "kg";
  const isOutOfStock = stockLoaded
    ? Boolean(stockInfo?.is_out_of_stock) || available <= 0
    : available <= 0;
  const maxQty = Math.max(1, available);

  const handleQuantityChange = (delta: number) => {
    setQuantity((prev) => {
      const next = prev + delta;
      if (next < 1) return 1;
      if (next > maxQty) return maxQty;
      return next;
    });
  };

  const effectivePrice = useMemo(() => {
    const basePrice = Number(product.price || 0);
    const minBulk = product.minBulkQty || 0;
    const bulkPx = product.bulkPrice || 0;
    const bulkPct = product.bulkDiscountPercent || 0;
    if (minBulk > 0 && quantity >= minBulk) {
      if (bulkPx > 0) return bulkPx;
      if (bulkPct > 0) return basePrice * (1 - bulkPct / 100);
    }
    return basePrice;
  }, [product.price, product.minBulkQty, product.bulkPrice, product.bulkDiscountPercent, quantity]);

  const handleAddToCart = () => {
    if (!requireAuth()) return;
    if (quantity > maxQty) {
      toast.error(`Only ${maxQty} ${unit} available`);
      return;
    }
    addItem({
      id: productId,
      name: product.name,
      price: Number(effectivePrice || 0),
      quantity,
      image: product.images?.[0] || product.image || "/images/placeholder-product.jpg",
      farmerName: product.farmerName,
      unit,
      farmerId: product.farmerId,
      pickupAvailable: product.pickupAvailable,
      farmAddress: product.farmAddress,
      farmDistanceKm: product.farmDistanceKm,
      originalPrice: Number(product.price || 0),
      minBulkQty: product.minBulkQty,
      bulkPrice: product.bulkPrice,
    });
    toast.success(`Added ${quantity} ${unit} to cart`);
  };

  const handleBuyNow = () => {
    if (!requireAuth()) return;
    if (quantity > maxQty) {
      toast.error(`Only ${maxQty} ${unit} available`);
      return;
    }
    addItem({
      id: productId,
      name: product.name,
      price: Number(effectivePrice || 0),
      quantity,
      image: product.images?.[0] || product.image || "/images/placeholder-product.jpg",
      farmerName: product.farmerName,
      unit,
      farmerId: product.farmerId,
      pickupAvailable: product.pickupAvailable,
      farmAddress: product.farmAddress,
      farmDistanceKm: product.farmDistanceKm,
      originalPrice: Number(product.price || 0),
      minBulkQty: product.minBulkQty,
      bulkPrice: product.bulkPrice,
    });
    router.push("/checkout");
  };

  const [alertOpen, setAlertOpen] = useState(false);
  const [alertType, setAlertType] = useState<"back_in_stock" | "price_drop">("back_in_stock");
  const [targetPrice, setTargetPrice] = useState("");
  const [alertSubmitting, setAlertSubmitting] = useState(false);

  const { data: alertsData, refetch: refetchAlerts } = useQuery({
    queryKey: ["productAlerts"],
    queryFn: () => api.get(`/customers/me/alerts`),
    enabled: isAuthenticated,
  });
  const myAlerts: any[] = (alertsData as any)?.data ?? [];
  const activeAlert = myAlerts.find((a: any) => a.productId === productId);

  const openAlertPanel = (defaultType: "back_in_stock" | "price_drop") => {
    if (!isAuthenticated) {
      toast.error("Please sign in to set alerts");
      router.push(`/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setAlertType(defaultType);
    setTargetPrice("");
    setAlertOpen(true);
  };

  const subscribeAlert = async () => {
    setAlertSubmitting(true);
    try {
      await api.post(`/customers/me/alerts/${productId}`, {
        alertType,
        targetPrice: alertType === "price_drop" && targetPrice ? Number(targetPrice) : undefined,
      });
      toast.success(
        alertType === "price_drop"
          ? `We'll notify you when the price drops${targetPrice ? ` to ${formatPrice(Number(targetPrice))}` : ""}`
          : "We'll notify you when this product is back in stock"
      );
      setAlertOpen(false);
      refetchAlerts();
    } catch (e: any) {
      toast.error(e.message || "Failed to set alert");
    } finally {
      setAlertSubmitting(false);
    }
  };

  const removeAlert = async () => {
    if (!activeAlert) return;
    try {
      await api.delete(`/customers/me/alerts/${activeAlert.id}`);
      toast.success("Alert removed");
      refetchAlerts();
    } catch (e: any) {
      toast.error(e.message || "Failed to remove alert");
    }
  };

  const handleWishlist = () => {
    if (!isAuthenticated) {
      toast.error("Please sign in to save products");
      router.push(`/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    toggle(productId);
  };

  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");

  const { data: reviewsData, refetch: refetchReviews } = useQuery({
    queryKey: ["productReviews", productId],
    queryFn: () => api.get(`/products/${productId}/reviews`),
  });
  const reviews = (reviewsData as any)?.data?.reviews ?? [];

  const handleSubmitReview = async () => {
    if (!isAuthenticated) {
      toast.error("Please sign in to write a review");
      router.push(`/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (reviewRating < 1) {
      setReviewError("Please select a star rating.");
      return;
    }
    if (!reviewComment.trim()) {
      setReviewError("Please write a short comment.");
      return;
    }
    setReviewError("");
    setReviewLoading(true);
    try {
      await api.post(`/products/${productId}/reviews`, {
        rating: reviewRating,
        comment: reviewComment.trim(),
        orderId: "",
      });
      toast.success("Thanks! Your rating has been submitted.");
      setReviewRating(0);
      setReviewComment("");
      refetchReviews();
    } catch (e: any) {
      setReviewError(e.message || "Failed to submit review. You can only review products you've purchased.");
    } finally {
      setReviewLoading(false);
    }
  };

  if (isLoading) {
    return <div className="h-[60vh] animate-pulse rounded-3xl bg-muted" />;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">

      <div className="rounded-3xl border border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-green-50 p-4 shadow-sm shadow-emerald-100/60">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Fresh harvest</p>
            <p className="mt-1 text-sm text-slate-600">Packed and dispatch-ready from trusted local farms.</p>
          </div>
          <div className="inline-flex items-center gap-2 self-start rounded-full bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 shadow-sm">
            <Truck className="h-4 w-4" />
            {product.farmDistanceKm ? `${product.farmDistanceKm.toFixed(1)} km away` : "Fast delivery"}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="overflow-hidden border-0 shadow-lg shadow-slate-200/60">
          <CardContent className="p-0">
            <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
              <img
                src={product.images?.[0] || product.image || "/images/placeholder-product.jpg"}
                alt={product.name}
                className="h-full w-full object-cover transition duration-500 hover:scale-[1.02]"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = "/images/placeholder-product.jpg";
                }}
              />
              {product.rating > 0 && (
                <div className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1.5 text-sm font-semibold text-slate-800 shadow-sm backdrop-blur-sm">
                  <span className="inline-flex items-center gap-1.5">
                    <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                    {Number(product.rating).toFixed(1)}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit border-0 shadow-lg shadow-slate-200/60">
          <CardContent className="space-y-4 p-6">
            <div>
              <Badge variant="outline">Product details</Badge>
              <div className="mt-3 flex items-start justify-between gap-3">
                <h1 className="text-2xl font-semibold text-slate-900">{product.name}</h1>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleWishlist}
                  className={cn("shrink-0 rounded-full", wishlisted && "text-red-500")}
                  title={wishlisted ? "Remove from wishlist" : "Add to wishlist"}
                >
                  <Heart className={cn("h-5 w-5", wishlisted && "fill-current")} />
                </Button>
              </div>
              <p className="mt-1 text-sm text-slate-500">{product.farmerName}</p>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <Star className="h-4 w-4 text-yellow-500" />
              <span>{product.rating ? Number(product.rating).toFixed(1) : "New"}</span>
            </div>

            <p className="text-sm text-muted-foreground">{product.description}</p>

            <div className="flex items-center gap-4 rounded-lg border bg-slate-50 p-3">
              <Package className="h-5 w-5 text-emerald-600" />
              <div className="flex-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Available Stock</span>
                  <span className={isOutOfStock ? "font-semibold text-red-600" : "font-semibold text-emerald-700"}>
                    {isOutOfStock ? "Out of Stock" : `${available} ${unit}`}
                  </span>
                </div>
                {totalStock > 0 && (
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full transition-all ${
                        isOutOfStock ? "bg-red-400" : "bg-emerald-500"
                      }`}
                      style={{ width: `${(available / totalStock) * 100}%` }}
                    />
                  </div>
                )}
                {!isOutOfStock && available > 0 && available <= 5 && (
                  <p className="mt-1 text-xs text-amber-600">Only {available} left in stock</p>
                )}
              </div>
            </div>

            {product.farmDistanceKm && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <p className="flex items-center gap-2 text-sm font-medium text-emerald-800">
                  <MapPin className="h-4 w-4" /> Farm Distance
                </p>
                <p className="text-lg font-bold text-emerald-700">
                  {product.farmDistanceKm.toFixed(1)} km {product.pickupAvailable ? "away" : "from your location"}
                </p>
                {product.farmAddress && (
                  <p className="mt-1 text-xs text-emerald-600">{product.farmAddress}</p>
                )}
                {deliveryEstimate && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <p className="flex items-center gap-2 text-sm font-medium text-blue-800">
                  <Truck className="h-4 w-4" /> Estimated delivery
                </p>
                <p className="mt-1 text-lg font-bold text-blue-700">
                  {deliveryEstimate.minutes < 60
                    ? `About ${Math.round(deliveryEstimate.minutes)} min`
                    : `About ${Math.floor(deliveryEstimate.minutes / 60)}h ${Math.round(deliveryEstimate.minutes % 60)}m`}
                </p>
                {deliveryEstimate.confidence > 0 && (
                  <p className="text-xs text-blue-600">AI estimate confidence: {Math.round(deliveryEstimate.confidence <= 1 ? deliveryEstimate.confidence * 100 : deliveryEstimate.confidence)}%</p>
                )}
              </div>
            )}

            {product.pickupAvailable && (
                  <p className="mt-1 text-xs text-emerald-600">
                    <Store className="mr-1 inline h-3 w-3" />
                    Visit the farm directly for urgent purchase
                  </p>
                )}
              </div>
            )}

            {product.pickupAvailable && (
              <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="flex items-center gap-2 text-sm font-medium text-amber-800">
                  <Store className="h-4 w-4" /> Pickup Available
                </p>
                <p className="text-xs text-amber-700">Collect directly from the farm</p>
                {product.pickupInstructions && (
                  <p className="text-xs text-amber-600">{product.pickupInstructions}</p>
                )}
              </div>
            )}

            {product.minBulkQty > 0 && (
              <div className="space-y-1 rounded-lg border border-blue-200 bg-blue-50 p-3">
                <p className="flex items-center gap-2 text-sm font-medium text-blue-800">
                  <Package className="h-4 w-4" /> Bulk Pricing Available
                </p>
                <p className="text-xs text-blue-700">
                  Order {product.minBulkQty}+ {unit} for
                  {product.bulkPrice > 0
                    ? ` ${formatPrice(product.bulkPrice)}/${unit}`
                    : product.bulkDiscountPercent > 0
                      ? ` ${product.bulkDiscountPercent}% off`
                      : " discounted price"}
                </p>
                {quantity >= (product.minBulkQty || 999) && effectivePrice !== Number(product.price || 0) && (
                  <p className="text-xs font-medium text-blue-700">
                    Bulk discount applied! {formatPrice(Number(product.price || 0))} → {formatPrice(effectivePrice)}/{unit}
                  </p>
                )}
              </div>
            )}

            {product.location?.coordinates && (
              <div className="space-y-2 border-t pt-4">
                <p className="text-sm font-medium text-gray-700">Product Location</p>
                <p className="text-sm text-gray-700">
                  <MapPin className="inline h-3.5 w-3.5 text-emerald-600 mr-1" />
                  <span className="font-medium">Place:</span> {product.location.address || "Not specified"}
                </p>
                <div className="aspect-video w-full overflow-hidden rounded-lg border bg-gray-100">
                  <iframe
                    title="Product Location"
                    width="100%"
                    height="100%"
                    frameBorder="0"
                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${Number(product.location.coordinates[0]) - 0.01}%2C${Number(product.location.coordinates[1]) - 0.01}%2C${Number(product.location.coordinates[0]) + 0.01}%2C${Number(product.location.coordinates[1]) + 0.01}&layer=mapnik&marker=${product.location.coordinates[1]}%2C${product.location.coordinates[0]}`}
                  />
                </div>
                <a
                  href={`https://www.openstreetmap.org/?mlat=${product.location.coordinates[1]}&mlon=${product.location.coordinates[0]}&zoom=14`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-xs text-emerald-600 hover:underline"
                >
                  Open in OpenStreetMap →
                </a>
              </div>
            )}

            <div className="text-2xl font-semibold text-emerald-700">
              {formatPrice(effectivePrice * quantity)} 
              <span className="text-base font-normal text-slate-500"> / {unit}</span>
              {effectivePrice !== Number(product.price || 0) && Number(product.price || 0) > 0 && (
                <span className="ml-2 text-sm text-slate-400 line-through">
                  {formatPrice(Number(product.price || 0) * quantity)}
                </span>
              )}
            </div>

            {!isOutOfStock && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-600">Quantity:</span>
                <div className="flex items-center rounded-lg border">
                  <button
                    onClick={() => handleQuantityChange(-1)}
                    disabled={quantity <= 1}
                    className="flex h-9 w-9 items-center justify-center text-slate-600 transition hover:bg-slate-100 disabled:opacity-30"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <input
                    type="number"
                    value={quantity}
                    min={1}
                    max={maxQty}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (isNaN(val) || val < 1) setQuantity(1);
                      else if (val > maxQty) setQuantity(maxQty);
                      else setQuantity(val);
                    }}
                    className="flex h-9 w-14 border-x text-center text-sm font-medium outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    onClick={() => handleQuantityChange(1)}
                    disabled={quantity >= maxQty}
                    className="flex h-9 w-9 items-center justify-center text-slate-600 transition hover:bg-slate-100 disabled:opacity-30"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                {maxQty < 999 && (
                  <span className="text-xs text-slate-400">max {maxQty} {unit}</span>
                )}
              </div>
            )}

            {isOutOfStock ? (
              <div className="space-y-2">
                <Button className="w-full" variant="outline" onClick={activeAlert ? removeAlert : () => openAlertPanel("back_in_stock")}>
                  <Bell className="mr-2 h-4 w-4" />
                  {activeAlert ? "Alert On" : "Notify Me"}
                </Button>
                {activeAlert && (
                  <p className="text-center text-xs text-muted-foreground">
                    {activeAlert.alertType === "price_drop" ? "You'll be alerted on price drops" : "You'll be alerted when back in stock"}
                  </p>
                )}
                {alertOpen && (
                  <div className="rounded-lg border p-3">
                    <p className="mb-2 text-sm font-medium text-slate-700">Notify me when:</p>
                    <div className="flex flex-col gap-2 text-sm text-slate-700">
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          checked={alertType === "back_in_stock"}
                          onChange={() => setAlertType("back_in_stock")}
                          className="accent-emerald-600"
                        />
                        Back in stock
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          checked={alertType === "price_drop"}
                          onChange={() => setAlertType("price_drop")}
                          className="accent-emerald-600"
                        />
                        Price drops to
                        {alertType === "price_drop" && (
                          <input
                            type="number"
                            value={targetPrice}
                            onChange={(e) => setTargetPrice(e.target.value)}
                            placeholder="₹ amount"
                            min={0}
                            className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-emerald-500"
                          />
                        )}
                      </label>
                    </div>
                    <Button
                      className="mt-3 w-full"
                      size="sm"
                      onClick={subscribeAlert}
                      disabled={alertSubmitting || (alertType === "price_drop" && targetPrice !== "" && Number(targetPrice) <= 0)}
                    >
                      {alertSubmitting ? "Setting..." : "Set Alert"}
                    </Button>
                  </div>
                )}
              </div>
            ) : !isAuthenticated ? (
              <Button className="w-full" onClick={() => router.push(`/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`)}>
                <LogIn className="mr-2 h-4 w-4" />
                Sign in to Buy
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={handleAddToCart} disabled={isOutOfStock}>
                  <ShoppingCart className="mr-2 h-4 w-4" />
                  Add to Cart
                </Button>
                <Button className="flex-1" onClick={handleBuyNow} disabled={isOutOfStock}>
                  Buy Now
                </Button>
              </div>
            )}

            {!isOutOfStock && (
              <button
                onClick={activeAlert ? removeAlert : () => openAlertPanel("price_drop")}
                className="flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50"
              >
                <Bell className="h-3.5 w-3.5" />
                {activeAlert ? "Price alert on — tap to remove" : "Track price — get notified on price drops"}
              </button>
            )}

            {available <= 0 && totalStock > 0 && (
              <div className="flex items-center gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-700">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                Temporarily out of stock — check back soon
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Reviews */}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardContent className="space-y-4 p-6">
            <h2 className="text-lg font-semibold">Customer Reviews</h2>
            {reviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">No reviews yet. Be the first to rate this product.</p>
            ) : (
              <div className="space-y-4">
                {reviews.map((r: any) => (
                  <div key={r.id} className="border-b pb-3 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{r.userName || "Customer"}</span>
                      <span className="text-sm text-yellow-500">
                        {"★".repeat(Math.min(5, r.rating))}{"☆".repeat(Math.max(0, 5 - Math.min(5, r.rating)))}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{r.comment}</p>
                    {r.createdAt && (
                      <p className="mt-1 text-xs text-slate-400">{new Date(r.createdAt).toLocaleDateString()}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-6">
            <h2 className="text-lg font-semibold">Rate this product</h2>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setReviewRating(s)}
                  className={`text-2xl transition ${s <= reviewRating ? "text-yellow-500" : "text-slate-300 hover:text-yellow-300"}`}
                  aria-label={`${s} stars`}
                >
                  ★
                </button>
              ))}
            </div>
            <textarea
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
              rows={4}
              placeholder="Share your experience with this product..."
              className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm outline-none focus:border-emerald-500"
            />
            {reviewError && <p className="text-sm text-red-600">{reviewError}</p>}
            <Button className="w-full" onClick={handleSubmitReview} disabled={reviewLoading}>
              {reviewLoading ? "Submitting..." : "Submit Rating"}
            </Button>
            <p className="text-xs text-muted-foreground">You can rate products from your delivered orders.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
