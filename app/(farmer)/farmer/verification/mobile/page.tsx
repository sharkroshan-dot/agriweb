"use client";

import Link from "next/link";
import { ArrowLeft, Smartphone } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { MobileVerificationSection } from "../../../../components/farmer/verification-sections";

export default function MobileVerificationPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/farmer/agri-score" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="h-4 w-4" /> Back to AgriConnect Score
      </Link>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="h-4 w-4 text-emerald-600" /> Mobile verification
          </CardTitle>
          <CardDescription>Verify the phone number on your account with an OTP. It is usually already verified when you log in.</CardDescription>
        </CardHeader>
        <CardContent>
          <MobileVerificationSection />
        </CardContent>
      </Card>
    </div>
  );
}