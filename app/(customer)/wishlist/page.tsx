"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Heart, ShoppingCart, Trash2, Search, Loader2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { formatPrice } from "../../lib/utils";
import { useWishlist } from "../../lib/hooks/use-wishlist";
import { useCartStore } from "../../lib/store/cart-store";
import toast from "react-hot-toast";

export default function WishlistPage() {
  const { items, isLoading, remove } = useWishlist();
  const addItem = useCartStore((s: any) => s.addItem);
  const [search, setSearch] = useState("");

  const filtered = useMemo(
    () => items.filter((i) => (i.name || "").toLowerCase().includes(search.toLowerCase())),
    [items, search]
  );

  const handleRemove = (item: any) => {
    remove(item.id);
    toast.success("Removed from wishlist");
  };

  const handleAddToCart = (item: any) => {
    addItem({
      id: item.id,
      name: item.name || "Product",
      price: Number(item.price || 0),
      quantity: 1,
      image: item.image || "/images/placeholder.jpg",
      farmerName: item.farmerName,
      unit: item.unit || "kg",
      pickupAvailable: item.pickupAvailable ?? false,
      farmAddress: item.farmAddress || "",
    });
    toast.success(`${item.name || "Product"} added to cart!`);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Wishlist</h1>
          <p className="text-sm text-muted-foreground">
            {items.length} {items.length === 1 ? "item" : "items"} saved for later
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search wishlist..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <Heart className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">
              {search ? "No products match your search" : "Your wishlist is empty"}
            </p>
            <p className="text-sm text-muted-foreground">
              {search
                ? "Try a different search term."
                : "Tap the heart on any product to save it here."}
            </p>
            <Button asChild>
              <Link href="/nearby">Browse products</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => (
            <Card key={item.id} className="relative overflow-hidden">
              <CardHeader className="p-0">
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100">
                  <Link href={`/product/${item.id}`}>
                    <img
                      src={item.image || "/images/placeholder.jpg"}
                      alt={item.name || "Product"}
                      className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "/images/placeholder.jpg";
                      }}
                    />
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemove(item)}
                    className="absolute right-2 top-2 rounded-full bg-white/80 backdrop-blur-sm hover:bg-white"
                    title="Remove from wishlist"
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 p-4">
                <div>
                  <Link
                    href={`/product/${item.id}`}
                    className="font-medium text-slate-900 hover:text-emerald-700"
                  >
                    {item.name}
                  </Link>
                  <CardDescription>{item.farmerName}</CardDescription>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-emerald-700">
                    {formatPrice(item.price) ?? "N/A"}
                    {item.unit ? <span className="ml-0.5 text-xs text-slate-400">/{item.unit}</span> : null}
                  </span>
                  {item.inStock ? (
                    <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">
                      In Stock
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
                      Out of Stock
                    </Badge>
                  )}
                </div>
                <Button
                  className="w-full"
                  variant={item.inStock ? "default" : "outline"}
                  disabled={!item.inStock}
                  onClick={() => handleAddToCart(item)}
                >
                  <ShoppingCart className="mr-2 h-4 w-4" />
                  Add to Cart
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
