"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Loader2, Plus, CalendarDays, Truck, MapPin, Package } from "lucide-react";
import { api } from "../../lib/api/client";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";

const requestStatusVariant: Record<string, any> = {
  open: "success",
  offers_received: "warning",
  awarded: "secondary",
  cancelled: "destructive",
};

const orderStatusVariant: Record<string, any> = {
  confirmed: "secondary",
  preparing: "warning",
  picked_up: "warning",
  out_for_delivery: "success",
  delivered: "success",
  cancelled: "destructive",
};

function ItemsSummary({ items }: { items: any[] }) {
  return (
    <p className="text-sm text-gray-600">
      {(items || []).map((i) => `${i.name} ${i.quantityKg} kg`).join(" • ")}
    </p>
  );
}

export default function CustomerBulkOrdersPage() {
  const [tab, setTab] = useState<"requests" | "orders">("requests");

  const { data: requestsData, isLoading: requestsLoading } = useQuery({
    queryKey: ["bulk", "requests"],
    queryFn: () => api.get("/bulk-orders/requests", { params: { status: "all" } }),
  });

  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: ["bulk", "orders"],
    queryFn: () => api.get("/bulk-orders/orders"),
  });

  const requests = requestsData?.data?.requests || [];
  const orders = ordersData?.data?.orders || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-emerald-600" />
          <h1 className="text-2xl font-bold">Bulk &amp; Event Orders</h1>
        </div>
        <Button asChild>
          <Link href="/bulk-orders/create">
            <Plus className="mr-2 h-4 w-4" /> Create Bulk Order
          </Link>
        </Button>
      </div>
      <p className="text-sm text-gray-500">
        Planning a wedding, function, festival or party? Request quotes for large quantities and let
        farmers compete for your order — you pick the best offer.
      </p>

      <div className="flex gap-2">
        {(["requests", "orders"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              tab === t ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {t === "requests" ? "My Requests" : "My Bulk Orders"}
          </button>
        ))}
      </div>

      {tab === "requests" ? (
        requestsLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          </div>
        ) : requests.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <CalendarDays className="h-10 w-10 text-gray-300" />
              <p className="font-medium">No bulk requests yet</p>
              <p className="text-sm text-gray-500">Create one and let farmers quote for your event.</p>
              <Button asChild>
                <Link href="/bulk-orders/create">Create Bulk Order</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {requests.map((r: any) => (
              <Link key={r.id} href={`/bulk-orders/${r.id}`}>
                <Card className="transition-colors hover:border-emerald-300">
                  <CardContent className="space-y-2 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="border-purple-200 bg-purple-50 text-purple-700">
                          {r.requestType === "b2b" ? "Business RFQ" : "🎉 Event Request"}
                        </Badge>
                        <p className="font-medium">{r.requestNumber}</p>
                      </div>
                      <Badge variant={requestStatusVariant[r.status] || "secondary"}>{r.status.replace(/_/g, " ")}</Badge>
                    </div>
                    <p className="text-sm font-medium capitalize text-gray-800">{r.purpose}</p>
                    <ItemsSummary items={r.items} />
                    <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <CalendarDays className="h-3.5 w-3.5" /> Deliver {r.requestedDeliveryDate}
                      </span>
                      {r.requestedDeliveryTime ? <span>{r.requestedDeliveryTime}</span> : null}
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" /> {r.deliveryCity || r.deliveryAddress?.city || "Location"}
                      </span>
                      <span>{r.offerCount ?? 0} offer(s)</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )
      ) : ordersLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : orders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Package className="h-10 w-10 text-gray-300" />
            <p className="font-medium">No bulk orders yet</p>
            <p className="text-sm text-gray-500">Once you accept a farmer&apos;s offer, your bulk order appears here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {orders.map((o: any) => (
            <Card key={o.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Truck className="h-4 w-4 text-emerald-600" />
                    <p className="font-medium">{o.orderNumber}</p>
                  </div>
                  <Badge variant={orderStatusVariant[o.status] || "secondary"}>{o.status.replace(/_/g, " ")}</Badge>
                </div>
                <ItemsSummary items={o.items} />
                <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" /> {o.farmerInfo?.farmName || "Farm"}
                  </span>
                  <span>Deliver {o.requestedDeliveryDate}</span>
                  <span>₹{Number(o.totalAmount || 0).toFixed(2)}</span>
                  <span className="capitalize">{o.deliveryMethod?.replace(/_/g, " ")}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}