"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { BusinessSidebar } from "../components/business/business-sidebar";
import { Footer } from "../components/common/footer";

export default function BusinessLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
    if ((session?.user as any)?.role && (session?.user as any)?.role !== "business") {
      router.push(`/${(session?.user as any)?.role}/dashboard`);
    }
  }, [status, session, router]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex min-w-0 flex-1">
        <BusinessSidebar />
        <main className="min-w-0 flex-1 overflow-x-hidden bg-slate-50 px-4 py-5 sm:px-6 lg:px-8 xl:py-7">
          <div className="mx-auto w-full max-w-[1440px]">{children}</div>
        </main>
      </div>
      <Footer />
    </div>
  );
}