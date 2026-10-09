"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { AdminSidebar } from "../components/admin/admin-sidebar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
    if (session?.user?.role && session.user.role !== "admin") {
      router.push(`/${session.user.role}/dashboard`);
    }
  }, [status, session, router]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col bg-slate-50">
      <div className="flex flex-1 min-w-0 overflow-hidden">
        <AdminSidebar />
        <main className="min-w-0 flex-1 overflow-y-auto bg-slate-50 px-4 py-5 sm:px-6 lg:px-8 xl:py-7">
          <div className="mx-auto min-h-full w-full max-w-[1440px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
