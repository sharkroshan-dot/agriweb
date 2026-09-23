"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Search, Leaf, TrendingUp, Star, Truck, Shield, Award, ArrowRight,
  ShoppingBag, Sprout, Wheat, Milk, Apple, Carrot, Sun, Cherry,
  Facebook, Twitter, Instagram, Mail, Phone, MapPin,
  Clock, Percent, Sparkles, Heart, ShoppingCart, Quote,
  PackageCheck, Store, ChefHat, Users, Eye, Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./components/ui/card";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Input } from "./components/ui/input";
import { formatPrice, cn } from "./lib/utils";
import { api } from "./lib/api/client";

const categoryIcons: Record<string, any> = {
  vegetables: Carrot,
  fruits: Apple,
  dairy: Milk,
  grains: Wheat,
  spices: Sprout,
  herbs: Leaf,
  organic: Sun,
};

const footerLinks = {
  shop: [
    { label: "All Products", href: "/search" },
    { label: "Vegetables", href: "/search?category=vegetables" },
    { label: "Fruits", href: "/search?category=fruits" },
    { label: "Dairy", href: "/search?category=dairy" },
    { label: "Organic", href: "/search?category=organic" },
  ],
  company: [
    { label: "About Us", href: "/about" },
    { label: "Our Farmers", href: "/farmers" },
    { label: "Careers", href: "/careers" },
    { label: "Blog", href: "/blog" },
  ],
  support: [
    { label: "Help Center", href: "/help" },
    { label: "Shipping Info", href: "/shipping" },
    { label: "Returns", href: "/returns" },
    { label: "Contact Us", href: "/contact" },
  ],
  legal: [
    { label: "Privacy Policy", href: "/privacy" },
    { label: "Terms of Service", href: "/terms" },
    { label: "Refund Policy", href: "/refund" },
  ],
};

export default function HomePage() {
  const [searchQuery, setSearchQuery] = useState("");

  const { data: featuredData, isLoading: featuredLoading } = useQuery({
    queryKey: ["homeProducts", "featured"],
    queryFn: () => api.get("/products/search", { params: { limit: 8, sortBy: "createdAt", sortOrder: "desc" } }),
  });

  const { data: topProductsData, isLoading: topLoading } = useQuery({
    queryKey: ["homeProducts", "top"],
    queryFn: () => api.get("/products/search", { params: { limit: 8, sortBy: "orders", sortOrder: "desc" } }),
  });

  const { data: categoriesData, isLoading: categoriesLoading } = useQuery({
    queryKey: ["homeCategories"],
    queryFn: () => api.get("/products/categories"),
  });

  // The homepage is public. Do not call the farmer-only /farmers/me
  // endpoint here; it causes 401 errors for guests and non-farmer users.
  const farmersData: any = null;
  const farmersLoading = false;

  const { data: seasonalData, isLoading: seasonalLoading } = useQuery({
    queryKey: ["homeProducts", "seasonal"],
    queryFn: () => api.get("/products/search", { params: { limit: 4, isOrganic: "true", sortBy: "createdAt", sortOrder: "desc" } }),
  });

  const featuredProducts = useMemo(() => {
    const products = featuredData?.data?.products || featuredData?.products || [];
    return products.slice(0, 8).map((p: any) => ({
      id: p._id || p.id,
      name: p.name || "Fresh Produce",
      farmer: p.farmerName || "Local Farmer",
      price: p.price,
      originalPrice: p.originalPrice || p.mrp || null,
      unit: p.unit || "kg",
      rating: p.ratings?.average || p.rating || 4.5,
      reviews: p.ratings?.count || p.reviews || 0,
      image: p.images?.[0] || "/images/placeholder-product.jpg",
      discount: p.discount || (p.originalPrice ? Math.round((1 - (p.price ?? 0) / p.originalPrice) * 100) : 0),
    }));
  }, [featuredData]);

  const topProducts = useMemo(() => {
    const products = topProductsData?.data?.products || topProductsData?.products || [];
    return products.slice(0, 8).map((p: any) => ({
      id: p._id || p.id,
      name: p.name || "Fresh Produce",
      farmer: p.farmerName || "Local Farmer",
      price: p.price,
      originalPrice: p.originalPrice || null,
      unit: p.unit || "kg",
      rating: p.ratings?.average || p.rating || 4.5,
      reviews: p.ratings?.count || p.reviews || 0,
      image: p.images?.[0] || "/images/placeholder-product.jpg",
      orders: p.totalOrders || p.orders || 0,
    }));
  }, [topProductsData]);

  const apiCategories = useMemo(() => {
    const cats = Array.isArray(categoriesData)
      ? categoriesData
      : categoriesData?.data?.categories || categoriesData?.categories || [];
    return cats.map((c: any) => ({
      name: c.name || c,
      slug: (c.slug || (typeof c === "string" ? c.toLowerCase() : "")),
      icon: categoryIcons[(c.name || c).toLowerCase()] || Leaf,
      productCount: c.productCount || c.count || 0,
    }));
  }, [categoriesData]);

  const farmerStories = useMemo(() => {
    const farmers = farmersData?.data?.farmers || farmersData?.farmers || [];
    return farmers.slice(0, 3).map((f: any) => ({
      id: f._id || f.id,
      name: f.name || f.farmerName || "Local Farmer",
      farm: f.farmName || f.farm || "Family Farm",
      location: f.location || f.address || "India",
      story: f.bio || f.story || "Dedicated to providing fresh, organic produce to communities.",
      image: f.image || f.profileImage || "/images/farmer-1.svg",
      rating: f.rating || 4.5,
      products: f.productCount || f.products || 0,
    }));
  }, [farmersData]);

  const seasonalProducts = useMemo(() => {
    const products = seasonalData?.data?.products || seasonalData?.products || [];
    return products.slice(0, 4).map((p: any) => ({
      id: p._id || p.id,
      name: p.name || "Seasonal Produce",
      price: p.price,
      originalPrice: p.originalPrice || p.mrp || null,
      unit: p.unit || "kg",
      image: p.images?.[0] || "/images/placeholder-product.jpg",
      season: p.season || "Seasonal",
    }));
  }, [seasonalData]);

  const renderStars = (rating: number) => (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn(
            "h-3.5 w-3.5",
            i < Math.floor(rating) ? "fill-amber-400 text-amber-400" : "fill-slate-200 text-slate-200",
          )}
        />
      ))}
    </div>
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      window.location.href = `/search?q=${encodeURIComponent(searchQuery.trim())}`;
    }
  };

  return (
    <div className="min-h-screen bg-transparent text-slate-900">
      {/* Hero Banner */}
      <section className="relative overflow-hidden bg-gradient-to-br from-emerald-900 via-emerald-800 to-green-900">
        <div className="absolute inset-0 bg-[url('/images/hero-pattern.svg')] opacity-10" />
        <div className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="absolute -bottom-32 -left-32 h-80 w-80 rounded-full bg-green-500/20 blur-3xl" />
        <div className="relative mx-auto max-w-[1440px] px-4 py-16 sm:px-6 sm:py-20 lg:px-10 lg:py-28">
          <div className="grid items-center gap-10 lg:grid-cols-[1.15fr_.85fr]">
            <div className="space-y-7">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-4 py-1.5 text-sm font-medium text-emerald-200 backdrop-blur-sm">
                <Sparkles className="h-4 w-4 text-emerald-300" />
                India&apos;s Trusted Farm-to-Home Marketplace
              </div>
              <div className="space-y-6">
                <h1 className="text-4xl font-extrabold leading-[1.05] tracking-[-.04em] text-white sm:text-5xl lg:text-7xl">
                  Fresh from the Farm.
                  <br />
                  <span className="bg-gradient-to-r from-emerald-200 to-green-300 bg-clip-text text-transparent">Fair for Everyone.</span>
                </h1>
                <p className="max-w-xl text-lg leading-relaxed text-emerald-100/80">
                  Connect directly with local farmers, discover fresh organic produce, and enjoy fair prices delivered to your doorstep.
                </p>
              </div>
              <div className="flex flex-wrap gap-4">
                <Link href="/marketplace">
                  <Button size="lg" className="gap-2 bg-white text-emerald-900 hover:bg-emerald-50 shadow-lg shadow-emerald-900/20">
                    <ShoppingBag className="h-5 w-5" />
                    Start Shopping
                  </Button>
                </Link>
                <Link href="/register?role=farmer">
                  <Button size="lg" variant="outline" className="gap-2 border-emerald-400/40 text-white hover:bg-emerald-700/50">
                    <Sprout className="h-5 w-5" />
                    Become a Farmer
                  </Button>
                </Link>
                <Link href="/register?role=business">
                  <Button size="lg" variant="outline" className="gap-2 border-emerald-400/40 text-white hover:bg-emerald-700/50">
                    <Store className="h-5 w-5" />
                    Business Procurement
                  </Button>
                </Link>
              </div>
              <div className="flex flex-wrap items-center gap-6 text-sm text-emerald-200/70">
                <div className="flex items-center gap-2">
                  <Truck className="h-4 w-4" />
                  Free delivery on first order
                </div>
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  100% fresh guarantee
                </div>
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  5,000+ happy customers
                </div>
              </div>
            </div>
            <div className="hidden lg:block">
              <div className="relative">
                <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-emerald-400/20 to-green-400/10 blur-xl" />
                <div className="relative grid grid-cols-2 gap-4">
                  {["Vegetables", "Fruits", "Grains", "Organic"].map((item, i) => (
                    <div
                      key={item}
                      className={cn(
                        "group rounded-2xl border border-emerald-400/20 bg-white/5 p-5 backdrop-blur-sm transition hover:bg-white/10 hover:border-emerald-400/40",
                        i === 0 && "col-span-2",
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "flex h-10 w-10 items-center justify-center rounded-xl",
                          i === 0 ? "bg-emerald-400/20 text-emerald-300" : "bg-white/10 text-emerald-200",
                        )}>
                          {i === 0 ? <ShoppingBag className="h-5 w-5" /> :
                           i === 1 ? <Apple className="h-5 w-5" /> :
                           i === 2 ? <Wheat className="h-5 w-5" /> :
                           <Leaf className="h-5 w-5" />}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-white">{item}</p>
                          <p className="text-xs text-emerald-200/60">
                            {i === 0 ? "Farm-fresh & organic" : "Direct from farms"}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="h-2 bg-gradient-to-r from-emerald-600 via-green-500 to-emerald-400" />
      </section>

      <section className="border-b border-slate-200 bg-slate-50/80 py-12">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mb-8 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-700">How it works</p>
            <h2 className="mt-3 text-3xl font-bold text-slate-900">Simple, transparent, and farmer-first</h2>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {[
              { icon: Search, title: 'Browse the market', text: 'Find seasonal produce, trusted sellers, and local farm stories in a few taps.' },
              { icon: Truck, title: 'Order with confidence', text: 'Track every step from harvest to delivery with clear updates and transparent pricing.' },
              { icon: Heart, title: 'Enjoy freshness', text: 'Receive quality produce that arrives ready to cook, share, and savor.' },
            ].map((step, index) => (
              <div key={step.title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm shadow-slate-200/60">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                  <step.icon className="h-5 w-5" />
                </div>
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-emerald-700">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-xs">0{index + 1}</span>
                  Step {index + 1}
                </div>
                <h3 className="text-xl font-semibold text-slate-900">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{step.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Search Bar */}
      <section className="relative -mt-8 mb-12 px-6">
        <div className="mx-auto max-w-3xl">
          <form onSubmit={handleSearch} className="relative">
            <div className="relative flex items-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5 transition-shadow focus-within:shadow-emerald-200/50 focus-within:ring-2 focus-within:ring-emerald-500/20">
              <div className="flex items-center gap-2 pl-5 pr-3">
                <Search className="h-5 w-5 text-slate-400" />
                <span className="h-5 w-px bg-slate-200" />
              </div>
              <Input
                type="text"
                placeholder="Search for fresh vegetables, fruits, dairy & more..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-14 border-0 bg-transparent pl-0 text-base text-slate-900 placeholder:text-slate-400 focus:ring-0 focus:outline-none"
              />
              <div className="pr-2">
                <Button type="submit" size="lg" className="h-11 rounded-xl px-6">
                  <Search className="mr-2 h-4 w-4" />
                  Search
                </Button>
              </div>
            </div>
          </form>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-12 lg:px-8">
        <div className="mb-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-700">Why choose us</p>
          <h2 className="mt-3 text-3xl font-bold text-slate-900">Freshness, trust, and convenience built in</h2>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {[
            { icon: Leaf, title: 'Locally sourced', text: 'Handpicked produce from trusted farms and growers near you.' },
            { icon: Shield, title: 'Transparent quality', text: 'Verified quality checks and honest pricing with no hidden surprises.' },
            { icon: Truck, title: 'Fast delivery', text: 'Reliable doorstep delivery with live updates from dispatch to arrival.' },
          ].map((feature) => (
            <div key={feature.title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm shadow-slate-200/70 transition hover:-translate-y-1 hover:shadow-lg hover:shadow-emerald-100/50">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                <feature.icon className="h-5 w-5" />
              </div>
              <h3 className="text-xl font-semibold text-slate-900">{feature.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{feature.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Categories */}
      <section className="mx-auto max-w-7xl px-6 pb-16 lg:px-8">
        <div className="mb-10 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Shop by Category</h2>
            <p className="mt-2 text-slate-500">Explore fresh produce from local farms</p>
          </div>
          <Link
            href="/search"
            className="hidden items-center gap-1 text-sm font-medium text-emerald-600 transition hover:text-emerald-700 sm:flex"
          >
            View All Categories
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        {categoriesLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          </div>
        ) : apiCategories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Leaf className="mb-4 h-12 w-12 text-slate-300" />
            <h3 className="text-lg font-semibold text-slate-900">No categories available</h3>
            <p className="mt-2 text-sm text-slate-500">Categories will appear here once added.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
            {apiCategories.map((cat: any) => {
              const CatIcon = cat.icon || Leaf;
              return (
                <Link key={cat.slug} href={`/search?category=${cat.slug}`} className="group">
                  <Card className="h-full transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-emerald-100/50">
                    <CardContent className="flex flex-col items-center p-5 text-center">
                      <div className={cn(
                        "mb-3 flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br transition-transform duration-300 group-hover:scale-110",
                        cat.color || "from-emerald-400 to-green-500",
                      )}>
                        <CatIcon className="h-7 w-7 text-white" />
                      </div>
                      <h3 className="text-sm font-semibold text-slate-900">{cat.name}</h3>
                      <p className="mt-0.5 text-xs text-slate-400">{cat.productCount ? `${cat.productCount} products` : ""}</p>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Today's Offers */}
      <section className="bg-gradient-to-br from-emerald-50 via-white to-green-50 py-16">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mb-10 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-red-100 p-2">
                  <Percent className="h-5 w-5 text-red-500" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Today&apos;s Offers</h2>
              </div>
              <p className="mt-2 text-slate-500">Limited time deals on fresh produce</p>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Clock className="h-4 w-4" />
              <span>Ends in 12h 30m</span>
            </div>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {featuredLoading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i} className="animate-pulse overflow-hidden">
                    <div className="aspect-[4/3] bg-slate-200" />
                    <CardContent className="space-y-3 p-4">
                      <div className="h-4 w-2/3 rounded bg-slate-200" />
                      <div className="h-3 w-1/2 rounded bg-slate-200" />
                      <div className="h-5 w-1/3 rounded bg-slate-200" />
                    </CardContent>
                  </Card>
                ))
              : featuredProducts.length > 0
                ? featuredProducts.map((product: any) => (
                    <Link key={product.id} href={`/product/${product.id}`} className="group">
                      <Card className="h-full overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-100/30">
                        <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
                          <img
                            src={product.image || "/images/placeholder-product.jpg"}
                            alt={product.name}
                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                            onError={(e) => { (e.target as HTMLImageElement).src = "/images/placeholder-product.jpg"; }}
                          />
                          {product.discount > 0 && (
                            <div className="absolute top-3 left-3">
                              <Badge variant="destructive" className="px-2.5 py-1 text-xs font-bold shadow-lg">
                                -{product.discount}%
                              </Badge>
                            </div>
                          )}
                          <button className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-slate-600 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 hover:bg-white hover:text-red-500">
                            <Heart className="h-4 w-4" />
                          </button>
                        </div>
                        <CardContent className="p-4">
                          <p className="truncate text-sm font-medium text-slate-500">{product.farmer}</p>
                          <h3 className="mt-0.5 truncate text-base font-semibold text-slate-900">{product.name}</h3>
                          <div className="mt-2 flex items-center justify-between">
                            <div className="flex items-baseline gap-2">
                              <span className="text-lg font-bold text-emerald-700">{formatPrice(product.price)}</span>
                              {product.originalPrice && (
                                <span className="text-sm text-slate-400 line-through">{formatPrice(product.originalPrice)}</span>
                              )}
                              <span className="text-xs text-slate-400">/{product.unit}</span>
                            </div>
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            {renderStars(product.rating)}
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  ))
                : (
                  <div className="col-span-full flex flex-col items-center justify-center py-16 text-center">
                    <Percent className="mb-4 h-12 w-12 text-slate-300" />
                    <h3 className="text-lg font-semibold text-slate-900">No offers available today</h3>
                    <p className="mt-2 text-sm text-slate-500">Check back later for new deals on fresh produce.</p>
                  </div>
                )}
          </div>
          <div className="mt-8 text-center">
            <Link href="/search?sortBy=createdAt&sortOrder=desc">
              <Button variant="outline" className="gap-2">
                View All Offers
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Top Products */}
      <section className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
        <div className="mb-10 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-amber-100 p-2">
                <TrendingUp className="h-5 w-5 text-amber-600" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Top Products</h2>
            </div>
            <p className="mt-2 text-slate-500">Best-selling items loved by our community</p>
          </div>
          <Link href="/search?sortBy=orders&sortOrder=desc" className="hidden items-center gap-1 text-sm font-medium text-emerald-600 transition hover:text-emerald-700 sm:flex">
            View All
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {topLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="animate-pulse overflow-hidden">
                  <div className="aspect-[4/3] bg-slate-200" />
                  <CardContent className="space-y-3 p-4">
                    <div className="h-4 w-2/3 rounded bg-slate-200" />
                    <div className="h-3 w-1/2 rounded bg-slate-200" />
                    <div className="h-5 w-1/3 rounded bg-slate-200" />
                  </CardContent>
                </Card>
              ))
            : topProducts.length > 0
              ? topProducts.map((product: any) => (
                  <Link key={product.id} href={`/product/${product.id}`} className="group">
                    <Card className="h-full overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-100/30">
                      <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
                        <img
                          src={product.image || "/images/placeholder-product.jpg"}
                          alt={product.name}
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                          onError={(e) => { (e.target as HTMLImageElement).src = "/images/placeholder-product.jpg"; }}
                        />
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/40 to-transparent p-4 pt-12">
                          <Badge variant="secondary" className="bg-white/90 text-slate-700 backdrop-blur-sm">
                            <ShoppingCart className="mr-1 h-3 w-3" />
                            {product.orders} sold
                          </Badge>
                        </div>
                      </div>
                      <CardContent className="p-4">
                        <p className="truncate text-sm font-medium text-slate-500">{product.farmer}</p>
                        <h3 className="mt-0.5 truncate text-base font-semibold text-slate-900">{product.name}</h3>
                        <div className="mt-2 flex items-baseline gap-2">
                          <span className="text-lg font-bold text-emerald-700">{formatPrice(product.price)}</span>
                          <span className="text-xs text-slate-400">/{product.unit}</span>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          {renderStars(product.rating)}
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))
              : (
                <div className="col-span-full flex flex-col items-center justify-center py-16 text-center">
                  <TrendingUp className="mb-4 h-12 w-12 text-slate-300" />
                  <h3 className="text-lg font-semibold text-slate-900">No top products yet</h3>
                  <p className="mt-2 text-sm text-slate-500">Popular items will appear here as orders come in.</p>
                </div>
              )}
        </div>
      </section>

      {/* Seasonal Products */}
      <section className="bg-gradient-to-br from-orange-50 via-white to-amber-50 py-16">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mb-10 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-orange-100 p-2">
                  <Sun className="h-5 w-5 text-orange-500" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Seasonal Picks</h2>
              </div>
              <p className="mt-2 text-slate-500">Fresh harvest available only this season</p>
            </div>
            <Link href="/search?sortBy=createdAt&sortOrder=desc" className="items-center gap-1 text-sm font-medium text-emerald-600 transition hover:text-emerald-700 sm:flex">
              Explore Seasonal
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {seasonalLoading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i} className="animate-pulse overflow-hidden">
                    <div className="aspect-[4/3] bg-slate-200" />
                    <CardContent className="space-y-3 p-4">
                      <div className="h-4 w-2/3 rounded bg-slate-200" />
                      <div className="h-3 w-1/2 rounded bg-slate-200" />
                      <div className="h-5 w-1/3 rounded bg-slate-200" />
                    </CardContent>
                  </Card>
                ))
              : seasonalProducts.length > 0
                ? seasonalProducts.map((product: any) => (
                    <Link key={product.id} href={`/product/${product.id}`} className="group">
                      <Card className="relative h-full overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-orange-100/30">
                        <div className="absolute inset-0 bg-gradient-to-br from-orange-400/10 to-amber-400/10 opacity-0 transition-opacity group-hover:opacity-100" />
                        <div className="relative aspect-[4/3] overflow-hidden bg-gradient-to-br from-orange-100 to-amber-50">
                          <img
                            src={product.image || "/images/placeholder-product.jpg"}
                            alt={product.name}
                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                            onError={(e) => { (e.target as HTMLImageElement).src = "/images/placeholder-product.jpg"; }}
                          />
                          {product.originalPrice && (
                            <div className="absolute top-3 left-3">
                              <Badge variant="warning" className="px-3 py-1 shadow-lg">
                                {product.season}
                              </Badge>
                            </div>
                          )}
                        </div>
                        <CardContent className="relative p-4">
                          <h3 className="text-base font-semibold text-slate-900">{product.name}</h3>
                          <div className="mt-2 flex items-baseline gap-2">
                            <span className="text-lg font-bold text-emerald-700">{formatPrice(product.price)}</span>
                            {product.originalPrice && (
                              <span className="text-sm text-slate-400 line-through">{formatPrice(product.originalPrice)}</span>
                            )}
                            <span className="text-xs text-slate-400">/{product.unit}</span>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  ))
                : (
                  <div className="col-span-full flex flex-col items-center justify-center py-16 text-center">
                    <Sun className="mb-4 h-12 w-12 text-slate-300" />
                    <h3 className="text-lg font-semibold text-slate-900">No seasonal products</h3>
                    <p className="mt-2 text-sm text-slate-500">Seasonal picks will be available soon.</p>
                  </div>
                )}
          </div>
        </div>
      </section>

      {/* Farmer Stories */}
      <section className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
        <div className="mb-10 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-1.5 text-sm font-medium text-emerald-700">
            <Users className="h-4 w-4" />
            Meet Our Farmers
          </div>
          <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Stories from the Heart of India</h2>
          <p className="mt-2 text-slate-500">Know the people behind your food</p>
        </div>
        {farmersLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          </div>
        ) : farmerStories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="mb-4 h-12 w-12 text-slate-300" />
            <h3 className="text-lg font-semibold text-slate-900">No farmer stories available</h3>
            <p className="mt-2 text-sm text-slate-500">Stories from our farmers will appear here once they start sharing.</p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-3">
            {farmerStories.map((farmer: any) => (
              <Card key={farmer.id} className="group overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-100/20">
                <div className="relative h-48 overflow-hidden bg-gradient-to-br from-emerald-200 to-green-100">
                  <img
                    src={farmer.image || "/images/farmer-1.svg"}
                    alt={farmer.name}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    onError={(e) => { (e.target as HTMLImageElement).src = "/images/farmer-1.svg"; }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                  <div className="absolute bottom-3 left-4 right-4">
                    <div className="flex items-center gap-2">
                      <div className="rounded-full bg-white/90 p-1">
                        <Quote className="h-3 w-3 text-emerald-700" />
                      </div>
                      <span className="text-xs font-medium text-white/90">{farmer.location}</span>
                    </div>
                  </div>
                </div>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">{farmer.name}</h3>
                      <p className="text-sm text-emerald-600">{farmer.farm}</p>
                    </div>
                    <div className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                      {farmer.rating}
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-slate-600 line-clamp-3">{farmer.story}</p>
                  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
                    <span className="text-xs text-slate-400">{farmer.products} products listed</span>
                    <Link
                      href={`/search?farmer=${farmer.id}`}
                      className="flex items-center gap-1 text-sm font-medium text-emerald-600 transition hover:text-emerald-700"
                    >
                      View Products
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Trust Badges */}
      <section className="border-y border-slate-100 bg-slate-50/50 py-12">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Truck, title: "Free Delivery", desc: "On your first order above Rs 499" },
              { icon: Shield, title: "Fresh Guarantee", desc: "100% satisfaction or money back" },
              { icon: Award, title: "Premium Quality", desc: "Handpicked from local farms" },
              { icon: PackageCheck, title: "Easy Returns", desc: "Return within 24 hours of delivery" },
            ].map((item) => (
              <div key={item.title} className="flex items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-100">
                  <item.icon className="h-6 w-6 text-emerald-600" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">{item.title}</h4>
                  <p className="text-xs text-slate-500">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Banner */}
      <section className="bg-gradient-to-r from-emerald-800 via-emerald-700 to-green-800 py-16">
        <div className="mx-auto max-w-4xl px-6 text-center lg:px-8">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">Ready to Taste the Freshness?</h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-emerald-100/80">
            Join thousands of happy customers who enjoy farm-fresh produce delivered to their doorstep every week.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link href="/marketplace">
              <Button size="lg" className="gap-2 bg-white text-emerald-900 hover:bg-emerald-50 shadow-lg shadow-emerald-900/20">
                <ShoppingCart className="h-5 w-5" />
                Start Shopping Now
              </Button>
            </Link>
            <Link href="/search">
              <Button size="lg" variant="outline" className="gap-2 border-emerald-400/40 text-white hover:bg-emerald-700/50">
                <Eye className="h-5 w-5" />
                Browse Products
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-300">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <div className="flex items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500">
                  <Sprout className="h-6 w-6 text-white" />
                </div>
                <span className="text-xl font-bold text-white">Farm2Home</span>
              </div>
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-400">
                India&apos;s premier farm-to-home marketplace connecting you directly with local farmers for the freshest produce at fair prices.
              </p>
              <div className="mt-6 flex gap-3">
                {[Facebook, Twitter, Instagram, Mail].map((Icon, i) => (
                  <a
                    key={i}
                    href="#"
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-slate-400 transition hover:bg-emerald-600 hover:text-white"
                  >
                    <Icon className="h-4 w-4" />
                  </a>
                ))}
              </div>
            </div>
            {[
              { title: "Shop", links: footerLinks.shop },
              { title: "Company", links: footerLinks.company },
              { title: "Support", links: footerLinks.support },
            ].map((group) => (
              <div key={group.title}>
                <h4 className="mb-4 text-sm font-semibold uppercase tracking-wider text-white">{group.title}</h4>
                <ul className="space-y-3">
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <Link href={link.href} className="text-sm text-slate-400 transition hover:text-emerald-400">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-12 border-t border-slate-800 pt-8">
            <div className="flex flex-col items-center justify-between gap-4 lg:flex-row">
              <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500">
                <div className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  Bangalore, Karnataka, India
                </div>
                <div className="flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5" />
                  +91 1800-123-4567
                </div>
                <div className="flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" />
                  hello@farm2home.in
                </div>
              </div>
              <p className="text-sm text-slate-600">
                &copy; {new Date().getFullYear()} Farm2Home. All rights reserved.
              </p>
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-4 text-xs text-slate-600 lg:justify-start">
              {footerLinks.legal.map((link) => (
                <Link key={link.label} href={link.href} className="transition hover:text-slate-400">
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
