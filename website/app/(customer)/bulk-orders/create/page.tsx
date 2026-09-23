"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Plus, Trash2, Loader2, Send, MapPin } from "lucide-react";
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
  const [purpose, setPurpose] = useState("");
  const [eventDate, setEventDate] = useState("");
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
      toast.success("Bulk request published! Farmers can now submit offers.");
      queryClient.invalidateQueries({ queryKey: ["bulk", "requests"] });
      router.push(`/bulk-orders/${res?.data?.id || res?.data?.request?.id}`);
    },
    onError: (err: any) => toast.error(err?.message || "Failed to create bulk request"),
  });

  const validItems = items.filter((i) => i.name.trim() && Number(i.quantityKg) > 0);
  const canSubmit =
    purpose && deliveryDate && validItems.length > 0 && (selectedAddress || deliveryCity.trim()) && !createMutation.isPending;

  const submit = () => {
    const selected = addresses.find((a: any) => String(a.id) === selectedAddress);
    const payload: any = {
      requestType: "bulk_event",
      purpose,
      eventDate: eventDate || undefined,
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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-2">
        <Sparkles className="h-6 w-6 text-emerald-600" />
        <h1 className="text-2xl font-bold">Create Bulk / Event Order</h1>
      </div>
      <p className="text-sm text-gray-500">
        Need large quantities for a wedding, function or festival? Tell us what you need — farmers
        will submit offers and you pick the best one.
      </p>

      <Card>
        <CardContent className="space-y-5 p-6">
          {/* Purpose */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">What are you buying for? *</label>
            <div className="flex flex-wrap gap-2">
              {purposes.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPurpose(p)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                    purpose === p ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Dates */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Event date</label>
              <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            </div>
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
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Location */}
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
                  <Input
                    value={deliveryCity}
                    onChange={(e) => setDeliveryCity(e.target.value)}
                    placeholder="or enter delivery city (e.g. Coimbatore)"
                  />
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 shrink-0 text-gray-400" />
                <Input
                  value={deliveryCity}
                  onChange={(e) => setDeliveryCity(e.target.value)}
                  placeholder="Delivery city (e.g. Coimbatore)"
                />
              </div>
            )}
          </div>

          {/* Items */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-gray-700">Products required *</label>
            {items.map((item, i) => (
              <div key={i} className="space-y-2 rounded-xl border p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    value={item.name}
                    onChange={(e) => updateItem(i, { name: e.target.value })}
                    placeholder={`Product ${i + 1} (e.g. Tomato)`}
                  />
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min="1"
                      value={item.quantityKg}
                      onChange={(e) => updateItem(i, { quantityKg: e.target.value })}
                      placeholder="Qty (kg)"
                    />
                    <select
                      value={item.qualityGrade}
                      onChange={(e) => updateItem(i, { qualityGrade: e.target.value })}
                      className="h-11 rounded-full border border-input bg-background px-3 text-sm"
                    >
                      {grades.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Input
                    value={item.category}
                    onChange={(e) => updateItem(i, { category: e.target.value })}
                    placeholder="Category (optional)"
                    className="max-w-xs"
                  />
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

          {/* Budget */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Budget (₹, optional)</label>
            <Input type="number" min="0" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="e.g. 15000" />
          </div>

          <Button size="lg" className="w-full" disabled={!canSubmit} onClick={submit}>
            {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Request Quotes
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}