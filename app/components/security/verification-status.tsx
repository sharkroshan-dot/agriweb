"use client";

import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { ShieldCheck, ShieldAlert } from "lucide-react";

interface VerificationStatus {
  userId: string;
  role: string;
  status: Record<string, boolean>;
  trustScore: number;
}

const LABELS: Record<string, string> = {
  mobile: "Mobile verified",
  identity: "Identity verified",
  bank: "Bank verified",
  farm: "Farm verified",
  vehicle: "Vehicle verified",
};

export function VerificationStatusCard() {
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken;

  const { data, isLoading } = useQuery<VerificationStatus>({
    queryKey: ["verificationStatus"],
    queryFn: () => api.get("/kyc/verification-status"),
    enabled: Boolean(accessToken),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="text-sm text-muted-foreground py-6">Loading verification status…</CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="text-sm text-muted-foreground py-6">
          Verification status unavailable.
        </CardContent>
      </Card>
    );
  }

  const verifiedCount = Object.values(data.status).filter(Boolean).length;
  const entries = Object.entries(data.status).filter(([key]) => key in LABELS);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-5 w-5 text-emerald-600" />
          Verification & trust
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center justify-between rounded-lg border p-3">
          <span className="text-sm font-medium">Trust score</span>
          <span className="text-lg font-bold text-emerald-600">{data.trustScore}/100</span>
        </div>
        <ul className="space-y-2">
          {entries.map(([key, value]) => (
            <li key={key} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{LABELS[key]}</span>
              {value ? (
                <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                  <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Verified
                </Badge>
              ) : (
                <Badge variant="outline">
                  <ShieldAlert className="mr-1 h-3.5 w-3.5" /> Pending
                </Badge>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          {verifiedCount === entries.length
            ? "All verifications complete. Thank you!"
            : "Complete the remaining steps to raise your trust score and unlock more orders."}
        </p>
      </CardContent>
    </Card>
  );
}