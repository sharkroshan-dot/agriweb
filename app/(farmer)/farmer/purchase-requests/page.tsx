"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Send, MapPin, CalendarDays, CheckCircle, ClipboardList } from "lucide-react";
import { api } from "../../../lib/api/client";
import { Card, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import toast from "react-hot-toast";

function BulkOfferForm({ request, onDone }: { request: any; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Record<string, { qty: string; price: string }>>(() => {
    const init: Record<string, { qty: string; price: string }> = {};
    for (const item of request.items || []) {
      const matched = (request.matchInfo?.matchedItems || []).find((m: any) => m.name === item.name);
      init[item.name] = {
        qty: matched ? String(Math.min(matched.availableKg, item.quantityKg)) : "",
        price: matched?.pricePerKg ? String(matched.pricePerKg) : "",
      };
    }
    return init;
  });
  const [deliveryAvailable, setDeliveryAvailable] = useState(true);
  const [note, setNote] = useState("");

  const submit = useMutation({
    mutationFn: (payload: any) => api.post(`/bulk-orders/requests/${request.id}/offers`, payload),
    onSuccess: () => {
      toast.success("Offer submitted!");
      onDone();
      queryClient.invalidateQueries({ queryKey: ["farmer", "bulk-orders"] });
    },
    onError: (err: any) => toast.error(err?.message || "Failed to submit offer"),
  });

  const allFilled = (request.items || []).every((item: any) => {
    const r = rows[item.name];
    return r && Number(r.qty) > 0 && Number(r.price) > 0;
  });

  return (
    <Card className="border-emerald-200">
      <CardContent className="space-y-3 p-4">
        <p className="text-sm font-semibold">Submit offer for {request.requestNumber}</p>
        {(request.items || []).map((item: any) => {
          const matched = (request.matchInfo?.matchedItems || []).find((m: any) => m.name === item.name);
          const row = rows[item.name] || { qty: "", price: "" };
          return (
            <div key={item.name} className="rounded-lg border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">{item.name}</span>
                <span className="text-xs text-gray-500">
                  Need {item.quantityKg} kg{matched ? ` • I have ${matched.availableKg} kg` : ""}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs text-gray-400">Quantity (kg)</label>
                  <Input
                    type="number"
                    min="1"
                    value={row.qty}
                    onChange={(e) => setRows({ ...rows, [item.name]: { ...row, qty: e.target.value } })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400">Price (₹/kg)</label>
                  <Input
                    type="number"
                    min="1"
                    value={row.price}
                    onChange={(e) => setRows({ ...rows, [item.name]: { ...row, price: e.target.value } })}
                  />
                </div>
              </div>
            </div>
          );
        })}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={deliveryAvailable} onChange={(e) => setDeliveryAvailable(e.target.checked)} className="h-4 w-4" />
          I can deliver to this location
        </label>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Delivery note (optional)" />
        <Button
          className="w-full"
          disabled={!allFilled || submit.isPending}
          onClick={() =>
            submit.mutate({
              items: (request.items || []).map((item: any) => ({
                name: item.name,
                quantityKg: Number(rows[item.name].qty),
                pricePerKg: Number(rows[item.name].price),
              })),
              deliveryAvailable,
              deliveryNote: note,
            })
          }
        >
          {submit.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          Submit Offer
        </Button>
      </CardContent>
    </Card>
  );
}

export default function FarmerBulkOrdersPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"not_submitted" | "submitted">("not_submitted");
  const [openFor, setOpenFor] = useState<string | null>(null);

  const { data: bulkData, isLoading: bulkLoading } = useQuery({
    queryKey: ["farmer", "bulk-orders"],
    queryFn: () => api.get("/bulk-orders/requests", { params: { scope: "open" } }),
  });

  if (bulkLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  const bulkRequests = (bulkData?.data?.requests || []).filter((r: any) => r.matchInfo?.canSupply !== false);

  const items: any[] = bulkRequests.map((r: any) => ({
    kind: "bulk",
    id: r.id,
    source: r.buyerType,
    sourceLabel: "👤 Customer Event",
    requestNumber: r.requestNumber,
    title: r.purpose,
    subtitle: (r.items || []).map((i: any) => `${i.name} ${i.quantityKg} kg`).join(" • "),
    city: r.deliveryCity || r.deliveryAddress?.city,
    date: r.requestedDeliveryDate,
    time: r.requestedDeliveryTime,
    distanceKm: r.matchInfo?.distanceKm,
    matchedCount: r.matchInfo?.matchedItemCount,
    matchedTotal: (r.matchInfo?.matchedItems || []).length,
    myOfferStatus: r.myOfferStatus,
    request: r,
  }));

  const submitted = items.filter((i) => i.myOfferStatus);
  const notSubmitted = items.filter((i) => !i.myOfferStatus);
  const sectionClass = "rounded-3xl border bg-white p-6";
  const headingClass = "flex items-center gap-3 text-xl font-bold text-slate-900";
  const countClass = "text-sm text-slate-500";

  const renderItem = (item: any) => (
    <div key={`${item.kind}-${item.id}`} className="space-y-2">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="success">{item.sourceLabel}</Badge>
              <p className="font-medium capitalize">{item.title}</p>
            </div>
            <p className="mt-1 truncate text-sm text-gray-600">{item.subtitle}</p>
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-gray-500">
              {item.date ? (
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" /> {item.date}
                  {item.time ? `, ${item.time}` : ""}
                </span>
              ) : null}
              {item.city ? (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" /> {item.city}
                </span>
              ) : null}
              {item.distanceKm != null ? <span>{item.distanceKm} km away</span> : null}
              {item.matchedCount != null ? (
                <span>You can supply {item.matchedCount}/{item.matchedTotal} items</span>
              ) : null}
              {item.myOfferStatus ? <span>Your offer: {item.myOfferStatus}</span> : null}
            </div>
          </div>
          <Button variant={openFor === item.id ? "outline" : "default"} onClick={() => setOpenFor(openFor === item.id ? null : item.id)}>
            {item.myOfferStatus === "pending" ? (
              <span className="flex items-center gap-1">
                <CheckCircle className="h-4 w-4" /> Offered
              </span>
            ) : openFor === item.id ? (
              "Close"
            ) : (
              "Submit Offer"
            )}
          </Button>
        </CardContent>
      </Card>
      {openFor === item.id && <BulkOfferForm request={item.request} onDone={() => setOpenFor(null)} />}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <FileText className="h-6 w-6 text-emerald-600" />
        <h1 className="text-2xl font-bold">Bulk RFQ</h1>
      </div>
      <p className="text-sm text-gray-500">
        Customer event orders in one inbox. Submit offers for requests that fit your farm.
      </p>

      {/* Tabs like harvested / pre-harvest */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
        <button
          onClick={() => setTab("not_submitted")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition ${
            tab === "not_submitted"
              ? "bg-white text-emerald-700 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <ClipboardList className="h-4 w-4" />
          Not Submitted
          {notSubmitted.length > 0 && (
            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">
              {notSubmitted.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("submitted")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition ${
            tab === "submitted"
              ? "bg-white text-emerald-700 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <Send className="h-4 w-4" />
          Submitted
          {submitted.length > 0 && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
              {submitted.length}
            </span>
          )}
        </button>
      </div>

      {/* Not Submitted section */}
      {tab === "not_submitted" && (
        <section className={sectionClass}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className={headingClass}>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-100">
                <ClipboardList className="h-5 w-5 text-purple-600" />
              </span>
              Not Submitted
            </h2>
            <p className={countClass}>Requests you haven't offered on yet</p>
          </div>

          {notSubmitted.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed py-12 text-center">
              <ClipboardList className="h-9 w-9 text-gray-300" />
              <p className="mt-3 font-medium text-gray-600">No pending requests</p>
              <p className="text-sm text-gray-400">Open bulk requests you can supply will show up here.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {notSubmitted.map(renderItem)}
            </div>
          )}
        </section>
      )}

      {/* Submitted section */}
      {tab === "submitted" && (
        <section className={sectionClass}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className={headingClass}>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100">
                <Send className="h-5 w-5 text-emerald-600" />
              </span>
              Submitted
            </h2>
            <p className={countClass}>Requests you've submitted offers for</p>
          </div>

          {submitted.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed py-12 text-center">
              <Send className="h-9 w-9 text-gray-300" />
              <p className="mt-3 font-medium text-gray-600">No submitted offers yet</p>
              <p className="text-sm text-gray-400">Submit an offer on a request and it will appear here.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {submitted.map(renderItem)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}