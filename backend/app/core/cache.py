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


async def hits(key: str, ttl_seconds: int) -> int:
    """Сколько раз за окно уже обращались по этому ключу.

    Считаем в Redis: счётчик переживает перезапуск приложения и общий на все
    процессы. Redis лежит — возвращаем ноль: подсчёт попыток не повод отказывать
    людям во входе, это защита от перебора, а не проверка прав.
    """
    try:
        connection = client()
        count = int(await connection.incr(key))
        if count == 1:
            await connection.expire(key, ttl_seconds)
        return count
    except (RedisError, OSError) as exc:
        logger.warning("Redis недоступен на счётчике: %s", exc)
        return 0


async def forget(key: str) -> None:
    """Забыть счётчик — например, после удачного входа."""
    try:
        await client().delete(key)
    except (RedisError, OSError) as exc:
        logger.warning("Redis недоступен на сбросе счётчика: %s", exc)
