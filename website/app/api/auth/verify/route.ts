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

function extractErrorMessage(payload: unknown, status: number) {
  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    const anyPayload = payload as Record<string, unknown>;
    if (typeof anyPayload.message === "string" && anyPayload.message.trim()) {
      return anyPayload.message;
    }
    if (Array.isArray(anyPayload.detail)) {
      const details = anyPayload.detail
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object" && typeof (item as Record<string, unknown>).msg === "string") {
            return String((item as Record<string, unknown>).msg);
          }
          return null;
        })
        .filter(Boolean);
      if (details.length > 0) {
        return details.join(", ");
      }
    }
    if (typeof anyPayload.detail === "string" && anyPayload.detail.trim()) {
      return anyPayload.detail;
    }
  }

  return `Verification failed with status ${status}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const response = await fetch(`${getApiBaseUrl()}/auth/verify-otp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phone: normalizePhone(body.phone),
        otp: String(body.otp ?? "").trim(),
      }),
    });

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => "");

    if (!response.ok) {
      const message = extractErrorMessage(payload, response.status);
      return NextResponse.json({ message }, { status: response.status });
    }

    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({ message: "Verification failed. Please try again." }, { status: 500 });
  }
}
