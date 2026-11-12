"""异步任务数据访问层（MySQL 持久化 + Redis 热状态读缓存）"""

from __future__ import annotations

import json
import time
from typing import Optional

import aiomysql
import structlog

from app.core.db import get_mysql_pool
from app.core.redis_client import cache_get_json, cache_set_json

logger = structlog.get_logger()


def _task_cache_key(task_id: str) -> str:
    return f"zx:task:{task_id}"


async def create_task(
    task_id: str,
    user_id: Optional[int],
    user_input: str,
    question_count: int,
    difficulty: str,
    adaptive_mode: bool = False,
    self_rated_level: Optional[str] = None,
    enable_web_search: bool = False,
    doc_id: Optional[str] = None,
    domain_id: Optional[int] = None,
) -> None:
    pool = get_mysql_pool()
    if pool is None:
        return
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO quiz_tasks "
                "(task_id, user_id, user_input, question_count, difficulty, "
                "adaptive_mode, self_rated_level, enable_web_search, doc_id, domain_id, status, stage) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending', 'queued')",
                (
                    task_id,
                    user_id,
                    user_input,
                    question_count,
                    difficulty,
                    1 if adaptive_mode else 0,
                    self_rated_level,
                    1 if enable_web_search else 0,
                    doc_id,
                    domain_id,
                ),
            )
    await cache_set_json(
        _task_cache_key(task_id),
        {
            "task_id": task_id,
            "user_id": user_id,
            "status": "pending",
            "stage": "queued",
            "stage_message": None,
            "telemetry": None,
            "created_at_ts": time.time(),
            "result_json": None,
            "error_message": None,
        },
        ttl_seconds=900,
    )


async def update_task_stage(
    task_id: str,
    stage: str,
    stage_message: Optional[str] = None,
    telemetry: Optional[dict] = None,
) -> None:
    """更新异步出题任务当前执行阶段并刷新 Redis 缓存（仅阶段切换时写 MySQL）。"""
    cached = await cache_get_json(_task_cache_key(task_id))
    prev_stage = cached.get("stage") if isinstance(cached, dict) else None
    if prev_stage != stage:
        pool = get_mysql_pool()
        if pool is not None:
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "UPDATE quiz_tasks SET stage = %s WHERE task_id = %s",
                        (stage, task_id),
                    )
    if isinstance(cached, dict):
        cached["stage"] = stage
        if stage_message is not None:
            cached["stage_message"] = stage_message
        if telemetry is not None:
            cached["telemetry"] = telemetry
        await cache_set_json(_task_cache_key(task_id), cached, ttl_seconds=900)


async def update_task_status(
    task_id: str,
    status: str,
    result_json: Optional[dict] = None,
    error_message: Optional[str] = None,
    stage: Optional[str] = None,
    stage_message: Optional[str] = None,
    telemetry: Optional[dict] = None,
) -> None:
    pool = get_mysql_pool()
    if pool is None:
        return
    resolved_stage = stage
    if resolved_stage is None:
        if status == "completed":
            resolved_stage = "completed"
        elif status == "failed":
            resolved_stage = "failed"
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            if resolved_stage is not None:
                await cur.execute(
                    "UPDATE quiz_tasks SET status = %s, stage = %s, result_json = %s, error_message = %s WHERE task_id = %s",
                    (
                        status,
                        resolved_stage,
                        json.dumps(result_json, ensure_ascii=False) if result_json else None,
                        error_message,
                        task_id,
                    ),
                )
            else:
                await cur.execute(
                    "UPDATE quiz_tasks SET status = %s, result_json = %s, error_message = %s WHERE task_id = %s",
                    (
                        status,
                        json.dumps(result_json, ensure_ascii=False) if result_json else None,
                        error_message,
                        task_id,
                    ),
                )

    cached = await cache_get_json(_task_cache_key(task_id))
    user_id = cached.get("user_id") if isinstance(cached, dict) else None
    created_at_ts = cached.get("created_at_ts") if isinstance(cached, dict) else None
    merged_telemetry = telemetry if telemetry is not None else (cached.get("telemetry") if isinstance(cached, dict) else None)
    if user_id is None:
        row = await _fetch_task_from_mysql(task_id)
        user_id = row.get("user_id") if row else None
    await cache_set_json(
        _task_cache_key(task_id),
        {
            "task_id": task_id,
            "user_id": user_id,
            "status": status,
            "stage": resolved_stage or (cached.get("stage") if isinstance(cached, dict) else "queued"),
            "stage_message": stage_message,
            "telemetry": merged_telemetry,
            "created_at_ts": created_at_ts,
            "result_json": result_json,
            "error_message": error_message,
        },
        ttl_seconds=900,
    )


async def _fetch_task_from_mysql(task_id: str) -> Optional[dict]:
    pool = get_mysql_pool()
    if pool is None:
        return None
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT task_id, user_id, status, stage, result_json, error_message "
                "FROM quiz_tasks WHERE task_id = %s",
                (task_id,),
            )
            row = await cur.fetchone()
            if row is None:
                return None
            result = row["result_json"]
            if isinstance(result, str):
                result = json.loads(result)
            return {
                "task_id": row["task_id"],
                "user_id": row["user_id"],
                "status": row["status"],
                "stage": row.get("stage") or "queued",
                "result_json": result,
                "error_message": row["error_message"],
            }


async def get_task(task_id: str) -> Optional[dict]:
    cached = await cache_get_json(_task_cache_key(task_id))
    if isinstance(cached, dict) and cached.get("task_id") == task_id:
        return cached
    row = await _fetch_task_from_mysql(task_id)
    if row:
        await cache_set_json(_task_cache_key(task_id), row, ttl_seconds=900)
    return row
