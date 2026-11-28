"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import Image from "next/image";
import {
  ArrowRight, Check, ChevronRight, FileText, Home, Info, Leaf, LogIn,
  Minus, PackageCheck, Plus, ShieldCheck, ShoppingCart, Trash2, Truck,
} from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { useCartStore } from "../../lib/store/cart-store";
import { cn, formatPrice } from "../../lib/utils";
import { api } from "../../lib/api/client";

type SuggestedProduct = {
  id: string;
  name: string;
  price: number;
  unit: string;
  image: string;
  farmerName: string;
};

const FALLBACK_IMAGE = "/images/placeholder-product.jpg";

function imageFor(value?: string) {
  return value || FALLBACK_IMAGE;
}

export default function CartPage() {
  const router = useRouter();
  const { status: authStatus } = useSession();
  const isAuthenticated = authStatus === "authenticated";
  const items = useCartStore((state) => state.items);
  const addItem = useCartStore((state) => state.addItem);
  const removeItem = useCartStore((state) => state.removeItem);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const clearCart = useCartStore((state) => state.clearCart);
  const total = useCartStore((state) => state.getTotal());

  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestedProduct[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  const itemCount = useMemo(() => items.reduce((sum, item) => sum + item.quantity, 0), [items]);
  const selectedCount = selectedKeys.length;
  const allSelected = items.length > 0 && selectedCount === items.length;
  const cartKeys = useMemo(
    () => items.map((item) => `${item.id}::${item.variantId || "default"}`),
    [items],
  );

  useEffect(() => {
    // Keep existing selections only; newly added cart items remain unchecked.
    setSelectedKeys((current) => current.filter((key) => cartKeys.includes(key)));
  }, [cartKeys]);

  useEffect(() => {
    let active = true;
    setSuggestionsLoading(true);
    api.get("/products/search", { params: { limit: 12, sortBy: "createdAt", sortOrder: "desc" } })
      .then((response: any) => {
        if (!active) return;
        const products = response?.data?.products || response?.products || [];
        const cartIds = new Set(items.map((item) => String(item.id)));
        const mapped = products
          .map((product: any) => ({
            id: String(product._id || product.id || ""),
            name: product.name || "Fresh Produce",
            price: Number(product.price) || 0,
            unit: product.unit || "kg",
            image: product.images?.[0] || product.image || FALLBACK_IMAGE,
            farmerName: typeof product.farmer === "object"
              ? product.farmer?.farmName || product.farmer?.name || "Local Farmer"
              : product.farmerName || product.farmName || "Local Farmer",
          }))
          .filter((product: SuggestedProduct) => product.id && !cartIds.has(product.id) && product.price > 0)
          .slice(0, 4);
        setSuggestions(mapped);
      })
      .catch(() => {
        if (active) setSuggestions([]);
      })
      .finally(() => {
        if (active) setSuggestionsLoading(false);
      });
    return () => { active = false; };
  // Refresh suggestions when the cart changes so products already in the basket are excluded.
  }, [items]);

  const toggleSelected = (key: string) => {
    setSelectedKeys((current) => current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]);
  };

  const removeSelected = () => {
    items.forEach((item) => {
      const key = `${item.id}::${item.variantId || "default"}`;
      if (selectedKeys.includes(key)) removeItem(item.id, item.variantId);
    });
    setSelectedKeys([]);
    toast.success("Selected items removed");
  };

  const handleAddSuggestion = (product: SuggestedProduct) => {
    addItem({
      id: product.id,
      name: product.name,
      price: product.price,
      quantity: 1,
      image: product.image,
      farmerName: product.farmerName,
      unit: product.unit,
    });
    toast.success(`${product.name} added to cart`);
  };

  return (
    <div className="w-full min-w-0 space-y-5 px-2 py-5 sm:px-3 lg:px-4">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-slate-600">
        <Link href="/" className="inline-flex items-center gap-1.5 transition hover:text-emerald-700"><Home className="h-4 w-4 text-emerald-700" />Home</Link>
        <ChevronRight className="h-4 w-4 text-slate-400" />
        <span className="font-semibold text-slate-900">Cart</span>
      </nav>

      {items.length === 0 ? (
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100"><ShoppingCart className="h-10 w-10 text-emerald-700" /></span>
            <h1 className="text-2xl font-extrabold text-slate-900">Your cart is empty</h1>
            <p className="max-w-md text-sm text-slate-600">Discover fresh produce directly from verified farmers and add your favourites to the basket.</p>
            <Button asChild className="mt-2 rounded-xl bg-emerald-700 hover:bg-emerald-800"><Link href="/nearby">Explore fresh produce <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(330px,0.43fr)]">
            <section className="min-w-0 space-y-4">
              <header className="flex items-center gap-4">
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-emerald-100"><ShoppingCart className="h-9 w-9 text-emerald-700" /></span>
                <div>
                  <h1 className="text-3xl font-extrabold tracking-tight text-slate-950">My Cart <span className="text-xl font-bold">({items.length} Items)</span></h1>
                  <p className="mt-1 text-sm text-slate-700 sm:text-base">Review your items, update quantities, and proceed to checkout.</p>
                </div>
              </header>

              <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50"><PackageCheck className="h-6 w-6 text-emerald-700" /></span>
                    <div>
                      <h2 className="text-lg font-extrabold text-slate-950">Items in Your Basket</h2>
                      <p className="text-xs text-slate-600 sm:text-sm">Quantities are checked again before payment to ensure freshness and availability.</p>
                    </div>
                  </div>
                  <Button variant="outline" onClick={() => { clearCart(); setSelectedKeys([]); }} className="rounded-xl border-slate-300 font-semibold"><Trash2 className="mr-2 h-4 w-4" />Clear Cart</Button>
                </div>

                <div className="divide-y divide-slate-100 px-4 sm:px-5">
                  {items.map((item) => {
                    const key = `${item.id}::${item.variantId || "default"}`;
                    const checked = selectedKeys.includes(key);
                    return (
                      <div key={key} className="grid grid-cols-[20px_76px_minmax(0,1fr)_auto] items-center gap-3 py-4 sm:grid-cols-[20px_112px_minmax(180px,1fr)_auto_auto_auto_36px] sm:gap-4">
                        <button type="button" role="checkbox" aria-checked={checked} aria-label={`Select ${item.name}`} onClick={() => toggleSelected(key)} style={{ width: 20, height: 20, minWidth: 20, minHeight: 20, maxWidth: 20, maxHeight: 20, padding: 0 }} className={cn("!h-5 !w-5 !min-h-5 !min-w-5 !max-h-5 !max-w-5 shrink-0 aspect-square p-0 inline-flex items-center justify-center box-border rounded-md border-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2", checked ? "border-emerald-700 bg-emerald-700 text-white shadow-sm" : "border-slate-300 bg-white hover:border-emerald-500")}>{checked && <Check className="h-4 w-4" />}</button>
                        <div className="relative h-[68px] w-[76px] overflow-hidden rounded-xl bg-slate-50 sm:h-[88px] sm:w-28">
                          <Image src={imageFor(item.image)} alt={item.name} fill sizes="(max-width: 640px) 76px, 112px" className="object-contain p-1" unoptimized />
                        </div>
                        <div className="min-w-0">
                          <h3 className="truncate text-base font-extrabold text-slate-950 sm:text-lg">{item.name}</h3>
                          <p className="truncate text-xs text-slate-700 sm:text-sm">From {item.farmerName || "Local Farmer"}{item.farmAddress ? ` · ${item.farmAddress}` : ""}</p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-semibold text-emerald-800 sm:text-xs"><Leaf className="h-3 w-3" />Farm Fresh</span>
                            {item.pickupAvailable && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-semibold text-emerald-800 sm:text-xs"><ShieldCheck className="h-3 w-3" />Pickup Available</span>}
                          </div>
                        </div>
                        <div className="hidden min-w-[78px] text-right sm:block"><p className="font-extrabold text-slate-950">{formatPrice(item.price)} <span className="text-xs font-medium">/ {item.unit || "unit"}</span></p></div>
                        <div className="col-start-3 flex w-fit items-center rounded-full border border-slate-300 bg-white p-1 sm:col-start-auto">
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-emerald-800 hover:bg-emerald-50" onClick={() => updateQuantity(item.id, item.quantity - 1, item.variantId)} aria-label={`Decrease ${item.name}`}><Minus className="h-4 w-4" /></Button>
                          <span className="w-8 text-center text-sm font-bold tabular-nums">{item.quantity}</span>
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-emerald-800 hover:bg-emerald-50" onClick={() => updateQuantity(item.id, item.quantity + 1, item.variantId)} aria-label={`Increase ${item.name}`}><Plus className="h-4 w-4" /></Button>
                        </div>
                        <div className="col-start-4 row-start-1 text-right sm:col-start-auto sm:row-auto"><p className="font-extrabold text-slate-950">{formatPrice(item.price * item.quantity)}</p><p className="text-[10px] text-slate-500 sm:hidden">{formatPrice(item.price)} / {item.unit || "unit"}</p></div>
                        <Button variant="ghost" size="icon" className="col-start-4 row-start-2 h-8 w-8 justify-self-end rounded-full text-red-600 hover:bg-red-50 sm:col-start-auto sm:row-auto" onClick={() => removeItem(item.id, item.variantId)} aria-label={`Remove ${item.name}`}><Trash2 className="h-5 w-5" /></Button>
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 sm:px-5">
                  <button type="button" role="checkbox" aria-checked={allSelected} onClick={() => setSelectedKeys(allSelected ? [] : cartKeys)} className="inline-flex items-center gap-2 text-sm font-bold text-slate-900">
                    <span style={{ width: 20, height: 20, minWidth: 20, minHeight: 20, maxWidth: 20, maxHeight: 20, padding: 0 }} className={cn("!h-5 !w-5 !min-h-5 !min-w-5 !max-h-5 !max-w-5 shrink-0 aspect-square p-0 inline-flex items-center justify-center box-border rounded-md border-2 transition", allSelected ? "border-emerald-700 bg-emerald-700 text-white shadow-sm" : "border-slate-300 bg-white")}>{allSelected && <Check className="h-4 w-4" />}</span>
                    Select All ({items.length})
                  </button>
                  <Button variant="outline" disabled={selectedCount === 0} onClick={removeSelected} className="rounded-xl border-red-300 font-semibold text-red-600 hover:bg-red-50"><Trash2 className="mr-2 h-4 w-4" />Remove Selected</Button>
                </div>
              </Card>

              <section className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-lime-50 p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="flex items-center gap-2 text-xl font-extrabold text-slate-950"><Leaf className="h-6 w-6 text-emerald-700" />You May Also Like</h2>
                  <Link href="/nearby" className="shrink-0 text-sm font-bold text-emerald-800 hover:underline">View More <ArrowRight className="ml-1 inline h-4 w-4" /></Link>
                </div>
                {suggestionsLoading ? (
                  <p className="py-6 text-center text-sm text-slate-500">Finding fresh produce for you…</p>
                ) : suggestions.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {suggestions.map((product) => (
                      <Card key={product.id} className="overflow-hidden rounded-2xl border-slate-100 bg-white shadow-sm">
                        <div className="relative h-24 bg-white sm:h-28">
                          <Image src={imageFor(product.image)} alt={product.name} fill sizes="(max-width: 640px) 45vw, 220px" className="object-contain p-2" unoptimized />
                        </div>
                        <CardContent className="space-y-2 p-3">
                          <div><h3 className="truncate text-sm font-extrabold text-slate-950">{product.name}</h3><p className="text-sm font-bold text-slate-900">{formatPrice(product.price)} <span className="text-xs font-medium">/ {product.unit}</span></p></div>
                          <Button variant="outline" className="h-9 w-full rounded-xl border-emerald-700 text-xs font-bold text-emerald-800 hover:bg-emerald-50" onClick={() => handleAddSuggestion(product)}><ShoppingCart className="mr-1.5 h-4 w-4" />Add to Cart</Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <p className="py-5 text-center text-sm text-slate-500">Explore more fresh produce from nearby farmers.</p>
                )}
              </section>
            </section>

            <aside className="space-y-5 xl:sticky xl:top-24">
              <Card className="overflow-hidden rounded-2xl border-emerald-100 shadow-sm">
                <div className="flex items-center gap-3 bg-gradient-to-r from-emerald-100 to-green-50 px-5 py-4"><FileText className="h-7 w-7 text-emerald-800" /><h2 className="text-xl font-extrabold text-slate-950">Order Summary</h2></div>
                <CardContent className="space-y-4 p-5">
                  <div className="flex items-center justify-between text-sm"><span className="font-medium text-slate-700">Items ({items.length})</span><span className="font-semibold text-slate-900">{formatPrice(total)}</span></div>
                  <div className="flex items-center justify-between text-sm"><span className="flex items-center gap-1.5 font-medium text-slate-700">Delivery Fee <Info className="h-4 w-4 text-slate-500" /></span><span className="text-sm text-slate-500">Calculated at checkout</span></div>
                  <div className="flex items-center justify-between text-sm"><span className="font-medium text-slate-700">Discount</span><span className="text-sm text-slate-500">Offers at checkout</span></div>
                  <div className="flex items-center justify-between border-t border-slate-200 pt-4"><span className="text-lg font-extrabold text-slate-950">Items Total</span><span className="text-2xl font-extrabold text-emerald-700">{formatPrice(total)}</span></div>
                  <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 p-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-100"><Truck className="h-6 w-6 text-emerald-800" /></span><div className="min-w-0"><p className="text-sm font-extrabold text-slate-950">Estimated Delivery</p><p className="text-xs text-slate-700">Confirmed at checkout</p></div></div>
                  {isAuthenticated ? (
                    <Button className="h-12 w-full rounded-xl bg-emerald-700 text-base font-extrabold text-white hover:bg-emerald-800" asChild><Link href="/checkout">Proceed to Checkout <ArrowRight className="ml-2 h-5 w-5" /></Link></Button>
                  ) : (
                    <Button className="h-12 w-full rounded-xl bg-emerald-700 text-base font-extrabold text-white hover:bg-emerald-800" onClick={() => router.push("/login")}><LogIn className="mr-2 h-5 w-5" />Sign in to Checkout</Button>
                  )}
                </CardContent>
              </Card>

              <Card className="overflow-hidden rounded-2xl border-emerald-100 shadow-sm">
                <div className="flex items-center gap-3 bg-gradient-to-r from-emerald-50 to-lime-50 px-5 py-4"><ShieldCheck className="h-7 w-7 text-emerald-800" /><h2 className="text-lg font-extrabold text-slate-950">Why Shop on AgriConnect?</h2></div>
                <CardContent className="space-y-3 p-5 text-sm font-medium text-slate-800">
                  {["Direct from verified farmers", "Fresh, safe and traceable produce", "Quality checked before delivery", "Support local and sustainable farming"].map((benefit) => <p key={benefit} className="flex items-center gap-2.5"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-600 text-white"><Check className="h-3.5 w-3.5" /></span>{benefit}</p>)}
                </CardContent>
              </Card>
            </aside>
          </div>
          <div className="flex items-center justify-center gap-2 pb-2 text-xs text-slate-500"><Leaf className="h-4 w-4 text-emerald-600" />Buying direct supports local farming communities.</div>
        </>
      )}
    </div>
  );
}
