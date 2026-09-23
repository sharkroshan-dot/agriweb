"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles,
  Loader2,
  CalendarDays,
  MapPin,
  Star,
  CheckCircle,
  Bot,
  Truck,
  Store,
  User,
  Package,
} from "lucide-react";
import { api } from "../../../lib/api/client";
import { Card, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../../components/ui/dialog";
import toast from "react-hot-toast";

const statusVariant: Record<string, any> = {
  open: "success",
  offers_received: "warning",
  awarded: "secondary",
  cancelled: "destructive",
};

const deliveryMethods = [
  { value: "farmer_delivery", label: "Farmer Delivery", icon: Truck },
  { value: "delivery_partner", label: "Delivery Partner", icon: Package },
  { value: "farm_pickup", label: "Farm Pickup", icon: Store },
];

export default function BulkRequestDetailPage() {
  const params = useParams<{ requestId: string }>();
  const requestId = params.requestId;
  const queryClient = useQueryClient();
  const [accepting, setAccepting] = useState<string | null>(null);
  const [deliveryMethod, setDeliveryMethod] = useState("farmer_delivery");
  const [paymentMethod, setPaymentMethod] = useState("cod");

  const { data, isLoading } = useQuery({
    queryKey: ["bulk", "request", requestId],
    queryFn: () => api.get(`/bulk-orders/requests/${requestId}`),
    enabled: Boolean(requestId),
  });

  const acceptMutation = useMutation({
    mutationFn: (payload: { offerId: string; deliveryMethod: string; paymentMethod: string }) =>
      api.post(`/bulk-orders/offers/${payload.offerId}/accept`, {
        deliveryMethod: payload.deliveryMethod,
        paymentMethod: payload.paymentMethod,
      }),
    onSuccess: () => {
      toast.success("Offer accepted! Bulk order created.");
      setAccepting(null);
      queryClient.invalidateQueries({ queryKey: ["bulk", "request", requestId] });
      queryClient.invalidateQueries({ queryKey: ["bulk", "requests"] });
      queryClient.invalidateQueries({ queryKey: ["bulk", "orders"] });
    },
    onError: (err: any) => toast.error(err?.message || "Failed to accept offer"),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  const request = data?.data;
  if (!request) {
    return <p className="py-12 text-center text-sm text-gray-400">Request not found.</p>;
  }

  const offers = request.offers || [];
  const recommendation = request.recommendation;
  const recommendedId = recommendation?.recommendedOfferIds?.[0];
  const pendingOffers = offers.filter((o: any) => o.status === "pending");
  const acceptedOffers = offers.filter((o: any) => o.status === "accepted");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-emerald-600" />
          <h1 className="text-2xl font-bold">{request.requestNumber}</h1>
        </div>
        <Badge variant={statusVariant[request.status] || "secondary"}>{request.status.replace(/_/g, " ")}</Badge>
      </div>

      {/* Request summary */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-emerald-600" />
            <p className="font-medium capitalize">{request.purpose}</p>
            {request.requestType === "b2b" ? <Badge variant="outline">Business RFQ</Badge> : <Badge variant="outline">🎉 Event</Badge>}
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-gray-600">
            {request.eventDate ? (
              <span className="flex items-center gap-1">
                <CalendarDays className="h-4 w-4" /> Event: {request.eventDate}
              </span>
            ) : null}
            <span className="flex items-center gap-1">
              <CalendarDays className="h-4 w-4" /> Deliver: {request.requestedDeliveryDate}
              {request.requestedDeliveryTime ? `, ${request.requestedDeliveryTime}` : ""}
            </span>
            <span className="flex items-center gap-1">
              <MapPin className="h-4 w-4" /> {request.deliveryCity || request.deliveryAddress?.city || "Location"}
            </span>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold">Items required</p>
            <div className="divide-y rounded-lg border">
              {(request.items || []).map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="font-medium">{item.name}</span>
                  <span className="text-gray-500">
                    {item.quantityKg} kg{item.qualityGrade ? ` • ${item.qualityGrade}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {request.notes ? <p className="text-sm text-gray-500">{request.notes}</p> : null}
        </CardContent>
      </Card>

      {/* AI recommendation */}
      {recommendation && pendingOffers.length > 0 ? (
        <Card className="border-purple-200 bg-gradient-to-r from-purple-50 to-violet-50">
          <CardContent className="space-y-3 p-5">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-purple-600" />
              <h2 className="font-semibold text-purple-900">AI Recommendation</h2>
            </div>
            <p className="text-sm text-gray-600">{recommendation.reason}</p>
            {(() => {
              const rec = offers.find((o: any) => o.id === recommendedId);
              if (!rec) return null;
              return (
                <div className="rounded-lg border border-purple-200 bg-white p-3">
                  <p className="font-medium text-purple-900">🏆 {rec.farmerInfo?.farmName || "Farm"}</p>
                  <p className="text-sm text-gray-600">₹{Number(rec.totalPrice || 0).toFixed(0)} estimated • {rec.coveragePercent}% coverage</p>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-gray-500">
                    {rec.farmerInfo?.rating ? (
                      <span className="flex items-center gap-1">
                        <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" /> {Number(rec.farmerInfo.rating).toFixed(1)}
                      </span>
                    ) : null}
                    <span>Delivery: {rec.deliveryAvailable ? "Available" : "Not available"}</span>
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      ) : null}

      {/* Split progress */}
      {request.status === "awarded" && acceptedOffers.length > 0 ? (
        <Card>
          <CardContent className="space-y-2 p-4">
            <p className="text-sm font-semibold">Accepted combination ({acceptedOffers.length} farmer{acceptedOffers.length > 1 ? "s" : ""})</p>
            {acceptedOffers.map((o: any) => (
              <div key={o.id} className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm">
                <span className="font-medium">{o.farmerInfo?.farmName || "Farm"}</span>
                <span className="text-emerald-700">{o.coveragePercent}% • ₹{Number(o.totalPrice || 0).toFixed(0)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Offers */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">
          Farmer Offers ({offers.length})
        </h2>
        {offers.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-gray-400">
              No offers yet. Farmers will start quoting once they see your request.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {offers.map((o: any) => (
              <Card key={o.id} className={o.id === recommendedId && o.status === "pending" ? "border-purple-300 ring-1 ring-purple-200" : ""}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{o.farmerInfo?.farmName || "Farm"}</p>
                      {o.id === recommendedId && o.status === "pending" ? (
                        <Badge variant="outline" className="border-purple-300 bg-purple-100 text-purple-700">
                          <Bot className="mr-1 h-3 w-3" /> AI pick
                        </Badge>
                      ) : null}
                    </div>
                    <Badge variant={o.status === "accepted" ? "success" : o.status === "declined" ? "secondary" : "warning"}>
                      {o.status}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                    {o.farmerInfo?.rating ? (
                      <span className="flex items-center gap-1">
                        <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" /> {Number(o.farmerInfo.rating).toFixed(1)}
                      </span>
                    ) : null}
                    <span>{o.coveragePercent}% of requested quantity</span>
                    <span>Delivery: {o.deliveryAvailable ? "Available" : "Not available"}</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(o.items || []).map((item: any, i: number) => (
                      <div key={i} className="flex justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
                        <span>{item.name}</span>
                        <span>
                          {item.quantityKg} kg × ₹{item.pricePerKg}
                        </span>
                      </div>
                    ))}
                  </div>
                  {o.deliveryNote ? <p className="text-xs text-gray-500">{o.deliveryNote}</p> : null}
                  <div className="flex items-center justify-between">
                    <p className="text-base font-bold text-emerald-700">Est. ₹{Number(o.totalPrice || 0).toFixed(0)}</p>
                    {o.status === "pending" ? (
                      <Button onClick={() => setAccepting(o.id)}>
                        <CheckCircle className="mr-1.5 h-4 w-4" /> Select Offer
                      </Button>
                    ) : o.status === "accepted" ? (
                      <Badge variant="success">Accepted</Badge>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Accept dialog */}
      <Dialog open={Boolean(accepting)} onOpenChange={(open) => !open && setAccepting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Accept this offer</DialogTitle>
            <DialogDescription>
              Choose how this bulk order should be delivered. You can still accept offers from other
              farmers until the full quantity is covered.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-500">Delivery method</label>
              <div className="grid gap-2 sm:grid-cols-3">
                {deliveryMethods.map((m) => {
                  const Icon = m.icon;
                  return (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setDeliveryMethod(m.value)}
                      className={`flex flex-col items-center gap-1 rounded-xl border p-3 text-xs font-medium transition-colors ${
                        deliveryMethod === m.value
                          ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                          : "border-gray-200 text-gray-500 hover:border-gray-300"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Payment</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="h-11 w-full rounded-full border border-input bg-background px-4 text-sm"
              >
                <option value="cod">Cash on Delivery</option>
                <option value="online">Online Payment</option>
              </select>
            </div>
            <Button
              className="w-full"
              disabled={acceptMutation.isPending}
              onClick={() =>
                accepting &&
                acceptMutation.mutate({ offerId: accepting, deliveryMethod, paymentMethod })
              }
            >
              {acceptMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
              Confirm &amp; Create Bulk Order
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}