"""回归：记忆曲线页「每天看起来一模一样」。

根因（后端部分）：
1. 总览态「若巩固」点 = max(now_ret + 8, m_score * 0.55 + 44)，只要今日保持率低于约 m_score*0.55+36，
   右半段（若巩固 / +3 / +7 / +14 天）就只由静态掌握分决定，日复一日完全相同；
2. 全部域视图下，曲线左段真实测验节点取的是全局最近测验，而右段是 focus 域的保持率，两条数据源混在一条线上。
"""

from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest

from app.services import mastery_service

PROJECTION_LABELS = ("若巩固", "+3天", "+7天", "+14天")


def _projection(curve):
    return [p.retention_pct for p in curve if p.day_label in PROJECTION_LABELS]


class TestOverviewCurveProjection:
    def test_projection_moves_with_todays_retention_for_same_domain(self):
        """同一领域（掌握分 / 稳定性不变），只是今天的实时保持率不同，投影段必须不同。"""
        history = [{"day_label": "11/20", "accuracy": 70.0, "title": "QUIC"}]
        day_1 = mastery_service.build_retention_curve(
            6.0, 72.0, mastery_score=70.0, history_points=history
        )
        day_3 = mastery_service.build_retention_curve(
            6.0, 51.0, mastery_score=70.0, history_points=history
        )
        assert _projection(day_1) != _projection(day_3)
        # 越接近遗忘，巩固增益越大，但巩固后绝对值仍不应超过「保持得更好」的那天
        boost_1 = next(p for p in day_1 if p.is_recovery)
        boost_3 = next(p for p in day_3 if p.is_recovery)
        today_1 = next(p for p in day_1 if p.is_today)
        today_3 = next(p for p in day_3 if p.is_today)
        assert boost_3.retention_pct - today_3.retention_pct > boost_1.retention_pct - today_1.retention_pct
        assert boost_1.retention_pct > boost_3.retention_pct

    def test_recovery_never_below_today_and_capped(self):
        for now_ret in (18.0, 40.0, 75.0, 97.0):
            for m in (0.0, 50.0, 100.0):
                curve = mastery_service.build_retention_curve(5.0, now_ret, mastery_score=m)
                today = next(p for p in curve if p.is_today)
                boost = next(p for p in curve if p.is_recovery)
                assert today.retention_pct <= boost.retention_pct <= 98.0


def _row(last_practiced_at: datetime) -> dict:
    return {
        "domain_id": 7,
        "name": "计算机网络",
        "color_token": "blue",
        "mastery_score": 70.0,
        "easy_correct": 3,
        "easy_total": 4,
        "medium_correct": 3,
        "medium_total": 4,
        "hard_correct": 1,
        "hard_total": 2,
        "avg_duration_ms": 2000,
        "stability_days": 6.0,
        "retention_rate": 86.0,
        "last_practiced_at": last_practiced_at,
        "doc_count": 1,
        "due_review_count": 0,
    }


async def _overview_with(rows, history_mock: AsyncMock, domain_id=None):
    with (
        patch("app.services.mastery_service.cache_get_json", AsyncMock(return_value=None)),
        patch("app.services.mastery_service.cache_set_json", AsyncMock()),
        patch(
            "app.services.mastery_service.user_repository.get_user_by_id",
            AsyncMock(return_value={"id": 1, "streak_days": 2}),
        ),
        patch(
            "app.services.mastery_service.mastery_repository.list_user_mastery_rows",
            AsyncMock(return_value=rows),
        ),
        patch(
            "app.services.mastery_service.mastery_repository.get_user_daily_counts",
            AsyncMock(return_value={}),
        ),
        patch(
            "app.services.mastery_service.mastery_repository.get_user_weekly_sessions",
            AsyncMock(return_value={}),
        ),
        patch(
            "app.services.mastery_service.mastery_repository.get_domain_recent_history",
            history_mock,
        ),
        patch(
            "app.services.mastery_service.mastery_repository.get_seven_day_forecast",
            AsyncMock(return_value=[0] * 7),
        ),
        patch(
            "app.services.mastery_service.mastery_repository.list_due_review_cards",
            AsyncMock(return_value=(0, [])),
        ),
        patch(
            "app.services.mastery_service.mastery_repository.get_subscribe_quota",
            AsyncMock(return_value=0),
        ),
    ):
        return await mastery_service.get_mastery_overview(user_id=1, domain_id=domain_id)


@pytest.mark.asyncio
class TestOverviewCurveChangesDayToDay:
    async def test_curve_differs_three_vs_five_days_after_practice(self):
        history = AsyncMock(return_value=[{"day_label": "11/20", "accuracy": 70.0, "title": "QUIC"}])
        now = datetime.now()
        # 旧公式下第 3 天起投影段就被静态掌握分锁死（m=70 → 若巩固恒为 82.5）
        day_a = await _overview_with([_row(now - timedelta(days=3))], history)
        day_b = await _overview_with([_row(now - timedelta(days=5))], history)

        today_a = next(p for p in day_a.retention_curve if p.is_today)
        today_b = next(p for p in day_b.retention_curve if p.is_today)
        assert today_b.retention_pct < today_a.retention_pct
        # 关键回归点：投影段不能再是同一组数字
        assert _projection(day_a.retention_curve) != _projection(day_b.retention_curve)

    async def test_all_domain_view_uses_focus_domain_history(self):
        history = AsyncMock(return_value=[])
        await _overview_with([_row(datetime.now() - timedelta(days=1))], history)
        history.assert_awaited_once()
        assert history.await_args.kwargs["domain_id"] == 7

    async def test_explicit_domain_still_used_for_history(self):
        history = AsyncMock(return_value=[])
        await _overview_with([_row(datetime.now() - timedelta(days=1))], history, domain_id=7)
        assert history.await_args.kwargs["domain_id"] == 7

    async def test_no_domains_falls_back_to_requested_domain(self):
        history = AsyncMock(return_value=[])
        res = await _overview_with([], history)
        assert history.await_args.kwargs["domain_id"] is None
        assert len(res.retention_curve) >= 5
