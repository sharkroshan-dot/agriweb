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
  Check,
  Copy,
  KeyRound,
  Laptop,
  Loader2,
  Lock,
  LogOut,
  QrCode,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
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
}

const RISK_STYLES: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-700",
  medium: "bg-yellow-100 text-yellow-700",
  high: "bg-red-100 text-red-700",
};

export function SecurityCenter() {
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken;
  const queryClient = useQueryClient();
  const [totpCode, setTotpCode] = useState("");
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery<SecurityCenterData>({
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

  const enableMfa = useMutation({
    mutationFn: (code: string) => api.post("/auth/2fa/enable", { code }),
    onSuccess: () => {
      toast.success("Two-factor authentication enabled");
      setTotpCode("");
      setSetup(null);
      queryClient.invalidateQueries({ queryKey: ["securityCenter"] });
    },
    onError: (err: any) => toast.error(err?.message || "Invalid code — check the code in your authenticator app"),
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

  const copySecret = async (secret: string) => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — ignore
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
    return <Card><CardContent className="py-6 text-sm text-muted-foreground">Loading security center…</CardContent></Card>;
  }

  if (!data) {
    return <Card><CardContent className="py-6 text-sm text-muted-foreground">Security information unavailable.</CardContent></Card>;
  }

  const verified = Object.values(data.verification || {}).filter(Boolean).length;
  const verifiedTotal = Object.keys(data.verification || {}).length;

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-5 w-5 text-emerald-600" />Account security</CardTitle>
          <CardDescription>Risk posture, 2FA and account activity.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <span className="text-sm font-medium">Risk score</span>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold">{data.riskScore}/100</span>
              <Badge className={RISK_STYLES[data.riskLevel] || "bg-slate-100 text-slate-700"}>{data.riskLevel}</Badge>
            </div>
          </div>
          {((data.riskFlags || []).length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Active flags</p>
              {(data.riskFlags || []).map((flag) => (
                <div key={flag} className="flex items-center gap-2 text-sm text-red-600">
                  <ShieldAlert className="h-4 w-4" /> {flag.replace(/_/g, " ")}
                </div>
              ))}
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-emerald-600">
              <ShieldCheck className="h-4 w-4" /> No risk flags
            </p>
          ))}

          <div className="rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium">
                <KeyRound className="h-4 w-4" /> Two-factor authentication
              </span>
              <Badge variant={data.mfaEnabled ? "success" : "outline"}>{data.mfaEnabled ? "On" : "Off"}</Badge>
            </div>
            {data.mfaEnabled ? (
              <>
                <p className="mt-1 text-xs text-muted-foreground">An authenticator code is required at login.</p>
                <div className="mt-3 flex gap-2">
                  <input
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder="6-digit code"
                    className="h-9 flex-1 rounded-md border px-3 text-sm"
                    inputMode="numeric"
                    maxLength={6}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={totpCode.length !== 6 || disableMfa.isPending}
                    onClick={() => disableMfa.mutate(totpCode)}
                  >
                    Disable 2FA
                  </Button>
                </div>
              </>
            ) : setup ? (
              <>
                <p className="mt-1 text-xs text-muted-foreground">
                  Scan this QR in your authenticator app, then enter the 6-digit code it shows.
                </p>
                <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start">
                  <div className="shrink-0 rounded-lg border p-2">
                    <QRCodeSVG value={setup.otpauthUrl} size={140} />
                  </div>
                  <div className="min-w-0 flex-1 space-y-3">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Setup key (manual entry)</p>
                      <div className="mt-1 flex items-center gap-2">
                        <code className="truncate rounded border bg-slate-50 px-2 py-1 text-xs">{setup.secret}</code>
                        <Button variant="outline" size="sm" onClick={() => copySecret(setup.secret)}>
                          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                          {copied ? "Copied" : "Copy"}
                        </Button>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <input
                        value={totpCode}
                        onChange={(e) => setTotpCode(e.target.value)}
                        placeholder="6-digit code"
                        className="h-9 flex-1 rounded-md border px-3 text-sm"
                        inputMode="numeric"
                        maxLength={6}
                      />
                      <Button
                        size="sm"
                        disabled={totpCode.length !== 6 || enableMfa.isPending}
                        onClick={() => enableMfa.mutate(totpCode)}
                      >
                        {enableMfa.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Enable 2FA
                      </Button>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setSetup(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="mt-3">
                <Button size="sm" disabled={setupMfa.isPending} onClick={() => setupMfa.mutate()}>
                  {setupMfa.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <QrCode className="mr-1 h-4 w-4" />}
                  Set up 2FA
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Laptop className="h-5 w-5" />Active sessions</CardTitle>
          <CardDescription>{data.activeSessions} device{data.activeSessions === 1 ? "" : "s"} currently signed in.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {(data.sessions || []).map((s, i) => (
              <li key={s.id || i} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                <div className="flex items-center gap-3">
                  <Smartphone className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{s.device || "Device"}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.ip || "Unknown IP"} · last seen{" "}
                      {s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : "recently"}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {data.activeSessions > 1 && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full"
              disabled={revokeAll.isPending}
              onClick={() => revokeAll.mutate()}
            >
              <LogOut className="mr-1 h-4 w-4" /> Sign out other devices
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Lock className="h-5 w-5" />Verification & trust</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600">{data.trustScore}/100</p>
            <p className="text-xs text-muted-foreground">Trust score</p>
          </div>
          <div className="rounded-lg border p-4 text-center">
            <p className="text-2xl font-bold">{verified}/{verifiedTotal}</p>
            <p className="text-xs text-muted-foreground">Verifications</p>
          </div>
          <div className="rounded-lg border p-4 text-center">
            <p className="text-2xl font-bold">{data.activeSessions}</p>
            <p className="text-xs text-muted-foreground">Active sessions</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}