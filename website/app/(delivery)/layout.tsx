"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { DeliverySidebar } from "../components/delivery/delivery-sidebar";
import { Header } from "../components/common/header";
import { Footer } from "../components/common/footer";

export default function DeliveryLayout({
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
    if (session?.user?.role && session.user.role !== "delivery") {
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
    <div className="flex min-h-screen flex-col">
      <Header />
      <div className="flex flex-1 bg-transparent pt-16">
        <DeliverySidebar />
        <main className="min-w-0 flex-1 overflow-x-hidden px-3 py-5 sm:px-5 sm:py-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1440px]">{children}</div>
        </main>
      </div>
      <Footer />
    </div>
  );
}
