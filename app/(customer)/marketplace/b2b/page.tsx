"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Building2, Search, Filter, ChevronDown, ChevronUp, Package, Truck, Leaf, CheckCircle, ArrowRight, Loader2, Star, Eye, RotateCcw, LayoutGrid, List, MapPin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Input } from "../../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { formatPrice } from "../../../lib/utils";
import { api } from "../../../lib/api/client";

const B2B_CATEGORIES = [
  { id: "vegetables", name: "Vegetables", icon: Leaf, description: "Fresh seasonal vegetables in bulk" },
  { id: "fruits", name: "Fruits", icon: Package, description: "Premium fruits for retail & processing" },
  { id: "grains", name: "Grains & Cereals", icon: Building2, description: "Wheat, rice, millets & pulses" },
  { id: "dairy", name: "Dairy Products", icon: Truck, description: "Milk, paneer, ghee, butter & cheese" },
  { id: "spices", name: "Spices & Herbs", icon: Leaf, description: "Whole & ground spices, dried herbs" },
  { id: "organic", name: "Organic Produce", icon: CheckCircle, description: "Certified organic vegetables & fruits" },
  { id: "processed", name: "Processed Foods", icon: Package, description: "Pickles, jams, sauces & ready-to-cook" },
  { id: "specialty", name: "Specialty Items", icon: Star, description: "Exotic produce, microgreens, edible flowers" },
];

const BUYER_TYPES = [
  { value: "all", label: "All Buyers" },
  { value: "restaurant", label: "Restaurants & Cafes" },
  { value: "hotel", label: "Hotels & Resorts" },
  { value: "catering", label: "Catering Services" },
  { value: "retail", label: "Retail Chains" },
  { value: "institutional", label: "Institutional (Schools, Hospitals)" },
  { value: "export", label: "Export Houses" },
];

const QUANTITY_RANGES = [
  { value: "all", label: "Any Quantity" },
  { value: "small", label: "10-100 kg" },
  { value: "medium", label: "100-500 kg" },
  { value: "large", label: "500kg - 1 ton" },
  { value: "bulk", label: "1+ tons" },
];

const SORT_OPTIONS = [
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
  { value: "quantity_desc", label: "Quantity: High to Low" },
  { value: "distance_asc", label: "Nearest First" },
  { value: "rating_desc", label: "Highest Rated" },
  { value: "createdAt_desc", label: "Newest First" },
];

export default function B2BMarketplacePage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [buyerType, setBuyerType] = useState<string>("all");
  const [quantityRange, setQuantityRange] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("createdAt_desc");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const { data: productsData, isLoading, refetch } = useQuery({
    queryKey: ["b2bProducts", searchQuery, selectedCategory, buyerType, quantityRange, sortBy, sortOrder],
    queryFn: () =>
      api.get("/products/search", {
        params: {
          limit: 20,
          sortBy: sortBy.replace("_desc", "").replace("_asc", ""),
          sortOrder: sortBy.includes("_desc") ? "desc" : "asc",
          ...(searchQuery && { q: searchQuery }),
          ...(selectedCategory !== "all" && { category: selectedCategory }),
          ...(buyerType !== "all" && { buyerType }),
          ...(quantityRange !== "all" && { minQuantity: quantityRange === "small" ? 10 : quantityRange === "medium" ? 100 : quantityRange === "large" ? 500 : 1000 }),
        },
      }),
  });

  const products = useMemo(() => {
    const list = productsData?.data?.products || productsData?.products || [];
    return list.map((p: any) => ({
      id: p._id || p.id,
      name: p.name || "Unknown Product",
      farmerName: p.farmerName || "Local Farmer",
      category: p.category || "General",
      price: p.price,
      originalPrice: p.originalPrice || p.mrp,
      unit: p.unit || "kg",
      minOrderQty: p.minOrderQty || 50,
      availableQty: p.availableQty || p.quantity || 100,
      image: p.images?.[0] || "/images/placeholder-product.jpg",
      rating: p.ratings?.average || 4.5,
      reviews: p.ratings?.count || 0,
      isOrganic: p.isOrganic || false,
      isVerified: p.verificationStatus === "verified",
      location: p.farmerLocation || p.location,
      distanceKm: p.distanceKm,
      deliveryOptions: p.deliveryOptions || ["farmer_delivery", "pickup"],
    }));
  }, [productsData]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
  };

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedCategory("all");
    setBuyerType("all");
    setQuantityRange("all");
    setSortBy("createdAt_desc");
  };

  const hasActiveFilters = selectedCategory !== "all" || buyerType !== "all" || quantityRange !== "all";

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">B2B Procurement</h1>
            <p className="text-base text-slate-500">Bulk sourcing for restaurants, hotels & businesses</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setShowFilters(!showFilters)} className="gap-2">
              <Filter className="h-4 w-4" />
              Filters {hasActiveFilters && (
                <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">
                  {Number(selectedCategory !== "all") + Number(buyerType !== "all") + Number(quantityRange !== "all")}
                </Badge>
              )}
            </Button>
            <Button variant="ghost" size="icon" onClick={clearFilters} disabled={!hasActiveFilters}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSearch} className="relative">
          <div className="relative flex items-center overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm focus-within:ring-2 focus-within:ring-emerald-500/20">
            <div className="flex items-center gap-2 pl-5 pr-3">
              <Search className="h-5 w-5 text-slate-400" />
              <span className="h-5 w-px bg-slate-200" />
            </div>
            <Input
              type="text"
              placeholder="Search products, farmers, categories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-12 border-0 bg-transparent pl-0 text-base text-slate-900 placeholder:text-slate-400 focus:ring-0 focus:outline-none"
            />
            <div className="pr-2">
              <Button type="submit" size="default" className="h-10 rounded-r-xl px-5">
                Search
              </Button>
            </div>
          </div>
        </form>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <Card className="bg-emerald-50/40 border-emerald-200">
          <CardContent className="p-4 pt-0">
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Category</label>
                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {B2B_CATEGORIES.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Buyer Type</label>
                <Select value={buyerType} onValueChange={setBuyerType}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent>
                    {BUYER_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Min Quantity</label>
                <Select value={quantityRange} onValueChange={setQuantityRange}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Any Quantity" />
                  </SelectTrigger>
                  <SelectContent>
                    {QUANTITY_RANGES.map((range) => (
                      <SelectItem key={range.value} value={range.value}>{range.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Sort By</label>
                <Select value={sortBy} onValueChange={(v) => setSortBy(v)}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SORT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Category Quick Select */}
      <Card className="border-0 bg-white/60 shadow-sm">
        <CardContent className="p-4 pt-0">
          <div className="flex flex-wrap gap-2">
            <button
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
                selectedCategory === "all"
                  ? "bg-emerald-600 text-white"
                  : "bg-white text-slate-600 hover:bg-emerald-50 border border-slate-200"
              }`}
              onClick={() => setSelectedCategory("all")}
            >
              All Categories
            </button>
            {B2B_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition flex items-center gap-1.5 ${
                  selectedCategory === cat.id
                    ? "bg-emerald-600 text-white"
                    : "bg-white text-slate-600 hover:bg-emerald-50 border border-slate-200"
                }`}
                onClick={() => setSelectedCategory(cat.id)}
              >
                <cat.icon className="h-3.5 w-3.5" />
                {cat.name}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Products List */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            {products.length} product{products.length !== 1 ? "s" : ""} found
            {searchQuery && <span className="font-medium text-slate-900"> for "{searchQuery}"</span>}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant={viewMode === "grid" ? "default" : "outline"}
              size="icon"
              onClick={() => setViewMode("grid")}
              aria-label="Grid view"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "outline"}
              size="icon"
              onClick={() => setViewMode("list")}
              aria-label="List view"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i} className="animate-pulse overflow-hidden">
                <div className="aspect-[4/3] bg-slate-200" />
                <CardContent className="space-y-3 p-4">
                  <div className="h-4 w-2/3 rounded bg-slate-200" />
                  <div className="h-3 w-1/2 rounded bg-slate-200" />
                  <div className="h-5 w-1/3 rounded bg-slate-200" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : products.length === 0 ? (
          <Card className="p-12 text-center">
            <Package className="mx-auto h-12 w-12 text-slate-300" />
            <h3 className="mt-4 text-lg font-semibold text-slate-900">No products found</h3>
            <p className="mt-2 text-sm text-slate-500">
              Try adjusting your search or filters to find what you need.
            </p>
            <Button variant="outline" onClick={clearFilters} className="mt-4">
              <RotateCcw className="mr-2 h-4 w-4" />
              Clear All Filters
            </Button>
          </Card>
        ) : viewMode === "grid" ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {products.map((product) => (
              <Link key={product.id} href={`/product/${product.id}`} className="group">
                <Card className="h-full overflow-hidden border-slate-200 transition-all hover:border-emerald-300 hover:shadow-lg">
                  <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
                    <img
                      src={product.image}
                      alt={product.name}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      onError={(e) => { (e.target as HTMLImageElement).src = "/images/placeholder-product.jpg"; }}
                    />
                    <div className="absolute top-2 left-2 flex flex-wrap gap-1">
                      {product.isOrganic && (
                        <Badge className="bg-emerald-600 text-white text-xs">Organic</Badge>
                      )}
                      {product.isVerified && (
                        <Badge className="bg-blue-600 text-white text-xs">Verified</Badge>
                      )}
                      <Badge variant="secondary" className="bg-indigo-100 text-indigo-700 text-xs">
                        B2B
                      </Badge>
                    </div>
                    <div className="absolute top-2 right-2">
                      <Button variant="ghost" size="icon" className="bg-white/80 rounded-full">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-1 text-xs text-slate-400 mb-1">
                      <Package className="h-3 w-3" />
                      <span>{product.category}</span>
                    </div>
                    <h3 className="truncate text-sm font-semibold text-slate-900 group-hover:text-emerald-600">{product.name}</h3>
                    <p className="mt-0.5 text-xs text-slate-500 truncate">{product.farmerName}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-baseline gap-1">
                        <span className="text-lg font-bold text-emerald-700">{formatPrice(product.price)}</span>
                        <span className="text-xs text-slate-400">/{product.unit}</span>
                      </div>
                      <Badge variant="outline" className="text-xs border-emerald-200 text-emerald-700">
                        Min: {product.minOrderQty} {product.unit}
                      </Badge>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                        {product.rating.toFixed(1)} ({product.reviews})
                      </span>
                      {product.distanceKm && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {product.distanceKm.toFixed(1)} km
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                      {product.deliveryOptions.includes("farmer_delivery") && (
                        <Badge variant="outline" className="border-green-200 text-green-700">
                          <Truck className="h-3 w-3 mr-1" /> Farmer Delivery
                        </Badge>
                      )}
                      {product.deliveryOptions.includes("pickup") && (
                        <Badge variant="outline" className="border-amber-200 text-amber-700">
                          <Package className="h-3 w-3 mr-1" /> Self Pickup
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {products.map((product) => (
              <Link key={product.id} href={`/product/${product.id}`} className="group">
                <Card className="overflow-hidden border-slate-200 transition-all hover:border-emerald-300 hover:shadow-md">
                  <CardContent className="p-4">
                    <div className="flex gap-4">
                      <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-slate-100">
                        <img
                          src={product.image}
                          alt={product.name}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          onError={(e) => { (e.target as HTMLImageElement).src = "/images/placeholder-product.jpg"; }}
                        />
                        <div className="absolute top-1 left-1 flex flex-wrap gap-0.5">
                          {product.isOrganic && <Badge className="bg-emerald-600 text-white text-[10px]">Organic</Badge>}
                          {product.isVerified && <Badge className="bg-blue-600 text-white text-[10px]">Verified</Badge>}
                          <Badge variant="secondary" className="bg-indigo-100 text-indigo-700 text-[10px]">B2B</Badge>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1 text-xs text-slate-400 mb-1">
                              <Package className="h-3 w-3" />
                              <span>{product.category}</span>
                            </div>
                            <h3 className="truncate text-base font-semibold text-slate-900 group-hover:text-emerald-600">{product.name}</h3>
                            <p className="mt-0.5 text-xs text-slate-500 truncate">{product.farmerName}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                              <span className="flex items-center gap-1">
                                <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                                {product.rating.toFixed(1)} ({product.reviews})
                              </span>
                              {product.distanceKm && (
                                <span className="flex items-center gap-1">
                                  <MapPin className="h-3 w-3" />
                                  {product.distanceKm.toFixed(1)} km
                                </span>
                              )}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {product.deliveryOptions.includes("farmer_delivery") && (
                                <Badge variant="outline" className="border-green-200 text-green-700">
                                  <Truck className="h-3 w-3 mr-1" /> Farmer Delivery
                                </Badge>
                              )}
                              {product.deliveryOptions.includes("pickup") && (
                                <Badge variant="outline" className="border-amber-200 text-amber-700">
                                  <Package className="h-3 w-3 mr-1" /> Self Pickup
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-3 mt-2">
                          <div className="text-right">
                            <div className="text-lg font-bold text-emerald-700">{formatPrice(product.price)}</div>
                            <div className="text-xs text-slate-400">/{product.unit}</div>
                          </div>
                          <Badge variant="outline" className="text-xs border-emerald-200 text-emerald-700">
                            Min: {product.minOrderQty} {product.unit}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}