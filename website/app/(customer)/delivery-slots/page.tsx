"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Truck,
  MapPin,
  Clock,
  CalendarDays,
  Users,
  Loader2,
  SearchX,
  CheckCircle,
} from "lucide-react";
import { api } from "../../lib/api/client";
import { formatDate } from "../../lib/utils";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
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
  distanceKm?: number;
  farmerInfo?: { name?: string; farmName?: string; rating?: number; farmAddress?: string };
  notes?: string;
}

export default function DeliverySlotsPage() {
  const queryClient = useQueryClient();
  const [area, setArea] = useState("");
  const [state, setState] = useState({ lat: "", lng: "" });
  const [radius, setRadius] = useState(50);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const { data: slotsData, isLoading } = useQuery({
    queryKey: ["delivery-slots", "available", area, radius],
    queryFn: () =>
      api.get("/delivery-slots/available", {
        params: {
          radius,
          ...(area ? { area } : {}),
          ...(state.lat ? { lat: state.lat } : {}),
          ...(state.lng ? { lng: state.lng } : {}),
        },
      }),
  });

  const { data: mySlotsData } = useQuery({
    queryKey: ["delivery-slots", "my"],
    queryFn: () => api.get("/delivery-slots/my"),
  });

  const joinMutation = useMutation({
    mutationFn: (slotId: string) => api.post(`/delivery-slots/slots/${slotId}/join`),
    onSuccess: () => {
      setBusyId(null);
      queryClient.invalidateQueries({ queryKey: ["delivery-slots"] });
      toast.success("Joined the delivery slot! The farmer will batch your order.");
    },
    onError: (err: any) => {
      setBusyId(null);
      toast.error(err?.message || "Failed to join slot");
    },
  });

  const leaveMutation = useMutation({
    mutationFn: (slotId: string) => api.delete(`/delivery-slots/slots/${slotId}/join`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["delivery-slots"] });
      toast.success("Left the delivery slot");
    },
  });

  const slots: DeliverySlot[] = useMemo(() => {
    const raw = slotsData?.data?.slots || slotsData?.data || [];
    return raw.map((s: any) => ({ ...s, id: s._id || s.id }));
  }, [slotsData]);

  const mySlots = useMemo(() => {
    const raw = mySlotsData?.data?.bookings || mySlotsData?.data || [];
    return raw.map((b: any) => ({ ...b, id: b._id || b.id }));
  }, [mySlotsData]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold text-slate-900">Delivery Slots</h1>
        <p className="text-slate-500">
          Farmers publish delivery windows for your area — join one and the farmer will batch deliveries,
          saving you delivery cost.
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Area</label>
              <input
                value={area}
                onChange={(e) => {
                  setArea(e.target.value);
                  setState({ lat: "", lng: "" });
                }}
                placeholder="e.g. Coimbatore North"
                className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Radius</label>
              <select
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="h-10 appearance-none rounded-xl border border-slate-300 bg-white px-3 pr-8 text-sm text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              >
                {[10, 20, 50, 100, 200].map((r) => (
                  <option key={r} value={r}>
                    {r} km
                  </option>
                ))}
              </select>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                if (!navigator.geolocation) return;
                setLocating(true);
                navigator.geolocation.getCurrentPosition(
                  (pos) => {
                    const lat = String(pos.coords.latitude);
                    const lng = String(pos.coords.longitude);
                    setState({ lat, lng });
                    api
                      .get("/delivery-slots/reverse-geocode", { params: { lat, lng } })
                      .then((res: any) => {
                        const name = res?.data?.data?.area || res?.data?.area;
                        if (name) setArea(name);
                      })
                      .catch(() => {})
                      .finally(() => setLocating(false));
                  },
                  () => {
                    setLocating(false);
                    toast.error("Could not get your location");
                  },
                );
              }}
            >
              {locating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MapPin className="mr-2 h-4 w-4" />}
              {locating ? "Detecting..." : "Use My Location"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Available slots section */}
      <section className="rounded-3xl border bg-white p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-3 text-xl font-bold text-slate-900">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100">
              <Truck className="h-5 w-5 text-emerald-600" />
            </span>
            Available Delivery Slots
          </h2>
          {!isLoading && slots.length > 0 && (
            <p className="text-sm text-slate-500">
              {slots.length} slot{slots.length !== 1 ? "s" : ""} available
              {area ? ` in ${area}` : ""}
              {state.lat ? " near your location" : ""}
            </p>
          )}
        </div>

        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
          </div>
        ) : slots.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed py-12 text-center">
            <SearchX className="h-9 w-9 text-gray-300" />
            <p className="mt-3 font-medium text-gray-600">No delivery slots available yet</p>
            <p className="text-sm text-gray-400">Farmers publish delivery slots before they plan routes.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {slots.map((slot) => (
              <Card key={slot.id} className="overflow-hidden transition-all hover:shadow-md">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
                        <Truck className="h-5 w-5 text-emerald-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-900">{slot.area}</h3>
                        <p className="text-sm text-gray-500">{slot.farmerInfo?.farmName || slot.farmerInfo?.name}</p>
                      </div>
                    </div>
                    {slot.status === "full" ? (
                      <Badge variant="destructive">Full</Badge>
                    ) : slot.status === "closed" ? (
                      <Badge variant="secondary">Closed</Badge>
                    ) : (
                      <Badge variant="outline">{slot.bookings ?? 0}/{slot.maxOrders}</Badge>
                    )}
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                      <CalendarDays className="h-4 w-4 text-emerald-600" />
                      {formatDate(slot.date)}
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-emerald-600" />
                      {slot.startTime} – {slot.endTime}
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-emerald-600" />
                      {slot.distanceKm ? `${slot.distanceKm} km away` : `${slot.radiusKm} km radius`}
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-emerald-600" />
                      {slot.bookings ?? 0} joined
                    </div>
                  </div>

                  {slot.notes ? <p className="mt-3 text-sm text-gray-500">{slot.notes}</p> : null}

                  <Button
                    className="mt-4 w-full rounded-full"
                    disabled={slot.status !== "open" || busyId === slot.id}
                    onClick={() => {
                      setBusyId(slot.id);
                      joinMutation.mutate(slot.id);
                    }}
                  >
                    {busyId === slot.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                    Join This Slot
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {mySlots.length > 0 && (
        <section className="rounded-3xl border bg-white p-6">
          <h2 className="mb-4 flex items-center gap-3 text-xl font-bold text-slate-900">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100">
              <CheckCircle className="h-5 w-5 text-amber-600" />
            </span>
            Slots You've Joined
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {mySlots.map((b: any) => (
              <Card key={b.id}>
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-medium text-slate-900">{b.slot?.area || "Delivery slot"}</p>
                    <p className="text-sm text-gray-500">
                      {formatDate(b.slot?.date)} • {b.slot?.startTime} – {b.slot?.endTime}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => leaveMutation.mutate(b.slotId)}>
                    Leave
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}