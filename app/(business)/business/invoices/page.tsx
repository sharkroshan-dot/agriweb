"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Receipt, Loader2, FileText, Download, Eye } from "lucide-react";
import { api } from "../../../lib/api/client";
import { formatPrice } from "../../../lib/utils";
import { Card, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";

function downloadInvoice(inv: any) {
  (async () => {
    try {
      const res = await fetch(`/api/invoice-pdf/${inv.orderId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = `${inv.invoiceNumber || "invoice"}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
    } catch (err: any) {
      alert(`Could not download invoice. ${err?.message || "Please try again."}`);
    }
  })();
}

function InvoiceModal({ invoice, onClose }: { invoice: any; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <CardContent className="p-0" onClick={(e) => e.stopPropagation()}>
          <div className="p-5">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <p className="text-lg font-bold">B2B INVOICE</p>
                <p className="text-xs text-gray-500">{invoice.invoiceNumber} · Order {invoice.orderNumber}</p>
              </div>
              <FileText className="h-8 w-8 text-emerald-600" />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs font-medium text-gray-400">Supplier</p>
                <p className="font-medium">{invoice.farmName || "—"}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium text-gray-400">Status</p>
                <Badge variant={invoice.paymentStatus === "paid" ? "success" : "warning"} className="capitalize">
                  {invoice.paymentStatus}
                </Badge>
              </div>
            </div>

            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-gray-400">
                  <th className="pb-2">Product</th>
                  <th className="pb-2">Qty</th>
                  <th className="pb-2">Rate</th>
                  <th className="pb-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-dashed">
                  <td className="py-2">{invoice.productName}</td>
                  <td className="py-2">{invoice.quantityKg} kg</td>
                  <td className="py-2">₹{Math.round((invoice.subtotal / invoice.quantityKg) * 100) / 100}/kg</td>
                  <td className="py-2 text-right">₹{invoice.subtotal}</td>
                </tr>
              </tbody>
            </table>

            <div className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>₹{invoice.subtotal}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Delivery</span><span>₹{invoice.deliveryCharge}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Taxes</span><span>₹0</span></div>
              <div className="flex justify-between border-t pt-2 text-base font-bold"><span>Total</span><span>₹{invoice.total}</span></div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-2 text-xs text-gray-500">
              <span className="capitalize">Payment: {invoice.paymentMode} · {invoice.paymentStatus}</span>
              <div className="flex items-center gap-2">
                <span>Issued {invoice.issuedAt ? new Date(invoice.issuedAt).toLocaleString() : "—"}</span>
                <Button variant="outline" size="sm" onClick={() => downloadInvoice(invoice)}>
                  <Download className="mr-1 h-3.5 w-3.5" /> Download
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function InvoicesPage() {
  const [open, setOpen] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["b2b", "invoices"],
    queryFn: () => api.get("/b2b/invoices"),
  });

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  const invoices = data?.data?.invoices ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Receipt className="h-6 w-6 text-emerald-600" />
        <h1 className="text-2xl font-bold">Invoices</h1>
      </div>

      {invoices.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <Receipt className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm text-gray-500">No invoices yet.</p>
            <p className="text-sm text-gray-400">Completed B2B orders generate invoices automatically.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {invoices.map((inv: any) => (
            <Card key={inv.orderId}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{inv.invoiceNumber}</p>
                    <Badge variant={inv.paymentStatus === "paid" ? "success" : "warning"} className="capitalize">
                      {inv.paymentStatus}
                    </Badge>
                    <Badge variant="outline">{inv.orderNumber}</Badge>
                  </div>
                  <p className="text-sm text-gray-500">
                    {inv.productName} · {inv.quantityKg} kg · {inv.farmName || "Farm"}
                  </p>
                  <p className="text-xs text-gray-400">
                    {inv.issuedAt ? `issued ${new Date(inv.issuedAt).toLocaleDateString()}` : ""}
                    {inv.paymentMode ? ` · ${inv.paymentMode}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-lg font-bold text-emerald-600">{formatPrice(inv.total)}</p>
                  <Button variant="outline" size="sm" onClick={() => downloadInvoice(inv)}>
                    <Download className="mr-1.5 h-4 w-4" /> Download
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setOpen(inv)}>
                    <Eye className="mr-1.5 h-4 w-4" /> View
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {open && <InvoiceModal invoice={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
