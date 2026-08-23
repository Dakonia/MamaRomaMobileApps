import json
import logging
from typing import Any

from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.config import settings

logger = logging.getLogger(__name__)

_client: Redis | None = None


def client() -> Redis:
    global _client
    if _client is None:
        _client = Redis.from_url(str(settings.redis_url), decode_responses=True)
    return _client


async def get_json(key: str) -> Any | None:
    """Кеш — ускорение, а не источник правды: недоступный Redis не должен ронять запрос."""
    try:
        raw = await client().get(key)
    except (RedisError, OSError) as exc:
        logger.warning("Redis недоступен на чтении: %s", exc)
        return None

    return json.loads(raw) if raw else None


async def set_json(key: str, value: Any, ttl_seconds: int) -> None:
    try:
        await client().set(key, json.dumps(value, ensure_ascii=False), ex=ttl_seconds)
    except (RedisError, OSError) as exc:
        logger.warning("Redis недоступен на записи: %s", exc)
