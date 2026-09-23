"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Store, Loader2, Save, ShieldCheck, ShieldAlert } from "lucide-react";
import { api } from "../../../lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import toast from "react-hot-toast";

const BUSINESS_TYPES = [
  "restaurant",
  "hotel",
  "cafe",
  "cloud_kitchen",
  "canteen",
  "caterer",
  "supermarket",
  "retail_store",
  "wholesaler",
  "food_processor",
  "institution",
];

export default function BusinessProfilePage() {
  const router = useRouter();
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken;

  const [form, setForm] = useState({
    businessName: "",
    businessType: "restaurant",
    gstin: "",
    contactPerson: "",
    phone: "",
    city: "",
    state: "",
    district: "",
    address: "",
  });

  const { data: profileData, isLoading } = useQuery({
    queryKey: ["businessProfile"],
    queryFn: () => api.get("/b2b/business/profile"),
    enabled: Boolean(accessToken),
    retry: false,
  });

  useEffect(() => {
    const p = (profileData as any)?.data;
    if (p) {
      setForm({
        businessName: p.businessName || "",
        businessType: p.businessType || "restaurant",
        gstin: p.gstin || "",
        contactPerson: p.contactPerson || "",
        phone: p.phone || "",
        city: p.city || "",
        state: p.state || "",
        district: p.district || "",
        address: p.address || "",
      });
    }
  }, [profileData]);

  const saveMutation = useMutation({
    mutationFn: (payload: any) => api.post("/b2b/business/profile", payload),
    onSuccess: () => {
      toast.success("Business profile saved");
      router.push("/business/dashboard");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to save profile"),
  });

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  const isEdit = Boolean(profileData?.data);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <Store className="h-6 w-6 text-emerald-600" />
        <h1 className="text-2xl font-bold">{isEdit ? "Edit" : "Create"} Business Profile</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Business details</CardTitle>
          <CardDescription>
            Used to match you with farmers who can supply your needs and to verify your business.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex items-center gap-2 rounded-lg border p-3">
            {profileData?.data?.isVerified ? (
              <>
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
                <span className="text-sm font-medium text-emerald-700">Business verified</span>
                <Badge variant="success">Verified</Badge>
              </>
            ) : (
              <>
                <ShieldAlert className="h-5 w-5 text-amber-600" />
                <span className="text-sm text-amber-700">
                  Unverified — farmers trust verified businesses. Share your GSTIN and documents to get verified.
                </span>
              </>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Business name *</label>
            <Input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} placeholder="e.g. Bistro Green" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Business type *</label>
            <select
              value={form.businessType}
              onChange={(e) => setForm({ ...form, businessType: e.target.value })}
              className="h-9 w-full rounded-md border border-gray-200 px-2 text-sm"
            >
              {BUSINESS_TYPES.map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">GSTIN (optional)</label>
            <Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} placeholder="e.g. 33ABCDE1234F1Z5" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Contact person</label>
            <Input value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Phone</label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91..." />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">City</label>
            <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="e.g. Coimbatore" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">District</label>
            <Input value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} placeholder="e.g. Coimbatore" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">State</label>
            <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="e.g. Tamil Nadu" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label className="text-xs font-medium text-gray-500">Address</label>
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Button
              className="w-full sm:w-auto"
              disabled={!form.businessName || saveMutation.isPending}
              onClick={() => saveMutation.mutate(form)}
            >
              {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Profile
            </Button>
          </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}