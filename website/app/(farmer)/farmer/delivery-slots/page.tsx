"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Truck,
  Plus,
  CalendarDays,
  Clock,
  MapPin,
  Users,
  Loader2,
  XCircle,
  IndianRupee,
  Map as MapIcon,
} from "lucide-react";
import { api } from "../../../lib/api/client";
import { cn, formatDate } from "../../../lib/utils";
import { geocodeAddress } from "../../../lib/geo/geocode";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import { Map } from "../../../components/shared/map";
import toast from "react-hot-toast";

interface DeliverySlot {
  id: string;
  area: string;
  date: string;
  startTime: string;
  endTime: string;
  radiusKm: number;
  maxOrders: number;
  deliveryFee: number;
  status: string;
  bookings?: number;
  notes?: string;
}

export default function FarmerDeliverySlotsPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    area: "",
    date: "",
    startTime: "07:00",
    endTime: "10:00",
    radiusKm: "10",
    maxOrders: "25",
    deliveryFee: "0",
    notes: "",
  });

  const { data: slotsData, isLoading } = useQuery({
    queryKey: ["farmerDeliverySlots"],
    queryFn: () => api.get("/delivery-slots/farmer/slots"),
  });

  const createMutation = useMutation({
    mutationFn: (payload: any) => api.post("/delivery-slots/slots", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farmerDeliverySlots"] });
      setShowForm(false);
      toast.success("Delivery slot published!");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to publish slot"),
  });

  const cancelMutation = useMutation({
    mutationFn: (slotId: string) => api.post(`/delivery-slots/slots/${slotId}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farmerDeliverySlots"] });
      toast.success("Slot cancelled");
    },
  });

  const slots: DeliverySlot[] = (slotsData?.data?.slots || []).map((s: any) => ({ ...s, id: s._id || s.id }));

  const [areaCoords, setAreaCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geocoding, setGeocoding] = useState(false);

  // Resolve the publish-form area to coordinates (debounced) for a live
  // radius preview while the farmer types.
  useEffect(() => {
    const area = form.area.trim();
    setAreaCoords(null);
    if (!area) {
      setGeocoding(false);
      return;
    }
    setGeocoding(true);
    const t = setTimeout(async () => {
      const coords = await geocodeAddress(area);
      setAreaCoords(coords);
      setGeocoding(false);
    }, 700);
    return () => clearTimeout(t);
  }, [form.area]);

  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [areaCoordMap, setAreaCoordMap] = useState<Record<string, { lat: number; lng: number }>>({});
  const uniqueAreas = useMemo(
    () => Array.from(new Set(slots.map((s: DeliverySlot) => s.area.trim()).filter(Boolean))),
    [slots]
  );
  const areaKey = uniqueAreas.join("|");

  // Geocode each published slot area once so the slot map can place them.
  useEffect(() => {
    let cancelled = false;
    const areas = areaKey.split("|").filter(Boolean);
    (async () => {
      for (const area of areas) {
        if (cancelled) return;
        if (areaCoordMap[area]) continue;
        const coords = await geocodeAddress(area);
        if (cancelled) return;
        if (coords) setAreaCoordMap((prev) => ({ ...prev, [area]: coords }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaKey]);

  const previewRadius = Math.max(1, Number(form.radiusKm) || 10);
  const selectedSlot = slots.find((s: DeliverySlot) => s.id === selectedSlotId) || null;
  const slotMarkers = slots
    .filter((s: DeliverySlot) => areaCoordMap[s.area.trim()])
    .map((s: DeliverySlot) => ({
      id: s.id,
      lat: areaCoordMap[s.area.trim()].lat,
      lng: areaCoordMap[s.area.trim()].lng,
      title: s.area,
      color: "#059669",
      info: `${formatDate(s.date)} • ${s.startTime} – ${s.endTime} · ${s.bookings ?? 0}/${s.maxOrders} joined`,
    }));
  const selectedCircle =
    selectedSlot && areaCoordMap[selectedSlot.area.trim()]
      ? { center: areaCoordMap[selectedSlot.area.trim()], radiusKm: selectedSlot.radiusKm }
      : undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Delivery Slot Marketplace</h1>
          <p className="text-gray-500">
            Publish planned delivery windows - customers in the area can join before the cutoff.
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? <XCircle className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
          {showForm ? "Cancel" : "New Delivery Slot"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Publish a Delivery Slot</CardTitle>
            <CardDescription>Turn scattered orders into a planned, batched delivery run.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Area *</label>
              <Input
                value={form.area}
                onChange={(e) => setForm({ ...form, area: e.target.value })}
                placeholder="e.g. Coimbatore North"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Delivery date *</label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Start time</label>
              <Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">End time</label>
              <Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Radius (km)</label>
              <Input type="number" min={1} value={form.radiusKm} onChange={(e) => setForm({ ...form, radiusKm: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Max orders</label>
              <Input type="number" min={1} value={form.maxOrders} onChange={(e) => setForm({ ...form, maxOrders: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Delivery fee (₹)</label>
              <Input type="number" min={0} value={form.deliveryFee} onChange={(e) => setForm({ ...form, deliveryFee: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Notes (optional)</label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Saturday morning batch" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-gray-500">Coverage preview</label>
              {geocoding ? (
                <div className="mt-1 flex h-[300px] flex-col items-center justify-center rounded-xl border border-dashed bg-gray-50">
                  <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
                  <p className="mt-2 text-xs text-gray-500">Locating "{form.area}"…</p>
                </div>
              ) : areaCoords ? (
                <div className="mt-1">
                  <Map
                    center={areaCoords}
                    zoom={10}
                    height="300px"
                    className="rounded-xl border"
                    markers={[
                      {
                        id: "slot-area",
                        lat: areaCoords.lat,
                        lng: areaCoords.lng,
                        title: form.area,
                        color: "#059669",
                        info: `${previewRadius} km delivery radius`,
                      },
                    ]}
                    circle={{ center: areaCoords, radiusKm: previewRadius }}
                    drawRoute={false}
                  />
                  <p className="mt-2 flex items-center gap-1 text-xs text-gray-400">
                    <MapPin className="h-3 w-3" />
                    Customers within the indigo circle can join this slot.
                  </p>
                </div>
              ) : (
                <div
                  className={cn(
                    "mt-1 flex h-[300px] flex-col items-center justify-center rounded-xl border border-dashed text-center",
                    form.area ? "bg-gray-50" : "bg-white"
                  )}
                >
                  <MapPin className={cn("h-8 w-8", form.area ? "text-amber-400" : "text-gray-300")} />
                  <p className="mt-2 max-w-xs px-4 text-xs text-gray-500">
                    {form.area
                      ? `Couldn't locate "${form.area}". Try a better-known area name like "Coimbatore North".`
                      : "Type an area above to preview its delivery radius on the map."}
                  </p>
                </div>
              )}
            </div>
            <div className="sm:col-span-2">
              <Button
                className="w-full sm:w-auto"
                disabled={!form.area || !form.date || createMutation.isPending}
                onClick={() =>
                  createMutation.mutate({
                    area: form.area,
                    date: new Date(form.date + "T" + (form.startTime || "07:00")).toISOString(),
                    startTime: form.startTime,
                    endTime: form.endTime,
                    radiusKm: Number(form.radiusKm),
                    maxOrders: Number(form.maxOrders),
                    deliveryFee: Number(form.deliveryFee),
                    notes: form.notes || null,
                  })
                }
              >
                {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Publish Slot
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : slots.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <Truck className="h-10 w-10 text-gray-300" />
            <p className="mt-3 font-medium text-gray-600">No delivery slots yet</p>
            <p className="text-sm text-gray-400">Publish a slot to start batching deliveries.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {slots.map((slot) => (
              <Card
                key={slot.id}
                onClick={() =>
                  setSelectedSlotId((prev) => (prev === slot.id ? null : slot.id))
                }
                className={cn(
                  "cursor-pointer transition-shadow hover:shadow-md",
                  selectedSlotId === slot.id && "ring-2 ring-emerald-500"
                )}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <Truck className="h-5 w-5 text-emerald-600" />
                      <CardTitle className="text-base">{slot.area}</CardTitle>
                    </div>
                    {slot.status === "full" ? (
                      <Badge variant="destructive">Full</Badge>
                    ) : slot.status === "closed" ? (
                      <Badge variant="secondary">Closed</Badge>
                    ) : slot.status === "cancelled" ? (
                      <Badge variant="destructive">Cancelled</Badge>
                    ) : (
                      <Badge variant="outline">{slot.bookings ?? 0}/{slot.maxOrders}</Badge>
                    )}
                  </div>
                  <CardDescription className="flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" /> {formatDate(slot.date)} • {slot.startTime} – {slot.endTime}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-emerald-600" />
                      {slot.radiusKm} km radius
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-emerald-600" />
                      {slot.bookings ?? 0} joined
                    </div>
                    <div className="flex items-center gap-2">
                      <IndianRupee className="h-4 w-4 text-emerald-600" />
                      ₹{slot.deliveryFee} fee
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-emerald-600" />
                      cutoff {(slot as any).cutoffTime ? formatDate((slot as any).cutoffTime) : "none"}
                    </div>
                  </div>
                  {slot.status !== "cancelled" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={(e) => {
                        e.stopPropagation();
                        cancelMutation.mutate(slot.id);
                      }}
                    >
                      Cancel Slot
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {slotMarkers.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MapIcon className="h-5 w-5 text-emerald-600" />
                  Slot Coverage Map
                </CardTitle>
                <CardDescription>
                  Click a slot card to highlight its delivery radius. {selectedSlot ? `Showing ${selectedSlot.radiusKm} km around ${selectedSlot.area}.` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Map
                  height="360px"
                  zoom={9}
                  center={slotMarkers[0]}
                  markers={slotMarkers}
                  circle={selectedCircle}
                  drawRoute={false}
                  onMarkerClick={(m: any) => setSelectedSlotId(m?.id ?? null)}
                  className="rounded-xl border"
                />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}