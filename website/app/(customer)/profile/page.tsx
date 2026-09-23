"use client";

import { useState, useRef, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Camera, Loader2, Save, X, CheckCircle, AlertCircle, User, Pencil } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { api } from "../../lib/api/client";

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

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Profile</h1>
        <p className="mt-1 text-sm text-slate-600">Saved preferences and contact details.</p>
      </div>

      {message && (
        <div className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${
          message.type === "success"
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-red-200 bg-red-50 text-red-800"
        }`}>
          {message.type === "success" ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Account</CardTitle>
              <CardDescription>Current session details.</CardDescription>
            </div>
            {!editing && (
              <Button variant="outline" size="sm" onClick={startEditing}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {editing ? (
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <div className="h-16 w-16 overflow-hidden rounded-full bg-slate-100">
                      {currentAvatar ? (
                        <img src={currentAvatar} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-slate-400">
                          <User className="h-8 w-8" />
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-white shadow hover:bg-emerald-700"
                    >
                      <Camera className="h-3 w-3" />
                    </button>
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarSelect} />
                  </div>
                  <p className="text-xs text-slate-500">Click the camera to change photo</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-medium text-slate-600">First Name</label>
                    <Input className="mt-1 h-9 text-sm" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600">Last Name</label>
                    <Input className="mt-1 h-9 text-sm" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600">Phone</label>
                  <Input className="mt-1 h-9 text-sm" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600">Email</label>
                  <Input className="mt-1 h-9 text-sm" value={email} disabled />
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <Button size="sm" onClick={handleSave} disabled={saving || uploading}>
                    {(saving || uploading) && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                    <Save className="mr-1.5 h-3.5 w-3.5" /> Save
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleCancel}>
                    <X className="mr-1.5 h-3.5 w-3.5" /> Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-4">
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-slate-100">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="" className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }} />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-slate-400">
                        <User className="h-7 w-7" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{displayName}</p>
                    <p className="truncate text-xs text-muted-foreground">{email}</p>
                    <Badge variant="outline" className="mt-1 capitalize">{role || "customer"}</Badge>
                  </div>
                </div>
                <div className="border-t pt-3">
                  <dl className="divide-y divide-slate-100">
                    <div className="flex justify-between py-2">
                      <dt className="text-slate-500">First Name</dt>
                      <dd className="font-medium text-slate-900">{getField(user, "first_name", "firstName")}</dd>
                    </div>
                    <div className="flex justify-between py-2">
                      <dt className="text-slate-500">Last Name</dt>
                      <dd className="font-medium text-slate-900">{getField(user, "last_name", "lastName")}</dd>
                    </div>
                    <div className="flex justify-between py-2">
                      <dt className="text-slate-500">Email</dt>
                      <dd className="font-medium text-slate-900 truncate">{email}</dd>
                    </div>
                    <div className="flex justify-between py-2">
                      <dt className="text-slate-500">Phone</dt>
                      <dd className="font-medium text-slate-900">{getField(user, "phone") || "Not set"}</dd>
                    </div>
                    <div className="flex justify-between py-2">
                      <dt className="text-slate-500">Role</dt>
                      <dd className="font-medium text-slate-900 capitalize">{role || "customer"}</dd>
                    </div>
                    <div className="flex justify-between py-2">
                      <dt className="text-slate-500">Verified</dt>
                      <dd className="font-medium">
                        {isVerified ? (
                          <span className="flex items-center gap-1 text-emerald-600"><CheckCircle className="h-3.5 w-3.5" /> Yes</span>
                        ) : (
                          <span className="text-amber-600">No</span>
                        )}
                      </dd>
                    </div>
                    <div className="flex justify-between py-2">
                      <dt className="text-slate-500">Account Status</dt>
                      <dd className="font-medium">
                        {isActive ? (
                          <span className="text-emerald-600">Active</span>
                        ) : (
                          <span className="text-red-600">Inactive</span>
                        )}
                      </dd>
                    </div>
                    {memberSince && (
                      <div className="flex justify-between py-2">
                        <dt className="text-slate-500">Member Since</dt>
                        <dd className="font-medium text-slate-900">{memberSince}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Preferences</CardTitle>
            <CardDescription>Quick toggles for shopping and notifications.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border p-3 text-sm">
              Order updates
              <Button variant="outline" size="sm">Enabled</Button>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3 text-sm">
              Saved addresses
              <Button variant="outline" size="sm" asChild>
                <Link href="/profile/addresses">Manage</Link>
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3 text-sm">
              Settings
              <Button variant="outline" size="sm" asChild>
                <Link href="/settings">Open</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
