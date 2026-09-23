import { getServerSession } from "next-auth";
import { authOptions } from "../../../../auth";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { validateImageUpload, UploadError } from "../../../lib/upload-security";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions as any);
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("avatar") as File | null;
  if (!file) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  let ext: string;
  try {
    ext = validateImageUpload(buffer, file.name);
  } catch (err) {
    const message = err instanceof UploadError ? err.message : "Upload failed";
    return Response.json({ error: message }, { status: 400 });
  }

  const uploadDir = path.join(process.cwd(), "public", "uploads", "avatars");
  await mkdir(uploadDir, { recursive: true });

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await writeFile(path.join(uploadDir, filename), buffer);

  const avatarUrl = `/uploads/avatars/${filename}`;

  const token = (session as any).accessToken;
  if (token) {
    const backend = "http://localhost:8000";
    await fetch(`${backend}/api/v1/users/me`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ avatar_url: avatarUrl }),
    }).catch(() => {});
  }

  return Response.json({ data: { avatarUrl } });
}
