"use client";

import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Select, SelectContent, SelectItem } from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import { Badge } from "../../../components/ui/badge";
import { Bike, Camera, CheckCircle2, Clock, FileText, Loader2, Save, UploadCloud, Wallet, XCircle } from "lucide-react";
import { api } from "../../../lib/api/client";
import toast from "react-hot-toast";
import { useRef } from "react";
import { VerificationStatusCard } from "../../../components/security/verification-status";

const WEEK_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const inr = (v: number) => `Rs ${Number(v || 0).toLocaleString("en-IN")}`;

export default function DeliverySettingsPage() {
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken as string | undefined;

  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [isSavingAvailability, setIsSavingAvailability] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const [vehicle, setVehicle] = useState({
    vehicleType: "bike",
    vehicleNumber: "",
    vehicleModel: "",
    vehicleYear: "",
    capacity: "",
    fuelType: "petrol",
  });
  const [savingVehicle, setSavingVehicle] = useState(false);

  const [workingHours, setWorkingHours] = useState<Record<string, { start: string; end: string; off: boolean }>>({});
  const [payout, setPayout] = useState({
    paymentMethod: "bank_transfer",
    upiId: "",
    minWithdrawal: 200,
    autoWithdraw: false,
  });
  const [savingPrefs, setSavingPrefs] = useState(false);

  const [drivingLicense, setDrivingLicense] = useState<any>(null);
  const [dlFile, setDlFile] = useState<File | null>(null);
  const [dlPreview, setDlPreview] = useState<string | null>(null);
  const [licenseNumber, setLicenseNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [uploadingDl, setUploadingDl] = useState(false);
  const dlFileRef = useRef<HTMLInputElement | null>(null);

  const { data: stats } = useQuery({
    queryKey: ["deliveryStats"],
    queryFn: () => api.get("/delivery/me/stats"),
    enabled: Boolean(accessToken),
  });

  const { data: profileData } = useQuery({
    queryKey: ["deliveryProfile"],
    queryFn: () => api.get("/delivery/me"),
    enabled: Boolean(accessToken),
  });

  const { data: profileDetail } = useQuery({
    queryKey: ["deliveryProfileDetail"],
    queryFn: () => api.get("/delivery/me/profile"),
    enabled: Boolean(accessToken),
  });

  const { data: earnings } = useQuery({
    queryKey: ["deliveryEarnings"],
    queryFn: () => api.get("/delivery/me/earnings"),
    enabled: Boolean(accessToken),
  });

  const { data: settingsData } = useQuery({
    queryKey: ["deliverySettings"],
    queryFn: () => api.get("/settings/mine"),
    enabled: Boolean(accessToken),
  });

  React.useEffect(() => {
    if (stats?.data?.isAvailable !== undefined) {
      setIsAvailable(stats.data.isAvailable);
    } else if (isAvailable === null && stats?.data) {
      setIsAvailable(true);
    }
  }, [stats?.data]);

  useEffect(() => {
    if (!profileData?.data) return;
    const p = profileData.data;
    setVehicle({
      vehicleType: p.vehicleType || "bike",
      vehicleNumber: p.vehicleNumber || "",
      vehicleModel: p.vehicleModel || "",
      vehicleYear: p.vehicleYear ? String(p.vehicleYear) : "",
      capacity: p.capacity != null ? String(p.capacity) : "",
      fuelType: p.fuelType || "petrol",
    });
  }, [profileData?.data]);

  useEffect(() => {
    if (!settingsData?.data) return;
    const saved = settingsData.data;
    if (saved.workingHours) setWorkingHours(saved.workingHours);
    if (saved.payout) setPayout((current) => ({ ...current, ...saved.payout }));
  }, [settingsData?.data]);

  useEffect(() => {
    const doc = profileDetail?.data?.drivingLicense;
    if (doc) {
      setDrivingLicense(doc);
      setLicenseNumber(doc.licenseNumber || "");
      setExpiryDate(doc.expiryDate || "");
    }
  }, [profileDetail?.data]);

  const handleDrivingLicenseSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Photo must be under 5MB");
      return;
    }
    setDlFile(file);
    const reader = new FileReader();
    reader.onload = () => setDlPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleUploadDrivingLicense = async () => {
    if (!dlFile) {
      toast.error("Choose a driving licence photo first");
      return;
    }
    setUploadingDl(true);
    try {
      const formData = new FormData();
      formData.append("photo", dlFile);
      if (licenseNumber.trim()) formData.append("licenseNumber", licenseNumber.trim());
      if (expiryDate) formData.append("expiryDate", expiryDate);
      const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
      const res = await fetch(`${base}/delivery/me/documents/driving-license`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || "Upload failed");
      setDrivingLicense(json.data);
      setDlFile(null);
      setDlPreview(null);
      toast.success("Driving licence submitted for verification");
    } catch (err: any) {
      toast.error(err?.message || "Upload failed");
    } finally {
      setUploadingDl(false);
    }
  };

  const handleToggleAvailability = async () => {
    if (isAvailable === null || isSavingAvailability) return;
    const nextAvailable = !isAvailable;
    setIsSavingAvailability(true);
    try {
      await api.put("/delivery/me/availability", { isAvailable: nextAvailable });
      setIsAvailable(nextAvailable);
      setLastSaved(new Date().toLocaleTimeString());
      toast.success(nextAvailable ? "You are now Online" : "You are now Offline");
    } catch (error) {
      toast.error("Failed to update availability");
    } finally {
      setIsSavingAvailability(false);
    }
  };

  const handleSaveVehicle = async () => {
    setSavingVehicle(true);
    try {
      await api.put("/delivery/me", {
        vehicleType: vehicle.vehicleType,
        vehicleNumber: vehicle.vehicleNumber,
        vehicleModel: vehicle.vehicleModel,
        vehicleYear: vehicle.vehicleYear ? Number(vehicle.vehicleYear) : null,
        capacity: vehicle.capacity ? Number(vehicle.capacity) : null,
        fuelType: vehicle.fuelType,
      });
      toast.success("Vehicle details saved");
    } catch (err: any) {
      toast.error(err?.message || "Failed to save vehicle details");
    } finally {
      setSavingVehicle(false);
    }
  };

  const handleSavePrefs = async () => {
    setSavingPrefs(true);
    try {
      await api.put("/settings/mine", { workingHours, payout });
      setLastSaved(new Date().toLocaleTimeString());
      toast.success("Settings saved");
    } catch (err: any) {
      toast.error(err?.message || "Failed to save settings");
    } finally {
      setSavingPrefs(false);
    }
  };

  const e = earnings?.data || {};

  const dlStatus = drivingLicense?.status || "not_submitted";
  const dlBadgeLabel =
    dlStatus === "verified" ? "Verified"
    : dlStatus === "submitted" ? "Under review"
    : dlStatus === "rejected" ? "Rejected"
    : "Not submitted";
  const dlBadgeVariant =
    dlStatus === "verified" ? "success"
    : dlStatus === "submitted" ? "warning"
    : dlStatus === "rejected" ? "destructive"
    : "secondary" as const;
  const backendOrigin = (() => {
    try { return new URL(process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1").origin; }
    catch { return "http://localhost:8000"; }
  })();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Delivery preferences</p>
          <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">Profile, vehicle, availability, earnings and payouts.</p>
        </div>
        <div className="flex items-center gap-2">
          {lastSaved && <span className="text-xs text-muted-foreground">Saved at {lastSaved}</span>}
          <Button size="sm" onClick={handleSavePrefs} disabled={savingPrefs}>
            {savingPrefs ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
            Save preferences
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <VerificationStatusCard />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Bike className="h-5 w-5" />Vehicle details</CardTitle>
            <CardDescription>Used to match you with suitable deliveries.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium">Vehicle type</label>
              <Select className="mt-1" value={vehicle.vehicleType} onValueChange={(v) => setVehicle((s) => ({ ...s, vehicleType: v }))}>
                <SelectContent>
                  <SelectItem value="bike">Bike</SelectItem>
                  <SelectItem value="scooter">Scooter</SelectItem>
                  <SelectItem value="car">Car</SelectItem>
                  <SelectItem value="van">Van</SelectItem>
                  <SelectItem value="truck">Truck</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Vehicle number</label>
              <Input className="mt-1" value={vehicle.vehicleNumber} onChange={(e) => setVehicle((s) => ({ ...s, vehicleNumber: e.target.value }))} placeholder="DL-01-AB-1234" />
            </div>
            <div>
              <label className="text-sm font-medium">Vehicle model</label>
              <Input className="mt-1" value={vehicle.vehicleModel} onChange={(e) => setVehicle((s) => ({ ...s, vehicleModel: e.target.value }))} placeholder="Honda Activa 6G" />
            </div>
            <div>
              <label className="text-sm font-medium">Year</label>
              <Input className="mt-1" value={vehicle.vehicleYear} onChange={(e) => setVehicle((s) => ({ ...s, vehicleYear: e.target.value }))} placeholder="2022" />
            </div>
            <div>
              <label className="text-sm font-medium">Capacity (kg)</label>
              <Input className="mt-1" value={vehicle.capacity} onChange={(e) => setVehicle((s) => ({ ...s, capacity: e.target.value }))} placeholder="50" />
            </div>
            <div>
              <label className="text-sm font-medium">Fuel type</label>
              <Select className="mt-1" value={vehicle.fuelType} onValueChange={(v) => setVehicle((s) => ({ ...s, fuelType: v }))}>
                <SelectContent>
                  <SelectItem value="petrol">Petrol</SelectItem>
                  <SelectItem value="diesel">Diesel</SelectItem>
                  <SelectItem value="electric">Electric</SelectItem>
                  <SelectItem value="cng">CNG</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <Button variant="outline" onClick={handleSaveVehicle} disabled={savingVehicle}>
                {savingVehicle ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
                Save vehicle
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Documents &amp; verification</CardTitle>
            <CardDescription>Upload a copy of your driving licence for security verification.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-primary/10 p-3">
                  {dlStatus === "verified"
                    ? <CheckCircle2 className="h-6 w-6 text-green-600" />
                    : dlStatus === "rejected"
                      ? <XCircle className="h-6 w-6 text-red-600" />
                      : <FileText className="h-6 w-6 text-primary" />}
                </div>
                <div>
                  <p className="font-medium">Driving licence</p>
                  <p className="text-sm text-muted-foreground">
                    {dlStatus === "submitted" && "Submitted — under admin review."}
                    {dlStatus === "verified" && "Verified by admin. You are approved for deliveries."}
                    {dlStatus === "rejected" && "Rejected. Please upload a clear copy."}
                    {(!dlStatus || dlStatus === "not_submitted") && "Not submitted yet. Upload a clear photocopy of your licence."}
                  </p>
                  {drivingLicense?.remark && <p className="mt-1 text-xs text-muted-foreground">Admin note: {drivingLicense.remark}</p>}
                </div>
              </div>
              <Badge variant={dlBadgeVariant}>{dlBadgeLabel}</Badge>
            </div>

            {(dlPreview || drivingLicense?.photoUrl) && (
              <div className="rounded-lg border p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={dlPreview || `${backendOrigin}${drivingLicense.photoUrl}`}
                  alt="Driving licence"
                  className="mx-auto max-h-48 rounded-md object-contain"
                />
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium">Driving licence number</label>
                <Input className="mt-1" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} placeholder="DL-XX-XXXXXXXXXXXX" />
              </div>
              <div>
                <label className="text-sm font-medium">Expiry date</label>
                <Input className="mt-1" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                ref={dlFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleDrivingLicenseSelect}
              />
              <Button variant="outline" onClick={() => dlFileRef.current?.click()}>
                <Camera className="mr-1.5 h-4 w-4" />Choose photo
              </Button>
              {dlFile && <span className="text-xs text-muted-foreground">{dlFile.name}</span>}
              <div className="sm:ml-auto">
                <Button onClick={handleUploadDrivingLicense} disabled={uploadingDl || !dlFile}>
                  {uploadingDl ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-1.5 h-4 w-4" />}
                  {uploadingDl ? "Uploading..." : "Submit for verification"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5" />Availability & working hours</CardTitle>
            <CardDescription>Control when you receive assignments.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Online mode</p>
                  <p className="text-sm text-muted-foreground">Accept new deliveries when enabled.</p>
                </div>
                <Badge variant={isAvailable ? "success" : "secondary"}>{isAvailable === null ? "Loading" : isAvailable ? "Online" : "Offline"}</Badge>
              </div>
              <Button className="mt-3" onClick={handleToggleAvailability} disabled={isAvailable === null || isSavingAvailability}>
                {isAvailable ? "Go Offline" : "Go Online"}
              </Button>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Working hours</p>
              {WEEK_DAYS.map((day) => {
                const hours = workingHours[day] || { start: "09:00", end: "18:00", off: false };
                return (
                  <div key={day} className="flex items-center gap-2 rounded-lg border p-2 text-sm">
                    <span className="w-24 shrink-0 font-medium">{day}</span>
                    <span className="flex items-center gap-1.5">
                      <Switch checked={!hours.off} onCheckedChange={(on) => setWorkingHours((c) => ({ ...c, [day]: { ...hours, off: !on } }))} aria-label={`${day} available`} />
                      {hours.off ? <span className="text-xs text-muted-foreground">Off</span> : (
                        <span className="flex items-center gap-1.5">
                          <input type="time" value={hours.start} onChange={(e) => setWorkingHours((c) => ({ ...c, [day]: { ...hours, start: e.target.value } }))} className="h-8 rounded border px-2 text-xs" />
                          <span>-</span>
                          <input type="time" value={hours.end} onChange={(e) => setWorkingHours((c) => ({ ...c, [day]: { ...hours, end: e.target.value } }))} className="h-8 rounded border px-2 text-xs" />
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Wallet className="h-5 w-5" />Earnings & payouts</CardTitle>
            <CardDescription>Your earnings summary and payout preferences.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-2">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Today</p>
                <p className="text-lg font-bold">{inr(e.todayEarnings)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Week</p>
                <p className="text-lg font-bold">{inr(e.weekEarnings)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Month</p>
                <p className="text-lg font-bold">{inr(e.monthEarnings)}</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium">Payment method</label>
                  <Select className="mt-1" value={payout.paymentMethod} onValueChange={(v) => setPayout((s) => ({ ...s, paymentMethod: v }))}>
                    <SelectContent>
                      <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                      <SelectItem value="upi">UPI</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">UPI ID</label>
                  <Input className="mt-1" value={payout.upiId} onChange={(e) => setPayout((s) => ({ ...s, upiId: e.target.value }))} placeholder="raj@upi" />
                </div>
                <div>
                  <label className="text-sm font-medium">Minimum withdrawal (Rs)</label>
                  <Input type="number" min="0" className="mt-1" value={payout.minWithdrawal} onChange={(e) => setPayout((s) => ({ ...s, minWithdrawal: Number(e.target.value) }))} />
                </div>
                <div className="flex items-end pb-1">
                  <div className="flex w-full items-center justify-between rounded-lg border p-3 text-sm font-medium">
                    Auto-withdraw
                    <Switch checked={payout.autoWithdraw} onCheckedChange={(on) => setPayout((s) => ({ ...s, autoWithdraw: on }))} aria-label="Auto-withdraw" />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
