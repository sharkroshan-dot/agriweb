"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Plus, Trash2, Loader2, Send, MapPin, ShoppingBasket, Search } from "lucide-react";
import { api } from "../../../lib/api/client";
import { Card, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import toast from "react-hot-toast";

const purposes = ["Wedding", "Birthday", "Function", "Festival", "Family Event", "Other"];
const timeSlots = ["6:00 AM – 9:00 AM", "9:00 AM – 12:00 PM", "12:00 PM – 3:00 PM", "3:00 PM – 6:00 PM", "6:00 PM – 9:00 PM"];
const grades = ["premium", "standard", "economy"];

interface ItemRow {
  name: string;
  category: string;
  quantityKg: string;
  qualityGrade: string;
}

export default function CreateBulkOrderPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [purchaseMode, setPurchaseMode] = useState<"event" | "family_weekly">("event");
  const [purpose, setPurpose] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [guestCount, setGuestCount] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryTime, setDeliveryTime] = useState(timeSlots[0]);
  const [deliveryCity, setDeliveryCity] = useState("");
  const [selectedAddress, setSelectedAddress] = useState("");
  const [budget, setBudget] = useState("");
  const [items, setItems] = useState<ItemRow[]>([{ name: "", category: "", quantityKg: "", qualityGrade: "standard" }]);

  const { data: addressesData } = useQuery({
    queryKey: ["customerAddresses"],
    queryFn: () => api.get("/users/me/addresses"),
  });
  const addresses = Array.isArray(addressesData) ? addressesData : addressesData?.data || [];

  const addItem = () => setItems((p) => [...p, { name: "", category: "", quantityKg: "", qualityGrade: "standard" }]);
  const updateItem = (i: number, patch: Partial<ItemRow>) =>
    setItems((p) => p.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const removeItem = (i: number) => setItems((p) => p.filter((_, idx) => idx !== i));

  const createMutation = useMutation({
    mutationFn: (payload: any) => api.post("/bulk-orders/requests", payload),
    onSuccess: (res: any) => {
      const requestId = res?.data?.id || res?.data?.request?.id;
      queryClient.invalidateQueries({ queryKey: ["bulk", "requests"] });

      if (purchaseMode === "family_weekly") {
        toast.success("Weekly family basket created. Finding live stock.");
      } else {
        toast.success("Event created. AgriConnect will choose urgent smart sourcing or planned RFQ from the delivery deadline.");
      }
      router.push(`/bulk-orders/${requestId}/sourcing`);
    },
    onError: (err: any) => toast.error(err?.message || "Failed to create bulk request"),
  });

  const validItems = items.filter((i) => i.name.trim() && Number(i.quantityKg) > 0);
  const canSubmit =
    (purchaseMode === "family_weekly" || Boolean(purpose)) &&
    deliveryDate &&
    validItems.length > 0 &&
    (selectedAddress || deliveryCity.trim()) &&
    !createMutation.isPending;

  const submit = () => {
    const selected = addresses.find((a: any) => String(a.id) === selectedAddress);
    const payload: any = {
      requestType: "bulk_event",
      purchaseMode,
      purpose: purchaseMode === "family_weekly" ? "Weekly Family Basket" : purpose,
      eventDate: purchaseMode === "event" ? eventDate || undefined : undefined,
      guestCount: purchaseMode === "event" && guestCount ? Number(guestCount) : undefined,
      requestedDeliveryDate: deliveryDate,
      requestedDeliveryTime: deliveryTime,
      deliveryCity: deliveryCity.trim(),
      items: validItems.map((i) => ({
        name: i.name.trim(),
        category: i.category.trim() || undefined,
        quantityKg: Number(i.quantityKg),
        qualityGrade: i.qualityGrade,
      })),
      budget: budget ? Number(budget) : undefined,
    };
    if (selected) {
      payload.deliveryAddressId = String(selected.id);
    }
    createMutation.mutate(payload);
  };

  const isFamilyWeekly = purchaseMode === "family_weekly";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-2">
        <Sparkles className="h-6 w-6 text-emerald-600" />
        <h1 className="text-2xl font-bold">Create Bulk / Event Order</h1>
      </div>
      <p className="text-sm text-gray-500">
        {isFamilyWeekly
          ? "Choose the products and quantities you need for one week. AgriConnect will find suitable nearby farmers with live stock."
          : "Need large quantities for a wedding, function or festival? Send your requirements to eligible farmers and compare their quotes."}
      </p>

      <Card className="border-emerald-200 bg-emerald-50/40">
        <CardContent className="space-y-3 p-4">
          <p className="text-sm font-semibold text-slate-800">What do you want to buy?</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => setPurchaseMode("event")} className={`rounded-xl border p-4 text-left ${purchaseMode === "event" ? "border-emerald-500 bg-white shadow-sm" : "border-slate-200 bg-white/60"}`}>
              <Sparkles className="mb-2 h-5 w-5 text-emerald-600" />
              <p className="font-semibold">Event / Bulk Order</p>
              <p className="mt-1 text-xs text-slate-500">For weddings, functions, festivals and large one-time requirements. Eligible farmers receive the request and can submit quotes.</p>
            </button>
            <button type="button" onClick={() => setPurchaseMode("family_weekly")} className={`rounded-xl border p-4 text-left ${purchaseMode === "family_weekly" ? "border-emerald-500 bg-white shadow-sm" : "border-slate-200 bg-white/60"}`}>
              <ShoppingBasket className="mb-2 h-5 w-5 text-emerald-600" />
              <p className="font-semibold">Manual Weekly Family Basket</p>
              <p className="mt-1 text-xs text-slate-500">Choose your own products and quantities for one week. Smart sourcing finds available nearby farmers. One-time purchase, not a subscription.</p>
            </button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-5 p-6">
          {purchaseMode === "event" && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">What are you buying for? *</label>
              <div className="flex flex-wrap gap-2">
                {purposes.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPurpose(p)}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${purpose === p ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={`grid gap-4 ${purchaseMode === "event" ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
            {purchaseMode === "event" && (
              <>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-500">Event date</label>
                  <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-500">Expected guests</label>
                  <Input type="number" min="1" value={guestCount} onChange={(e) => setGuestCount(e.target.value)} placeholder="e.g. 500" />
                </div>
              </>
            )}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Delivery date *</label>
              <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Delivery time</label>
              <select
                value={deliveryTime}
                onChange={(e) => setDeliveryTime(e.target.value)}
                className="h-11 w-full rounded-full border border-input bg-background px-4 text-sm"
              >
                {timeSlots.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">Delivery location *</label>
            {addresses.length > 0 ? (
              <div className="space-y-2">
                <select
                  value={selectedAddress}
                  onChange={(e) => setSelectedAddress(e.target.value)}
                  className="h-11 w-full rounded-full border border-input bg-background px-4 text-sm"
                >
                  <option value="">Use a city below instead</option>
                  {addresses.map((a: any) => (
                    <option key={a.id} value={String(a.id)}>
                      {a.address_line1}, {a.city}, {a.state} - {a.zip_code}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 shrink-0 text-gray-400" />
                  <Input value={deliveryCity} onChange={(e) => setDeliveryCity(e.target.value)} placeholder="or enter delivery city (e.g. Coimbatore)" />
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 shrink-0 text-gray-400" />
                <Input value={deliveryCity} onChange={(e) => setDeliveryCity(e.target.value)} placeholder="Delivery city (e.g. Coimbatore)" />
              </div>
            )}
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium text-gray-700">Products required *</label>
            {items.map((item, i) => (
              <div key={i} className="space-y-2 rounded-xl border p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input value={item.name} onChange={(e) => updateItem(i, { name: e.target.value })} placeholder={`Product ${i + 1} (e.g. Tomato)`} />
                  <div className="flex gap-2">
                    <Input type="number" min="1" value={item.quantityKg} onChange={(e) => updateItem(i, { quantityKg: e.target.value })} placeholder="Qty (kg)" />
                    <select value={item.qualityGrade} onChange={(e) => updateItem(i, { qualityGrade: e.target.value })} className="h-11 rounded-full border border-input bg-background px-3 text-sm">
                      {grades.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Input value={item.category} onChange={(e) => updateItem(i, { category: e.target.value })} placeholder="Category (optional)" className="max-w-xs" />
                  {items.length > 1 && (
                    <Button variant="ghost" size="sm" onClick={() => removeItem(i)}>
                      <Trash2 className="h-4 w-4 text-gray-400" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
            <Button variant="outline" onClick={addItem}>
              <Plus className="mr-2 h-4 w-4" /> Add Product
            </Button>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Budget (₹, optional)</label>
            <Input type="number" min="0" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="e.g. 15000" />
          </div>

          <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 text-sm">
            {isFamilyWeekly ? (
              <div className="flex gap-3">
                <Search className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                <div>
                  <p className="font-semibold text-emerald-900">How smart sourcing works</p>
                  <p className="mt-1 text-emerald-800">AgriConnect checks live farmer stock, availability and distance, then shows the best available farmer allocations before you reserve the stock.</p>
                </div>
              </div>
            ) : (
              <div className="flex gap-3">
                <Send className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                <div>
                  <p className="font-semibold text-emerald-900">Who receives this request?</p>
                  <p className="mt-1 text-emerald-800">Eligible farmers receive the event/bulk request. They can submit their own price, available quantity and delivery option. You can compare the quotes and select the offer that suits you.</p>
                </div>
              </div>
            )}
          </div>

          <Button size="lg" className="w-full" disabled={!canSubmit} onClick={submit}>
            {createMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : isFamilyWeekly ? (
              <Search className="mr-2 h-4 w-4" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            {isFamilyWeekly ? "Find Available Farmers" : "Request Quotes"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}