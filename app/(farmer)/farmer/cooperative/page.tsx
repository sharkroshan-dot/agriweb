"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users2,
  Plus,
  Loader2,
  CheckCircle2,
  Briefcase,
  TrendingUp,
  XCircle,
  Users,
} from "lucide-react";
import { api } from "../../../lib/api/client";
import { cn, formatPrice } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import toast from "react-hot-toast";

interface Cooperative {
  id: string;
  name: string;
  location: string;
  memberCount: number;
  combinedKg: number;
  crops: string[];
  activeB2bOrders: number;
  role: "admin" | "member" | "none";
  myContributionKg?: number;
}

const DEMO_COOPS: Cooperative[] = [
  {
    id: "coop-1",
    name: "Coimbatore Vegetable Group",
    location: "Coimbatore, TN",
    memberCount: 50,
    combinedKg: 12000,
    crops: ["Tomato", "Onion", "Potato", "Carrot"],
    activeB2bOrders: 3,
    role: "admin",
    myContributionKg: 1200,
  },
  {
    id: "coop-2",
    name: "Periyar Organic Growers",
    location: "Erode, TN",
    memberCount: 24,
    combinedKg: 6400,
    crops: ["Spinach", "Capsicum", "Brinjal"],
    activeB2bOrders: 1,
    role: "member",
    myContributionKg: 300,
  },
];

export default function FarmerCooperativePage() {
  const queryClient = useQueryClient();
  const [showJoin, setShowJoin] = useState(false);
  const [joinForm, setJoinForm] = useState({ name: "", location: "", crops: "" });

  const { data: coopData, isLoading } = useQuery({
    queryKey: ["farmerCooperatives"],
    queryFn: () => api.get("/cooperatives/me"),
    retry: 1,
  });

  const apiCoops = useMemo(() => {
    const list = coopData?.data?.cooperatives || coopData?.data || [];
    if (Array.isArray(list) && list.length > 0) return list;
    return DEMO_COOPS;
  }, [coopData]);

  const createMutation = useMutation({
    mutationFn: (payload: any) => api.post("/cooperatives", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farmerCooperatives"] });
      setShowJoin(false);
      setJoinForm({ name: "", location: "", crops: "" });
      toast.success("Cooperative created! Invite farmers to join.");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to create cooperative"),
  });

  const myCoop = apiCoops.find((c: any) => c.role === "admin" || c.role === "member");
  const coops: Cooperative[] = apiCoops.map((c: any) => ({ ...c, id: c._id || c.id }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Farmer Cooperative</h1>
          <p className="text-gray-500">
            Join farmers in your area to combine inventory and win large B2B orders no single farm could fulfill.
          </p>
        </div>
        <Button onClick={() => setShowJoin((v) => !v)}>
          {showJoin ? <XCircle className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
          {showJoin ? "Cancel" : "Create Cooperative"}
        </Button>
      </div>

      {showJoin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Start a Cooperative</CardTitle>
            <CardDescription>Form a group, then invite nearby farmers to pool supply for bulk orders.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Group name *</label>
              <Input value={joinForm.name} onChange={(e) => setJoinForm({ ...joinForm, name: e.target.value })} placeholder="e.g. Coimbatore Vegetable Group" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Location *</label>
              <Input value={joinForm.location} onChange={(e) => setJoinForm({ ...joinForm, location: e.target.value })} placeholder="e.g. Coimbatore, TN" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-medium text-gray-500">Main crops (comma separated)</label>
              <Input value={joinForm.crops} onChange={(e) => setJoinForm({ ...joinForm, crops: e.target.value })} placeholder="e.g. Tomato, Onion, Potato" />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <Button
                disabled={!joinForm.name || !joinForm.location || createMutation.isPending}
                onClick={() =>
                  createMutation.mutate({
                    name: joinForm.name,
                    location: joinForm.location,
                    crops: joinForm.crops.split(",").map((c) => c.trim()).filter(Boolean),
                  })
                }
              >
                {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Create Group
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {myCoop && (
        <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              {myCoop.name}
            </CardTitle>
            <CardDescription>{myCoop.location} · You are {myCoop.role === "admin" ? "an admin" : "a member"}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-emerald-200 bg-white/70 p-3 text-center">
                <p className="text-2xl font-bold text-slate-900">{myCoop.memberCount}</p>
                <p className="mt-0.5 text-xs text-slate-500">Farmers</p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-white/70 p-3 text-center">
                <p className="text-2xl font-bold text-emerald-700">{myCoop.combinedKg} kg</p>
                <p className="mt-0.5 text-xs text-slate-500">Combined inventory</p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-white/70 p-3 text-center">
                <p className="text-2xl font-bold text-blue-700">{myCoop.activeB2bOrders}</p>
                <p className="mt-0.5 text-xs text-slate-500">Active B2B orders</p>
              </div>
            </div>
            {myCoop.myContributionKg > 0 && (
              <p className="mt-3 text-sm text-emerald-900/80">
                Your contribution: <span className="font-semibold">{myCoop.myContributionKg} kg</span> toward combined supply.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : coops.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <Users2 className="h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm text-slate-500">No cooperatives yet. Create one or check back for invitations.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {coops.map((c) => (
            <Card key={c.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Users2 className="h-5 w-5 text-emerald-600" />
                    <CardTitle className="text-base">{c.name}</CardTitle>
                  </div>
                  {c.role === "admin" && <Badge variant="success">You manage</Badge>}
                  {c.role === "member" && <Badge variant="outline">Member</Badge>}
                </div>
                <CardDescription>{c.location}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="flex items-center justify-center gap-1 text-lg font-bold text-slate-900"><Users className="h-4 w-4 text-emerald-600" />{c.memberCount}</p>
                    <p className="text-[11px] text-slate-500">Farmers</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="text-lg font-bold text-emerald-700">{c.combinedKg} kg</p>
                    <p className="text-[11px] text-slate-500">Inventory</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="flex items-center justify-center gap-1 text-lg font-bold text-blue-700"><Briefcase className="h-4 w-4" />{c.activeB2bOrders}</p>
                    <p className="text-[11px] text-slate-500">B2B orders</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {c.crops.map((crop) => (
                    <Badge key={crop} variant="outline" className="text-emerald-700">{crop}</Badge>
                  ))}
                </div>
                {c.role === "none" && (
                  <Button className="w-full" size="sm" variant="outline">
                    <TrendingUp className="mr-1.5 h-4 w-4" /> Request to Join
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Briefcase className="h-5 w-5 text-emerald-600" />
            Why cooperatives win big orders
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { title: "Combined inventory", desc: "A business needs 5,000 kg — one farm can't. Five farms together can." },
              { title: "Single point of sale", desc: "One offer, one invoice, one delivery plan to the buyer." },
              { title: "Predictable demand", desc: "Share RFQs internally so members grow what buyers actually need." },
            ].map((c) => (
              <div key={c.title} className="rounded-lg border border-emerald-200 bg-white/70 p-3">
                <p className="text-sm font-semibold text-emerald-800">{c.title}</p>
                <p className="mt-1 text-xs text-emerald-900/70">{c.desc}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}