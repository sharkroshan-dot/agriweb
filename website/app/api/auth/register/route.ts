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

function extractErrorMessage(payload: unknown, _status: number) {
  if (typeof payload === "string" && payload.trim()) {
    return payload.substring(0, 500);
  }

  if (payload && typeof payload === "object") {
    const anyPayload = payload as Record<string, unknown>;

    if (typeof anyPayload.message === "string" && anyPayload.message.trim()) {
      return anyPayload.message;
    }
    if (typeof anyPayload.detail === "string" && anyPayload.detail.trim()) {
      return anyPayload.detail;
    }
    if (Array.isArray(anyPayload.detail)) {
      const msgs: string[] = [];
      for (const item of anyPayload.detail) {
        if (typeof item === "string") msgs.push(item);
        else if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          if (typeof obj.msg === "string") msgs.push(obj.msg);
        }
      }
      if (msgs.length > 0) return msgs.join("; ");
    }

    // Backend custom error format: { success: false, error: { code, message, status_code } }
    if (anyPayload.success === false && anyPayload.error && typeof anyPayload.error === "object") {
      const err = anyPayload.error as Record<string, unknown>;
      if (typeof err.message === "string" && err.message.trim()) {
        return err.message;
      }
      if (Array.isArray(err.details)) {
        const detailMsgs: string[] = [];
        for (const d of err.details) {
          if (d && typeof d === "object") {
            const dd = d as Record<string, unknown>;
            if (typeof dd.message === "string") detailMsgs.push(dd.message);
          }
        }
        if (detailMsgs.length > 0) return detailMsgs.join("; ");
      }
    }

    if (typeof anyPayload.error === "string") {
      return anyPayload.error;
    }
  }

  return "Registration failed. Check your details and try again.";
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const normalizedBody = {
      email: body.email,
      phone: normalizePhone(body.phone),
      password: body.password,
      first_name: body.first_name ?? body.firstName,
      last_name: body.last_name ?? body.lastName,
      role: body.role,
    };
    const response = await fetch(`${getApiBaseUrl()}/auth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(normalizedBody),
    });

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => "");

    if (!response.ok) {
      const message = extractErrorMessage(payload, response.status);
      return NextResponse.json(
        { message },
        { status: response.status }
      );
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
  } catch (err) {
    const isServerUnreachable = err instanceof TypeError && err.message?.includes("fetch");
    return NextResponse.json(
      {
        message: isServerUnreachable
          ? "Backend server is not running. Start it with: cd backend && uvicorn app.main:app --reload"
          : `Registration error: ${err instanceof Error ? err.message : "Unknown error"}`,
      },
      { status: 503 }
    );
  }
}
