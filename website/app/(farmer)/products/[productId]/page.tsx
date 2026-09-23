"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Edit, Trash2, ShoppingCart, Star, Clock, CheckCircle, XCircle } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { formatPrice, formatDate } from "../../../lib/utils";

interface ProductData {
  id: string;
  name: string;
  category: string;
  price: number;
  unit: string;
  stock: number;
  description: string;
  status: "active" | "inactive" | "out_of_stock";
  createdAt: string;
  image: string;
  farmer: string;
  rating: number;
  totalSold: number;
}

const sampleProducts: Record<string, ProductData> = {
  "prod-1": {
    id: "prod-1",
    name: "Fresh Tomatoes",
    category: "Vegetables",
    price: 35,
    unit: "kg",
    stock: 200,
    description: "Sun-ripened, juicy tomatoes harvested fresh from our organic farm. Perfect for salads, curries, and cooking. No pesticides used.",
    status: "active",
    createdAt: "2025-01-15",
    image: "🍅",
    farmer: "Annur Fresh Basket",
    rating: 4.8,
    totalSold: 1250,
  },
  "prod-2": {
    id: "prod-2",
    name: "Organic Oranges",
    category: "Fruits",
    price: 120,
    unit: "kg",
    stock: 0,
    description: "Sweet and tangy organic oranges grown in the foothills of Pollachi. Rich in Vitamin C and naturally ripened.",
    status: "out_of_stock",
    createdAt: "2025-02-20",
    image: "🍊",
    farmer: "Pollachi Organic Farm",
    rating: 4.6,
    totalSold: 890,
  },
};

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const productId = params.productId as string;
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const product = sampleProducts[productId];

  if (!product) {
    return (
      <div className="space-y-6 p-6">
        <Button variant="ghost" onClick={() => router.back()} className="flex items-center gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <XCircle className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">Product not found</p>
            <p className="text-sm text-muted-foreground">This product does not exist or has been removed.</p>
            <Button asChild><Link href="/farmer/products">View all products</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusColor: Record<string, string> = {
    active: "border-green-200 bg-green-50 text-green-700",
    inactive: "border-yellow-200 bg-yellow-50 text-yellow-700",
    out_of_stock: "border-red-200 bg-red-50 text-red-700",
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => router.back()} className="flex items-center gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/farmer/products/${product.id}/edit`}>
              <Edit className="mr-1 h-4 w-4" /> Edit
            </Link>
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setShowDeleteConfirm(true)}>
            <Trash2 className="mr-1 h-4 w-4" /> Delete
          </Button>
        </div>
      </div>

      {showDeleteConfirm && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex items-center justify-between p-4">
            <p className="text-sm font-medium text-red-800">Are you sure you want to delete this product?</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
              <Button variant="destructive" size="sm" onClick={() => { setShowDeleteConfirm(false); router.push("/farmer/products"); }}>Confirm Delete</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.5fr]">
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-8">
            <span className="text-8xl">{product.image}</span>
            <Badge className={statusColor[product.status]}>{product.status.replace(/_/g, " ")}</Badge>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-2xl">{product.name}</CardTitle>
                  <CardDescription>{product.farmer}</CardDescription>
                </div>
                <p className="text-2xl font-bold text-emerald-700">{formatPrice(product.price)}<span className="text-sm font-normal text-muted-foreground">/{product.unit}</span></p>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-600">{product.description}</p>
              <div className="grid grid-cols-2 gap-4 border-t pt-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Category</span>
                  <p className="font-medium text-slate-900">{product.category}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Stock</span>
                  <p className="font-medium text-slate-900">{product.stock > 0 ? `${product.stock} ${product.unit}` : "Out of stock"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                  <span className="font-medium text-slate-900">{product.rating}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Total Sold</span>
                  <p className="font-medium text-slate-900">{product.totalSold} {product.unit}</p>
                </div>
              </div>
              <div className="border-t pt-4 text-xs text-muted-foreground">
                Created on {formatDate(product.createdAt)}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
