"use client";

import Link from "next/link";
import { ArrowLeft, MapPin } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { FarmVerificationSection } from "../../../../components/farmer/verification-sections";

export default function FarmVerificationPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/farmer/agri-score" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="h-4 w-4" /> Back to AgriConnect Score
      </Link>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4 text-emerald-600" /> Farm / land verification
          </CardTitle>
          <CardDescription>Record your farm details and upload a land ownership document. The step is marked verified once both are done.</CardDescription>
        </CardHeader>
        <CardContent>
          <FarmVerificationSection />
        </CardContent>
      </Card>
    </div>
  );
}