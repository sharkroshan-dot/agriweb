"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Loader2 } from "lucide-react";
import { api } from "../../lib/api/client";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import toast from "react-hot-toast";

const DELIVERY_METHODS = ["farmer_delivery", "delivery_partner", "dedicated_transport", "buyer_pickup"];

export function AcceptOfferDialog({ offer, rfq, onClose }: { offer: any; rfq: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const remaining = rfq.remainingQuantityKg ?? rfq.quantityKg ?? offer.availableQuantityKg;
  const [qty, setQty] = useState(String(Math.min(offer.availableQuantityKg || remaining, remaining)));
  const [deliveryMethod, setDeliveryMethod] = useState(offer.deliveryMethod || "farmer_delivery");
  const [paymentMode, setPaymentMode] = useState("cod");
  const [advance, setAdvance] = useState("");
  const [notes, setNotes] = useState("");

  const accept = useMutation({
    mutationFn: (payload: any) => api.post(`/b2b/offers/${offer.id}/accept`, payload),
    onSuccess: (res: any) => {
      toast.success(`Order ${res?.data?.order?.orderNumber || ""} created! Remaining ${res?.data?.remainingQuantityKg ?? 0} kg.`);
      onClose();
      queryClient.invalidateQueries({ queryKey: ["b2b", "rfqs"] });
      queryClient.invalidateQueries({ queryKey: ["b2b", "orders"] });
      queryClient.invalidateQueries({ queryKey: ["b2b", "rfq", "offers", rfq.id] });
    },
    onError: (err: any) => toast.error(err?.message || "Failed to accept offer"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-md">
        <CardContent className="p-0" onClick={(e) => e.stopPropagation()}>
          <div className="space-y-4 p-5">
            <div>
              <p className="text-lg font-semibold">Accept {offer.farmerInfo?.farmName || "farmer"}'s quote</p>
              <p className="text-sm text-gray-500">
                ₹{offer.pricePerKg}/kg · {offer.availableQuantityKg} kg available · RFQ needs {rfq.quantityKg ?? `${rfq.quantityPerWeekKg} kg/wk`} (remaining {Math.round(remaining)} kg)
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Quantity to accept (kg) *</label>
              <Input type="number" min="1" max={Math.max(offer.availableQuantityKg || remaining, remaining)} value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Delivery method</label>
              <select value={deliveryMethod} onChange={(e) => setDeliveryMethod(e.target.value)} className="h-9 w-full rounded-md border border-gray-200 px-2 text-sm">
                {DELIVERY_METHODS.map((m) => (
                  <option key={m} value={m}>{m.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Payment mode</label>
              <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className="h-9 w-full rounded-md border border-gray-200 px-2 text-sm">
                <option value="cod">Cash on delivery</option>
                <option value="online">Online payment</option>
                <option value="advance">Advance + balance</option>
              </select>
            </div>
            {paymentMode === "advance" && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Advance amount (₹)</label>
                <Input type="number" min="0" value={advance} onChange={(e) => setAdvance(e.target.value)} />
              </div>
            )}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Notes</label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery instructions" />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button
                className="flex-1"
                disabled={!qty || Number(qty) <= 0 || accept.isPending}
                onClick={() =>
                  accept.mutate({
                    quantityKg: Number(qty),
                    deliveryMethod,
                    paymentMode,
                    advanceAmount: advance ? Number(advance) : 0,
                    notes,
                  })
                }
              >
                {accept.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                Create B2B Order
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
