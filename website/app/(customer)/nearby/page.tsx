"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  MapPin,
  Star,
  Loader2,
  ShoppingCart,
  Navigation,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Globe,
} from "lucide-react";
import { api } from "../../lib/api/client";
import { formatPrice, cn } from "../../lib/utils";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { PlaceSelector, type PlaceSelection } from "../../components/customer/place-selector";
import { HarvestSections } from "../../components/customer/harvest-sections";
import { usePageParams } from "../../lib/hooks/use-page-params";
import { usePersistentQuery } from "../../lib/hooks/use-persistent-query";
import { useCartStore } from "../../lib/store/cart-store";
import toast from "react-hot-toast";

const RADII = [2, 5, 10, 20, 50];
const DEFAULT_RADIUS = 10;
const PER_PAGE = 12;

const SORT_OPTIONS = [
  { value: "distance", label: "Sort: Nearest" },
  { value: "price-asc", label: "Sort: Price: Low to High" },
  { value: "price-desc", label: "Sort: Price: High to Low" },
  { value: "rating", label: "Sort: Top Rated" },
];

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function productCoords(product: any, fallbackLat: number, fallbackLng: number): [number, number] {
  const loc = product?.location;
  if (loc && Array.isArray(loc.coordinates) && loc.coordinates.length >= 2) {
    return [Number(loc.coordinates[1]), Number(loc.coordinates[0])];
  }
  const lat = Number(product?.lat);
  const lng = Number(product?.lng);
  if (!Number.isNaN(lat) && !Number.isNaN(lng) && lat !== 0 && lng !== 0) {
    return [lat, lng];
  }
  return [fallbackLat, fallbackLng];
}

function productRating(product: any) {
  return Number(product?.ratings?.average ?? product?.rating ?? 0) || 0;
}

function farmerNameOf(product: any) {
  const farmer = product?.farmer;
  if (farmer && typeof farmer === "object") {
    return farmer.farmName || farmer.name || "Local Farmer";
  }
  return product?.farmerName || product?.farmName || "Local Farmer";
}

function NearbyInner() {
  const { params, update } = usePageParams();
  const addItem = useCartStore((s) => s.addItem);

  const tab = params.tab === "all" ? "all" : "nearby";
  const radius = RADII.includes(Number(params.radius)) ? Number(params.radius) : DEFAULT_RADIUS;
  const sortBy = SORT_OPTIONS.some((o) => o.value === params.sortBy) ? params.sortBy : "distance";
  const pageParam = Math.max(1, Number(params.page) || 1);

  const place: PlaceSelection = {
    country: params.country || "",
    state: params.state || "",
    district: params.district || "",
    city: params.city || "",
  };
  const hasPlace = !!(place.country || place.state || place.district || place.city);

  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setLocationError("Geolocation is not supported by this browser.");
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
        update({ country: "", state: "", district: "", city: "" }, { reset: ["page"] });
      },
      () => {
        setLocating(false);
        setLocationError("Location permission denied. Select a place instead.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }, [update]);

  // Fetch products based on the active tab + nearby filter. Coordinates are
  // kept out of the URL (they are not a shareable view state).
  const productsQuery = usePersistentQuery({
    enabled: tab === "nearby",
    queryKey: ["nearby", "products", tab, radius, sortBy, place, coords],
    queryFn: () => {
      if (tab === "nearby" && coords) {
        return api.get("/products/search", {
          params: { sortBy: "createdAt", sortOrder: "desc", limit: 100, lat: coords.lat, lng: coords.lng, radius },
        });
      }
      if (tab === "nearby" && !coords && !hasPlace) {
        return { data: { products: [] } };
      }
      const p: Record<string, string> = { limit: "100", sortBy: "createdAt", sortOrder: "desc" };
      if (tab === "nearby" && place.country) p.country = place.country;
      if (tab === "nearby" && place.state) p.state = place.state;
      if (tab === "nearby" && place.district) p.district = place.district;
      if (tab === "nearby" && place.city) p.city = place.city;
      return api.get("/products/search", { params: p });
    },
  });

  const isLoading = productsQuery.isLoading;

  const rawProducts = useMemo(() => {
    const list = productsQuery.data?.data?.products || productsQuery.data?.products || [];
    return list.map((p: any) => {
      const [lat, lng] = coords ? productCoords(p, coords.lat, coords.lng) : [NaN, NaN];
      const distance =
        coords && !Number.isNaN(lat) && !Number.isNaN(lng)
          ? haversineKm(coords.lat, coords.lng, lat, lng)
          : null;
      return {
        id: p._id || p.id,
        name: p.name || "Fresh Produce",
        farmerName: farmerNameOf(p),
        category: p.category || "General",
        price: Number(p.price) || 0,
        unit: p.unit || "kg",
        image: p.images?.[0] || p.image || "/images/placeholder-product.jpg",
        rating: productRating(p),
        distance,
        isOrganic: p.isOrganic || false,
        createdAt: p.createdAt || p.created_at,
      };
    });
  }, [productsQuery.data, coords]);

  const products = useMemo(() => {
    const arr = [...rawProducts];
    switch (sortBy) {
      case "price-asc":
        arr.sort((a, b) => a.price - b.price);
        break;
      case "price-desc":
        arr.sort((a, b) => b.price - a.price);
        break;
      case "rating":
        arr.sort((a, b) => b.rating - a.rating);
        break;
      default:
        arr.sort((a, b) => (a.distance ?? Number.MAX_SAFE_INTEGER) - (b.distance ?? Number.MAX_SAFE_INTEGER));
    }
    return arr;
  }, [rawProducts, sortBy]);

  const totalPages = Math.max(1, Math.ceil(products.length / PER_PAGE));
  const currentPage = Math.min(pageParam, totalPages);
  const pagedProducts = useMemo(
    () => products.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE),
    [products, currentPage],
  );

  const goToPage = useCallback(
    (page: number) => {
      update({ page: String(Math.min(Math.max(1, page), totalPages)) }, {});
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [update, totalPages],
  );

  const farmerCount = useMemo(
    () => new Set(products.map((p) => p.farmerName)).size,
    [products],
  );

  const handleAddToCart = (product: any) => {
    addItem({
      id: product.id,
      name: product.name,
      price: product.price,
      quantity: 1,
      image: product.image,
      farmerName: product.farmerName,
      unit: product.unit,
    });
    toast.success(`${product.name} added to cart!`);
  };

  const setTab = (value: "nearby" | "all") =>
    update({ tab: value === "nearby" ? "" : "all" }, { reset: ["page"] });

  const placeLabel = useMemo(
    () => [place.city, place.district, place.state, place.country].filter(Boolean).join(", "),
    [place],
  );

  return (
    <div className="space-y-4 p-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-3xl font-bold text-slate-900">Browse Products</h1>
        <p className="text-slate-500">
          Discover fresh produce from farmers near you and across India
        </p>
      </div>

      {/* Tabs: Nearby / All Products */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
        <button
          onClick={() => setTab("nearby")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition",
            tab === "nearby"
              ? "bg-white text-emerald-700 shadow-sm"
              : "text-slate-500 hover:text-slate-700",
          )}
        >
          <MapPin className="h-4 w-4" />
          Nearby
          {!isLoading && products.length > 0 && tab === "nearby" && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
              {products.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("all")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition",
            tab === "all"
              ? "bg-white text-emerald-700 shadow-sm"
              : "text-slate-500 hover:text-slate-700",
          )}
        >
          <Globe className="h-4 w-4" />
          All Products
        </button>
      </div>

      {/* Products section (nearby only — the "All Products" view is the
          Harvested / Pre Harvest sections below) */}
      {tab === "nearby" && (
        <section className="rounded-3xl border bg-white p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-3 text-xl font-bold text-slate-900">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100">
                <MapPin className="h-5 w-5 text-emerald-600" />
              </span>
              Nearby Products
            </h2>
            <p className="text-sm text-slate-500">
              {coords
                ? `${farmerCount} farmer${farmerCount !== 1 ? "s" : ""} within ${radius} km`
                : hasPlace
                  ? `Showing products & harvests in ${placeLabel}`
                  : "Farm-fresh produce from farmers near you"}
            </p>
          </div>

          {/* Nearby filter controls */}
          <div className="mb-6 space-y-5 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
            <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
              <PlaceSelector
                value={place}
                onChange={(value) => {
                  update({ country: value.country, state: value.state, district: value.district, city: value.city }, { reset: ["page"] });
                  if (value.country || value.state || value.district) setCoords(null);
                }}
                includeAll={false}
              />
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={locate} disabled={locating}>
                  {locating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Navigation className="mr-2 h-4 w-4" />
                  )}
                  Use My Location
                </Button>
              </div>
            </div>

            {coords && (
              <p className="flex items-center gap-2 text-xs text-slate-500">
                <MapPin className="h-3.5 w-3.5 text-emerald-600" />
                {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
              </p>
            )}
            {locationError && (
              <p className="text-xs text-amber-600">{locationError}</p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2">
                {RADII.map((r) => {
                  const active = r === radius;
                  return (
                    <button
                      key={r}
                      onClick={() => update({ radius: String(r) }, { reset: ["page"] })}
                      className={cn(
                        "rounded-full border px-4 py-1.5 text-sm font-medium transition",
                        active
                          ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                      )}
                    >
                      {r} km
                    </button>
                  );
                })}
              </div>

              <div className="relative">
                <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <select
                  value={sortBy}
                  onChange={(e) => update({ sortBy: e.target.value }, { reset: ["page"] })}
                  className="h-10 appearance-none rounded-xl border border-slate-300 bg-white pl-9 pr-8 text-sm text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
            </div>
          </div>

        {/* Products */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          </div>
        ) : products.length > 0 ? (
          <>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {pagedProducts.map((product: any) => (
                <Card key={product.id} className="group overflow-hidden transition-all hover:shadow-lg">
                  <Link href={`/product/${product.id}`}>
                    <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
                      <Image
                        src={product.image}
                        alt={product.name}
                        fill
                        className="object-cover transition-transform duration-300 group-hover:scale-110"
                      />
                      {product.isOrganic && (
                        <Badge variant="success" className="absolute left-3 top-3">
                          Organic
                        </Badge>
                      )}
                      {product.distance != null && (
                        <Badge variant="secondary" className="absolute right-3 top-3 bg-white/90">
                          <MapPin className="mr-1 h-3 w-3 text-emerald-600" />
                          {product.distance.toFixed(1)} km
                        </Badge>
                      )}
                    </div>
                  </Link>
                  <CardContent className="space-y-2 p-4">
                    <Link href={`/product/${product.id}`}>
                      <h3 className="truncate text-sm font-semibold text-slate-900 group-hover:text-emerald-600">
                        {product.name}
                      </h3>
                    </Link>
                    <p className="text-xs text-slate-500">{product.farmerName}</p>
                    <div className="flex items-center gap-1 text-xs text-slate-500">
                      <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                      <span className="font-medium text-slate-600">
                        {product.rating > 0 ? product.rating.toFixed(1) : "New"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-lg font-bold text-emerald-700">
                        {formatPrice(product.price)}
                        <span className="ml-0.5 text-xs font-normal text-slate-400">/{product.unit}</span>
                      </span>
                      <Button
                        className="rounded-full"
                        size="sm"
                        onClick={() => handleAddToCart(product)}
                      >
                        <ShoppingCart className="mr-1.5 h-4 w-4" />
                        Add
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage <= 1}
                  onClick={() => goToPage(currentPage - 1)}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Prev
                </Button>
                <span className="text-sm text-slate-500">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= totalPages}
                  onClick={() => goToPage(currentPage + 1)}
                >
                  Next
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            )}
          </>
        ) : null}
        </section>
      )}

      {/* Harvest sections — the nearby filter is shared so BOTH the
          "Harvested" and "Pre Harvest" tabs stay within the radius/place. */}
      <HarvestSections
        country={tab === "nearby" ? place.country : ""}
        state={tab === "nearby" ? place.state : ""}
        district={tab === "nearby" ? place.district : ""}
        city={tab === "nearby" ? place.city : ""}
        coords={tab === "nearby" && coords ? { lat: String(coords.lat), lng: String(coords.lng) } : null}
        radius={radius}
      />
    </div>
  );
}

export default function NearbyPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      }
    >
      <NearbyInner />
    </Suspense>
  );
}