"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ShoppingCart, MapPin, ArrowLeft, Plus, CreditCard, Loader2, X, Truck, CalendarClock, Leaf, ShieldCheck, Smartphone, Landmark, Banknote, WalletCards, CheckCircle2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { useCartStore } from "../../lib/store/cart-store";
import { api } from "../../lib/api/client";
import { formatPrice } from "../../lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { PageErrorState } from "../../components/common/page-state";

type DeliveryQuote = {
  method: string;
  distanceKm: number;
  weightKg: number;
  baseFee: number;
  distanceFee: number;
  weightFee: number;
  minimumApplied: boolean;
  fee: number;
  freeDelivery?: boolean;
  subsidy?: number;
  distanceAvailable?: boolean;
};


type Address = {
  id: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  zip_code: string;
  country: string;
  address_type: string;
  is_default: boolean;
};

const PAYMENT_METHODS = [
  { value: "razorpay", label: "UPI & Cards", description: "Pay securely with Razorpay", icon: CreditCard, accent: "emerald" },
  { value: "wallet", label: "AgriConnect Wallet", description: "Use your available wallet balance", icon: WalletCards, accent: "blue" },
  { value: "cash", label: "Cash on Delivery", description: "Pay when your order arrives", icon: Banknote, accent: "amber" },
];

const initialAddrForm = {
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  zip_code: "",
  country: "India",
  landmark: "",
  address_type: "home" as string,
};

export default function CheckoutPage() {
  const router = useRouter();
  const { status } = useSession();
  const queryClient = useQueryClient();
  const items = useCartStore((state) => state.items);
  const resolvedPickup = useRef<Set<string>>(new Set());
  const idempotencyKeyRef = useRef<string | null>(null);

  const removeItem = useCartStore((state) => state.removeItem);
  const clearCart = useCartStore((state) => state.clearCart);
  const updateItem = useCartStore((state) => state.updateItem);
  const displayTotal = useMemo(
    () => items.reduce((sum, i) => sum + (i.originalPrice || i.price) * i.quantity, 0),
    [items]
  );

  const [selectedAddressId, setSelectedAddressId] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState("razorpay");
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [isPlacing, setIsPlacing] = useState(false);
  const [showAddrForm, setShowAddrForm] = useState(false);
  const [addrForm, setAddrForm] = useState(initialAddrForm);
  const [razorpayReady, setRazorpayReady] = useState(false);
  const [savingAddr, setSavingAddr] = useState(false);
  const [deliveryQuote, setDeliveryQuote] = useState<DeliveryQuote | null>(null);
  const [isEstimatingFee, setIsEstimatingFee] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [deliveryTimeSlot, setDeliveryTimeSlot] = useState("morning");
  const [couponCode, setCouponCode] = useState("");
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponAppliedCode, setCouponAppliedCode] = useState("");
  const [couponError, setCouponError] = useState("");
  const [applyingCoupon, setApplyingCoupon] = useState(false);
  const [paymentStage, setPaymentStage] = useState<"idle"|"creating"|"processing"|"success"|"failed">("idle");
  const [paymentMessage, setPaymentMessage] = useState("");

  useEffect(() => {
    if (status !== "authenticated") return;
    const missing = items.filter(
      (i) => !i.pickupAvailable && !resolvedPickup.current.has(i.id)
    );
    if (missing.length === 0) return;
    missing.forEach((item) => {
      resolvedPickup.current.add(item.id);
      api
        .get(`/products/${item.id}`)
        .then((res) => {
          const p = res?.data || res;
          if (p) {
            updateItem(item.id, {
              pickupAvailable: p.pickupAvailable ?? false,
              farmAddress: p.farmAddress || "",
            });
          }
        })
        .catch(() => {});
    });
  }, [items, updateItem]);

  const farmAddress = useMemo(
    () => items.find((i) => i.farmAddress)?.farmAddress || "",
    [items]
  );

  const maxDistance = useMemo(
    () => Math.max(...items.map((i) => i.farmDistanceKm || 0), 0),
    [items]
  );

  const { data: addressesData, isError: addressesError, refetch: refetchAddresses } = useQuery({
    queryKey: ["customerAddresses"],
    queryFn: () => api.get("/users/me/addresses"),
    enabled: items.length > 0 && status === "authenticated",
  });

  const addresses: Address[] = useMemo(() => {
    const list = Array.isArray(addressesData) ? addressesData : addressesData?.data || [];
    return list.map((a: any) => ({ ...a, id: a._id || a.id }));
  }, [addressesData]);

  const defaultAddress = useMemo(
    () => addresses.find((a) => a.is_default) || addresses[0],
    [addresses]
  );

  const estimatedDeliveryAddressId = selectedAddressId || defaultAddress?.id;

  useEffect(() => {
    if (!estimatedDeliveryAddressId || items.length === 0) {
      setDeliveryQuote(null);
      return;
    }
    let cancelled = false;
    setIsEstimatingFee(true);
    api
      .post("/delivery/fee-estimate", {
        items: items.map((item) => ({ productId: item.id, quantity: item.quantity })),
        deliveryAddressId: estimatedDeliveryAddressId,
        method: "farmer",
        orderAmount: displayTotal,
      })
      .then((res) => {
        if (cancelled) return;
        const body = res?.data || res;
        const quote = body?.data || body;
        if (quote && typeof quote.fee === "number") setDeliveryQuote(quote);
        else setDeliveryQuote(null);
      })
      .catch(() => {
        if (!cancelled) setDeliveryQuote(null);
      })
      .finally(() => {
        if (!cancelled) setIsEstimatingFee(false);
      });
    return () => {
      cancelled = true;
    };
  }, [estimatedDeliveryAddressId, items]);

  const handleAddrChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setAddrForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleAddAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addrForm.address_line1 || !addrForm.city || !addrForm.state || !addrForm.zip_code) {
      toast.error("Fill in all required fields");
      return;
    }
    setSavingAddr(true);
    try {
      await api.post("/users/me/addresses", addrForm);
      await queryClient.refetchQueries({ queryKey: ["customerAddresses"] });
      setAddrForm(initialAddrForm);
      setShowAddrForm(false);
      toast.success("Address added");
    } catch (err: any) {
      const message = err?.message || "Failed to add address";
      const cleaned = message.replace(/^"|"$/g, "");
      toast.error(cleaned.length > 120 ? cleaned.slice(0, 120) + "..." : cleaned);
    } finally {
      setSavingAddr(false);
    }
  };

  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

  // Load the Razorpay Checkout script once and resolve when ready.
  const ensureRazorpayLoaded = async () => {
    if (typeof window !== "undefined" && (window as any).Razorpay) {
      setRazorpayReady(true);
      return;
    }
    return new Promise<void>((resolve) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => {
        setRazorpayReady(true);
        resolve();
      };
      script.onerror = () => {
        toast.error("Could not load payment gateway. Please check your connection.");
        resolve();
      };
      document.body.appendChild(script);
    });
  };

  useEffect(() => {
    ensureRazorpayLoaded();
  }, []);

  const openRazorpayCheckout = async (intentData: any, orderId: string) => {
    return new Promise<void>((resolve, reject) => {
      if (typeof window === "undefined" || !(window as any).Razorpay) {
        reject(new Error("Payment gateway unavailable"));
        return;
      }

      const options = {
        key: intentData.key_id,
        amount: intentData.amount,
        currency: intentData.currency || "INR",
        name: intentData.name || "AgriConnect",
        description: intentData.description || "",
        order_id: intentData.order_id,
        prefill: intentData.prefill || {},
        theme: intentData.theme || { color: "#059669" },
        handler: async (response: any) => {
          try {
            setIsPlacing(true);
            await api.post("/payments/verify", {
              payment_id: intentData.payment_id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            });
            clearCart();
            toast.success("Payment successful! Order placed.");
            router.push(`/orders/${orderId}`);
            resolve();
          } catch (err: any) {
            toast.error(err?.message || "Payment could not be confirmed");
            resolve();
          } finally {
            setIsPlacing(false);
          }
        },
        modal: {
          ondismiss: () => {
            toast("Payment cancelled. You can retry checkout anytime.", { icon: "🛒" });
            resolve();
          },
        },
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.open();
    });
  };

  const handleApplyCoupon = async () => {
    const code = couponCode.trim();
    if (!code) {
      setCouponError("Enter a coupon code");
      return;
    }
    setApplyingCoupon(true);
    setCouponError("");
    try {
      const res = await api.post("/coupons/validate", { code, orderValue: displayTotal });
      const body = res?.data || res;
      if (body?.valid) {
        setCouponDiscount(Number(body.discountAmount) || 0);
        setCouponAppliedCode(code.toUpperCase());
        toast.success(`Coupon ${code.toUpperCase()} applied!`);
      } else {
        setCouponDiscount(0);
        setCouponAppliedCode("");
        setCouponError(body?.message || "Invalid coupon code");
      }
    } catch (err: any) {
      setCouponDiscount(0);
      setCouponAppliedCode("");
      setCouponError(err?.message || "Failed to validate coupon");
    } finally {
      setApplyingCoupon(false);
    }
  };

  const handleRemoveCoupon = () => {
    setCouponCode("");
    setCouponDiscount(0);
    setCouponAppliedCode("");
    setCouponError("");
  };

  const deliveryFeeValue = deliveryQuote?.fee ?? 0;
  const platformFeeValue = Math.max(0, (displayTotal - couponDiscount) * 0.05);
  const estimatedTotal = Math.max(0, displayTotal - couponDiscount + deliveryFeeValue + platformFeeValue);

  const handlePlaceOrder = async () => {
    const addressId = selectedAddressId || defaultAddress?.id;

    if (!addressId) {
      toast.error("Please select a delivery address");
      return;
    }

    if (paymentMethod !== "cash" && !razorpayReady) {
      toast.error("Payment gateway is still loading, please retry in a moment");
      return;
    }

    const selectedAddress = addresses.find((a) => a.id === addressId);
    if (selectedAddress && !/^\d{6}$/.test(selectedAddress.zip_code.trim())) {
      toast.error("Please select an address with a valid 6-digit PIN code.");
      return;
    }

    setIsPlacing(true);
    setPaymentStage("creating");
    setPaymentMessage("Creating your secure payment session…");

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    const invalidItems = items.filter((i) => !(i.originalPrice || i.price) || (i.originalPrice || i.price) <= 0);
    if (invalidItems.length > 0) {
      toast.error(`Item "${invalidItems[0].name}" has an invalid price. Please remove and re-add it.`);
      setIsPlacing(false);
      return;
    }

    try {
      const payload: Record<string, any> = {
        items: items.map((item) => ({
          productId: item.id,
          quantity: item.quantity,
          unitPrice: item.originalPrice || item.price,
        })),
        deliveryAddressId: addressId,
        paymentMethod,
        specialInstructions: specialInstructions || undefined,
        deliveryType: "delivery",
        requestedDeliveryDate: new Date(`${deliveryDate}T00:00:00`).toISOString(),
        idempotencyKey: idempotencyKeyRef.current,
        deliveryTimeSlot,
      };

      if (couponAppliedCode) {
        payload.couponCode = couponAppliedCode;
      }

      const res = await api.post("/orders/", payload);
      const order = res?.data || res;

      if (!order) throw new Error("Failed to create order");

      if (paymentMethod === "cash") {
        clearCart();
        toast.success("Order placed successfully!");
        router.push(`/orders/${order.id || order._id}`);
      } else {
        // Online payment via Razorpay Checkout
        setPaymentMessage("Opening secure payment gateway…");
        setPaymentStage("processing");
        const intent = await api.post("/payments/create-intent", {
          order_id: order.id || order._id,
          payment_method: "razorpay",
        });
        const intentData = intent?.data || intent;

        if (!intentData?.order_id) {
          throw new Error(intentData?.error || "Payment initiation failed");
        }

        if (intentData?.simulated) {
          // Development mode: no live gateway available. Simulate a successful
          // payment and confirm it against the backend, which accepts
          // "order_sim_*" ids in DEBUG. The real Razorpay Checkout is never
          // opened with a placeholder key.
          await api.post("/payments/verify", {
            payment_id: intentData.payment_id,
            razorpay_order_id: intentData.order_id,
            razorpay_payment_id: `sim_payment_${intentData.payment_id}`,
            razorpay_signature: "simulated_signature",
          });
          setPaymentStage("success");
          setPaymentMessage("Payment verified successfully. Your order is confirmed.");
          clearCart();
          toast.success("Payment successful! Order placed.");
          router.push(`/orders/${order.id || order._id}`);
          return;
        }

        await openRazorpayCheckout(intentData, order.id || order._id);
      }
    } catch (err: any) {
      setPaymentStage("failed");
      setPaymentMessage("Payment could not be completed. Your order can be retried safely.");
      const msg = err?.message || "";
      if (msg.includes("Product not found")) {
        const productId = msg.match(/[a-f0-9]{24}/)?.[0];
        if (productId) {
          removeItem(productId);
          toast.success("Removed unavailable product from your cart. Please try again.");
        } else {
          clearCart();
          toast.success("Cleared unavailable items from your cart. Please try again.");
        }
      } else {
        toast.error(msg || "Failed to place order");
      }
    } finally {
      setIsPlacing(false);
    }
  };

  if (status === "loading") return <div className="page-container"><div className="h-8 w-48 animate-pulse rounded-lg bg-slate-200" /><div className="mt-6 h-40 animate-pulse rounded-2xl bg-slate-100" /></div>;
  if (status === "unauthenticated") {
    router.replace("/login");
    return null;
  }

  if (items.length === 0) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/cart"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <h1 className="text-2xl font-semibold">Checkout</h1>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <ShoppingCart className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">Your cart is empty</p>
            <p className="text-sm text-muted-foreground">Add some products before checkout.</p>
            <Button asChild>
              <Link href="/nearby">Browse products</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/cart"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">Checkout</h1>
          <p className="text-sm text-muted-foreground">{itemCount} items · {formatPrice(displayTotal)}</p>
        </div>
      </div>

      {paymentStage !== "idle" && (
        <Card className={`border-2 ${paymentStage==="failed"?"border-red-200 bg-red-50/60":paymentStage==="success"?"border-emerald-200 bg-emerald-50/60":"border-blue-200 bg-blue-50/60"}`}>
          <CardContent className="flex items-center gap-3 p-4">
            {paymentStage==="success" ? <CheckCircle2 className="h-5 w-5 text-emerald-600"/> : paymentStage==="failed" ? <X className="h-5 w-5 text-red-600"/> : <Loader2 className="h-5 w-5 animate-spin text-blue-600"/>}
            <div><p className="font-semibold text-slate-900">{paymentStage==="creating"?"Preparing payment":paymentStage==="processing"?"Payment processing":paymentStage==="success"?"Payment confirmed":"Payment needs attention"}</p><p className="text-xs text-slate-600">{paymentMessage}</p></div>
          </CardContent>
        </Card>
      )}

      {addressesError && (
        <PageErrorState
          title="Unable to load delivery addresses"
          description="We need a valid delivery address before checkout can continue."
          retry={() => { void refetchAddresses(); }}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {/* Delivery Type */}
          <Card className="border-emerald-200 bg-emerald-50/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Truck className="h-5 w-5 text-emerald-600" /> Home Delivery
              </CardTitle>
              <CardDescription>Your order will be delivered to your doorstep</CardDescription>
            </CardHeader>
            <CardContent>
              {deliveryQuote && (
                <div className="rounded-lg border bg-white p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-900">Delivery Fee</p>
                    <span className="text-sm font-semibold text-emerald-700">
                      {deliveryQuote.fee === 0 && deliveryQuote.freeDelivery ? (
                        <>
                          FREE
                          {deliveryQuote.subsidy && (
                            <span className="ml-2 text-xs text-emerald-600">(₹{deliveryQuote.subsidy} saved)</span>
                          )}
                        </>
                      ) : (
                        `₹${deliveryQuote.fee}`
                      )}
                    </span>
                  </div>
                  {deliveryQuote.distanceKm > 0 && (
                    <p className="mt-2 text-xs text-slate-500">
                      {deliveryQuote.distanceKm.toFixed(1)} km from farmer · ~45-60 min
                    </p>
                  )}
                </div>
              )}
              {!deliveryQuote && (
                <div className="rounded-lg border bg-white p-4 text-center">
                  <p className="text-sm text-slate-500">Select a delivery address to calculate delivery fee</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Delivery Address */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" /> Delivery Address
              </CardTitle>
              <CardDescription>Choose where to deliver your order</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {addresses.length === 0 && !showAddrForm ? (
                <p className="text-sm text-muted-foreground">No saved addresses yet.</p>
              ) : (
                <div className="space-y-2">
                  {addresses.map((addr) => (
                    <label
                      key={addr.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                        (selectedAddressId || defaultAddress?.id) === addr.id
                          ? "border-emerald-500 bg-emerald-50"
                          : "hover:bg-gray-50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="deliveryAddress"
                        value={addr.id}
                        checked={(selectedAddressId || defaultAddress?.id) === addr.id}
                        onChange={(e) => setSelectedAddressId(e.target.value)}
                        className="mt-1"
                      />
                      <div className="text-sm">
                        <p className="font-medium">
                          {addr.address_line1}
                          {addr.address_line2 && `, ${addr.address_line2}`}
                        </p>
                        <p className="text-muted-foreground">
                          {addr.city}, {addr.state} - {addr.zip_code}
                        </p>
                        <p className="text-xs capitalize text-muted-foreground">{addr.address_type}</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {showAddrForm && (
                <form onSubmit={handleAddAddress} className="space-y-3 rounded-lg border bg-gray-50 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">New Address</span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setShowAddrForm(false)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <Input name="address_line1" value={addrForm.address_line1} onChange={handleAddrChange} placeholder="Address line 1 *" required />
                  <Input name="address_line2" value={addrForm.address_line2} onChange={handleAddrChange} placeholder="Address line 2 (optional)" />
                  <div className="grid grid-cols-2 gap-3">
                    <Input name="city" value={addrForm.city} onChange={handleAddrChange} placeholder="City *" required />
                    <Input name="state" value={addrForm.state} onChange={handleAddrChange} placeholder="State *" required />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Input name="zip_code" value={addrForm.zip_code} onChange={handleAddrChange} placeholder="PIN code *" required />
                    <Input name="landmark" value={addrForm.landmark} onChange={handleAddrChange} placeholder="Landmark" />
                  </div>
                  <select name="address_type" value={addrForm.address_type} onChange={handleAddrChange} className="w-full rounded-md border px-3 py-2 text-sm">
                    <option value="permanent">Permanent</option>
                    <option value="home">Home</option>
                    <option value="work">Work</option>
                    <option value="other">Other</option>
                  </select>
                  <Button type="submit" size="sm" disabled={savingAddr}>
                    {savingAddr ? "Saving..." : "Save Address"}
                  </Button>
                </form>
              )}

              <Button variant="outline" size="sm" onClick={() => setShowAddrForm(!showAddrForm)} className="flex items-center gap-2">
                <Plus className="h-4 w-4" /> {showAddrForm ? "Cancel" : "Add new address"}
              </Button>
            </CardContent>
          </Card>

            <Card className="border-emerald-200 bg-emerald-50/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarClock className="h-5 w-5 text-emerald-600" /> Fresh delivery window
                </CardTitle>
                <CardDescription>Choose when the farmer&apos;s produce should reach you.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <label className={`cursor-pointer rounded-lg border p-3 ${deliveryDate === new Date().toISOString().split("T")[0] ? "border-emerald-500 bg-white" : "bg-white/60"}`}>
                    <input type="radio" name="deliveryDate" className="mr-2" checked={deliveryDate === new Date().toISOString().split("T")[0]} onChange={() => setDeliveryDate(new Date().toISOString().split("T")[0])} />
                    <span className="text-sm font-medium">Today</span>
                    <span className="mt-1 block text-xs text-muted-foreground">Best for leafy greens</span>
                  </label>
                  <label className={`cursor-pointer rounded-lg border p-3 ${deliveryDate !== new Date().toISOString().split("T")[0] ? "border-emerald-500 bg-white" : "bg-white/60"}`}>
                    <input type="radio" name="deliveryDate" className="mr-2" checked={deliveryDate !== new Date().toISOString().split("T")[0]} onChange={() => { const d = new Date(); d.setDate(d.getDate() + 1); setDeliveryDate(d.toISOString().split("T")[0]); }} />
                    <span className="text-sm font-medium">Tomorrow</span>
                    <span className="mt-1 block text-xs text-muted-foreground">Plan ahead</span>
                  </label>
                </div>
                <div>
                  <label className="text-sm font-medium">Preferred time</label>
                  <select value={deliveryTimeSlot} onChange={(e) => setDeliveryTimeSlot(e.target.value)} className="mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm">
                    <option value="morning">Morning (6AM - 10AM)</option>
                    <option value="midday">Midday (10AM - 2PM)</option>
                    <option value="afternoon">Afternoon (2PM - 6PM)</option>
                    <option value="evening">Evening (6PM - 8PM)</option>
                  </select>
                </div>
                <p className="flex items-center gap-2 text-xs text-emerald-800"><Leaf className="h-4 w-4" /> Same-day delivery helps reduce food waste and keeps produce fresher.</p>
              </CardContent>
            </Card>

          {/* Payment Method */}
          <Card className="overflow-hidden">
            <CardHeader className="border-b bg-slate-50/70">
              <CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-emerald-600" /> Payment</CardTitle>
              <CardDescription>Choose your preferred payment method. You will see the gateway options after placing the order.</CardDescription>
            </CardHeader>
            <CardContent className="p-5">
              <div className="grid gap-3">
                {PAYMENT_METHODS.map((method:any) => {
                  const Icon=method.icon;
                  const selected=paymentMethod===method.value;
                  return <label key={method.value} className={`relative flex cursor-pointer items-center gap-4 rounded-xl border-2 p-4 transition hover:border-emerald-300 ${selected?"border-emerald-500 bg-emerald-50/60":"border-slate-200 bg-white"}`}>
                    <input className="sr-only" type="radio" name="paymentMethod" value={method.value} checked={selected} onChange={(e)=>setPaymentMethod(e.target.value)}/>
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${selected?"bg-emerald-600 text-white":"bg-slate-100 text-slate-600"}`}><Icon className="h-5 w-5"/></span>
                    <span className="min-w-0 flex-1"><span className="block font-semibold text-slate-900">{method.label}</span><span className="mt-1 block text-xs text-slate-500">{method.description}</span></span>
                    {selected&&<CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600"/>}
                  </label>
                })}
              </div>

              {paymentMethod==="razorpay"&&<div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-600"/><div><p className="font-semibold text-emerald-900">Secure online checkout</p><p className="mt-1 text-xs leading-5 text-emerald-800">UPI, credit/debit cards, net banking and supported wallets are available inside the secure Razorpay checkout.</p></div></div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600 sm:grid-cols-4"><span className="flex items-center gap-1.5 rounded-lg bg-white p-2"><Smartphone className="h-4 w-4 text-emerald-600"/>UPI</span><span className="flex items-center gap-1.5 rounded-lg bg-white p-2"><CreditCard className="h-4 w-4 text-emerald-600"/>Cards</span><span className="flex items-center gap-1.5 rounded-lg bg-white p-2"><Landmark className="h-4 w-4 text-emerald-600"/>Banking</span><span className="flex items-center gap-1.5 rounded-lg bg-white p-2"><WalletCards className="h-4 w-4 text-emerald-600"/>Wallets</span></div>
              </div>}

              {paymentMethod==="wallet"&&<div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/60 p-4"><p className="font-semibold text-blue-900">Wallet balance</p><p className="mt-1 text-sm text-blue-800">Your wallet will be checked when the payment is created. If the balance is insufficient, choose another method.</p></div>}

              {paymentMethod==="cash"&&<div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4"><div className="flex gap-3"><Banknote className="mt-0.5 h-5 w-5 text-amber-600"/><div><p className="font-semibold text-amber-900">Cash on delivery</p><p className="mt-1 text-xs leading-5 text-amber-800">Keep the exact amount ready. Payment remains pending until the delivery is completed and cash is collected.</p></div></div></div>}
            </CardContent>
          </Card>          {/* Special Instructions */}
          <Card>
            <CardHeader>
              <CardTitle>Special Instructions</CardTitle>
              <CardDescription>Optional notes for the farmer or delivery partner</CardDescription>
            </CardHeader>
            <CardContent>
              <textarea
                value={specialInstructions}
                onChange={(e) => setSpecialInstructions(e.target.value)}
                placeholder="e.g., Leave at the gate, call before delivery"
                rows={3}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </CardContent>
          </Card>
        </div>

        {/* Order Summary Sidebar */}
        <div className="space-y-6">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Order Summary</CardTitle>
              <CardDescription>{itemCount} item(s) in your cart</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {items.map((item) => (
                <div key={item.id} className="flex gap-3 rounded-lg border p-3">
                  <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-md bg-slate-100">
                    <img
                      src={item.image || "/images/placeholder-product.jpg"}
                      alt={item.name}
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "/images/placeholder-product.jpg";
                      }}
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.farmerName || "Local Farmer"}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatPrice(item.originalPrice || item.price)} / unit</span>
                        <span className="text-slate-300">|</span>
                        <span>Qty: {item.quantity}</span>
                      </div>
                      <span className="text-sm font-semibold text-emerald-700">{formatPrice((item.originalPrice || item.price) * item.quantity)}</span>
                    </div>
                  </div>
                </div>
              ))}
              <div className="space-y-2">
                {couponAppliedCode ? (
                  <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
                    <span className="font-semibold text-emerald-700">{couponAppliedCode}</span>
                    <span className="flex items-center gap-2 text-emerald-700">
                      -{formatPrice(couponDiscount)}
                      <button
                        type="button"
                        onClick={handleRemoveCoupon}
                        className="text-slate-400 hover:text-slate-600"
                        title="Remove coupon"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </span>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      value={couponCode}
                      onChange={(e) => setCouponCode(e.target.value)}
                      placeholder="Coupon code (e.g. SUMMER20)"
                      className="flex-1"
                    />
                    <Button variant="outline" size="sm" onClick={handleApplyCoupon} disabled={applyingCoupon}>
                      {applyingCoupon ? "..." : "Apply"}
                    </Button>
                  </div>
                )}
                {couponError && <p className="text-xs text-red-500">{couponError}</p>}
              </div>
              <div className="border-t pt-3 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span>Subtotal</span>
                  <span>{formatPrice(displayTotal)}</span>
                </div>
                {couponDiscount > 0 && (
                  <div className="flex justify-between text-sm text-emerald-600">
                    <span>Coupon discount</span>
                    <span>-{formatPrice(couponDiscount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span>Delivery</span>
                  <span className="text-muted-foreground">
                    {isEstimatingFee ? (
                      "Calculating..."
                    ) : deliveryQuote ? (
                      deliveryQuote.freeDelivery && deliveryQuote.fee === 0 ? "Free" : formatPrice(deliveryQuote.fee)
                    ) : (
                      "Select address"
                    )}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Platform fee</span>
                  <span className="text-muted-foreground">{formatPrice(platformFeeValue)}</span>
                </div>
              <div className="flex justify-between border-t pt-2 text-sm font-semibold">
                  <span>Estimated total</span>
                  <span>{formatPrice(estimatedTotal)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Button
            className="w-full"
            size="lg"
            onClick={handlePlaceOrder}
            disabled={isPlacing}
          >
            {isPlacing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Placing order...
              </>
            ) : paymentMethod === "cash" ? (
              `Place Order · ${formatPrice(estimatedTotal)}`
            ) : (
              `Pay Online · ${formatPrice(estimatedTotal)}`
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
