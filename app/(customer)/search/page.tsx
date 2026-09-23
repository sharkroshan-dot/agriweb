"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  SlidersHorizontal,
  ShoppingCart,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { api } from "../../lib/api/client";
import { formatPrice, cn } from "../../lib/utils";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useCartStore } from "../../lib/store/cart-store";
import { usePageParams } from "../../lib/hooks/use-page-params";
import { usePersistentQuery } from "../../lib/hooks/use-persistent-query";
import { useSessionStateStore } from "../../lib/store/session-state-store";
import toast from "react-hot-toast";

const PER_PAGE = 12;
const SEARCH_DRAFT_KEY = "/search";

function SearchPageInner() {
  const { params, update } = usePageParams();

  const q = params.q || "";
  const selectedCategory = params.category || "";
  const priceMin = params.priceMin || "";
  const priceMax = params.priceMax || "";
  const organicOnly = params.organic === "true";
  const selectedFarmer = params.farmer || "";
  const sortBy = params.sortBy || "";
  const pageParam = Math.max(1, Number(params.page) || 1);

  const [searchValue, setSearchValue] = useState(
    () => q || useSessionStateStore.getState().getDraft(SEARCH_DRAFT_KEY) || "",
  );
  const [showFilters, setShowFilters] = useState(false);

  // Restore the search term from the URL whenever it changes (back/forward, new search).
  // Falls back to the last typed-but-unsubmitted draft when the URL has no query.
  useEffect(() => {
    const draft = useSessionStateStore.getState().getDraft(SEARCH_DRAFT_KEY);
    setSearchValue(q || draft || "");
  }, [q]);

  const handleSearchValueChange = (value: string) => {
    setSearchValue(value);
    useSessionStateStore.getState().setDraft(SEARCH_DRAFT_KEY, value);
  };

  // Filter changes reset pagination; the URL stays the source of truth for
  // category/price/organic/sort so Back/Forward restores them automatically.
  const setFilter = useCallback(
    (patch: Record<string, string>) => update(patch, { reset: ["page"] }),
    [update],
  );

  const addItem = useCartStore((s) => s.addItem);

  const { data: productsData, isLoading } = usePersistentQuery({
    queryKey: ["customerProducts", "search", q || "all"],
    queryFn: () => api.get("/products/search", {
      params: q ? { query: q, limit: 100 } : { limit: 100, sortBy: "createdAt", sortOrder: "desc" },
    }),
  });

  const rawProducts = useMemo(() => {
    const list = productsData?.data?.products || productsData?.products || [];
    return list.map((p: any) => ({
      id: p._id || p.id,
      name: p.name || "Unknown",
      farmerName: p.farmerName || "Local Farmer",
      category: p.category || "General",
      price: p.price,
      unit: p.unit || "kg",
      image:
        p.images?.[0] ||
        p.image ||
        "/images/placeholder-product.jpg",
      rating: p.ratings?.average || p.rating || 0,
      isOrganic: p.isOrganic || p.tags?.includes?.("organic") || false,
      createdAt: p.createdAt || p.created_at,
      pickupAvailable: p.pickupAvailable ?? false,
      farmAddress: p.farmAddress || "",
    }));
  }, [productsData]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    rawProducts.forEach((p: any) => cats.add(p.category));
    return Array.from(cats).sort();
  }, [rawProducts]);

  const farmers = useMemo(() => {
    const set = new Set<string>();
    rawProducts.forEach((p: any) => set.add(p.farmerName));
    return Array.from(set).sort();
  }, [rawProducts]);

  // The home page links to /search?category=organic — treat that as the
  // organic-only toggle rather than a literal product category.
  const effectiveOrganic = organicOnly || selectedCategory.toLowerCase() === "organic";
  const effectiveCategory =
    selectedCategory.toLowerCase() === "organic" ? "" : selectedCategory;

  const filteredProducts = useMemo(() => {
    let result = [...rawProducts];

    if (effectiveCategory) {
      result = result.filter(
        (p: any) => p.category.toLowerCase() === effectiveCategory.toLowerCase()
      );
    }

    if (selectedFarmer) {
      result = result.filter(
        (p: any) => p.farmerName.toLowerCase() === selectedFarmer.toLowerCase()
      );
    }

    if (priceMin) {
      const min = Number(priceMin);
      if (!isNaN(min)) result = result.filter((p: any) => p.price >= min);
    }
    if (priceMax) {
      const max = Number(priceMax);
      if (!isNaN(max)) result = result.filter((p: any) => p.price <= max);
    }

    if (effectiveOrganic) {
      result = result.filter((p: any) => p.isOrganic);
    }

    if (sortBy === "price-asc") {
      result.sort((a: any, b: any) => a.price - b.price);
    } else if (sortBy === "price-desc") {
      result.sort((a: any, b: any) => b.price - a.price);
    } else if (sortBy === "newest") {
      result.sort(
        (a: any, b: any) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    } else if (sortBy === "rating") {
      result.sort((a: any, b: any) => b.rating - a.rating);
    }

    return result;
  }, [rawProducts, effectiveCategory, effectiveOrganic, selectedFarmer, priceMin, priceMax, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PER_PAGE));
  const currentPage = Math.min(pageParam, totalPages);
  const pagedProducts = useMemo(
    () => filteredProducts.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE),
    [filteredProducts, currentPage],
  );

  const goToPage = useCallback(
    (page: number) => {
      const target = Math.min(Math.max(1, page), totalPages);
      update({ page: String(target) }, {});
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [update, totalPages],
  );

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = searchValue.trim();
      if (trimmed) {
        useSessionStateStore.getState().setDraft(SEARCH_DRAFT_KEY, trimmed);
        update({ q: trimmed }, { push: true, reset: ["page"] });
      }
    },
    [searchValue, update],
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
      pickupAvailable: product.pickupAvailable ?? false,
      farmAddress: product.farmAddress || "",
    });
    toast.success(`${product.name} added to cart!`);
  };

  const clearFilters = () => {
    setFilter({ category: "", priceMin: "", priceMax: "", organic: "", sortBy: "", farmer: "" });
  };

  const hasActiveFilters =
    selectedCategory || priceMin || priceMax || organicOnly || sortBy || selectedFarmer;

  const ProductSkeleton = () => (
    <div className="animate-pulse">
      <Card>
        <div className="aspect-square rounded-t-2xl bg-slate-200" />
        <CardContent className="space-y-3 p-4">
          <div className="h-4 w-3/4 rounded bg-slate-200" />
          <div className="h-3 w-1/2 rounded bg-slate-200" />
          <div className="flex items-center justify-between">
            <div className="h-5 w-20 rounded bg-slate-200" />
            <div className="h-3 w-12 rounded bg-slate-200" />
          </div>
          <div className="h-9 w-full rounded-full bg-slate-200" />
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="space-y-6 p-6">
      {/* Search header */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Search</h1>
        <p className="mt-1 text-sm text-slate-500">
          Find fresh produce from local farmers
        </p>
      </div>

      {/* Search input */}
      <form onSubmit={handleSearch} className="relative">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <Input
          placeholder="Search products..."
          value={searchValue}
          onChange={(e) => handleSearchValueChange(e.target.value)}
          className="h-12 pl-12 pr-24 text-base"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {searchValue && (
            <button
              type="button"
              onClick={() => handleSearchValueChange("")}
              className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <Button type="submit" size="sm" className="rounded-full px-5">
            Search
          </Button>
        </div>
      </form>

      {/* Mobile filter toggle */}
      <div className="flex items-center justify-between lg:hidden">
        <p className="text-sm text-slate-500">
          {filteredProducts.length} result{filteredProducts.length !== 1 && "s"}
          {q && (
            <>
              {" "}
              for "<span className="font-medium">{q}</span>"
            </>
          )}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowFilters(!showFilters)}
          className="rounded-full"
        >
          <SlidersHorizontal className="mr-2 h-4 w-4" />
          Filters
          {hasActiveFilters && (
            <span className="ml-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[10px] text-white">
              {1}
            </span>
          )}
        </Button>
      </div>

      {/* Mobile filters */}
      {showFilters && (
        <MobileFilters
          categories={categories}
          selectedCategory={selectedCategory}
          onCategoryChange={(v) => setFilter({ category: v })}
          priceMin={priceMin}
          priceMax={priceMax}
          onPriceMinChange={(v) => setFilter({ priceMin: v })}
          onPriceMaxChange={(v) => setFilter({ priceMax: v })}
          organicOnly={organicOnly}
          onOrganicChange={(v) => setFilter({ organic: v ? "true" : "" })}
          farmers={farmers}
          selectedFarmer={selectedFarmer}
          onFarmerChange={(v) => setFilter({ farmer: v })}
          sortBy={sortBy}
          onSortChange={(v) => setFilter({ sortBy: v })}
          onClear={clearFilters}
          hasFilters={!!hasActiveFilters}
        />
      )}

      <div className="flex gap-8">
        {/* Desktop sidebar */}
        <aside className="hidden w-64 shrink-0 lg:block">
          <DesktopSidebar
            categories={categories}
            selectedCategory={selectedCategory}
            onCategoryChange={(v) => setFilter({ category: v })}
            priceMin={priceMin}
            priceMax={priceMax}
            onPriceMinChange={(v) => setFilter({ priceMin: v })}
            onPriceMaxChange={(v) => setFilter({ priceMax: v })}
            organicOnly={organicOnly}
            onOrganicChange={(v) => setFilter({ organic: v ? "true" : "" })}
            farmers={farmers}
            selectedFarmer={selectedFarmer}
            onFarmerChange={(v) => setFilter({ farmer: v })}
            sortBy={sortBy}
            onSortChange={(v) => setFilter({ sortBy: v })}
            onClear={clearFilters}
            hasFilters={!!hasActiveFilters}
          />
        </aside>

        {/* Results */}
        <main className="flex-1">
          {/* Desktop result count */}
          <div className="mb-4 hidden items-center justify-between lg:flex">
            <p className="text-sm text-slate-500">
              {isLoading
                ? "Searching..."
                : `${filteredProducts.length} result${
                    filteredProducts.length !== 1 ? "s" : ""
                  }`}
              {q && (
                <>
                  {" "}
                  for "
                  <span className="font-medium text-slate-700">
                    {q}
                  </span>
                  "
                </>
              )}
            </p>
          </div>

          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <ProductSkeleton key={i} />
              ))}
            </div>
          ) : !q && !hasActiveFilters ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
                <Search className="h-12 w-12 text-slate-300" />
                <div>
                  <p className="text-lg font-medium text-slate-700">
                    What are you looking for?
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Type a product name to start searching
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : filteredProducts.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
                <Search className="h-12 w-12 text-slate-300" />
                <div>
                  <p className="text-lg font-medium text-slate-700">
                    No results found
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    We couldn&apos;t find any products matching &quot;
                    {q}&quot;
                  </p>
                  {hasActiveFilters && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearFilters}
                      className="mt-4 rounded-full"
                    >
                      Clear all filters
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {pagedProducts.map((product: any) => (
                  <Link
                    key={product.id}
                    href={`/product/${product.id}`}
                    className="group"
                  >
                    <Card className="overflow-hidden border-slate-200 transition-all hover:border-emerald-300 hover:shadow-sm">
                      <div className="relative aspect-[4/3] overflow-hidden bg-slate-50">
                        <Image
                          src={product.image}
                          alt={product.name}
                          fill
                          className="object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                        {product.isOrganic && (
                          <span className="absolute left-2 top-2 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                            Organic
                          </span>
                        )}
                      </div>
                      <CardContent className="p-3">
                        <h3 className="truncate text-sm font-medium text-slate-900">
                          {product.name}
                        </h3>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {product.farmerName}
                        </p>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-sm font-semibold text-emerald-600">
                            {formatPrice(product.price)}
                            <span className="ml-0.5 text-xs font-normal text-slate-400">
                              /{product.unit}
                            </span>
                          </span>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleAddToCart(product);
                            }}
                            className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-emerald-700"
                          >
                            <ShoppingCart className="h-3 w-3" />
                            Add
                          </button>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-8 flex items-center justify-center gap-3">
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
          )}
        </main>
      </div>
    </div>
  );
}

function DesktopSidebar({
  categories,
  selectedCategory,
  onCategoryChange,
  priceMin,
  priceMax,
  onPriceMinChange,
  onPriceMaxChange,
  organicOnly,
  onOrganicChange,
  farmers,
  selectedFarmer,
  onFarmerChange,
  sortBy,
  onSortChange,
  onClear,
  hasFilters,
}: {
  categories: string[];
  selectedCategory: string;
  onCategoryChange: (v: string) => void;
  priceMin: string;
  priceMax: string;
  onPriceMinChange: (v: string) => void;
  onPriceMaxChange: (v: string) => void;
  organicOnly: boolean;
  onOrganicChange: (v: boolean) => void;
  farmers: string[];
  selectedFarmer: string;
  onFarmerChange: (v: string) => void;
  sortBy: string;
  onSortChange: (v: string) => void;
  onClear: () => void;
  hasFilters: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Filters</h2>
        {hasFilters && (
          <button
            onClick={onClear}
            className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Sort */}
      <div>
        <label className="mb-2 block text-xs font-medium text-slate-700">
          Sort by
        </label>
        <div className="relative">
          <select
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value)}
            className="h-10 w-full appearance-none rounded-xl border border-slate-300 bg-white px-3 pr-8 text-sm text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          >
            <option value="">Relevance</option>
            <option value="price-asc">Price: Low to High</option>
            <option value="price-desc">Price: High to Low</option>
            <option value="newest">Newest First</option>
            <option value="rating">Highest Rated</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </div>
      </div>

      {/* Category */}
      <div>
        <label className="mb-2 block text-xs font-medium text-slate-700">
          Category
        </label>
        <div className="space-y-2">
          <button
            onClick={() => onCategoryChange("")}
            className={cn(
              "w-full rounded-lg px-3 py-2 text-left text-sm transition",
              !selectedCategory
                ? "bg-emerald-50 font-medium text-emerald-700"
                : "text-slate-600 hover:bg-slate-100"
            )}
          >
            All Categories
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => onCategoryChange(cat)}
              className={cn(
                "w-full rounded-lg px-3 py-2 text-left text-sm transition",
                selectedCategory === cat
                  ? "bg-emerald-50 font-medium text-emerald-700"
                  : "text-slate-600 hover:bg-slate-100"
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Farmer */}
      {farmers.length > 0 && (
        <div>
          <label className="mb-2 block text-xs font-medium text-slate-700">
            Farmer
          </label>
          <div className="relative">
            <select
              value={selectedFarmer}
              onChange={(e) => onFarmerChange(e.target.value)}
              className="h-10 w-full appearance-none rounded-xl border border-slate-300 bg-white px-3 pr-8 text-sm text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
            >
              <option value="">All Farmers</option>
              {farmers.map((farmer) => (
                <option key={farmer} value={farmer}>
                  {farmer}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          </div>
        </div>
      )}

      {/* Price range */}
      <div>
        <label className="mb-2 block text-xs font-medium text-slate-700">
          Price range
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            placeholder="Min"
            value={priceMin}
            onChange={(e) => onPriceMinChange(e.target.value)}
            className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          />
          <span className="text-slate-400">—</span>
          <input
            type="number"
            placeholder="Max"
            value={priceMax}
            onChange={(e) => onPriceMaxChange(e.target.value)}
            className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>
      </div>

      {/* Organic toggle */}
      <div>
        <label className="flex cursor-pointer items-center gap-3">
          <button
            type="button"
            role="checkbox"
            aria-checked={organicOnly}
            onClick={() => onOrganicChange(!organicOnly)}
            className={cn(
              "flex h-6 w-10 shrink-0 items-center rounded-full transition-colors",
              organicOnly ? "bg-emerald-600" : "bg-slate-300"
            )}
          >
            <span
              className={cn(
                "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                organicOnly ? "translate-x-5" : "translate-x-1"
              )}
            />
          </button>
          <span className="text-sm text-slate-700">Organic only</span>
        </label>
      </div>
    </div>
  );
}

function MobileFilters({
  categories,
  selectedCategory,
  onCategoryChange,
  priceMin,
  priceMax,
  onPriceMinChange,
  onPriceMaxChange,
  organicOnly,
  onOrganicChange,
  farmers,
  selectedFarmer,
  onFarmerChange,
  sortBy,
  onSortChange,
  onClear,
  hasFilters,
}: {
  categories: string[];
  selectedCategory: string;
  onCategoryChange: (v: string) => void;
  priceMin: string;
  priceMax: string;
  onPriceMinChange: (v: string) => void;
  onPriceMaxChange: (v: string) => void;
  organicOnly: boolean;
  onOrganicChange: (v: boolean) => void;
  farmers: string[];
  selectedFarmer: string;
  onFarmerChange: (v: string) => void;
  sortBy: string;
  onSortChange: (v: string) => void;
  onClear: () => void;
  hasFilters: boolean;
}) {
  return (
    <Card className="lg:hidden">
      <CardContent className="space-y-5 p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-900">Filters</span>
          {hasFilters && (
            <button
              onClick={onClear}
              className="text-xs font-medium text-emerald-600"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Sort */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-700">
            Sort by
          </label>
          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value)}
              className="h-10 w-full appearance-none rounded-xl border border-slate-300 bg-white px-3 pr-8 text-sm text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
            >
              <option value="">Relevance</option>
              <option value="price-asc">Price: Low to High</option>
              <option value="price-desc">Price: High to Low</option>
              <option value="newest">Newest First</option>
              <option value="rating">Highest Rated</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          </div>
        </div>

        {/* Category */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-700">
            Category
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onCategoryChange("")}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition",
                !selectedCategory
                  ? "bg-emerald-600 text-white"
                  : "border border-slate-300 text-slate-600 hover:bg-slate-100"
              )}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => onCategoryChange(cat)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition",
                  selectedCategory === cat
                    ? "bg-emerald-600 text-white"
                    : "border border-slate-300 text-slate-600 hover:bg-slate-100"
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Farmer */}
        {farmers.length > 0 && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">
              Farmer
            </label>
            <div className="relative">
              <select
                value={selectedFarmer}
                onChange={(e) => onFarmerChange(e.target.value)}
                className="h-10 w-full appearance-none rounded-xl border border-slate-300 bg-white px-3 pr-8 text-sm text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              >
                <option value="">All Farmers</option>
                {farmers.map((farmer) => (
                  <option key={farmer} value={farmer}>
                    {farmer}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          </div>
        )}

        {/* Price range */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-700">
            Price range
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              placeholder="Min"
              value={priceMin}
              onChange={(e) => onPriceMinChange(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
            />
            <span className="text-slate-400">—</span>
            <input
              type="number"
              placeholder="Max"
              value={priceMax}
              onChange={(e) => onPriceMaxChange(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
        </div>

        {/* Organic toggle */}
        <div>
          <label className="flex cursor-pointer items-center gap-3">
            <button
              type="button"
              role="checkbox"
              aria-checked={organicOnly}
              onClick={() => onOrganicChange(!organicOnly)}
              className={cn(
                "flex h-6 w-10 shrink-0 items-center rounded-full transition-colors",
                organicOnly ? "bg-emerald-600" : "bg-slate-300"
              )}
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                  organicOnly ? "translate-x-5" : "translate-x-1"
                )}
              />
            </button>
            <span className="text-sm text-slate-700">Organic only</span>
          </label>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6 p-6">
          <div className="h-8 w-24 animate-pulse rounded bg-slate-200" />
          <div className="h-4 w-64 animate-pulse rounded bg-slate-200" />
          <div className="h-12 animate-pulse rounded-full bg-slate-200" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="aspect-square rounded-t-2xl bg-slate-200" />
                <div className="space-y-3 p-4">
                  <div className="h-4 w-3/4 rounded bg-slate-200" />
                  <div className="h-3 w-1/2 rounded bg-slate-200" />
                  <div className="h-5 w-20 rounded bg-slate-200" />
                  <div className="h-9 rounded-full bg-slate-200" />
                </div>
              </div>
            ))}
          </div>
        </div>
      }
    >
      <SearchPageInner />
    </Suspense>
  );
}
