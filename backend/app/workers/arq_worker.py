"""独立 ARQ Worker 进程入口：承载异步出题、文档解析、复盘生成与 SM-2 复习唤起"""

from __future__ import annotations

from typing import Optional

import structlog
from arq import cron
from arq.connections import RedisSettings

from app.core.config import get_settings
from app.core.db import close_mysql_pool, init_mysql
from app.core.redis_client import close_redis_and_arq, init_arq_pool, init_redis_client
from app.repositories import mastery_repository
from app.services import (
    knowledge_service,
    mastery_service,
    quiz_service,
    report_service,
    review_service,
)

logger = structlog.get_logger()


async def startup(ctx: dict) -> None:
    """Worker 启动时初始化 MySQL 与 Redis/ARQ 连接池。"""
    settings = get_settings()
    settings.validate_runtime_security()
    if settings.mysql_auto_init:
        await init_mysql()
    await init_redis_client()
    await init_arq_pool()
    logger.info("arq_worker_started")


async def shutdown(ctx: dict) -> None:
    """Worker 退出时优雅关闭连接池。"""
    await close_redis_and_arq()
    await close_mysql_pool()
    logger.info("arq_worker_stopped")


async def job_generate_quiz(
    ctx: dict,
    task_id: str,
    req_payload: dict,
    user_id: Optional[int] = None,
) -> None:
    await quiz_service.run_quiz_job(task_id=task_id, req_payload=req_payload, user_id=user_id)


async def job_ingest_document(
    ctx: dict,
    doc_id: str,
    user_id: int,
    file_path: str,
    file_type: str,
    filename: Optional[str] = None,
) -> None:
    await knowledge_service.run_ingest_document_job(
        doc_id=doc_id,
        user_id=user_id,
        file_path=file_path,
        file_type=file_type,
        filename=filename,
    )


async def job_generate_report(
    ctx: dict,
    quiz_id: str,
    user_id: int,
    topic: str,
    questions_payload: list[dict],
    records_payload: list[dict],
    score_summary: dict,
) -> None:
    await report_service.run_generate_report_job(
        quiz_id=quiz_id,
        user_id=user_id,
        topic=topic,
        questions_payload=questions_payload,
        records_payload=records_payload,
        score_summary=score_summary,
    )


async def job_activate_review_reminder(ctx: dict, card_id: int) -> bool:
    """到点唤醒指定 SM-2 错题卡，触发一次性微信订阅提醒（若配额充足）。"""
    card = await mastery_repository.activate_review_card(card_id)
    if not card:
        return False

    sent = await review_service.dispatch_wechat_subscribe_reminder(
        user_id=card["user_id"],
        openid=card["openid"],
        domain_name=card["domain_name"],
        due_count=1,
    )
    await mastery_repository.mark_cards_notified([card_id])
    await mastery_service.invalidate_mastery_cache(card["user_id"])
    return sent


async def cron_sweep_due_reviews(ctx: dict) -> int:
    """每小时扫表兜底补偿已到期但尚未唤起的复习卡。"""
    return await review_service.sweep_and_activate_due_reviews()


async def job_prewarm_domain_quiz(ctx: dict, user_id: int, domain_id: int) -> bool:
    """后台静默为活跃/薄弱领域预热下一套自适应题。"""
    return await quiz_service.generate_and_cache_prewarm_quiz(user_id=user_id, domain_id=domain_id)


class WorkerSettings:
    functions = [
        job_generate_quiz,
        job_ingest_document,
        job_generate_report,
        job_activate_review_reminder,
        job_prewarm_domain_quiz,
    ]
    cron_jobs = [
        cron(cron_sweep_due_reviews, minute=0, second=0, run_at_startup=False),
    ]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    max_jobs = 10
    job_timeout = 300
    keep_result = 300
