"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Search, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { api } from "../../../lib/api/client";
import toast from "react-hot-toast";

export default function AdminFarmersPage() {
  const [search, setSearch] = useState("");
  const [actionId, setActionId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["adminFarmers", search],
    queryFn: () =>
      api.get("/admin/farmers", {
        params: {
          limit: 100,
          ...(search ? { search } : {}),
        },
      }),
  });

  const farmers = data?.farmers ?? [];

  const handleVerify = async (farmerId: string) => {
    setActionId(farmerId);
    try {
      await api.put(`/admin/farmers/${farmerId}/verify`);
      toast.success("Farmer verified");
      refetch();
    } catch (err: any) {
      toast.error(err?.message || "Failed to verify farmer");
    } finally {
      setActionId(null);
    }
  };

  const handleReject = async (farmerId: string) => {
    setActionId(farmerId);
    try {
      await api.put(`/admin/farmers/${farmerId}/reject`);
      toast.success("Farmer rejected");
      refetch();
    } catch (err: any) {
      toast.error(err?.message || "Failed to reject farmer");
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-primary">Farmer onboarding</p>
        <h1 className="text-3xl font-semibold tracking-tight">Manage farmer accounts</h1>
        <p className="mt-1 text-sm text-muted-foreground">Review applications, check compliance, and approve listings.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Farmer directory</CardTitle>
              <CardDescription>Track farmer verification and registration details.</CardDescription>
            </div>
            <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-muted-foreground">
              <Search className="h-4 w-4" />
              <input
                className="w-40 bg-transparent outline-none"
                placeholder="Search farmers"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : farmers.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No farmers found.</p>
          ) : (
            farmers.map((farmer) => {
              const fullName = `${farmer.firstName || ""} ${farmer.lastName || ""}`.trim() || farmer.name || "Farmer";
              const isVerified = Boolean(farmer.isVerified);
              return (
                <div key={farmer.id} className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-medium">{fullName}</p>
                    <p className="text-sm text-muted-foreground">{farmer.email}</p>
                    <p className="text-sm text-muted-foreground">{farmer.phone}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={isVerified ? "success" : "warning"}>
                      {isVerified ? "Verified" : "Pending"}
                    </Badge>
                    {!isVerified ? (
                      <Button variant="secondary" size="sm" onClick={() => handleVerify(farmer.id)} disabled={actionId === farmer.id}>
                        {actionId === farmer.id ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1.5 h-4 w-4" />}
                        Approve
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => handleReject(farmer.id)} disabled={actionId === farmer.id}>
                        {actionId === farmer.id ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <XCircle className="mr-1.5 h-4 w-4" />}
                        Reject
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
