"""SM-2 间隔重复引擎、即刻待巩固入队、原卡核销推进与 ARQ 延迟微信订阅召回服务"""

from __future__ import annotations

from datetime import timedelta
from typing import Optional

import httpx
import structlog

from app.core.config import get_settings
from app.core.redis_client import get_arq_pool
from app.models.mastery import ReviewPracticeItem, ReviewPracticeSubmitResponse
from app.models.quiz import AnswerRecord, Question
from app.repositories import mastery_repository
from app.services import mastery_service

logger = structlog.get_logger()

SM2_INTERVAL_STEPS = (1, 3, 7, 15, 30)
GRADUATION_REPETITIONS = 3


def compute_sm2_next(
    repetitions: int,
    easiness_factor: float,
    is_correct: bool,
) -> tuple[int, int, float, str]:
    """根据本次作答结果计算下一轮 SM-2 状态：(reps, interval_days, ef, status)。"""
    ef = max(1.3, float(easiness_factor or 2.5))
    if not is_correct:
        next_ef = max(1.3, round(ef - 0.2, 2))
        return 0, SM2_INTERVAL_STEPS[0], next_ef, "active"

    next_reps = repetitions + 1
    next_ef = min(2.8, round(ef + 0.05, 2))
    idx = min(next_reps - 1, len(SM2_INTERVAL_STEPS) - 1)
    next_interval = SM2_INTERVAL_STEPS[idx]
    status = "mastered" if next_reps >= GRADUATION_REPETITIONS else "active"
    return next_reps, next_interval, next_ef, status


async def _schedule_deferred_activation(
    user_id: int,
    card_id: int,
    interval_days: int,
    repetitions: int,
) -> None:
    """向 ARQ 投递带 _defer_by 的精确延迟复习唤醒任务（确保 _expires > _defer_by）。"""
    arq_pool = get_arq_pool()
    if arq_pool is None:
        return
    try:
        defer = timedelta(days=max(1, interval_days))
        expires = defer + timedelta(days=2)
        job_id = f"rev:{user_id}:{card_id}:{repetitions}"
        await arq_pool.enqueue_job(
            "job_activate_review_reminder",
            card_id,
            _job_id=job_id,
            _defer_by=defer,
            _expires=expires,
        )
    except Exception as exc:
        logger.warning("arq_review_defer_enqueue_failed", card_id=card_id, error=str(exc))


async def process_submission_reviews(
    user_id: int,
    quiz_id: str,
    domain_id: Optional[int],
    questions: list[Question],
    graded_records: list[AnswerRecord],
    mark_review_map: Optional[dict[str, bool]] = None,
    skip_question_ids: Optional[set[str]] = None,
) -> int:
    """交卷后将新错题/主动标再练卡即刻写入当天待巩固队列，并投递次日 ARQ 复查提醒。"""
    q_map = {q.id: q for q in questions}
    mark_map = mark_review_map or {}
    skip_ids = skip_question_ids or set()
    created_or_reset = 0

    for rec in graded_records:
        if rec.question_id not in q_map:
            continue
        if rec.question_id in skip_ids and not mark_map.get(rec.question_id) and not rec.mark_review:
            continue

        question_uid = f"{quiz_id}:{rec.question_id}"
        existing = await mastery_repository.get_review_card_by_uid(user_id, question_uid)
        wants_review = (not rec.is_correct) or bool(rec.mark_review) or bool(mark_map.get(rec.question_id))

        if existing is not None:
            passed = rec.is_correct and not bool(mark_map.get(rec.question_id))
            reps, interval, ef, status = compute_sm2_next(
                existing["repetitions"],
                existing["easiness_factor"],
                is_correct=passed,
            )
            card_status = status if passed else "due"
            card_id = await mastery_repository.upsert_review_card(
                user_id=user_id,
                domain_id=domain_id,
                quiz_id=quiz_id,
                question_id=rec.question_id,
                interval_days=interval,
                easiness_factor=ef,
                repetitions=reps,
                status=card_status,
                immediately_due=(not passed),
            )
            if card_id and card_status != "mastered":
                await _schedule_deferred_activation(user_id, card_id, interval, reps)
            continue

        if wants_review:
            reps, interval, ef, _ = compute_sm2_next(0, 2.5, is_correct=False)
            # 新错题当天立即可练（status='due', immediately_due=True），不再隐身 24 小时
            card_id = await mastery_repository.upsert_review_card(
                user_id=user_id,
                domain_id=domain_id,
                quiz_id=quiz_id,
                question_id=rec.question_id,
                interval_days=interval,
                easiness_factor=ef,
                repetitions=reps,
                status="due",
                immediately_due=True,
            )
            created_or_reset += 1
            if card_id:
                await _schedule_deferred_activation(user_id, card_id, interval, reps)

    return created_or_reset


async def progress_source_review_cards(
    user_id: int,
    questions: list[Question],
    graded_records: list[AnswerRecord],
    source_card_ids: list[int],
    mark_review_map: Optional[dict[str, bool]] = None,
) -> tuple[int, set[str]]:
    """当某套测验由 review_card_ids 变式复习生成时，按题号/顺序回写推进或核销原错题卡。"""
    if not source_card_ids:
        return 0, set()

    cards = await mastery_repository.get_review_cards_by_ids(user_id, source_card_ids)
    if not cards:
        return 0, set()

    card_map = {c["card_id"]: c for c in cards}
    rec_map = {r.question_id: r for r in graded_records}
    mark_map = mark_review_map or {}
    progressed = 0
    matched_qids: set[str] = set()

    for idx, q in enumerate(questions):
        rec = rec_map.get(q.id)
        if rec is None:
            continue
        target_cid = getattr(q, "source_card_id", None)
        if target_cid is None and idx < len(source_card_ids):
            target_cid = source_card_ids[idx]
        if target_cid is None or target_cid not in card_map:
            continue

        card = card_map[target_cid]
        matched_qids.add(q.id)
        passed = rec.is_correct and not bool(mark_map.get(q.id)) and not bool(rec.mark_review)
        reps, interval, ef, status = compute_sm2_next(
            card["repetitions"],
            card["easiness_factor"],
            is_correct=passed,
        )
        updated = await mastery_repository.update_review_card_progress(
            card_id=card["card_id"],
            user_id=user_id,
            interval_days=interval,
            easiness_factor=ef,
            repetitions=reps,
            status=status if passed else "due",
            immediately_due=(not passed),
        )
        if updated:
            progressed += 1
            if status != "mastered" or not passed:
                await _schedule_deferred_activation(user_id, updated, interval, reps)

    return progressed, matched_qids


async def handle_instant_review_practice(
    user_id: int,
    items: list[ReviewPracticeItem],
) -> ReviewPracticeSubmitResponse:
    """错题秒开回顾交卷结算：直接按 SM-2 推进/毕业原卡、更新域画像与打卡并刷新缓存。"""
    card_ids = [item.card_id for item in items]
    cards = await mastery_repository.get_review_cards_by_ids(user_id, card_ids)
    card_map = {c["card_id"]: c for c in cards}

    practiced = 0
    correct = 0
    graduated = 0
    domain_stats: dict[int, list[int]] = {}

    for item in items:
        card = card_map.get(item.card_id)
        if card is None:
            continue
        practiced += 1
        passed = bool(item.is_correct) and not bool(item.mark_review)
        if passed:
            correct += 1

        reps, interval, ef, status = compute_sm2_next(
            card["repetitions"],
            card["easiness_factor"],
            is_correct=passed,
        )
        final_status = status if passed else "due"
        updated = await mastery_repository.update_review_card_progress(
            card_id=card["card_id"],
            user_id=user_id,
            interval_days=interval,
            easiness_factor=ef,
            repetitions=reps,
            status=final_status,
            immediately_due=(not passed),
        )
        if updated:
            if final_status == "mastered":
                graduated += 1
            else:
                await _schedule_deferred_activation(user_id, updated, interval, reps)

        did = card.get("domain_id")
        if did is not None:
            bucket = domain_stats.setdefault(did, [0, 0, 0, 0])
            bucket[0] += 1
            if passed:
                bucket[1] += 1
            bucket[2] += max(0, int(item.duration_ms))
            bucket[3] += 1

    for did, (tot, corr, dur_sum, cnt) in domain_stats.items():
        avg_dur = round(dur_sum / cnt) if cnt else 0
        await mastery_repository.upsert_mastery_after_submission(
            user_id=user_id,
            domain_id=did,
            easy_correct=0,
            easy_total=0,
            medium_correct=corr,
            medium_total=tot,
            hard_correct=0,
            hard_total=0,
            avg_duration_ms=avg_dur,
        )

    streak_days = await mastery_repository.update_user_streak_on_submit(user_id) if practiced > 0 else 0
    await mastery_service.invalidate_mastery_cache(user_id)
    remaining_due, _ = await mastery_repository.list_due_review_cards(user_id, limit=1)

    return ReviewPracticeSubmitResponse(
        practiced_count=practiced,
        correct_count=correct,
        graduated_count=graduated,
        remaining_due=remaining_due,
        streak_days=streak_days,
    )


async def _fetch_wechat_access_token(app_id: str, app_secret: str) -> Optional[str]:
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(
                "https://api.weixin.qq.com/cgi-bin/token",
                params={
                    "grant_type": "client_credential",
                    "appid": app_id,
                    "secret": app_secret,
                },
            )
            data = resp.json()
            return data.get("access_token")
    except Exception as exc:
        logger.warning("wechat_access_token_failed", error=str(exc))
        return None


async def dispatch_wechat_subscribe_reminder(
    user_id: int,
    openid: str,
    domain_name: str,
    due_count: int = 1,
) -> bool:
    """若配置了订阅模板 ID 且用户仍有可用配额，幂等发送一次性微信订阅消息。"""
    settings = get_settings()
    template_id = (getattr(settings, "wechat_subscribe_template_id", "") or "").strip()
    app_id = (getattr(settings, "wechat_app_id", "") or "").strip()
    app_secret = (getattr(settings, "wechat_app_secret", "") or "").strip()

    if not template_id or not app_id or not app_secret:
        logger.debug("subscribe_push_skipped_unconfigured", user_id=user_id)
        return False

    if not openid or openid.startswith("dev_"):
        return False

    consumed = await mastery_repository.consume_subscribe_quota(user_id, template_id)
    if not consumed:
        return False

    access_token = await _fetch_wechat_access_token(app_id, app_secret)
    if not access_token:
        return False

    payload = {
        "touser": openid,
        "template_id": template_id,
        "page": "pages/index/index",
        "data": {
            "thing1": {"value": f"{domain_name[:12]} 到期错题"},
            "thing2": {"value": f"今日有 {due_count} 道错题可清零复习"},
        },
    }
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.post(
                f"https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token={access_token}",
                json=payload,
            )
            result = resp.json()
            ok = result.get("errcode", -1) == 0
            if not ok:
                logger.warning("wechat_subscribe_send_rejected", user_id=user_id, result=result)
            return ok
    except Exception as exc:
        logger.warning("wechat_subscribe_send_error", user_id=user_id, error=str(exc))
        return False


async def sweep_and_activate_due_reviews() -> int:
    """Cron 每小时扫表兜底补偿，激活已到期卡片并在有配额时推送。"""
    due_items = await mastery_repository.find_due_unnotified_cards(limit=100)
    if not due_items:
        return 0

    notified_ids: list[int] = []
    for item in due_items:
        await dispatch_wechat_subscribe_reminder(
            user_id=item["user_id"],
            openid=item["openid"],
            domain_name=item["domain_name"],
            due_count=1,
        )
        notified_ids.append(item["card_id"])

    await mastery_repository.mark_cards_notified(notified_ids)
    logger.info("cron_sweep_due_reviews_done", activated=len(notified_ids))
    return len(notified_ids)
