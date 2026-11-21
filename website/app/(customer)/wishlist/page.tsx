"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Heart,
  ShoppingCart,
  Trash2,
  Search,
  Loader2,
  MapPin,
  Leaf,
  FlaskConical,
  Grid2X2,
  Home,
  ChevronRight,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { formatPrice } from "../../lib/utils";
import { useWishlist } from "../../lib/hooks/use-wishlist";
import { useCartStore } from "../../lib/store/cart-store";
import toast from "react-hot-toast";

type WishlistProduct = {
  id: string;
  name?: string;
  price?: number;
  unit?: string;
  image?: string;
  farmerName?: string;
  inStock?: boolean;
  farmAddress?: string;
  category?: string;
  wishlistedAt?: string;
};

export default function WishlistPage() {
  const { items, isLoading, remove } = useWishlist();
  const addItem = useCartStore((s: any) => s.addItem);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState("recent");

  const categories = useMemo(
    () => Array.from(new Set(items.map((item: WishlistProduct) => item.category).filter(Boolean))) as string[],
    [items]
  );
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const result = (items as WishlistProduct[]).filter((item) => {
      const matchesSearch =
        !query ||
        (item.name || "").toLowerCase().includes(query) ||
        (item.farmerName || "").toLowerCase().includes(query);
      const matchesCategory = category === "all" || item.category === category;
      return matchesSearch && matchesCategory;
    });

    return result.sort((a, b) => {
      if (sort === "name") return (a.name || "").localeCompare(b.name || "");
      if (sort === "price-low") return Number(a.price || 0) - Number(b.price || 0);
      if (sort === "price-high") return Number(b.price || 0) - Number(a.price || 0);
      return new Date(b.wishlistedAt || 0).getTime() - new Date(a.wishlistedAt || 0).getTime();
    });
  }, [items, search, category, sort]);

  const visibleItems = filtered;

  const updateFilter = (setter: (value: string) => void, value: string) => {
    setter(value);
  };

  const handleRemove = (item: WishlistProduct) => {
    remove(item.id);
    toast.success("Removed from wishlist");
  };

  const handleAddToCart = (item: WishlistProduct) => {
    if (item.inStock === false) return;
    addItem({
      id: item.id,
      name: item.name || "Product",
      price: Number(item.price || 0),
      quantity: 1,
      image: item.image || "/images/placeholder.jpg",
      farmerName: item.farmerName,
      unit: item.unit || "kg",
      pickupAvailable: false,
      farmAddress: item.farmAddress || "",
    });
    toast.success(`${item.name || "Product"} added to cart!`);
  };

  return (
    <div className="customer-retail-shell space-y-5">
      <div className="space-y-4">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 px-1 text-sm font-medium text-slate-600">
          <Link href="/" className="inline-flex items-center gap-1.5 text-emerald-700 hover:text-emerald-800">
            <Home className="h-4 w-4" />
            Home
          </Link>
          <ChevronRight className="h-4 w-4 text-slate-400" />
          <span className="text-slate-900">Wishlist</span>
        </nav>
        <div className="flex items-center gap-4 sm:gap-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-emerald-100 sm:h-20 sm:w-20">
            <Heart className="h-9 w-9 text-emerald-900 sm:h-11 sm:w-11" strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl">
              My Wishlist <span className="text-xl font-bold sm:text-2xl">({items.length} {items.length === 1 ? "Item" : "Items"})</span>
            </h1>
            <p className="mt-1 text-base font-semibold text-blue-950 sm:text-lg">
              Your saved products for later. Add to cart anytime.
            </p>
          </div>
        </div>
      </div>

      <section className="rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50 to-green-50 p-3 shadow-sm">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(280px,1.5fr)_minmax(190px,.8fr)_minmax(230px,.9fr)]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              placeholder="Search in wishlist..."
              value={search}
              onChange={(event) => updateFilter(setSearch, event.target.value)}
              className="h-12 rounded-xl border-slate-200 bg-white pl-11 text-sm"
            />
          </div>
          <label className="relative flex h-12 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3">
            <Grid2X2 className="h-5 w-5 shrink-0 text-emerald-700" />
            <select
              aria-label="Filter by category"
              value={category}
              onChange={(event) => updateFilter(setCategory, event.target.value)}
              className="w-full appearance-none bg-transparent pr-5 text-sm font-semibold text-slate-800 outline-none"
            >
              <option value="all">All Categories</option>
              {categories.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="flex h-12 items-center rounded-xl border border-slate-200 bg-white px-3">
            <select
              aria-label="Sort wishlist"
              value={sort}
              onChange={(event) => updateFilter(setSort, event.target.value)}
              className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none"
            >
              <option value="recent">Sort by: Recently Added</option>
              <option value="name">Sort by: Product Name</option>
              <option value="price-low">Sort by: Price Low to High</option>
              <option value="price-high">Sort by: Price High to Low</option>
            </select>
          </label>
        </div>
      </section>

      {isLoading ? (
        <div className="flex min-h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : visibleItems.length === 0 ? (
        <Card className="rounded-2xl border-slate-200">
          <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
            <Heart className="h-12 w-12 text-emerald-600" />
            <p className="text-lg font-semibold text-slate-900">
              {search || category !== "all" ? "No products match your filters" : "Your wishlist is empty"}
            </p>
            <p className="max-w-md text-sm text-slate-500">
              {search || category !== "all"
                ? "Try changing your search or filters."
                : "Tap the heart on any product to save it here for later."}
            </p>
            <Button asChild className="bg-emerald-700 hover:bg-emerald-800">
              <Link href="/nearby">Browse Products</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {visibleItems.map((item) => (
              <Card key={item.id} className="min-w-0 overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
                <CardContent className="p-3.5 sm:p-4">
                  <div className="flex h-full gap-4">
                    <Link
                      href={`/product/${item.id}`}
                      className="h-40 w-32 shrink-0 overflow-hidden rounded-xl bg-slate-100 sm:h-44 sm:w-36"
                    >
                      <img
                        src={item.image || "/images/placeholder.jpg"}
                        alt={item.name || "Product"}
                        className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
                        onError={(event) => {
                          (event.currentTarget as HTMLImageElement).src = "/images/placeholder.jpg";
                        }}
                      />
                    </Link>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link href={`/product/${item.id}`} className="line-clamp-1 text-base font-bold text-slate-950 hover:text-emerald-700">
                            {item.name || "Product"}
                          </Link>
                          <p className="mt-1 truncate text-sm text-slate-500">
                            From <span className="font-medium text-slate-700">{item.farmerName || "Local Farmer"}</span>
                          </p>
                          {item.farmAddress && (
                            <p className="mt-1 flex items-start gap-1 text-xs text-slate-500">
                              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              <span className="line-clamp-1">{item.farmAddress}</span>
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemove(item)}
                          aria-label={`Remove ${item.name || "product"} from wishlist`}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600 transition hover:bg-rose-100"
                        >
                          <Heart className="h-4 w-4 fill-current" />
                        </button>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge className="border-0 bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                          <Leaf className="mr-1 h-3 w-3" /> Farm Fresh
                        </Badge>
                        {item.inStock === false ? (
                          <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">Out of Stock</Badge>
                        ) : (
                          <Badge className="border-0 bg-green-100 text-green-800 hover:bg-green-100">
                            <FlaskConical className="mr-1 h-3 w-3" /> Available
                          </Badge>
                        )}
                      </div>

                      <div className="mt-2 text-xl font-bold text-slate-950">
                        {formatPrice(item.price) ?? "Price unavailable"}
                        {item.unit && <span className="ml-1 text-sm font-medium text-slate-600">/ {item.unit}</span>}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={item.inStock === false}
                          onClick={() => handleAddToCart(item)}
                          className="h-9 rounded-full border border-emerald-600 bg-white px-3 text-emerald-800 hover:bg-emerald-50"
                          variant="outline"
                        >
                          <ShoppingCart className="mr-1.5 h-4 w-4" />
                          Add to Cart
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRemove(item)}
                          className="h-9 rounded-full bg-slate-100 px-3 text-slate-700 hover:bg-slate-200"
                        >
                          <Trash2 className="mr-1.5 h-4 w-4" />
                          Remove
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>


        </>
      )}
    </div>
  );
}
