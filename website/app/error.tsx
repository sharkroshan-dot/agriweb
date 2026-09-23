"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("AgriConnect page error", error); }, [error]);
  return (
    <main className="site-main">
      <div className="page-container flex min-h-[70vh] items-center justify-center">
        <Card className="w-full max-w-xl">
          <CardHeader className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-600"><AlertTriangle className="h-7 w-7"/></div>
            <CardTitle className="mt-2 text-2xl">Something went wrong</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm leading-6 text-slate-500">We could not load this page. Your data has not been changed. Try again or return to AgriConnect home.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button onClick={reset} className="gap-2"><RefreshCw className="h-4 w-4"/>Try again</Button>
              <Link href="/"><Button variant="outline" className="gap-2"><Home className="h-4 w-4"/>Go home</Button></Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
