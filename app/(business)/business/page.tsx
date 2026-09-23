"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect } from "react";

export default function BusinessIndexPage() {
  const router = useRouter();
  const { status } = useSession();

  useEffect(() => {
    if (status !== "loading") {
      router.replace("/business/dashboard");
    }
  }, [status, router]);

  return null;
}