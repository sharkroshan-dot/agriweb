"use client";

import Link from "next/link";
import { ArrowLeft, Landmark } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { BankVerificationSection } from "../../../../components/farmer/verification-sections";

export default function BankVerificationPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/farmer/agri-score" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="h-4 w-4" /> Back to AgriConnect Score
      </Link>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="h-4 w-4 text-emerald-600" /> Bank verification
          </CardTitle>
          <CardDescription>Add the payout account used for settlements. The step is marked verified once the account details are saved.</CardDescription>
        </CardHeader>
        <CardContent>
          <BankVerificationSection />
        </CardContent>
      </Card>
    </div>
  );
}