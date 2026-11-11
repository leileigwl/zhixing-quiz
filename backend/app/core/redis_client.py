"""Redis 异步连接池、ARQ 任务队列池与跨进程 JSON 缓存工具"""

from __future__ import annotations

import json
from typing import Any, Optional

import structlog
from arq import create_pool
from arq.connections import ArqRedis, RedisSettings
from redis.asyncio import Redis

from app.core.config import get_settings

logger = structlog.get_logger()

_redis_client: Optional[Redis] = None
_arq_pool: Optional[ArqRedis] = None


async def init_redis_client() -> Optional[Redis]:
    """初始化全局异步 Redis 客户端；连接失败时降级返回 None 并记录告警。"""
    global _redis_client
    if _redis_client is not None:
        return _redis_client

    settings = get_settings()
    if not settings.redis_url:
        return None

    try:
        client = Redis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=3,
        )
        await client.ping()
        _redis_client = client
        logger.info("redis_connected", redis_url=settings.redis_url.split("@")[-1])
    except Exception as exc:
        logger.warning("redis_connect_failed_fallback_local", error=str(exc))
        _redis_client = None
    return _redis_client


async def init_arq_pool() -> Optional[ArqRedis]:
    """初始化 ARQ Redis 任务入队连接池。"""
    global _arq_pool
    if _arq_pool is not None:
        return _arq_pool

    settings = get_settings()
    if not settings.enable_arq_queue or not settings.redis_url:
        return None

    try:
        pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        _arq_pool = pool
        logger.info("arq_pool_initialized")
    except Exception as exc:
        logger.warning("arq_pool_init_failed", error=str(exc))
        _arq_pool = None
    return _arq_pool


def get_redis() -> Optional[Redis]:
    return _redis_client


def get_arq_pool() -> Optional[ArqRedis]:
    return _arq_pool


async def close_redis_and_arq() -> None:
    global _redis_client, _arq_pool
    if _arq_pool is not None:
        try:
            await _arq_pool.aclose()
        except Exception:
            pass
        _arq_pool = None
    if _redis_client is not None:
        try:
            await _redis_client.aclose()
        except Exception:
            pass
        _redis_client = None


async def cache_get_json(key: str) -> Optional[Any]:
    client = get_redis()
    if client is None:
        return None
    try:
        raw = await client.get(key)
        return json.loads(raw) if raw else None
    except Exception:
        return None


async def cache_set_json(key: str, value: Any, ttl_seconds: int = 300) -> None:
    client = get_redis()
    if client is None:
        return
    try:
        await client.set(key, json.dumps(value, ensure_ascii=False), ex=ttl_seconds)
    except Exception as exc:
        logger.warning("redis_cache_set_failed", key=key, error=str(exc))


async def cache_delete(key: str) -> None:
    client = get_redis()
    if client is None:
        return
    try:
        await client.delete(key)
    except Exception:
        pass
