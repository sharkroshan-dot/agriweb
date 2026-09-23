"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Building2, Globe, ShieldCheck, IndianRupee, Truck, ArrowRight, Star, Loader2, Eye, Factory, ClipboardList, Layers, Briefcase } from "lucide-react";
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
    description: "Buy from farmers in your neighborhood",
    features: ["2km radius", "5km radius", "10km radius", "20km radius", "50km radius"],
    cta: "Shop Nearby",
    href: "/nearby",
    gradient: "from-emerald-500 to-emerald-700",
  },
  {
    icon: Building2,
    title: "State Marketplace",
    description: "Buy from any district in your state",
    features: ["Fresh produce from across the state", "Wide variety of products", "Support local farmers"],
    cta: "Explore State",
    href: "/marketplace/state",
    gradient: "from-teal-500 to-teal-700",
  },
  {
    icon: Globe,
    title: "National Marketplace",
    description: "Premium products from across India",
    features: ["Kashmir Apples", "Punjab Wheat", "Nagpur Oranges", "Kerala Spices", "Assam Tea"],
    cta: "Shop Nationwide",
    href: "/marketplace/national",
    gradient: "from-green-500 to-green-700",
  },
  {
    icon: Factory,
    title: "B2B Procurement",
    description: "Bulk sourcing for restaurants, hotels & businesses",
    features: ["Wholesale pricing", "Contract farming options", "Regular delivery schedules", "Quality assurance", "GST invoicing"],
    cta: "Explore B2B",
    href: "/marketplace/b2b",
    gradient: "from-indigo-500 to-indigo-700",
  },
];

const trust = [
  {
    icon: ShieldCheck,
    title: "Freshness Guaranteed",
    desc: "Farm-fresh produce delivered directly to your doorstep within 24 hours of harvest.",
  },
  {
    icon: IndianRupee,
    title: "Fair Prices for Farmers",
    desc: "We ensure farmers get fair market prices with no middlemen, helping rural communities thrive.",
  },
  {
    icon: Truck,
    title: "Free Delivery Above Rs 299",
    desc: "Free delivery on all orders above Rs 299. Same-day delivery available in select areas.",
  },
];

export default function MarketplaceHubPage() {
  const { data: productsData, isLoading } = useQuery({
    queryKey: ["marketplaceProducts"],
    queryFn: () =>
      api.get("/products/search", {
        params: { limit: 8, sortBy: "createdAt", sortOrder: "desc" },
      }),
  });

  const latestProducts = useMemo(() => {
    const list = productsData?.data?.products || [];
    return list.slice(0, 4).map((p: any) => ({
      id: p._id || p.id,
      name: p.name || "Unknown",
      farmerName: p.farmerName || "Local Farmer",
      category: p.category || "General",
      price: p.price,
      unit: p.unit || "kg",
      image: p.images?.[0] || "/images/placeholder-product.jpg",
      rating: p.ratings?.average || 4.5,
      isOrganic: p.isOrganic || false,
    }));
  }, [productsData]);

  return (
    <div className="space-y-16 p-6">
      {/* Header */}
      <div className="space-y-2 pt-4">
        <h1 className="text-3xl font-bold text-slate-900">Marketplace</h1>
        <p className="text-base text-slate-500">Choose how you want to shop</p>
      </div>

      {/* Mode cards */}
      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
        {modes.map((mode) => {
          const Icon = mode.icon;
          return (
            <Card
              key={mode.title}
              className="group relative overflow-hidden border-0 p-0 shadow-lg transition-all hover:shadow-xl"
            >
              <div className={`bg-gradient-to-br ${mode.gradient} p-8 text-white`}>
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
                  <Icon className="h-7 w-7" />
                </div>
                <h2 className="mb-2 text-xl font-bold">{mode.title}</h2>
                <p className="text-sm text-white/80">{mode.description}</p>
              </div>
              <CardContent className="space-y-4 p-6">
                <ul className="space-y-2">
                  {mode.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-slate-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button asChild className="w-full">
                  <Link href={mode.href}>
                    {mode.cta}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Bulk / Event banner */}
      <Card className="border-purple-100 bg-gradient-to-r from-purple-50 to-violet-50 p-0 shadow-md">
        <CardContent className="flex flex-col items-center gap-6 p-8 text-center md:flex-row md:text-left">
          <div className="flex-1 space-y-3">
            <h2 className="text-2xl font-bold text-slate-900">🎉 Planning an event?</h2>
            <p className="text-slate-600">
              Need large quantities for a wedding, function, festival or party? Create a bulk request,
              get quotes from nearby farmers, and pick the best offer — no need to search farmers one by one.
            </p>
            <Button asChild size="lg" className="bg-purple-600 hover:bg-purple-700">
              <Link href="/bulk-orders/create">
                Create Bulk Order
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
          <div className="flex shrink-0 gap-2">
            {["🎉", "👰", "🧑‍🤝‍🧑", "🎊"].map((e, i) => (
              <span
                key={i}
                className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-lg shadow-sm"
              >
                {e}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Latest Products */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Latest Products</h2>
            <p className="mt-1 text-slate-500">Fresh from the farm, straight to you</p>
          </div>
          <Button asChild variant="outline" className="hidden sm:inline-flex">
            <Link href="/search">
              Browse All
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          </div>
        ) : latestProducts.length === 0 ? (
          <Card className="p-12 text-center">
            <Eye className="mx-auto h-12 w-12 text-slate-300" />
            <h3 className="mt-4 text-lg font-semibold text-slate-900">No products yet</h3>
            <p className="mt-2 text-sm text-slate-500">
              Products will appear here once farmers start listing them.
            </p>
          </Card>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {latestProducts.map((product: any) => (
              <Link key={product.id} href={`/product/${product.id}`} className="group">
                <Card className="overflow-hidden border-slate-200 transition-all hover:border-emerald-300 hover:shadow-md">
                  <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
                    <img
                      src={product.image}
                      alt={product.name}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    {product.isOrganic && (
                      <Badge className="absolute left-2 top-2 bg-emerald-600 text-xs text-white">Organic</Badge>
                    )}
                  </div>
                  <CardContent className="p-4">
                    <p className="text-xs text-slate-400">{product.category}</p>
                    <h3 className="mt-0.5 truncate text-sm font-semibold text-slate-900">{product.name}</h3>
                    <p className="mt-0.5 text-xs text-slate-500">{product.farmerName}</p>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-sm font-bold text-emerald-700">
                        {formatPrice(product.price)}
                        <span className="ml-0.5 text-xs font-normal text-slate-400">/{product.unit}</span>
                      </span>
                      <span className="flex items-center gap-1 text-xs text-slate-500">
                        <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                        {product.rating.toFixed(1)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}

        <div className="text-center sm:hidden">
          <Button asChild variant="outline">
            <Link href="/search">
              Browse All Products
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      {/* Community card */}
      <Card className="border-emerald-100 bg-gradient-to-r from-emerald-50 to-teal-50 p-0 shadow-md">
        <CardContent className="flex flex-col items-center gap-6 p-8 text-center md:flex-row md:text-left">
          <div className="flex-1 space-y-3">
            <h2 className="text-2xl font-bold text-slate-900">Community Group Buying</h2>
            <p className="text-slate-600">
              Join neighborhood group buys to get fresh produce at bulk prices. Team up with
              neighbours, split orders, and save more!
            </p>
            <Button asChild size="lg">
              <Link href="/marketplace/community">
                Explore Group Buys
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
          <div className="flex shrink-0 gap-2">
            <div className="flex -space-x-3">
              {["👨‍🌾", "👩‍🌾", "🧑‍🌾", "👨‍🌾"].map((e, i) => (
                <span
                  key={i}
                  className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-lg shadow-sm"
                >
                  {e}
                </span>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Harvest sections */}
      <HarvestSections />

      {/* Trust section */}
      <div className="space-y-6 pb-8">
        <h2 className="text-center text-2xl font-bold text-slate-900">
          Why choose our marketplace?
        </h2>
        <div className="grid gap-6 md:grid-cols-3">
          {trust.map((item) => {
            const Icon = item.icon;
            return (
              <Card key={item.title} className="border-0 bg-white/60 text-center shadow-sm">
                <CardContent className="space-y-3 p-6">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100">
                    <Icon className="h-6 w-6 text-emerald-700" />
                  </div>
                  <h3 className="font-semibold text-slate-900">{item.title}</h3>
                  <p className="text-sm text-slate-500">{item.desc}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
