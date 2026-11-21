"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  Edit,
  Trash2,
  Share2,
  Star,
  Package,
  MapPin,
  CalendarDays,
  Leaf,
  CheckCircle2,
  Boxes,
  Sprout,
  Warehouse,
  Info,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../../components/ui/card";
import { Button } from "../../../../components/ui/button";
import { Badge } from "../../../../components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../../../../components/ui/dialog";
import { api } from "../../../../lib/api/client";
import { formatPrice } from "../../../../lib/utils";
import toast from "react-hot-toast";

function formatProductDate(value: any) {
  if (!value) return "Not specified";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not specified"
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function DetailItem({ icon: Icon, label, value }: { icon: any; label: string; value: any }) {
  const displayValue = value === null || value === undefined || value === "" ? "Not specified" : value;
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-xl border border-slate-200 bg-white p-3.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="mt-1 break-words text-sm font-semibold text-slate-800">{displayValue}</p>
      </div>
    </div>
  );
}

export default function ProductDetailPage() {
  const router = useRouter();
  const params = useParams();
  const productId = params?.id as string;
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken as string | undefined;
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  const {
    data: productData,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["farmerProduct", productId],
    queryFn: () => api.get(`/products/${encodeURIComponent(productId)}`),
    enabled: Boolean(accessToken && productId),
    retry: 1,
  });

  const product = productData?.data?.product || productData?.data || productData;

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await api.delete(`/products/${encodeURIComponent(productId)}`);
      toast.success("Product deleted successfully");
      router.push("/farmer/products");
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || error?.message || "Failed to delete product");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleEdit = () => router.push(`/farmer/products/${encodeURIComponent(productId)}/edit`);

  const handleShare = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: product?.name || "AgriConnect product", url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success("Product link copied");
      }
    } catch (error: any) {
      if (error?.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Product link copied");
      } catch {
        toast.error("Unable to share this product from your browser");
      }
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge variant="success">Active listing</Badge>;
      case "inactive":
        return <Badge variant="secondary">Inactive</Badge>;
      case "out_of_stock":
        return <Badge variant="destructive">Out of stock</Badge>;
      case "pending_review":
        return <Badge variant="warning">Pending review</Badge>;
      default:
        return <Badge variant="outline">{String(status || "Unknown").replace(/_/g, " ")}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="farmer-product-detail-page w-full max-w-none space-y-5 pb-8">
        <div className="h-5 w-32 animate-pulse rounded bg-slate-200" />
        <div className="h-28 animate-pulse rounded-2xl bg-slate-200" />
        <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
          <div className="h-[430px] animate-pulse rounded-2xl bg-slate-200" />
          <div className="h-[430px] animate-pulse rounded-2xl bg-slate-200" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-3xl py-10">
        <Button asChild variant="ghost" className="mb-5">
          <Link href="/farmer/products"><ArrowLeft className="mr-2 h-4 w-4" />Back to products</Link>
        </Button>
        <Card className="border-red-200">
          <CardContent className="flex flex-col items-center p-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600"><Info className="h-6 w-6" /></span>
            <h2 className="mt-4 text-lg font-semibold text-slate-900">We couldn't load this product</h2>
            <p className="mt-2 max-w-md text-sm text-slate-500">{(error as any)?.message || "Check your connection and try again."}</p>
            <Button className="mt-5" onClick={() => refetch()}>Try again</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!product || typeof product !== "object") {
    return (
      <div className="mx-auto max-w-3xl py-10">
        <Button asChild variant="ghost" className="mb-5">
          <Link href="/farmer/products"><ArrowLeft className="mr-2 h-4 w-4" />Back to products</Link>
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center p-10 text-center">
            <Package className="h-11 w-11 text-slate-300" />
            <h2 className="mt-4 text-lg font-semibold text-slate-900">Product not found</h2>
            <p className="mt-2 text-sm text-slate-500">This product may have been removed or is no longer available.</p>
            <Button asChild className="mt-5"><Link href="/farmer/products">Return to products</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const productImages = Array.isArray(product.images) ? product.images.filter((image: any) => typeof image === "string" && image.trim()) : [];
  const activeImage = productImages[Math.min(activeImageIndex, Math.max(productImages.length - 1, 0))];
  const unit = product.unit || "kg";
  const category = typeof product.category === "string"
    ? product.category
    : product.category?.name || product.categoryName || product.categoryId || "Uncategorized";
  const totalStock = Math.max(0, Number(product.totalStock ?? product.quantity ?? 0));
  const reservedStock = Math.max(0, Number(product.reservedQuantity ?? 0));
  const availableStock = Math.max(0, Number(product.availableQuantity ?? product.quantity ?? 0));
  const rating = Number(product.ratings?.average || 0);
  const ratingCount = Number(product.ratings?.count || product.ratings?.total || 0);
  const coords = product.location?.coordinates;
  const hasCoordinates = Array.isArray(coords) && coords.length >= 2
    && Number.isFinite(Number(coords[0])) && Number.isFinite(Number(coords[1]));
  const longitude = hasCoordinates ? Number(coords[0]) : null;
  const latitude = hasCoordinates ? Number(coords[1]) : null;
  const mapUrl = hasCoordinates
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${longitude! - 0.01}%2C${latitude! - 0.01}%2C${longitude! + 0.01}%2C${latitude! + 0.01}&layer=mapnik&marker=${latitude}%2C${longitude}`
    : null;
  const mapLink = hasCoordinates
    ? `https://www.google.com/maps/search/?api=1&query=${latitude}%2C${longitude}`
    : null;

  return (
    <div className="farmer-product-detail-page w-full max-w-none space-y-5 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <Button asChild variant="ghost" className="-ml-2 text-slate-600 hover:text-emerald-700">
          <Link href="/farmer/products"><ArrowLeft className="mr-2 h-4 w-4" />Back to products</Link>
        </Button>
        <p className="text-xs font-medium text-slate-400">Farmer workspace <span className="mx-1">/</span> Products <span className="mx-1">/</span> Product details</p>
      </div>

      <section className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 lg:flex-row lg:items-center">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700">Product listing</p>
          <div className="mt-1 flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">{product.name || "Unnamed product"}</h1>
            {getStatusBadge(product.status)}
          </div>
          <p className="mt-1 text-sm text-slate-500">{category}{product.productCode ? ` · ${product.productCode}` : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={handleShare}><Share2 className="mr-2 h-4 w-4" />Share</Button>
          <Button type="button" variant="outline" onClick={handleEdit}><Edit className="mr-2 h-4 w-4" />Edit product</Button>
          <Button type="button" variant="destructive" onClick={() => setShowDeleteDialog(true)}><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
        </div>
      </section>

      <div className="grid w-full min-w-0 items-start gap-5 lg:gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.9fr)]">
        <div className="min-w-0 space-y-4">
          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <CardContent className="p-0">
              <div className="relative h-[clamp(300px,32vw,500px)] w-full overflow-hidden bg-slate-100">
                {activeImage ? (
                  <Image
                    src={activeImage}
                    alt={product.name || "Product image"}
                    width={1600}
                    height={1200}
                    priority
                    className="block h-full w-full object-cover"
                    sizes="(max-width: 1024px) 100vw, 65vw"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-slate-50 to-slate-100 text-slate-400">
                    <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-sm">
                      <Package className="h-8 w-8" />
                    </span>
                    <span className="text-sm font-semibold text-slate-600">No product image uploaded</span>
                    <span className="text-xs text-slate-400">Add photos from Edit Product to improve your listing</span>
                  </div>
                )}
                <div className="absolute left-4 top-4 flex flex-wrap gap-2">
                  {product.isOrganic ? <Badge variant="success" className="border-white/70 bg-emerald-700 text-white"><Leaf className="mr-1 h-3 w-3" />Organic</Badge> : null}
                  {product.isFresh ? <Badge variant="secondary" className="border-white/70 bg-white/95 text-slate-700">Fresh produce</Badge> : null}
                </div>
                {productImages.length > 1 ? (
                  <span className="absolute bottom-3 right-3 rounded-full bg-slate-950/65 px-3 py-1 text-xs font-semibold text-white">
                    {Math.min(activeImageIndex + 1, productImages.length)} / {productImages.length}
                  </span>
                ) : null}
              </div>
              {productImages.length > 1 ? (
                <div className="flex gap-2 overflow-x-auto border-t border-slate-100 p-3">
                  {productImages.map((image: string, index: number) => (
                    <button
                      key={image + index}
                      type="button"
                      onClick={() => setActiveImageIndex(index)}
                      aria-label={`Show product image ${index + 1}`}
                      aria-pressed={activeImageIndex === index}
                      className={`relative h-16 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${activeImageIndex === index ? "border-emerald-600" : "border-transparent hover:border-slate-300"}`}
                    >
                      <Image src={image} alt="" width={160} height={120} className="block h-full w-full object-cover" sizes="80px" />
                    </button>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Product overview</CardTitle>
              <CardDescription>Information customers and buyers see in your marketplace listing.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Description</p>
                <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{product.description || "No product description has been added yet."}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <DetailItem icon={Boxes} label="Category" value={category} />
                <DetailItem icon={Sprout} label="Quality grade" value={product.qualityGrade || product.grade} />
                <DetailItem icon={Warehouse} label="Storage type" value={product.storageType} />
                <DetailItem icon={CalendarDays} label="Harvest date" value={formatProductDate(product.harvestDate)} />
              </div>
              {product.storageInstructions ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Storage instructions</p>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-700">{product.storageInstructions}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {hasCoordinates ? (
            <Card className="overflow-hidden border-slate-200 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base"><MapPin className="h-4 w-4 text-emerald-700" />Product location</CardTitle>
                <CardDescription>{product.location?.address || "Saved farm/product coordinates"}</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                  <iframe title="Product location map" width="100%" height="250" loading="lazy" referrerPolicy="no-referrer-when-downgrade" className="block w-full" src={mapUrl!} />
                </div>
                <a href={mapLink!} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center text-xs font-semibold text-emerald-700 hover:text-emerald-800 hover:underline">
                  Open location in Google Maps <span className="ml-1" aria-hidden="true">↗</span>
                </a>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-4 xl:sticky xl:top-24">
          <Card className="overflow-hidden border-emerald-200 shadow-sm">
            <div className="border-b border-emerald-100 bg-emerald-50/70 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Selling price</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-3xl font-bold tracking-tight text-emerald-800">{formatPrice(product.price || 0)}</span>
                <span className="text-sm font-medium text-emerald-700">/ {unit}</span>
              </div>
              <p className="mt-1 text-xs text-emerald-800/80">Your current marketplace price</p>
            </div>
            <CardContent className="space-y-4 p-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-[11px] font-medium text-slate-500">Available stock</p>
                  <p className="mt-1 text-xl font-bold text-slate-900">{availableStock.toLocaleString("en-IN")}</p>
                  <p className="text-[11px] text-slate-500">{unit} ready to sell</p>
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-[11px] font-medium text-slate-500">Reserved stock</p>
                  <p className="mt-1 text-xl font-bold text-amber-700">{reservedStock.toLocaleString("en-IN")}</p>
                  <p className="text-[11px] text-slate-500">{unit} reserved</p>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-600">Stock allocation</span>
                  <span className="font-semibold text-slate-800">{totalStock > 0 ? Math.round((availableStock / totalStock) * 100) : 0}% available</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${totalStock > 0 ? Math.min(100, Math.max(0, (availableStock / totalStock) * 100)) : 0}%` }} />
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Total harvested</span>
                  <span className="font-semibold text-slate-700">{totalStock.toLocaleString("en-IN")} {unit}</span>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                <span className="text-sm text-slate-500">Orders received</span>
                <span className="text-sm font-semibold text-slate-900">{Number(product.orders || product.orderCount || 0).toLocaleString("en-IN")}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">Customer rating</span>
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-slate-900">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />
                  {rating > 0 ? rating.toFixed(1) : "Not rated"}
                  {ratingCount > 0 ? <span className="font-normal text-slate-400">({ratingCount})</span> : null}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="text-base">Listing attributes</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-500">Organic produce</span>
                {product.isOrganic ? <Badge variant="success"><CheckCircle2 className="mr-1 h-3 w-3" />Yes</Badge> : <span className="text-slate-600">Not certified / not specified</span>}
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-500">Fresh listing</span>
                {product.isFresh ? <Badge variant="success">Fresh</Badge> : <span className="text-slate-600">Not specified</span>}
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-500">Measurement unit</span>
                <span className="font-semibold text-slate-800">{unit}</span>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-2">
            <Button onClick={handleEdit} className="w-full"><Edit className="mr-2 h-4 w-4" />Edit product</Button>
            <Button variant="outline" onClick={handleShare} className="w-full"><Share2 className="mr-2 h-4 w-4" />Share</Button>
          </div>
        </aside>
      </div>

      <Dialog open={showDeleteDialog} onOpenChange={(open) => !isDeleting && setShowDeleteDialog(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete product</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{product.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)} disabled={isDeleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? "Deleting…" : "Delete product"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
