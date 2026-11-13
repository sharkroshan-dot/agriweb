"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Download, Eye, MapPin, Package, Search, Truck, Wallet, X } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent } from "../../../components/ui/card";
import { api } from "../../../lib/api/client";
import { formatPrice } from "../../../lib/utils";

const formatAddress = (addr: any) => {
  if (!addr) return "Address not available";
  if (typeof addr === "string") return addr;
  return [
    addr.addressLine1 || addr.address_line1,
    addr.addressLine2 || addr.address_line2,
    addr.area,
    addr.city,
    addr.district,
    addr.state,
    addr.zipCode || addr.zip_code || addr.postalCode || addr.pincode,
  ].filter(Boolean).join(", ") || addr.address || "Address not available";
};

const formatDate = (value: any) => {
  if (!value) return "Date not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

const orderRef = (item: any) => item.orderNumber || item.orderId || item.id || item._id || "Order reference unavailable";
const deliveryDate = (item: any) => item.deliveredAt || item.completedAt || item.updatedAt || item.createdAt;
const money = (value: any) => value == null || value === "" ? "—" : formatPrice(Number(value) || 0);

export default function DeliveryHistoryPage() {
  const [selectedTrip, setSelectedTrip] = useState<any | null>(null);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken as string | undefined;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["deliveryHistory", page],
    queryFn: () => api.get("/delivery/me/history", { params: { page, limit: pageSize } }),
    enabled: Boolean(accessToken),
  });
  const { data: dashboardData } = useQuery({
    queryKey: ["deliveryHistoryDashboard"],
    queryFn: () => api.get("/delivery/me/dashboard"),
    enabled: Boolean(accessToken),
    retry: 1,
  });

  const history = data?.data?.deliveries || [];
  const dashboard = dashboardData?.data || {};
  const filteredHistory = useMemo(() => history.filter((item: any) => {
    const q = search.trim().toLowerCase();
    const searchable = [orderRef(item), item.customerName, formatAddress(item.deliveryAddress)].join(" ").toLowerCase();
    if (q && !searchable.includes(q)) return false;
    const rawDate = deliveryDate(item);
    if (dateFrom && rawDate && new Date(rawDate) < new Date(dateFrom)) return false;
    if (dateTo && rawDate) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      if (new Date(rawDate) > end) return false;
    }
    return true;
  }), [history, search, dateFrom, dateTo]);

  const totalEarnings = history.reduce((sum: number, item: any) => sum + Number(item.deliveryFee ?? item.partnerEarnings ?? item.earnings ?? 0), 0);
  const thisMonthCount = history.filter((item: any) => {
    const value = deliveryDate(item);
    if (!value) return false;
    const d = new Date(value);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const hasNextPage = history.length === pageSize;

  const exportCsv = () => {
    const columns = ["Order ID", "Customer", "Delivery date", "Address", "Order value", "Delivery earnings", "Status"];
    const rows = filteredHistory.map((item: any) => [
      orderRef(item), item.customerName || "", formatDate(deliveryDate(item)),
      formatAddress(item.deliveryAddress), item.totalAmount ?? "",
      item.deliveryFee ?? item.partnerEarnings ?? item.earnings ?? "", "Delivered",
    ]);
    const csv = [columns, ...rows].map((row) => row.map((value) => '"' + String(value ?? "").replace(/"/g, '""') + '"').join(",")).join("\\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "agriconnect-delivery-history.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5 pb-6">
      <header className="relative isolate flex min-h-[132px] items-center overflow-hidden rounded-2xl border border-emerald-200/80 bg-gradient-to-r from-[#f2fbe9] via-[#f4fbe9] to-[#dff5c9] px-5 py-5 shadow-sm sm:px-7 lg:min-h-[144px]">
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-[48%] overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-[#f2fbe9] via-[#eaf8d8]/70 to-transparent" />
          <div className="absolute -bottom-16 right-[-3%] h-36 w-[78%] rounded-[50%] bg-gradient-to-b from-[#c9eaa5] to-[#9ed47b] opacity-75" />
          <div className="absolute -bottom-20 right-[8%] h-32 w-[62%] rotate-[-7deg] rounded-[50%] border-t-[14px] border-white/80" />
          <div className="absolute bottom-0 right-0 h-20 w-32 rounded-tl-[100%] bg-gradient-to-br from-emerald-300/40 to-green-600/30" />
          <div className="absolute bottom-2 right-[5%] rounded-full bg-white/70 p-3 text-emerald-700 shadow-sm"><Truck className="h-12 w-12 sm:h-14 sm:w-14" /></div>
        </div>
        <div className="relative z-10 flex min-w-0 items-center gap-4 sm:gap-6">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md sm:h-[76px] sm:w-[76px]"><Truck className="h-9 w-9 sm:h-11 sm:w-11" /></div>
          <div className="h-14 w-px shrink-0 bg-emerald-700/60 sm:h-16" />
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-800 sm:text-xs">Delivery operations</p>
            <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl lg:text-[28px]">Delivery History</h1>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-700 sm:text-sm">View and manage your completed deliveries, earnings, and delivery proof records.</p>
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardContent className="flex items-center gap-3 p-4"><div className="rounded-full bg-emerald-100 p-3 text-emerald-700"><Package className="h-5 w-5"/></div><div><p className="text-xs text-muted-foreground">Total delivered</p><p className="text-2xl font-bold">{dashboard.totalDeliveries ?? data?.data?.count ?? history.length}</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><div className="rounded-full bg-green-100 p-3 text-green-700"><Wallet className="h-5 w-5"/></div><div><p className="text-xs text-muted-foreground">Earnings on this page</p><p className="text-2xl font-bold">{money(totalEarnings)}</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><div className="rounded-full bg-blue-100 p-3 text-blue-700"><CalendarDays className="h-5 w-5"/></div><div><p className="text-xs text-muted-foreground">This month (loaded records)</p><p className="text-2xl font-bold">{thisMonthCount}</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><div className="rounded-full bg-amber-100 p-3 text-amber-700"><Clock3 className="h-5 w-5"/></div><div><p className="text-xs text-muted-foreground">On-time delivery</p><p className="text-2xl font-bold">{dashboard.onTimeRate != null ? `${dashboard.onTimeRate}%` : "—"}</p></div></CardContent></Card>
      </section>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-slate-50/70 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-emerald-700 text-white hover:bg-emerald-700">All Deliveries</Badge>
            <Badge variant="outline" className="gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-600"/>Delivered</Badge>
            <span className="text-xs text-muted-foreground">This history endpoint currently returns completed deliveries.</span>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filteredHistory.length}><Download className="mr-2 h-4 w-4"/>Export CSV</Button>
        </div>
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-3 md:grid-cols-[minmax(220px,1.5fr)_1fr_1fr_auto]">
            <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search order ID, customer or location..." className="h-10 w-full rounded-lg border bg-white pl-9 pr-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"/></div>
            <label className="flex h-10 items-center gap-2 rounded-lg border bg-white px-3 text-xs text-muted-foreground"><span>From</span><input aria-label="From date" type="date" value={dateFrom} onChange={(e)=>setDateFrom(e.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"/></label>
            <label className="flex h-10 items-center gap-2 rounded-lg border bg-white px-3 text-xs text-muted-foreground"><span>To</span><input aria-label="To date" type="date" value={dateTo} onChange={(e)=>setDateTo(e.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"/></label>
            <Button variant="outline" size="sm" onClick={()=>{setSearch("");setDateFrom("");setDateTo("");}}><X className="mr-1 h-4 w-4"/>Clear</Button>
          </div>

          {isLoading ? <div className="space-y-3">{[1,2,3,4].map((i)=><div key={i} className="h-14 animate-pulse rounded-lg bg-muted"/>)}</div>
          : isError ? <div className="py-10 text-center"><p className="font-medium">Unable to load delivery history</p><Button className="mt-3" variant="outline" onClick={()=>void refetch()}>Try again</Button></div>
          : filteredHistory.length === 0 ? <div className="py-12 text-center"><Package className="mx-auto mb-3 h-9 w-9 text-muted-foreground"/><p className="font-semibold">No matching delivery records</p><p className="mt-1 text-sm text-muted-foreground">Try changing your search or date filters.</p></div>
          : <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600"><tr>{["Order ID","Customer","Delivery date & time","Location","Order value","Status","Actions"].map((heading)=><th key={heading} className="whitespace-nowrap px-4 py-3 font-semibold">{heading}</th>)}</tr></thead>
                <tbody className="divide-y">
                  {filteredHistory.map((item:any,index:number)=><tr key={item.id || item._id || item.orderId || index} className={selectedTrip===item?"bg-emerald-50/70 hover:bg-emerald-50":"hover:bg-slate-50/80"}>
                    <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-800">{orderRef(item)}</td>
                    <td className="whitespace-nowrap px-4 py-3">{item.customerName || "Customer"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(deliveryDate(item))}</td>
                    <td className="max-w-[210px] px-4 py-3"><span className="flex items-start gap-1.5"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-500"/><span className="line-clamp-2">{formatAddress(item.deliveryAddress)}</span></span></td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium">{money(item.totalAmount)}</td>
                    <td className="px-4 py-3"><Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100"><CheckCircle2 className="mr-1 h-3 w-3"/>Delivered</Badge></td>
                    <td className="px-4 py-3"><Button size="sm" variant="outline" onClick={()=>setSelectedTrip(item)}><Eye className="mr-1 h-4 w-4"/>View</Button></td>
                  </tr>)}
                </tbody>
              </table>
            </div>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
            <span>Page {page} · {filteredHistory.length} records shown</span>
            <div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={page===1} onClick={()=>setPage((p)=>Math.max(1,p-1))}><ChevronLeft className="h-4 w-4"/>Previous</Button><Button size="sm" variant="outline" disabled={!hasNextPage} onClick={()=>setPage((p)=>p+1)}>Next<ChevronRight className="h-4 w-4"/></Button></div>
          </div>
        </CardContent>
      </Card>

      {selectedTrip && <Card className="overflow-hidden border-emerald-200 shadow-sm">
        <div className="flex items-center justify-between border-b bg-emerald-50/60 px-5 py-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Delivery details</p><h2 className="mt-1 text-lg font-bold">{orderRef(selectedTrip)}</h2></div><div className="flex items-center gap-2"><Badge className="bg-emerald-100 text-emerald-800">Delivered</Badge><Button size="icon" variant="ghost" onClick={()=>setSelectedTrip(null)} aria-label="Close details"><X className="h-4 w-4"/></Button></div></div>
        <CardContent className="grid gap-5 p-5 lg:grid-cols-2">
          <div className="space-y-3"><h3 className="font-semibold">Customer information</h3><div className="rounded-xl border p-4 text-sm"><p className="font-medium">{selectedTrip.customerName || "Customer name unavailable"}</p><p className="mt-2 text-muted-foreground">{selectedTrip.customerPhone || "Phone number not available"}</p><p className="mt-2 flex gap-2 text-muted-foreground"><MapPin className="h-4 w-4 shrink-0"/>{formatAddress(selectedTrip.deliveryAddress)}</p></div><h3 className="font-semibold">Order information</h3><div className="rounded-xl border p-4 text-sm"><div className="flex justify-between gap-3"><span className="text-muted-foreground">Order value</span><strong>{money(selectedTrip.totalAmount)}</strong></div><div className="mt-2 flex justify-between gap-3"><span className="text-muted-foreground">Payment method</span><strong>{selectedTrip.paymentMethod || selectedTrip.paymentStatus || "Not recorded"}</strong></div><div className="mt-2 flex justify-between gap-3"><span className="text-muted-foreground">Delivery earnings</span><strong className="text-emerald-700">{money(selectedTrip.deliveryFee ?? selectedTrip.partnerEarnings ?? selectedTrip.earnings)}</strong></div><div className="mt-2 flex justify-between gap-3"><span className="text-muted-foreground">Completed at</span><strong className="text-right">{formatDate(deliveryDate(selectedTrip))}</strong></div></div></div>
          <div className="space-y-3"><h3 className="font-semibold">Delivered items ({selectedTrip.items?.length || 0})</h3><div className="rounded-xl border p-4">{selectedTrip.items?.length ? selectedTrip.items.map((item:any,index:number)=><div key={item.id || item.productId || index} className="flex justify-between gap-3 border-b py-2 last:border-0"><span>{item.productName || item.name || "Product"}</span><span className="font-medium">{item.quantity ?? "—"} {item.unit || ""}</span></div>) : <p className="text-sm text-muted-foreground">Item details are not available for this record.</p>}</div><h3 className="font-semibold">Delivery verification</h3><div className="rounded-xl border p-4 text-sm"><div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-4 w-4"/>Delivery marked completed</div><p className="mt-2 text-muted-foreground">OTP, QR, signature, GPS and proof-of-delivery details will appear here when they are included in the history record.</p></div></div>
        </CardContent>
      </Card>}
    </div>
  );
}
