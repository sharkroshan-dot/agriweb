"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Store, Loader2, Save, ShieldCheck, ShieldAlert, MapPin, LocateFixed } from "lucide-react";
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
    location: null as { type: "Point"; coordinates: [number, number]; latitude: number; longitude: number } | null,
  });
  const [locationLoading, setLocationLoading] = useState(false);

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
        location: p.location?.type === "Point" && Array.isArray(p.location.coordinates)
          ? {
              type: "Point",
              coordinates: [Number(p.location.coordinates[0]), Number(p.location.coordinates[1])],
              latitude: Number(p.location.latitude ?? p.location.coordinates[1]),
              longitude: Number(p.location.longitude ?? p.location.coordinates[0]),
            }
          : null,
      });
    }
  }, [profileData]);

  const useLiveLocation = () => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      toast.error("Live location is not supported by this browser. Enter the address manually.");
      return;
    }

    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const latitude = coords.latitude;
        const longitude = coords.longitude;
        const location = {
          type: "Point" as const,
          coordinates: [longitude, latitude] as [number, number],
          latitude,
          longitude,
        };

        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`,
            { headers: { Accept: "application/json" } },
          );
          if (!response.ok) throw new Error("Address lookup failed");

          const result = await response.json();
          const address = result.address || {};
          const city = address.city || address.town || address.village || address.municipality || address.suburb || "";
          const district = address.state_district || address.county || address.city_district || address.district || "";
          const state = address.state || address.region || "";
          const formattedAddress = result.display_name || `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;

          setForm((current) => ({
            ...current,
            address: formattedAddress,
            city: current.city || city,
            district: current.district || district,
            state: current.state || state,
            location,
          }));
          toast.success("Live location added. Review the address and details before saving.");
        } catch {
          setForm((current) => ({
            ...current,
            address: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
            location,
          }));
          toast.error("Coordinates saved, but the street address could not be found. Please enter the address manually.");
        } finally {
          setLocationLoading(false);
        }
      },
      (error) => {
        setLocationLoading(false);
        toast.error(
          error.code === error.PERMISSION_DENIED
            ? "Location permission denied. Allow location access in your browser or enter the address manually."
            : error.code === error.TIMEOUT
              ? "Getting your location timed out. Please try again."
              : "Could not get your live location. Please enter the address manually.",
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  };

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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-medium text-gray-500">Address</label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={locationLoading}
                onClick={useLiveLocation}
              >
                {locationLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <LocateFixed className="mr-2 h-4 w-4" />
                )}
                {locationLoading ? "Getting location…" : "Use my live location"}
              </Button>
            </div>
            <Input
              value={form.address}
              onChange={(e) => setForm((current) => ({
                ...current,
                address: e.target.value,
                location: null,
              }))}
              placeholder="Enter your business address or use live location"
            />
            {form.location ? (
              <p className="flex items-center gap-1 text-xs text-emerald-700">
                <MapPin className="h-3.5 w-3.5" />
                GPS location saved: {form.location.latitude.toFixed(6)}, {form.location.longitude.toFixed(6)}
              </p>
            ) : (
              <p className="text-xs text-gray-500">
                Use your browser location permission to fill the address and GPS coordinates automatically. You can review and edit the address before saving.
              </p>
            )}
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