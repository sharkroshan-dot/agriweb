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
  { value: "upi", label: "UPI", description: "GPay, PhonePe, Paytm, BHIM and other UPI apps", icon: Smartphone },
  { value: "card", label: "Card", description: "Credit, debit and RuPay cards", icon: CreditCard },
  { value: "netbanking", label: "Net Banking", description: "Pay securely through your bank", icon: Landmark },
  { value: "wallet", label: "AgriConnect Wallet", description: "Use your available wallet balance", icon: WalletCards },
  { value: "cash", label: "Cash on Delivery", description: "Pay when your order arrives", icon: Banknote },
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
  const [completedOrderId, setCompletedOrderId] = useState("");
  const [completedTransactionId, setCompletedTransactionId] = useState("");
  const [paymentStage, setPaymentStage] = useState("idle");
  const [paymentMessage, setPaymentMessage] = useState("");
  const [selectedUpiApp, setSelectedUpiApp] = useState("");
  const selectedUpiAppLabel = ({ gpay: "GPay", phonepe: "PhonePe", paytm: "Paytm" } as Record<string, string>)[selectedUpiApp] || "UPI";

  const { data: addressesData, isError: addressesError, refetch: refetchAddresses } = useQuery({
    queryKey: ["customerAddresses"],
    queryFn: () => api.get("/users/me/addresses"),
    enabled: items.length > 0 && status === "authenticated",
  });

  const { data: walletInfoData } = useQuery({
    queryKey: ["customerCheckoutWallet"],
    queryFn: () => api.get("/payments/wallet/info"),
    enabled: status === "authenticated" && paymentMethod === "wallet",
    retry: false,
  });

  const walletInfo = walletInfoData?.data || walletInfoData || {};
  const walletBalance = Number(
    walletInfo?.balance ?? walletInfo?.availableBalance ?? walletInfo?.wallet?.balance ?? 0
  );

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

  const openRazorpayCheckout = async (
    intentData: any,
    orderId: string,
    paymentMethodForGateway: string
  ) => {
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
        // Keep the customer's selected card method preselected when supported.
        // UPI/Net Banking/Wallet availability is still controlled by the
        // Razorpay account configuration and is selected inside Razorpay.
        ...(paymentMethodForGateway === "card" ? { method: "card" } : paymentMethodForGateway === "upi" ? { method: "upi" } : paymentMethodForGateway === "netbanking" ? { method: "netbanking" } : {}),
        handler: async (response: any) => {
          try {
            setIsPlacing(true);
            await api.post("/payments/verify", {
              payment_id: intentData.payment_id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            });
            setCompletedOrderId(orderId);
            setCompletedTransactionId(response.razorpay_payment_id || intentData.payment_id || "");
            setPaymentStage("success");
            setPaymentMessage("Payment verified successfully. Your order is confirmed.");
            clearCart();
            toast.success("Payment successful! Order placed.");
            resolve();
          } catch (err: any) {
            setPaymentStage("failed");
            setPaymentMessage("Payment confirmation failed. You can retry safely from your payment history.");
            toast.error(err?.message || "Payment could not be confirmed");
            resolve();
          } finally {
            setIsPlacing(false);
          }
        },
        modal: {
          ondismiss: () => {
            setPaymentStage("failed");
            setPaymentMessage("Payment was cancelled. Your order is still awaiting payment; you can retry safely.");
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

    if (paymentMethod !== "cash" && paymentMethod !== "wallet" && !razorpayReady) {
      toast.error("Payment gateway is still loading, please retry in a moment");
      return;
    }

    const selectedAddress = addresses.find((a) => a.id === addressId);
    if (selectedAddress && !/^\d{6}$/.test(selectedAddress.zip_code.trim())) {
      toast.error("Please select an address with a valid 6-digit PIN code.");
      return;
    }

    if (!deliveryQuote) {
      toast.error("Select a delivery address and wait for the delivery fee to be calculated before placing the order.");
      return;
    }

    setIsPlacing(true);
    setPaymentStage("creating");
    setPaymentMessage(paymentMethod === "wallet" ? "Checking your AgriConnect wallet balance…" : paymentMethod === "cash" ? "Preparing cash-on-delivery order…" : "Creating your secure payment session…");

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
          variantId: item.variantId || undefined,
          quantity: item.quantity,
          unitPrice: item.price,
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
        setCompletedOrderId(order.id || order._id);
        setPaymentStage("success");
        setPaymentMessage("Cash on delivery selected. Your order is confirmed and payment will be collected at delivery.");
        clearCart();
        toast.success("Order placed successfully!");
      } else {
        // Online payment via Razorpay Checkout
        setPaymentMessage("Opening secure payment gateway…");
        setPaymentStage("processing");
        const intent = await api.post("/payments/create-intent", {
          order_id: order.id || order._id,
          payment_method: paymentMethod,
        });
        const intentData = intent?.data || intent;

        if (paymentMethod === "wallet") {
          if (intentData?.status !== "success") throw new Error(intentData?.error || "Wallet payment failed");
          setPaymentStage("success");
          setCompletedOrderId(order.id || order._id);
          setCompletedTransactionId(intentData.payment_id || "");
          setPaymentMessage(intentData.message || "Wallet payment completed successfully. Your order is confirmed.");
          clearCart();
          toast.success("Wallet payment successful!");
          return;
        }

        if (!intentData?.order_id) {
          throw new Error(intentData?.error || "Payment initiation failed");
        }

        await openRazorpayCheckout(
          intentData,
          order.id || order._id,
          paymentMethod
        );
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

  if (paymentStage === "success") {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/orders"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">Order confirmation</h1>
            <p className="text-sm text-muted-foreground">Your payment and order have been processed.</p>
          </div>
        </div>
        <Card className="border-emerald-200 bg-emerald-50/70">
          <CardContent className="p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <div className="rounded-full bg-emerald-100 p-3"><CheckCircle2 className="h-7 w-7 text-emerald-600" /></div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-emerald-950">Payment successful</h2>
                <p className="mt-1 text-sm text-emerald-800">{paymentMessage}</p>
                {completedTransactionId && <p className="mt-2 text-xs text-emerald-900">Transaction ID: <span className="font-mono font-semibold">{completedTransactionId}</span></p>}
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <Button asChild><Link href={completedOrderId ? `/orders/${completedOrderId}` : "/orders"}>View order</Link></Button>
                  <Button variant="outline" asChild><Link href="/payments">Payment history</Link></Button>
                  <Button variant="outline" onClick={() => window.print()}>Print receipt</Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
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
        <Card className={`border-2 ${paymentStage==="failed"?"border-red-200 bg-red-50/60":"border-blue-200 bg-blue-50/60"}`}>
          <CardContent className="flex items-center gap-3 p-4">
            {paymentStage==="failed" ? <X className="h-5 w-5 text-red-600"/> : <Loader2 className="h-5 w-5 animate-spin text-blue-600"/>}
            <div><p className="font-semibold text-slate-900">{paymentStage==="creating"?"Preparing payment":paymentStage==="processing"?"Payment processing":"Payment needs attention"}</p><p className="text-xs text-slate-600">{paymentMessage}</p></div>
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
          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <CardHeader className="border-b bg-white px-5 py-5">
              <CardTitle className="flex items-center gap-2 text-lg">
                <CreditCard className="h-5 w-5 text-emerald-600" />
                Payment Method
              </CardTitle>
              <CardDescription>
                Choose how you want to pay. Only the selected method opens its payment options.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-3 p-4 sm:p-5">
              {PAYMENT_METHODS.map((method: any) => {
                const Icon = method.icon;
                const selected = paymentMethod === method.value;

                return (
                  <div
                    key={method.value}
                    className={`overflow-hidden rounded-xl border-2 transition-all ${selected
                      ? "border-emerald-500 bg-emerald-50/40 shadow-sm"
                      : "border-slate-200 bg-white hover:border-slate-300"}`}
                  >
                    <button
                      type="button"
                      onClick={() => setPaymentMethod(method.value)}
                      className="flex w-full items-center gap-3 p-4 text-left"
                      aria-expanded={selected}
                    >
                      <span
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${selected
                          ? "bg-emerald-600 text-white"
                          : "bg-slate-100 text-slate-600"}`}
                      >
                        <Icon className="h-5 w-5" />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 font-semibold text-slate-900">
                          {method.label}
                          {selected && (
                            <span className="text-xs font-medium text-emerald-700">Selected</span>
                          )}
                        </span>
                        <span className="mt-1 block text-xs text-slate-500">
                          {method.description}
                        </span>
                      </span>

                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${selected
                          ? "border-emerald-600"
                          : "border-slate-300"}`}
                      >
                        {selected && <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />}
                      </span>
                    </button>

                    {selected && (
                      <div className="border-t border-slate-200 bg-white px-4 pb-4 pt-4">
                        {paymentMethod === "upi" && (
                          <div className="space-y-4">
                            <div>
                              <p className="font-semibold text-slate-900">Choose your UPI app</p>
                              <p className="mt-1 text-xs text-slate-500">
                                GPay, PhonePe, Paytm and other supported UPI options will open securely in Razorpay Checkout.
                              </p>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              {([["gpay", "GPay"], ["phonepe", "PhonePe"], ["paytm", "Paytm"]] as const).map(([app, label]) => (
                                <button key={app} type="button" onClick={() => {
                                  setSelectedUpiApp(app);
                                  setPaymentStage("idle");
                                  setPaymentMessage("");
                                }}
                                className={selectedUpiApp === app ? "rounded-lg border border-emerald-500 bg-emerald-50 px-3 py-2.5 text-center text-xs font-semibold text-emerald-800" : "rounded-lg border bg-slate-50 px-3 py-2.5 text-center text-xs font-semibold text-slate-700 hover:border-emerald-300"}>{label}</button>
                              ))}
                            </div>
                            {selectedUpiApp && (
                              <div className="space-y-3">
                                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                                  <div className="flex items-center justify-between gap-3">
                                    <div>
                                      <p className="font-semibold">{selectedUpiAppLabel} selected</p>
                                      <p className="mt-1">
                                        Your selection is ready. Continue to Razorpay Checkout to start the secure UPI payment.
                                      </p>
                                    </div>
                                    <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600" />
                                  </div>
                                </div>

                                {paymentStage === "creating" && (
                                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                                    <div className="flex items-center gap-2 font-semibold">
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                      Creating secure payment session…
                                    </div>
                                    <p className="mt-1 pl-6">
                                      AgriConnect is creating the Razorpay payment order. Your order is not marked paid yet.
                                    </p>
                                  </div>
                                )}

                                {paymentStage === "processing" && (
                                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                                    <div className="flex items-center gap-2 font-semibold">
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                      Opening Razorpay Secure Checkout…
                                    </div>
                                    <p className="mt-1 pl-6">
                                      Complete the UPI payment in the Razorpay window. AgriConnect will confirm the order only after the gateway response is verified.
                                    </p>
                                  </div>
                                )}

                                {paymentStage === "failed" && (
                                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                                    <p className="font-semibold">Payment was not completed</p>
                                    <p className="mt-1">
                                      Your order is not marked paid. Check the Razorpay checkout and try again.
                                    </p>
                                  </div>
                                )}

                                <Button
                                  type="button"
                                  className="w-full"
                                  size="lg"
                                  onClick={handlePlaceOrder}
                                  disabled={isPlacing}
                                >
                                  {isPlacing ? (
                                    <>
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                      Opening secure checkout…
                                    </>
                                  ) : (
                                    <>Pay {formatPrice(estimatedTotal)} with {selectedUpiAppLabel}</>
                                  )}
                                </Button>
                              </div>
                            )}
                            <div className="flex items-center gap-3">
                              <div className="h-px flex-1 bg-slate-200" />
                              <span className="text-xs font-medium text-slate-400">OR</span>
                              <div className="h-px flex-1 bg-slate-200" />
                            </div>
                            <div className="rounded-lg border bg-slate-50 p-3">
                              <p className="text-xs font-medium text-slate-700">UPI ID</p>
                              <p className="mt-1 text-xs text-slate-500">
                                You can enter or select your UPI option in the secure Razorpay window.
                              </p>
                            </div>
                          </div>
                        )}

                        {paymentMethod === "card" && (
                          <div className="space-y-4">
                            <div>
                              <p className="font-semibold text-slate-900">Credit / Debit Card</p>
                              <p className="mt-1 text-xs text-slate-500">
                                Card number, expiry and CVV are collected securely by Razorpay. AgriConnect never stores raw card details.
                              </p>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-xs font-semibold text-slate-600">
                              {["Visa", "Mastercard", "RuPay"].map((brand) => (
                                <div key={brand} className="rounded-lg border bg-slate-50 p-2.5 text-center">
                                  {brand}
                                </div>
                              ))}
                            </div>
                            <div className="rounded-lg border bg-slate-50 p-3 text-xs text-slate-500">
                              Your secure card fields will appear in Razorpay Checkout after you continue.
                            </div>
                          </div>
                        )}

                        {paymentMethod === "netbanking" && (
                          <div className="space-y-4">
                            <div>
                              <p className="font-semibold text-slate-900">Select your bank</p>
                              <p className="mt-1 text-xs text-slate-500">
                                Bank authentication is handled securely by Razorpay.
                              </p>
                            </div>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                              {["SBI", "HDFC Bank", "ICICI Bank", "Axis Bank", "Kotak Mahindra", "Other banks"].map((bank) => (
                                <div key={bank} className="rounded-lg border bg-slate-50 p-2.5 text-center text-xs font-medium text-slate-700">
                                  {bank}
                                </div>
                              ))}
                            </div>
                            <p className="text-xs text-slate-500">
                              The complete bank list and login flow are provided by Razorpay Checkout.
                            </p>
                          </div>
                        )}

                        {paymentMethod === "wallet" && (
                          <div className="space-y-4">
                            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-blue-900">Available balance</span>
                                <span className="text-xl font-bold text-blue-950">
                                  {formatPrice(walletBalance)}
                                </span>
                              </div>
                              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-blue-200 pt-3 text-sm">
                                <div>
                                  <p className="text-xs text-blue-700">Order amount</p>
                                  <p className="font-semibold text-blue-950">{formatPrice(estimatedTotal)}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-blue-700">Remaining balance</p>
                                  <p className="font-semibold text-blue-950">
                                    {formatPrice(Math.max(0, walletBalance - estimatedTotal))}
                                  </p>
                                </div>
                              </div>
                            </div>
                            {walletBalance < estimatedTotal && (
                              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                                <span className="font-semibold">Insufficient wallet balance.</span> Choose another payment method to continue.
                              </div>
                            )}
                            {walletBalance >= estimatedTotal && (
                              <p className="flex items-center gap-2 text-xs text-blue-700">
                                <ShieldCheck className="h-4 w-4" />
                                Wallet payment is processed securely by AgriConnect.
                              </p>
                            )}
                          </div>
                        )}

                        {paymentMethod === "cash" && (
                          <div className="space-y-3">
                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                              <div className="flex items-start gap-3">
                                <Banknote className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                                <div>
                                  <p className="font-semibold text-amber-900">Pay when your order arrives</p>
                                  <p className="mt-1 text-sm text-amber-800">
                                    Pay {formatPrice(estimatedTotal)} to the delivery partner when your order is delivered.
                                  </p>
                                </div>
                              </div>
                            </div>
                            {defaultAddress && (
                              <div className="rounded-lg border bg-slate-50 p-3 text-xs text-slate-600">
                                <p className="font-medium text-slate-800">Delivery Address</p>
                                <p className="mt-1">{defaultAddress.address_line1}</p>
                                <p>{defaultAddress.city}, {defaultAddress.state} - {defaultAddress.zip_code}</p>
                              </div>
                            )}
                            <p className="text-xs text-amber-700">
                              COD availability is validated when the order is submitted. If it is not available, choose another method.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="mt-5 border-t pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">Total payable</span>
                  <span className="text-xl font-bold text-slate-950">{formatPrice(estimatedTotal)}</span>
                </div>

                <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span>
                    {paymentMethod === "cash"
                      ? "No online payment is taken for Cash on Delivery."
                      : "Payment is verified securely before the order is marked paid."}
                  </span>
                </div>

                {!(paymentMethod === "upi" && selectedUpiApp) && (
                  <Button
                    className="mt-4 w-full"
                    size="lg"
                    onClick={handlePlaceOrder}
                    disabled={isPlacing || (paymentMethod === "wallet" && walletBalance < estimatedTotal)}
                  >
                    {isPlacing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {paymentMethod === "cash" ? "Placing order..." : "Processing payment..."}
                      </>
                    ) : paymentMethod === "cash" ? (
                      `Place order · ${formatPrice(estimatedTotal)}`
                    ) : paymentMethod === "wallet" ? (
                      `Pay ${formatPrice(estimatedTotal)} from Wallet`
                    ) : (
                      `Pay ${formatPrice(estimatedTotal)}`
                    )}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

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

        </div>
      </div>
    </div>
  );
}
