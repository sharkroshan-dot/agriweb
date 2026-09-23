import { getSession } from "next-auth/react";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

let sessionPromise: Promise<any> | null = null;

async function getCachedSession() {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const session = await getSession();
        if (session) return session;
      } catch {
        // transient fetch failure; retry below
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
    return null;
  })();
  try {
    return await sessionPromise;
  } finally {
    sessionPromise = null;
  }
}

export interface ApiRequestOptions {
  params?: Record<string, string | number | boolean | undefined>;
  headers?: HeadersInit;
  body?: unknown;
}

function extractErrorMessage(text: string, fallback: string): string {
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text);
    const err = parsed?.error;
    if (err?.message) {
      let msg = String(err.message);
      if (Array.isArray(err.details) && err.details.length) {
        const parts = err.details
          .map((d: any) => (typeof d === "string" ? d : d?.message))
          .filter(Boolean);
        if (parts.length) msg = `${msg}: ${parts.join("; ")}`;
      }
      return msg;
    }
    if (typeof parsed?.detail === "string") return parsed.detail;
    if (Array.isArray(parsed?.detail) && parsed.detail.length) {
      const parts = parsed.detail
        .map((d: any) => (typeof d === "string" ? d : d?.msg))
        .filter(Boolean);
      if (parts.length) return parts.join("; ");
    }
    if (parsed?.message) return String(parsed.message);
  } catch {
    // not JSON — fall through to raw text
  }
  return text || fallback;
}

function buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>) {
  const prefix = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "";
  const base = prefix
    ? prefix.endsWith("/api/v1") ? prefix : `${prefix.replace(/\/$/, "")}/api/v1`
    : "/api/v1";
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${base}${normalizedPath}`, window.location.origin);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });
  }

  return url.toString();
}

async function request<T = any>(method: HttpMethod, path: string, options: ApiRequestOptions = {}) {
  const headers = new Headers(options.headers || {});
  const accessToken = await getCachedSession();

  if (accessToken?.accessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${accessToken.accessToken}`);
  }

  if (options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const url = buildUrl(path, options.params);

  let response: Response;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      response = await fetch(url, {
        method,
        headers,
        credentials: "include",
        signal: controller.signal,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (firstError: any) {
      if (firstError?.name === "AbortError") {
        throw new Error(`Request timeout: ${method} ${url}`);
      }
      try {
        response = await fetch(url, {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
      } catch {
        throw new Error(`Network error: ${method} ${url} (${firstError?.message || firstError})`);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (fetchError: any) {
    throw new Error(fetchError?.message || `Network error: ${method} ${url}`);
  }

  if (response.status === 401 && accessToken?.accessToken) {
    const { signOut } = await import("next-auth/react");
    const { clearTransientState } = await import("../store/clear-transient-state");
    clearTransientState();
    await signOut({ redirect: false });
    window.location.href = "/login?expired=true";
    throw new Error("Session expired. Please login again.");
  }

if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(extractErrorMessage(text, `Request failed with status ${response.status}`));
  }

  if (response.status === 204) {
    return null as T;
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }

  return (await response.text()) as T;
}

async function requestBlob(path: string, options: ApiRequestOptions = {}): Promise<Blob> {
  const headers = new Headers(options.headers || {});
  const accessToken = await getCachedSession();

  if (accessToken?.accessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${accessToken.accessToken}`);
  }

  const url = buildUrl(path, options.params);

  let response: Response;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      response = await fetch(url, {
        method: "GET",
        headers,
        credentials: "include",
        signal: controller.signal,
      });
    } catch (firstError: any) {
      if (firstError?.name === "AbortError") {
        throw new Error(`Request timeout: GET ${url}`);
      }
      try {
        response = await fetch(url, {
          method: "GET",
          headers,
          credentials: "include",
        });
      } catch {
        throw new Error(`Network error: GET ${url} (${firstError?.message || firstError})`);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (fetchError: any) {
    throw new Error(fetchError?.message || `Network error: GET ${url}`);
  }

  if (response.status === 401 && accessToken?.accessToken) {
    const { signOut } = await import("next-auth/react");
    const { clearTransientState } = await import("../store/clear-transient-state");
    clearTransientState();
    await signOut({ redirect: false });
    window.location.href = "/login?expired=true";
    throw new Error("Session expired. Please login again.");
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(extractErrorMessage(text, `Request failed with status ${response.status}`));
  }

  return await response.blob();
}

async function uploadFile(path: string, file: File): Promise<any> {
  const headers = new Headers();
  const accessToken = await getCachedSession();

  if (accessToken?.accessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${accessToken.accessToken}`);
  }

  const formData = new FormData();
  formData.append("file", file);

  const url = buildUrl(path);

  let response: Response;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        credentials: "include",
        signal: controller.signal,
        body: formData,
      });
    } catch (firstError: any) {
      if (firstError?.name === "AbortError") {
        throw new Error(`Upload timeout: POST ${url}`);
      }
      try {
        response = await fetch(url, {
          method: "POST",
          headers,
          credentials: "include",
          body: formData,
        });
      } catch {
        throw new Error(`Network error: POST ${url} (${firstError?.message || firstError})`);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (fetchError: any) {
    throw new Error(fetchError?.message || `Network error: POST ${url}`);
  }

  if (response.status === 401 && accessToken?.accessToken) {
    const { signOut } = await import("next-auth/react");
    const { clearTransientState } = await import("../store/clear-transient-state");
    clearTransientState();
    await signOut({ redirect: false });
    window.location.href = "/login?expired=true";
    throw new Error("Session expired. Please login again.");
  }

if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(extractErrorMessage(text, `Request failed with status ${response.status}`));
  }

  return await response.json();
}

export const api = {
  get: <T = any>(path: string, options?: ApiRequestOptions) => request<T>("GET", path, options),
  post: <T = any>(path: string, body?: unknown, options?: Omit<ApiRequestOptions, "body">) =>
    request<T>("POST", path, { ...options, body }),
  put: <T = any>(path: string, body?: unknown, options?: Omit<ApiRequestOptions, "body">) =>
    request<T>("PUT", path, { ...options, body }),
  delete: <T = any>(path: string, options?: ApiRequestOptions) => request<T>("DELETE", path, options),
  blob: (path: string, options?: ApiRequestOptions) => requestBlob(path, options),
  upload: (path: string, file: File) => uploadFile(path, file),
};
