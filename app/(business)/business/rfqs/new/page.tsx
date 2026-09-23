"use client";

import Link from "next/link";
import { PlusCircle } from "lucide-react";
import { Button } from "../../../../components/ui/button";
import { CreateRfqForm } from "../../../../components/business/create-rfq-form";

export default function NewRfqPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PlusCircle className="h-6 w-6 text-emerald-600" />
          <h1 className="text-2xl font-bold">Create New RFQ</h1>
        </div>
        <Link href="/business/rfqs">
          <Button variant="outline" size="sm">My RFQs</Button>
        </Link>
      </div>
      <CreateRfqForm />
    </div>
  );
}
