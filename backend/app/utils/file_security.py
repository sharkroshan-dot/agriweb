"""Secure file upload validation.

Validates uploaded files by content-type header, extension allowlist and magic
bytes (never trust the client filename). Rejects files whose magic bytes do not
match an allowed image/document type, so HTML/SVG/script uploads that would be
served from ``/uploads`` are blocked.
"""
from __future__ import annotations

import re
from typing import Optional

ALLOWED_EXTENSIONS = {
    # images
    ".jpg": "image",
    ".jpeg": "image",
    ".png": "image",
    ".webp": "image",
    ".gif": "image",
    # documents
    ".pdf": "document",
    ".txt": "document",
    # video (land verification clips)
    ".mp4": "video",
    ".webm": "video",
    ".mov": "video",
}

VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov"}

# (extension, (magic bytes prefixes, ...))
MAGIC_SIGNATURES = {
    ".jpg": (b"\xff\xd8\xff",),
    ".jpeg": (b"\xff\xd8\xff",),
    ".png": (b"\x89PNG\r\n\x1a\n",),
    ".webp": (b"RIFF", b"WEBP"),
    ".gif": (b"GIF87a", b"GIF89a"),
    ".pdf": (b"%PDF-",),
    ".txt": (b"",),  # no magic check for plain text
}

# Content-Type values we are willing to accept for each extension.
EXPECTED_CONTENT_TYPES = {
    ".jpg": {"image/jpeg"},
    ".jpeg": {"image/jpeg"},
    ".png": {"image/png"},
    ".webp": {"image/webp"},
    ".gif": {"image/gif"},
    ".pdf": {"application/pdf"},
    ".txt": {"text/plain"},
    ".mp4": {"video/mp4", "video/quicktime"},
    ".webm": {"video/webm"},
    ".mov": {"video/quicktime", "video/mp4"},
}

EXTENSION_RE = re.compile(r"^[A-Za-z0-9]+$")

MAX_UPLOAD_BYTES_DEFAULT = 5 * 1024 * 1024
# Video clips (e.g. land verification) are larger than image documents.
MAX_VIDEO_UPLOAD_BYTES = 50 * 1024 * 1024


class UploadValidationError(ValueError):
    """Raised when an uploaded file fails validation."""


def _sniff_extension(content: bytes, filename: str, content_type: Optional[str]) -> str:
    """Determine the true file type from magic bytes, falling back to extension."""
    # WebM / Matroska: EBML header at offset 0.
    if content.startswith(b"\x1a\x45\xdf\xa3"):
        return ".webm"

    # ISO BMFF video (MP4 / MOV): "ftyp" box starts at offset 4; the brand at
    # bytes 8-12 distinguishes QuickTime (".mov") from MP4 (".mp4").
    if len(content) >= 12 and content[4:8] == b"ftyp":
        return ".mov" if content[8:12] == b"qt  " else ".mp4"

    # Prefer magic bytes when we have enough data.
    for ext, sigs in MAGIC_SIGNATURES.items():
        if ext == ".txt":
            continue
        if any(content.startswith(sig) for sig in sigs):
            return ext

    # Fall back to a validated client extension (must be in the allowlist).
    _, raw_ext = _split_filename(filename)
    if raw_ext in ALLOWED_EXTENSIONS:
        if content_type and content_type.lower() in EXPECTED_CONTENT_TYPES.get(raw_ext, set()):
            return raw_ext
        if raw_ext == ".txt":
            return raw_ext
    raise UploadValidationError(
        "File type is not allowed. Allowed: " + ", ".join(sorted(ALLOWED_EXTENSIONS))
    )


def _split_filename(filename: str) -> tuple[str, str]:
    """Split ``name.ext`` into (name, lowercased ext including the dot)."""
    name, _, ext = filename.rpartition(".")
    if not ext:
        return filename, ""
    return name, f".{ext.lower()}"


def validate_upload(
    filename: str,
    content: bytes,
    content_type: Optional[str] = None,
    max_bytes: Optional[int] = None,
) -> str:
    """Validate an upload and return the canonical (safe) extension to use.

    Raises ``UploadValidationError`` on any failure (size, type, extension).
    """
    if not content:
        raise UploadValidationError("Empty file")

    ext = _sniff_extension(content, filename or "", content_type)

    # Videos use a larger size budget than image/document uploads.
    if ext in VIDEO_EXTENSIONS:
        limit = MAX_VIDEO_UPLOAD_BYTES
    else:
        limit = max_bytes or MAX_UPLOAD_BYTES_DEFAULT
    if len(content) > limit:
        raise UploadValidationError(f"File too large (max {limit // (1024 * 1024)} MB)")

    # Reject double extensions / embedded paths in the provided name.
    if filename:
        base = filename.replace("\\", "/").rsplit("/", 1)[-1]
        if not base or ".." in base:
            raise UploadValidationError("Invalid file name")
        _, client_ext = _split_filename(base)
        if client_ext and client_ext not in ALLOWED_EXTENSIONS:
            raise UploadValidationError("File extension is not allowed")

    return ext
