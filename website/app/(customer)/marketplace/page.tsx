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
  const [filtersOpen,setFiltersOpen] = useState({category:true,price:true,farmer:true,availability:true,certification:true,delivery:true});
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
    if(params.availability==="stock")rows=rows.filter((p:any)=>Number(p.quantity)>0||p.inStock===true);
    if(params.availability==="preorder")rows=rows.filter((p:any)=>["preorder","pre_harvest","open"].includes(String(p.status||p.harvestStatus||"").toLowerCase()));
    if(params.farmerType==="individual")rows=rows.filter((p:any)=>!String(p.farmerType||p.farmer?.type||"").toLowerCase().match(/fpo|cooperative|organization/));
    if(params.farmerType==="fpo")rows=rows.filter((p:any)=>String(p.farmerType||p.farmer?.type||"").toLowerCase().match(/fpo|cooperative|organization/));
    if(params.assurance==="organic")rows=rows.filter((p:any)=>p.isOrganic===true||p.tags?.includes?.("organic"));
    if(params.assurance==="verified")rows=rows.filter((p:any)=>["verified","buyer_verified"].includes(String(p.verificationStatus||"").toLowerCase()));
    if(params.delivery==="home")rows=rows.filter((p:any)=>p.deliveryAvailable===true||p.homeDeliveryAvailable===true||p.deliveryOptions?.includes?.("home_delivery"));
    if(params.delivery==="pickup")rows=rows.filter((p:any)=>p.pickupAvailable===true||p.deliveryOptions?.includes?.("farm_pickup"));
    if(params.sortBy==="price-asc")rows.sort((a:any,b:any)=>a.price-b.price);
    if(params.sortBy==="price-desc")rows.sort((a:any,b:any)=>b.price-a.price);
    if(params.sortBy==="rating")rows.sort((a:any,b:any)=>b.rating-a.rating);
    return rows;
  },[raw,params.search,category,params.minPrice,params.maxPrice,params.sortBy,params.availability,params.farmerType,params.assurance,params.delivery,harvestTab]);
  const categories=useMemo(()=>Array.from(new Set(raw.map((p:any)=>p.category).filter(Boolean))).sort() as string[],[raw]);
  const preHarvestQuery=usePersistentQuery({queryKey:["marketplace-preharvest",place,coords,radius],queryFn:()=>api.get("/harvests/upcoming",{params:{...(coords?{lat:String(coords.lat),lng:String(coords.lng),radius}:{}),...(place.state?{state:place.state}:{}),...(place.district?{district:place.district}:{}),...(place.city?{city:place.city}:{})}})});
  const preHarvestPlans=preHarvestQuery.data?.data?.plans||preHarvestQuery.data?.data||[];
  const displayedProducts=harvestTab==="preharvest"?[]:products;
  const title=scope==="nearby"?"Nearby Farmers":scope==="state"?"State Marketplace":scope==="national"?"National Marketplace":"All Products";
  const needsState=scope==="state"&&!place.state;
  const toggleFilter=(key:keyof typeof filtersOpen)=>setFiltersOpen(v=>({...v,[key]:!v}));
  const resetFilters=()=>{update({category:"",minPrice:"",maxPrice:"",search:"",sortBy:"",availability:"",farmerType:"",assurance:"",delivery:""});setHarvestTab("all");};

  const filterPanel=<div className="space-y-0 divide-y divide-slate-100">
    <div className="pb-3"><div className="mb-2 flex items-center justify-between"><h3 className="font-bold text-slate-900">Filters</h3><button onClick={resetFilters} className="text-xs font-semibold text-emerald-700 hover:underline">Clear All</button></div></div>
    <section className="py-3"><button onClick={()=>toggleFilter("category")} className="flex w-full items-center justify-between text-sm font-semibold text-slate-800">Category <ChevronDown className={`h-4 w-4 transition-transform ${filtersOpen.category?"":"-rotate-90"}`}/></button>{filtersOpen.category&&<div className="mt-2 space-y-2">{categories.map((c)=>{const count=raw.filter((p:any)=>String(p.category||"").toLowerCase()===c.toLowerCase()).length;return <label key={c} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"><input type="radio" name="market-category" checked={category===c} onChange={()=>update({category:category===c?"":c})} className="h-4 w-4 accent-emerald-700"/><span className="flex-1">{c}</span><span className="text-xs text-slate-400">({count})</span></label>})}</div>}</section>
    <section className="py-3"><button onClick={()=>toggleFilter("price")} className="flex w-full items-center justify-between text-sm font-semibold text-slate-800">Price Range <ChevronDown className={`h-4 w-4 ${filtersOpen.price?"":"-rotate-90"}`}/></button>{filtersOpen.price&&<div className="mt-2 grid grid-cols-2 gap-2"><Input type="number" min="0" value={params.minPrice||""} onChange={e=>update({minPrice:e.target.value})} placeholder="Min ₹"/><Input type="number" min="0" value={params.maxPrice||""} onChange={e=>update({maxPrice:e.target.value})} placeholder="Max ₹"/></div>}</section>
    <section className="py-3"><button onClick={()=>toggleFilter("availability")} className="flex w-full items-center justify-between text-sm font-semibold text-slate-800">Availability <ChevronDown className={`h-4 w-4 ${filtersOpen.availability?"":"-rotate-90"}`}/></button>{filtersOpen.availability&&<div className="mt-2 space-y-2">{[{value:"stock",label:"In stock",count:raw.filter((p:any)=>Number(p.availableQuantity??p.quantity??p.stock??0)>0||p.inStock===true).length},{value:"preorder",label:"Pre-order available",count:raw.filter((p:any)=>["preorder","pre_harvest","open"].includes(String(p.status||p.harvestStatus||"").toLowerCase())).length}].map(o=><label key={o.value} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"><input type="radio" name="availability" checked={(params.availability||"")===o.value} onChange={()=>update({availability:params.availability===o.value?"":o.value})} className="h-4 w-4 accent-emerald-700"/><span className="flex-1">{o.label}</span><span className="text-xs text-slate-400">({o.count})</span></label>)}</div>}</section>
    <section className="py-3"><button onClick={()=>toggleFilter("farmer")} className="flex w-full items-center justify-between text-sm font-semibold text-slate-800">Farmer Type <ChevronDown className={`h-4 w-4 ${filtersOpen.farmer?"":"-rotate-90"}`}/></button>{filtersOpen.farmer&&<div className="mt-2 space-y-2">{[{value:"individual",label:"Individual farmer"},{value:"fpo",label:"FPO / Cooperative"}].map(o=><label key={o.value} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"><input type="radio" name="farmerType" checked={(params.farmerType||"")===o.value} onChange={()=>update({farmerType:params.farmerType===o.value?"":o.value})} className="h-4 w-4 accent-emerald-700"/>{o.label}</label>)}</div>}</section>
    <section className="py-3"><button onClick={()=>toggleFilter("certification")} className="flex w-full items-center justify-between text-sm font-semibold text-slate-800">Product Assurance <ChevronDown className={`h-4 w-4 ${filtersOpen.certification?"":"-rotate-90"}`}/></button>{filtersOpen.certification&&<div className="mt-2 space-y-2">{[{value:"organic",label:"Organic",count:raw.filter((p:any)=>p.isOrganic===true||p.tags?.includes?.("organic")).length},{value:"verified",label:"Verified farmer",count:raw.filter((p:any)=>["verified","buyer_verified"].includes(String(p.verificationStatus||"").toLowerCase())).length}].map(o=><label key={o.value} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"><input type="radio" name="assurance" checked={(params.assurance||"")===o.value} onChange={()=>update({assurance:params.assurance===o.value?"":o.value})} className="h-4 w-4 accent-emerald-700"/><span className="flex-1">{o.label}</span><span className="text-xs text-slate-400">({o.count})</span></label>)}</div>}</section>
    <section className="py-3"><button onClick={()=>toggleFilter("delivery")} className="flex w-full items-center justify-between text-sm font-semibold text-slate-800">Delivery Method <ChevronDown className={`h-4 w-4 ${filtersOpen.delivery?"":"-rotate-90"}`}/></button>{filtersOpen.delivery&&<div className="mt-2 space-y-2">{[{value:"home",label:"Home delivery",count:raw.filter((p:any)=>p.deliveryAvailable===true||p.homeDeliveryAvailable===true||p.deliveryOptions?.includes?.("home_delivery")).length},{value:"pickup",label:"Farm pickup",count:raw.filter((p:any)=>p.pickupAvailable===true||p.deliveryOptions?.includes?.("farm_pickup")).length}].map(o=><label key={o.value} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"><input type="radio" name="delivery" checked={(params.delivery||"")===o.value} onChange={()=>update({delivery:params.delivery===o.value?"":o.value})} className="h-4 w-4 accent-emerald-700"/><span className="flex-1">{o.label}</span><span className="text-xs text-slate-400">({o.count})</span></label>)}</div>}</section>
  </div>;

  return <div className="space-y-4 px-4 py-5 md:px-5 md:py-6">
    <header className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><Store className="h-6 w-6"/></div><div><h1 className="text-2xl font-extrabold tracking-tight text-slate-950">Marketplace</h1><p className="text-sm text-slate-600">Discover fresh products from local farmers near you, across your state and from all over India.</p></div></header>

    <section className="relative min-h-[170px] overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-r from-lime-100 via-emerald-50 to-sky-100 px-6 py-6 shadow-sm md:min-h-[185px] md:px-10">
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

    <div className="flex flex-col gap-2 border-b border-slate-200 pb-3"><div className="grid w-full grid-cols-3 gap-2">{([{value:"all",label:"All Products",Icon:Store},{value:"harvested",label:"Harvested",Icon:Leaf},{value:"preharvest",label:"Pre Harvest",Icon:Sprout}] as const).map(({value,label,Icon})=><button key={value} onClick={()=>{setHarvestTab(value);update({harvest:value});}} className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${harvestTab===value?"border-emerald-700 bg-emerald-700 text-white shadow-sm":"border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50"}`}><Icon className="h-4 w-4"/>{label}{value==="all"?` (${raw.length})`:""}</button>)}</div><div className="flex w-full flex-wrap items-center justify-end gap-3"><label className="text-sm font-semibold text-slate-700" htmlFor="marketplace-sort">Sort by</label><select id="marketplace-sort" aria-label="Sort products" value={params.sortBy||"relevance"} onChange={e=>update({sortBy:e.target.value==="relevance"?"":e.target.value})} className="h-11 min-w-[220px] rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"><option value="relevance">Relevance</option><option value="price-asc">Price: Low to High</option><option value="price-desc">Price: High to Low</option><option value="rating">Top Rated</option><option value="newest">Newest</option></select><div className="flex items-center gap-2"><button onClick={()=>setGridView(true)} aria-label="Grid view" aria-pressed={gridView} className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${gridView?"bg-emerald-700 text-white shadow-sm":"border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}><LayoutGrid className="h-5 w-5"/></button><button onClick={()=>setGridView(false)} aria-label="List view" aria-pressed={!gridView} className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${!gridView?"bg-emerald-700 text-white shadow-sm":"border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}><List className="h-5 w-5"/></button></div></div></div>

    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="hidden h-fit rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:block">{filterPanel}</aside>
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2"><div><h2 className="font-bold text-slate-900">Showing <span className="text-emerald-700">{harvestTab==="preharvest"?preHarvestPlans.length:products.length}</span> products from <span className="text-emerald-700">{title}</span>{scope==="nearby"&&coords?<span className="font-normal text-slate-500"> (within {radius} KM)</span>:null}</h2><p className="text-xs text-slate-500">{(harvestTab==="preharvest"?preHarvestQuery.isLoading:productsQuery.isLoading)?"Loading available products...":`Showing 1–${Math.min(displayedProducts.length,12)} of ${displayedProducts.length} products`}</p></div><Button variant="outline" size="sm" className="lg:hidden" onClick={()=>setMobileFilters(true)}><SlidersHorizontal className="mr-2 h-4 w-4"/>Filters</Button></div>
        {needsState?<div className="rounded-xl border bg-white py-14 text-center text-sm text-slate-500">Choose a state to see available products.</div>:harvestTab==="preharvest"?(preHarvestQuery.isLoading?<div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-700"/></div>:preHarvestPlans.length?<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{preHarvestPlans.map((plan:any)=><article key={plan._id||plan.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-2 flex items-center justify-between"><span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">Pre Harvest</span><span className="text-xs text-slate-500">{plan.expectedQuantityKg??"—"} kg planned</span></div><h3 className="font-bold text-slate-900">{plan.cropName||plan.productName||"Upcoming harvest"}</h3><p className="mt-1 text-xs text-slate-500">{plan.farmerInfo?.farmName||plan.farmerInfo?.name||"Local Farmer"}</p><p className="mt-2 text-sm text-slate-600">Expected harvest: {plan.expectedHarvestDate?new Date(plan.expectedHarvestDate).toLocaleDateString():"Date not provided"}</p><p className="mt-1 text-sm font-semibold text-emerald-700">₹{plan.preOrderPricePerKg??"—"} / kg</p></article>)}</div>:<div className="rounded-xl border border-slate-200 bg-white py-14 text-center text-sm text-slate-500">No upcoming harvests available for this location yet.</div>):productsQuery.isLoading?<div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-700"/></div>:displayedProducts.length?<div className={gridView?"grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6":"grid grid-cols-1 gap-3"}>{displayedProducts.slice(0,12).map((p:any)=><ProductCard key={p.id} product={p} compact/>)}</div>:<div className="rounded-xl border border-slate-200 bg-white py-14 text-center text-sm text-slate-500">No products found. Try another location or clear some filters.</div>}
        {displayedProducts.length>12&&<div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500"><span>Showing 1–12 of {displayedProducts.length} products</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled>Previous</Button><Button size="sm" className="bg-emerald-700">1</Button><Button size="sm" variant="outline" disabled>Next</Button></div></div>}
      </div>
    </div>

    {mobileFilters&&<div className="fixed inset-0 z-50 bg-slate-950/40 p-4 lg:hidden" onClick={()=>setMobileFilters(false)}><div className="ml-auto h-full max-w-sm overflow-y-auto rounded-2xl bg-white p-4 shadow-xl" onClick={e=>e.stopPropagation()}><div className="mb-3 flex items-center justify-between"><h2 className="font-bold">Filter Products</h2><button onClick={()=>setMobileFilters(false)} aria-label="Close filters"><X className="h-5 w-5"/></button></div>{filterPanel}<Button className="mt-4 w-full bg-emerald-700" onClick={()=>setMobileFilters(false)}>Show {products.length} products</Button></div></div>}
  </div>;
}

export default function MarketplacePage(){return <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading marketplace…</div>}><MarketplaceInner/></Suspense>;}
