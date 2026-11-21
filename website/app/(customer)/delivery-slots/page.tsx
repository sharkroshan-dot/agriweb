"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  Package,
  SearchX,
  CheckCircle2,
  Loader2,
  LocateFixed,
  Sun,
  CloudSun,
  Moon,
  Truck,
  Users,
} from "lucide-react";
import { api } from "../../lib/api/client";
import { formatDate, formatPrice } from "../../lib/utils";
import { useCartStore } from "../../lib/store/cart-store";
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
  remainingCapacityKg?: number;
  maxCapacityKg?: number;
  farmerInfo?: { name?: string; farmName?: string; rating?: number; farmAddress?: string };
  notes?: string;
}

const dateKey = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const parseSlotDate = (value: string) => {
  const raw = String(value || "").slice(0, 10);
  const parts = raw.split("-").map(Number);
  if (parts.length === 3 && parts.every(Number.isFinite)) {
    return new Date(parts[0], parts[1] - 1, parts[2], 12);
  }
  return new Date(value);
};

const slotPeriod = (slot: DeliverySlot) => {
  const text = `${slot.startTime} ${slot.endTime}`.toLowerCase();
  const hour = Number(String(slot.startTime).match(/\d{1,2}/)?.[0] || 0);
  if (hour < 11) return { label: "Morning", Icon: Sun };
  if (hour < 14) return { label: "Midday", Icon: Sun };
  if (hour < 17) return { label: "Afternoon", Icon: CloudSun };
  if (hour >= 17 || text.includes("pm")) return { label: "Evening", Icon: Moon };
  return { label: "Available window", Icon: Clock3 };
};

export default function DeliverySlotsPage() {
  const queryClient = useQueryClient();
  const cartItems = useCartStore((state) => state.items);
  const [area, setArea] = useState("");
  const [state, setState] = useState({ lat: "", lng: "" });
  const [radius, setRadius] = useState(15);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const { data: slotsData, isLoading } = useQuery({
    queryKey: ["delivery-slots", "available", area, radius, state.lat, state.lng],
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

  // Normalize the current user's joined-slot response before rendering it.
  const mySlots: any[] = useMemo(() => {
    const responseData = mySlotsData?.data;
    const payload = responseData?.data ?? responseData;
    const raw = payload?.bookings ?? payload?.slots ?? payload;
    return Array.isArray(raw) ? raw : [];
  }, [mySlotsData]);

  const joinMutation = useMutation({
    mutationFn: (slotId: string) => api.post(`/delivery-slots/slots/${slotId}/join`),
    onSuccess: () => {
      setBusyId(null);
      setSelectedSlotId("");
      queryClient.invalidateQueries({ queryKey: ["delivery-slots"] });
      toast.success("Delivery slot confirmed. The farmer will batch your order.");
    },
    onError: (err: any) => {
      setBusyId(null);
      toast.error(err?.message || "Failed to confirm delivery slot");
    },
  });

  const leaveMutation = useMutation({
    mutationFn: (slotId: string) => api.delete(`/delivery-slots/slots/${slotId}/join`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["delivery-slots"] });
      toast.success("Left the delivery slot");
    },
    onError: (err: any) => toast.error(err?.message || "Could not leave this slot"),
  });

  const slots: DeliverySlot[] = useMemo(() => {
    const raw = slotsData?.data?.slots || slotsData?.data || [];
    return (Array.isArray(raw) ? raw : []).map((slot: any) => ({
      ...slot,
      id: slot._id || slot.id,
    }));
  }, [slotsData]);

  const openSlots = useMemo(
    () => slots.filter((slot) => slot.status === "open" && (!slot.date || parseSlotDate(slot.date) >= new Date(new Date().setHours(0, 0, 0, 0)))),
    [slots],
  );

  useEffect(() => {
    if (!openSlots.length) {
      setSelectedDate("");
      setSelectedSlotId("");
      return;
    }
    const keys = openSlots.map((slot) => dateKey(parseSlotDate(slot.date))).filter(Boolean).sort();
    if (!selectedDate || !keys.includes(selectedDate)) {
      setSelectedDate(keys[0] || "");
      if (keys[0]) {
        const first = openSlots.find((slot) => dateKey(parseSlotDate(slot.date)) === keys[0]);
        setCalendarMonth(new Date(parseSlotDate(first!.date).getFullYear(), parseSlotDate(first!.date).getMonth(), 1));
      }
    }
  }, [openSlots, selectedDate]);

  const availableDates = useMemo(
    () => new Set(openSlots.map((slot) => dateKey(parseSlotDate(slot.date))).filter(Boolean)),
    [openSlots],
  );

  const selectedDateSlots = useMemo(
    () => openSlots
      .filter((slot) => dateKey(parseSlotDate(slot.date)) === selectedDate)
      .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime))),
    [openSlots, selectedDate],
  );

  const selectedSlot = selectedDateSlots.find((slot) => slot.id === selectedSlotId);
  const farmerCount = new Set(openSlots.map((slot) => slot.farmerInfo?.farmName || slot.farmerInfo?.name).filter(Boolean)).size;
  const cartSubtotal = cartItems.reduce((sum: number, item: any) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
  const cartCount = cartItems.reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0);

  const monthStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
  const monthDays = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
  const leadingDays = monthStart.getDay();
  const calendarCells = [
    ...Array.from({ length: leadingDays }, (_, index) => ({ key: `empty-${index}`, day: 0 })),
    ...Array.from({ length: monthDays }, (_, index) => ({ key: `day-${index + 1}`, day: index + 1 })),
  ];

  const selectedPeriod = selectedSlot ? slotPeriod(selectedSlot) : null;

  return (
    <div className="space-y-5 pb-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <Link href="/" className="hover:text-emerald-700">Home</Link>
          <span>/</span>
          <span className="text-slate-700">Delivery Slots</span>
        </div>
        <div className="flex items-center gap-3 pt-1">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
            <CalendarDays className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Delivery Slots</h1>
            <p className="text-sm text-slate-500">Choose a convenient delivery date and time from available farmer slots in your area.</p>
          </div>
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="grid gap-4 p-4 md:grid-cols-[1.25fr_0.8fr_0.65fr] md:items-center">
          <div className="min-w-0">
            <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <MapPin className="h-4 w-4 text-emerald-600" /> Delivery Address / Area
            </label>
            <input
              value={area}
              onChange={(event) => {
                setArea(event.target.value);
                setState({ lat: "", lng: "" });
              }}
              placeholder="Enter your delivery area or town"
              className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
          <div>
            <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <LocateFixed className="h-4 w-4 text-emerald-600" /> Radius
            </label>
            <select
              value={radius}
              onChange={(event) => setRadius(Number(event.target.value))}
              className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
            >
              {[5, 10, 15, 20, 30, 50, 100].map((value) => <option key={value} value={value}>{value} km</option>)}
            </select>
          </div>
          <Button
            variant="outline"
            className="h-11 w-full rounded-xl border-slate-300"
            disabled={locating}
            onClick={() => {
              if (!navigator.geolocation) {
                toast.error("Location is not available in this browser");
                return;
              }
              setLocating(true);
              navigator.geolocation.getCurrentPosition(
                (position) => {
                  const lat = String(position.coords.latitude);
                  const lng = String(position.coords.longitude);
                  setState({ lat, lng });
                  api.get("/delivery-slots/reverse-geocode", { params: { lat, lng } })
                    .then((response: any) => {
                      const name = response?.data?.data?.area || response?.data?.area;
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
            {locating ? "Locating..." : "Use My Location"}
          </Button>
        </CardContent>
      </Card>

      <div className="grid items-stretch gap-4 xl:grid-cols-[0.95fr_1.25fr_0.95fr]">
        <Card className="min-w-0 border-slate-200 shadow-sm">
          <CardContent className="p-4 sm:p-5">
            <h2 className="mb-5 flex items-center gap-2 text-base font-bold text-slate-900">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><CalendarDays className="h-5 w-5" /></span>
              Select Delivery Date
            </h2>
            <div className="mb-4 flex items-center justify-between">
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Previous month" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}>
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <p className="font-bold text-slate-900">{calendarMonth.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</p>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Next month" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}>
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day} className="py-2 text-xs font-semibold text-slate-500">{day}</span>)}
              {calendarCells.map((cell) => {
                if (!cell.day) return <span key={cell.key} className="h-10" />;
                const dayDate = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), cell.day);
                const key = dateKey(dayDate);
                const hasSlots = availableDates.has(key);
                const selected = selectedDate === key;
                const past = dayDate < new Date(new Date().setHours(0, 0, 0, 0));
                return (
                  <button
                    key={cell.key}
                    type="button"
                    disabled={!hasSlots || past}
                    onClick={() => { setSelectedDate(key); setSelectedSlotId(""); }}
                    className={`mx-auto flex h-10 w-10 items-center justify-center rounded-xl text-sm font-semibold transition ${selected ? "bg-emerald-600 text-white shadow-sm" : hasSlots ? "bg-emerald-50 text-emerald-800 hover:bg-emerald-100" : "text-slate-300"} ${past ? "cursor-not-allowed opacity-50" : ""}`}
                    aria-label={`${key}${hasSlots ? ", delivery slots available" : ", no published slots"}`}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>
            <div className="mt-5 flex flex-wrap gap-x-3 gap-y-2 border-t border-slate-100 pt-4 text-[11px] text-slate-500">
              <span className="flex items-center gap-1"><i className="h-3 w-3 rounded bg-emerald-600" /> Selected</span>
              <span className="flex items-center gap-1"><i className="h-3 w-3 rounded bg-emerald-100" /> Slots available</span>
              <span className="flex items-center gap-1"><i className="h-3 w-3 rounded bg-slate-100" /> No slots</span>
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0 border-slate-200 shadow-sm">
          <CardContent className="p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><CalendarDays className="h-5 w-5" /></span>
                Available Delivery Slots
              </h2>
              {selectedDate && <Badge className="border-emerald-100 bg-emerald-50 text-emerald-800">{formatDate(selectedDate)}</Badge>}
            </div>
            {isLoading ? (
              <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-emerald-600" /></div>
            ) : selectedDateSlots.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 px-5 text-center">
                <SearchX className="h-9 w-9 text-slate-300" />
                <p className="mt-3 font-semibold text-slate-700">No delivery slots available</p>
                <p className="mt-1 text-sm text-slate-500">Farmers have not published an available slot for this date and area yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {selectedDateSlots.map((slot) => {
                  const period = slotPeriod(slot);
                  const PeriodIcon = period.Icon;
                  const isSelected = selectedSlotId === slot.id;
                  const remainingOrders = Math.max(0, Number(slot.maxOrders || 0) - Number(slot.bookings || 0));
                  const remainingKg = Number(slot.remainingCapacityKg ?? 0);
                  const hasKgCapacity = slot.remainingCapacityKg !== undefined && slot.remainingCapacityKg !== null;
                  const full = slot.status !== "open" || (slot.maxOrders > 0 && remainingOrders <= 0) || (hasKgCapacity && remainingKg <= 0);
                  return (
                    <button
                      type="button"
                      key={slot.id}
                      disabled={full}
                      onClick={() => setSelectedSlotId(slot.id)}
                      className={`w-full rounded-2xl border p-3 text-left transition sm:p-4 ${isSelected ? "border-emerald-500 bg-emerald-50/70 ring-1 ring-emerald-200" : "border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/30"} ${full ? "cursor-not-allowed opacity-60" : ""}`}
                    >
                      <div className="flex items-start gap-3">
                        <span className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${isSelected ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 text-transparent"}`}>
                          {isSelected && <CheckCircle2 className="h-4 w-4" />}
                        </span>
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-500">
                          <PeriodIcon className="h-6 w-6" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-bold text-slate-900">{period.label}</span>
                            <Badge variant={full ? "secondary" : "outline"} className={!full ? "border-emerald-100 bg-emerald-50 text-emerald-800" : ""}>
                              {full ? "Full" : slot.maxOrders > 0 ? `${remainingOrders} places left` : "Available"}
                            </Badge>
                          </span>
                          <span className="mt-0.5 block text-sm font-medium text-slate-700">{slot.startTime} – {slot.endTime}</span>
                          <span className="mt-1 block text-xs text-slate-500">
                            Farmer: {slot.farmerInfo?.farmName || slot.farmerInfo?.name || "Local farmer"}
                            {slot.distanceKm !== undefined ? ` · ${slot.distanceKm} km away` : ""}
                          </span>
                          {hasKgCapacity && <span className="mt-1 block text-xs font-medium text-emerald-700">Available capacity: {remainingKg} kg</span>}
                          {slot.notes && <span className="mt-1 block text-xs text-slate-500">{slot.notes}</span>}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0 border-slate-200 shadow-sm">
          <CardContent className="p-4 sm:p-5">
            <h2 className="mb-5 flex items-center gap-2 text-base font-bold text-slate-900">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><Package className="h-5 w-5" /></span>
              Order Summary
            </h2>
            {cartItems.length ? (
              <>
                <div className="max-h-56 space-y-3 overflow-y-auto">
                  {cartItems.map((item: any) => (
                    <div key={`${item.id}-${item.variantId || "default"}`} className="flex items-center gap-3 border-b border-slate-100 pb-3 last:border-0">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-emerald-50 text-emerald-700">
                        {item.image ? <img src={item.image} alt={item.name} className="h-full w-full object-cover" /> : <Package className="h-6 w-6" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{item.name}</p>
                        <p className="text-xs text-slate-500">Qty: {item.quantity} × {formatPrice(item.price)}</p>
                      </div>
                      <p className="text-sm font-bold text-slate-900">{formatPrice(Number(item.price) * Number(item.quantity))}</p>
                    </div>
                  ))}
                </div>
                <div className="space-y-2 border-t border-slate-100 pt-3 text-sm">
                  <div className="flex justify-between text-slate-600"><span>Subtotal</span><span>{formatPrice(cartSubtotal)}</span></div>
                  <div className="flex justify-between text-slate-500"><span>Delivery charge</span><span>Calculated at checkout</span></div>
                  <div className="flex justify-between text-slate-500"><span>Platform fee</span><span>Calculated at checkout</span></div>
                  <div className="flex justify-between rounded-xl bg-emerald-50 px-3 py-3 font-bold text-slate-900"><span>Items total</span><span>{formatPrice(cartSubtotal)}</span></div>
                </div>
                <p className="mt-3 text-xs text-slate-500">{cartCount} item quantity in your cart</p>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center">
                <Package className="mx-auto h-7 w-7 text-slate-300" />
                <p className="mt-2 text-sm font-medium text-slate-700">No items in your cart</p>
                <p className="mt-1 text-xs text-slate-500">You can still join a farmer&apos;s delivery slot.</p>
                <Button asChild variant="outline" size="sm" className="mt-3"><Link href="/cart">View cart</Link></Button>
              </div>
            )}
            <div className="mt-4 rounded-xl bg-emerald-50 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900"><Truck className="h-5 w-5" /> Selected Delivery Slot</div>
              {selectedSlot && selectedPeriod ? (
                <div className="mt-2 text-sm text-slate-700">
                  <p className="font-semibold">{formatDate(selectedSlot.date)} · {selectedPeriod.label}</p>
                  <p>{selectedSlot.startTime} – {selectedSlot.endTime}</p>
                  <p className="mt-1 text-xs text-slate-500">{selectedSlot.farmerInfo?.farmName || selectedSlot.farmerInfo?.name || selectedSlot.area}</p>
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-500">Choose a date and an available farmer slot to continue.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {mySlots.length > 0 && (
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <h2 className="mb-3 flex items-center gap-2 font-bold text-slate-900"><Users className="h-5 w-5 text-emerald-600" /> Slots You&apos;ve Joined</h2>
            <div className="grid gap-2 md:grid-cols-2">
              {mySlots.map((booking: any) => (
                <div key={booking._id || booking.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800">{booking.slot?.area || "Delivery slot"}</p>
                    <p className="text-xs text-slate-500">{booking.slot?.date ? formatDate(booking.slot.date) : ""} · {booking.slot?.startTime} – {booking.slot?.endTime}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => leaveMutation.mutate(booking.slotId)}>Leave</Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col-reverse items-stretch justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
        <Button asChild variant="outline" className="h-11 rounded-xl border-slate-300">
          <Link href="/orders"><ArrowLeft className="mr-2 h-4 w-4" /> Back to My Orders</Link>
        </Button>
        <Button
          className="h-11 rounded-xl bg-emerald-700 px-6 text-white hover:bg-emerald-800"
          disabled={!selectedSlot || busyId === selectedSlot.id || joinMutation.isPending}
          onClick={() => {
            if (!selectedSlot) return;
            setBusyId(selectedSlot.id);
            joinMutation.mutate(selectedSlot.id);
          }}
        >
          {busyId === selectedSlot?.id || joinMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
          Confirm Delivery Slot
        </Button>
      </div>
      <p className="text-center text-xs text-slate-400">
        Showing published farmer slots only. Availability and capacity are refreshed from the delivery-slot service.
      </p>
    </div>
  );
}
