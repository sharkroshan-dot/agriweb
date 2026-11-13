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
    <div className="space-y-5">
      <header className="relative isolate flex min-h-[112px] items-center overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-r from-[#effbe9] via-[#e9f8df] to-[#d5efc2] px-5 py-5 shadow-sm sm:px-7">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-gradient-to-l from-emerald-300/30 to-transparent"/>
        <div className="relative z-10 flex items-center gap-4">
          <div className="rounded-xl bg-emerald-700 p-3 text-white shadow"><Save className="h-7 w-7"/></div>
          <div className="h-12 w-px bg-emerald-700/40"/>
          <div><p className="text-[11px] font-bold uppercase tracking-widest text-emerald-800">Account settings</p><h1 className="text-2xl font-bold tracking-tight text-slate-900">Settings</h1><p className="text-xs text-slate-600 sm:text-sm">Manage your profile, vehicle, security, payout preferences and availability.</p></div>
        </div>
        <div className="relative z-10 ml-auto hidden items-center gap-2 sm:flex">{lastSaved&&<span className="text-xs text-emerald-800">Saved at {lastSaved}</span>}<Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" onClick={handleSavePrefs} disabled={savingPrefs}>{savingPrefs?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Save className="mr-2 h-4 w-4"/>}Save preferences</Button></div>
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[0.95fr_1.25fr]">
        <div className="space-y-5">
          <Card className="overflow-hidden">
            <CardHeader className="border-b bg-gradient-to-r from-emerald-50/70 to-white pb-4">
              <CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-700"/>Profile Information</CardTitle>
              <CardDescription>Your registered delivery partner account details.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="flex items-center gap-3">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-800"><Bike className="h-8 w-8"/></div>
                <div className="min-w-0"><p className="truncate text-lg font-bold">{profileData?.data?.fullName||profileData?.data?.name||profileDetail?.data?.fullName||"Delivery Partner"}</p><p className="text-sm text-muted-foreground">Delivery Partner</p><Badge variant="outline" className="mt-1 border-emerald-200 bg-emerald-50 text-emerald-700">Registered account</Badge></div>
              </div>
              <div className="divide-y rounded-xl border">
                <div className="flex items-center justify-between gap-3 p-3 text-sm"><span className="text-muted-foreground">Email</span><span className="break-all text-right font-medium">{profileData?.data?.email||profileDetail?.data?.email||session?.user?.email||"Not available"}</span></div>
                <div className="flex items-center justify-between gap-3 p-3 text-sm"><span className="text-muted-foreground">Phone</span><span className="text-right font-medium">{profileData?.data?.phone||profileData?.data?.phoneNumber||profileDetail?.data?.phone||"Not available"}</span></div>
                <div className="flex items-center justify-between gap-3 p-3 text-sm"><span className="text-muted-foreground">Partner ID</span><span className="text-right font-medium">{profileData?.data?.partnerId||profileData?.data?.deliveryPartnerId||"—"}</span></div>
              </div>
              <p className="text-xs text-muted-foreground">To change personal contact details, use the profile update process available in your account.</p>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="border-b bg-gradient-to-r from-emerald-50/70 to-white pb-4"><CardTitle className="flex items-center gap-2"><Bike className="h-5 w-5 text-emerald-700"/>Vehicle &amp; Delivery Details</CardTitle><CardDescription>Vehicle information used to match you with suitable delivery assignments.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 pt-4 sm:grid-cols-2">
              <div><label className="text-sm font-medium">Vehicle type</label><Select className="mt-1" value={vehicle.vehicleType} onValueChange={(v)=>setVehicle(s=>({...s,vehicleType:v}))}><SelectContent><SelectItem value="bike">Bike</SelectItem><SelectItem value="scooter">Scooter</SelectItem><SelectItem value="car">Car</SelectItem><SelectItem value="van">Van</SelectItem><SelectItem value="truck">Truck</SelectItem></SelectContent></Select></div>
              <div><label className="text-sm font-medium">Vehicle number</label><Input className="mt-1" value={vehicle.vehicleNumber} onChange={e=>setVehicle(s=>({...s,vehicleNumber:e.target.value}))} placeholder="TN 00 AB 0000"/></div>
              <div><label className="text-sm font-medium">Vehicle model</label><Input className="mt-1" value={vehicle.vehicleModel} onChange={e=>setVehicle(s=>({...s,vehicleModel:e.target.value}))} placeholder="Vehicle model"/></div>
              <div><label className="text-sm font-medium">Year</label><Input className="mt-1" value={vehicle.vehicleYear} onChange={e=>setVehicle(s=>({...s,vehicleYear:e.target.value}))} placeholder="2022"/></div>
              <div><label className="text-sm font-medium">Capacity (kg)</label><Input className="mt-1" value={vehicle.capacity} onChange={e=>setVehicle(s=>({...s,capacity:e.target.value}))} placeholder="50"/></div>
              <div><label className="text-sm font-medium">Fuel type</label><Select className="mt-1" value={vehicle.fuelType} onValueChange={v=>setVehicle(s=>({...s,fuelType:v}))}><SelectContent><SelectItem value="petrol">Petrol</SelectItem><SelectItem value="diesel">Diesel</SelectItem><SelectItem value="electric">Electric</SelectItem><SelectItem value="cng">CNG</SelectItem></SelectContent></Select></div>
              <div className="sm:col-span-2 flex justify-end"><Button variant="outline" onClick={handleSaveVehicle} disabled={savingVehicle}>{savingVehicle?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Save className="mr-2 h-4 w-4"/>}Save vehicle details</Button></div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden"><CardHeader className="border-b bg-gradient-to-r from-emerald-50/70 to-white pb-4"><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-emerald-700"/>Documents &amp; Verification</CardTitle><CardDescription>Driving licence verification for delivery eligibility.</CardDescription></CardHeader><CardContent className="space-y-4 pt-4">
            <div className="flex items-center justify-between gap-3"><div><p className="font-semibold">Driving licence</p><p className="text-sm text-muted-foreground">{dlStatus==="verified"?"Verified by admin.":dlStatus==="submitted"?"Submitted and awaiting review.":dlStatus==="rejected"?"Rejected. Please submit a clear copy.":"Not submitted yet."}</p></div><Badge variant={dlBadgeVariant}>{dlBadgeLabel}</Badge></div>
            {(dlPreview||drivingLicense?.photoUrl)&&<div className="rounded-lg border p-2"><img src={dlPreview||`${backendOrigin}${drivingLicense.photoUrl}`} alt="Driving licence" className="mx-auto max-h-40 rounded-md object-contain"/></div>}
            <div className="grid gap-3 sm:grid-cols-2"><div><label className="text-sm font-medium">Driving licence number</label><Input className="mt-1" value={licenseNumber} onChange={e=>setLicenseNumber(e.target.value)} placeholder="Licence number"/></div><div><label className="text-sm font-medium">Expiry date</label><Input className="mt-1" type="date" value={expiryDate} onChange={e=>setExpiryDate(e.target.value)}/></div></div>
            <input ref={dlFileRef} type="file" accept="image/*" className="hidden" onChange={handleDrivingLicenseSelect}/><div className="flex flex-wrap items-center gap-2"><Button variant="outline" onClick={()=>dlFileRef.current?.click()}><Camera className="mr-2 h-4 w-4"/>Choose photo</Button>{dlFile&&<span className="text-xs text-muted-foreground">{dlFile.name}</span>}<Button className="ml-auto bg-emerald-700 hover:bg-emerald-800" onClick={handleUploadDrivingLicense} disabled={uploadingDl||!dlFile}>{uploadingDl?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<UploadCloud className="mr-2 h-4 w-4"/>}Submit for verification</Button></div>
          </CardContent></Card>
        </div>

        <div className="space-y-5">
          <Card className="overflow-hidden"><CardHeader className="border-b bg-gradient-to-r from-emerald-50/70 to-white pb-4"><CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-700"/>Account &amp; Security</CardTitle><CardDescription>Review your account verification and delivery access status.</CardDescription></CardHeader><CardContent className="pt-4"><VerificationStatusCard/></CardContent></Card>

          <Card className="overflow-hidden border-emerald-200/70"><CardHeader className="border-b bg-gradient-to-r from-emerald-50/70 to-white pb-4"><CardTitle className="flex items-center gap-2"><Wallet className="h-5 w-5 text-emerald-700"/>Payment Method &amp; Payout Preferences</CardTitle><CardDescription>Manage where and how you receive your delivery earnings.</CardDescription></CardHeader><CardContent className="space-y-5 pt-4">
            <div><p className="mb-2 text-sm font-semibold">Choose payment method</p><div className="grid gap-3 sm:grid-cols-2">
              {(["bank_transfer","upi"] as const).map(method=><button key={method} type="button" onClick={()=>setPayout(s=>({...s,paymentMethod:method}))} className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${payout.paymentMethod===method?"border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500":"border-slate-200 hover:border-emerald-300"}`}><span className="rounded-lg bg-emerald-100 p-2 text-emerald-700"><Wallet className="h-5 w-5"/></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{method==="bank_transfer"?"Bank Transfer":"UPI"}</span><span className="block text-xs text-muted-foreground">{method==="bank_transfer"?"Use your registered bank account":"Receive payouts using your UPI ID"}</span></span>{payout.paymentMethod===method&&<CheckCircle2 className="h-5 w-5 text-emerald-600"/>}</button>)}
            </div></div>
            {payout.paymentMethod==="upi"?<div><label className="text-sm font-medium">UPI ID</label><Input className="mt-1" value={payout.upiId} onChange={e=>setPayout(s=>({...s,upiId:e.target.value}))} placeholder="name@bank"/></div>:<div className="flex items-center gap-3 rounded-xl bg-emerald-50 p-3 text-sm"><Wallet className="h-5 w-5 text-emerald-700"/><div><p className="font-semibold">Registered bank account</p><p className="text-xs text-muted-foreground">Payouts use the bank account registered in your AgriConnect profile. Bank details and verification are managed through your account records.</p></div></div>}
            <div className="grid gap-4 sm:grid-cols-2"><div><label className="text-sm font-medium">Minimum withdrawal (₹)</label><Input type="number" min="1" className="mt-1" value={payout.minWithdrawal} onChange={e=>setPayout(s=>({...s,minWithdrawal:Math.max(0,Number(e.target.value))}))}/><p className="mt-1 text-xs text-muted-foreground">Minimum eligible balance required to request a payout.</p></div><div className="flex items-center justify-between gap-3 rounded-xl border p-3"><div><p className="text-sm font-semibold">Auto-withdraw</p><p className="text-xs text-muted-foreground">Request payout when your eligible balance reaches the configured minimum.</p></div><button type="button" role="switch" aria-checked={payout.autoWithdraw} aria-label="Toggle auto-withdraw" onClick={()=>setPayout(s=>({...s,autoWithdraw:!s.autoWithdraw}))} className="relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2" style={{backgroundColor:payout.autoWithdraw?"#059669":"#cbd5e1"}}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${payout.autoWithdraw?"left-[22px]":"left-0.5"}`}/></button></div></div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="text-xs text-muted-foreground">Changes apply after they are successfully saved.</p><div className="flex gap-2"><Button type="button" variant="outline" onClick={()=>setPayout({paymentMethod:settingsData?.data?.payout?.paymentMethod||"bank_transfer",upiId:settingsData?.data?.payout?.upiId||"",minWithdrawal:Number(settingsData?.data?.payout?.minWithdrawal??200),autoWithdraw:Boolean(settingsData?.data?.payout?.autoWithdraw)})} disabled={savingPrefs}>Cancel changes</Button><Button className="bg-emerald-700 hover:bg-emerald-800" onClick={handleSavePrefs} disabled={savingPrefs||payout.minWithdrawal<1||(payout.paymentMethod==="upi"&&!payout.upiId.trim())}>{savingPrefs?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Save className="mr-2 h-4 w-4"/>}Save changes</Button></div></div>
          </CardContent></Card>

          <Card className="overflow-hidden"><CardHeader className="border-b bg-gradient-to-r from-emerald-50/70 to-white pb-4"><CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5 text-emerald-700"/>Availability &amp; Working Hours</CardTitle><CardDescription>Control when you can receive new delivery assignments.</CardDescription></CardHeader><CardContent className="space-y-4 pt-4">
            <div className="flex items-center justify-between rounded-xl border p-3"><div><p className="font-semibold">Online mode</p><p className="text-xs text-muted-foreground">Accept new delivery assignments when enabled.</p></div><div className="flex items-center gap-2"><Badge variant={isAvailable?"success":"secondary"}>{isAvailable===null?"Loading":isAvailable?"Online":"Offline"}</Badge><Button size="sm" variant="outline" onClick={handleToggleAvailability} disabled={isAvailable===null||isSavingAvailability}>{isAvailable?"Go Offline":"Go Online"}</Button></div></div>
            <div className="space-y-2"><p className="text-sm font-semibold">Weekly working hours</p>{WEEK_DAYS.map(day=>{const hours=workingHours[day]||{start:"09:00",end:"18:00",off:false};return <div key={day} className="flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm"><span className="w-24 shrink-0 font-medium">{day}</span><Switch checked={!hours.off} onCheckedChange={on=>setWorkingHours(current=>({...current,[day]:{...hours,off:!on}}))} aria-label={`${day} available`}/>{hours.off?<span className="text-xs text-muted-foreground">Day off</span>:<div className="ml-auto flex items-center gap-2"><input type="time" value={hours.start} onChange={e=>setWorkingHours(current=>({...current,[day]:{...hours,start:e.target.value}}))} className="h-8 rounded-md border px-2 text-xs"/><span className="text-muted-foreground">to</span><input type="time" value={hours.end} onChange={e=>setWorkingHours(current=>({...current,[day]:{...hours,end:e.target.value}}))} className="h-8 rounded-md border px-2 text-xs"/></div>}</div>})}</div>
            <div className="flex justify-end"><Button onClick={handleSavePrefs} disabled={savingPrefs}>{savingPrefs?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Save className="mr-2 h-4 w-4"/>}Save availability preferences</Button></div>
          </CardContent></Card>
        </div>
      </div>
    </div>
  );
}
