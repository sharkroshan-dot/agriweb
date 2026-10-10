"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { FarmerSidebar } from "../components/farmer/farmer-sidebar";
import { RoleMobileNav } from "../components/shared/role-mobile-nav";
import { Footer } from "../components/common/footer";
import ChatWidget from "../components/shared/chat-widget";
import { AppPresence } from "../components/chat/app-presence";
import { WorkflowGuide } from "../components/shared/workflow-guide";


export default function FarmerLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const isOrderPage = pathname === "/farmer/orders" || pathname?.startsWith("/farmer/orders/");

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
    if (session?.user?.role && session.user.role !== "farmer") {
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
    <div className="flex min-h-screen flex-col">
      <AppPresence />
      <RoleMobileNav role="farmer" />
      <div className="flex flex-1 bg-transparent">
        <FarmerSidebar />
        <main className="site-main min-w-0 flex-1 overflow-x-hidden px-3 py-4 sm:px-5 sm:py-5 lg:px-7">
          <div className={`site-content role-workspace mx-auto w-full max-w-[1440px] ${isOrderPage ? "" : "farmer-workspace"}`}><WorkflowGuide role="farmer" />{children}</div>
        </main>
      </div>
      <Footer />
      <ChatWidget />
    </div>
  );
}
