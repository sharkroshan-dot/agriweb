"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Eye, EyeOff } from "lucide-react";

const roleOptions = [
  { value: "customer", label: "Customer" },
  { value: "farmer", label: "Farmer" },
  { value: "business", label: "Business" },
  { value: "warehouse", label: "Warehouse" },
  { value: "delivery", label: "Delivery Partner" },
  { value: "admin", label: "Admin" },
];

const roleLabels: Record<string, string> = {
  customer: "Customer",
  farmer: "Farmer",
  business: "Business",
  warehouse: "Warehouse Manager",
  delivery: "Delivery Partner",
  admin: "Admin",
};

function normalizeRole(role?: string): string {
  const normalized = (role || "").toLowerCase();
  return ["farmer", "warehouse", "delivery", "admin", "customer", "business"].includes(normalized) ? normalized : "customer";
}

export default function LoginPage() {
  const router = useRouter();
  const [role, setRole] = useState("customer");
  const [preselectedRole, setPreselectedRole] = useState<string | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [authMode, setAuthMode] = useState<"password" | "otp">("password");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const [phone, setPhone] = useState("");

  const [savedEmails, setSavedEmails] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem("agri_saved_emails");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setSavedEmails(parsed.filter((e) => typeof e === "string").slice(0, 10));
      }
    } catch {}
  }, []);

  function saveEmail(emailValue: string) {
    const clean = emailValue.trim().toLowerCase();
    if (!clean) return;
    setSavedEmails((prev) => {
      const next = [clean, ...prev.filter((e) => e !== clean)].slice(0, 10);
      try {
        window.localStorage.setItem("agri_saved_emails", JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const preselected = params.get("role");
    const callbackUrlParam = params.get("callbackUrl") || "";
    if (preselected) {
      setRole(preselected);
      setPreselectedRole(preselected);
    }
    setCallbackUrl(callbackUrlParam);
  }, []);
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);

  useEffect(() => {
    if (window.location.search.includes("expired=true")) {
      setError("Your session has expired. Please sign in again.");
    }
  }, []);

  // Prefetch the post-login destination so navigation can start immediately
  // once authentication succeeds instead of waiting for the dashboard bundle.
  useEffect(() => {
    const destination = callbackUrl || `/${role}/dashboard`;
    router.prefetch(destination);
  }, [callbackUrl, role, router]);

  useEffect(() => {
    if (resendTimer <= 0) return;
    const id = setInterval(() => setResendTimer((t) => (t <= 1 ? 0 : t - 1)), 1000);
    return () => clearInterval(id);
  }, [resendTimer]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError("");

    const result = await signIn("credentials", {
      email,
      password,
      role,
      redirect: false,
    });

    if (result?.ok) {
      saveEmail(email);
      router.push(callbackUrl || `/${role}/dashboard`);
      return;
    }

    const code = result?.error as string | undefined;
    if (code === "Network error") {
      setError("Could not reach the server. Check your internet connection and try again.");
    } else if (code === "Account not verified") {
      setError("Your account is not verified yet. Check your email for the verification link.");
    } else {
      setError("Incorrect email or password. Please try again.");
    }
    setIsLoading(false);
  }

  async function requestOtp() {
    if (!phone.trim()) {
      setError("Enter your registered phone number.");
      return;
    }
    setSendingOtp(true);
    setError("");
    setOtpSent(false);
    try {
      const res = await fetch("/api/auth/login-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.message || "Could not send OTP. Check the number and try again.");
        return;
      }
      setOtpSent(true);
      setOtp("");
      setResendTimer(30);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSendingOtp(false);
    }
  }

  async function verifyOtp() {
    if (!otp.trim()) {
      setError("Enter the OTP you received.");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, otp }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.message || "Verification failed. Check the OTP and try again.");
        return;
      }
      const user = data?.user || {};
      const actualRole = normalizeRole(user.role);
      const selectedRole = normalizeRole(role);
      if (actualRole !== selectedRole) {
        setError(`This phone number is registered as a ${roleLabels[actualRole] || actualRole}. Choose the correct role and try again.`);
        setIsLoading(false);
        return;
      }
      const result = await signIn("otp", {
        id: user.id,
        email: user.email,
        name: [user.first_name, user.last_name].filter(Boolean).join(" "),
        image: user.avatar_url,
        role: actualRole,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        redirect: false,
      });
      if (result?.ok) {
        router.push(callbackUrl || `/${actualRole}/dashboard`);
        return;
      }
      setError("Sign-in failed. Please try again.");
    } catch {
      setError("Verification failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>Welcome back</CardTitle>
        <CardDescription>Access your dashboard, orders, and insights.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => { setAuthMode("password"); setError(""); }}
            className={`rounded-md py-2 text-sm font-medium transition ${authMode === "password" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            Email &amp; Password
          </button>
          <button
            type="button"
            onClick={() => { setAuthMode("otp"); setError(""); }}
            className={`rounded-md py-2 text-sm font-medium transition ${authMode === "otp" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            Phone OTP
          </button>
        </div>

        {authMode === "password" ? (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700" htmlFor="email">
                Email address
              </label>
              <Input
                id="email"
                type="email"
                name="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                list="saved-emails"
              />
              {savedEmails.length > 0 ? (
                <datalist id="saved-emails">
                  {savedEmails.map((savedEmail) => (
                    <option key={savedEmail} value={savedEmail} />
                  ))}
                </datalist>
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700" htmlFor="password">
                Password
              </label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  name="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  className="pr-10"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {preselectedRole ? (
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Role</label>
                <div className="flex h-10 w-full items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">
                  {roleLabels[preselectedRole] || preselectedRole}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700" htmlFor="role">
                  Role
                </label>
                <select
                  id="role"
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {roleOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <Button className="w-full" disabled={isLoading} type="submit">
              {isLoading ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        ) : (
          <div className="space-y-4">
            {preselectedRole ? (
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Role</label>
                <div className="flex h-10 w-full items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">
                  {roleLabels[preselectedRole] || preselectedRole}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700" htmlFor="otp-role">
                  Role
                </label>
                <select
                  id="otp-role"
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {roleOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700" htmlFor="otp-phone">
                Phone number
              </label>
              <Input
                id="otp-phone"
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+91 98765 43210"
                disabled={otpSent}
              />
              <p className="text-xs text-slate-400">We'll send a one-time password via SMS / WhatsApp.</p>
            </div>

            {otpSent && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700" htmlFor="otp-code">
                  One-time password
                </label>
                <Input
                  id="otp-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(event) => setOtp(event.target.value)}
                  placeholder="Enter 6-digit OTP"
                />
              </div>
            )}

            {error ? <p className="text-sm text-red-600">{error}</p> : null}

            {!otpSent ? (
              <Button className="w-full" disabled={sendingOtp} onClick={requestOtp} type="button">
                {sendingOtp ? "Sending OTP..." : "Send OTP"}
              </Button>
            ) : (
              <div className="flex items-center gap-3">
                <Button className="flex-1" disabled={isLoading || !otp} onClick={verifyOtp} type="button">
                  {isLoading ? "Signing in..." : "Verify & Sign in"}
                </Button>
                <Button
                  variant="outline"
                  disabled={resendTimer > 0}
                  onClick={requestOtp}
                  type="button"
                  className="shrink-0"
                >
                  {resendTimer > 0 ? `Resend (${resendTimer}s)` : "Resend"}
                </Button>
              </div>
            )}
          </div>
        )}

        <p className="mt-4 text-center text-sm text-slate-500">
          New here?{" "}
          <Link
            href={`/register${preselectedRole ? `?role=${preselectedRole}` : ""}`}
            className="font-medium text-emerald-600"
          >
            Create an account
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
