"use client";

import { Suspense, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Globe,
  ChevronDown,
  Star,
  ShoppingCart,
  Truck,
  MapPin,
  Loader2,
  SearchX,
  Minus,
  Plus,
} from "lucide-react";
import { api } from "../../../lib/api/client";
import { formatPrice, cn } from "../../../lib/utils";
import { Card, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Input } from "../../../components/ui/input";
import { PlaceSelector, type PlaceSelection } from "../../../components/customer/place-selector";
import { HarvestSections } from "../../../components/customer/harvest-sections";
import { usePageParams } from "../../../lib/hooks/use-page-params";
import { useParamField } from "../../../lib/hooks/use-param-field";
import { useCartStore } from "../../../lib/store/cart-store";
import toast from "react-hot-toast";

const EMOJIS = [
  "🍎", "🌾", "🍊", "🌴", "🌶️", "🍵", "☕", "🥜",
  "🌺", "🏔️", "🌊", "🏜️", "🌽", "🍚", "🥭", "🌿",
];

function getStateMeta(state: string) {
  let hash = 0;
  for (let i = 0; i < state.length; i++) {
    hash = state.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    "#dc2626", "#ea580c", "#ca8a04", "#65a30d", "#16a34a",
    "#059669", "#0d9488", "#0891b2", "#2563eb", "#4f46e5",
    "#7c3aed", "#9333ea", "#c026d3", "#db2777", "#e11d48",
  ];
  return {
    flag: EMOJIS[Math.abs(hash) % EMOJIS.length],
    color: colors[Math.abs(hash) % colors.length],
  };
}

function NationalMarketplaceInner() {
  const { params, update } = usePageParams();
  const addItem = useCartStore((s: any) => s.addItem);

  const place: PlaceSelection = {
    country: params.country || "",
    state: params.state || "",
    district: params.district || "",
    city: params.city || "",
  };
  const selectedCategory = params.category || "";
  const sortBy = params.sortBy || "";
  const showFilters = params.filters === "1";

  const minPriceField = useParamField("minPrice", 400);
  const maxPriceField = useParamField("maxPrice", 400);

  const expandedStates = useMemo(
    () => new Set(params.expanded ? params.expanded.split(",").filter(Boolean) : []),
    [params.expanded],
  );

  const toggleState = (state: string) => {
    const next = new Set(expandedStates);
    if (next.has(state)) next.delete(state);
    else next.add(state);
    update({ expanded: Array.from(next).join(",") });
  };

  const { data: categoriesData } = useQuery({
    queryKey: ["products", "categories"],
    queryFn: () => api.get("/products/categories"),
  });

  const categories = useMemo(() => {
    const raw = categoriesData?.data?.categories || categoriesData?.categories || [];
    return raw.map((c: any) => (typeof c === "string" ? c : c.name || ""));
  }, [categoriesData]);

  const { data: productsData, isLoading } = useQuery({
    queryKey: [
      "marketplace", "national", place.country, place.state, place.district, place.city, selectedCategory,
      params.minPrice || "", params.maxPrice || "", sortBy,
    ],
    queryFn: () =>
      api.get("/marketplace/national", {
        params: {
          country: place.country || undefined,
          state: place.state || undefined,
          district: place.district || undefined,
          city: place.city || undefined,
          category: selectedCategory || undefined,
          minPrice: params.minPrice || undefined,
          maxPrice: params.maxPrice || undefined,
          sortBy: sortBy || undefined,
        },
      }),
  });

  const products = useMemo(() => {
    const list = productsData?.data?.products || productsData?.products || [];
    return list.map((p: any) => ({
      id: p._id || p.id,
      name: p.name || "Unknown Product",
      farmerName: p.farmerName || "Local Farmer",
      state: p.state || p.originState || "Unknown",
      district: p.district || "",
      city: p.city || "",
      category: p.category || "General",
      price: p.price,
      unit: p.unit || "kg",
      image: p.images?.[0] || p.image || "/images/placeholder-product.jpg",
      rating: p.ratings?.average || p.rating || 0,
      reviewCount: p.ratings?.count || p.reviewCount || 0,
      shipping: p.shipping || "Free shipping",
      shippingDays: p.shippingDays || "3-5",
      isOrganic: p.isOrganic || false,
      pickupAvailable: p.pickupAvailable ?? false,
      farmAddress: p.farmAddress || "",
      createdAt: p.createdAt || p.created_at,
    }));
  }, [productsData]);

  const productsByState = useMemo(() => {
    const grouped = productsData?.data?.groupedByState;
    if (grouped) {
      const map = new Map<string, typeof products>();
      Object.entries(grouped).forEach(([state, prods]: [string, any]) => {
        map.set(state, (prods as any[]).map((p: any) => ({
          id: p._id || p.id,
          name: p.name || "Unknown Product",
          farmerName: p.farmerName || "Local Farmer",
          state: p.state || state,
          district: p.district || "",
          city: p.city || "",
          category: p.category || "General",
          price: p.price,
          unit: p.unit || "kg",
          image: p.images?.[0] || p.image || "/images/placeholder-product.jpg",
          rating: p.ratings?.average || p.rating || 0,
          reviewCount: p.ratings?.count || p.reviewCount || 0,
          shipping: p.shipping || "Free shipping",
          shippingDays: p.shippingDays || "3-5",
          isOrganic: p.isOrganic || false,
          pickupAvailable: p.pickupAvailable ?? false,
          farmAddress: p.farmAddress || "",
          createdAt: p.createdAt || p.created_at,
        })));
      });
      return map;
    }

    const map = new Map<string, typeof products>();
    products.forEach((p: any) => {
      const state = p.state;
      if (!map.has(state)) map.set(state, []);
      map.get(state)!.push(p);
    });
    return map;
  }, [productsData, products]);

  const handleAddToCart = (product: any) => {
    addItem({
      id: product.id,
      name: product.name,
      price: product.price,
      quantity: 1,
      image: product.image,
      unit: product.unit || "kg",
      pickupAvailable: product.pickupAvailable ?? false,
      farmAddress: product.farmAddress || "",
    });
    toast.success(`${product.name} added to cart!`);
  };

  const handlePlaceChange = (value: PlaceSelection) => {
    update({ country: value.country, state: value.state, district: value.district, city: value.city });
  };

  const hasActiveFilters = selectedCategory || params.minPrice || params.maxPrice || sortBy;

  return (
    <div className="space-y-8 p-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-emerald-700 to-green-800 p-8 text-white md:p-12">
        <div className="relative z-10 max-w-2xl">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
            <Globe className="h-7 w-7" />
          </div>
          <h1 className="text-3xl font-bold md:text-4xl">National Marketplace</h1>
          <p className="mt-3 text-lg text-emerald-100">
            Premium agricultural produce sourced directly from farms across India.
            From the foothills of Kashmir to the coasts of Kerala.
          </p>
        </div>
        <div className="absolute right-4 top-1/2 hidden -translate-y-1/2 opacity-10 md:block">
          <svg viewBox="0 0 400 500" className="h-80 w-64" fill="currentColor">
            <path d="M200 30 L240 50 L260 80 L280 75 L290 100 L270 130 L300 160 L310 190 L290 220 L310 250 L280 280 L260 270 L250 290 L220 300 L200 320 L180 300 L160 310 L140 290 L120 300 L100 280 L80 290 L60 270 L70 240 L50 210 L60 180 L80 200 L100 180 L120 190 L140 170 L130 140 L150 120 L140 90 L160 70 L180 50Z" />
            <circle cx="200" cy="160" r="8" />
            <circle cx="230" cy="200" r="6" />
            <circle cx="170" cy="220" r="5" />
            <circle cx="280" cy="130" r="5" />
            <circle cx="120" cy="180" r="4" />
            <circle cx="200" cy="250" r="6" />
          </svg>
        </div>
      </div>

      {/* Place selector */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <MapPin className="h-5 w-5 text-emerald-600" />
            Select your place
          </div>
          <PlaceSelector value={place} onChange={handlePlaceChange} includeAll />
          <p className="text-xs text-slate-400">
            {place.country ? (
              <>
                Showing products from{" "}
                <span className="font-semibold text-emerald-700">
                  {[place.city, place.district, place.state, place.country].filter(Boolean).join(", ")}
                </span>
              </>
            ) : (
              "No country selected — showing products from all countries."
            )}
          </p>
        </CardContent>
      </Card>

      {/* Filters bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedCategory}
            onChange={(e) => update({ category: e.target.value })}
            className="h-10 appearance-none rounded-xl border border-slate-300 bg-white px-3 pr-8 text-sm text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          >
            <option value="">All Categories</option>
            {categories.map((c: string) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => update({ filters: showFilters ? "" : "1" })}
            className="rounded-full"
          >
            Price & Sort
            <ChevronDown className={cn("ml-1 h-4 w-4 transition", showFilters && "rotate-180")} />
          </Button>
        </div>
        <p className="text-sm text-slate-500">
          {isLoading ? "Loading..." : `${products.length} product${products.length !== 1 ? "s" : ""}`}
        </p>
      </div>

      {/* Expandable price & sort filters */}
      {showFilters && (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-4 p-5">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Min Price</label>
              <Input
                type="number"
                placeholder="Rs 0"
                value={minPriceField.value}
                onChange={(e) => minPriceField.setValue(e.target.value)}
                className="h-10 w-32"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Max Price</label>
              <Input
                type="number"
                placeholder="Rs 10000"
                value={maxPriceField.value}
                onChange={(e) => maxPriceField.setValue(e.target.value)}
                className="h-10 w-32"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Sort by</label>
              <select
                value={sortBy}
                onChange={(e) => update({ sortBy: e.target.value })}
                className="h-10 appearance-none rounded-xl border border-slate-300 bg-white px-3 pr-8 text-sm text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              >
                <option value="">Default</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
                <option value="newest">Newest First</option>
                <option value="rating">Highest Rated</option>
              </select>
            </div>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => update({ minPrice: "", maxPrice: "", sortBy: "" })}
              >
                Clear
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : products.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <SearchX className="h-12 w-12 text-slate-300" />
            <p className="text-lg font-medium text-slate-700">No products found</p>
            <p className="text-sm text-slate-500">Try adjusting your filters or select a different place</p>
          </CardContent>
        </Card>
      ) : (
        /* Products grouped by state */
        <div className="space-y-8">
          {Array.from(productsByState.entries()).map(([state, prods]) => {
            const { flag, color } = getStateMeta(state);
            const isExpanded = expandedStates.has(state);
            const sampleProducts = prods.slice(0, 3).map((p: any) => p.name);

            return (
              <Card key={state} className="overflow-hidden border-0 shadow-md">
                {/* State header */}
                <button
                  onClick={() => toggleState(state)}
                  className="flex w-full items-center gap-4 bg-gradient-to-r from-emerald-50 to-white p-5 text-left transition hover:from-emerald-100"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl shadow-sm"
                    style={{ backgroundColor: `${color}15` }}
                  >
                    {flag}
                  </span>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg font-bold text-slate-900">{state}</h2>
                    <p className="text-sm text-slate-500">
                      {prods.length} product{prods.length !== 1 && "s"}
                      {sampleProducts.length > 0 && (
                        <span className="ml-2 text-xs text-slate-400">
                          · {sampleProducts.join(", ")}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="shrink-0">
                    {isExpanded ? (
                      <Minus className="h-5 w-5 text-emerald-600" />
                    ) : (
                      <Plus className="h-5 w-5 text-emerald-600" />
                    )}
                  </div>
                </button>

                {/* Products grid */}
                {isExpanded && (
                  <CardContent className="grid gap-5 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {prods.map((product: any) => (
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
                              <Badge variant="success" className="absolute left-3 top-3">Organic</Badge>
                            )}
                          </div>
                        </Link>
                        <CardContent className="space-y-3 p-4">
                          <Link href={`/product/${product.id}`}>
                            <h3 className="truncate text-sm font-semibold text-slate-900 group-hover:text-emerald-600">
                              {product.name}
                            </h3>
                          </Link>
                          <p className="text-xs text-slate-500">{product.farmerName}</p>
                          <div className="flex flex-wrap gap-1.5">
                            <Badge variant="outline" className="text-xs">
                              <MapPin className="mr-1 h-3 w-3" />
                              {[product.city, product.district, product.state].filter(Boolean).join(", ") || product.state}
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              {product.category}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-1 text-xs text-slate-500">
                            <Truck className="h-3 w-3" />
                            {product.shipping} · {product.shippingDays} days
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-lg font-bold text-emerald-700">
                              {formatPrice(product.price)}
                              <span className="ml-0.5 text-xs font-normal text-slate-400">/{product.unit}</span>
                            </span>
                            <div className="flex items-center gap-1 text-xs">
                              <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                              <span className="font-medium text-slate-600">{product.rating.toFixed(1)}</span>
                            </div>
                          </div>
                          <Button
                            className="w-full rounded-full"
                            size="sm"
                            onClick={() => handleAddToCart(product)}
                          >
                            <ShoppingCart className="mr-2 h-4 w-4" />
                            Buy Now
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Harvest sections */}
      <HarvestSections
        country={place.country}
        state={place.state}
        district={place.district}
        city={place.city}
      />
    </div>
  );
}

export default function NationalMarketplacePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      }
    >
      <NationalMarketplaceInner />
    </Suspense>
  );
}
