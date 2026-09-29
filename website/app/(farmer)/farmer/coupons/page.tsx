"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Loader2, Plus, Tag, Trash2, Pencil, Users, BadgePercent } from "lucide-react";
import { api } from "../../../lib/api/client";
import { formatDate } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import toast from "react-hot-toast";

type Product = { id: string; name: string; price: number; unit: string };
type Offer = { id: string; productId: string; name: string; discountType: string; discountValue: number; minQuantity: number; minOrderValue: number; startAt: string; endAt: string; eligibility: string; status: string };
type Coupon = { id: string; code: string; description: string; discountType: string; discountValue: number; minOrderValue: number; maxDiscount?: number; expiresAt?: string; eligibility: string; status: string };

const statusOf = (start: string, end: string) => {
  const now = Date.now();
  if (new Date(end).getTime() < now) return "expired";
  if (new Date(start).getTime() > now) return "scheduled";
  return "active";
};

export default function FarmerCouponsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"offers" | "coupons">("offers");
  const [formOpen, setFormOpen] = useState(false);
  const [editingOffer, setEditingOffer] = useState<Offer | null>(null);
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);\n  const [offerFilter, setOfferFilter] = useState("active");\n  const [couponFilter, setCouponFilter] = useState("active");

  const { data, isLoading } = useQuery({
    queryKey: ["farmerOffersCoupons"],
    queryFn: () => api.get("/farmer-offers/mine"),
    retry: 1,
  });
  const { data: productData } = useQuery({
    queryKey: ["farmerOfferProducts"],
    queryFn: () => api.get("/farmer-offers/products"),
  });

  const offers: Offer[] = data?.data?.offers || [];
  const coupons: Coupon[] = data?.data?.coupons || [];
  const products: Product[] = productData?.data?.products || [];

  const removeOffer = useMutation({
    mutationFn: (id: string) => api.delete(`/farmer-offers/offers/${id}`),
    onSuccess: () => { toast.success("Offer deleted"); qc.invalidateQueries({ queryKey: ["farmerOffersCoupons"] }); },
  });
  const removeCoupon = useMutation({
    mutationFn: (id: string) => api.delete(`/farmer-offers/coupons/${id}`),
    onSuccess: () => { toast.success("Coupon deleted"); qc.invalidateQueries({ queryKey: ["farmerOffersCoupons"] }); },
  });

  const filteredOffers = useMemo(() => offers.map(o => ({ ...o, viewStatus: statusOf(o.startAt, o.endAt) })).filter(o => o.viewStatus === "active"), [offers]);
  const scheduledOffers = useMemo(() => offers.map(o => ({ ...o, viewStatus: statusOf(o.startAt, o.endAt) })).filter(o => o.viewStatus === "scheduled"), [offers]);
  const expiredOffers = useMemo(() => offers.map(o => ({ ...o, viewStatus: statusOf(o.startAt, o.endAt) })).filter(o => o.viewStatus === "expired"), [offers]);
  const scheduledCoupons = coupons.filter(c => c.expiresAt && new Date(c.expiresAt).getTime() > Date.now() && c.status === "scheduled");
  const activeCoupons = coupons.filter(c => (!c.expiresAt || new Date(c.expiresAt).getTime() >= Date.now()) && c.status === "active");
  const expiredCoupons = coupons.filter(c => c.expiresAt && new Date(c.expiresAt).getTime() < Date.now());
  const offerGroups: Record<string, Offer[]> = { active: filteredOffers, scheduled: scheduledOffers, expired: expiredOffers };
  const couponGroups: Record<string, Coupon[]> = { active: activeCoupons, scheduled: scheduledCoupons, expired: expiredCoupons };
  const visibleOffers = offerGroups[offerFilter] || [];
  const visibleCoupons = couponGroups[couponFilter] || [];
  const sectionClass = "rounded-3xl border bg-white p-6";
  const headingClass = "flex items-center gap-3 text-xl font-bold text-slate-900";

  return <div className="space-y-6">
    <div className="flex items-center gap-2">
      <BadgePercent className="h-6 w-6 text-emerald-600" />
      <h1 className="text-2xl font-bold">Offers &amp; Coupons</h1>
    </div>
    <p className="text-sm text-gray-500">Create product offers and farmer-owned coupons for your customers.</p>

    <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
      <button onClick={() => setTab("offers")} className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition ${tab === "offers" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-600 hover:bg-white/70 hover:text-emerald-700"}`}>
        <Tag className="h-4 w-4" /> My Offers <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tab === "offers" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{offers.length}</span>
      </button>
      <button onClick={() => setTab("coupons")} className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition ${tab === "coupons" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-600 hover:bg-white/70 hover:text-emerald-700"}`}>
        <BadgePercent className="h-4 w-4" /> My Coupons <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tab === "coupons" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{coupons.length}</span>
      </button>
      <Button className="ml-2" onClick={() => { setEditingOffer(null); setEditingCoupon(null); setFormOpen(true); }}><Plus className="mr-2 h-4 w-4" /> Create Offer</Button>
    </div>

    {isLoading ? <div className="flex h-40 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div> :
      tab === "offers" ? <section className={sectionClass}>
        <div className="mb-4 flex items-center justify-between"><h2 className={headingClass}><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100"><Tag className="h-5 w-5 text-emerald-600" /></span>My Offers</h2><p className="text-sm text-slate-500">Product discounts for your customers</p></div>
        <StatusTabs value={offerFilter} setValue={setOfferFilter} counts={{active:filteredOffers.length,scheduled:scheduledOffers.length,expired:expiredOffers.length}} />
        <OfferList title={offerFilter[0].toUpperCase()+offerFilter.slice(1)} rows={visibleOffers} products={products} onEdit={(x:any)=>{setEditingOffer(x);setEditingCoupon(null);setFormOpen(true)}} onDelete={(id:string)=>removeOffer.mutate(id)} />
      </section> :
      <section className={sectionClass}>
        <div className="mb-4 flex items-center justify-between"><h2 className={headingClass}><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100"><BadgePercent className="h-5 w-5 text-emerald-600" /></span>My Coupons</h2><p className="text-sm text-slate-500">Coupons created by you</p></div>
        <StatusTabs value={couponFilter} setValue={setCouponFilter} counts={{active:activeCoupons.length,scheduled:scheduledCoupons.length,expired:expiredCoupons.length}} />
        <CouponList title={couponFilter[0].toUpperCase()+couponFilter.slice(1)} rows={visibleCoupons} onEdit={(x:any)=>{setEditingCoupon(x);setEditingOffer(null);setFormOpen(true)}} onDelete={(id:string)=>removeCoupon.mutate(id)} />
      </section>
    }

    {formOpen && <CreateForm products={products} offer={editingOffer} coupon={editingCoupon} onClose={()=>setFormOpen(false)} onSaved={()=>{setFormOpen(false);qc.invalidateQueries({queryKey:["farmerOffersCoupons"]})}} />}
  </div>;
}

function StatusTabs({value,setValue,counts}:{value:string;setValue:(v:string)=>void;counts:{active:number;scheduled:number;expired:number}}) {
  return <div className="mb-4 flex gap-1 rounded-xl bg-slate-100 p-1">
    {(["active","scheduled","expired"] as const).map((key)=>{const selected=value===key; return <button key={key} onClick={()=>setValue(key)} className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${selected?"bg-emerald-600 text-white shadow-sm":"text-slate-600 hover:bg-white/70 hover:text-emerald-700"}`}>
      {key[0].toUpperCase()+key.slice(1)} <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${selected?"bg-amber-100 text-amber-700":"bg-emerald-100 text-emerald-700"}`}>{counts[key]}</span>
    </button>})}
  </div>
}

function OfferList({title, rows, products, onEdit, onDelete}: any) {
  return <Card><CardHeader><CardTitle className="text-base">{title} Offers ({rows.length})</CardTitle></CardHeader><CardContent className="space-y-3">
    {rows.length === 0 ? <p className="text-sm text-slate-500">No {title.toLowerCase()} offers.</p> : rows.map((o:any) => <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div><p className="font-semibold">{o.name}</p><p className="text-sm text-slate-500">{products.find((p:any)=>p.id===o.productId)?.name || "Product"} · {o.discountType === "percentage" ? `${o.discountValue}% off` : `₹${o.discountValue} off`}</p><p className="text-xs text-slate-400">Min qty {o.minQuantity} · Min order ₹{o.minOrderValue} · {formatDate(o.startAt)} - {formatDate(o.endAt)}</p></div>
      <div className="flex gap-2"><Button variant="outline" size="sm" onClick={()=>onEdit(o)}><Pencil className="mr-1 h-3 w-3"/>Edit</Button><Button variant="outline" size="sm" onClick={()=>onDelete(o.id)}><Trash2 className="mr-1 h-3 w-3"/>Delete</Button></div>
    </div>)}
  </CardContent></Card>
}

function CouponList({title, rows, onEdit, onDelete}: any) {
  return <Card><CardHeader><CardTitle className="text-base">{title} Coupons ({rows.length})</CardTitle></CardHeader><CardContent className="space-y-3">
    {rows.length === 0 ? <p className="text-sm text-slate-500">No {title.toLowerCase()} coupons.</p> : rows.map((c:any)=><div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><p className="font-semibold text-emerald-700">{c.code}</p><p className="text-sm">{c.description || "Farmer coupon"} · {c.discountType==="percentage"?`${c.discountValue}% off`:`₹${c.discountValue} off`}</p><p className="text-xs text-slate-500">Min order ₹{c.minOrderValue} · {c.expiresAt ? `Expires ${formatDate(c.expiresAt)}` : "No expiry"} · {c.eligibility}</p></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={()=>onEdit(c)}><Pencil className="mr-1 h-3 w-3"/>Edit</Button><Button variant="outline" size="sm" onClick={()=>onDelete(c.id)}><Trash2 className="mr-1 h-3 w-3"/>Delete</Button></div></div>)}
  </CardContent></Card>
}

function CreateForm({products, offer, coupon, onClose, onSaved}: any) {
  const isCoupon = !!coupon;
  const [kind,setKind] = useState<"offer"|"coupon">(isCoupon?"coupon":"offer");
  const [form,setForm] = useState<any>(offer || coupon || { productId: products[0]?.id || "", name:"", code:"", description:"", discountType:"percentage", discountValue:10, minQuantity:1, minOrderValue:0, startAt:new Date().toISOString().slice(0,16), endAt:"", expiresAt:"", startAt:"", eligibility:"all" });
  const [saving,setSaving]=useState(false);
  const save=async()=>{try{
    setSaving(true);
    if(kind==="offer"){
      if(!form.productId || !form.name || !form.endAt) throw new Error("Select product, offer name and end date");
      const payload={...form,startAt:new Date(form.startAt).toISOString(),endAt:new Date(form.endAt).toISOString()};
      await api[offer?"put":"post"](offer?`/farmer-offers/offers/${offer.id}`:"/farmer-offers/offers",payload);
    } else {
      if(!form.code) throw new Error("Coupon code is required");
      await api[coupon?"put":"post"](coupon?`/farmer-offers/coupons/${coupon.id}`:"/farmer-offers/coupons",{...form,startAt:form.startAt?new Date(form.startAt).toISOString():null});
    }
    toast.success(kind==="offer"?"Offer saved":"Coupon saved"); onSaved();
  }catch(e:any){toast.error(e?.response?.data?.detail || e?.message || "Unable to save");}finally{setSaving(false)}};
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><Card className="max-h-[90vh] w-full max-w-2xl overflow-auto"><CardHeader><CardTitle>{offer?"Edit Offer":coupon?"Edit Coupon":"Create Offer"}</CardTitle><CardDescription>Create a product offer or farmer coupon.</CardDescription></CardHeader><CardContent className="space-y-4">
    {!offer&&!coupon&&<div className="flex gap-2"><Button variant={kind==="offer"?"default":"outline"} onClick={()=>setKind("offer")}>Offer</Button><Button variant={kind==="coupon"?"default":"outline"} onClick={()=>setKind("coupon")}>Coupon</Button></div>}
    {kind==="offer"?<><select className="w-full rounded-md border p-2" value={form.productId} onChange={e=>setForm({...form,productId:e.target.value})}><option value="">Select Product</option>{products.map((p:any)=><option key={p.id} value={p.id}>{p.name}</option>)}</select><Input placeholder="Offer name" value={form.name||""} onChange={e=>setForm({...form,name:e.target.value})}/></>:<><Input placeholder="Coupon code" value={form.code||""} onChange={e=>setForm({...form,code:e.target.value.toUpperCase()})}/><Input placeholder="Description" value={form.description||""} onChange={e=>setForm({...form,description:e.target.value})}/></>}
    <div className="grid gap-3 sm:grid-cols-2"><select className="rounded-md border p-2" value={form.discountType} onChange={e=>setForm({...form,discountType:e.target.value})}><option value="percentage">Discount %</option><option value="fixed">Fixed ₹</option></select><Input type="number" min="0.01" placeholder="Discount value" value={form.discountValue} onChange={e=>setForm({...form,discountValue:Number(e.target.value)})}/></div>
    <div className="grid gap-3 sm:grid-cols-2"><Input type="number" min="0" placeholder="Minimum Quantity" value={form.minQuantity??0} onChange={e=>setForm({...form,minQuantity:Number(e.target.value)})}/><Input type="number" min="0" placeholder="Minimum Order ₹" value={form.minOrderValue??0} onChange={e=>setForm({...form,minOrderValue:Number(e.target.value)})}/></div>
    {kind==="offer"?<div className="grid gap-3 sm:grid-cols-2"><Input type="datetime-local" value={form.startAt?.slice(0,16)||""} onChange={e=>setForm({...form,startAt:e.target.value})}/><Input type="datetime-local" value={form.endAt?.slice(0,16)||""} onChange={e=>setForm({...form,endAt:e.target.value})}/></div>:<div className="grid gap-3 sm:grid-cols-2"><Input type="datetime-local" value={form.startAt?.slice(0,16)||""} onChange={e=>setForm({...form,startAt:e.target.value})}/><Input type="datetime-local" value={form.expiresAt?.slice(0,16)||""} onChange={e=>setForm({...form,expiresAt:e.target.value ? new Date(e.target.value).toISOString() : null})}/></div>}
    <div><label className="mb-1 block text-sm font-medium">Customer Eligibility</label><select className="w-full rounded-md border p-2" value={form.eligibility||"all"} onChange={e=>setForm({...form,eligibility:e.target.value})}><option value="all">All customers</option><option value="new_customers">New customers</option><option value="repeat_customers">Repeat customers</option><option value="specific">Specific eligible segment</option></select></div>
    <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:null}Save</Button></div>
  </CardContent></Card></div>
}