"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  MapPin,
  Building2,
  Globe,
  ShieldCheck,
  IndianRupee,
  Truck,
  ArrowRight,
  Star,
  Loader2,
  Search,
  Factory,
  ShoppingBasket,
  Leaf,
  Users,
  Sparkles,
  PackageCheck,
} from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { formatPrice } from "../../lib/utils";
import { api } from "../../lib/api/client";
import { HarvestSections } from "../../components/customer/harvest-sections";

const modes = [
  {
    icon: MapPin,
    title: "Nearby Purchase",
    description: "Discover fresh produce from farmers around your delivery location.",
    features: ["Choose your delivery radius", "Compare local produce", "Pickup options where available"],
    cta: "Shop nearby",
    href: "/nearby",
    tone: "nearby",
  },
  {
    icon: Building2,
    title: "State Marketplace",
    description: "Explore produce from farms and suppliers across your state.",
    features: ["Browse by district", "Discover more varieties", "Compare farmer listings"],
    cta: "Explore state",
    href: "/marketplace/state",
    tone: "state",
  },
  {
    icon: Globe,
    title: "National Marketplace",
    description: "Find regional produce and products from across India.",
    features: ["Explore regional specialties", "Compare available listings", "Discover new suppliers"],
    cta: "Shop nationwide",
    href: "/marketplace/national",
    tone: "national",
  },
  {
    icon: Factory,
    title: "B2B Procurement",
    description: "Source larger quantities for restaurants, hotels and businesses.",
    features: ["Request farmer quotes", "Compare supplier offers", "Arrange recurring supply"],
    cta: "Explore procurement",
    href: "/marketplace/b2b",
    tone: "business",
  },
];

const trust = [
  {
    icon: ShieldCheck,
    title: "Know your source",
    desc: "Explore farmer and product details before choosing what to buy.",
  },
  {
    icon: IndianRupee,
    title: "Transparent pricing",
    desc: "Review listed prices and quantities before adding products to your cart.",
  },
  {
    icon: Truck,
    title: "Flexible fulfilment",
    desc: "Review the delivery and pickup options available for each listing.",
  },
];

export default function MarketplaceHubPage() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState("");
  const { data: productsData, isLoading, isError, refetch } = useQuery({
    queryKey: ["marketplaceProducts"],
    queryFn: () =>
      api.get("/products/search", {
        params: { limit: 12, sortBy: "createdAt", sortOrder: "desc" },
      }),
  });

  const latestProducts = useMemo(() => {
    const list = productsData?.data?.products || productsData?.products || [];
    return (Array.isArray(list) ? list : []).slice(0, 8).map((p: any) => ({
      id: p._id || p.id,
      name: p.name || "Fresh produce",
      farmerName: p.farmerName || "Local Farmer",
      category: p.category || "General",
      price: p.price,
      unit: p.unit || "kg",
      image: p.images?.[0] || p.image || "/images/placeholder-product.jpg",
      rating: Number(p.ratings?.average || p.rating || 0),
      isOrganic: Boolean(p.isOrganic),
    })).filter((p: any) => p.id);
  }, [productsData]);

  const categories = useMemo(
    () => Array.from(new Set(latestProducts.map((product: any) => product.category))).slice(0, 8),
    [latestProducts],
  );

  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchTerm.trim();
    router.push(query ? `/search?q=${encodeURIComponent(query)}` : "/search");
  };

  return (
    <div className="marketplace-hub-page space-y-10 px-1 pb-10 sm:space-y-12 sm:px-2">
      <section className="marketplace-hero relative px-5 py-8 sm:px-8 sm:py-10 lg:px-10 lg:py-12">
        <div className="relative z-10 max-w-3xl">
          <Badge className="mb-4 border border-emerald-200 bg-white/80 text-emerald-800 hover:bg-white">
            <Leaf className="mr-1.5 h-3.5 w-3.5" /> Farm-direct marketplace
          </Badge>
          <h1 className="max-w-2xl text-3xl font-extrabold leading-tight tracking-tight text-slate-950 sm:text-4xl lg:text-5xl">
            Fresh choices, closer to the farm.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600 sm:text-base">
            Discover produce from farmers, compare available listings and choose the way you want to shop.
          </p>

          <form onSubmit={submitSearch} className="mt-6 flex max-w-2xl flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg shadow-emerald-900/5 sm:flex-row">
            <label className="flex min-w-0 flex-1 items-center gap-3 px-3">
              <Search className="h-5 w-5 shrink-0 text-emerald-700" />
              <span className="sr-only">Search produce and products</span>
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search vegetables, fruits, grains and more"
                className="h-11 w-full min-w-0 border-0 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:ring-0"
              />
            </label>
            <Button type="submit" className="h-11 rounded-xl px-6">
              Search products <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </form>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="font-semibold text-slate-700">Popular categories:</span>
            {categories.length > 0 ? categories.map((category: string) => (
              <Link
                key={category}
                href={`/search?category=${encodeURIComponent(category)}`}
                className="rounded-full border border-emerald-100 bg-white/80 px-3 py-1.5 font-medium text-emerald-800 transition hover:border-emerald-300 hover:bg-emerald-50"
              >
                {category}
              </Link>
            )) : (
              <span className="text-slate-500">Explore the marketplace to discover available products.</span>
            )}
          </div>
        </div>
        <div className="pointer-events-none absolute -right-12 -top-12 hidden h-72 w-72 rounded-full border-[34px] border-emerald-100/50 lg:block" />
        <div className="pointer-events-none absolute bottom-5 right-12 hidden h-28 w-28 rounded-full bg-emerald-100/50 blur-2xl lg:block" />
      </section>

      <section className="space-y-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">Choose your shopping journey</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Shop the way that works for you</h2>
            <p className="mt-1 text-sm text-slate-500">From neighborhood purchases to business procurement.</p>
          </div>
        </div>
        <div className="marketplace-mode-grid">
          {modes.map((mode) => {
            const Icon = mode.icon;
            return (
              <Card key={mode.title} className="marketplace-mode-card group">
                <CardContent className="flex h-full flex-col p-5">
                  <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-2xl ${
                    mode.tone === "business" ? "bg-indigo-50 text-indigo-700" :
                    mode.tone === "national" ? "bg-sky-50 text-sky-700" :
                    mode.tone === "state" ? "bg-amber-50 text-amber-700" :
                    "bg-emerald-50 text-emerald-700"
                  }`}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3 className="text-base font-bold text-slate-950">{mode.title}</h3>
                  <p className="mt-2 min-h-12 text-sm leading-5 text-slate-600">{mode.description}</p>
                  <ul className="mt-4 flex-1 space-y-2">
                    {mode.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-xs leading-5 text-slate-500">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Button asChild variant="outline" className="mt-5 w-full justify-between rounded-xl border-slate-200 group-hover:border-emerald-300 group-hover:text-emerald-800">
                    <Link href={mode.href}>{mode.cta}<ArrowRight className="h-4 w-4" /></Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">Fresh listings</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Recently added products</h2>
            <p className="mt-1 text-sm text-slate-500">Explore the latest products listed by farmers.</p>
          </div>
          <Button asChild variant="outline" className="hidden rounded-xl sm:inline-flex">
            <Link href="/search">Browse all products <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
        </div>

        {isLoading ? (
          <div className="marketplace-product-grid">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="animate-pulse overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="aspect-[4/3] bg-slate-100" />
                <div className="space-y-2 p-4"><div className="h-3 w-1/3 rounded bg-slate-100" /><div className="h-4 w-3/4 rounded bg-slate-100" /><div className="h-4 w-1/2 rounded bg-slate-100" /></div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <Card className="rounded-2xl border-rose-200 bg-rose-50/50">
            <CardContent className="flex flex-col items-center gap-3 px-5 py-10 text-center">
              <PackageCheck className="h-9 w-9 text-rose-500" />
              <h3 className="font-semibold text-slate-900">Products could not be loaded</h3>
              <p className="max-w-md text-sm text-slate-600">Your marketplace is still available. Try loading the latest listings again.</p>
              <Button variant="outline" onClick={() => refetch()}>Retry</Button>
            </CardContent>
          </Card>
        ) : latestProducts.length === 0 ? (
          <Card className="rounded-2xl border-dashed border-slate-300">
            <CardContent className="flex flex-col items-center gap-3 px-5 py-12 text-center">
              <ShoppingBasket className="h-10 w-10 text-slate-300" />
              <h3 className="font-semibold text-slate-900">No products listed yet</h3>
              <p className="max-w-md text-sm text-slate-500">New farmer listings will appear here when products become available.</p>
              <Button asChild variant="outline"><Link href="/search">Explore search</Link></Button>
            </CardContent>
          </Card>
        ) : (
          <div className="marketplace-product-grid">
            {latestProducts.map((product: any) => (
              <Link key={product.id} href={`/product/${product.id}`} className="group block">
                <Card className="marketplace-product-card">
                  <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
                    <img
                      src={product.image}
                      alt={product.name}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    {product.isOrganic && <Badge className="absolute left-3 top-3 bg-emerald-700 text-white">Organic</Badge>}
                  </div>
                  <CardContent className="p-4">
                    <p className="text-xs font-medium text-slate-500">{product.category}</p>
                    <h3 className="mt-1 truncate text-sm font-semibold text-slate-950">{product.name}</h3>
                    <p className="mt-1 truncate text-xs text-slate-500">Sold by {product.farmerName}</p>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-emerald-800">
                        {formatPrice(product.price)}
                        <span className="ml-1 text-xs font-normal text-slate-500">/{product.unit}</span>
                      </span>
                      {product.rating > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600">
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" /> {product.rating.toFixed(1)}
                        </span>
                      )}
                    </div>
                    <span className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-3 py-2.5 text-xs font-semibold text-white transition group-hover:bg-emerald-800">
                      View product <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
        <div className="text-center sm:hidden">
          <Button asChild variant="outline" className="rounded-xl">
            <Link href="/search">Browse all products <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
        </div>
      </section>

      <Card className="overflow-hidden rounded-2xl border border-violet-100 bg-gradient-to-r from-violet-50 via-white to-fuchsia-50 shadow-sm">
        <CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <div className="max-w-2xl">
            <Badge className="mb-3 bg-violet-100 text-violet-800 hover:bg-violet-100"><Sparkles className="mr-1.5 h-3.5 w-3.5" /> Bulk and event sourcing</Badge>
            <h2 className="text-xl font-bold text-slate-950 sm:text-2xl">Planning an event or larger purchase?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Create one bulk request, receive offers from farmers and compare the options in one place.
            </p>
          </div>
          <Button asChild className="shrink-0 rounded-xl bg-violet-700 hover:bg-violet-800">
            <Link href="/bulk-orders/create">Create bulk request <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50 to-teal-50 shadow-sm">
        <CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <div className="max-w-2xl">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-emerald-700 shadow-sm"><Users className="h-5 w-5" /></div>
            <h2 className="text-xl font-bold text-slate-950 sm:text-2xl">Buy together with your community</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Explore neighborhood group buying and shared purchase opportunities.</p>
          </div>
          <Button asChild variant="outline" className="shrink-0 rounded-xl border-emerald-200 bg-white">
            <Link href="/marketplace/community">Explore group buying <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
        </CardContent>
      </Card>

      <HarvestSections />

      <section className="space-y-5 pb-4">
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">A more informed way to shop</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Shop with confidence</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {trust.map((item) => {
            const Icon = item.icon;
            return (
              <Card key={item.title} className="rounded-2xl border-slate-200 shadow-sm">
                <CardContent className="flex gap-4 p-5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-950">{item.title}</h3>
                    <p className="mt-1 text-sm leading-5 text-slate-500">{item.desc}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
