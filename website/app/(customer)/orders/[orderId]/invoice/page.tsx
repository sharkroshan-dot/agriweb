"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Receipt, Loader2, MapPin, Store, Truck, CreditCard } from "lucide-react";
import { api } from "../../../../lib/api/client";
import { formatPrice, formatDate } from "../../../../lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";

export default function OrderInvoicePage() {
  const params = useParams();
  const orderId = params.orderId as string;

  const { data: invoiceData, isLoading, isError } = useQuery({
    queryKey: ["invoice", orderId],
    queryFn: () => api.get(`/impact/orders/${orderId}/invoice`),
  });

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (isError || !invoiceData?.data) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <Receipt className="h-10 w-10 text-gray-300" />
        <p className="mt-3 font-medium text-gray-600">Invoice not available</p>
        <p className="text-sm text-gray-400">You may not have access to this order.</p>
        <Link href={`/orders/${orderId}`} className="mt-4">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Order
          </Button>
        </Link>
      </div>
    );
  }

  const inv = invoiceData.data;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <Link href={`/orders/${orderId}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Order
          </Button>
        </Link>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.print()}
        >
          <Receipt className="mr-2 h-4 w-4" /> Print / Save PDF
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Receipt className="h-5 w-5 text-emerald-600" /> {inv.invoiceId}
              </CardTitle>
              <p className="text-sm text-gray-500">Order #{inv.orderNumber} • {formatDate(inv.orderDate)}</p>
            </div>
            <div className="text-right">
              <Badge variant="outline">{inv.orderStatus.replace(/_/g, " ")}</Badge>
              <p className="mt-1 text-sm text-gray-500">
                Payment: <span className="font-medium">{inv.paymentStatus}</span>
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-4">
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                <Store className="h-4 w-4" /> Farmer
              </p>
              <p className="mt-1 font-medium">{inv.farmer?.name}</p>
              <p className="text-sm text-gray-500">{inv.farmer?.farmName || "AgriConnect Farm"}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                <Truck className="h-4 w-4" /> Customer
              </p>
              <p className="mt-1 font-medium">{inv.customer?.name}</p>
              <p className="text-sm text-gray-500">
                {inv.deliveryAddress?.address || inv.deliveryAddress?.addressLine1 || "Pickup at farm"}
                {inv.deliveryAddress?.city ? `, ${inv.deliveryAddress.city}` : ""}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Unit</th>
                  <th className="px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {inv.items.map((item: any, idx: number) => (
                  <tr key={idx} className="border-t">
                    <td className="px-4 py-3 font-medium">{item.productName}</td>
                    <td className="px-4 py-3 text-right">{item.quantity}</td>
                    <td className="px-4 py-3 text-right">{formatPrice(item.unitPrice)}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatPrice(item.totalPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{formatPrice(inv.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Delivery charge</span><span>{formatPrice(inv.deliveryCharge)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Platform fee</span><span>{formatPrice(inv.platformFee)}</span></div>
            {inv.discount > 0 && (
              <div className="flex justify-between text-emerald-600"><span>Discount</span><span>-{formatPrice(inv.discount)}</span></div>
            )}
            <div className="mt-2 flex justify-between border-t pt-2 text-base font-bold">
              <span>Total</span>
              <span>{formatPrice(inv.totalAmount)}</span>
            </div>
          </div>

          {inv.payments?.length > 0 && (
            <div className="rounded-lg border p-4">
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                <CreditCard className="h-4 w-4" /> Payments
              </p>
              <div className="mt-2 space-y-1 text-sm">
                {inv.payments.map((p: any) => (
                  <div key={p.id} className="flex justify-between">
                    <span>
                      {p.type === "refund" ? "Refund" : "Payment"} • {p.method || p.status}
                      {p.transactionId ? ` (${p.transactionId})` : ""}
                    </span>
                    <span className={p.type === "refund" ? "text-emerald-600" : ""}>
                      {p.type === "refund" ? "-" : ""}{formatPrice(p.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {inv.pickupDate && (
            <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-gray-600">
              <MapPin className="h-4 w-4 text-emerald-600" />
              <span>Farm pickup on {formatDate(inv.pickupDate)}{inv.pickupTimeSlot ? ` • ${inv.pickupTimeSlot}` : ""}</span>
              {inv.pickupCode ? <Badge variant="outline">Code: {inv.pickupCode}</Badge> : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}