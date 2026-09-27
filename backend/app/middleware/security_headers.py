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

        if request.url.path in {"/api/docs", "/api/redoc", "/docs/oauth2-redirect"}:
            response.headers.setdefault(
                "Content-Security-Policy",
                "default-src 'none'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdn.redoc.ly; "
                "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdn.redoc.ly; "
                "img-src 'self' data: https://fastapi.tiangolo.com; "
                "font-src 'self' data: https://cdn.jsdelivr.net https://cdn.redoc.ly; "
                "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
            )
        else:
            response.headers.setdefault(
                "Content-Security-Policy",
                "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
            )
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)")
        if not settings.DEBUG:
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response