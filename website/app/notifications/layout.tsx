"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { CustomerSidebar } from "../components/customer/customer-sidebar";
import { FarmerSidebar } from "../components/farmer/farmer-sidebar";
import { DeliverySidebar } from "../components/delivery/delivery-sidebar";
import { WarehouseSidebar } from "../components/warehouse/warehouse-sidebar";
import { BusinessSidebar } from "../components/business/business-sidebar";
import { AdminSidebar } from "../components/admin/admin-sidebar";
import { RoleMobileNav } from "../components/shared/role-mobile-nav";
import { RolePageFrame } from "../components/shared/role-page-frame";
import { Footer } from "../components/common/footer";
import { AppPresence } from "../components/chat/app-presence";
import { CustomerChatNotifications } from "../components/customer/customer-chat-notifications";
import { BottomNav } from "../components/customer/bottom-nav";
import ChatWidget from "../components/shared/chat-widget";

type WorkspaceRole = "customer" | "farmer" | "delivery" | "warehouse" | "business" | "admin";

export default function NotificationsLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const role = (session?.user as any)?.role as WorkspaceRole | undefined;

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login?callbackUrl=%2Fnotifications");
    if (role && !["customer", "farmer", "delivery", "warehouse", "business", "admin"].includes(role)) {
      router.replace("/login?callbackUrl=%2Fnotifications");
    }
  }, [status, role, router]);

  if (status === "loading" || !role) {
    return <div className="flex min-h-[60vh] items-center justify-center"><div className="h-9 w-9 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" /></div>;
  }

  const sidebar = {
    customer: <CustomerSidebar />,
    farmer: <FarmerSidebar />,
    delivery: <DeliverySidebar />,
    warehouse: <WarehouseSidebar />,
    business: <BusinessSidebar />,
    admin: <AdminSidebar />,
  }[role];

  return (
    <div className="flex min-h-screen flex-col">
      <AppPresence />
      {role !== "customer" && <RoleMobileNav role={role} />}
      <div className="flex flex-1 bg-transparent">
        {sidebar}
        <main className="site-main min-w-0 flex-1 overflow-x-hidden px-3 py-4 sm:px-5 sm:py-5 lg:px-7">
          <div className={`site-content role-workspace role-${role} mx-auto w-full max-w-[1600px]`}>
            <RolePageFrame role={role}>{children}</RolePageFrame>
          </div>
        </main>
      </div>
      <Footer />
      {role === "customer" && <><CustomerChatNotifications /><BottomNav /><ChatWidget /></>}
      {role === "farmer" && <ChatWidget />}
    </div>
  );
}
