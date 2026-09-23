import { handlers } from "../../../../auth";

// NextAuth endpoints must always execute on the server. Prevent a stale or
// statically-rendered HTML response from being returned to the client session
// fetcher, which expects JSON.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const { GET, POST } = handlers;
