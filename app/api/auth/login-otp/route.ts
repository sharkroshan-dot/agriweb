import { NextResponse } from "next/server";

function getApiBaseUrl() {
  const rawApiBaseUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "http://localhost:8000";
  return rawApiBaseUrl.endsWith("/api/v1") ? rawApiBaseUrl : `${rawApiBaseUrl.replace(/\/$/, "")}/api/v1`;
}

function normalizePhone(phone: unknown) {
  const raw = String(phone ?? "").trim().replace(/[\s\-()]/g, "");
  if (raw.startsWith("00")) {
    return `+${raw.slice(2)}`;
  }
  if (raw.startsWith("+")) {
    return raw.replace(/[^\d+]/g, "");
  }
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  return digits ? `+${digits}` : raw;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const response = await fetch(`${getApiBaseUrl()}/auth/login/otp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phone: normalizePhone(body.phone),
      }),
    });

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => "");

    if (!response.ok) {
      const message =
        (payload && typeof payload === "object" && (payload as Record<string, unknown>).detail) ||
        (typeof payload === "string" && payload.trim() ? payload : null) ||
        `Could not send OTP (status ${response.status})`;
      return NextResponse.json({ message }, { status: response.status });
    }

    // Never leak the OTP to the browser; it's only returned by the backend for
    // dev testing and is already logged in the backend console.
    if (payload && typeof payload === "object") {
      const data = (payload as Record<string, any>).data;
      if (data && typeof data === "object" && "otp" in data) {
        delete data.otp;
      }
    }

    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({ message: "Could not send OTP. Please try again." }, { status: 500 });
  }
}
