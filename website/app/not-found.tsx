"use client";

import Link from "next/link";
import { ArrowLeft, Home, Search } from "lucide-react";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";

export default function NotFound() {
  return (
    <main className="site-main">
      <div className="page-container flex min-h-[70vh] items-center justify-center">
        <Card className="w-full max-w-xl">
          <CardContent className="p-10 text-center">
            <div className="text-6xl font-black tracking-tight text-emerald-600">404</div>
            <h1 className="mt-4 text-2xl font-bold text-slate-900">Page not found</h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">This page may have moved or the link may be outdated.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button variant="outline" onClick={() => window.history.back()} className="gap-2"><ArrowLeft className="h-4 w-4"/>Back</Button>
              <Link href="/"><Button className="gap-2"><Home className="h-4 w-4"/>Home</Button></Link>
              <Link href="/search"><Button variant="outline" className="gap-2"><Search className="h-4 w-4"/>Search</Button></Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
