"use client";

import { Suspense, useMemo, useState } from "react";
import { usePageParams } from "../../lib/hooks/use-page-params";
import { usePersistentQuery } from "../../lib/hooks/use-persistent-query";
import { useParamField } from "../../lib/hooks/use-param-field";
import { api } from "../../lib/api/client";
import { PlaceSelector, type PlaceSelection } from "../../components/customer/place-selector";
import { HarvestSections } from "../../components/customer/harvest-sections";
import { ProductCard } from "../../components/customer/product-card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { MapPin, Globe2, Map, Search, SlidersHorizontal, Store, Navigation, Loader2 } from "lucide-react";

type Scope = "nearby" | "state" | "national" | "all";
const RADII = [2, 5, 10, 20, 50];

function MarketplaceInner() {
  const { params, update } = usePageParams();
  const legacyScope = params.view === "state" ? "state" : params.view === "national" ? "national" : params.view === "all" ? "all" : "nearby";
  const scope: Scope = (["nearby", "state", "national", "all"].includes(params.scope) ? params.scope : legacyScope) as Scope;
  const place: PlaceSelection = { country: params.country || "", state: params.state || "", district: params.district || "", city: params.city || "" };
  const radius = RADII.includes(Number(params.radius)) ? Number(params.radius) : 10;
  const search = useParamField("search", 350);
  const category = params.category || "";
  const [coords, setCoords] = useState<{lat:number; lng:number} | null>(null);
  const [locating, setLocating] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const setScope = (next: Scope) => update({ scope: next, page: "1" }, { push: true });
  const locate = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(p => { setCoords({lat:p.coords.latitude,lng:p.coords.longitude}); setLocating(false); }, () => setLocating(false), {enableHighAccuracy:true,timeout:10000,maximumAge:30000});
  };

  const productsQuery = usePersistentQuery({
    queryKey: ["unified-marketplace", scope, place, radius, coords, category, params.search || "", params.sortBy || "", params.minPrice || "", params.maxPrice || ""],
    enabled: scope !== "state" || !!place.state,
    queryFn: () => {
      if (scope === "state") return api.get("/marketplace/state", {params:{country:place.country||undefined,state:place.state,district:place.district||undefined,city:place.city||undefined,category:category||undefined,search:params.search||undefined,sortBy:params.sortBy||undefined}});
      if (scope === "national") return api.get("/marketplace/national", {params:{country:place.country||undefined,state:place.state||undefined,district:place.district||undefined,city:place.city||undefined,category:category||undefined,minPrice:params.minPrice||undefined,maxPrice:params.maxPrice||undefined,sortBy:params.sortBy||undefined}});
      const queryParams:Record<string,any>={limit:100,sortBy:params.sortBy||"createdAt",sortOrder:"desc"};
      if (scope==="nearby" && coords) Object.assign(queryParams,{lat:coords.lat,lng:coords.lng,radius});
      if (scope==="nearby" || (scope==="all" && (place.country||place.state||place.district||place.city))) Object.assign(queryParams,{country:place.country||undefined,state:place.state||undefined,district:place.district||undefined,city:place.city||undefined});
      if(params.search) queryParams.query=params.search;
      if(category) queryParams.category=category;
      return api.get("/products/search",{params:queryParams});
    }
  });

  const raw=productsQuery.data?.data?.products||productsQuery.data?.products||[];
  const products=useMemo(()=>{
    let rows=raw.map((p:any)=>({...p,id:p._id||p.id,name:p.name||"Fresh Produce",price:Number(p.price)||0,unit:p.unit||"kg",images:p.images||(p.image?[p.image]:[]),farmerName:p.farmerName||p.farmName||p.farmer?.farmName||p.farmer?.name||"Local Farmer",rating:Number(p.ratings?.average||p.rating||0),category:p.category||"General",quantity:p.availableQuantity??p.quantity??p.stock??0,farmDistanceKm:p.farmDistanceKm??p.distanceKm}));
    const term=(params.search||"").trim().toLowerCase();
    if(term) rows=rows.filter((p:any)=>[p.name,p.category,p.farmerName].some(v=>String(v||"").toLowerCase().includes(term)));
    if(category) rows=rows.filter((p:any)=>String(p.category).toLowerCase()===category.toLowerCase());
    if(params.minPrice) rows=rows.filter((p:any)=>p.price>=Number(params.minPrice));
    if(params.maxPrice) rows=rows.filter((p:any)=>p.price<=Number(params.maxPrice));
    if(params.sortBy==="price-asc") rows.sort((a:any,b:any)=>a.price-b.price);
    if(params.sortBy==="price-desc") rows.sort((a:any,b:any)=>b.price-a.price);
    if(params.sortBy==="rating") rows.sort((a:any,b:any)=>b.rating-a.rating);
    return rows;
  },[raw,params.search,category,params.minPrice,params.maxPrice,params.sortBy]);
  const categories=useMemo(()=>Array.from(new Set(raw.map((p:any)=>p.category).filter(Boolean))).sort() as string[],[raw]);
  const title=scope==="nearby"?"Nearby Marketplace":scope==="state"?"State Marketplace":scope==="national"?"National Marketplace":"All Products";
  const needsState=scope==="state"&&!place.state;

  return <div className="space-y-5 p-4 md:p-6">
    <header><h1 className="text-2xl font-bold text-slate-900 md:text-3xl">Marketplace</h1><p className="text-sm text-slate-600">Discover fresh products from local farmers near you, across your state and from all over India.</p></header>
    <section className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-r from-lime-50 via-emerald-50 to-green-100 px-6 py-7 md:px-10">
      <div className="relative z-10 max-w-2xl"><p className="mb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-700">Fresh daily · Farm to home</p><h2 className="text-2xl font-extrabold leading-tight text-slate-900 md:text-3xl">Fresh from<br/>Local Farmers to Your Home</h2><p className="mt-2 text-sm font-medium text-slate-700">Fresh Produce <span className="mx-2 text-emerald-600">|</span> Verified Farmers <span className="mx-2 text-emerald-600">|</span> Safe &amp; Traceable</p><a href="/nearby" className="mt-4 inline-flex rounded-full bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800">Shop Fresh Now →</a></div>
      <div className="pointer-events-none absolute -right-2 bottom-0 hidden items-end gap-2 text-6xl md:flex" aria-hidden="true">🥬 🥕 🍅 🧺</div><div className="pointer-events-none absolute -right-10 -top-20 h-64 w-64 rounded-full bg-white/40 blur-3xl"/>
    </section>
    <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
      {([{value:"nearby",label:"Nearby Marketplace",sub:"From farmers near you",Icon:MapPin},{value:"state",label:"State Marketplace",sub:"Across your state",Icon:Map},{value:"national",label:"National Marketplace",sub:"Across India",Icon:Globe2},{value:"all",label:"All Products",sub:"Search across all markets",Icon:Store}] as const).map(({value,label,sub,Icon})=><button key={value} onClick={()=>setScope(value)} className={`flex min-h-[68px] items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${scope===value?"border-emerald-600 bg-emerald-50 shadow-sm":"border-slate-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/50"}`}><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${scope===value?"bg-emerald-100 text-emerald-700":"bg-slate-50 text-slate-600"}`}><Icon className="h-5 w-5"/></span><span><strong className="block text-sm text-slate-900">{label}</strong><small className="text-xs text-slate-500">{sub}</small></span></button>)}
    </div>
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(220px,280px)_auto]">
        <form className="relative" onSubmit={e=>{e.preventDefault();update({search:search.value.trim(),page:"1"});}}><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-700"/><Input value={search.value} onChange={e=>search.setValue(e.target.value)} placeholder="Search products, farmers or categories (e.g., Tomato, Onion, Organic...)" className="h-11 pl-10"/></form>
        <PlaceSelector value={place} onChange={v=>update({country:v.country,state:v.state,district:v.district,city:v.city})} includeAll={scope==="national"||scope==="all"}/>
        {scope==="nearby"&&<Button variant="outline" onClick={locate} disabled={locating} className="h-11">{locating?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Navigation className="mr-2 h-4 w-4"/>}Use My Location</Button>}
      </div>
      {scope==="nearby"&&<div className="flex flex-wrap items-center gap-2"><span className="mr-1 text-xs font-semibold text-slate-600">Search radius</span>{RADII.map(r=><button key={r} onClick={()=>update({radius:String(r)})} className={`rounded-full border px-4 py-1.5 text-xs font-semibold ${radius===r?"border-emerald-700 bg-emerald-700 text-white":"border-slate-200 bg-white text-slate-600 hover:border-emerald-300"}`}>{r} km</button>)}</div>}
      {needsState&&<p className="text-xs text-amber-700">Select a country and state to browse state-level products.</p>}
    </section>
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1"><button onClick={()=>update({harvest:"all"})} className={`rounded-lg px-4 py-2 text-sm font-semibold ${(params.harvest||"all")==="all"?"bg-emerald-700 text-white":"text-slate-600"}`}>All Products</button><button onClick={()=>update({harvest:"harvested"})} className={`rounded-lg px-4 py-2 text-sm font-semibold ${params.harvest==="harvested"?"bg-emerald-700 text-white":"text-slate-600"}`}>Harvested</button><button onClick={()=>update({harvest:"preharvest"})} className={`rounded-lg px-4 py-2 text-sm font-semibold ${params.harvest==="preharvest"?"bg-emerald-700 text-white":"text-slate-600"}`}>Pre Harvest</button></div><div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={()=>setShowFilters(v=>!v)}><SlidersHorizontal className="mr-2 h-4 w-4"/>Filters</Button><select aria-label="Sort products" value={params.sortBy||"relevance"} onChange={e=>update({sortBy:e.target.value==="relevance"?"":e.target.value})} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="relevance">Sort: Relevance</option><option value="price-asc">Price: Low to High</option><option value="price-desc">Price: High to Low</option><option value="rating">Top Rated</option><option value="newest">Newest</option></select></div></div>
    {showFilters&&<section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4"><label className="text-xs font-semibold text-slate-600">Category<select value={category} onChange={e=>update({category:e.target.value})} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal"><option value="">All categories</option>{categories.map(c=><option key={c} value={c}>{c}</option>)}</select></label><label className="text-xs font-semibold text-slate-600">Minimum price<input type="number" min="0" value={params.minPrice||""} onChange={e=>update({minPrice:e.target.value})} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal" placeholder="₹ Min"/></label><label className="text-xs font-semibold text-slate-600">Maximum price<input type="number" min="0" value={params.maxPrice||""} onChange={e=>update({maxPrice:e.target.value})} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal" placeholder="₹ Max"/></label><button onClick={()=>update({category:"",minPrice:"",maxPrice:"",sortBy:"",search:""})} className="self-end text-left text-sm font-semibold text-emerald-700 hover:underline">Clear all filters</button></section>}
    <section className="space-y-3"><div className="flex items-center justify-between gap-2"><div><h3 className="font-bold text-slate-900">{title}</h3><p className="text-xs text-slate-500">{products.length} products {scope==="nearby"&&coords? `within ${radius} km`:""}</p></div><span className="text-xs text-slate-500">{productsQuery.isLoading?"Loading products…":`Showing ${products.length} products`}</span></div>
      {needsState?<div className="rounded-xl border border-slate-200 bg-white py-14 text-center text-sm text-slate-500">Choose a state to see available products.</div>:productsQuery.isLoading?<div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-700"/></div>:products.length?<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">{products.slice(0,24).map((p:any)=><ProductCard key={p.id} product={p}/>)}</div>:<div className="rounded-xl border border-slate-200 bg-white py-14 text-center text-sm text-slate-500">No products found. Try another location or clear some filters.</div>}
    </section>
    <HarvestSections country={place.country} state={place.state} district={place.district} city={place.city} coords={coords?{lat:String(coords.lat),lng:String(coords.lng)}:null} radius={radius}/>
  </div>;
}

export default function MarketplacePage(){return <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading marketplace…</div>}><MarketplaceInner/></Suspense>;}
