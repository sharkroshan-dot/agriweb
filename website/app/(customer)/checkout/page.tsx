"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ShoppingCart, MapPin, ArrowLeft, Plus, CreditCard, Loader2, X, Truck, CalendarClock, Leaf, ShieldCheck, Smartphone, Landmark, Banknote, WalletCards, CheckCircle2, Home, Building2, Pencil, Trash2, ClipboardList, Headphones, Phone, Package, Clock3, CalendarDays, Coins } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { useCartStore } from "../../lib/store/cart-store";
import { api } from "../../lib/api/client";
import { formatDate, formatPrice } from "../../lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { PageErrorState } from "../../components/common/page-state";
import { CustomerPageHeader } from "../../components/customer/customer-page-header";

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
  serviceAvailable?: boolean;
  partnerAvailable?: boolean;
  availablePartnerCount?: number;
  fastestEligible?: boolean;
  estimatedDeliveryMinutes?: number | null;
  availabilityStatus?: string;
  availabilityMessage?: string;
  nextDeliveryServiceAt?: string | null;
};

type DeliveryAvailability = {
  serviceAvailable: boolean;
  partnerAvailable: boolean;
  availablePartnerCount: number;
  status: string;
  message: string;
  nextServiceAt?: string | null;
};


type Address = {
  id: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  zip_code: string;
  country: string;
  phone_number?: string;
  alternative_phone_number?: string;
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
  phone_number: "",
  alternative_phone_number: "",
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
  const [paymentMethod, setPaymentMethod] = useState("upi");
  const [isPlacing, setIsPlacing] = useState(false);
  const [showAddrForm, setShowAddrForm] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [addrForm, setAddrForm] = useState(initialAddrForm);
  const [razorpayReady, setRazorpayReady] = useState(false);
  const [savingAddr, setSavingAddr] = useState(false);
  const [deliveryQuote, setDeliveryQuote] = useState<DeliveryQuote | null>(null);
  const [deliveryAvailability, setDeliveryAvailability] = useState<DeliveryAvailability | null>(null);
  const [isEstimatingFee, setIsEstimatingFee] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
  const [deliveryTimeSlot, setDeliveryTimeSlot] = useState("morning");
  const [selectedDeliverySlotId, setSelectedDeliverySlotId] = useState("");
  const [selectedDeliverySpeed, setSelectedDeliverySpeed] = useState<"fastest_30m" | "standard">("standard");
  const [couponCode, setCouponCode] = useState("");
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponAppliedCode, setCouponAppliedCode] = useState("");
  const [couponError, setCouponError] = useState("");
  const [applyingCoupon, setApplyingCoupon] = useState(false);
  const [agriPointsInput, setAgriPointsInput] = useState("");
  const [appliedAgriPoints, setAppliedAgriPoints] = useState(0);
  const [agriPointsError, setAgriPointsError] = useState("");
  const [stockAdjustment, setStockAdjustment] = useState<{ productId: string; requested: number; available: number } | null>(null);
  const [completedOrderId, setCompletedOrderId] = useState("");
  const [completedOrderSnapshot, setCompletedOrderSnapshot] = useState<any>(null);
  const [completedTransactionId, setCompletedTransactionId] = useState("");
  const [paymentStage, setPaymentStage] = useState("idle");
  const [paymentMessage, setPaymentMessage] = useState("");
  const [selectedUpiApp, setSelectedUpiApp] = useState("");
  const selectedUpiAppLabel = ({ gpay: "GPay", phonepe: "PhonePe", paytm: "Paytm" } as Record<string, string>)[selectedUpiApp] || "UPI";
  const saveOrderConfirmation = (
    orderId: string,
    message: string,
    transactionId = "",
    orderSnapshot?: any
  ) => {
    if (typeof window === "undefined") return;
    try {
      let snapshot = orderSnapshot;
      if (!snapshot) {
        const pending = window.sessionStorage.getItem("agriconnect:pending-order-snapshot");
        snapshot = pending ? JSON.parse(pending) : null;
      }
      const confirmation = {
        orderId,
        message,
        transactionId,
        orderSnapshot: snapshot || null,
        savedAt: new Date().toISOString(),
      };
      window.sessionStorage.setItem("agriconnect:completed-order-confirmation", JSON.stringify(confirmation));
      window.sessionStorage.removeItem("agriconnect:pending-order-snapshot");
    } catch {
      // Keep the in-memory confirmation available if browser storage is blocked.
    }
  };


  // Zustand persist restores the cart from localStorage after the first client render.
  // Do not interpret its temporary empty SSR state as a genuinely empty cart.
  const [cartHydrated, setCartHydrated] = useState(false);
  useEffect(() => {
    const unsubscribe = useCartStore.persist.onFinishHydration(() => setCartHydrated(true));
    if (useCartStore.persist.hasHydrated()) {
      setCartHydrated(true);
    } else {
      void useCartStore.persist.rehydrate();
    }
    return unsubscribe;
  }, []);

  // Restore the completed order confirmation after normal refresh or hard refresh.
  // Never redirect customers automatically after a successful order.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.sessionStorage.getItem("agriconnect:completed-order-confirmation");
      if (!saved) return;
      const confirmation = JSON.parse(saved);
      if (!confirmation?.orderId) return;
      setCompletedOrderId(String(confirmation.orderId));
      setCompletedTransactionId(String(confirmation.transactionId || ""));
      setPaymentMessage(String(confirmation.message || "Your order is confirmed."));
      if (confirmation.orderSnapshot) setCompletedOrderSnapshot(confirmation.orderSnapshot);
      setPaymentStage("success");
    } catch {
      // Ignore invalid or unavailable session data and continue with checkout.
    }
  }, []);


  const { data: addressesData, isError: addressesError, refetch: refetchAddresses } = useQuery({
    queryKey: ["customerAddresses"],
    queryFn: () => api.get("/users/me/addresses"),
    enabled: items.length > 0 && status === "authenticated",
  });

  const { data: profileData } = useQuery({
    queryKey: ["checkout-customer-profile"],
    queryFn: () => api.get("/users/me"),
    enabled: status === "authenticated",
    staleTime: 60_000,
  });
  // The /users/me profile endpoint returns the customer record under "user".
  // Support both the normalized API response and older nested response envelopes.
  const profilePayload = profileData?.data ?? profileData ?? {};
  const profileUser =
    profilePayload?.user ??
    profileData?.user ??
    profilePayload?.profile ??
    profileData?.profile ??
    profilePayload;
  const profilePhone = String(
    profileUser?.phone ??
    profileUser?.phone_number ??
    profileUser?.phoneNumber ??
    profilePayload?.phone ??
    profileData?.phone ??
    ""
  ).trim();


  const { data: loyaltyPointsResponse, isLoading: loyaltyPointsLoading } = useQuery({
    queryKey: ["checkout-agri-points"],
    queryFn: () => api.get("/loyalty/me"),
    enabled: status === "authenticated",
    staleTime: 0,
    refetchOnMount: "always",
    retry: 1,
  });
  const loyaltyPointsPayload = loyaltyPointsResponse?.data ?? loyaltyPointsResponse ?? {};
  const availableAgriPoints = Math.max(0, Number(loyaltyPointsPayload?.redeemablePoints ?? loyaltyPointsPayload?.balance ?? 0));

  const { data: walletInfoData } = useQuery({
    queryKey: ["customerCheckoutWallet"],
    queryFn: () => api.get("/payments/wallet/info"),
    enabled: status === "authenticated" && paymentMethod === "wallet",
    retry: false,
  });

  const { data: completedOrderResponse } = useQuery({
    queryKey: ["checkout-completed-order", completedOrderId],
    queryFn: () => api.get(`/orders/${completedOrderId}`),
    enabled: Boolean(completedOrderId) && paymentStage === "success",
    refetchInterval: paymentStage === "success" ? 15000 : false,
    retry: 1,
  });

  const completedOrder = completedOrderResponse?.data || completedOrderResponse || completedOrderSnapshot || {};


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

  const selectedCheckoutAddress = addresses.find((address) => address.id === estimatedDeliveryAddressId);
  const { data: checkoutSlotsData, isLoading: checkoutSlotsLoading, isError: checkoutSlotsError, refetch: refetchCheckoutSlots } = useQuery({
    queryKey: [
      "checkout-delivery-slots",
      estimatedDeliveryAddressId,
      deliveryDate,
    ],
    queryFn: () => api.get("/delivery-slots/available", {
      // Fetch all upcoming farmer-published slots first. The previous strict
      // city/PIN regex hid valid village-level slots when the customer address
      // used its parent town or district (for example, village vs. district).
      // Each result still shows the farmer's published service area and radius.
      params: { radius: 100 },
    }),
    enabled: Boolean(estimatedDeliveryAddressId) && items.length > 0 && status === "authenticated",
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
    retry: 2,
  });
  const checkoutCartWeightKg = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const checkoutSlots = (checkoutSlotsData?.data?.slots || checkoutSlotsData?.slots || [])
    .filter((slot: any) => {
      if (slot.status !== "open" || Number(slot.remainingCapacityKg ?? slot.maxCapacityKg ?? 0) <= 0) return false;
      // Farmer slot timestamps are UTC; checkout dates are India-local.
      const parsedDate = new Date(slot.date);
      if (Number.isNaN(parsedDate.getTime())) return false;
      const slotDate = parsedDate.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      return slotDate === deliveryDate;
    })
    .sort((a: any, b: any) => String(a.startTime || "").localeCompare(String(b.startTime || "")));
  const selectedCheckoutSlot = checkoutSlots.find((slot: any) => slot.id === selectedDeliverySlotId);

  useEffect(() => {
    // A slot selected for another date/address must never remain attached to
    // this checkout. Customers must choose one of the slots actually shown.
    setSelectedDeliverySlotId("");
  }, [deliveryDate, selectedCheckoutAddress?.id]);

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

  useEffect(() => {
    if (!estimatedDeliveryAddressId || items.length === 0) {
      setDeliveryAvailability(null);
      return;
    }
    let cancelled = false;
    api.post("/delivery/availability", {
      items: items.map((item) => ({ productId: item.id, quantity: item.quantity })),
      deliveryAddressId: estimatedDeliveryAddressId,
    }).then((res) => {
      if (cancelled) return;
      const body = res?.data || res;
      setDeliveryAvailability(body?.data || body || null);
    }).catch(() => {
      if (!cancelled) setDeliveryAvailability(null);
    });
    return () => { cancelled = true; };
  }, [estimatedDeliveryAddressId, items]);

  useEffect(() => {
    const nextServiceAt = deliveryAvailability?.nextServiceAt;
    if (!nextServiceAt) return;

    // The backend is authoritative for the next delivery handoff. This is
    // either the next available partner retry during 06:00–21:30 or the next
    // 06:00 service start during 21:30–06:00.
    const next = new Date(nextServiceAt);
    if (Number.isNaN(next.getTime())) return;

    setDeliveryDate(next.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
    setDeliveryTimeSlot(
      deliveryAvailability?.status === "scheduled_for_next_service"
        ? "morning"
        : "next_available"
    );
  }, [deliveryAvailability?.nextServiceAt, deliveryAvailability?.status]);

  const handleAddrChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setAddrForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const resetAddressForm = () => {
    setAddrForm(initialAddrForm);
    setEditingAddressId(null);
    setShowAddrForm(false);
  };

  const handleEditAddress = (address: Address) => {
    setEditingAddressId(address.id);
    setAddrForm({
      address_line1: address.address_line1 || "",
      address_line2: address.address_line2 || "",
      city: address.city || "",
      state: address.state || "",
      zip_code: address.zip_code || "",
      country: address.country || "India",
      landmark: (address as any).landmark || "",
      phone_number: address.phone_number || profilePhone,
      alternative_phone_number: address.alternative_phone_number || "",
      address_type: address.address_type || "home",
    });
    setShowAddrForm(true);
  };

  const handleDeleteAddress = async (address: Address) => {
    const confirmed = window.confirm(`Delete this ${address.address_type || "saved"} address? This action cannot be undone.`);
    if (!confirmed) return;
    try {
      await api.delete(`/users/me/addresses/${address.id}`);
      if (selectedAddressId === address.id) setSelectedAddressId("");
      await queryClient.refetchQueries({ queryKey: ["customerAddresses"] });
      toast.success("Address deleted successfully");
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete address");
    }
  };

  const handleAddAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addrForm.address_line1.trim() || !addrForm.city.trim() || !addrForm.state.trim() || !/^\d{6}$/.test(addrForm.zip_code.trim())) {
      toast.error("Enter the address, city, state and a valid 6-digit PIN code.");
      return;
    }
    setSavingAddr(true);
    try {
      if (editingAddressId) {
        await api.put(`/users/me/addresses/${editingAddressId}`, addrForm);
        setSelectedAddressId(editingAddressId);
      } else {
        await api.post("/users/me/addresses", addrForm);
      }
      await queryClient.refetchQueries({ queryKey: ["customerAddresses"] });
      resetAddressForm();
      toast.success(editingAddressId ? "Address updated successfully" : "Address added successfully");
    } catch (err: any) {
      const message = err?.message || (editingAddressId ? "Failed to update address" : "Failed to add address");
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
            saveOrderConfirmation(orderId, "Payment verified successfully. Your order is confirmed.", response.razorpay_payment_id || intentData.payment_id || "");
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

  const maxAgriPointsByOrder = Math.floor(Math.max(0, displayTotal - couponDiscount)) * 100;
  const maxAgriPoints = Math.min(Math.floor(availableAgriPoints / 100) * 100, maxAgriPointsByOrder, 10000);
  const effectiveAgriPoints = Math.min(appliedAgriPoints, maxAgriPoints);
  const agriPointsDiscount = effectiveAgriPoints / 100;

  const handleApplyAgriPoints = () => {
    const points = Number(agriPointsInput);
    setAgriPointsError("");
    if (!Number.isInteger(points) || points <= 0) {
      setAgriPointsError("Enter a whole number of points to redeem.");
      return;
    }
    if (points % 100 !== 0) {
      setAgriPointsError("Points must be in multiples of 100 (100 points = ₹1).");
      return;
    }
    if (points > availableAgriPoints) {
      setAgriPointsError(`You have only ${availableAgriPoints.toLocaleString("en-IN")} points available.`);
      return;
    }
    if (points > maxAgriPointsByOrder) {
      setAgriPointsError("The AgriPoints discount cannot exceed your eligible product amount.");
      return;
    }
    if (points > 10000) {
      setAgriPointsError("You can redeem up to 10,000 points per order.");
      return;
    }
    setAppliedAgriPoints(points);
    toast.success(`${points.toLocaleString("en-IN")} AgriPoints applied (₹${(points / 100).toFixed(2)} off).`);
  };

  const handleRemoveAgriPoints = () => {
    setAppliedAgriPoints(0);
    setAgriPointsInput("");
    setAgriPointsError("");
  };

  const deliveryFeeValue = deliveryQuote?.fee ?? 0;
  const platformFeeValue = Math.max(0, displayTotal * 0.05);
  const estimatedTotal = Math.max(0, displayTotal - couponDiscount - agriPointsDiscount + deliveryFeeValue + platformFeeValue);
  const fastestDeliveryAvailable =
    deliveryQuote?.fastestEligible === true &&
    Number(deliveryQuote?.estimatedDeliveryMinutes) <= 30 &&
    deliveryAvailability?.serviceAvailable === true &&
    deliveryAvailability?.partnerAvailable === true;

  useEffect(() => {
    setSelectedDeliverySpeed(fastestDeliveryAvailable ? "fastest_30m" : "standard");
  }, [
    fastestDeliveryAvailable,
  ]);


  const handlePlaceOrder = async (quantityOverrides?: Record<string, number>) => {
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
    const primaryContact = selectedAddress?.phone_number?.trim() || profilePhone;
    const primaryContactDigits = primaryContact.replace(/\\D/g, "");
    if (
      !primaryContact ||
      !/^[+0-9\\s()-]+$/.test(primaryContact) ||
      primaryContactDigits.length < 10 ||
      primaryContactDigits.length > 15
    ) {
      toast.error("A valid primary phone number is required. Your profile number is filled automatically; you can change it in the delivery address form.");
      return;
    }
    if (selectedAddress && !selectedAddress.phone_number?.trim()) {
      try {
        await api.put(`/users/me/addresses/${addressId}`, {
          address_line1: selectedAddress.address_line1,
          address_line2: selectedAddress.address_line2 || "",
          city: selectedAddress.city,
          state: selectedAddress.state,
          zip_code: selectedAddress.zip_code,
          country: selectedAddress.country || "India",
          landmark: (selectedAddress as any).landmark || "",
          phone_number: primaryContact,
          alternative_phone_number: selectedAddress.alternative_phone_number || "",
          address_type: selectedAddress.address_type || "home",
        });
        await queryClient.refetchQueries({ queryKey: ["customerAddresses"] });
      } catch (error: any) {
        toast.error(error?.message || "Could not save the profile phone number to this delivery address.");
        return;
      }
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
          quantity: quantityOverrides?.[item.id] ?? item.quantity,
          unitPrice: item.price,
        })),
        deliveryAddressId: addressId,
        paymentMethod,
        deliveryType: "delivery",
        requestedDeliveryDate: new Date(`${deliveryDate}T00:00:00`).toISOString(),
        idempotencyKey: idempotencyKeyRef.current,
        deliveryTimeSlot,
        deliverySlotId: selectedCheckoutSlot?.id || undefined,
        deliverySpeed: selectedDeliverySpeed,
      };

      if (couponAppliedCode) {
        payload.couponCode = couponAppliedCode;
      }
      if (effectiveAgriPoints > 0) {
        payload.redeemPoints = effectiveAgriPoints;
      }

      const res = await api.post("/orders/", payload);
      const order = res?.data || res;

      if (!order) throw new Error("Failed to create order");
      try {
        window.sessionStorage.setItem("agriconnect:pending-order-snapshot", JSON.stringify(order));
      } catch {
        // The server order remains authoritative if browser storage is unavailable.
      }

      if (paymentMethod === "cash") {
        setCompletedOrderId(order.id || order._id);
        setPaymentStage("success");
        setPaymentMessage("Cash on delivery selected. Your order is confirmed and payment will be collected at delivery.");
        setCompletedOrderSnapshot(order);
        saveOrderConfirmation(order.id || order._id, "Cash on delivery selected. Your order is confirmed and payment will be collected at delivery.", "", order);
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
          setCompletedOrderSnapshot(order);
          saveOrderConfirmation(order.id || order._id, intentData.message || "Wallet payment completed successfully. Your order is confirmed.", intentData.payment_id || "", order);
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
      const msg = err?.message || "";
      setPaymentMessage(
        paymentMethod === "cash"
          ? (msg ? `Order could not be placed: ${msg}` : "Order could not be placed. Please review the checkout details and try again.")
          : (msg || "Checkout could not be completed. Please review the details and try again.")
      );
      const shortageMatch = msg.match(/STOCK_SHORTAGE\|([a-f0-9]{24})\|([0-9.]+)\|([0-9.]+)/i);
      let detail = err?.response?.data?.detail ?? err?.detail;
      if (!detail && typeof msg === "string" && msg.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(msg);
          detail = parsed?.detail ?? parsed;
        } catch {
          detail = null;
        }
      }
      const shortage = detail?.code === "STOCK_SHORTAGE"
        ? { productId: String(detail.productId), available: Number(detail.availableQuantity), requested: Number(detail.requestedQuantity) }
        : shortageMatch
          ? { productId: shortageMatch[1], available: Number(shortageMatch[2]), requested: Number(shortageMatch[3]) }
          : null;
      if (shortage && shortage.available > 0 && shortage.available < shortage.requested) {
        setStockAdjustment(shortage);
        toast("Stock changed while you were checking out. Please confirm the available quantity.");
      } else if (msg.includes("Product not found")) {
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
    const order = completedOrder || {};
    const orderItems = Array.isArray(order.items) ? order.items : [];
    const address = order.deliveryAddress || order.delivery_address || {};
    const orderStatus = String(order.status || order.orderStatus || "confirmed").toLowerCase();
    const paymentMethodLabel = String(order.paymentMethod || paymentMethod || "cash").toLowerCase();
    const isCashOnDelivery = paymentMethodLabel === "cash" || paymentMethodLabel === "cod";
    const orderNumber = order.orderNumber || order.order_number || order.id || order._id || completedOrderId;
    const placedAt = order.createdAt || order.orderDate || order.created_at || new Date().toISOString();
    const addressLines = [address.addressLine1 || address.address_line1, address.addressLine2 || address.address_line2, address.landmark, address.city, address.state, address.zipCode || address.zip_code || address.postalCode].filter(Boolean);
    const primaryPhone = address.phoneNumber || address.phone_number || address.phone || "";
    const alternatePhone = address.alternativePhoneNumber || address.alternative_phone_number || address.alternativePhone || "";
    const subtotal = Number(order.subtotal ?? order.subTotal ?? order.totalBeforeDelivery ?? orderItems.reduce((sum: number, item: any) => sum + Number(item.totalPrice ?? (Number(item.unitPrice || 0) * Number(item.quantity || 0))), 0));
    const deliveryCharge = Number(order.deliveryCharge ?? order.deliveryFee ?? 0);
    const platformFee = Number(order.platformFee ?? 0);
    const discount = Number(order.discount ?? 0);
    const total = Number(order.totalAmount ?? order.total ?? (subtotal + deliveryCharge + platformFee - discount));
    const stages = [
      { label: "Order placed", keys: ["pending", "placed"], icon: ClipboardList },
      { label: "Order confirmed", keys: ["confirmed"], icon: CheckCircle2 },
      { label: "Farmer preparing", keys: ["preparing", "processing", "ready_for_delivery", "packed"], icon: Package },
      { label: "Out for delivery", keys: ["dispatched", "in_transit", "out_for_delivery", "shipped", "delivered"], icon: Truck },
    ];
    const stageIndex = orderStatus === "delivered" ? 3 : ["dispatched", "in_transit", "out_for_delivery", "shipped"].includes(orderStatus) ? 3 : ["preparing", "processing", "ready_for_delivery", "packed"].includes(orderStatus) ? 2 : ["confirmed", "accepted"].includes(orderStatus) ? 1 : 0;
    const paymentLabel = isCashOnDelivery ? "Cash on Delivery (COD)" : String(order.paymentMethod || paymentMethod).toUpperCase();
    const totalQuantity = orderItems.reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0);

    return (
      <div className="customer-retail-shell space-y-4 pb-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 ring-4 ring-emerald-50"><CheckCircle2 className="h-9 w-9" /></div>
            <div>
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500"><Link href="/" className="hover:text-emerald-700">Home</Link><span>›</span><Link href="/checkout" className="hover:text-emerald-700">Checkout</Link><span>›</span><span className="text-slate-800">Order confirmation</span></div>
              <h1 className="text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl">Order placed successfully!</h1>
              <p className="text-sm text-slate-600">Thank you for shopping with AgriConnect. Your order is confirmed.</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50/70 px-4 py-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-emerald-700"><ClipboardList className="h-6 w-6" /></div>
            <div><p className="text-sm font-bold text-slate-900">Order <span className="text-emerald-700">#{orderNumber}</span></p><p className="text-xs text-slate-600">Placed on {formatDate(placedAt)}</p></div>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-emerald-300 bg-gradient-to-r from-emerald-50 to-green-100 px-5 py-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Truck className="h-7 w-7" /></div>
          <div className="min-w-0 border-l border-emerald-300 pl-4">
            <p className="font-extrabold text-emerald-800">{isCashOnDelivery ? "Order confirmed – Cash on Delivery" : "Payment confirmed"}</p>
            <p className="text-sm text-slate-700">{paymentMessage || (isCashOnDelivery ? "Payment will be collected by the delivery partner when your order arrives." : "Your payment has been verified and your order is confirmed.")}</p>
            {completedTransactionId && <p className="mt-1 text-xs text-slate-600">Transaction ID: {completedTransactionId}</p>}
          </div>
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(330px,0.9fr)]">
          <div className="space-y-3">
            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-lg"><Truck className="h-5 w-5 text-emerald-700" /> Delivery progress</CardTitle></CardHeader>
              <CardContent className="px-4 pb-5 pt-2">
                <div className="grid grid-cols-4 gap-1">
                  {stages.map((stage, index) => {
                    const Icon = stage.icon;
                    const complete = index < stageIndex || index === 0;
                    const active = index === stageIndex;
                    return <div key={stage.label} className="relative flex flex-col items-center text-center">
                      {index < stages.length - 1 && <div className={`absolute left-1/2 top-4 h-0.5 w-full ${index < stageIndex ? "bg-emerald-600" : "bg-slate-200"}`} />}
                      <div className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-full border-2 ${complete ? "border-emerald-600 bg-emerald-600 text-white" : active ? "border-emerald-600 bg-white text-emerald-700" : "border-slate-300 bg-white text-slate-400"}`}>{complete ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-4 w-4" />}</div>
                      <p className={`mt-2 text-xs font-bold sm:text-sm ${active ? "text-emerald-700" : complete ? "text-slate-900" : "text-slate-500"}`}>{stage.label}</p>
                      {active && <span className="mt-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">Current status</span>}
                    </div>;
                  })}
                </div>
                <p className="mt-3 text-center text-xs text-slate-500">Your delivery progress updates as the farmer and delivery partner process your order.</p>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-lg"><MapPin className="h-5 w-5 text-emerald-700" /> Delivery details</CardTitle></CardHeader>
              <CardContent className="grid gap-4 border-t border-slate-100 p-4 md:grid-cols-[1.2fr_1fr_0.9fr]">
                <div className="flex gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Home className="h-5 w-5" /></div><div className="min-w-0"><p className="text-sm font-bold text-slate-900">Delivery address</p><p className="mt-1 text-sm leading-5 text-slate-600">{addressLines.length ? addressLines.join(", ") : "Delivery address will be shown in your order details."}</p></div></div>
                <div className="flex gap-3 border-slate-200 md:border-l md:pl-4"><Phone className="mt-1 h-5 w-5 shrink-0 text-emerald-700" /><div><p className="text-sm font-bold text-slate-900">Contact numbers</p><p className="mt-1 text-sm text-slate-600">Primary: {primaryPhone || "Not provided"}</p><p className="text-sm text-slate-600">Alternative: {alternatePhone || "Not provided"}</p></div></div>
                <div className="flex gap-3 border-slate-200 md:border-l md:pl-4"><CalendarDays className="mt-1 h-5 w-5 shrink-0 text-emerald-700" /><div><p className="text-sm font-bold text-slate-900">Delivery window</p><div className="mt-1 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{order.deliveryDate || order.estimatedDeliveryDate ? formatDate(order.deliveryDate || order.estimatedDeliveryDate) : deliveryDate}<br />{order.deliveryTimeSlot || deliveryTimeSlot}</div></div></div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-lg"><ShoppingCart className="h-5 w-5 text-emerald-700" /> Items in your order ({orderItems.length || items.length})</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="grid grid-cols-[minmax(0,1fr)_65px_90px] gap-2 border-y border-slate-100 bg-slate-50 px-4 py-2 text-xs font-bold text-slate-500"><span>Product</span><span className="text-center">Qty</span><span className="text-right">Price</span></div>
                {(orderItems.length ? orderItems : items).map((item: any, index: number) => {
                  const name = item.productName || item.name || "Product";
                  const image = item.productImage || item.image;
                  const quantity = Number(item.quantity || 0);
                  const lineTotal = Number(item.totalPrice ?? item.total ?? (Number(item.unitPrice || item.price || 0) * quantity));
                  return <div key={item.productId || item.id || index} className="grid grid-cols-[minmax(0,1fr)_65px_90px] items-center gap-2 border-b border-slate-100 px-4 py-3 last:border-0">
                    <div className="flex min-w-0 items-center gap-3"><div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-slate-50">{image ? <img src={image} alt={name} className="h-full w-full object-cover" /> : <Package className="m-3 h-6 w-6 text-slate-300" />}</div><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{name}</p><p className="text-xs text-slate-500">{item.farmerName || item.sellerName || ""}</p></div></div>
                    <span className="text-center text-sm text-slate-700">{quantity} {item.unit || ""}</span><span className="text-right text-sm font-semibold text-slate-900">{formatPrice(lineTotal)}</span>
                  </div>;
                })}
                {!orderItems.length && <p className="p-4 text-xs text-slate-500">Your order items have been saved. Open View order for the complete item breakdown.</p>}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-3">
            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-lg"><ShoppingCart className="h-5 w-5 text-emerald-700" /> Order Summary</CardTitle></CardHeader>
              <CardContent className="space-y-3 p-4">
                <div className="flex justify-between text-sm text-slate-600"><span>Subtotal ({totalQuantity || items.reduce((sum, item) => sum + item.quantity, 0)} items)</span><span>{formatPrice(subtotal)}</span></div>
                <div className="flex justify-between text-sm text-slate-600"><span>Delivery charge</span><span>{formatPrice(deliveryCharge)}</span></div>
                {platformFee > 0 && <div className="flex justify-between text-sm text-slate-600"><span>Platform fee</span><span>{formatPrice(platformFee)}</span></div>}
                {Number(order.couponDiscount ?? 0) > 0 && <div className="flex justify-between text-sm font-semibold text-emerald-700"><span>Coupon discount</span><span>−{formatPrice(Number(order.couponDiscount))}</span></div>}
                {Number(order.pointsRedeemed ?? 0) > 0 && <div className="flex justify-between text-sm font-semibold text-emerald-700"><span>AgriPoints used ({Number(order.pointsRedeemed).toLocaleString("en-IN")} pts)</span><span>−{formatPrice(Number(order.pointsDiscount ?? Number(order.pointsRedeemed) / 100))}</span></div>}
                {discount > 0 && Number(order.couponDiscount ?? 0) === 0 && Number(order.pointsRedeemed ?? 0) === 0 && <div className="flex justify-between text-sm font-semibold text-emerald-700"><span>Discount</span><span>−{formatPrice(discount)}</span></div>}
                <div className="flex justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-base font-extrabold"><span>Total payable</span><span className="text-emerald-800">{formatPrice(total)}</span></div>
                <div className="border-t border-slate-100 pt-3"><p className="flex items-center gap-2 font-bold text-slate-900"><CreditCard className="h-5 w-5 text-emerald-700" /> Payment Method</p><div className="mt-2 flex items-center justify-between rounded-xl border border-slate-200 p-3"><span className="flex items-center gap-2 text-sm font-semibold"><Banknote className="h-5 w-5 text-emerald-700" /> {paymentLabel}</span><span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800">{isCashOnDelivery ? "Due on delivery" : "Paid"}</span></div></div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-lg"><Headphones className="h-5 w-5 text-emerald-700" /> Need help?</CardTitle></CardHeader>
              <CardContent className="space-y-3 p-4"><p className="text-sm leading-5 text-slate-600">If you have any questions about your order, our support team is here to help.</p><Button asChild variant="outline" className="w-full border-emerald-600 font-bold text-emerald-800 hover:bg-emerald-50"><Link href="/contact"><Headphones className="mr-2 h-4 w-4" /> Contact support</Link></Button></CardContent>
            </Card>
          </div>
        </div>

        <div className="mx-auto grid w-full max-w-4xl gap-3 sm:grid-cols-2">
          <Button asChild className="h-12 bg-emerald-700 text-base font-bold text-white hover:bg-emerald-800"><Link onClick={() => { try { window.sessionStorage.removeItem("agriconnect:completed-order-confirmation"); } catch {} }} href={completedOrderId ? `/orders/${completedOrderId}/track` : "/orders"}><Truck className="mr-2 h-5 w-5" /> Track your order</Link></Button>
          <Button asChild variant="outline" className="h-12 border-emerald-700 text-base font-bold text-emerald-800 hover:bg-emerald-50"><Link onClick={() => { try { window.sessionStorage.removeItem("agriconnect:completed-order-confirmation"); } catch {} }} href="/marketplace"><ShoppingCart className="mr-2 h-5 w-5" /> Continue shopping</Link></Button>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-5 text-xs font-medium text-slate-500"><span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-700" /> Fresh from farms</span><span className="hidden h-4 border-l border-slate-300 sm:block" /><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-700" /> Secure checkout</span><span className="hidden h-4 border-l border-slate-300 sm:block" /><span className="flex items-center gap-2"><Truck className="h-4 w-4 text-emerald-700" /> Delivery updates</span></div>
        {completedTransactionId && <p className="text-center text-xs text-slate-400">Transaction ID: {completedTransactionId}</p>}
      </div>
    );
  }

if (!cartHydrated) {
    return (
      <div className="customer-retail-shell">
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="flex min-h-[260px] flex-col items-center justify-center gap-3 p-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-700" />
            <p className="text-sm font-semibold text-slate-800">Restoring your cart…</p>
            <p className="text-xs text-slate-500">Please wait while we load your saved items.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="customer-retail-shell space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/cart"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <CustomerPageHeader eyebrow="Secure checkout" title="Complete your order" description={`${itemCount} item${itemCount !== 1 ? "s" : ""} · ${formatPrice(displayTotal)} before delivery and offers`} />
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
    <div className="customer-retail-shell space-y-6">
      {stockAdjustment && (
        <div role="dialog" aria-modal="true" aria-labelledby="stock-adjustment-title" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl">
            <h2 id="stock-adjustment-title" className="text-xl font-bold text-slate-900">Update your order quantity?</h2>
            <p className="text-sm text-slate-600">Sorry, the requested quantity is no longer available. Another customer purchased or reserved some of this stock moments ago.</p>
            <div className="rounded-xl bg-emerald-50 p-4">
              <p className="text-sm text-slate-600">Requested quantity: <strong>{stockAdjustment.requested} kg</strong></p>
              <p className="mt-1 text-2xl font-bold text-emerald-800">{stockAdjustment.available} kg available</p>
              <p className="text-sm text-slate-600">Would you like to continue with {stockAdjustment.available} kg?</p>
            </div>
            <div className="flex gap-3">
              <Button className="flex-1" disabled={isPlacing} onClick={() => {
                const adjustment = stockAdjustment;
                setStockAdjustment(null);
                void handlePlaceOrder({ [adjustment.productId]: adjustment.available });
              }}>Yes, continue with {stockAdjustment.available} kg</Button>
              <Button className="flex-1" variant="outline" onClick={() => setStockAdjustment(null)}>No, cancel</Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" className="h-11 w-11 rounded-full border-slate-200 bg-white shadow-sm" asChild>
            <Link href="/cart"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Home · Cart · Checkout</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Checkout</h1>
            <p className="text-sm text-slate-600">Complete your order and get fresh produce from our farmers.</p>
          </div>
        </div>
        <div className="flex min-w-[280px] flex-1 items-center justify-end gap-2 sm:max-w-[420px]" aria-label="Checkout progress">
          <div className="flex flex-col items-center gap-1 text-xs font-semibold text-emerald-800">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-700 text-white"><CheckCircle2 className="h-5 w-5" /></span>
            Cart
          </div>
          <span className="h-px flex-1 bg-emerald-500" />
          <div className="flex flex-col items-center gap-1 text-xs font-semibold text-emerald-800">
            <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-emerald-600 bg-white text-emerald-700"><Truck className="h-5 w-5" /></span>
            Checkout
          </div>
          <span className="h-px flex-1 bg-slate-200" />
          <div className="flex flex-col items-center gap-1 text-xs font-medium text-slate-500">
            <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-slate-200 bg-white"><CheckCircle2 className="h-5 w-5" /></span>
            Order Placed
          </div>
        </div>
      </div>

      {paymentStage !== "idle" && (
        <Card className={`border-2 ${paymentStage==="failed"?"border-red-200 bg-red-50/60":"border-blue-200 bg-blue-50/60"}`}>
          <CardContent className="flex items-center gap-3 p-4">
            {paymentStage==="failed" ? <X className="h-5 w-5 text-red-600"/> : <Loader2 className="h-5 w-5 animate-spin text-blue-600"/>}
            <div><p className="font-semibold text-slate-900">{paymentStage==="creating"?(paymentMethod==="cash"?"Placing your order":"Preparing payment"):paymentStage==="processing"?"Payment processing":paymentMethod==="cash"?"Order placement needs attention":"Checkout needs attention"}</p><p className="text-xs text-slate-600">{paymentMessage}</p></div>
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

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)] xl:gap-4">
        <div className="space-y-3">
          {/* Delivery Address */}
          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100 bg-white px-5 py-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <MapPin className="h-5 w-5 text-emerald-700" /> Delivery Address
              </CardTitle>
              </CardHeader>
            <CardContent className="space-y-3 p-4">
              {addresses.length === 0 && !showAddrForm ? (
                <p className="text-sm text-muted-foreground">No saved addresses yet.</p>
              ) : (
                <div className="space-y-2">
                  {addresses.map((addr) => (
                    <div
                      key={addr.id}
                      className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 transition-all ${
                        (selectedAddressId || defaultAddress?.id) === addr.id
                          ? "border-emerald-500 bg-emerald-50/90 shadow-sm ring-1 ring-emerald-100"
                          : "border-slate-200 bg-white hover:border-emerald-300"
                      }`}
                    >
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                        <input
                          type="radio"
                          name="deliveryAddress"
                          value={addr.id}
                          checked={(selectedAddressId || defaultAddress?.id) === addr.id}
                          onChange={(e) => setSelectedAddressId(e.target.value)}
                          className="h-4 w-4 shrink-0 accent-emerald-700"
                        />
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                          (selectedAddressId || defaultAddress?.id) === addr.id
                            ? "bg-white text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                        }`}>
                          {addr.address_type?.toLowerCase() === "work" ? <Building2 className="h-5 w-5" /> : addr.address_type?.toLowerCase() === "home" ? <Home className="h-5 w-5" /> : <MapPin className="h-5 w-5" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold capitalize text-slate-950">{addr.address_type || "Delivery"}</span>
                            {addr.is_default && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">Default</span>}
                          </span>
                          <span className="mt-1 block text-sm leading-5 text-slate-800">
                            {addr.address_line1}{addr.address_line2 ? `, ${addr.address_line2}` : ""}
                          </span>
                          <span className="mt-0.5 block text-xs leading-4 text-slate-600">
                            {addr.city}, {addr.state} – {addr.zip_code}
                          </span>
                        </span>
                      </label>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button type="button" variant="outline" size="sm" onClick={() => handleEditAddress(addr)} className="h-8 px-2 text-xs" aria-label={`Edit ${addr.address_type} address`}>
                          <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => handleDeleteAddress(addr)} className="h-8 px-2 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700" aria-label={`Delete ${addr.address_type} address`}>
                          <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {showAddrForm && (
                <form onSubmit={handleAddAddress} className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{editingAddressId ? "Edit Delivery Address" : "New Address"}</span>
                    <Button type="button" variant="ghost" size="sm" onClick={resetAddressForm}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <Input name="address_line1" value={addrForm.address_line1} onChange={handleAddrChange} placeholder="Address line 1 *" required />
                  <Input name="address_line2" value={addrForm.address_line2} onChange={handleAddrChange} placeholder="Address line 2 (optional)" />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Primary Phone Number <span className="text-rose-600">*</span></label>
                      <Input type="tel" name="phone_number" value={addrForm.phone_number} onChange={handleAddrChange} placeholder="10-digit contact number" required />
                      <p className="text-[11px] text-slate-500">{profilePhone ? "Pre-filled from your profile. You can change it for this delivery address." : "Add your phone number to your profile or enter it here. Required for delivery calls."}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Alternative Phone Number</label>
                      <Input type="tel" name="alternative_phone_number" value={addrForm.alternative_phone_number} onChange={handleAddrChange} placeholder="Backup contact number (optional)" />
                      <p className="text-[11px] text-slate-500">Used if the primary number is unreachable.</p>
                    </div>
                  </div>
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
                    {savingAddr ? "Saving..." : editingAddressId ? "Update Address" : "Save Address"}
                  </Button>
                </form>
              )}

              <Button variant="outline" size="sm" onClick={() => {
                if (showAddrForm) resetAddressForm();
                else {
                  setEditingAddressId(null);
                  setAddrForm({ ...initialAddrForm, phone_number: profilePhone });
                  setShowAddrForm(true);
                }
              }} className="flex items-center gap-2">
                <Plus className="h-4 w-4" /> {showAddrForm ? "Cancel" : "Add new address"}
              </Button>
            </CardContent>
          </Card>

          {/* Delivery availability is presented as one backend-driven state. */}
          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100 bg-white px-5 py-4">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Truck className="h-5 w-5 text-emerald-700" /> Delivery Availability
              </CardTitle>
              <CardDescription>We check the delivery window and partner availability for your selected address.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-4 sm:p-5">
              {!estimatedDeliveryAddressId ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
                  Select a delivery address to check the fastest delivery service.
                </div>
              ) : !deliveryAvailability || !deliveryQuote ? (
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  <Loader2 className="h-5 w-5 animate-spin text-emerald-700" />
                  Checking delivery service, partner availability and estimated delivery time…
                </div>
              ) : fastestDeliveryAvailable ? (
                <div className="rounded-xl border border-emerald-300 bg-gradient-to-r from-emerald-50 to-green-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                        <CheckCircle2 className="h-6 w-6" />
                      </span>
                      <div className="min-w-0">
                        <p className="font-bold text-emerald-900">Delivery service active</p>
                        <p className="mt-1 text-sm leading-5 text-emerald-800">
                          {deliveryAvailability.message || "A suitable delivery partner is available for this order."}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-xl border border-emerald-200 bg-white px-4 py-3 text-left sm:min-w-[190px]">
                      <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        <CalendarClock className="h-4 w-4 text-emerald-700" /> Fastest Delivery
                      </p>
                      <p className="mt-1 text-sm font-semibold text-emerald-800">
                        Within {deliveryQuote.estimatedDeliveryMinutes} minutes
                      </p>
                      <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Partner available
                        {deliveryAvailability.availablePartnerCount > 0 ? ` · ${deliveryAvailability.availablePartnerCount}` : ""}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {deliveryQuote && (
                <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-slate-500">Delivery fee</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">
                      {deliveryQuote.freeDelivery && deliveryQuote.fee === 0 ? "FREE" : formatPrice(deliveryQuote.fee)}
                    </p>
                  </div>
                  <div className="sm:border-l sm:border-slate-200 sm:pl-4">
                    <p className="text-xs text-slate-500">Distance from farmer</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">
                      {deliveryQuote.distanceKm > 0 ? `${deliveryQuote.distanceKm.toFixed(1)} km` : "Calculated by service"}
                    </p>
                  </div>
                  <div className="sm:border-l sm:border-slate-200 sm:pl-4">
                    <p className="text-xs text-slate-500">Delivery estimate</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">
                      {fastestDeliveryAvailable ? `≤ ${deliveryQuote.estimatedDeliveryMinutes} min` : "Standard delivery"}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Choose Delivery Slot */}
          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100 bg-white px-5 py-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <CalendarClock className="h-5 w-5 text-emerald-700" /> Choose Delivery Slot
              </CardTitle>
              <CardDescription>Select a convenient date and time for delivery.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {Array.from({ length: 5 }, (_, index) => {
                  const date = new Date();
                  date.setDate(date.getDate() + index);
                  const dateValue = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
                  const selected = deliveryDate === dateValue;
                  return (
                    <button key={dateValue} type="button" onClick={() => setDeliveryDate(dateValue)}
                      className={`flex min-h-[66px] flex-col items-center justify-center rounded-xl border px-2 py-2 text-center transition ${selected ? "border-emerald-600 bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200" : "border-slate-200 bg-white text-slate-700 hover:border-emerald-300"}`}>
                      <CalendarClock className={`mb-1 h-4 w-4 ${selected ? "text-emerald-700" : "text-slate-500"}`} />
                      <span className="text-xs font-semibold">{index === 0 ? "Today" : date.toLocaleDateString("en-IN", { weekday: "short" })}</span>
                      <span className="text-xs">{date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>
                    </button>
                  );
                })}
              </div>
              {checkoutSlots.length === 0 && (
                <div className="grid gap-2 sm:grid-cols-3">
                  {([
                    ["morning", "Morning", "8:00 AM – 11:00 AM"],
                    ["afternoon", "Afternoon", "12:00 PM – 4:00 PM"],
                    ["evening", "Evening", "4:00 PM – 7:00 PM"],
                  ] as const).map(([value, label, time]) => {
                    const selected = deliveryTimeSlot === value;
                    return (
                      <button key={value} type="button" onClick={() => {
                        setSelectedDeliverySlotId("");
                        setDeliveryTimeSlot(value);
                      }}
                        className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${selected ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-100" : "border-slate-200 bg-white hover:border-emerald-300"}`}>
                        <span className={`h-4 w-4 rounded-full border-2 ${selected ? "border-emerald-600 bg-emerald-600 ring-2 ring-emerald-100" : "border-slate-300"}`} />
                        <span><span className="block text-sm font-semibold text-slate-900">{label}</span><span className="block text-xs text-slate-600">{time}</span></span>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="border-t border-slate-100 pt-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Available farmer delivery batches</p>
                {!selectedCheckoutAddress?.city ? (
                  <p className="text-sm text-slate-500">Select a delivery address to find matching delivery slots.</p>
                ) : checkoutSlotsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Finding available slots…</div>
                ) : checkoutSlotsError ? (
                  <div className="rounded-lg border border-dashed border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    Could not load farmer delivery slots. <button type="button" className="font-semibold underline" onClick={() => refetchCheckoutSlots()}>Try again</button>
                  </div>
                ) : checkoutSlots.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">No open farmer-published slots are available on this date. Choose another date or continue with standard delivery. New slots are checked automatically.</div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {checkoutSlots.map((slot: any) => (
                      <button type="button" key={slot.id}
                        onClick={() => {
                          if (checkoutCartWeightKg > Number(slot.remainingCapacityKg ?? slot.maxCapacityKg ?? 0)) {
                            toast.error("This slot has only " + Number(slot.remainingCapacityKg ?? 0).toFixed(2) + " kg remaining.");
                            return;
                          }
                          setSelectedDeliverySlotId(slot.id);
                          setDeliveryTimeSlot(`${slot.startTime} - ${slot.endTime}`);
                        }}
                        disabled={checkoutCartWeightKg > Number(slot.remainingCapacityKg ?? slot.maxCapacityKg ?? 0)}
                        className={`rounded-lg border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${selectedDeliverySlotId === slot.id ? "border-emerald-600 bg-emerald-50 ring-1 ring-emerald-100" : "border-slate-200 hover:border-emerald-300"}`}>
                        <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-slate-900">{slot.area}</span><span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700">{Number(slot.remainingCapacityKg ?? 0).toFixed(2)} kg left</span></div>
                        <p className="mt-1 text-xs text-slate-600">{slot.startTime} – {slot.endTime}</p>
                        <p className="mt-1 text-xs text-slate-500">{slot.farmerInfo?.farmName || slot.farmerInfo?.name || "Local farmer"} · Service area: {slot.area} · {slot.distanceKm ? `${slot.distanceKm} km away` : `${slot.radiusKm} km coverage`}</p>
                        <p className="mt-1 text-xs font-medium text-emerald-700">Delivery fee: ₹{Number(slot.deliveryFee || 0).toFixed(2)}</p>
                        {checkoutCartWeightKg > Number(slot.remainingCapacityKg ?? 0) && <p className="mt-1 text-xs font-medium text-rose-600">Not enough capacity for your cart</p>}
                      </button>
                    ))}
                  </div>
                )}
                {selectedCheckoutSlot && <div className="mt-2 flex items-center justify-between rounded-lg bg-emerald-50 p-2.5 text-xs"><span className="text-emerald-800">Selected: {selectedCheckoutSlot.area}, {selectedCheckoutSlot.startTime}–{selectedCheckoutSlot.endTime}</span><Button type="button" size="sm" variant="ghost" onClick={() => setSelectedDeliverySlotId("")}>Remove</Button></div>}
              </div>
              <p className="flex items-center gap-2 text-xs text-emerald-800"><Leaf className="h-4 w-4" /> Fresh produce delivered directly from local farmers.</p>
            </CardContent>
          </Card>

          {/* Payment Method */}
          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100 bg-white px-5 py-4">
              <CardTitle className="flex items-center gap-2 text-lg">
                <CreditCard className="h-5 w-5 text-emerald-600" />
                Payment Method
              </CardTitle>
              <CardDescription>
                Choose how you want to pay. Only the selected method opens its payment options.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-2 p-4 sm:p-5">
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
                      className="flex w-full items-center gap-3 px-3 py-2 text-left"
                      aria-expanded={selected}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${selected
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
                                    <p className="font-semibold">{paymentMethod === "cash" ? "Order placement needs attention" : "Payment was not completed"}</p>
                                    <p className="mt-1">
                                      {paymentMethod === "cash" ? "No payment is due now for Cash on Delivery. Review the message above and try placing the order again." : "Your order is not marked paid. Check the Razorpay checkout and try again."}
                                    </p>
                                  </div>
                                )}

                                <Button
                                  type="button"
                                  className="w-full"
                                  size="lg"
                                  onClick={() => handlePlaceOrder()}
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


            </CardContent>
          </Card>

        </div>

        {/* Order Summary Sidebar */}
        <div className="space-y-3 lg:sticky lg:top-24">
          <Card className="h-fit overflow-hidden border-slate-200 shadow-md">
            <CardHeader className="border-b border-slate-100 bg-white px-5 py-4">
              <CardTitle className="flex items-center gap-2 text-lg"><ShoppingCart className="h-5 w-5 text-emerald-700" /> Order Summary</CardTitle>
              <CardDescription>{itemCount} item(s) in your cart</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-4 sm:p-5">
              {items.map((item) => (
                <div key={item.id} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-slate-100">
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
                      <p className="text-base font-bold text-slate-900">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.farmerName || "Local Farmer"}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatPrice(item.originalPrice || item.price)} / unit</span>
                        <span className="text-slate-300">|</span>
                        <span>Qty: {item.quantity}</span>
                      </div>
                      <span className="text-base font-bold text-emerald-700">{formatPrice((item.originalPrice || item.price) * item.quantity)}</span>
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
              <div className="rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-extrabold text-slate-900"><Coins className="h-4 w-4 text-emerald-700" /> Use AgriPoints</p>
                    <p className="mt-1 text-xs text-slate-600">
                      {loyaltyPointsLoading ? "Loading your points balance…" : `Available balance: ${availableAgriPoints.toLocaleString("en-IN")} points`}
                    </p>
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-emerald-800">100 pts = ₹1</span>
                </div>
                {effectiveAgriPoints > 0 ? (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm">
                    <span className="font-semibold text-emerald-800">{effectiveAgriPoints.toLocaleString("en-IN")} points applied</span>
                    <span className="flex items-center gap-2 font-bold text-emerald-800">−{formatPrice(agriPointsDiscount)}
                      <button type="button" onClick={handleRemoveAgriPoints} className="text-xs font-semibold text-slate-500 underline">Remove</button>
                    </span>
                  </div>
                ) : (
                  <div className="mt-3 flex gap-2">
                    <Input type="number" min="100" step="100" max={maxAgriPoints}
                      value={agriPointsInput}
                      onChange={(event) => { setAgriPointsInput(event.target.value); setAgriPointsError(""); }}
                      placeholder="Enter points (e.g. 500)" className="min-w-0 flex-1 bg-white"
                      disabled={loyaltyPointsLoading || availableAgriPoints < 100 || maxAgriPoints < 100} />
                    <Button type="button" variant="outline" size="sm" onClick={handleApplyAgriPoints}
                      disabled={loyaltyPointsLoading || availableAgriPoints < 100 || maxAgriPoints < 100}>Apply</Button>
                  </div>
                )}
                <p className="mt-2 text-[11px] text-slate-500">You can redeem up to {maxAgriPoints.toLocaleString("en-IN")} points on this order. Points are deducted only after the order is created successfully.</p>
                {agriPointsError && <p className="mt-1 text-xs font-medium text-rose-600">{agriPointsError}</p>}
                {!loyaltyPointsLoading && availableAgriPoints < 100 && <p className="mt-1 text-xs text-slate-500">You need at least 100 points to redeem a ₹1 discount.</p>}
              </div>
              <div className="border-t pt-3 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span>Product total</span>
                  <span>{formatPrice(displayTotal)}</span>
                </div>
                {couponDiscount > 0 && (
                  <div className="flex justify-between text-sm text-emerald-600">
                    <span>Coupon discount</span>
                    <span>-{formatPrice(couponDiscount)}</span>
                  </div>
                )}
                {agriPointsDiscount > 0 && (
                  <div className="flex justify-between text-sm font-semibold text-emerald-700">
                    <span>AgriPoints discount ({effectiveAgriPoints.toLocaleString("en-IN")} pts)</span>
                    <span>−{formatPrice(agriPointsDiscount)}</span>
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
              <div className="flex justify-between rounded-lg border-t border-emerald-100 bg-emerald-50 px-3 py-3 text-base font-bold">
                  <span>Estimated total</span>
                  <span>{formatPrice(estimatedTotal)}</span>
                </div>

              <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                <p className="flex items-center gap-2 font-bold text-slate-900"><Leaf className="h-5 w-5 text-emerald-700" /> Why buy from AgriConnect?</p>
                <div className="mt-4 grid grid-cols-3 divide-x divide-emerald-200 text-center">
                  <div className="px-2"><Leaf className="mx-auto h-5 w-5 text-emerald-700" /><p className="mt-1 text-xs font-medium text-slate-700">Direct from<br/>Farmers</p></div>
                  <div className="px-2"><ShieldCheck className="mx-auto h-5 w-5 text-emerald-700" /><p className="mt-1 text-xs font-medium text-slate-700">Quality<br/>Assured</p></div>
                  <div className="px-2"><Truck className="mx-auto h-5 w-5 text-emerald-700" /><p className="mt-1 text-xs font-medium text-slate-700">Fresh & Safe<br/>Delivery</p></div>
                </div>
              </div>
              <div className="border-t border-slate-100 pt-4">
                <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span>
                    {paymentMethod === "cash"
                      ? "No online payment is taken for Cash on Delivery."
                      : "Payment is verified securely before the order is marked paid."}
                  </span>
                </div>

                {!(paymentMethod === "upi" && selectedUpiApp) && (
                  <Button
                    className="mt-4 h-12 w-full bg-emerald-800 text-base font-bold text-white shadow-sm hover:bg-emerald-900"
                    size="lg"
                    onClick={() => handlePlaceOrder()}
                    disabled={isPlacing || (paymentMethod === "wallet" && walletBalance < estimatedTotal)}
                  >
                    {isPlacing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {paymentMethod === "cash" ? "Placing order..." : "Processing payment..."}
                      </>
                    ) : paymentMethod === "cash" ? (
                      `Place Order (${formatPrice(estimatedTotal)})`
                    ) : paymentMethod === "wallet" ? (
                      `Pay ${formatPrice(estimatedTotal)} from Wallet`
                    ) : (
                      `Pay ${formatPrice(estimatedTotal)}`
                    )}
                  </Button>
                )}
              </div>
              </div>
            </CardContent>
          </Card>

        </div>
      </div>
      {!fastestDeliveryAvailable && deliveryAvailability && deliveryQuote && (
        <div className="grid gap-3 rounded-2xl border border-blue-200 bg-white p-3 shadow-sm sm:grid-cols-[minmax(180px,0.28fr)_minmax(0,1fr)] sm:items-center">
          <div className="rounded-xl bg-blue-50 px-4 py-3">
            <p className="text-sm font-bold text-blue-900">Alternate delivery</p>
            <p className="mt-1 text-xs text-blue-800">When fastest delivery is not possible</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-300 bg-blue-50/70 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <Truck className="h-7 w-7 shrink-0 text-blue-700" />
              <div><p className="font-bold text-blue-900">Standard Delivery</p><p className="text-xs leading-5 text-blue-800">Fastest 30-minute delivery is not feasible for this address right now. Standard delivery is available.</p></div>
            </div>
            <div className="border-l border-blue-200 pl-4 text-sm text-blue-900"><p className="text-xs text-blue-700">Estimated delivery</p><p className="font-bold">{deliveryAvailability.estimatedDeliveryLabel || "Standard delivery window"}</p></div>
          </div>
        </div>
      )}
    </div>
  );
}
