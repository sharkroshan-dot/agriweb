"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  ArrowLeft,
  Plus,
  X,
  Camera,
  Sparkles,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../../../components/ui/card";
import { Button } from "../../../../../components/ui/button";
import { Input } from "../../../../../components/ui/input";
import { Badge } from "../../../../../components/ui/badge";
import { api } from "../../../../../lib/api/client";
import toast from "react-hot-toast";
import { LocationPicker } from "../../../../../components/farmer/location-picker";
import { CameraCapture } from "../../../../../components/farmer/camera-capture";

export default function EditProductPage() {
  const router = useRouter();
  const params = useParams();
  const productId = params?.id as string;
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken as string | undefined;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [location, setLocation] = useState<{ lat: number; lng: number; address?: string } | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    categoryId: "",
    subCategoryId: "",
    price: "",
    unit: "kg",
    quantity: "",
    description: "",
    images: [] as string[],
    isOrganic: false,
    isFresh: true,
    harvestDate: "",
    expiryDate: "",
    storageInstructions: "",
    qualityGrade: "STANDARD",
    storageType: "AMBIENT",
  });

  const { data: productData, isLoading: isProductLoading } = useQuery({
    queryKey: ["farmerProduct", productId],
    queryFn: () => api.get(`/products/${productId}`),
    enabled: Boolean(accessToken && productId),
  });

  const { data: categoriesData } = useQuery({
    queryKey: ["productCategories"],
    queryFn: () => api.get("/products/categories"),
    enabled: Boolean(accessToken),
  });

  const { data: pricingInsightData, isLoading: pricingLoading } = useQuery({
    queryKey: ["aiPricePredict", productId],
    queryFn: () =>
      api.post("/ai/price-predict", {
        productId,
        days: 7,
        includeFactors: true,
      }),
    enabled: Boolean(accessToken && productId && !formData.name),
    retry: 1,
  });

  // Initialize form with product data
  useEffect(() => {
    const product = (productData?.data || productData) as any;
    if (!product?.name) return;
    setFormData({
      name: product.name || "",
      slug: product.slug || "",
      categoryId: product.categoryId || "",
      subCategoryId: product.subCategoryId || "",
      price: product.price?.toString() || "",
      unit: product.unit || "kg",
      quantity: product.quantity?.toString() || "",
      description: product.description || "",
      images: product.images || [],
      isOrganic: product.isOrganic || false,
      isFresh: product.isFresh !== false,
      harvestDate: product.harvestDate ? new Date(product.harvestDate).toISOString().split('T')[0] : "",
      expiryDate: product.expiryDate ? new Date(product.expiryDate).toISOString().split('T')[0] : "",
      storageInstructions: product.storageInstructions || "",
      qualityGrade: product.qualityGrade || "STANDARD",
      storageType: product.storageType || "AMBIENT",
    });
    setUploadedImages(product.images || []);
    if (product.location?.coordinates) {
      setLocation({
        lat: product.location.coordinates[1],
        lng: product.location.coordinates[0],
        address: product.location.address,
      });
    }
  }, [productData]);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;

    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      addPlaceholderImages(files.length);
    }
  };

  const addPlaceholderImages = (count: number) => {
    const newImages = Array.from({ length: count }).map(() => {
      return `/images/placeholder-product.jpg`;
    });
    setUploadedImages((prev) => [...prev, ...newImages]);
    setFormData((prev) => ({
      ...prev,
      images: [...prev.images, ...newImages],
    }));
  };

  const handleCameraCapture = (file: File) => {
    addImagePreviews([file]);
  };

  const addImagePreviews = (files: File[]) => {
    const newImages = files.map((file) => URL.createObjectURL(file));
    setUploadedImages((prev) => [...prev, ...newImages]);
    setFormData((prev) => ({
      ...prev,
      images: [...prev.images, ...newImages],
    }));
  };

  const handleRemoveImage = (index: number) => {
    setUploadedImages((prev) => prev.filter((_, i) => i !== index));
    setFormData((prev) => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.categoryId || !formData.price || !formData.quantity) {
      toast.error("Please fill in all required fields");
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: Record<string, any> = {
        ...formData,
        price: parseFloat(formData.price),
        quantity: parseInt(formData.quantity),
        harvestDate: formData.harvestDate ? new Date(formData.harvestDate) : undefined,
        expiryDate: formData.expiryDate ? new Date(formData.expiryDate) : undefined,
        attributes: {},
      };
      if (location) {
        payload.location = {
          type: "Point",
          coordinates: [location.lng, location.lat],
          address: location.address,
        };
      }

      await api.put(`/products/${productId}`, payload);
      toast.success("Product updated successfully!");
      router.push(`/farmer/products/${productId}`);
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || "Failed to update product");
    } finally {
      setIsSubmitting(false);
    }
  };

  const categories = Array.isArray(categoriesData?.data || categoriesData) ? (categoriesData?.data || categoriesData) : [];

  if (isProductLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/farmer/products/${productId}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">Edit Product</h1>
          <p className="text-gray-500">Update your product information</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Information */}
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
            <CardDescription>Product name, category, and pricing</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Product Name *</label>
              <Input
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                placeholder="e.g., Fresh Tomatoes"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">URL Slug</label>
              <Input
                name="slug"
                value={formData.slug}
                onChange={handleInputChange}
                placeholder="Auto-generated from name"
                disabled
              />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Category *</label>
                <select
                  name="categoryId"
                  value={formData.categoryId}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border rounded-md"
                  aria-label="Product category"
                  title="Product category"
                  required
                >
                  <option value="">Select a category</option>
                  {categories.map((cat: any) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Sub Category</label>
                <Input
                  name="subCategoryId"
                  value={formData.subCategoryId}
                  onChange={handleInputChange}
                  placeholder="Optional"
                />
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Price *</label>
                <div className="flex gap-2">
                  <Input
                    name="price"
                    type="number"
                    value={formData.price}
                    onChange={handleInputChange}
                    placeholder="0.00"
                    step="0.01"
                    min="0"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Unit *</label>
                <select
                  name="unit"
                  value={formData.unit}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border rounded-md"
                  aria-label="Unit of measurement"
                  title="Unit of measurement"
                  required
                >
                  <option value="kg">kg</option>
                  <option value="g">g</option>
                  <option value="piece">piece</option>
                  <option value="bunch">bunch</option>
                  <option value="liter">liter</option>
                  <option value="box">box</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Quantity *</label>
                <Input
                  name="quantity"
                  type="number"
                  value={formData.quantity}
                  onChange={handleInputChange}
                  placeholder="0"
                  min="0"
                  required
                />
              </div>
            </div>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-900">
                <Sparkles className="h-4 w-4 text-emerald-600" /> AI Pricing Insight
              </p>
              {pricingLoading ? (
                <p className="mt-1 text-sm text-emerald-700">Analyzing nearby prices and demand…</p>
              ) : pricingInsightData?.error ? (
                <p className="mt-1 text-sm text-emerald-700">
                  Not enough price history for this product yet.
                </p>
              ) : pricingInsightData?.recommendation ? (
                <div className="mt-1 space-y-1 text-sm text-emerald-800">
                  <p>
                    Current: <strong>₹{pricingInsightData.currentPrice}</strong> · Predicted:{" "}
                    <strong>₹{pricingInsightData.predictedPrice}</strong> ({pricingInsightData.trend})
                  </p>
                  <p>{pricingInsightData.recommendation}</p>
                  {formData.price && (
                    <p className="text-xs text-emerald-700">
                      Your current price: ₹{formData.price}. Consider the suggested range below before saving.
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-sm text-emerald-700">
                  Pricing guidance will appear here once you have enough sales history.
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Description *</label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                placeholder="Describe your product in detail..."
                rows={4}
                className="w-full px-3 py-2 border rounded-md"
                aria-label="Product description"
                required
              />
            </div>
          </CardContent>
        </Card>

        {/* Images */}
        <Card>
          <CardHeader>
            <CardTitle>Product Images</CardTitle>
            <CardDescription>Update product images</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
              <button
                type="button"
                onClick={() => setCameraOpen(true)}
                className="cursor-pointer flex flex-col items-center gap-2 w-full"
              >
                <Camera className="h-8 w-8 text-gray-400" />
                <div className="text-center">
                  <p className="font-medium">Take photo with camera</p>
                  <p className="text-sm text-gray-500">Open your device camera</p>
                </div>
              </button>
            </div>

            <label className="block cursor-pointer text-center text-sm text-emerald-600 hover:underline">
              or click to upload images from your device
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
                aria-label="Upload product images"
                title="Upload product images"
              />
            </label>

            {uploadedImages.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {uploadedImages.map((image, idx) => (
                  <div key={idx} className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden group">
                    <img
                      src={image}
                      alt={`Product ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveImage(idx)}
                      className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded opacity-0 group-hover:opacity-100 transition"
                      aria-label="Remove image"
                      title="Remove image"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Location */}
        <LocationPicker value={location} onChange={setLocation} />

        {/* Quality & Storage */}
        <Card>
          <CardHeader>
            <CardTitle>Quality & Storage</CardTitle>
            <CardDescription>Product quality and storage details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Quality Grade</label>
                <select
                  name="qualityGrade"
                  value={formData.qualityGrade}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border rounded-md"
                  aria-label="Quality grade"
                  title="Quality grade"
                >
                  <option value="PREMIUM">Premium</option>
                  <option value="STANDARD">Standard</option>
                  <option value="ECONOMY">Economy</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Storage Type</label>
                <select
                  name="storageType"
                  value={formData.storageType}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border rounded-md"
                  aria-label="Storage type"
                  title="Storage type"
                >
                  <option value="AMBIENT">Ambient</option>
                  <option value="REFRIGERATED">Refrigerated</option>
                  <option value="FROZEN">Frozen</option>
                </select>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Harvest Date</label>
                <Input
                  name="harvestDate"
                  type="date"
                  value={formData.harvestDate}
                  onChange={handleInputChange}
                  aria-label="Harvest date"
                  title="Harvest date"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Expiry Date</label>
                <Input
                  name="expiryDate"
                  type="date"
                  value={formData.expiryDate}
                  onChange={handleInputChange}
                  aria-label="Expiry date"
                  title="Expiry date"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Storage Instructions</label>
              <textarea
                name="storageInstructions"
                value={formData.storageInstructions}
                onChange={handleInputChange}
                placeholder="e.g., Store in cool, dry place"
                rows={2}
                className="w-full px-3 py-2 border rounded-md"
                aria-label="Storage instructions"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="isOrganic"
                  checked={formData.isOrganic}
                  onChange={handleInputChange}
                  className="w-4 h-4"
                  aria-label="Organic product"
                  title="Organic product"
                />
                <label className="text-sm font-medium">Organic Product</label>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="isFresh"
                  checked={formData.isFresh}
                  onChange={handleInputChange}
                  className="w-4 h-4"
                  aria-label="Freshly harvested"
                  title="Freshly harvested"
                />
                <label className="text-sm font-medium">Freshly Harvested</label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex gap-3">
          <Link href={`/farmer/products/${productId}`} className="flex-1">
            <Button type="button" variant="outline" className="w-full">
              Cancel
            </Button>
          </Link>
          <Button type="submit" disabled={isSubmitting} className="flex-1">
            {isSubmitting ? "Updating..." : "Update Product"}
          </Button>
        </div>
      </form>

      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={handleCameraCapture}
        onUpload={addImagePreviews}
      />
    </div>
  );
}
