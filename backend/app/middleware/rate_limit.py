"""Redis-backed rate limiting middleware.

Applies a fixed-window rate limit per client IP, with stricter limits for
sensitive authentication endpoints (login, OTP, registration, password reset)
to prevent brute-force / OTP-spam attacks.

Works against the real Redis when available and degrades gracefully to the
in-memory fallback cache in development.
"""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.requests import Request
import time
import logging

from app.core.config import settings
from app.database.redis import RedisClient

logger = logging.getLogger(__name__)

# (limit, window_seconds) per URL prefix, most specific first.
# Authentication endpoints are the main brute-force surface, so they get a
# tighter budget than the generic API limit.
DEFAULT_RULES: list[tuple[str, int, int]] = [
    ("/api/v1/auth/login", 5, 60),
    ("/api/v1/auth/login/otp", 5, 60),
    ("/api/v1/auth/verify-otp", 5, 60),
    ("/api/v1/auth/register", 5, 60),
    ("/api/v1/auth/forgot-password", 5, 60),
    ("/api/v1/auth/reset-password", 5, 60),
    ("/api/v1/auth/refresh", 15, 60),
    ("/api/", settings.RATE_LIMIT_PER_MINUTE, 60),
]


class RateLimitExceeded(Exception):
    """Raised when a client exceeds its rate limit budget."""


def get_rule_for_path(path: str) -> tuple[int, int]:
    """Return the (limit, window) rule matching the request path."""
    for prefix, limit, window in DEFAULT_RULES:
        if path.startswith(prefix):
            return limit, window
    return settings.RATE_LIMIT_PER_MINUTE, 60


def _client_ip(request: Request) -> str:
    """Best-effort client IP extraction (honouring X-Forwarded-For)."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _window_start(now: float, window: int) -> int:
    return int(now) // window


async def _increment_count(redis_key: str) -> int:
    """Increment a counter, setting an expiry the first time it is created."""
    # Redis: INCR + EXPIRE for atomic TTL-on-first-create.
    if RedisClient.client:
        pipe = RedisClient.client.pipeline()
        await pipe.incr(redis_key)
        await pipe.expire(redis_key, settings.RATE_LIMIT_PER_HOUR)
        results = await pipe.execute()
        return int(results[0])

    current = await RedisClient.increment(redis_key)
    # TTL handling for the in-memory fallback.
    exists = await RedisClient.exists(redis_key)
    if exists and not await RedisClient.get_cache(f"{redis_key}:ttl"):
        await RedisClient.set_cache(f"{redis_key}:ttl", 1, ttl=settings.RATE_LIMIT_PER_HOUR)
    return int(current)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Enforce per-IP rate limits on API routes."""

    def __init__(self, app, enabled: bool = True):
        super().__init__(app)
        self.enabled = enabled

    async def dispatch(self, request: Request, call_next):
        if not self.enabled:
            return await call_next(request)

        path = request.url.path
        # Only limit API traffic; skip static/docs/websocket upgrades.
        if not path.startswith("/api/") or request.headers.get("upgrade", "").lower() == "websocket":
            return await call_next(request)

        limit, window = get_rule_for_path(path)
        ip = _client_ip(request)
        now = time.time()
        counter_key = f"ratelimit:{ip}:{path}:{_window_start(now, window)}"

        try:
            count = await _increment_count(counter_key)
        except Exception as exc:  # never fail-open on a limiter error
            logger.warning("Rate limiter error (failing open): %s", exc)
            return await call_next(request)

        if count > limit:
            retry_after = window - (int(now) % window)
            return JSONResponse(
                status_code=429,
                content={
                    "detail": "Too many requests. Please try again later.",
                    "retry_after_seconds": retry_after,
                },
                headers={"Retry-After": str(retry_after)},
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(max(0, limit - count))
        return response
