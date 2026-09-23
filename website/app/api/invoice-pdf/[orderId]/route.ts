import { getServerSession } from "next-auth";
import { authOptions } from "../../../../auth";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  props: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await props.params;
  const session = (await getServerSession(authOptions as any)) as any;
  if (!session?.accessToken) {
    return new Response("Not authenticated", { status: 401 });
  }

  const rawBase = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "http://localhost:8000";
  const base = rawBase.endsWith("/api/v1")
    ? rawBase
    : `${rawBase.replace(/\/$/, "")}/api/v1`;

  let backend: Response;
  try {
    backend = await fetch(`${base}/b2b/invoices/${orderId}/pdf`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      cache: "no-store",
    });
  } catch {
    return new Response("Could not reach the backend", { status: 502 });
  }

  if (!backend.ok) {
    const text = await backend.text().catch(() => "");
    return new Response(text || `Download failed (${backend.status})`, {
      status: backend.status,
    });
  }

  const contentType = backend.headers.get("content-type") || "application/pdf";
  const disposition =
    backend.headers.get("content-disposition") ||
    `attachment; filename="invoice-${orderId}.pdf"`;

  const body = new Uint8Array(await backend.arrayBuffer());
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": disposition,
      "Cache-Control": "no-store",
    },
  });
}