"use client";

import { useMemo, useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";


import { Star, ShoppingCart, ArrowLeft, MapPin, Bell, AlertCircle, Package, Minus, Plus, Store, Truck, LogIn, Heart, Phone, Leaf, ShieldCheck, CheckCircle2 } from "lucide-react";
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

// Prefer registered farm address fields; never expose raw GPS coordinates as a
// customer-facing location. Coordinates are useful for maps, not address labels.
function readableFarmLocation(product: any): string {
  const farmer = product?.farmer || product?.farmerProfile || product?.farmerDetails || {};
  const farm = product?.farm || product?.farmDetails || product?.farmProfile || {};
  const candidates = [
    product?.farmAddress,
    product?.farmerAddress,
    product?.location?.address,
    farmer?.farmAddress,
    farmer?.address,
    farmer?.location?.address,
    farm?.address,
    farm?.location?.address,
  ];
  const isCoordinates = (value: unknown) =>
    typeof value === "string" &&
    /^\s*-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?\s*$/.test(value);
  const address = candidates.find((value) => typeof value === "string" && value.trim() && !isCoordinates(value));
  if (address) return address.trim();

  const parts = [
    farmer?.village, farmer?.farmVillage, farm?.village, product?.farmVillage,
    farmer?.town, farmer?.city, farm?.town, farm?.city, product?.city,
    farmer?.taluk, farmer?.farmTaluk, farm?.taluk,
    farmer?.district, farm?.district, product?.district,
    farmer?.state, farm?.state, product?.state,
  ].filter((value, index, values) =>
    typeof value === "string" && value.trim() &&
    values.findIndex((item) => String(item).trim().toLowerCase() === value.trim().toLowerCase()) === index
  );
  return parts.join(", ");
}


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

  // Load marketplace products independently of the current product payload.
  // The product endpoint does not guarantee an embedded similarProducts array.
  const { data: relatedProductsData } = useQuery({
    queryKey: ["productRecommendations", productId],
    queryFn: () => api.get("/products/search", {
      params: { limit: 24, sortBy: "createdAt", sortOrder: "desc" },
    }),
    staleTime: 60_000,
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

  const available = stockInfo?.available_stock ?? 0;
  const totalStock = stockInfo?.total_stock ?? 0;
  const unit = stockInfo?.unit || product.unit || "kg";
  const isOutOfStock = stockInfo?.is_out_of_stock ?? false;
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

  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<"description" | "specifications" | "reviews" | "delivery" | "farmer">("description");
  const galleryImages: string[] = Array.isArray(product.images)
    ? product.images.map((image: any) => typeof image === "string" ? image : image?.url || image?.src).filter(Boolean)
    : [];
  const displayImages = galleryImages.length ? galleryImages : [product.image || "/images/placeholder-product.jpg"];
  const reviewCount = reviews.length;
  const categoryValue = product.category ?? product.categoryName;
  const categoryLabel =
    typeof categoryValue === "string" || typeof categoryValue === "number"
      ? String(categoryValue)
      : categoryValue && typeof categoryValue === "object"
        ? categoryValue.name || categoryValue.slug || "Not specified"
        : "Not specified";
  const directFarmerLocation = readableFarmLocation(product);
  const [reverseGeocodedLocation, setReverseGeocodedLocation] = useState("");
  const farmerLocation = directFarmerLocation || reverseGeocodedLocation;
  const farmerProfile = product.farmer || product.farmerProfile || product.farmerDetails || {};
  const farmProfile = product.farm || product.farmDetails || product.farmProfile || {};
  const farmerAvatar = product.farmerAvatar || farmerProfile.avatar || farmerProfile.profileImage || farmerProfile.photo || "";
  const farmerPhone = product.farmerPhone || product.farmerContactNumber || product.farmerMobile || farmerProfile.phone || farmerProfile.phoneNumber || farmerProfile.mobile || farmerProfile.mobileNumber || farmerProfile.contactNumber || farmerProfile.contact_number || farmProfile.phone || farmProfile.contactNumber || product.contactNumber || product.phone || "";
  const farmerMemberSince = product.farmer?.createdAt || product.farmer?.joinedAt || product.farmer?.memberSince || product.farmerCreatedAt || "";
  const farmerProducts = product.farmer?.products || product.farmerProducts || product.otherProductsFromFarmer || [];
  const currentProductId = String(product.id || product._id || productId);
  const embeddedFarmerProducts = Array.isArray(farmerProducts) ? farmerProducts : [];
  const marketplaceProducts = relatedProductsData?.data?.products || relatedProductsData?.products || relatedProductsData?.data?.items || relatedProductsData?.items || [];
  const recommendationPool = Array.isArray(product.similarProducts) && product.similarProducts.length
    ? product.similarProducts
    : [...embeddedFarmerProducts, ...(Array.isArray(marketplaceProducts) ? marketplaceProducts : [])];
  const uniqueRecommendations = recommendationPool.filter((item: any, index: number, items: any[]) => {
    const itemId = String(item.id || item._id || item.productId || "");
    return itemId && itemId !== currentProductId &&
      items.findIndex((candidate: any) => String(candidate.id || candidate._id || candidate.productId || "") === itemId) === index;
  });
  const currentCategory = String(product.category?.name || product.categoryName || product.category || "").toLowerCase();
  const sameCategoryRecommendations = uniqueRecommendations.filter((item: any) =>
    String(item.category?.name || item.categoryName || item.category || "").toLowerCase() === currentCategory
  );
  const similarProducts = (sameCategoryRecommendations.length ? sameCategoryRecommendations : uniqueRecommendations).slice(0, 3);
  const otherFarmerProducts = embeddedFarmerProducts
    .filter((item: any) => String(item.id || item._id || item.productId || "") !== currentProductId)
    .slice(0, 3);

  // If the listing contains GPS only, resolve it to a customer-readable place
  // name. Never render raw latitude/longitude as the farm address.
  useEffect(() => {
    setReverseGeocodedLocation("");
    if (directFarmerLocation) return;
    const coordinates = product?.location?.coordinates;
    const latitude = Array.isArray(coordinates) ? Number(coordinates[1]) : Number(product?.location?.latitude ?? product?.latitude);
    const longitude = Array.isArray(coordinates) ? Number(coordinates[0]) : Number(product?.location?.longitude ?? product?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ format: "jsonv2", lat: String(latitude), lon: String(longitude), zoom: "10", addressdetails: "1" });
    fetch("https://nominatim.openstreetmap.org/reverse?" + params.toString(), { signal: controller.signal, headers: { Accept: "application/json" } })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => {
        const address = result?.address || {};
        const place = [
          address.village || address.hamlet || address.suburb || address.town || address.city || address.municipality,
          address.county || address.state_district || address.district,
          address.state,
        ].filter((value, index, values) => value && values.findIndex((item) => String(item).toLowerCase() === String(value).toLowerCase()) === index);
        if (place.length) setReverseGeocodedLocation(place.join(", "));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [productId, directFarmerLocation, product?.location?.coordinates, product?.location?.latitude, product?.location?.longitude, product?.latitude, product?.longitude]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-screen-2xl space-y-5 p-4 lg:p-6">
        <div className="h-5 w-64 animate-pulse rounded bg-slate-200" />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="h-[560px] animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-[560px] animate-pulse rounded-2xl bg-slate-100" />
        </div>
      </div>
    );
  }

  const tabs = [
    { id: "description", label: "Description" },
    { id: "specifications", label: "Specifications" },
    { id: "reviews", label: `Reviews (${reviewCount})` },
    { id: "delivery", label: "Delivery & Returns" },
    { id: "farmer", label: "Farmer Details" },
  ] as const;

  return (
    <div className="role-workspace role-customer mx-auto w-full max-w-[1720px] space-y-4 px-3 py-4 sm:px-5 lg:px-6 2xl:px-8">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
        <Link href="/" className="font-medium hover:text-emerald-700">Home</Link>
        <span>›</span>
        <Link href="/marketplace" className="font-medium hover:text-emerald-700">Marketplace</Link>
        <span>›</span>
        <Link href={backHref} className="font-medium hover:text-emerald-700">Products</Link>
        <span>›</span>
        <span className="max-w-[220px] truncate font-semibold text-slate-800">{product.name}</span>
      </nav>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_390px] 2xl:gap-5">
        <div className="min-w-0 space-y-4">
        <Card className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_4px_18px_rgba(15,23,42,0.07)]">
          <CardContent className="p-3 sm:p-4 lg:p-5">
            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,.92fr)] 2xl:gap-7">
              <section className="min-w-0">
                <div className="group relative aspect-[1.5/1] max-h-[520px] overflow-hidden rounded-2xl bg-slate-100">
                  <img
                    src={displayImages[Math.min(selectedImageIndex, displayImages.length - 1)]}
                    alt={product.name}
                    className="h-full w-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).src = "/images/placeholder-product.jpg"; }}
                  />
                  <div className="absolute left-4 top-4 rounded-full bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-md">
                    <span className="mr-1.5">✦</span> Farm Fresh
                  </div>
                  <div className="absolute right-4 top-4 flex gap-2">
                    <Button variant="secondary" size="icon" className="h-10 w-10 rounded-full bg-white/95 shadow" onClick={handleWishlist} title={wishlisted ? "Remove from wishlist" : "Add to wishlist"}>
                      <Heart className={cn("h-5 w-5", wishlisted && "fill-rose-500 text-rose-500")} />
                    </Button>
                    <Button variant="secondary" size="icon" className="h-10 w-10 rounded-full bg-white/95 shadow" onClick={() => {
                      if (typeof navigator !== "undefined" && navigator.share) navigator.share({ title: product.name, url: window.location.href }).catch(() => {});
                      else if (typeof navigator !== "undefined" && navigator.clipboard) navigator.clipboard.writeText(window.location.href).then(() => toast.success("Product link copied"));
                    }} title="Share product">
                      <span className="text-lg leading-none">↗</span>
                    </Button>
                  </div>
                  {displayImages.length > 1 && (
                    <>
                      <button type="button" aria-label="Previous product image" onClick={() => setSelectedImageIndex((i) => (i - 1 + displayImages.length) % displayImages.length)} className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-2xl text-slate-800 shadow transition hover:bg-white">‹</button>
                      <button type="button" aria-label="Next product image" onClick={() => setSelectedImageIndex((i) => (i + 1) % displayImages.length)} className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-2xl text-slate-800 shadow transition hover:bg-white">›</button>
                    </>
                  )}
                  <span className="absolute bottom-4 right-4 rounded-full bg-slate-950/75 px-3 py-1.5 text-xs font-semibold text-white">
                    {selectedImageIndex + 1} / {displayImages.length}
                  </span>
                </div>
                {displayImages.length > 1 && (
                  <div className="mt-3 grid grid-cols-5 gap-2.5">
                    {displayImages.slice(0, 5).map((image, index) => (
                      <button key={image + index} type="button" onClick={() => setSelectedImageIndex(index)} className={cn("aspect-[1.25/1] overflow-hidden rounded-xl border-2 bg-slate-50 transition", selectedImageIndex === index ? "border-emerald-600 ring-2 ring-emerald-100" : "border-transparent hover:border-emerald-200")}>
                        <img src={image} alt={`${product.name} view ${index + 1}`} className="h-full w-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).src = "/images/placeholder-product.jpg"; }} />
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="flex min-w-0 flex-col xl:pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border-0 bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Farm fresh</Badge>
                  {product.isOrganic && <Badge className="border-0 bg-green-100 text-green-800 hover:bg-green-100">Organic</Badge>}
                  {product.isPesticideFree && <Badge className="border-0 bg-green-100 text-green-800 hover:bg-green-100">Pesticide free</Badge>}
                  {product.isChemicalFree && <Badge className="border-0 bg-green-100 text-green-800 hover:bg-green-100">Chemical free</Badge>}
                </div>
                <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">{product.name}</h1>
                <p className="mt-2 text-sm leading-6 text-slate-600 sm:text-base">{product.description}</p>

                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900">
                    <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
                    {product.rating ? Number(product.rating).toFixed(1) : "New"}
                    <span className="font-normal text-slate-500">({reviewCount} reviews)</span>
                  </span>
                  {product.purchaseCount ? <span className="text-slate-500">{Number(product.purchaseCount).toLocaleString()}+ bought</span> : null}
                </div>

                <div className="mt-4 rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50 to-green-50 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-white shadow-sm">
                      {farmerAvatar ? <img src={farmerAvatar} alt={product.farmerName || "Farmer"} className="h-full w-full object-cover" /> : <Store className="h-6 w-6 text-emerald-700" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 font-bold text-slate-900">
                        {product.farmerName || product.farmer?.name || "Local Farmer"}
                        {product.farmerVerified && <span className="text-emerald-600" title="Verified farmer">✓</span>}
                      </p>
                      {farmerLocation && <p className="mt-1 flex items-start gap-1 text-sm text-slate-700"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />{farmerLocation}</p>}
                      <p className="mt-1 text-xs font-medium text-emerald-700">Farm supplier</p>
                    </div>
                    {product.farmerId && <Link href={`/farmer/${product.farmerId}`} className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 shadow-sm hover:bg-emerald-50">View Farm Profile →</Link>}
                  </div>
                </div>

                <div className="mt-5">
                  <h2 className="text-lg font-bold text-slate-950">Key Highlights</h2>
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      ["🌱", "Farm sourced"],
                      ["📦", "Stock tracked"],
                      ["📍", "Farm location"],
                      ["🚚", "Delivery options"],
                    ].map(([icon, label]) => (
                      <div key={label} className="flex flex-col items-center rounded-xl bg-emerald-50/70 px-2 py-3 text-center">
                        <span className="text-2xl">{icon}</span>
                        <span className="mt-1 text-xs font-semibold text-slate-800">{label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {(product.pickupAvailable || product.minBulkQty > 0) && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {product.pickupAvailable && <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">Farm pickup available</Badge>}
                    {product.minBulkQty > 0 && <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-800">Bulk pricing available</Badge>}
                  </div>
                )}
              </section>
            </div>
          </CardContent>
        </Card>
      <section id="product-information" className="scroll-mt-24 space-y-4">
        <nav aria-label="Product information sections" className="grid grid-cols-2 gap-1 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_4px_16px_rgba(15,23,42,0.06)] sm:grid-cols-3 lg:grid-cols-5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              aria-pressed={activeTab === tab.id}
              className={cn(
                "min-h-12 rounded-xl px-2 py-2.5 text-xs font-bold transition sm:text-sm",
                activeTab === tab.id
                  ? "bg-emerald-700 text-white shadow-md"
                  : "text-slate-700 hover:bg-emerald-50 hover:text-emerald-800"
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <Card className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_4px_18px_rgba(15,23,42,0.06)]">
          <CardContent className="min-h-[320px] p-4 sm:p-6 lg:p-7">
            {activeTab === "description" && (
              <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(260px,.85fr)]">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">About this product</p>
                  <h2 className="mt-1 text-2xl font-extrabold text-slate-950">Product Description</h2>
                  <p className="mt-3 whitespace-pre-line text-sm leading-7 text-slate-600">
                    {product.description || "No product description has been provided yet."}
                  </p>
                  <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      [Leaf, "Farm Fresh"],
                      [ShieldCheck, "Quality Assured"],
                      [Truck, "Safe Delivery"],
                      [CheckCircle2, "Naturally Grown"],
                    ].map(([Icon, label]: any) => (
                      <div key={label} className="flex min-h-[88px] flex-col items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50/70 p-3 text-center">
                        <Icon className="h-7 w-7 text-emerald-700" />
                        <span className="mt-2 text-xs font-bold text-slate-700">{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="overflow-hidden rounded-2xl border border-emerald-100 bg-emerald-50">
                  <img
                    src={displayImages[0]}
                    alt={product.name + " product"}
                    className="h-64 w-full object-cover sm:h-72"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).src = "/images/placeholder-product.jpg"; }}
                  />
                </div>
              </div>
            )}

            {activeTab === "specifications" && (
              <div>
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Product information</p>
                    <h2 className="mt-1 text-2xl font-extrabold text-slate-950">Product Specifications</h2>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">Live product details</span>
                </div>
                <dl className="mt-5 grid gap-3 lg:grid-cols-2">
                  {[
                    [Package, "Product Name", product.name || "—"],
                    [Leaf, "Category", categoryLabel],
                    [Package, "Unit", unit],
                    [ShoppingCart, "Price", formatPrice(effectivePrice) + " / " + unit],
                    [Package, "Available Quantity", available + " " + unit],
                    [ShoppingCart, "Minimum Order", (product.minBulkQty || 1) + " " + unit],
                    [CheckCircle2, "Harvest Status", product.harvestStatus || (product.isPreHarvest ? "Pre-harvest" : "Harvested")],
                    [ShieldCheck, "Packaging", product.packagingType || product.packaging || "Farm packed"],
                  ].map(([Icon, label, value]: any) => (
                    <div key={label} className="grid min-w-0 grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] overflow-hidden rounded-xl border border-slate-200">
                      <dt className="flex items-center gap-2 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-600 sm:px-4">
                        <Icon className="h-4 w-4 shrink-0 text-emerald-700" />
                        {label}
                      </dt>
                      <dd className="flex items-center break-words px-3 py-3 text-sm font-bold text-slate-900 sm:px-4">{String(value ?? "—")}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {activeTab === "reviews" && (
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Customer feedback</p>
                  <h2 className="mt-1 text-2xl font-extrabold text-slate-950">Customer Reviews</h2>
                  <div className="mt-4 grid gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-4 sm:grid-cols-[150px_minmax(0,1fr)]">
                    <div className="flex flex-col justify-center">
                      <span className="text-5xl font-extrabold tracking-tight text-slate-950">{product.rating ? Number(product.rating).toFixed(1) : "New"}</span>
                      <span className="mt-1 text-xl tracking-wider text-amber-500">{"★".repeat(Math.max(0, Math.min(5, Math.round(Number(product.rating) || 0))))}{"☆".repeat(Math.max(0, 5 - Math.min(5, Math.round(Number(product.rating) || 0))))}</span>
                      <span className="mt-1 text-xs text-slate-500">Based on {reviewCount} reviews</span>
                    </div>
                    <div className="space-y-2">
                      {[5, 4, 3, 2, 1].map((rating) => {
                        const count = reviews.filter((review: any) => Number(review.rating) === rating).length;
                        const percent = reviewCount ? (count / reviewCount) * 100 : 0;
                        return (
                          <div key={rating} className="grid grid-cols-[34px_minmax(0,1fr)_34px] items-center gap-2 text-xs">
                            <span className="font-semibold text-slate-600">{rating} ★</span>
                            <div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-emerald-600" style={{ width: percent + "%" }} /></div>
                            <span className="text-right text-slate-500">{Math.round(percent)}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {reviews.length === 0 ? (
                    <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-center">
                      <Star className="mx-auto h-8 w-8 text-amber-400" />
                      <p className="mt-2 font-semibold text-slate-800">No reviews yet</p>
                      <p className="mt-1 text-sm text-slate-500">Be the first customer to share feedback about this product.</p>
                    </div>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {reviews.map((review: any, index: number) => (
                        <article key={review.id || review._id || index} className="rounded-xl border border-slate-200 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-bold text-slate-900">{review.userName || "Customer"}</span>
                            <span className="text-sm tracking-wider text-amber-500">{"★".repeat(Math.min(5, Number(review.rating) || 0))}{"☆".repeat(Math.max(0, 5 - Math.min(5, Number(review.rating) || 0)))}</span>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-slate-600">{review.comment}</p>
                          {review.createdAt && <p className="mt-2 text-xs text-slate-400">{new Date(review.createdAt).toLocaleDateString()}</p>}
                        </article>
                      ))}
                    </div>
                  )}
                </div>
                <aside className="h-fit rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
                  <h3 className="text-lg font-bold text-slate-900">Write a Review</h3>
                  <p className="mt-1 text-sm text-slate-600">Share your experience with other customers.</p>
                  <div className="mt-3 flex gap-1">{[1, 2, 3, 4, 5].map((star) => <button key={star} type="button" onClick={() => setReviewRating(star)} aria-label={star + " stars"} className={cn("text-3xl transition", star <= reviewRating ? "text-amber-500" : "text-slate-300")}>★</button>)}</div>
                  <textarea value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} rows={5} placeholder="Share your experience..." className="mt-3 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-emerald-500" />
                  {reviewError && <p className="mt-2 text-sm text-rose-600">{reviewError}</p>}
                  <Button className="mt-3 w-full rounded-xl bg-emerald-700 hover:bg-emerald-800" onClick={handleSubmitReview} disabled={reviewLoading}>{reviewLoading ? "Submitting..." : "Submit Review"}</Button>
                  <p className="mt-2 text-xs leading-5 text-slate-500">Review submission may require a verified purchase.</p>
                </aside>
              </div>
            )}

            {activeTab === "delivery" && (
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Order information</p>
                <h2 className="mt-1 text-2xl font-extrabold text-slate-950">Delivery & Returns</h2>
                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  <section className="rounded-2xl border border-slate-200 p-4 sm:p-5">
                    <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900"><Truck className="h-5 w-5 text-emerald-700" />Delivery Information</h3>
                    <div className="mt-4 space-y-4">
                      {[
                        ["Estimated Delivery", "Delivery estimate is confirmed at checkout for your address."],
                        ["Delivery Charge", "Calculated at checkout based on delivery address and available service."],
                        ["Delivery Method", "Available delivery options are shown during checkout."],
                      ].map(([label, value]) => (
                        <div key={label} className="flex gap-3 border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                          <div><p className="text-sm font-bold text-slate-800">{label}</p><p className="mt-1 text-sm leading-5 text-slate-600">{value}</p></div>
                        </div>
                      ))}
                      {product.pickupAvailable && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><p className="font-bold"><Store className="mr-1 inline h-4 w-4" />Farm Pickup Available</p><p className="mt-1">{product.pickupInstructions || "Contact the farmer to confirm pickup arrangements."}</p></div>}
                    </div>
                  </section>
                  <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                    <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900"><ShieldCheck className="h-5 w-5 text-emerald-700" />Returns & Refunds</h3>
                    <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                      <p>If the produce arrives damaged, incorrect, or does not meet the applicable quality requirements, you can submit a return or refund request for review.</p>
                      <p>Requests are assessed according to the AgriConnect return policy and the order details.</p>
                    </div>
                    <Link href="/refunds" className="mt-5 inline-flex items-center rounded-xl border border-emerald-600 bg-white px-4 py-2.5 text-sm font-bold text-emerald-800 hover:bg-emerald-50">View Return & Refund Policy →</Link>
                  </section>
                </div>
              </div>
            )}

            {activeTab === "farmer" && (
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Meet the grower</p>
                <h2 className="mt-1 text-2xl font-extrabold text-slate-950">Farmer Details</h2>
                <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,.85fr)]">
                  <section className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm sm:p-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-emerald-100 bg-emerald-50">
                        {farmerAvatar ? <img src={farmerAvatar} alt={product.farmerName || "Farmer"} className="h-full w-full object-cover" /> : <Store className="h-7 w-7 text-emerald-700" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-lg font-extrabold text-slate-950">{product.farmer?.farmName || product.farmName || product.farmerName || product.farmer?.name || "Local Farmer"}</p>
                        <p className="mt-0.5 text-sm font-semibold text-emerald-700">{product.farmerVerified || product.farmer?.isVerified ? "✓ Verified Farmer" : "Farm Supplier"}</p>
                        {farmerLocation && <p className="mt-1.5 flex items-start gap-2 text-sm text-slate-600"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" /><span>{farmerLocation}</span></p>}
                      </div>
                    </div>
                    <div className="mt-4 grid gap-2">
                      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50/80 px-3 py-3">
                        <Phone className="h-4 w-4 shrink-0 text-emerald-700" />
                        <span className="text-xs font-bold uppercase tracking-wide text-emerald-800">Contact Number</span>
                        {farmerPhone ? <a href={"tel:" + farmerPhone} className="ml-auto font-bold text-emerald-900 hover:underline">{farmerPhone}</a> : <span className="ml-auto text-sm text-slate-500">Not provided in farmer profile</span>}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="rounded-xl bg-slate-50 p-3">
                          <p className="text-xs text-slate-500">Farming Method</p>
                          <p className="mt-1 text-sm font-bold text-slate-900">{product.farmingMethod || product.farmer?.farmingMethod || (product.isOrganic ? "Organic" : "Farm grown")}</p>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-3">
                          <p className="text-xs text-slate-500">Product Stock</p>
                          <p className="mt-1 text-sm font-bold text-emerald-800">{available} {unit} available</p>
                        </div>
                      </div>
                      {farmerMemberSince && <p className="text-xs text-slate-500">Member since: <span className="font-semibold text-slate-700">{new Date(farmerMemberSince).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span></p>}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {farmerPhone && <a href={"tel:" + farmerPhone} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800"><Phone className="h-4 w-4" />Call Farmer</a>}
                      {product.farmerId && <Link href={"/farmer/" + product.farmerId} className="inline-flex items-center justify-center rounded-xl border border-emerald-600 bg-white px-4 py-2.5 text-sm font-bold text-emerald-800 hover:bg-emerald-50">View Full Farm Profile →</Link>}
                    </div>
                  </section>
                  <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-base font-extrabold text-slate-900">Other Products from this Farmer</h3>
                      {otherFarmerProducts.length > 0 && <span className="text-xs font-semibold text-slate-500">{otherFarmerProducts.length} products</span>}
                    </div>
                    {otherFarmerProducts.length > 0 ? (
                      <div className="mt-4 grid grid-cols-3 gap-2">
                        {otherFarmerProducts.map((item: any, index: number) => {
                          const itemId = item.id || item._id || item.productId;
                          const itemImage = item.images?.[0] || item.image || "/images/placeholder-product.jpg";
                          return (
                            <Link key={itemId || index} href={itemId ? "/product/" + itemId : "/marketplace"} className="min-w-0 rounded-xl border border-slate-100 p-2 transition hover:border-emerald-200 hover:shadow-sm">
                              <img src={itemImage} alt={item.name || "Farm product"} className="h-20 w-full rounded-lg object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).src = "/images/placeholder-product.jpg"; }} />
                              <p className="mt-2 truncate text-xs font-bold text-slate-900">{item.name || "Farm product"}</p>
                              <p className="mt-0.5 text-xs font-semibold text-emerald-700">{item.price != null ? formatPrice(item.price) + " / " + (item.unit || unit) : "View product"}</p>
                            </Link>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="mt-4 flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 text-center">
                        <Store className="h-7 w-7 text-emerald-600" />
                        <p className="mt-2 text-sm font-semibold text-slate-700">More farm products</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">Other products will appear here when the farmer has additional active listings.</p>
                      </div>
                    )}
                    {farmerLocation && <p className="mt-4 flex items-start gap-2 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-600"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />Farm location: {farmerLocation}</p>}
                  </aside>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
        </div>
        <aside className="space-y-4">
          <Card className="rounded-2xl border border-slate-200/80 bg-white shadow-[0_4px_18px_rgba(15,23,42,0.07)]">
            <CardContent className="space-y-4 p-4 sm:p-5">
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="inline-flex items-center gap-2 font-medium text-slate-700"><Package className="h-5 w-5 text-emerald-700" />Available Stock</span>
                  <span className={cn("font-bold", isOutOfStock ? "text-rose-600" : "text-emerald-700")}>{isOutOfStock ? "Out of stock" : `${available} ${unit}`}</span>
                </div>
                {totalStock > 0 && <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"><div className={cn("h-full rounded-full", isOutOfStock ? "bg-rose-500" : "bg-emerald-600")} style={{ width: `${Math.min(100, (available / totalStock) * 100)}%` }} /></div>}
                {!isOutOfStock && available > 0 && available <= 5 && <p className="mt-2 text-xs font-medium text-amber-700">Only {available} left in stock</p>}
              </div>

              {Number(product.farmDistanceKm) > 0 && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-emerald-800"><MapPin className="h-4 w-4" />Farm Distance</p>
                  <p className="mt-1 text-lg font-bold text-emerald-800">{Number(product.farmDistanceKm).toFixed(1)} km from your location</p>
                </div>
              )}

              {product.location?.coordinates && (
                <div className="space-y-2">
                  <h2 className="font-bold text-slate-900">Product Location</h2>
                  <p className="flex items-center gap-1.5 text-sm text-slate-600"><MapPin className="h-4 w-4 text-emerald-700" />{farmerLocation || "Farm location"}</p>
                  <div className="h-36 overflow-hidden rounded-xl border bg-slate-100">
                    <iframe title="Product location map" width="100%" height="100%" loading="lazy" frameBorder="0" src={`https://www.openstreetmap.org/export/embed.html?bbox=${Number(product.location.coordinates[0]) - 0.01}%2C${Number(product.location.coordinates[1]) - 0.01}%2C${Number(product.location.coordinates[0]) + 0.01}%2C${Number(product.location.coordinates[1]) + 0.01}&layer=mapnik&marker=${product.location.coordinates[1]}%2C${product.location.coordinates[0]}`} />
                  </div>
                  <a href={`https://www.openstreetmap.org/?mlat=${product.location.coordinates[1]}&mlon=${product.location.coordinates[0]}&zoom=14`} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-emerald-700 hover:underline">Open in OpenStreetMap →</a>
                </div>
              )}

              <div className="border-t pt-4">
                <div className="flex flex-wrap items-end gap-2">
                  <span className="text-3xl font-extrabold tracking-tight text-emerald-700">{formatPrice(effectivePrice)}</span>
                  <span className="pb-1 text-sm text-slate-500">/ {unit}</span>
                  {effectivePrice < Number(product.price || 0) && <span className="pb-1 text-sm text-slate-400 line-through">{formatPrice(Number(product.price || 0))}</span>}
                  {product.bulkDiscountPercent > 0 && <Badge className="mb-1 border-0 bg-rose-100 text-rose-700 hover:bg-rose-100">{product.bulkDiscountPercent}% off</Badge>}
                </div>
                {product.minBulkQty > 0 && <p className="mt-1 text-xs text-blue-700">Bulk price applies from {product.minBulkQty} {unit}</p>}
                {!isOutOfStock && (
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <span className="text-sm font-semibold text-slate-800">Quantity:</span>
                    <div className="flex h-10 items-center overflow-hidden rounded-xl border border-slate-200">
                      <button type="button" onClick={() => handleQuantityChange(-1)} disabled={quantity <= 1} className="flex h-full w-10 items-center justify-center text-slate-700 hover:bg-slate-50 disabled:opacity-30"><Minus className="h-4 w-4" /></button>
                      <input type="number" aria-label="Product quantity" value={quantity} min={1} max={maxQty} onChange={(e) => { const val = parseInt(e.target.value, 10); if (isNaN(val) || val < 1) setQuantity(1); else setQuantity(Math.min(val, maxQty)); }} className="h-full w-12 border-x text-center text-sm font-semibold outline-none" />
                      <button type="button" onClick={() => handleQuantityChange(1)} disabled={quantity >= maxQty} className="flex h-full w-10 items-center justify-center text-slate-700 hover:bg-slate-50 disabled:opacity-30"><Plus className="h-4 w-4" /></button>
                    </div>
                    <span className="text-xs text-slate-500">Max {available} {unit}</span>
                  </div>
                )}
                <p className="mt-2 text-xs text-slate-500">Order total: <span className="font-semibold text-slate-800">{formatPrice(effectivePrice * quantity)}</span></p>
              </div>

              {product.pickupAvailable && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><p className="font-semibold"><Store className="mr-1 inline h-4 w-4" />Farm pickup available</p><p className="mt-1 text-xs">{product.pickupInstructions || "Collect directly from the farm, subject to confirmation."}</p></div>}

              {isOutOfStock ? (
                <div className="space-y-2">
                  <Button className="w-full rounded-xl" variant="outline" onClick={activeAlert ? removeAlert : () => openAlertPanel("back_in_stock")}><Bell className="mr-2 h-4 w-4" />{activeAlert ? "Alert On" : "Notify Me When Available"}</Button>
                  {activeAlert && <p className="text-center text-xs text-slate-500">{activeAlert.alertType === "price_drop" ? "Price-drop alert is active" : "Back-in-stock alert is active"}</p>}
                  {alertOpen && <div className="space-y-3 rounded-xl border p-3"><p className="text-sm font-semibold">Notify me when:</p><label className="flex items-center gap-2 text-sm"><input type="radio" checked={alertType === "back_in_stock"} onChange={() => setAlertType("back_in_stock")} />Back in stock</label><label className="flex items-center gap-2 text-sm"><input type="radio" checked={alertType === "price_drop"} onChange={() => setAlertType("price_drop")} />Price drops to {alertType === "price_drop" && <input type="number" value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)} placeholder="₹ amount" className="w-24 rounded border px-2 py-1" />}</label><Button className="w-full" size="sm" onClick={subscribeAlert} disabled={alertSubmitting}>{alertSubmitting ? "Setting..." : "Set Alert"}</Button></div>}
                </div>
              ) : !isAuthenticated ? (
                <Button className="w-full rounded-xl" onClick={() => router.push(`/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`)}><LogIn className="mr-2 h-4 w-4" />Sign in to Buy</Button>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" className="h-12 rounded-xl border-slate-300 font-semibold" onClick={handleAddToCart}><ShoppingCart className="mr-2 h-4 w-4" />Add to Cart</Button>
                  <Button className="h-12 rounded-xl bg-emerald-700 font-semibold hover:bg-emerald-800" onClick={handleBuyNow}><span className="mr-2">ϟ</span>Buy Now</Button>
                </div>
              )}
              {!isOutOfStock && <button type="button" onClick={activeAlert ? removeAlert : () => openAlertPanel("price_drop")} className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50"><Bell className="h-3.5 w-3.5" />{activeAlert ? "Price alert on — remove alert" : "Track price and get notified"}</button>}
              {available <= 0 && totalStock > 0 && <div className="flex items-center gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800"><AlertCircle className="h-4 w-4" />Temporarily out of stock — check back soon.</div>}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-slate-900">Similar Products</h2>
                <Link href="/marketplace" className="text-sm font-semibold text-emerald-700 hover:underline">View all →</Link>
              </div>
              <div className="mt-3 space-y-3">
                {similarProducts.slice(0, 3).map((item: any, index: number) => {
                  const itemId = item.id || item._id || item.productId;
                  const itemImage = item.images?.[0] || item.image || "/images/placeholder-product.jpg";
                  return (
                    <Link key={itemId || index} href={itemId ? "/product/" + itemId : "/marketplace"} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-100 p-2 transition hover:border-emerald-200 hover:shadow-sm">
                      <img src={itemImage} alt={item.name || "Similar product"} className="h-20 w-20 shrink-0 rounded-lg object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).src = "/images/placeholder-product.jpg"; }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-slate-900">{item.name || "Fresh produce"}</span>
                        <span className="mt-1 block text-sm font-bold text-emerald-700">{item.price != null ? formatPrice(item.price) + " / " + (item.unit || unit) : "View product"}</span>
                        {item.rating != null && <span className="mt-1 block text-xs text-slate-500">★ {Number(item.rating).toFixed(1)}</span>}
                      </span>
                      <ShoppingCart className="h-5 w-5 shrink-0 text-emerald-700" />
                    </Link>
                  );
                })}
                {similarProducts.length === 0 && (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center">
                    <Store className="mx-auto h-6 w-6 text-emerald-600" />
                    <p className="mt-2 text-sm font-semibold text-slate-700">No similar products available yet</p>
                    <p className="mt-1 text-xs text-slate-500">Explore the marketplace to discover more fresh produce.</p>
                  </div>
                )}
                <Link href="/marketplace" className="inline-flex w-full items-center justify-center rounded-xl border border-emerald-200 px-4 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">View All Products →</Link>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}