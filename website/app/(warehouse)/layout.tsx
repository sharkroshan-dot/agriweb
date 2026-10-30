"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { WarehouseSidebar } from "../components/warehouse/warehouse-sidebar";
import { RoleMobileNav } from "../components/shared/role-mobile-nav";
import { Footer } from "../components/common/footer";
import { WorkflowGuide } from "../components/shared/workflow-guide";
import { AppPresence } from "../components/chat/app-presence";

export default function WarehouseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
    if (session?.user?.role && session.user.role !== "warehouse") {
      router.push(`/${session.user.role}/dashboard`);
    }
  }, [status, session, router]);

  const roleMismatch = Boolean(session?.user?.role && session.user.role !== "warehouse");
  const redirectPending = status === "unauthenticated" || roleMismatch;

  // Do not mount warehouse page components (and their React Query requests)
  // until authentication has resolved and the session belongs to a warehouse.
  // Previously children rendered during the redirect effect, which could start
  // page queries under the wrong or missing role and then immediately unmount.
  if (status === "loading" || redirectPending) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-live="polite">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <span className="sr-only">Verifying warehouse access…</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AppPresence />
      <RoleMobileNav role="warehouse" />
      <div className="flex flex-1 bg-transparent">
        <WarehouseSidebar />
        <main className="site-main warehouse-main min-w-0 flex-1 overflow-x-hidden px-3 py-5 sm:px-6 sm:py-7 lg:px-9">
          <div className="site-content role-workspace warehouse-workspace mx-auto w-full max-w-[1520px]"><WorkflowGuide role="warehouse" compact />{children}</div>
        </main>
      </div>
      <Footer />
    </div>
  );
}
