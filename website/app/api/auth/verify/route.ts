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
  if (typeof payload === "string" && payload.trim()) return payload.trim();

  if (payload && typeof payload === "object") {
    const data = payload as Record<string, unknown>;
    for (const key of ["message", "detail", "error_description"]) {
      const value = data[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (Array.isArray(value)) {
        const messages = value.map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object") {
            const entry = item as Record<string, unknown>;
            return typeof entry.msg === "string" ? entry.msg : null;
          }
          return null;
        }).filter((item): item is string => Boolean(item));
        if (messages.length) return messages.join("; ");
      }
    }

    if (data.error && typeof data.error === "object") {
      const nested = data.error as Record<string, unknown>;
      if (typeof nested.message === "string" && nested.message.trim()) return nested.message.trim();
    }
  }

  return `Verification was rejected by the server (HTTP ${status}). Please request a new code and try again.`;
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
