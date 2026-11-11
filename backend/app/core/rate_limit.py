"""分布式 Redis 滑动窗口限流器 + 单元测试内存兼容层"""

from __future__ import annotations

import time
import uuid
from collections import defaultdict, deque

import structlog

from app.core.exceptions import RateLimitError
from app.core.redis_client import get_redis

logger = structlog.get_logger()

_REQUEST_WINDOWS: dict[str, deque[float]] = defaultdict(deque)


def check_rate_limit(key: str, max_requests: int, window_seconds: int = 60) -> None:
    """进程内滑动窗口限流（兼容单测与 Redis 不可用时兜底）。"""
    if max_requests <= 0:
        return

    now = time.monotonic()
    cutoff = now - window_seconds
    bucket = _REQUEST_WINDOWS[key]

    while bucket and bucket[0] <= cutoff:
        bucket.popleft()

    if len(bucket) >= max_requests:
        raise RateLimitError(f"请求过于频繁，每分钟最多发起 {max_requests} 次出题请求，请稍后再试")

    bucket.append(now)


_SLIDING_WINDOW_LUA = """
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', tonumber(ARGV[1]))
local cnt = redis.call('ZCARD', KEYS[1])
if cnt >= tonumber(ARGV[4]) then
    return 0
end
redis.call('ZADD', KEYS[1], tonumber(ARGV[2]), ARGV[3])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[5]))
return 1
"""


async def check_rate_limit_async(key: str, max_requests: int, window_seconds: int = 60) -> None:
    """跨 Worker 原子滑动窗口限流（Redis Lua 原子脚本优先，Redis 不可用时降级本地窗口）。"""
    if max_requests <= 0:
        return

    redis_client = get_redis()
    if redis_client is None:
        check_rate_limit(key, max_requests=max_requests, window_seconds=window_seconds)
        return

    now_ms = int(time.time() * 1000)
    cutoff_ms = now_ms - window_seconds * 1000
    redis_key = f"zx:rl:{key}"
    member = f"{now_ms}:{uuid.uuid4().hex[:8]}"

    try:
        allowed = await redis_client.eval(
            _SLIDING_WINDOW_LUA,
            1,
            redis_key,
            cutoff_ms,
            now_ms,
            member,
            max_requests,
            window_seconds + 5,
        )
        if int(allowed) == 0:
            raise RateLimitError(
                f"请求过于频繁，每分钟最多发起 {max_requests} 次出题请求，请稍后再试"
            )
    except RateLimitError:
        raise
    except Exception as exc:
        logger.warning("redis_rate_limit_fallback_local", key=key, error=str(exc))
        check_rate_limit(key, max_requests=max_requests, window_seconds=window_seconds)


def reset_rate_limiter() -> None:
    """清空所有本地限流计数（供单元测试隔离使用）。"""
    _REQUEST_WINDOWS.clear()
