"""轻量内存滑动窗口限流器（适用于单 Worker 异步服务防刷）"""

from __future__ import annotations

import time
from collections import defaultdict, deque

from app.core.exceptions import RateLimitError

_REQUEST_WINDOWS: dict[str, deque[float]] = defaultdict(deque)


def check_rate_limit(key: str, max_requests: int, window_seconds: int = 60) -> None:
    """检查给定 key 在滑动时间窗口内是否超限；max_requests <= 0 表示关闭限制。"""
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


def reset_rate_limiter() -> None:
    """清空所有限流计数（供单元测试隔离使用）。"""
    _REQUEST_WINDOWS.clear()
