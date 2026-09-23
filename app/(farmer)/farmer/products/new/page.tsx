"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession, getSession } from "next-auth/react";
import {
  ArrowLeft,
  Plus,
  X,
  Check,
  Camera,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../../components/ui/card";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Badge } from "../../../../components/ui/badge";
import { api } from "../../../../lib/api/client";
import toast from "react-hot-toast";
import { LocationPicker } from "../../../../components/farmer/location-picker";
import { CameraCapture } from "../../../../components/farmer/camera-capture";

export default function AddProductPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken as string | undefined;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [uploadedPreviewUrls, setUploadedPreviewUrls] = useState<string[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
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
    qualityGrade: "standard",
    storageType: "ambient",
    pickupAvailable: false,
    pickupInstructions: "",
    farmAddress: "",
    minBulkQty: "",
    bulkPrice: "",
    bulkDiscountPercent: "",
  });

  const { data: categoriesData } = useQuery({
    queryKey: ["productCategories"],
    queryFn: () => api.get("/products/categories"),
    enabled: Boolean(accessToken),
  });

  useEffect(() => {
    const name = searchParams.get("name");
    if (!name) return;
    const harvestDate = searchParams.get("harvestDate") || "";
    let harvestDateLocal = "";
    if (harvestDate) {
      const d = new Date(harvestDate);
      if (!isNaN(d.getTime())) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        harvestDateLocal = `${yyyy}-${mm}-${dd}`;
      }
    }
    setFormData((prev) => ({
      ...prev,
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      price: searchParams.get("price") || prev.price,
      quantity: searchParams.get("quantity") || prev.quantity,
      unit: searchParams.get("unit") || prev.unit,
      harvestDate: harvestDateLocal,
    }));
  }, [searchParams]);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;

    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));

    // Auto-generate slug from name
    if (name === "name") {
      const slug = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      setFormData((prev) => ({
        ...prev,
        slug,
      }));
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      addImageFiles(Array.from(files));
    }
  };

  const addImageFiles = (files: File[]) => {
    if (files.length === 0) return;
    const newPreviewUrls = files.map((file) => URL.createObjectURL(file));
    setUploadedPreviewUrls((prev) => [...prev, ...newPreviewUrls]);
    setImageFiles((prev) => [...prev, ...files]);
    toast.success(`${files.length} image${files.length > 1 ? "s" : ""} added`);
  };

  const handleCameraCapture = (file: File) => addImageFiles([file]);

  const handleRemoveImage = (index: number) => {
    setUploadedPreviewUrls((prev) => prev.filter((_, i) => i !== index));
    setImageFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const fromHarvestId = searchParams.get("fromHarvest");

  const handleBack = async () => {
    if (fromHarvestId) {
      try {
        const res = await api.get("/harvests/farmer/plans", { params: { source: "planner" } });
        const plan = (res?.data?.plans || []).find((p: any) => (p._id || p.id) === fromHarvestId);
        if (plan?.productCreated) {
          toast("Product already created for this harvest. The previous step is locked.");
          router.push("/farmer/harvest-planner");
          return;
        }
        if (plan && (plan.status === "harvested" || plan.stage === "harvested")) {
          await api.post(`/harvests/plans/${fromHarvestId}/stage`, { action: "prev" });
          toast.success("Harvest reverted to Ready for Harvest");
        }
      } catch {
        // ignore - plan may already be reverted
      }
      router.push("/farmer/harvest-planner");
    } else {
      router.push("/farmer/products");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.categoryId || !formData.price || !formData.quantity) {
      toast.error("Please fill in all required fields");
      return;
    }

    setIsSubmitting(true);
    try {
      const session = await getSession();
      const token = (session as any)?.accessToken as string | undefined;
      if (!token) {
        const { signOut } = await import("next-auth/react");
        await signOut({ redirect: false });
        window.location.href = "/login?expired=true";
        throw new Error("Session expired. Please login again.");
      }

      const apiBaseUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1").replace(/\/api\/v1\/?$/, "");
      const imageUrls: string[] = [];
      for (const file of imageFiles) {
        const form = new FormData();
        form.append("file", file);
        const uploadRes = await fetch(`${apiBaseUrl}/api/v1/products/upload`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
        if (uploadRes.status === 401) {
          const { signOut } = await import("next-auth/react");
          await signOut({ redirect: false });
          window.location.href = "/login?expired=true";
          throw new Error("Session expired. Please login again.");
        }
        if (!uploadRes.ok) throw new Error("Image upload failed");
        const uploadJson = await uploadRes.json();
        imageUrls.push(`${apiBaseUrl}${uploadJson.data.url}`);
      }

      const payload: Record<string, any> = {
        ...formData,
        images: imageUrls,
        sourceHarvestPlanId: fromHarvestId || undefined,
        price: parseFloat(formData.price),
        quantity: parseInt(formData.quantity),
        harvestDate: formData.harvestDate ? new Date(formData.harvestDate) : undefined,
        expiryDate: formData.expiryDate ? new Date(formData.expiryDate) : undefined,
        attributes: {},
        pickupAvailable: formData.pickupAvailable,
        pickupInstructions: formData.pickupInstructions || undefined,
        farmAddress: formData.farmAddress || undefined,
        minBulkQty: formData.minBulkQty ? parseInt(formData.minBulkQty) : 0,
        bulkPrice: formData.bulkPrice ? parseFloat(formData.bulkPrice) : undefined,
        bulkDiscountPercent: formData.bulkDiscountPercent ? parseFloat(formData.bulkDiscountPercent) : 0,
      };
      if (location) {
        payload.location = {
          type: "Point",
          coordinates: [location.lng, location.lat],
          address: location.address,
        };
      }

      await api.post("/products/", payload);
      await queryClient.refetchQueries({ queryKey: ["farmerProducts"] });
      toast.success("Product created successfully!");
      router.push("/farmer/products");
    } catch (error: any) {
      console.error("PRODUCT CREATE ERROR:", error);
      const raw =
        error?.message ||
        (typeof error === "object" && error !== null ? JSON.stringify(error) : String(error));
      toast.error(raw && raw !== "undefined" ? String(raw).slice(0, 300) : "Failed to create product");
    } finally {
      setIsSubmitting(false);
    }
  };

  const FALLBACK_CATEGORIES = [
    { id: "vegetables", name: "Vegetables" },
    { id: "fruits", name: "Fruits" },
    { id: "dairy", name: "Dairy" },
    { id: "grains", name: "Grains" },
    { id: "spices", name: "Spices" },
    { id: "herbs", name: "Herbs" },
    { id: "poultry", name: "Poultry" },
    { id: "meat", name: "Meat" },
    { id: "seafood", name: "Seafood" },
    { id: "nuts-seeds", name: "Nuts & Seeds" },
    { id: "beverages", name: "Beverages" },
    { id: "organic", name: "Organic" },
  ];
  const categories = Array.isArray(categoriesData) && categoriesData.length > 0 ? categoriesData : FALLBACK_CATEGORIES;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={handleBack} aria-label="Go back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Add New Product</h1>
          <p className="text-gray-500">List your fresh produce on AgriConnect</p>
        </div>
      </div>

      {searchParams.get("fromHarvest") && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          Harvest marked successfully! The crop details are pre-filled below. Add an image, category and
          location, then click Create Product to list it.
        </div>
      )}

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
            <CardDescription>Upload at least one product image</CardDescription>
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

            {uploadedPreviewUrls.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {uploadedPreviewUrls.map((image, idx) => (
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
        <LocationPicker
          value={location}
          onChange={setLocation}
        />

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
                  <option value="premium">Premium</option>
                  <option value="standard">Standard</option>
                  <option value="economy">Economy</option>
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
                  <option value="ambient">Ambient</option>
                  <option value="chilled">Chilled</option>
                  <option value="frozen">Frozen</option>
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

        {/* Pickup & Bulk */}
        <Card>
          <CardHeader>
            <CardTitle>Pickup & Bulk Pricing</CardTitle>
            <CardDescription>Enable farm pickup and bulk/wholesale discounts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                name="pickupAvailable"
                checked={formData.pickupAvailable}
                onChange={handleInputChange}
                className="w-4 h-4"
              />
              <label className="text-sm font-medium">Allow Farm Pickup</label>
            </div>

            {formData.pickupAvailable && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-2">Farm Address</label>
                  <textarea
                    name="farmAddress"
                    value={formData.farmAddress}
                    onChange={handleInputChange}
                    placeholder="e.g., 123 Farm Road, Village, District"
                    rows={2}
                    className="w-full px-3 py-2 border rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Pickup Instructions</label>
                  <textarea
                    name="pickupInstructions"
                    value={formData.pickupInstructions}
                    onChange={handleInputChange}
                    placeholder="e.g., Call upon arrival, gate code 1234"
                    rows={2}
                    className="w-full px-3 py-2 border rounded-md"
                  />
                </div>
              </>
            )}

            <div className="border-t pt-4">
              <h4 className="text-sm font-medium mb-3">Bulk / Wholesale Pricing</h4>
              <p className="text-xs text-gray-500 mb-3">
                Offer discounted pricing when customers order larger quantities
              </p>
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Min Bulk Qty</label>
                  <Input
                    name="minBulkQty"
                    type="number"
                    value={formData.minBulkQty}
                    onChange={handleInputChange}
                    placeholder="e.g., 10"
                    min="0"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Bulk Price (per unit)</label>
                  <Input
                    name="bulkPrice"
                    type="number"
                    value={formData.bulkPrice}
                    onChange={handleInputChange}
                    placeholder="e.g., 25.00"
                    step="0.01"
                    min="0"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Discount %</label>
                  <Input
                    name="bulkDiscountPercent"
                    type="number"
                    value={formData.bulkDiscountPercent}
                    onChange={handleInputChange}
                    placeholder="e.g., 10"
                    min="0"
                    max="100"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex gap-3">
          <Button type="button" variant="outline" className="flex-1" onClick={handleBack}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting} className="flex-1">
            {isSubmitting ? "Creating..." : "Create Product"}
          </Button>
        </div>
      </form>

      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={handleCameraCapture}
        onUpload={addImageFiles}
      />
    </div>
  );
}
