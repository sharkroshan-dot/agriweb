import { getServerSession } from "next-auth";
import { authOptions } from "../../../../auth";

const BACKEND = "http://localhost:8000";

async function handler(req: Request, props: { params: Promise<{ slug: string[] }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions as any);
  const token = (session as any)?.accessToken;

  const path = params.slug.join("/");
  const hadTrailingSlash = req.url.endsWith("/") && path !== "";
  const backendPath = hadTrailingSlash ? `${path}/` : path;
  const backendUrl = new URL(`${BACKEND}/api/v1/${backendPath}`);
  const reqUrl = new URL(req.url);
  reqUrl.searchParams.forEach((v, k) => backendUrl.searchParams.set(k, v));

  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const ct = req.headers.get("content-type");
  if (ct) headers.set("Content-Type", ct);

  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();

  try {
    const response = await fetch(backendUrl.toString(), {
      method: req.method,
      headers,
      body,
    });

    const resHeaders = new Headers();
    const contentType = response.headers.get("content-type") || "";
    if (contentType) resHeaders.set("content-type", contentType);

    return new Response(response.body, {
      status: response.status,
      headers: resHeaders,
    });
  } catch {
    return Response.json(
      { success: false, error: "Backend unavailable" },
      { status: 502 }
    );
  }
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
