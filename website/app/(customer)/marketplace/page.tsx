"use client";

import { Suspense, useMemo, useState } from "react";
import { usePageParams } from "../../lib/hooks/use-page-params";
import { usePersistentQuery } from "../../lib/hooks/use-persistent-query";
import { useParamField } from "../../lib/hooks/use-param-field";
import { api } from "../../lib/api/client";
import { PlaceSelector, type PlaceSelection } from "../../components/customer/place-selector";
import { ProductCard } from "../../components/customer/product-card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { MapPin, Globe2, Map, Search, Store, Navigation, Loader2, SlidersHorizontal, ChevronDown, Leaf, Sprout, LayoutGrid, List, X } from "lucide-react";

type Scope = "nearby" | "state" | "national" | "all";
const RADII = [2, 5, 10, 20, 50];

function MarketplaceInner() {
  const { params, update } = usePageParams();
  const legacyScope = params.view === "state" ? "state" : params.view === "national" ? "national" : params.view === "all" ? "all" : "nearby";
  const scope: Scope = (["nearby","state","national","all"].includes(params.scope) ? params.scope : legacyScope) as Scope;
  const place: PlaceSelection = {country:params.country||"",state:params.state||"",district:params.district||"",city:params.city||""};
  const radius = RADII.includes(Number(params.radius)) ? Number(params.radius) : 10;
  const search = useParamField("search",350);
  const category = params.category || "";
  const [coords,setCoords] = useState<{lat:number;lng:number}|null>(null);
  const [locating,setLocating] = useState(false);
  const [filtersOpen,setFiltersOpen] = useState({category:true,price:false,farmer:false,availability:false,certification:false,delivery:false});
  const [gridView,setGridView] = useState(true);
  const [harvestTab,setHarvestTab] = useState<"all"|"harvested"|"preharvest">((params.harvest as any)||"all");
  const [mobileFilters,setMobileFilters] = useState(false);

  const setScope=(next:Scope)=>update({scope:next,page:"1"},{push:true});
  const locate=()=>{
    if(!navigator.geolocation)return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(p=>{setCoords({lat:p.coords.latitude,lng:p.coords.longitude});setLocating(false);},()=>setLocating(false),{enableHighAccuracy:true,timeout:10000,maximumAge:30000});
  };

  const productsQuery=usePersistentQuery({
    queryKey:["unified-marketplace",scope,place,radius,coords,category,params.search||"",params.sortBy||"",params.minPrice||"",params.maxPrice||""],
    enabled:scope!=="state"||!!place.state,
    queryFn:()=>{
      if(scope==="state")return api.get("/marketplace/state",{params:{country:place.country||undefined,state:place.state,district:place.district||undefined,city:place.city||undefined,category:category||undefined,search:params.search||undefined,sortBy:params.sortBy||undefined}});
      if(scope==="national")return api.get("/marketplace/national",{params:{country:place.country||undefined,state:place.state||undefined,district:place.district||undefined,city:place.city||undefined,category:category||undefined,minPrice:params.minPrice||undefined,maxPrice:params.maxPrice||undefined,sortBy:params.sortBy||undefined}});
      const q:Record<string,any>={limit:100,sortBy:params.sortBy||"createdAt",sortOrder:"desc"};
      if(scope==="nearby"&&coords)Object.assign(q,{lat:coords.lat,lng:coords.lng,radius});
      if(scope==="nearby"||(scope==="all"&&(place.country||place.state||place.district||place.city)))Object.assign(q,{country:place.country||undefined,state:place.state||undefined,district:place.district||undefined,city:place.city||undefined});
      if(params.search)q.query=params.search;if(category)q.category=category;
      return api.get("/products/search",{params:q});
    }
  });
  const raw=productsQuery.data?.data?.products||productsQuery.data?.products||[];
  const products=useMemo(()=>{
    let rows=raw.map((p:any)=>({...p,id:p._id||p.id,name:p.name||"Fresh Produce",price:Number(p.price)||0,unit:p.unit||"kg",images:p.images||(p.image?[p.image]:[]),farmerName:p.farmerName||p.farmName||p.farmer?.farmName||p.farmer?.name||"Local Farmer",rating:Number(p.ratings?.average||p.rating||0),category:p.category||"Others",quantity:p.availableQuantity??p.quantity??p.stock??0,farmDistanceKm:p.farmDistanceKm??p.distanceKm}));
    const term=(params.search||"").trim().toLowerCase();
    if(term)rows=rows.filter((p:any)=>[p.name,p.category,p.farmerName].some(v=>String(v||"").toLowerCase().includes(term)));
    if(category)rows=rows.filter((p:any)=>String(p.category).toLowerCase()===category.toLowerCase());
    if(params.minPrice)rows=rows.filter((p:any)=>p.price>=Number(params.minPrice));
    if(params.maxPrice)rows=rows.filter((p:any)=>p.price<=Number(params.maxPrice));
    if(params.sortBy==="price-asc")rows.sort((a:any,b:any)=>a.price-b.price);
    if(params.sortBy==="price-desc")rows.sort((a:any,b:any)=>b.price-a.price);
    if(params.sortBy==="rating")rows.sort((a:any,b:any)=>b.rating-a.rating);
    return rows;
  },[raw,params.search,category,params.minPrice,params.maxPrice,params.sortBy,harvestTab]);
  const categories=useMemo(()=>Array.from(new Set(raw.map((p:any)=>p.category).filter(Boolean))).sort() as string[],[raw]);
  const preHarvestQuery=usePersistentQuery({queryKey:["marketplace-preharvest",place,coords,radius],queryFn:()=>api.get("/harvests/upcoming",{params:{...(coords?{lat:String(coords.lat),lng:String(coords.lng),radius}:{}),...(place.state?{state:place.state}:{}),...(place.district?{district:place.district}:{}),...(place.city?{city:place.city}:{})}})});
  const preHarvestPlans=preHarvestQuery.data?.data?.plans||preHarvestQuery.data?.data||[];
  const displayedProducts=harvestTab==="preharvest"?[]:products;
  const title=scope==="nearby"?"Nearby Farmers":scope==="state"?"State Marketplace":scope==="national"?"National Marketplace":"All Products";
  const needsState=scope==="state"&&!place.state;
  const toggleFilter=(key:keyof typeof filtersOpen)=>setFiltersOpen(v=>({...v,[key]:!v}));
  const resetFilters=()=>{update({category:"",minPrice:"",maxPrice:"",search:"",sortBy:""});setHarvestTab("all");};

  const filterPanel=<div className="space-y-0 divide-y divide-slate-100">
    <div className="pb-3"><div className="mb-2 flex items-center justify-between"><h3 className="font-bold text-slate-900">Filters</h3><button onClick={resetFilters} className="text-xs font-semibold text-emerald-700 hover:underline">Clear All</button></div></div>
    <section className="py-3"><button onClick={()=>toggleFilter("category")} className="flex w-full items-center justify-between text-sm font-semibold text-slate-800">Category <ChevronDown className={`h-4 w-4 transition-transform ${filtersOpen.category?"":"-rotate-90"}`}/></button>{filtersOpen.category&&<div className="mt-2 space-y-2">{categories.map((c)=>{const count=raw.filter((p:any)=>String(p.category||"").toLowerCase()===c.toLowerCase()).length;return <label key={c} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"><input type="radio" name="market-category" checked={category===c} onChange={()=>update({category:category===c?"":c})} className="h-4 w-4 accent-emerald-700"/><span className="flex-1">{c}</span><span className="text-xs text-slate-400">({count})</span></label>})}</div>}</section>
    <section className="py-3"><button onClick={()=>toggleFilter("price")} className="flex w-full items-center justify-between text-sm font-semibold text-slate-800">Price Range <ChevronDown className={`h-4 w-4 ${filtersOpen.price?"":"-rotate-90"}`}/></button>{filtersOpen.price&&<div className="mt-2 grid grid-cols-2 gap-2"><Input type="number" min="0" value={params.minPrice||""} onChange={e=>update({minPrice:e.target.value})} placeholder="Min ₹"/><Input type="number" min="0" value={params.maxPrice||""} onChange={e=>update({maxPrice:e.target.value})} placeholder="Max ₹"/></div>}</section>
    {([{key:"farmer",label:"Farmer Type",items:["Individual Farmer","FPO / Cooperative","Verified Farm"]},{key:"availability",label:"Availability",items:["In Stock","Pre-order Open"]},{key:"certification",label:"Certification",items:["Organic","Verified"]},{key:"delivery",label:"Delivery Options",items:["Home Delivery","Farm Pickup"]}] as const).map(group=><section key={group.key} className="py-3"><button onClick={()=>toggleFilter(group.key)} className="flex w-full items-center justify-between text-sm font-semibold text-slate-800">{group.label}<ChevronDown className={`h-4 w-4 ${filtersOpen[group.key]?"":"-rotate-90"}`}/></button>{filtersOpen[group.key]&&<div className="mt-2 space-y-2">{group.items.map(item=><label key={item} className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" disabled className="h-4 w-4 accent-emerald-700"/>{item}</label>)}</div>}</section>)}
  </div>;

  return <div className="space-y-4 px-3 py-4 md:px-5 md:py-5">
    <header className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><Store className="h-6 w-6"/></div><div><h1 className="text-2xl font-extrabold tracking-tight text-slate-950">Marketplace</h1><p className="text-sm text-slate-600">Discover fresh products from local farmers near you, across your state and from all over India.</p></div></header>

    <section className="relative min-h-[150px] overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-r from-lime-100 via-emerald-50 to-sky-100 px-6 py-5 shadow-sm md:min-h-[160px] md:px-10">
      <div className="absolute inset-0 opacity-20" style={{backgroundImage:"radial-gradient(circle at 15% 90%, #65a30d 0, transparent 32%), radial-gradient(circle at 80% 10%, #10b981 0, transparent 30%)"}}/>
      <div className="relative z-10 max-w-2xl"><h2 className="text-2xl font-black leading-tight text-slate-950 md:text-3xl">Fresh from<br/>Local Farmers to Your Home</h2><p className="mt-2 text-sm font-semibold text-slate-800">Fresh Produce <span className="mx-2 text-emerald-700">|</span> Verified Farmers <span className="mx-2 text-emerald-700">|</span> Safe &amp; Traceable</p><a href="/nearby" className="mt-3 inline-flex rounded-full bg-emerald-700 px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-800">Shop Fresh Now <span className="ml-2">→</span></a></div>
      <div className="pointer-events-none absolute -right-3 bottom-0 hidden items-end gap-2 text-6xl md:flex" aria-hidden="true">🥬 🥕 🍅 🧺</div>
    </section>

    <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
      {([{value:"nearby",label:"Nearby Marketplace",sub:"From farmers near you",Icon:MapPin},{value:"state",label:"State Marketplace",sub:"Across your state",Icon:Map},{value:"national",label:"National Marketplace",sub:"Across India",Icon:Globe2},{value:"all",label:"All Products",sub:"Search across all markets",Icon:Store}] as const).map(({value,label,sub,Icon})=><button key={value} onClick={()=>setScope(value)} className={`flex min-h-[58px] items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${scope===value?"border-emerald-600 bg-emerald-50 shadow-sm":"border-slate-200 bg-white hover:border-emerald-200"}`}><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${scope===value?"bg-emerald-100 text-emerald-700":"bg-slate-50 text-slate-600"}`}><Icon className="h-5 w-5"/></span><span><strong className="block text-sm text-slate-900">{label}</strong><small className="text-xs text-slate-500">{sub}</small></span></button>)}
    </div>

    <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(190px,250px)_minmax(145px,175px)_auto]">
        <form className="relative" onSubmit={e=>{e.preventDefault();update({search:search.value.trim(),page:"1"});}}><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-700"/><Input value={search.value} onChange={e=>search.setValue(e.target.value)} placeholder="Search for fresh fruits, vegetables, grains and more..." className="h-10 pl-10"/></form>
        <div className="min-w-0"><PlaceSelector value={place} onChange={v=>update({country:v.country,state:v.state,district:v.district,city:v.city})} includeAll={scope==="national"||scope==="all"}/></div>
        {scope==="nearby"?<select aria-label="Search radius" value={radius} onChange={e=>update({radius:e.target.value})} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value={2}>Within 2 KM</option><option value={5}>Within 5 KM</option><option value={10}>Within 10 KM</option><option value={20}>Within 20 KM</option><option value={50}>Within 50 KM</option></select>:<div className="flex h-10 items-center rounded-lg border border-slate-200 px-3 text-xs text-slate-500">{scope==="state"?"Across selected state":scope==="national"?"Across India":"All locations"}</div>}
        <Button onClick={()=>{if(scope==="nearby"&&!coords)locate();else update({search:search.value.trim(),page:"1"});}} disabled={locating} className="h-10 bg-emerald-700 hover:bg-emerald-800">{locating?<Loader2 className="h-4 w-4 animate-spin"/>:<Search className="mr-1 h-4 w-4"/>}Search</Button>
      </div>
    </section>

    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2"><div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">{([{value:"all",label:"All Products",Icon:Store},{value:"harvested",label:"Harvested",Icon:Leaf},{value:"preharvest",label:"Pre Harvest",Icon:Sprout}] as const).map(({value,label,Icon})=><button key={value} onClick={()=>{setHarvestTab(value);update({harvest:value});}} className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold ${harvestTab===value?"bg-emerald-700 text-white shadow-sm":"text-slate-600 hover:bg-white"}`}><Icon className="h-4 w-4"/>{label}{value==="all"?` (${raw.length})`:""}</button>)}</div><div className="flex items-center gap-2"><span className="hidden text-xs text-slate-500 sm:inline">Sort by</span><select aria-label="Sort products" value={params.sortBy||"relevance"} onChange={e=>update({sortBy:e.target.value==="relevance"?"":e.target.value})} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs"><option value="relevance">Relevance</option><option value="price-asc">Price: Low to High</option><option value="price-desc">Price: High to Low</option><option value="rating">Top Rated</option><option value="newest">Newest</option></select><button onClick={()=>setGridView(true)} aria-label="Grid view" className={`rounded-lg p-2 ${gridView?"bg-emerald-700 text-white":"border text-slate-600"}`}><LayoutGrid className="h-4 w-4"/></button><button onClick={()=>setGridView(false)} aria-label="List view" className={`rounded-lg p-2 ${!gridView?"bg-emerald-700 text-white":"border text-slate-600"}`}><List className="h-4 w-4"/></button></div></div>

    <div className="grid gap-4 lg:grid-cols-[230px_minmax(0,1fr)]">
      <aside className="hidden h-fit rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:block">{filterPanel}</aside>
      <div className="min-w-0 space-y-3">
        <div className="flex items-center justify-between gap-2"><div><h2 className="font-bold text-slate-900">Showing <span className="text-emerald-700">{harvestTab==="preharvest"?preHarvestPlans.length:products.length}</span> products from <span className="text-emerald-700">{title}</span>{scope==="nearby"&&coords?<span className="font-normal text-slate-500"> (within {radius} KM)</span>:null}</h2><p className="text-xs text-slate-500">{(harvestTab==="preharvest"?preHarvestQuery.isLoading:productsQuery.isLoading)?"Loading available products...":`Showing 1–${Math.min(displayedProducts.length,24)} of ${displayedProducts.length} products`}</p></div><Button variant="outline" size="sm" className="lg:hidden" onClick={()=>setMobileFilters(true)}><SlidersHorizontal className="mr-2 h-4 w-4"/>Filters</Button></div>
        {needsState?<div className="rounded-xl border bg-white py-14 text-center text-sm text-slate-500">Choose a state to see available products.</div>:harvestTab==="preharvest"?(preHarvestQuery.isLoading?<div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-700"/></div>:preHarvestPlans.length?<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{preHarvestPlans.map((plan:any)=><article key={plan._id||plan.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-2 flex items-center justify-between"><span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">Pre Harvest</span><span className="text-xs text-slate-500">{plan.expectedQuantityKg??"—"} kg planned</span></div><h3 className="font-bold text-slate-900">{plan.cropName||plan.productName||"Upcoming harvest"}</h3><p className="mt-1 text-xs text-slate-500">{plan.farmerInfo?.farmName||plan.farmerInfo?.name||"Local Farmer"}</p><p className="mt-2 text-sm text-slate-600">Expected harvest: {plan.expectedHarvestDate?new Date(plan.expectedHarvestDate).toLocaleDateString():"Date not provided"}</p><p className="mt-1 text-sm font-semibold text-emerald-700">₹{plan.preOrderPricePerKg??"—"} / kg</p></article>)}</div>:<div className="rounded-xl border border-slate-200 bg-white py-14 text-center text-sm text-slate-500">No upcoming harvests available for this location yet.</div>):productsQuery.isLoading?<div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-700"/></div>:displayedProducts.length?<div className={gridView?"grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5":"grid grid-cols-1 gap-3"}>{displayedProducts.slice(0,24).map((p:any)=><ProductCard key={p.id} product={p}/>)}</div>:<div className="rounded-xl border border-slate-200 bg-white py-14 text-center text-sm text-slate-500">No products found. Try another location or clear some filters.</div>}
        {displayedProducts.length>24&&<div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500"><span>Showing 1–24 of {displayedProducts.length} products</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled>Previous</Button><Button size="sm" className="bg-emerald-700">1</Button><Button size="sm" variant="outline" disabled>Next</Button></div></div>}
      </div>
    </div>

    {mobileFilters&&<div className="fixed inset-0 z-50 bg-slate-950/40 p-4 lg:hidden" onClick={()=>setMobileFilters(false)}><div className="ml-auto h-full max-w-sm overflow-y-auto rounded-2xl bg-white p-4 shadow-xl" onClick={e=>e.stopPropagation()}><div className="mb-3 flex items-center justify-between"><h2 className="font-bold">Filter Products</h2><button onClick={()=>setMobileFilters(false)} aria-label="Close filters"><X className="h-5 w-5"/></button></div>{filterPanel}<Button className="mt-4 w-full bg-emerald-700" onClick={()=>setMobileFilters(false)}>Show {products.length} products</Button></div></div>}
  </div>;
}

export default function MarketplacePage(){return <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading marketplace…</div>}><MarketplaceInner/></Suspense>;}
