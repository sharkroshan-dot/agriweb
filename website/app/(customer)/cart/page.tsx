"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import Image from "next/image";
import { ArrowRight, Leaf, LogIn, PackageCheck, ShieldCheck, ShoppingCart, Trash2, Truck } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { useCartStore } from "../../lib/store/cart-store";
import { cn, formatPrice } from "../../lib/utils";
import { CustomerPageHeader } from "../../components/customer/customer-page-header";

export default function CartPage() {
  const router = useRouter();
  const { status: authStatus } = useSession();
  const isAuthenticated = authStatus === "authenticated";
  const items = useCartStore((state) => state.items);
  const removeItem = useCartStore((state) => state.removeItem);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const clearCart = useCartStore((state) => state.clearCart);
  const total = useCartStore((state) => state.getTotal());

  const itemCount = useMemo(() => items.reduce((sum, item) => sum + item.quantity, 0), [items]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-5 sm:px-6 lg:px-8">
      <CustomerPageHeader eyebrow="Your basket" title="Cart" description={`${itemCount} item${itemCount !== 1 ? "s" : ""} ready for checkout`} actions={items.length > 0 ? <Button variant="outline" onClick={clearCart}>Clear cart</Button> : undefined} />
      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <ShoppingCart className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">Your cart is empty</p>
            <p className="text-sm text-muted-foreground">Browse fresh produce from trusted farms and build your basket.</p>
            <Button asChild>
              <Link href="/nearby">Explore nearby</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card>
            <CardHeader>
              <CardTitle>Items in your basket</CardTitle>
              <CardDescription>Quantities are checked again before payment to protect freshness and availability.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {items.map((item) => (
                <div key={`${item.id}-${item.variantId || "default"}`} className="flex gap-3 rounded-xl border border-slate-200 p-3 sm:gap-4 sm:p-4">
                  <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                    <Image src={item.image || "/images/placeholder-product.jpg"} alt="" fill className="object-cover" sizes="80px" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900">{item.name}</p>
                    <p className="mt-0.5 truncate text-sm text-slate-500">{item.farmerName || "Local farm"}{item.unit ? ` · ${item.unit}` : ""}</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{formatPrice(item.price)} <span className="font-normal text-slate-500">per {item.unit || "unit"}</span></p>
                    {item.pickupAvailable && <p className="mt-1 text-xs font-medium text-emerald-700">Farm pickup available</p>}
                  </div>
                  <div className="flex flex-col items-end justify-between gap-2">
                    <Button variant="ghost" size="icon" onClick={() => removeItem(item.id, item.variantId)} aria-label={`Remove ${item.name}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <div className="flex items-center rounded-lg border border-slate-200 bg-white">
                      <Button variant="ghost" size="sm" className="min-h-8 px-2" onClick={() => updateQuantity(item.id, item.quantity - 1, item.variantId)} aria-label={`Decrease ${item.name} quantity`}>−</Button>
                      <span className="w-7 text-center text-sm font-semibold">{item.quantity}</span>
                      <Button variant="ghost" size="sm" className="min-h-8 px-2" onClick={() => updateQuantity(item.id, item.quantity + 1, item.variantId)} aria-label={`Increase ${item.name} quantity`}>+</Button>
                    </div>
                    <p className="text-sm font-bold text-slate-900">{formatPrice(item.price * item.quantity)}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="h-fit lg:sticky lg:top-24">
            <CardHeader>
              <CardTitle>Order summary</CardTitle>
              <CardDescription>Delivery charges and available offers appear at checkout.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span>Items</span>
                <span>{itemCount}</span>
              </div>
              <div className="border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900">Items total</span>
                  <span className="text-lg font-bold text-slate-900">{formatPrice(total)}</span>
                </div>
              </div>
              {isAuthenticated ? (
                <Button className="w-full" asChild>
                  <Link href="/checkout">Secure checkout <ArrowRight className="h-4 w-4" /></Link>
                </Button>
              ) : (
                <Button className="w-full" onClick={() => router.push("/login")}>
                  <LogIn className="mr-2 h-4 w-4" /> Sign in to Checkout
                </Button>
              )}
              <div className="space-y-2 border-t border-slate-100 pt-4 text-xs text-slate-600">
                <p className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-600" />Freshness and secure-payment protection</p>
                <p className="flex items-center gap-2"><Truck className="h-4 w-4 text-emerald-600" />Delivery time confirmed before payment</p>
                <p className="flex items-center gap-2"><PackageCheck className="h-4 w-4 text-emerald-600" />Order updates from farm to doorstep</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      {items.length > 0 && <div className="flex items-center justify-center gap-2 text-xs text-slate-500"><Leaf className="h-3.5 w-3.5 text-emerald-600" />Buying direct supports local farming communities.</div>}
    </div>
  );
}
