"""知识域画像聚合、学习记忆曲线数据与 Redis 缓存服务"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from app.core.config import get_settings
from app.core.redis_client import cache_delete, cache_get_json, cache_set_json
from app.models.mastery import (
    DifficultyMatrixStats,
    DomainMasterySummary,
    DueReviewCardItem,
    DueReviewsResponse,
    MasteryOverviewResponse,
    RetentionCurvePoint,
    WeeklyRhythmDay,
)
from app.repositories import mastery_repository, user_repository
from app.services.adaptive_service import (
    compute_adaptive_plan,
    compute_days_elapsed,
    compute_retention_rate,
)

WEEK_LABELS_BY_PY_WEEKDAY = ("一", "二", "三", "四", "五", "六", "日")


def _mastery_cache_key(user_id: int) -> str:
    return f"zx:mastery:{user_id}"


async def invalidate_mastery_cache(user_id: int) -> None:
    await cache_delete(_mastery_cache_key(user_id))


def _build_weekly_rhythm(daily_counts: dict[str, int]) -> list[WeeklyRhythmDay]:
    today = datetime.now().date()
    days: list[WeeklyRhythmDay] = []
    for offset in range(-4, 3):
        d = today + timedelta(days=offset)
        date_str = d.strftime("%Y-%m-%d")
        cnt = int(daily_counts.get(date_str, 0))
        days.append(
            WeeklyRhythmDay(
                day_label=WEEK_LABELS_BY_PY_WEEKDAY[d.weekday()],
                date_num=d.strftime("%d"),
                completed_count=cnt,
                is_today=(offset == 0),
                active=(cnt > 0 or offset == 0),
            )
        )
    return days


def _build_retention_curve(
    stability_days: float,
    current_retention: float,
) -> list[RetentionCurvePoint]:
    s = max(1.5, float(stability_days or 5.0))
    pre_val = round(min(92.0, max(38.0, current_retention)), 1)
    recovery_val = round(min(96.0, max(86.0, current_retention + 18.0)), 1)
    return [
        RetentionCurvePoint(day_label="D1", retention_pct=94.0),
        RetentionCurvePoint(
            day_label="D3",
            retention_pct=compute_retention_rate(2.0, max(2.0, s * 0.7)),
        ),
        RetentionCurvePoint(day_label="重测前", retention_pct=pre_val, is_today=True),
        RetentionCurvePoint(day_label="今日巩固", retention_pct=recovery_val, is_recovery=True),
        RetentionCurvePoint(
            day_label="+7天",
            retention_pct=compute_retention_rate(7.0, max(6.0, s * 1.45)),
        ),
        RetentionCurvePoint(
            day_label="+14天",
            retention_pct=compute_retention_rate(14.0, max(8.0, s * 1.65)),
        ),
    ]


async def get_mastery_overview(
    user_id: int,
    domain_id: Optional[int] = None,
) -> MasteryOverviewResponse:
    """获取用户学习记忆曲线、领域三维能力矩阵、本周节律及未来 7 天预测。"""
    cache_key = _mastery_cache_key(user_id)
    if domain_id is None:
        cached = await cache_get_json(cache_key)
        if isinstance(cached, dict):
            try:
                return MasteryOverviewResponse.model_validate(cached)
            except Exception:
                pass

    user = await user_repository.get_user_by_id(user_id)
    streak_days = int((user or {}).get("streak_days") or 0)
    raw_rows = await mastery_repository.list_user_mastery_rows(user_id)
    daily_counts = await mastery_repository.get_user_daily_counts(user_id, days=7)
    forecast = await mastery_repository.get_seven_day_forecast(user_id)
    total_due, _ = await mastery_repository.list_due_review_cards(user_id, limit=1)

    settings = get_settings()
    tpl_id = (getattr(settings, "wechat_subscribe_template_id", "") or "").strip() or "default_review_reminder"
    subscribe_remaining = await mastery_repository.get_subscribe_quota(user_id, tpl_id)

    now = datetime.now()
    domain_summaries: list[DomainMasterySummary] = []

    for r in raw_rows:
        days_elapsed = compute_days_elapsed(r.get("last_practiced_at"), now=now)
        live_retention = (
            compute_retention_rate(days_elapsed, r["stability_days"])
            if r.get("last_practiced_at") is not None
            else r["retention_rate"]
        )
        easy_acc = round((r["easy_correct"] / r["easy_total"]) * 100.0, 1) if r["easy_total"] else 0.0
        med_acc = round((r["medium_correct"] / r["medium_total"]) * 100.0, 1) if r["medium_total"] else 0.0
        hard_acc = round((r["hard_correct"] / r["hard_total"]) * 100.0, 1) if r["hard_total"] else 0.0

        plan = compute_adaptive_plan(
            requested_count=5,
            adaptive_mode=True,
            mastery_profile=r,
        )
        domain_summaries.append(
            DomainMasterySummary(
                domain_id=r["domain_id"],
                name=r["name"],
                color_token=r["color_token"],
                doc_count=r["doc_count"],
                mastery_score=round(r["mastery_score"], 1),
                retention_rate=round(live_retention, 1),
                stability_days=round(r["stability_days"], 1),
                due_review_count=r["due_review_count"],
                recommended_count=plan.recommended_count,
                below_threshold=(live_retention < 50.0),
                difficulty_stats=DifficultyMatrixStats(
                    easy_accuracy=easy_acc,
                    medium_accuracy=med_acc,
                    hard_accuracy=hard_acc,
                    easy_total=r["easy_total"],
                    medium_total=r["medium_total"],
                    hard_total=r["hard_total"],
                ),
            )
        )

    focus: Optional[DomainMasterySummary] = None
    if domain_id is not None:
        focus = next((d for d in domain_summaries if d.domain_id == domain_id), None)
    if focus is None and domain_summaries:
        focus = min(domain_summaries, key=lambda d: d.retention_rate)

    overall_retention = (
        round(sum(d.retention_rate for d in domain_summaries) / len(domain_summaries), 1)
        if domain_summaries
        else 85.0
    )
    target_stability = focus.stability_days if focus else 6.0
    target_retention = focus.retention_rate if focus else overall_retention

    response = MasteryOverviewResponse(
        streak_days=max(1, streak_days) if domain_summaries else streak_days,
        overall_retention=overall_retention,
        due_review_total=total_due,
        subscribe_remaining=subscribe_remaining,
        focus_domain=focus,
        domains=domain_summaries,
        retention_curve=_build_retention_curve(target_stability, target_retention),
        weekly_rhythm=_build_weekly_rhythm(daily_counts),
        seven_day_forecast=forecast,
    )

    if domain_id is None:
        await cache_set_json(cache_key, response.model_dump(), ttl_seconds=60)

    return response


async def get_due_reviews(user_id: int, limit: int = 20) -> DueReviewsResponse:
    total_due, rows = await mastery_repository.list_due_review_cards(user_id, limit=limit)
    items = [DueReviewCardItem.model_validate(row) for row in rows]
    return DueReviewsResponse(total_due=total_due, items=items)
