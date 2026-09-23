"""Security headers middleware.

Adds hardening headers to every API response:
- Content-Security-Policy (default-src 'self'; the API serves JSON so this is safe)
- Strict-Transport-Security (HSTS) when served over HTTPS
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- Referrer-Policy
- Permissions-Policy
"""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from app.core.config import settings


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Attach security headers to all responses."""

    async def dispatch(self, request, call_next):
        response: Response = await call_next(request)

        # API responses are JSON; a strict CSP is safe here. CSP is enforced by
        # the website via next.config headers() - this is a backstop.
        response.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)")
        if not settings.DEBUG:
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response