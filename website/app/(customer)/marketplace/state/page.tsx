"use client";

import { Suspense, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  ChevronDown,
  Star,
  ShoppingCart,
  MapPin,
  Loader2,
  SearchX,
} from "lucide-react";
import { api } from "../../../lib/api/client";
import { formatPrice } from "../../../lib/utils";
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

function StateMarketplaceInner() {
  const { params, update } = usePageParams();
  const addItem = useCartStore((s: any) => s.addItem);

  const place: PlaceSelection = {
    country: params.country || "",
    state: params.state || "",
    district: params.district || "",
    city: params.city || "",
  };
  const selectedState = place.state;
  const selectedDistrict = place.district;
  const selectedCity = place.city;
  const selectedCategory = params.category || "";
  const sortBy = params.sortBy || "";

  const searchField = useParamField("search", 400);

  const { data: categoriesData } = useQuery({
    queryKey: ["products", "categories"],
    queryFn: () => api.get("/products/categories"),
  });

  const categories = useMemo(() => {
    const raw = categoriesData?.data?.categories || categoriesData?.categories || [];
    return raw.map((c: any) => (typeof c === "string" ? c : c.name || ""));
  }, [categoriesData]);

  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: ["marketplace", "state", place.country, selectedState, selectedDistrict, selectedCity, selectedCategory, sortBy, params.search || ""],
    queryFn: () =>
      api.get("/marketplace/state", {
        params: {
          country: place.country || undefined,
          state: selectedState,
          district: selectedDistrict || undefined,
          city: selectedCity || undefined,
          category: selectedCategory || undefined,
          sortBy: sortBy || undefined,
          search: params.search || undefined,
        },
      }),
    enabled: !!selectedState,
  });

  const products = useMemo(() => {
    const list = productsData?.data?.products || productsData?.products || [];
    return list.map((p: any) => ({
      id: p._id || p.id,
      name: p.name || "Unknown Product",
      farmerName: p.farmerName || "Local Farmer",
      district: p.district || selectedDistrict || "Unknown",
      city: p.city || "",
      state: p.state || selectedState || "",
      category: p.category || "General",
      price: p.price,
      unit: p.unit || "kg",
      image: p.images?.[0] || p.image || "/images/placeholder-product.jpg",
      rating: p.ratings?.average || p.rating || 0,
      reviewCount: p.ratings?.count || p.reviewCount || 0,
      isOrganic: p.isOrganic || false,
      pickupAvailable: p.pickupAvailable ?? false,
      farmAddress: p.farmAddress || "",
      createdAt: p.createdAt || p.created_at,
    }));
  }, [productsData, selectedDistrict, selectedState]);

  const isLoading = productsLoading;

  const handlePlaceChange = (value: PlaceSelection) => {
    update({ country: value.country, state: value.state, district: value.district, city: value.city });
  };

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

  return (
    <div className="space-y-8 p-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-slate-900">State Marketplace</h1>
        <p className="text-slate-500">
          Browse fresh produce from your state, district or city
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <Building2 className="h-5 w-5 text-emerald-600" />
            Select your place
          </div>
          <PlaceSelector value={place} onChange={handlePlaceChange} includeAll={false} />
          <p className="text-xs text-slate-400">
            {selectedState ? (
              <>
                Showing products in{" "}
                <span className="font-semibold text-emerald-700">
                  {[selectedCity, selectedDistrict, selectedState].filter(Boolean).join(", ")}
                </span>
              </>
            ) : (
              "Select a state to start browsing."
            )}
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-72">
          <Input
            placeholder="Search products or farmers..."
            value={searchField.value}
            onChange={(e) => searchField.setValue(e.target.value)}
            className="pl-10"
          />
          <svg
            className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </div>
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
          <select
            value={sortBy}
            onChange={(e) => update({ sortBy: e.target.value })}
            className="h-10 appearance-none rounded-xl border border-slate-300 bg-white px-3 pr-8 text-sm text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          >
            <option value="">Sort by</option>
            <option value="price-asc">Price: Low to High</option>
            <option value="price-desc">Price: High to Low</option>
            <option value="newest">Newest First</option>
            <option value="rating">Highest Rated</option>
          </select>
        </div>
      </div>

      {!selectedState ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <Building2 className="h-12 w-12 text-slate-300" />
            <p className="text-lg font-medium text-slate-700">Select a state to get started</p>
            <p className="text-sm text-slate-500">Pick a state, district and city to see all products available there.</p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : products.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <SearchX className="h-12 w-12 text-slate-300" />
            <p className="text-lg font-medium text-slate-700">No products found</p>
            <p className="text-sm text-slate-500">
              {params.search
                ? "Try a different search term"
                : "No products available in this place yet"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {products.map((product: any) => (
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
                </div>
              </Link>
              <CardContent className="space-y-3 p-4">
                <Link href={`/product/${product.id}`}>
                  <h3 className="truncate text-sm font-semibold text-slate-900 group-hover:text-emerald-600">
                    {product.name}
                  </h3>
                </Link>
                <div className="flex items-center gap-1 text-xs text-slate-500">
                  <MapPin className="h-3 w-3" />
                  {[product.city, product.district, product.state].filter(Boolean).join(", ") || "Unknown"}
                </div>
                <p className="text-xs text-slate-500">{product.farmerName}</p>
                <Badge variant="secondary" className="w-fit text-xs">
                  {product.category}
                </Badge>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold text-emerald-700">
                    {formatPrice(product.price)}
                    <span className="ml-0.5 text-xs font-normal text-slate-400">
                      /{product.unit}
                    </span>
                  </span>
                  <div className="flex items-center gap-1 text-xs">
                    <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                    <span className="font-medium text-slate-600">
                      {product.rating.toFixed(1)}
                    </span>
                  </div>
                </div>
                <Button
                  className="w-full rounded-full"
                  size="sm"
                  onClick={() => handleAddToCart(product)}
                >
                  <ShoppingCart className="mr-2 h-4 w-4" />
                  Add to Cart
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedState && (
        <HarvestSections
          country={place.country}
          state={selectedState}
          district={selectedDistrict}
          city={selectedCity}
        />
      )}
    </div>
  );
}

export default function StateMarketplacePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      }
    >
      <StateMarketplaceInner />
    </Suspense>
  );
}
