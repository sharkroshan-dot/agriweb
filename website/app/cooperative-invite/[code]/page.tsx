"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api/client";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { CheckCircle2, MapPin, Sprout, Users2, Loader2, LogIn, ShieldCheck } from "lucide-react";

export default function CooperativeInvitePage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const code = useMemo(() => decodeURIComponent(String(params?.code || "")).toUpperCase(), [params?.code]);
  const [submitted, setSubmitted] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["publicCooperativeInvite", code],
    queryFn: () => api.get("/cooperatives/public/invite/" + encodeURIComponent(code)),
    enabled: Boolean(code),
    retry: 1,
  });
  const cooperative = data?.data || data;
  const userRole = (session as any)?.user?.role || (session as any)?.role || "";
  const join = useMutation({
    mutationFn: () => api.post("/cooperatives/join", { inviteCode: code, source: "qr" }),
    onSuccess: () => setSubmitted(true),
  });

  const continueToJoin = () => {
    if (sessionStatus === "loading") return;
    if (!session) {
      const callback = "/cooperative-invite/" + encodeURIComponent(code);
      router.push("/login?role=farmer&callbackUrl=" + encodeURIComponent(callback));
      return;
    }
    if (userRole !== "farmer") return;
    join.mutate();
  };

  return (
    <main className="min-h-[calc(100vh-80px)] bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="text-sm font-semibold text-emerald-800">AgriConnect</Link>
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">Cooperative invitation</Badge>
        </div>
        {isLoading ? (
          <Card><CardContent className="flex flex-col items-center gap-3 py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-700"/><p className="text-sm text-slate-500">Loading cooperative details…</p></CardContent></Card>
        ) : isError || !cooperative?.id ? (
          <Card><CardContent className="py-12 text-center"><ShieldCheck className="mx-auto h-10 w-10 text-rose-500"/><h1 className="mt-4 text-xl font-semibold text-slate-900">Invitation unavailable</h1><p className="mt-2 text-sm text-slate-500">This QR invitation may be invalid, expired or the cooperative may no longer be active. Ask the manager for a current invitation.</p><Button className="mt-6" variant="outline" onClick={() => router.push("/")}>Go to AgriConnect</Button></CardContent></Card>
        ) : (
          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <div className="bg-gradient-to-r from-emerald-800 to-emerald-600 px-6 py-8 text-white">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15"><Users2 className="h-6 w-6"/></div>
              <p className="mt-5 text-sm font-medium text-emerald-100">You are invited to join</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">{cooperative.name}</h1>
              <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-100"><MapPin className="h-4 w-4"/>{cooperative.location}</p>
            </div>
            <CardHeader>
              <CardTitle className="text-lg">Grow together with local farmers</CardTitle>
              <CardDescription>{cooperative.description || "Join this AgriConnect cooperative to coordinate production, share inventory and work together with nearby farmers."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><Users2 className="h-5 w-5 text-emerald-700"/><p className="mt-2 text-2xl font-bold text-slate-900">{cooperative.memberCount ?? 0}</p><p className="text-xs text-slate-500">Active members</p></div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><Sprout className="h-5 w-5 text-emerald-700"/><p className="mt-2 text-sm font-semibold text-slate-900">{(cooperative.crops || []).length ? cooperative.crops.join(", ") : "Open to farmers"}</p><p className="text-xs text-slate-500">Crops</p></div>
              </div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4"><p className="text-sm font-semibold text-emerald-900">How joining works</p><p className="mt-1 text-sm leading-6 text-emerald-800">Sign in with your farmer account, submit a request, and wait for the cooperative manager to approve your membership. Scanning this QR does not add you automatically.</p></div>
              {submitted ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center"><CheckCircle2 className="mx-auto h-9 w-9 text-emerald-700"/><h2 className="mt-2 font-semibold text-emerald-900">Join request submitted</h2><p className="mt-1 text-sm text-emerald-800">Your request to join {cooperative.name} is waiting for manager approval.</p><Button className="mt-4 bg-emerald-700" onClick={() => router.push("/farmer/cooperative")}>Go to my cooperative page</Button></div>
              ) : session && userRole !== "farmer" ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-semibold text-amber-900">Use a farmer account</p><p className="mt-1 text-sm text-amber-800">You are currently signed in with a different account type. Sign in with your AgriConnect farmer account to request membership.</p><Button className="mt-3" variant="outline" onClick={() => router.push("/login?role=farmer&callbackUrl=" + encodeURIComponent("/cooperative-invite/" + code))}>Switch to farmer login</Button></div>
              ) : (
                <Button className="w-full bg-emerald-700 hover:bg-emerald-800" disabled={join.isPending || sessionStatus === "loading"} onClick={continueToJoin}>
                  {join.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin"/>Submitting request…</> : !session ? <><LogIn className="mr-2 h-4 w-4"/>Sign in as farmer to join</> : "Request to join cooperative"}
                </Button>
              )}
              {join.isError && <p className="text-sm text-rose-600">{(join.error as Error)?.message || "Could not submit your request. Please try again."}</p>}
              <p className="text-center text-xs text-slate-400">Invitation code: {code}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
