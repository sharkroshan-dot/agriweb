import Link from "next/link";
import { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[80vh] max-w-6xl flex-col justify-center px-6 py-16 lg:px-8">
      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <div className="space-y-4">
          <div className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
            Secure access portal
          </div>
          <h1 className="text-3xl font-semibold text-slate-950 sm:text-4xl">
            Sign in and manage your agricultural operations.
          </h1>
          <p className="max-w-xl text-lg text-slate-600">
            Authenticate quickly and move from planning to fulfillment with the same trusted platform.
          </p>
          <Link href="/" className="text-sm font-medium text-emerald-600 hover:text-emerald-700">
            Back to home
          </Link>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}
