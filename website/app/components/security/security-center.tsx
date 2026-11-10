"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { QRCodeSVG } from "qrcode.react";
import {
  Check, Copy, KeyRound, Laptop, Loader2, Lock, LogOut, QrCode,
  ShieldAlert, ShieldCheck, Smartphone, Activity, Clock3, Monitor,
  MapPin, CircleCheck, AlertTriangle, Fingerprint, Mail, Phone,
} from "lucide-react";
import toast from "react-hot-toast";

interface SessionInfo {
  id?: string;
  jti?: string;
  device?: string;
  ip?: string;
  userAgent?: string;
  createdAt?: string;
  lastSeenAt?: string;
  expiresAt?: string;
}

interface SecurityCenterData {
  userId: string;
  role: string;
  mfaEnabled: boolean;
  activeSessions: number;
  sessions: SessionInfo[];
  riskScore: number;
  riskLevel: string;
  riskFlags: string[];
  verification: Record<string, boolean>;
  trustScore: number;
  lastLoginAt?: string;
  currentJti?: string;
}

const RISK_STYLES: Record<string, string> = {
  low: "border-emerald-200 bg-emerald-50 text-emerald-700",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  high: "border-red-200 bg-red-50 text-red-700",
};

const formatDate = (value?: string) => {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString();
};

const getDeviceIcon = (device?: string, userAgent?: string) => {
  const value = `${device || ""} ${userAgent || ""}`.toLowerCase();
  return /mobile|android|iphone|ipad/.test(value) ? Smartphone : Monitor;
};

const getDeviceLabel = (device?: string, userAgent?: string) => {
  const ua = (userAgent || "").toLowerCase();
  const os = ua.includes("windows") ? "Windows" : ua.includes("android") ? "Android" : /iphone|ipad/.test(ua) ? "iOS" : ua.includes("mac os") ? "macOS" : ua.includes("linux") ? "Linux" : "";
  const browser = ua.includes("edg/") ? "Edge" : ua.includes("chrome/") ? "Chrome" : ua.includes("firefox/") ? "Firefox" : ua.includes("safari/") ? "Safari" : "";
  if (os && browser) return `${os} · ${browser}`;
  if (device && !device.toLowerCase().includes("unknown")) return device;
  return "Device details unavailable";
};

export function SecurityCenter() {
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken;
  const queryClient = useQueryClient();
  const [totpCode, setTotpCode] = useState("");
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const { data, isLoading, isError, refetch } = useQuery<SecurityCenterData>({
    queryKey: ["securityCenter"],
    queryFn: async () => {
      const res = await api.get("/auth/security-center");
      return (res as any)?.data ?? (res as any) ?? {};
    },
    enabled: Boolean(accessToken),
  });

  const setupMfa = useMutation({
    mutationFn: () => api.post("/auth/2fa/setup"),
    onSuccess: (res: any) => {
      const d = res?.data ?? res ?? {};
      setSetup({ secret: d.secret, otpauthUrl: d.otpauthUrl });
      toast.success("Scan the QR with your authenticator app");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to start 2FA setup"),
  });

  const cancelMfaSetup = useMutation({
    mutationFn: () => api.post("/auth/2fa/cancel-setup", {}),
    onSuccess: () => {
      setSetup(null);
      setTotpCode("");
      toast.success("Two-factor setup cancelled");
      queryClient.invalidateQueries({ queryKey: ["securityCenter"] });
    },
    onError: (err: any) => toast.error(err?.message || "Could not cancel 2FA setup"),
  });

  const enableMfa = useMutation({
    mutationFn: (code: string) => api.post("/auth/2fa/enable", { code }),
    onSuccess: () => {
      toast.success("Two-factor authentication enabled");
      setTotpCode("");
      setSetup(null);
      queryClient.invalidateQueries({ queryKey: ["securityCenter"] });
    },
    onError: (err: any) => toast.error(err?.message || "Invalid code — check your authenticator app"),
  });

  const disableMfa = useMutation({
    mutationFn: (code: string) => api.post("/auth/2fa/disable", { code }),
    onSuccess: () => {
      toast.success("Two-factor authentication disabled");
      setTotpCode("");
      queryClient.invalidateQueries({ queryKey: ["securityCenter"] });
    },
    onError: (err: any) => toast.error(err?.message || "Invalid code"),
  });

  const changePassword = useMutation({
    mutationFn: () => api.post("/auth/change-password", { currentPassword, newPassword }),
    onSuccess: () => {
      toast.success("Password changed. Other devices have been signed out.");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setShowPasswordForm(false);
      queryClient.invalidateQueries({ queryKey: ["securityCenter"] });
    },
    onError: (err: any) => toast.error(err?.message || "Unable to change password"),
  });

  const revokeSession = useMutation({
    mutationFn: (jti: string) => api.post(`/auth/sessions/${encodeURIComponent(jti)}/revoke`, {}),
    onSuccess: () => {
      toast.success("Device session revoked");
      queryClient.invalidateQueries({ queryKey: ["securityCenter"] });
    },
    onError: (err: any) => toast.error(err?.message || "Unable to revoke this session"),
  });

  const { data: activity = [], isLoading: activityLoading } = useQuery<any[]>({
    queryKey: ["securityActivity"],
    queryFn: async () => {
      const res = await api.get("/auth/security-activity?limit=30");
      return (res as any)?.data ?? [];
    },
    enabled: Boolean(accessToken),
  });

  const copySecret = async (secret: string) => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Clipboard access is unavailable in this browser");
    }
  };

  const revokeAll = useMutation({
    mutationFn: () => api.post("/auth/sessions/revoke-all", {}),
    onSuccess: () => {
      toast.success("Other sessions revoked");
      queryClient.invalidateQueries({ queryKey: ["securityCenter"] });
    },
    onError: (err: any) => toast.error(err?.message || "Failed to revoke sessions"),
  });

  if (isLoading) {
    return <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="flex items-center gap-3 py-10 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" />Loading your security information…</CardContent></Card>;
  }

  if (isError || !data) {
    return <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="flex flex-col items-start gap-3 py-8"><p className="text-sm text-slate-600">We couldn't load your security information.</p><Button variant="outline" onClick={() => refetch()}>Try again</Button></CardContent></Card>;
  }

  const verification = data.verification || {};
  const verified = Object.values(verification).filter(Boolean).length;
  const verifiedTotal = Object.keys(verification).length;
  const sessions = data.sessions || [];
  const riskLevel = (data.riskLevel || "unknown").toLowerCase();
  const riskStyle = RISK_STYLES[riskLevel] || "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <div className="space-y-5 pb-8">
      <section className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        <Card className="overflow-hidden rounded-2xl border-emerald-100 shadow-sm">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><ShieldCheck className="h-6 w-6" /></div>
            <div className="min-w-0"><p className="text-xs font-medium text-slate-500">Account risk score</p><div className="mt-1 flex items-center gap-2"><span className="text-2xl font-bold text-slate-900">{data.riskScore ?? "—"}<span className="text-sm font-medium text-slate-400">/100</span></span><Badge className={riskStyle}>{riskLevel}</Badge></div><p className="mt-0.5 text-xs text-slate-500">Lower risk is better</p></div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="flex items-center gap-4 p-4"><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sky-50 text-sky-700"><Laptop className="h-6 w-6" /></div><div><p className="text-xs font-medium text-slate-500">Active sessions</p><p className="mt-1 text-2xl font-bold text-slate-900">{data.activeSessions ?? sessions.length}</p><p className="text-xs text-slate-500">Currently signed-in sessions</p></div></CardContent></Card>
        <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="flex items-center gap-4 p-4"><div className={`flex h-12 w-12 items-center justify-center rounded-xl ${data.mfaEnabled ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}><KeyRound className="h-6 w-6" /></div><div><p className="text-xs font-medium text-slate-500">Two-factor authentication</p><p className="mt-1 text-lg font-bold text-slate-900">{data.mfaEnabled ? "Enabled" : "Not enabled"}</p><p className="text-xs text-slate-500">Extra login protection</p></div></CardContent></Card>
        <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="flex items-center gap-4 p-4"><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-50 text-violet-700"><Fingerprint className="h-6 w-6" /></div><div><p className="text-xs font-medium text-slate-500">Verified details</p><p className="mt-1 text-2xl font-bold text-slate-900">{verifiedTotal ? <>{verified}<span className="text-sm font-medium text-slate-400">/{verifiedTotal}</span></> : "—"}</p><p className="text-xs text-slate-500">{verifiedTotal ? "Identity checks recorded" : "Verification data unavailable"}</p></div></CardContent></Card>
      </section>

      <div className="grid items-start gap-5 2xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.4fr)]">
        <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-emerald-100 bg-emerald-50/50 pb-4">
            <CardTitle className="flex items-center gap-2 text-base text-slate-900"><Lock className="h-5 w-5 text-emerald-700" />Account protection</CardTitle>
            <CardDescription>Manage the additional protection for your AgriConnect login.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 p-4">
              <div className="flex gap-3"><div className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><KeyRound className="h-5 w-5" /></div><div><p className="text-sm font-semibold text-slate-800">Two-factor authentication</p><p className="mt-1 text-xs leading-5 text-slate-500">Use an authenticator app code as an extra step when signing in.</p></div></div>
              <Badge className={data.mfaEnabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}>{data.mfaEnabled ? "Enabled" : "Off"}</Badge>
            </div>
            {data.mfaEnabled ? (
              <div className="space-y-3"><p className="text-xs text-slate-600">To turn off 2FA, enter the current code from your authenticator app.</p><div className="flex flex-col gap-2 sm:flex-row"><input value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6-digit authenticator code" className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" inputMode="numeric" maxLength={6} /><Button variant="outline" disabled={totpCode.length !== 6 || disableMfa.isPending} onClick={() => disableMfa.mutate(totpCode)}>{disableMfa.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Disable 2FA</Button></div></div>
            ) : setup ? (
              <div className="space-y-4 rounded-xl border border-emerald-100 bg-emerald-50/40 p-4">
                <p className="text-sm font-medium text-slate-800">1. Scan this QR code in your authenticator app.</p>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start"><div className="w-fit rounded-xl border bg-white p-3"><QRCodeSVG value={setup.otpauthUrl} size={148} /></div><div className="min-w-0 flex-1 space-y-3"><div><p className="text-xs font-medium text-slate-600">Or enter this setup key manually</p><div className="mt-1 flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded-lg bg-white px-3 py-2 text-xs">{setup.secret}</code><Button variant="outline" size="sm" onClick={() => copySecret(setup.secret)}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? "Copied" : "Copy"}</Button></div></div><p className="text-sm font-medium text-slate-800">2. Enter the 6-digit code to verify and enable.</p><input value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6-digit code" className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" inputMode="numeric" maxLength={6} /><div className="flex flex-wrap gap-2"><Button disabled={totpCode.length !== 6 || enableMfa.isPending} onClick={() => enableMfa.mutate(totpCode)}>{enableMfa.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Verify and enable</Button><Button variant="outline" disabled={cancelMfaSetup.isPending} onClick={() => cancelMfaSetup.mutate()}>{cancelMfaSetup.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Cancel setup</Button></div></div></div>
              </div>
            ) : (
              <Button disabled={setupMfa.isPending} onClick={() => setupMfa.mutate()} className="w-full bg-emerald-700 hover:bg-emerald-800">{setupMfa.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <QrCode className="mr-2 h-4 w-4" />}Set up two-factor authentication</Button>
            )}
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-slate-800">Password</p><p className="mt-1 text-xs text-slate-500">Change your password regularly and never reuse it.</p></div><Button size="sm" variant="outline" onClick={() => setShowPasswordForm((v) => !v)}>{showPasswordForm ? "Cancel" : "Change password"}</Button></div>
              {showPasswordForm && <div className="mt-4 space-y-2">
                <input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Current password" className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" />
                <input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password (8+ characters, upper/lowercase, number and symbol)" className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" />
                <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm new password" className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" />
                <Button className="w-full" disabled={!currentPassword || newPassword.length < 8 || newPassword !== confirmPassword || changePassword.isPending} onClick={() => changePassword.mutate()}>{changePassword.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Update password</Button>
                {newPassword && confirmPassword && newPassword !== confirmPassword && <p className="text-xs text-red-600">Passwords do not match.</p>}
              </div>}
            </div>
            <div className="rounded-xl bg-slate-50 p-3"><p className="flex items-center gap-2 text-xs font-semibold text-slate-700"><AlertTriangle className="h-4 w-4 text-amber-600" />Keep your authenticator app accessible</p><p className="mt-1 text-xs leading-5 text-slate-500">You will need its current code to disable two-factor authentication later.</p></div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-emerald-100 bg-emerald-50/50 pb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="flex items-center gap-2 text-base text-slate-900"><Laptop className="h-5 w-5 text-emerald-700" />Devices and active sessions</CardTitle><CardDescription className="mt-1">Review sessions that have not expired or been revoked.</CardDescription></div><div className="flex items-center gap-2"><Badge variant="outline">{data.activeSessions ?? sessions.length} active</Badge>{(data.activeSessions ?? sessions.length) > 1 && <Button size="sm" variant="outline" className="border-red-200 text-red-700 hover:bg-red-50" disabled={revokeAll.isPending} onClick={() => { if (window.confirm("Sign out all other devices? You may need to sign in again on those devices.")) revokeAll.mutate(); }}>{revokeAll.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <LogOut className="mr-1 h-4 w-4" />}Sign out others</Button>}</div></div>
          </CardHeader>
          <CardContent className="p-5">
            {(data.activeSessions ?? sessions.length) > 5 && <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" /><div><p className="text-sm font-semibold text-amber-900">Many active sessions detected</p><p className="mt-1 text-xs leading-5 text-amber-800">There are {data.activeSessions ?? sessions.length} active sessions on your account. Review the devices below and sign out of any you do not recognize.</p></div></div>}
            {sessions.length ? <div className="max-h-[430px] space-y-3 overflow-y-auto pr-1">{sessions.map((item, index) => { const DeviceIcon = getDeviceIcon(item.device, item.userAgent); return <div key={item.id || item.jti || index} className="flex min-w-0 items-start gap-3 rounded-xl border border-slate-200 p-3"><div className="rounded-lg bg-slate-100 p-2 text-slate-600"><DeviceIcon className="h-5 w-5" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="break-words text-sm font-semibold text-slate-800">{getDeviceLabel(item.device, item.userAgent)}</p>{item.jti === data.currentJti && <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">This device</Badge>}{item.jti !== data.currentJti && index === 0 && <Badge variant="outline">Most recent session</Badge>}</div><p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-500"><MapPin className="h-3 w-3" />{item.ip || "IP unavailable"}</p><p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Clock3 className="h-3 w-3" />Last active: {formatDate(item.lastSeenAt)}</p></div>{item.jti && item.jti !== data.currentJti && <Button size="sm" variant="outline" className="shrink-0 border-red-200 text-red-700 hover:bg-red-50" disabled={revokeSession.isPending} onClick={() => { if (window.confirm("Revoke this device session?")) revokeSession.mutate(item.jti!); }}>Revoke</Button>}</div>; })}</div> : <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center"><Laptop className="mx-auto h-8 w-8 text-slate-400" /><p className="mt-2 text-sm font-medium text-slate-700">No session details available</p><p className="mt-1 text-xs text-slate-500">Your signed-in devices will appear here when available.</p></div>}
            {(data.activeSessions ?? sessions.length) > 1 && <p className="mt-3 text-xs text-slate-500">Signing out other devices keeps your current session active. You may need to sign in again on those devices.</p>}
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
        <CardHeader className="border-b border-emerald-100 bg-emerald-50/50 pb-3"><CardTitle className="flex items-center gap-2 text-base"><Activity className="h-5 w-5 text-emerald-700" />Security activity</CardTitle><CardDescription>Recent sign-ins and account security changes.</CardDescription></CardHeader>
        <CardContent className="p-5">
          {activityLoading ? <p className="text-sm text-slate-500">Loading security activity…</p> : activity.length ? <div className="space-y-2">{activity.map((event: any) => <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2"><div><p className="text-sm font-medium capitalize text-slate-800">{String(event.action || "Security event").replace(/_/g, " ")}</p><p className="text-xs text-slate-500">{event.ip || "IP unavailable"}</p></div><div className="text-right"><Badge className={event.outcome === "failure" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}>{event.outcome}</Badge><p className="mt-1 text-xs text-slate-500">{formatDate(event.createdAt)}</p></div></div>)}</div> : <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center"><Activity className="mx-auto h-7 w-7 text-slate-400" /><p className="mt-2 text-sm font-medium text-slate-700">No security events yet</p><p className="mt-1 text-xs text-slate-500">New sign-ins and security changes will appear here.</p></div>}
        </CardContent>
      </Card>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-emerald-100 bg-emerald-50/50 pb-3"><CardTitle className="flex items-center gap-2 text-base"><Activity className="h-5 w-5 text-emerald-700" />Security overview</CardTitle><CardDescription>Account verification and recent sign-in information returned by your account.</CardDescription></CardHeader>
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center justify-between rounded-xl border p-3"><span className="text-sm text-slate-600">Trust score</span><span className="text-sm font-semibold text-slate-600">{typeof data.trustScore === "number" && data.trustScore > 0 ? <>{data.trustScore}<span className="text-sm font-medium text-slate-400">/100</span></> : "Not available"}</span></div>
            <div className="flex items-center justify-between rounded-xl border p-3"><span className="text-sm text-slate-600">Last login</span><span className="text-right text-xs font-medium text-slate-700">{formatDate(data.lastLoginAt)}</span></div>
            <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Verification checks</p>{verifiedTotal ? <div className="space-y-2">{Object.entries(verification).map(([key, value]) => <div key={key} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"><span className="text-sm capitalize text-slate-700">{key.replace(/([A-Z])/g, " $1").replace(/_/g, " ")}</span>{value ? <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700"><CircleCheck className="mr-1 h-3 w-3" />Verified</Badge> : <Badge variant="outline">Pending</Badge>}</div>)}</div> : <p className="text-sm text-slate-500">No verification checks are available.</p>}</div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-2xl border-emerald-100 bg-gradient-to-br from-white to-emerald-50/70 shadow-sm">
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-5 w-5 text-emerald-700" />Security tips for farmers</CardTitle><CardDescription>Simple habits to help protect your farm account.</CardDescription></CardHeader>
          <CardContent className="space-y-3 p-5 pt-0">
            {["Use a strong, unique password for AgriConnect.", "Enable two-factor authentication for extra login protection.", "Sign out of devices you no longer use.", "Review your active sessions regularly.", "Never share your password or authenticator code with anyone."].map((tip) => <div key={tip} className="flex items-start gap-3 text-sm text-slate-700"><span className="mt-0.5 rounded-full bg-emerald-100 p-1 text-emerald-700"><Check className="h-3 w-3" /></span><span>{tip}</span></div>)}
            {data.riskFlags?.length > 0 && <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="flex items-center gap-2 text-xs font-semibold text-amber-800"><ShieldAlert className="h-4 w-4" />Review these account flags</p><ul className="mt-2 list-inside list-disc space-y-1 text-xs text-amber-800">{data.riskFlags.map((flag) => <li key={flag}>{flag.replace(/_/g, " ")}</li>)}</ul></div>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
