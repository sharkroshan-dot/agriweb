"use client";

import { useState, useRef, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { Camera, Loader2, Save, X, CheckCircle, AlertCircle, User, Pencil, MapPin, ShieldCheck, Mail, Phone, ChevronRight, Bell, LockKeyhole, SlidersHorizontal, Zap } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { api } from "../../lib/api/client";
import AddressesPage from "./addresses/page";

function getField(obj: any, ...keys: string[]) {
  for (const key of keys) {
    const val = obj?.[key];
    if (val !== undefined && val !== null) return val;
  }
  return "";
}

export default function CustomerProfilePage() {
  const { data: session, update: updateSession } = useSession();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const { data: profileData, isLoading, isError, error: profileError, refetch } = useQuery({
    queryKey: ["myProfile"],
    queryFn: () => api.get("/users/me"),
  });

  const user = profileData?.user;
  const role = getField(user, "role");
  const displayName = [getField(user, "first_name", "firstName"), getField(user, "last_name", "lastName")].filter(Boolean).join(" ") || "User";
  const email = getField(user, "email");

  useEffect(() => {
    if (user) {
      setFirstName(getField(user, "first_name", "firstName"));
      setLastName(getField(user, "last_name", "lastName"));
      setPhone(getField(user, "phone"));
      setAvatarUrl(getField(user, "avatar_url", "avatarUrl"));
    }
  }, [user]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(t);
  }, [message]);

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setMessage({ type: "error", text: "Image must be under 5MB" });
      return;
    }
    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = () => setAvatarPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const uploadAvatar = async (): Promise<string | undefined> => {
    if (!avatarFile) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("avatar", avatarFile);
      const res = await fetch("/api/upload/avatar", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");
      setAvatarUrl(json.data.avatarUrl);
      setAvatarFile(null);
      setAvatarPreview(null);
      return json.data.avatarUrl;
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Upload failed" });
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      let newAvatarUrl: string | undefined;
      if (avatarFile) {
        newAvatarUrl = await uploadAvatar();
      }
      const body: Record<string, any> = {};
      const origFirstName = getField(user, "first_name", "firstName");
      const origLastName = getField(user, "last_name", "lastName");
      const origPhone = getField(user, "phone");
      if (firstName !== origFirstName) body.first_name = firstName;
      if (lastName !== origLastName) body.last_name = lastName;
      if (phone !== origPhone) body.phone = phone;
      if (Object.keys(body).length > 0) {
        await api.put("/users/me", body);
      }
      const url = newAvatarUrl || avatarUrl || getField(user, "avatar_url", "avatarUrl");
      updateSession({ image: url });
      if (url) window.dispatchEvent(new CustomEvent("avatar-updated", { detail: url }));
      setEditing(false);
      setMessage({ type: "success", text: "Profile saved" });
    } catch (err: any) {
      let text = "Failed to save";
      try { const j = JSON.parse(err.message); text = j.detail || j.message || text; } catch {}
      setMessage({ type: "error", text });
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = firstName !== getField(user, "first_name", "firstName") ||
    lastName !== getField(user, "last_name", "lastName") ||
    phone !== getField(user, "phone") ||
    avatarFile !== null;

  const handleCancel = () => {
    if (user) {
      setFirstName(getField(user, "first_name", "firstName"));
      setLastName(getField(user, "last_name", "lastName"));
      setPhone(getField(user, "phone"));
    }
    setAvatarFile(null);
    setAvatarPreview(null);
    setEditing(false);
    setMessage(null);
  };

  const startEditing = () => {
    if (user) {
      setFirstName(getField(user, "first_name", "firstName"));
      setLastName(getField(user, "last_name", "lastName"));
      setPhone(getField(user, "phone"));
    }
    setAvatarFile(null);
    setAvatarPreview(null);
    setEditing(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex flex-col items-center gap-4 rounded-lg border border-red-200 bg-red-50 p-8 text-center">
          <AlertCircle className="h-10 w-10 text-red-500" />
          <div>
            <h2 className="text-lg font-semibold text-red-800">Failed to load profile</h2>
            <p className="mt-1 text-sm text-red-600">{profileError instanceof Error ? profileError.message : "Unknown error"}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const currentAvatar = avatarPreview || avatarUrl;
  const createdAt = getField(user, "created_at", "createdAt");
  const memberSince = createdAt ? new Date(createdAt).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" }) : null;
  const isVerified = getField(user, "is_verified", "isVerified") === true || getField(user, "is_verified", "isVerified") === "true";
  const isActive = getField(user, "is_active", "isActive") !== false && getField(user, "is_active", "isActive") !== "false";

  const phoneVerified = getField(user, "phone_verified", "is_phone_verified", "phoneVerified") === true;
  return (
    <div className="space-y-4 px-3 py-4 sm:px-5 lg:px-6">
      {message && <div className={`rounded-xl border px-4 py-3 text-sm ${message.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>{message.text}</div>}
      <header className="relative isolate min-h-[112px] overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-r from-white via-emerald-50 to-sky-100 px-5 py-5 shadow-sm sm:min-h-[126px] sm:px-7">
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-[68%] overflow-hidden"><div className="absolute inset-0 bg-gradient-to-r from-white via-white/45 to-transparent" /><div className="absolute -bottom-12 right-[-5%] h-28 w-[110%] -rotate-3 rounded-[50%] bg-gradient-to-b from-lime-300 to-emerald-500 opacity-75" /><div className="absolute -bottom-14 right-[18%] h-32 w-[65%] -rotate-6 rounded-[50%] bg-gradient-to-b from-sky-200 via-emerald-200 to-green-500 opacity-80" /></div>
        <div className="relative z-10 flex items-center gap-4"><div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 ring-4 ring-white/70"><User className="h-9 w-9" /></div><div><h1 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">My Profile</h1><p className="mt-1 text-sm font-medium text-slate-700">Manage your personal information, verification and saved addresses.</p></div></div>
      </header>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(300px,0.9fr)]">
        <div className="min-w-0 space-y-3">
          <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:px-6 sm:py-5">
            <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-sky-100 to-emerald-50 ring-1 ring-slate-200">{currentAvatar ? <img src={currentAvatar} alt="Profile" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-emerald-700"><User className="h-14 w-14" /></div>}{editing && <button type="button" onClick={() => fileInputRef.current?.click()} className="absolute bottom-1 right-1 flex h-9 w-9 items-center justify-center rounded-full bg-emerald-700 text-white shadow-md"><Camera className="h-4 w-4" /></button>}<input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarSelect} /></div>
            <div className="min-w-0 flex-1"><h2 className="text-xl font-bold text-slate-950 sm:text-2xl">{displayName}</h2><Badge className="mt-2 border-0 bg-emerald-100 text-emerald-800">Customer</Badge>{memberSince && <p className="mt-2 text-sm text-slate-700">▦ &nbsp;Member since {memberSince}</p>}</div>
            {!editing ? <Button variant="outline" className="shrink-0 border-emerald-600 text-emerald-800" onClick={startEditing}><Pencil className="mr-2 h-4 w-4" />Edit Profile</Button> : <div className="flex gap-2"><Button size="sm" onClick={handleSave} disabled={saving || uploading}>{(saving || uploading) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save</Button><Button size="sm" variant="outline" onClick={handleCancel}><X className="mr-1 h-4 w-4" />Cancel</Button></div>}
          </CardContent></Card>

          <Card className="rounded-2xl border-slate-200 shadow-sm"><CardHeader className="pb-3"><CardTitle className="flex items-center gap-3 text-lg"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><User className="h-5 w-5" /></span>Personal Information</CardTitle></CardHeader><CardContent className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
            <div><p className="mb-1.5 text-xs font-semibold">First Name *</p>{editing ? <Input value={firstName} onChange={e => setFirstName(e.target.value)} /> : <div className="rounded-lg border bg-slate-50 px-3 py-2.5 text-sm font-medium">{firstName || "Not provided"}</div>}</div>
            <div><p className="mb-1.5 text-xs font-semibold">Last Name *</p>{editing ? <Input value={lastName} onChange={e => setLastName(e.target.value)} /> : <div className="rounded-lg border bg-slate-50 px-3 py-2.5 text-sm font-medium">{lastName || "Not provided"}</div>}</div>
            <div><p className="mb-1.5 flex items-center gap-2 text-xs font-semibold"><Mail className="h-4 w-4" />Email Address *</p><div className="flex items-center justify-between gap-2 rounded-lg border bg-slate-50 px-3 py-2.5"><span className="truncate text-sm font-medium">{email || "Not provided"}</span><Badge className={isVerified ? "border-0 bg-emerald-100 text-emerald-800" : "border-0 bg-amber-100 text-amber-800"}>{isVerified ? "✓ Verified" : "Unverified"}</Badge></div></div>
            <div><p className="mb-1.5 flex items-center gap-2 text-xs font-semibold"><Phone className="h-4 w-4" />Phone Number *</p>{editing ? <Input value={phone} onChange={e => setPhone(e.target.value)} /> : <div className="flex items-center justify-between gap-2 rounded-lg border bg-slate-50 px-3 py-2.5"><span className="truncate text-sm font-medium">{phone || "Not provided"}</span><Badge className={phoneVerified ? "border-0 bg-emerald-100 text-emerald-800" : "border-0 bg-slate-100 text-slate-700"}>{phoneVerified ? "✓ Verified" : "On file"}</Badge></div>}</div>
          </CardContent></Card>

          <Card className="rounded-2xl border-slate-200 shadow-sm"><CardHeader className="pb-2"><CardTitle className="flex items-center gap-3 text-lg"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><MapPin className="h-5 w-5" /></span>Saved Addresses</CardTitle><CardDescription className="ml-[52px]">Manage your delivery addresses for a faster checkout.</CardDescription></CardHeader><CardContent className="px-4 pb-4 sm:px-5"><AddressesPage embedded /></CardContent></Card>
        </div>

        <aside className="space-y-3">
          <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="flex items-start gap-4 p-5"><span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><ShieldCheck className="h-7 w-7" /></span><div><h2 className="text-lg font-bold">Account Status</h2><Badge className={`mt-2 border-0 ${isActive ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>{isActive ? "Active" : "Inactive"}</Badge><p className="mt-2 text-sm text-slate-600">{isActive ? "Your account is active and in good standing." : "Your account is currently inactive."}</p></div></CardContent></Card>
          <Card className="rounded-2xl border-slate-200 shadow-sm"><CardHeader className="pb-2"><CardTitle className="flex items-center gap-3 text-lg"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><CheckCircle className="h-6 w-6" /></span>Verification Status</CardTitle></CardHeader><CardContent className="space-y-3 px-5 pb-4"><div className="flex items-center justify-between border-b pb-2"><span className="flex items-center gap-3 text-sm font-medium"><Mail className="h-4 w-4 text-emerald-700" />Email Verified</span><Badge className={isVerified ? "border-0 bg-emerald-100 text-emerald-800" : "border-0 bg-amber-100 text-amber-800"}>{isVerified ? "✓" : "Pending"}</Badge></div><div className="flex items-center justify-between"><span className="flex items-center gap-3 text-sm font-medium"><Phone className="h-4 w-4 text-emerald-700" />Phone Verified</span><Badge className={phoneVerified ? "border-0 bg-emerald-100 text-emerald-800" : "border-0 bg-slate-100 text-slate-700"}>{phoneVerified ? "✓" : phone ? "On file" : "Not added"}</Badge></div></CardContent></Card>
          <Card className="rounded-2xl border-slate-200 shadow-sm"><CardHeader className="pb-2"><CardTitle className="flex items-center gap-3 text-lg"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Zap className="h-6 w-6" /></span>Quick Actions</CardTitle></CardHeader><CardContent className="px-4 pb-3">{[{label:"Change Password",href:"/settings#security",icon:LockKeyhole},{label:"Notification Settings",href:"/settings#notifications",icon:Bell},{label:"Privacy & Data",href:"/settings#privacy",icon:ShieldCheck},{label:"Account Preferences",href:"/settings#preferences",icon:SlidersHorizontal}].map(({label,href,icon:Icon}) => <a key={href} href={href} className="flex items-center gap-3 border-b border-slate-100 px-1 py-3 text-sm font-semibold text-slate-800 hover:text-emerald-700 last:border-0"><Icon className="h-5 w-5" /><span className="flex-1">{label}</span><ChevronRight className="h-4 w-4 text-slate-400" /></a>)}</CardContent></Card>
        </aside>
      </div>
    </div>
  );
}
