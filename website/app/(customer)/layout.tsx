"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { CustomerSidebar } from "../components/customer/customer-sidebar";
import { CustomerChatNotifications } from "../components/customer/customer-chat-notifications";
import { Footer } from "../components/common/footer";
import { BottomNav } from "../components/customer/bottom-nav";
import ChatWidget from "../components/shared/chat-widget";
import { AppPresence } from "../components/chat/app-presence";
import { WorkflowGuide } from "../components/shared/workflow-guide";
import { RolePageFrame } from "../components/shared/role-page-frame";

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  // Product search is a public discovery page. Account, order and checkout
  // routes remain protected by the existing customer authentication redirect.
  const isPublicSearchPage = pathname === "/search";
  const isSignedInCustomer = session?.user?.role === "customer";

  useEffect(() => {
    if (status === "unauthenticated" && !isPublicSearchPage) {
      const callbackUrl = `${window.location.pathname}${window.location.search}`;
      router.replace(`/login?role=customer&callbackUrl=${encodeURIComponent(callbackUrl)}`);
    }
    if (session?.user?.role && session.user.role !== "customer") {
      router.push(`/${session.user.role}/dashboard`);
    }
  }, [status, session, router, isPublicSearchPage]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      {isSignedInCustomer && <AppPresence />}
      <div className="flex flex-1 bg-transparent">
        {isSignedInCustomer && <CustomerSidebar />}
        <main className="site-main min-w-0 flex-1 overflow-x-hidden px-3 py-5 sm:px-5 sm:py-6 lg:px-8">
          <div className="site-content role-workspace role-customer mx-auto w-full max-w-[1440px]">
            {isSignedInCustomer && <WorkflowGuide role="customer" compact />}
            <RolePageFrame role="customer">{children}</RolePageFrame>
          </div>
        </main>
      </div>
      <Footer />
      {isSignedInCustomer && (
        <>
          <CustomerChatNotifications />
          <BottomNav />
          <ChatWidget />
        </>
      )}
    </div>
  );
}
