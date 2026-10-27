"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Loader2 } from "lucide-react";
import { api } from "../../lib/api/client";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import toast from "react-hot-toast";

export function AcceptOfferDialog({ offer, rfq, onClose }: { offer: any; rfq: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const remaining = Number(rfq.remainingQuantityKg ?? rfq.quantityKg ?? offer.availableQuantityKg ?? 0);
  const offerAvailable = Number(offer.availableQuantityKg ?? offer.minOrderKg ?? 0);
  const maxAcceptable = Math.min(remaining > 0 ? remaining : offerAvailable, offerAvailable);
  const [qty, setQty] = useState(String(maxAcceptable > 0 ? maxAcceptable : ""));
  const [paymentMode, setPaymentMode] = useState("cod");
  const [advance, setAdvance] = useState("");
  const [notes, setNotes] = useState("");

  // Preview quote charges; the backend recalculates and persists the authoritative total.
  const quantity = Math.max(0, Number(qty) || 0);
  const unitPrice = Math.max(0, Number(offer.pricePerKg) || 0);
  const productSubtotal = Math.round(quantity * unitPrice * 100) / 100;
  const deliveryDistanceKm = offer.deliveryDistanceKm == null ? null : Number(offer.deliveryDistanceKm);
  const deliveryPricing = offer.deliveryPricing || {};
  const deliveryFee = deliveryDistanceKm === null
    ? 0
    : Math.round((
        Math.max(0, Number(deliveryPricing.baseFee) || 0)
        + deliveryDistanceKm * Math.max(0, Number(deliveryPricing.ratePerKm) || 0)
        + quantity * Math.max(0, Number(deliveryPricing.ratePerKg) || 0)
      ) * 100) / 100;
  const deliveryLocationMissing = offer.deliveryFeeRequiresLocation === true || deliveryDistanceKm === null;
  const configuredTaxRate = Math.max(0, Number(offer.taxRate ?? offer.taxPercent ?? rfq.taxRate ?? rfq.taxPercent) || 0);
  const taxAmount = Math.round(productSubtotal * configuredTaxRate / 100 * 100) / 100;
  const otherCharges = Math.max(0, Number(offer.otherCharges ?? rfq.otherCharges) || 0);
  const totalPayable = Math.round((productSubtotal + deliveryFee + taxAmount + otherCharges) * 100) / 100;
  const money = (amount: number) => amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
              <Input type="number" min="1" max={maxAcceptable} value={qty} onChange={(e) => setQty(e.target.value)} />
              <p className="text-xs text-slate-500">You can accept up to {maxAcceptable} kg from this farmer and up to the RFQ's remaining quantity.</p>
              {Number(qty) > maxAcceptable ? <p className="text-xs text-red-600">Quantity cannot exceed this farmer's offer or the remaining RFQ quantity.</p> : null}
            </div>
            <div className="space-y-2 rounded-lg border border-emerald-100 bg-emerald-50/50 p-3">
              <p className="text-sm font-semibold text-slate-900">Order cost breakdown</p>
              <div className="flex justify-between gap-3 text-sm"><span className="text-slate-600">Product subtotal ({quantity} kg × ₹{money(unitPrice)}/kg)</span><span className="font-medium">₹{money(productSubtotal)}</span></div>
              <div className="flex justify-between gap-3 text-sm"><span className="text-slate-600">Delivery fee{deliveryDistanceKm !== null ? ` (${deliveryDistanceKm.toFixed(1)} km; ₹${money(Number(deliveryPricing.ratePerKm) || 0)}/km + weight)` : " (distance unavailable)"}</span><span className="font-medium">{deliveryLocationMissing ? "Needs location" : `₹${money(deliveryFee)}`}</span></div>
              <div className="flex justify-between gap-3 text-sm"><span className="text-slate-600">Tax{configuredTaxRate ? ` (${configuredTaxRate}% configured)` : " (no tax rate configured)"}</span><span className="font-medium">₹{money(taxAmount)}</span></div>
              <div className="flex justify-between gap-3 text-sm"><span className="text-slate-600">Other applicable charges</span><span className="font-medium">₹{money(otherCharges)}</span></div>
              <div className="flex justify-between gap-3 border-t border-emerald-200 pt-2 text-base font-bold"><span>Total payable</span><span>₹{money(totalPayable)}</span></div>
              <p className="text-xs text-slate-500">Delivery uses AgriConnect base fee + distance rate + weight rate. The server recalculates the authoritative total. Tax and other charges are only included when configured.</p>
              {deliveryLocationMissing ? <p className="text-xs font-medium text-red-600">Automatic delivery pricing needs valid farm and delivery-address coordinates. Add the missing location data before accepting this quote.</p> : null}
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
                disabled={!qty || Number(qty) <= 0 || Number(qty) > maxAcceptable || deliveryLocationMissing || accept.isPending}
                onClick={() =>
                  accept.mutate({
                    quantityKg: Number(qty),
                    deliveryMethod: "dedicated_transport",
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
