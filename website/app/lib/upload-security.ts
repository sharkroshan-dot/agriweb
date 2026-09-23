/**
 * Client- and server-side-safe upload validation.
 * Validates magic bytes (not just the filename) so HTML/SVG/script uploads
 * that would be served from /public are rejected.
 */

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"] as const;
export type ImageExt = (typeof IMAGE_EXTENSIONS)[number];

const MAGIC: Record<ImageExt, readonly number[][]> = {
  jpg: [[0xff, 0xd8, 0xff]],
  jpeg: [[0xff, 0xd8, 0xff]],
  png: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  webp: [[0x52, 0x49, 0x46, 0x46]], // RIFF....WEBP
  gif: [[0x47, 0x49, 0x46, 0x38]], // GIF87a / GIF89a
};

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export class UploadError extends Error {}

/** Determine a safe extension from magic bytes, falling back to a validated name. */
export function sniffImageExt(buf: Buffer, filename: string): ImageExt {
  for (const ext of IMAGE_EXTENSIONS) {
    const sigs = MAGIC[ext];
    if (sigs.some((sig) => sig.every((byte, i) => buf[i] === byte))) {
      // WebP requires the RIFF + WEBP chunk header.
      if (ext === "webp" && buf.toString("ascii", 8, 12) !== "WEBP") {
        continue;
      }
      return ext;
    }
  }
  const fromName = filename.toLowerCase().split(".").pop();
  if (fromName === "webp" && buf.toString("ascii", 0, 4) === "RIFF") return "webp";
  throw new UploadError("File is not a supported image (jpg, png, webp, gif)");
}

/** Validate size and type; returns the canonical extension. */
export function validateImageUpload(buf: Buffer, filename: string): ImageExt {
  if (buf.length === 0) throw new UploadError("Empty file");
  if (buf.length > MAX_AVATAR_BYTES) {
    throw new UploadError("File too large (max 2 MB)");
  }
  return sniffImageExt(buf, filename);
}
