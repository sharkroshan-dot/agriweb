"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";

export default function VerifyPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [otp, setOtp] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const phoneParam = params.get("phone") || "";
    if (phoneParam) setPhone(phoneParam);
    const roleParam = params.get("role") || "";
    if (roleParam) setRole(roleParam);
    const callbackParam = params.get("callbackUrl") || "";
    if (callbackParam) setCallbackUrl(callbackParam);
  }, []);
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!phone) {
      setError("Phone number is missing. Please register again.");
      return;
    }

    if (!/^[0-9]{4,6}$/.test(otp)) {
      setError("Enter a valid 4-6 digit verification code.");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone, otp }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.message || `Verification failed with status ${response.status}`);
      }

      const loginParams = new URLSearchParams();
      if (role) loginParams.set("role", role);
      if (callbackUrl) loginParams.set("callbackUrl", callbackUrl);
      const loginQuery = loginParams.toString();
      router.push(`/login${loginQuery ? `?${loginQuery}` : ""}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Verification is unavailable right now.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleResend() {
    if (!phone) {
      setError("Enter your phone number first.");
      return;
    }
    setError("");
    setNotice("");
    setIsResending(true);
    try {
      const response = await fetch("/api/auth/login-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message || "Could not resend the code.");
      }
      setNotice("A new code is on its way to your email and phone.");
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Could not resend the code right now.");
    } finally {
      setIsResending(false);
    }
  }

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>Verify your phone</CardTitle>
        <CardDescription>Enter the 4-6 digit verification code we sent to your email and phone (SMS/WhatsApp).</CardDescription>
      </CardHeader>
      <CardContent>
        {notice ? <p className="mb-4 text-sm text-emerald-600">{notice}</p> : null}
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="phone">
              Phone number
            </label>
            <Input
              id="phone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+919876543210"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="code">
              Verification code
            </label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))}
            />
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <Button className="w-full" disabled={isLoading} type="submit">
            {isLoading ? "Verifying..." : "Confirm"}
          </Button>
          <Button type="button" variant="ghost" className="w-full" disabled={isResending} onClick={handleResend}>
            {isResending ? "Sending..." : "Didn't receive it? Resend code"}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-500">
          <Link href={`/login${role ? `?role=${role}` : ""}`} className="font-medium text-emerald-600">
            Return to login
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
