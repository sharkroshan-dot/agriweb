"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import Image from "next/image";
import {
  Plus,
  Search,
  Trash2,
  Edit,
  Eye,
  MoreVertical,
  Package,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardDescription, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../../components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../../../components/ui/dialog";
import { cn } from "../../../lib/utils";
import { api } from "../../../lib/api/client";
import { formatPrice } from "../../../lib/utils";
import toast from "react-hot-toast";

export default function FarmerProductsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const { data: products, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["farmerProducts", searchTerm, filterStatus],
    queryFn: () => api.get("/farmers/me/products", { params: { search: searchTerm || undefined, status: filterStatus !== "all" ? filterStatus : undefined, limit: 50 } }),
    retry: 1,
  });

  const handleDeleteProduct = async () => {
    if (!selectedProduct) return;
    try {
      await api.delete(`/products/${selectedProduct.id}`);
      toast.success("Product deleted successfully");
      setShowDeleteDialog(false);
      refetch();
    } catch (error) {
      toast.error("Failed to delete product");
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge variant="success">Active</Badge>;
      case "inactive":
        return <Badge variant="secondary">Inactive</Badge>;
      case "out_of_stock":
        return <Badge variant="destructive">Out of Stock</Badge>;
      case "pending_review":
        return <Badge variant="warning">Pending Review</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Products</h1>
            <p className="text-gray-500">Manage your product listings</p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1,2,3,4,5,6].map(i=> <div key={i} className="h-64 animate-pulse rounded-lg bg-gray-200"/>)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Products</h1>
          <p className="text-gray-500">Manage your product listings ({products?.data?.products?.length || 0})</p>
        </div>
        <Button asChild><Link href="/farmer/products/new"><Plus className="mr-2 h-4 w-4"/>Add New Product</Link></Button>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input placeholder="Search products..." value={searchTerm} onChange={(e)=>setSearchTerm(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-2">
          {['all','active','inactive','out_of_stock','pending_review'].map(status=> (
            <Button key={status} variant={filterStatus===status?"default":"outline"} size="sm" onClick={()=>setFilterStatus(status)}>
              {status==='all'? 'All' : status.split('_').map(w=> w.charAt(0).toUpperCase()+w.slice(1)).join(' ')}
            </Button>
          ))}
        </div>
      </div>

      {isError ? (
        <Card className="p-12 text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-red-400" />
          <h3 className="mt-4 text-lg font-semibold">Failed to load products</h3>
          <p className="mt-2 text-gray-500">{(error as any)?.message || "Please try again later"}</p>
          <Button className="mt-4" onClick={() => refetch()}>Retry</Button>
        </Card>
      ) : products?.data?.products?.length === 0 ? (
        <Card className="p-12 text-center">
          <Package className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-semibold">No products yet</h3>
          <p className="mt-2 text-gray-500">Start listing your fresh produce to reach more customers.</p>
          <Button asChild className="mt-4"><Link href="/farmer/products/new"><Plus className="mr-2 h-4 w-4"/>Add Your First Product</Link></Button>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {products?.data?.products?.map((product: any) => (
            <Card key={product.id} className="overflow-hidden">
              <div className="relative aspect-video overflow-hidden bg-gray-100">
                <Image src={product.images?.[0] || '/images/placeholder-product.jpg'} alt={product.name} fill className="object-cover" />
                <div className="absolute right-2 top-2">{getStatusBadge(product.status)}</div>
                {product.isOrganic && (<div className="absolute left-2 top-2"><Badge variant="success" className="bg-green-600">🌿 Organic</Badge></div>)}
              </div>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate">{product.name}</h3>
                    <p className="text-sm text-gray-500">{product.category}</p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4"/></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild><Link href={`/farmer/products/${product.id}`}><Eye className="mr-2 h-4 w-4"/>View</Link></DropdownMenuItem>
                      <DropdownMenuItem asChild><Link href={`/farmer/products/${product.id}/edit`}><Edit className="mr-2 h-4 w-4"/>Edit</Link></DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={() => { setSelectedProduct(product); setShowDeleteDialog(true); }}><Trash2 className="mr-2 h-4 w-4"/>Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="mt-2 flex items-center justify-between">
                  <div>
                    <span className="text-xl font-bold text-emerald-600">{formatPrice(product.price)}</span>
                    <span className="ml-1 text-sm text-gray-500">/{product.unit}</span>
                  </div>
                  <div className="text-sm">
                    <span className={cn("font-medium", product.quantity > 50 ? "text-green-600" : product.quantity > 10 ? "text-yellow-600" : "text-red-600")}>{product.quantity} units left</span>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between text-sm text-gray-500">
                  <div className="flex items-center gap-1">⭐<span>{product.ratings?.average ? Number(product.ratings.average).toFixed(1) : "—"}</span></div>
                  <div className="flex items-center gap-1">📦<span>{product.orders ?? 0} orders</span></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Product</DialogTitle>
            <DialogDescription>Are you sure you want to delete "{selectedProduct?.name}"? This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteProduct}>Delete Product</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
