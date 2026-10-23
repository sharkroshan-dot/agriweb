"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, Loader2, Plus, MapPin, LocateFixed } from "lucide-react";
import { api } from "../../lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import toast from "react-hot-toast";

const QUALITY_GRADES = ["Grade A", "Grade B", "Grade C", "Premium", "Organic", "Standard"];
const PRODUCT_CATEGORIES = ["Vegetables", "Fruits", "Grains", "Pulses", "Spices", "Dairy", "Oilseeds", "Flowers", "Other"];
const VISIBILITY = ["nearby", "district", "state", "national"];

const emptyForm = {
  productName: "",
  category: "",
  recurring: false,
  quantityKg: 500,
  quantityPerWeekKg: 50,
  qualityGrade: "Grade A",
  requiredDate: "",
  deliveryTimeSlot: "6–9 AM",
  deliveryCity: "",
  deliveryState: "",
  deliveryDistrict: "",
  deliveryAddress: "",
  deliveryLocation: null as { type: string; coordinates: [number, number]; latitude: number; longitude: number } | null,
  priceCeilingPerKg: "",
  budgetMinPerKg: "",
  budgetMaxPerKg: "",
  deadline: "",
  visibility: "state",
  notes: "",
};

export function CreateRfqForm({ onDone }: { onDone?: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [aiRec, setAiRec] = useState<any>(null);

  const createMutation = useMutation({
    mutationFn: (payload: any) => api.post("/b2b/rfqs", payload),
    onSuccess: () => {
      toast.success("RFQ published! Farmers near you are now notified.");
      if (onDone) onDone();
      queryClient.invalidateQueries({ queryKey: ["b2b", "rfqs"] });
    },
    onError: (err: any) => toast.error(err?.message || "Failed to publish RFQ"),
  });

  const aiMutation = useMutation({
    mutationFn: (payload: { productName: string; city?: string; qualityGrade?: string }) =>
      api.post("/b2b/ai/price-recommendation", payload),
    onSuccess: (res: any) => setAiRec(res?.data),
    onError: (err: any) => toast.error(err?.message || "AI price check failed"),
  });

  const [locationLoading, setLocationLoading] = useState(false);

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const geocodeManualAddress = async () => {
    const query = form.deliveryAddress.trim();
    if (!query) {
      toast.error("Enter a delivery address first.");
      return;
    }

    setLocationLoading(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(query)}`,
        { headers: { Accept: "application/json" } },
      );
      if (!response.ok) throw new Error("Address lookup failed");
      const results = await response.json();
      const match = results?.[0];
      if (!match) {
        toast.error("Could not find that address on the map. Check the address or use live location.");
        return;
      }

      const latitude = Number(match.lat);
      const longitude = Number(match.lon);
      const address = match.address || {};
      setForm((current) => ({
        ...current,
        deliveryAddress: current.deliveryAddress.trim() || match.display_name || query,
        deliveryCity: current.deliveryCity || address.city || address.town || address.village || address.municipality || address.county || "",
        deliveryState: current.deliveryState || address.state || address.region || "",
        deliveryDistrict: current.deliveryDistrict || address.state_district || address.county || address.city_district || "",
        deliveryLocation: {
          type: "Point",
          coordinates: [longitude, latitude],
          latitude,
          longitude,
        },
      }));
      toast.success("Address location found and saved for delivery routing.");
    } catch {
      toast.error("Could not look up the address. You can still enter it manually or use live location.");
    } finally {
      setLocationLoading(false);
    }
  };

  const useLiveLocation = () => {
    if (!("geolocation" in navigator)) {
      toast.error("Live location is not supported by this browser. Enter the address manually.");
      return;
    }

    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const latitude = coords.latitude;
        const longitude = coords.longitude;
        const location = {
          type: "Point",
          coordinates: [longitude, latitude] as [number, number],
          latitude,
          longitude,
        };

        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`,
            { headers: { Accept: "application/json" } },
          );
          if (!response.ok) throw new Error("Address lookup failed");

          const result = await response.json();
          const address = result.address || {};
          const city = address.city || address.town || address.village || address.municipality || address.county || "";
          const state = address.state || address.region || "";
          const district = address.state_district || address.county || address.city_district || "";
          const formattedAddress = result.display_name || `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;

          setForm((current) => ({
            ...current,
            deliveryAddress: formattedAddress,
            deliveryCity: current.deliveryCity || city,
            deliveryState: current.deliveryState || state,
            deliveryDistrict: current.deliveryDistrict || district,
            deliveryLocation: location,
          }));
          toast.success("Live location added. Please verify the address before publishing.");
        } catch {
          setForm((current) => ({
            ...current,
            deliveryAddress: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
            deliveryLocation: location,
          }));
          toast.error("Coordinates saved, but the street address could not be found. Enter the address manually.");
        } finally {
          setLocationLoading(false);
        }
      },
      (error) => {
        setLocationLoading(false);
        toast.error(
          error.code === error.PERMISSION_DENIED
            ? "Location permission denied. Allow location access or enter the address manually."
            : error.code === error.TIMEOUT
              ? "Getting your location timed out. Please try again."
              : "Could not get your live location. Enter the address manually.",
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  };

  return (
    <Card className="border-emerald-200">
      <CardHeader>
        <CardTitle className="text-base">Publish a Request for Quote</CardTitle>
        <CardDescription>
          Tell farmers what your business needs and they will bid with their best price.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Product *</label>
          <Input value={form.productName} onChange={(e) => set("productName", e.target.value)} placeholder="e.g. Tomato" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Category *</label>
          <select
            value={form.category}
            onChange={(e) => set("category", e.target.value)}
            className="h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-sm outline-none focus:border-emerald-500"
          >
            <option value="">Select category</option>
            {PRODUCT_CATEGORIES.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1 sm:col-span-2">
          <div className="flex rounded-lg border p-1">
            {[{ key: false, label: "One-off order" }, { key: true, label: "Recurring supply" }].map((o) => (
              <button
                key={String(o.key)}
                type="button"
                onClick={() => set("recurring", o.key)}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  form.recurring === o.key ? "bg-emerald-600 text-white" : "hover:bg-gray-100"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {form.recurring ? (
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Quantity (kg/week) *</label>
            <Input type="number" min="1" value={form.quantityPerWeekKg} onChange={(e) => set("quantityPerWeekKg", Number(e.target.value))} />
          </div>
        ) : (
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Quantity (kg) *</label>
            <Input type="number" min="1" value={form.quantityKg} onChange={(e) => set("quantityKg", Number(e.target.value))} />
          </div>
        )}
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Quality grade</label>
          <select
            value={form.qualityGrade}
            onChange={(e) => set("qualityGrade", e.target.value)}
            className="h-9 w-full rounded-md border border-gray-200 px-2 text-sm"
          >
            {QUALITY_GRADES.map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
        </div>

        {!form.recurring && (
          <>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Required date</label>
              <Input type="date" value={form.requiredDate} onChange={(e) => set("requiredDate", e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Delivery time slot</label>
              <Input value={form.deliveryTimeSlot} onChange={(e) => set("deliveryTimeSlot", e.target.value)} placeholder="e.g. 6–9 AM" />
            </div>
          </>
        )}

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Delivery city *</label>
          <Input value={form.deliveryCity} onChange={(e) => set("deliveryCity", e.target.value)} placeholder="e.g. Coimbatore" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">State</label>
          <Input value={form.deliveryState} onChange={(e) => set("deliveryState", e.target.value)} placeholder="e.g. Tamil Nadu" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">District</label>
          <Input value={form.deliveryDistrict} onChange={(e) => set("deliveryDistrict", e.target.value)} placeholder="e.g. Coimbatore" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Max price (₹/kg ceiling)</label>
          <Input type="number" min="0" value={form.priceCeilingPerKg} onChange={(e) => set("priceCeilingPerKg", e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Budget min (₹/kg)</label>
          <Input type="number" min="0" value={form.budgetMinPerKg} onChange={(e) => set("budgetMinPerKg", e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Budget max (₹/kg)</label>
          <Input type="number" min="0" value={form.budgetMaxPerKg} onChange={(e) => set("budgetMaxPerKg", e.target.value)} />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">RFQ deadline (closes)</label>
          <Input type="datetime-local" value={form.deadline} onChange={(e) => set("deadline", e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">RFQ visibility</label>
          <select
            value={form.visibility}
            onChange={(e) => set("visibility", e.target.value)}
            className="h-9 w-full rounded-md border border-gray-200 px-2 text-sm"
          >
            {VISIBILITY.map((v) => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}
          </select>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-xs font-medium text-gray-500">Delivery address *</label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" disabled={locationLoading} onClick={geocodeManualAddress}>
                <MapPin className="mr-1.5 h-4 w-4" />
                Find address on map
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={locationLoading} onClick={useLiveLocation}>
                {locationLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <LocateFixed className="mr-1.5 h-4 w-4" />}
                {locationLoading ? "Getting location…" : "Use my live location"}
              </Button>
            </div>
          </div>
          <Input
            value={form.deliveryAddress}
            onChange={(e) => setForm((current) => ({ ...current, deliveryAddress: e.target.value, deliveryLocation: null }))}
            placeholder="Enter full business delivery address manually"
          />
          <p className="text-xs text-gray-500">
            Enter the complete address manually, choose Find address on map to save coordinates for distance routing, or use live location. Verify the address before publishing.
          </p>
          {form.deliveryLocation?.coordinates?.length === 2 && (
            <p className="flex items-center gap-1 text-xs text-emerald-700">
              <MapPin className="h-3.5 w-3.5" />
              GPS coordinates saved ({form.deliveryLocation.latitude.toFixed(5)}, {form.deliveryLocation.longitude.toFixed(5)}).
            </p>
          )}
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label className="text-xs font-medium text-gray-500">Additional requirements</label>
          <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Quality requirements, packaging, etc." />
        </div>

        {form.productName.trim() && (
          <div className="sm:col-span-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={aiMutation.isPending}
              onClick={() => aiMutation.mutate({ productName: form.productName.trim(), city: form.deliveryCity.trim() || undefined, qualityGrade: form.qualityGrade || undefined })}
            >
              {aiMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Bot className="mr-1.5 h-4 w-4" />}
              AI price check
            </Button>
            {aiRec && (
              <div className="mt-2 space-y-2.5 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-800">
                {aiRec.count === 0 ? (
                  <p>🤖 {aiRec.notes || "Not enough price data yet. Publish a budget range and farmers will bid."}</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">🤖 AI Price Intelligence</span>
                        <Badge variant="outline" className="border-violet-300 bg-white/60 text-xs capitalize text-violet-700">
                          {aiRec.source === "blended" ? "Market blend" : aiRec.source}
                          {aiRec.cityMatched ? " · your city" : ""}
                        </Badge>
                      </div>
                      <span className="rounded-full bg-violet-200/70 px-2 py-0.5 text-xs font-medium text-violet-800">
                        Confidence {aiRec.confidenceScore}%
                      </span>
                    </div>

                    <div className="rounded-lg bg-white/70 p-2.5">
                      <p className="flex items-center justify-between">
                        <span className="text-xs text-violet-700/80">Current market range</span>
                        <span className="font-medium">₹{aiRec.minPerKg} – ₹{aiRec.maxPerKg}/kg</span>
                      </p>
                      <p className="mt-1 flex items-center justify-between">
                        <span className="text-xs text-violet-700/80">Recommended RFQ range</span>
                        <span className="font-semibold text-violet-900">₹{aiRec.recommendedMin} – ₹{aiRec.recommendedMax}/kg</span>
                      </p>
                      <p className="mt-1 flex items-center justify-between">
                        <span className="text-xs text-violet-700/80">Suggested price</span>
                        <span className="text-base font-bold text-emerald-700">₹{aiRec.suggestedPricePerKg}/kg</span>
                      </p>
                    </div>

                    {aiRec.reasons?.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-violet-700/80">Why?</p>
                        <ul className="mt-0.5 list-inside space-y-0.5 text-xs">
                          {aiRec.reasons.map((r: string) => (
                            <li key={r}>✓ {r}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <p className="text-xs text-violet-700/80">{aiRec.notes}</p>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          set("priceCeilingPerKg", String(aiRec.recommendedMax));
                          set("budgetMinPerKg", String(aiRec.recommendedMin));
                          set("budgetMaxPerKg", String(aiRec.recommendedMax));
                        }}
                      >
                        Use budget ₹{aiRec.recommendedMin}–₹{aiRec.recommendedMax}/kg
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => set("priceCeilingPerKg", String(aiRec.suggestedPricePerKg))}
                      >
                        Use ₹{aiRec.suggestedPricePerKg}/kg
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <div className="sm:col-span-2">
          <Button
            disabled={!form.productName || !form.category || createMutation.isPending || (!form.recurring && (!form.quantityKg || form.quantityKg <= 0)) || (form.recurring && form.quantityPerWeekKg <= 0) || !form.deliveryCity.trim() || !form.deliveryAddress.trim()}
            onClick={() =>
              createMutation.mutate({
                ...form,
                priceCeilingPerKg: form.priceCeilingPerKg ? Number(form.priceCeilingPerKg) : null,
                budgetMinPerKg: form.budgetMinPerKg ? Number(form.budgetMinPerKg) : null,
                budgetMaxPerKg: form.budgetMaxPerKg ? Number(form.budgetMaxPerKg) : null,
                deadline: form.deadline ? new Date(form.deadline).toISOString() : null,
                quantityKg: form.recurring ? null : form.quantityKg,
                quantityPerWeekKg: form.recurring ? form.quantityPerWeekKg : null,
              })
            }
          >
            {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Publish RFQ
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
