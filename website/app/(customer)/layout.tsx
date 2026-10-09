"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { CustomerSidebar } from "../components/customer/customer-sidebar";
import { CustomerChatNotifications } from "../components/customer/customer-chat-notifications";
import { Footer } from "../components/common/footer";
import { BottomNav } from "../components/customer/bottom-nav";
import ChatWidget from "../components/shared/chat-widget";

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
    if (session?.user?.role && session.user.role !== "customer") {
      router.push(`/${session.user.role}/dashboard`);
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
        <CustomerSidebar />
        <main className="min-w-0 flex-1 overflow-x-hidden bg-slate-50 px-4 py-5 sm:px-6 lg:px-8 xl:py-7">
          <div className="mx-auto w-full max-w-[1440px]">{children}</div>
        </main>
      </div>
      <Footer />
      <CustomerChatNotifications />
      <BottomNav />
      <ChatWidget />
    </div>
  );
}
