"""知识域画像聚合、真实双轨学习记忆曲线数学模型与 Redis 缓存服务"""

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


def build_weekly_rhythm(daily_counts: dict[str, int]) -> list[WeeklyRhythmDay]:
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


def build_retention_curve(
    stability_days: float,
    current_retention: float,
    *,
    mastery_score: Optional[float] = None,
    session_accuracy: Optional[float] = None,
    days_elapsed: float = 0.0,
) -> list[RetentionCurvePoint]:
    """根据真实领域稳定性 S、掌握分与本次测验准确率绘制双轨保持率曲线（杜绝模板化假 V 谷）。"""
    s_new = max(1.5, float(stability_days or 5.0))
    # 若尚未强化，假设自然遗忘稳定性更低
    s_base = max(1.2, s_new * 0.48)

    if session_accuracy is not None:
        acc = max(0.0, min(100.0, float(session_accuracy)))
        m_score = float(mastery_score if mastery_score is not None else acc)
        # 复测前估计保持率：受当前已有掌握度与间隔衰减共同决定
        base_anchor = max(28.0, min(88.0, m_score * 0.85))
        pre_val = round(
            max(22.0, min(88.0, base_anchor * (compute_retention_rate(max(0.8, days_elapsed), s_base) / 100.0))),
            1,
        )
        # 本次强化后保持率：答对越高越接近 98%，低准确率则平滑反映仍有薄弱项
        now_val = round(
            max(38.0, min(98.0, pre_val + (acc - pre_val * 0.45) * 0.55 if acc >= 50 else max(pre_val + 6.0, acc * 0.85 + 22.0))),
            1,
        )
        now_val = max(pre_val + 4.0, now_val)
        now_val = min(98.0, now_val)

        # 前序起点：上次学完时的初始记忆水平
        prior_start = round(max(pre_val + 10.0, min(96.0, base_anchor + 18.0)), 1)
        scale = now_val / 100.0
        base_scale = pre_val / 100.0
        return [
            RetentionCurvePoint(
                day_label="上次巩固",
                retention_pct=prior_start,
                baseline_pct=prior_start,
            ),
            RetentionCurvePoint(
                day_label="测前遗忘",
                retention_pct=pre_val,
                baseline_pct=pre_val,
                is_today=True,
            ),
            RetentionCurvePoint(
                day_label="本次巩固",
                retention_pct=now_val,
                baseline_pct=round(max(18.0, compute_retention_rate(1.0, s_base) * base_scale), 1),
                is_recovery=True,
            ),
            RetentionCurvePoint(
                day_label="+3天",
                retention_pct=round(max(18.0, compute_retention_rate(3.0, s_new) * scale), 1),
                baseline_pct=round(max(18.0, compute_retention_rate(3.0, s_base) * base_scale), 1),
            ),
            RetentionCurvePoint(
                day_label="+7天",
                retention_pct=round(max(18.0, compute_retention_rate(7.0, s_new) * scale), 1),
                baseline_pct=round(max(18.0, compute_retention_rate(7.0, s_base) * base_scale), 1),
            ),
            RetentionCurvePoint(
                day_label="+14天",
                retention_pct=round(max(18.0, compute_retention_rate(14.0, s_new) * scale), 1),
                baseline_pct=round(max(18.0, compute_retention_rate(14.0, s_base) * base_scale), 1),
            ),
        ]

    # 领域图谱总览态：真实展现该域过去经过天数衰退曲线 + 若立即巩固后的对比投影
    now_ret = round(max(20.0, min(98.0, float(current_retention or 82.0))), 1)
    m_score = float(mastery_score if mastery_score is not None else now_ret)
    origin_val = round(max(now_ret + 4.0, min(97.0, m_score * 0.45 + 52.0)), 1)
    boosted_val = round(min(98.0, max(now_ret + 10.0, m_score * 0.5 + 48.0)), 1)
    s_boosted = max(s_new * 1.35, 4.0)

    return [
        RetentionCurvePoint(
            day_label="起点",
            retention_pct=origin_val,
            baseline_pct=origin_val,
        ),
        RetentionCurvePoint(
            day_label="今日实测",
            retention_pct=now_ret,
            baseline_pct=now_ret,
            is_today=True,
        ),
        RetentionCurvePoint(
            day_label="巩固后",
            retention_pct=boosted_val,
            baseline_pct=round(max(18.0, compute_retention_rate(1.0, s_base) * (now_ret / 100.0)), 1),
            is_recovery=True,
        ),
        RetentionCurvePoint(
            day_label="+3天",
            retention_pct=round(max(18.0, compute_retention_rate(3.0, s_boosted) * (boosted_val / 100.0)), 1),
            baseline_pct=round(max(18.0, compute_retention_rate(3.0, s_base) * (now_ret / 100.0)), 1),
        ),
        RetentionCurvePoint(
            day_label="+7天",
            retention_pct=round(max(18.0, compute_retention_rate(7.0, s_boosted) * (boosted_val / 100.0)), 1),
            baseline_pct=round(max(18.0, compute_retention_rate(7.0, s_base) * (now_ret / 100.0)), 1),
        ),
        RetentionCurvePoint(
            day_label="+14天",
            retention_pct=round(max(18.0, compute_retention_rate(14.0, s_boosted) * (boosted_val / 100.0)), 1),
            baseline_pct=round(max(18.0, compute_retention_rate(14.0, s_base) * (now_ret / 100.0)), 1),
        ),
    ]


# 兼容旧函数名
def _build_weekly_rhythm(daily_counts: dict[str, int]) -> list[WeeklyRhythmDay]:
    return build_weekly_rhythm(daily_counts)


def _build_retention_curve(stability_days: float, current_retention: float) -> list[RetentionCurvePoint]:
    return build_retention_curve(stability_days, current_retention)


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
    total_due, _ = await mastery_repository.list_due_review_cards(user_id, limit=1, domain_id=domain_id)

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
    target_stability = focus.stability_days if focus else 5.0
    target_retention = focus.retention_rate if focus else overall_retention
    target_mastery = focus.mastery_score if focus else overall_retention

    response = MasteryOverviewResponse(
        streak_days=max(1, streak_days) if domain_summaries else streak_days,
        overall_retention=overall_retention,
        due_review_total=total_due,
        subscribe_remaining=subscribe_remaining,
        focus_domain=focus,
        domains=domain_summaries,
        retention_curve=build_retention_curve(
            target_stability,
            target_retention,
            mastery_score=target_mastery,
        ),
        weekly_rhythm=build_weekly_rhythm(daily_counts),
        seven_day_forecast=forecast,
    )

    if domain_id is None:
        await cache_set_json(cache_key, response.model_dump(), ttl_seconds=60)

    return response


async def get_due_reviews(
    user_id: int,
    limit: int = 20,
    domain_id: Optional[int] = None,
    include_all_unresolved: bool = False,
) -> DueReviewsResponse:
    kwargs: dict = {"limit": limit}
    if domain_id is not None:
        kwargs["domain_id"] = domain_id
    if include_all_unresolved:
        kwargs["include_all_unresolved"] = True

    total_due, rows = await mastery_repository.list_due_review_cards(user_id, **kwargs)
    unresolved = await mastery_repository.count_unresolved_review_cards(user_id, domain_id=domain_id)
    if unresolved == 0 and total_due > 0:
        unresolved = total_due
    items = [DueReviewCardItem.model_validate(row) for row in rows]
    return DueReviewsResponse(
        total_due=total_due,
        unresolved_total=unresolved,
        domain_id=domain_id,
        items=items,
    )
