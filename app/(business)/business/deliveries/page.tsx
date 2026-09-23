"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Truck, Loader2, MapPin, Clock, ShieldCheck, ChevronDown, ChevronUp } from "lucide-react";
import { api } from "../../../lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";

const deliveryStatuses = ["preparing", "quality_check", "dispatched", "in_transit", "delivered"];

const statusVariant: Record<string, any> = {
  preparing: "secondary",
  quality_check: "outline",
  dispatched: "default",
  in_transit: "warning",
  delivered: "success",
};

const statusLabel: Record<string, string> = {
  preparing: "Preparing",
  quality_check: "Quality Check",
  dispatched: "Dispatched",
  in_transit: "In Transit",
  delivered: "Delivered",
};

const methodLabel: Record<string, string> = {
  farmer_delivery: "Farmer Delivery",
  delivery_partner: "Delivery Partner",
  dedicated_transport: "Dedicated Transport",
  buyer_pickup: "Buyer Pickup",
};

function DeliveryTimeline({ status }: { status: string }) {
  const flow = ["preparing", "quality_check", "dispatched", "in_transit", "delivered"];
  const idx = flow.indexOf(status);
  if (idx < 0) return null;
  return (
    <div className="flex items-center gap-1">
      {flow.map((s, i) => (
        <div key={s} className="flex items-center">
          <div
            className={`h-2.5 w-2.5 rounded-full ${i <= idx ? (i === idx ? "bg-emerald-600 ring-2 ring-emerald-200" : "bg-emerald-500") : "bg-gray-200"}`}
            title={s}
          />
          {i < flow.length - 1 && <div className={`h-0.5 w-3 sm:w-5 ${i < idx ? "bg-emerald-500" : "bg-gray-200"}`} />}
        </div>
      ))}
    </div>
  );
}

export default function DeliveriesPage() {
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: ordersData, isLoading } = useQuery({
    queryKey: ["b2b", "orders"],
    queryFn: () => api.get("/b2b/orders"),
  });

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  const all = (ordersData?.data?.orders || []).filter((o: any) => deliveryStatuses.includes(o.status));
  const deliveries = filter ? all.filter((o: any) => o.status === filter) : all;
  const countByStatus = (s: string) => all.filter((o: any) => o.status === s).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Truck className="h-6 w-6 text-emerald-600" />
          <h1 className="text-2xl font-bold">Deliveries</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {["", ...deliveryStatuses].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded-full px-4 py-2 text-sm font-medium capitalize transition-colors ${
                filter === s ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {s === "" ? "All" : statusLabel[s]}
              {s !== "" ? ` (${countByStatus(s)})` : ""}
            </button>
          ))}
        </div>
      </div>

      {deliveries.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <Truck className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm text-gray-500">No deliveries in this stage right now.</p>
            <p className="text-sm text-gray-400">Accepted quotes will appear here as farmers prepare and dispatch them.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {deliveries.map((o: any) => (
            <Card key={o.id}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{o.orderNumber || o.id}</p>
                      <Badge variant={statusVariant[o.status] || "secondary"}>{statusLabel[o.status] || o.status.replace(/_/g, " ")}</Badge>
                      <Badge variant="outline">{methodLabel[o.deliveryMethod] || (o.deliveryMethod || "farmer_delivery").replace(/_/g, " ")}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-gray-500">
                      {o.productName} · {o.quantityKg} kg · {o.farmerInfo?.farmName || "Farm"}
                      {o.farmerInfo?.isVerified ? (
                        <span className="ml-1 inline-flex items-center gap-0.5 text-emerald-600"><ShieldCheck className="h-3.5 w-3.5" /> verified</span>
                      ) : null}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-emerald-600">₹{o.totalAmount}</p>
                    <p className="text-xs text-gray-400">
                      {o.expectedDeliveryDate ? `expected ${o.expectedDeliveryDate}` : o.requiredDate ? `required ${o.requiredDate}` : ""}
                    </p>
                  </div>
                </div>

                <div className="mt-3">
                  <DeliveryTimeline status={o.status} />
                </div>

                <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500">
                  {o.deliveryCity ? (
                    <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {o.deliveryCity}{o.deliveryState ? `, ${o.deliveryState}` : ""}</span>
                  ) : null}
                  {o.deliveryTimeSlot ? (
                    <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {o.deliveryTimeSlot}</span>
                  ) : null}
                  <span>started {new Date(o.startedAt).toLocaleDateString()}</span>
                </div>

                {o.deliveryAddress ? (
                  <div className="mt-2 flex items-start gap-1 rounded-lg bg-gray-50 p-2 text-xs text-gray-500">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{o.deliveryAddress}</span>
                  </div>
                ) : null}

                {o.notes ? (
                  <p className="mt-2 text-xs text-gray-400">📝 {o.notes}</p>
                ) : null}

                <button
                  type="button"
                  onClick={() => setExpanded(expanded === o.id ? null : o.id)}
                  className="mt-3 flex items-center gap-1 text-xs font-medium text-emerald-600"
                >
                  {expanded === o.id ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  {expanded === o.id ? "Hide order details" : "Order details"}
                </button>
                {expanded === o.id && (
                  <div className="mt-2 grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-2">
                    <p className="text-gray-600">Product: <span className="font-medium">{o.productName}</span></p>
                    <p className="text-gray-600">Quantity: <span className="font-medium">{o.quantityKg} kg</span></p>
                    <p className="text-gray-600">Rate: <span className="font-medium">₹{o.pricePerKg}/kg</span></p>
                    <p className="text-gray-600">Delivery charge: <span className="font-medium">₹{o.deliveryCharge || 0}</span></p>
                    <p className="text-gray-600">Total: <span className="font-medium">₹{o.totalAmount}</span></p>
                    <p className="text-gray-600">Payment: <span className="font-medium capitalize">{o.paymentMode} · {o.paymentStatus}</span></p>
                    {o.qualityCheck ? (
                      <p className="text-gray-600 sm:col-span-2">Quality check: <span className="font-medium capitalize">{o.qualityCheck}</span></p>
                    ) : null}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
