"use client";

import React, { useState } from "react";
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



export default function ProductDetailPage() {
  const router = useRouter();
  const params = useParams();
  const productId = params?.id as string;
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken as string | undefined;
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const { data: productData, isLoading } = useQuery({
    queryKey: ["farmerProduct", productId],
    queryFn: () => api.get(`/products/${productId}`),
    enabled: Boolean(accessToken && productId),
  });

  const product = productData?.data || productData;

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await api.delete(`/products/${productId}`);
      toast.success("Product deleted successfully");
      router.push("/farmer/products");
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || "Failed to delete product");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleEdit = () => {
    router.push(`/farmer/products/${productId}/edit`);
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
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2 h-96 animate-pulse rounded-lg bg-muted" />
          <div className="h-96 animate-pulse rounded-lg bg-muted" />
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="space-y-6">
        <Link href="/farmer/products">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <Card className="p-12 text-center">
          <Package className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-semibold">Product not found</h3>
          <p className="mt-2 text-gray-500">The product you're looking for doesn't exist.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/farmer/products">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-3xl font-bold">{product.name}</h1>
          <p className="text-gray-500">{product.category?.name || product.categoryId || ""}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" title="Share">
            <Share2 className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={handleEdit}>
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="destructive"
            size="icon"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Images */}
        <div className="md:col-span-2">
          <Card>
            <CardContent className="p-0">
              <div className="relative aspect-video overflow-hidden bg-gray-100">
                <Image
                  src={product.images?.[0] || "/images/placeholder-product.jpg"}
                  alt={product.name}
                  fill
                  className="object-cover"
                />
              </div>
              {product.images && product.images.length > 1 && (
                <div className="grid grid-cols-4 gap-2 p-4">
                  {product.images.map((img: any, idx: number) => (
                    <div key={idx} className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden">
                      <Image
                        src={img || "/images/placeholder-product.jpg"}
                        alt={`${product.name} ${idx + 1}`}
                        fill
                        className="object-cover"
                      />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-gray-700">{product.description}</p>
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Unit of Measurement</p>
                  <p className="font-medium">{product.unit}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Quality Grade</p>
                  <p className="font-medium">{product.qualityGrade}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Storage Type</p>
                  <p className="font-medium">{product.storageType}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Harvest Date</p>
                  <p className="font-medium">
                    {product.harvestDate ? new Date(product.harvestDate).toLocaleDateString() : "Not specified"}
                  </p>
                </div>
              </div>

              {product.storageInstructions && (
                <div>
                  <p className="text-sm text-gray-500">Storage Instructions</p>
                  <p className="font-medium">{product.storageInstructions}</p>
                </div>
              )}

              {product.location?.coordinates && (
                <div className="border-t pt-4">
                  <p className="text-sm font-medium text-gray-700 mb-1">Product Location</p>
                  <p className="text-sm text-gray-700 mb-1">
                    <MapPin className="inline h-3.5 w-3.5 text-emerald-600 mr-1" />
                    <span className="font-medium">Place:</span> {product.location.address || "Not specified"}
                  </p>
                  <div className="aspect-video w-full overflow-hidden rounded-lg border bg-gray-100">
                    <iframe
                      title="Product Location"
                      width="100%"
                      height="100%"
                      frameBorder="0"
                      src={`https://www.openstreetmap.org/export/embed.html?bbox=${product.location.coordinates?.[0] - 0.01}%2C${product.location.coordinates?.[1] - 0.01}%2C${product.location.coordinates?.[0] + 0.01}%2C${product.location.coordinates?.[1] + 0.01}&layer=mapnik&marker=${product.location.coordinates?.[1]}%2C${product.location.coordinates?.[0]}`}
                    />
                  </div>
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${product.location.coordinates?.[1]}&mlon=${product.location.coordinates?.[0]}&zoom=15`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-xs text-emerald-600 hover:underline"
                  >
                    Open in OpenStreetMap →
                  </a>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Sidebar */}
        <div className="space-y-6">
          {/* Status Card */}
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                {getStatusBadge(product.status)}
              </div>

              {product.isOrganic && (
                <Badge variant="success" className="bg-green-600">
                  🌿 Organic
                </Badge>
              )}

              {product.isFresh && (
                <Badge variant="secondary">
                  ✨ Fresh
                </Badge>
              )}
            </CardContent>
          </Card>

          {/* Pricing Card */}
          <Card>
            <CardHeader>
              <CardTitle>Pricing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-gray-500">Price per {product.unit}</p>
                <p className="text-3xl font-bold text-emerald-600">
                  {formatPrice(product.price)}
                </p>
              </div>

              <div className="border-t pt-4">
                <p className="text-sm text-gray-500">Total Stock</p>
                <p className="text-2xl font-bold">{product.quantity} {product.unit}</p>
              </div>
            </CardContent>
          </Card>

          {/* Ratings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Star className="h-5 w-5 text-yellow-500" />
                Ratings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold">{product.ratings?.average ? Number(product.ratings.average).toFixed(1) : "N/A"}</span>
                  <span className="text-sm text-gray-500">out of 5</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="space-y-2">
            <Button className="w-full" onClick={handleEdit}>
              <Edit className="mr-2 h-4 w-4" />
              Edit Product
            </Button>
            <Button variant="outline" className="w-full">
              <Share2 className="mr-2 h-4 w-4" />
              Share
            </Button>
          </div>
        </div>
      </div>

      {/* Delete Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Product</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{product.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
