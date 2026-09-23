import { getServerSession } from "next-auth";
import { authOptions } from "../../../../auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession(authOptions as any);
  return Response.json(session || {});
}
