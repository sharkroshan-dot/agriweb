# backend/app/database/redis.py
import redis.asyncio as aioredis
from typing import Optional, Any
import json
import logging
import time
from app.core.config import settings

logger = logging.getLogger(__name__)

class RedisClient:
    """Redis cache connection manager."""
    
    client: Optional[aioredis.Redis] = None
    _memory_cache: dict[str, tuple[str, float | None]] = {}
    
    @classmethod
    async def connect(cls):
        """Connect to Redis."""
        try:
            cls.client = aioredis.from_url(
                settings.REDIS_URL,
                password=settings.REDIS_PASSWORD,
                decode_responses=True,
                max_connections=20
            )
            await cls.client.ping()
            logger.info("✅ Connected to Redis")
        except Exception as e:
            logger.error(f"❌ Failed to connect to Redis: {str(e)}")
            cls.client = None
            logger.warning("Redis is unavailable, using in-memory fallback cache for development")
    
    @classmethod
    async def close(cls):
        """Close Redis connection."""
        if cls.client:
            await cls.client.close()
            logger.info("✅ Redis connection closed")
        cls.client = None
        cls._memory_cache.clear()
    
    @classmethod
    async def health_check(cls) -> bool:
        """Check Redis health."""
        try:
            if not cls.client:
                return False
            await cls.client.ping()
            return True
        except Exception:
            return False
    
    @classmethod
    async def set_cache(cls, key: str, value: Any, ttl: Optional[int] = None):
        """Set a value in cache."""
        if isinstance(value, (dict, list)):
            value = json.dumps(value)
        if cls.client:
            if ttl:
                await cls.client.setex(key, ttl, value)
            else:
                await cls.client.set(key, value)
            return

        expires_at = time.time() + ttl if ttl else None
        cls._memory_cache[key] = (str(value), expires_at)
    
    @classmethod
    async def get_cache(cls, key: str) -> Optional[Any]:
        """Get a value from cache."""
        if cls.client:
            value = await cls.client.get(key)
        else:
            cached = cls._memory_cache.get(key)
            if not cached:
                return None
            value, expires_at = cached
            if expires_at is not None and time.time() > expires_at:
                cls._memory_cache.pop(key, None)
                return None

        if value:
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return value
        return None
    
    @classmethod
    async def delete_cache(cls, key: str):
        """Delete a value from cache."""
        if cls.client:
            await cls.client.delete(key)
        else:
            cls._memory_cache.pop(key, None)
    
    @classmethod
    async def clear_pattern(cls, pattern: str):
        """Clear all keys matching a pattern."""
        if cls.client:
            keys = await cls.client.keys(pattern)
            if keys:
                await cls.client.delete(*keys)
            return

        if pattern == "*":
            cls._memory_cache.clear()
            return

        if pattern.endswith("*"):
            prefix = pattern[:-1]
            for key in list(cls._memory_cache):
                if key.startswith(prefix):
                    cls._memory_cache.pop(key, None)
    
    @classmethod
    async def exists(cls, key: str) -> bool:
        """Check if a key exists."""
        if cls.client:
            return await cls.client.exists(key) > 0
        return await cls.get_cache(key) is not None
    
    @classmethod
    async def expire(cls, key: str, ttl: int):
        """Set expiration on a key."""
        if cls.client:
            await cls.client.expire(key, ttl)
            return

        cached = cls._memory_cache.get(key)
        if cached:
            value, _ = cached
            cls._memory_cache[key] = (value, time.time() + ttl)
    
    @classmethod
    async def increment(cls, key: str, amount: int = 1) -> int:
        """Increment a counter."""
        if cls.client:
            return await cls.client.incrby(key, amount)

        current = await cls.get_cache(key)
        current_value = int(current or 0) + amount
        cls._memory_cache[key] = (str(current_value), None)
        return current_value
    
    @classmethod
    async def decrement(cls, key: str, amount: int = 1) -> int:
        """Decrement a counter."""
        if cls.client:
            return await cls.client.decrby(key, amount)

        current = await cls.get_cache(key)
        current_value = int(current or 0) - amount
        cls._memory_cache[key] = (str(current_value), None)
        return current_value
