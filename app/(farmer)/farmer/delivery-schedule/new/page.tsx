"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckCircle, Clock, Loader2, Package, Save } from "lucide-react";
import toast from "react-hot-toast";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { api } from "../../../../lib/api/client";
import { cn, formatPrice } from "../../../../lib/utils";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TIME_SLOTS = ["Morning", "Mid-day", "Afternoon"];
const ACTIVE_STATUSES = ["pending", "confirmed", "processing", "ready_for_delivery", "ready_for_pickup"];

interface SlotSelection {
  day: string;
  timeSlot: string;
}

const asArray = (value: any): any[] => (Array.isArray(value) ? value : []);

const getOrderId = (order: any) => String(order?.id || order?._id || "");

export default function NewDeliverySchedulePage() {
  const queryClient = useQueryClient();
  const [selections, setSelections] = useState<Record<string, SlotSelection>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["farmerOrdersForSchedule"],
    queryFn: () => api.get("/farmers/me/orders", { params: { limit: 100 } }),
  });

  const orders = useMemo(() => {
    const all = asArray(data?.data?.orders);
    return all.filter((order) => ACTIVE_STATUSES.includes(String(order?.orderStatus || "").toLowerCase()));
  }, [data]);

  useEffect(() => {
    if (!orders.length) return;
    setSelections((prev) => {
      const next = { ...prev };
      orders.forEach((order) => {
        const id = getOrderId(order);
        if (next[id]) return;
        next[id] = {
          day: order?.deliveryDay || "Monday",
          timeSlot: order?.deliveryTimeSlot || "Morning",
        };
      });
      return next;
    });
  }, [orders]);

  const saveMutation = useMutation({
    mutationFn: (orderId: string) => {
      const slot = selections[orderId];
      return api.put(`/farmers/me/orders/${orderId}/delivery-slot`, { day: slot.day, timeSlot: slot.timeSlot });
    },
    onSuccess: () => {
      toast.success("Delivery slot saved");
      queryClient.invalidateQueries({ queryKey: ["deliveryCalendar"] });
      queryClient.invalidateQueries({ queryKey: ["farmerRoute"] });
    },
    onError: () => toast.error("Failed to save delivery slot"),
  });

  const handleSave = (order: any) => {
    const orderId = getOrderId(order);
    if (!orderId) {
      toast.error("Order id is not available");
      return;
    }
    setSavingId(orderId);
    saveMutation.mutate(orderId, {
      onSettled: () => setSavingId(null),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Weekly delivery planner</p>
          <h1 className="text-3xl font-semibold tracking-tight">Schedule Delivery</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Assign a delivery day and time slot to each active order. They appear on your delivery calendar.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/farmer/delivery-calendar">
            <CalendarDays className="mr-2 h-4 w-4" />
            Back to Calendar
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <Card className="p-12 text-center">
          <CalendarDays className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No active orders to schedule</h3>
          <p className="mt-2 text-muted-foreground">
            Orders appear here once buyers purchase your products. Active orders include pending, confirmed, and ready-for-delivery ones.
          </p>
          <div className="mt-6">
            <Button asChild>
              <Link href="/farmer/delivery-calendar">View Delivery Calendar</Link>
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => {
            const orderId = getOrderId(order);
            const selection = selections[orderId];
            return (
              <Card key={orderId}>
                <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{order.customerName || "Customer"}</p>
                      <span className="text-xs text-muted-foreground">#{order.orderNumber}</span>
                      <Badge variant="outline">{String(order.orderStatus || "pending").replace(/_/g, " ")}</Badge>
                    </div>
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <Package className="h-3 w-3" />
                      {order.items?.length ?? 0} item{order.items?.length === 1 ? "" : "s"} · {formatPrice(order.totalAmount)}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <label className="flex items-center gap-2 text-sm">
                      <CalendarDays className="h-4 w-4 text-muted-foreground" />
                      <select
                        value={selection?.day || "Monday"}
                        onChange={(e) =>
                          setSelections((prev) => ({ ...prev, [orderId]: { ...prev[orderId], day: e.target.value } }))
                        }
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        {DAYS.map((day) => (
                          <option key={day} value={day}>
                            {day}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <select
                        value={selection?.timeSlot || "Morning"}
                        onChange={(e) =>
                          setSelections((prev) => ({ ...prev, [orderId]: { ...prev[orderId], timeSlot: e.target.value } }))
                        }
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        {TIME_SLOTS.map((slot) => (
                          <option key={slot} value={slot}>
                            {slot}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button
                      size="sm"
                      className={cn("shrink-0")}
                      onClick={() => handleSave(order)}
                      disabled={savingId === orderId}
                    >
                      {savingId === orderId ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-1.5 h-4 w-4" />
                      )}
                      Save
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            <CheckCircle className="mx-auto mb-1 h-5 w-5 text-emerald-600" />
            Saved slots appear on the{" "}
            <Link href="/farmer/delivery-calendar" className="font-medium text-primary underline">
              Delivery Calendar
            </Link>{" "}
            for planning and route building.
          </div>
        </div>
      )}
    </div>
  );
}
