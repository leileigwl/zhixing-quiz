"""倒 U 自适应出题策略与 Ebbinghaus 遗忘保持率数学引擎"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from app.core.config import get_settings


@dataclass(frozen=True)
class AdaptivePlan:
    question_count: int
    difficulty_instruction: str
    reason: str
    recommended_count: int


def compute_retention_rate(
    days_elapsed: float,
    stability_days: float,
) -> float:
    """R(t) = 100 * e^(-t / S)，限制在 [18.0, 100.0] 便于曲线可视化。"""
    s = max(1.0, float(stability_days or 5.0))
    t = max(0.0, float(days_elapsed or 0.0))
    raw = 100.0 * math.exp(-t / s)
    return round(max(18.0, min(100.0, raw)), 2)


def compute_days_elapsed(last_practiced_at: Optional[datetime], now: Optional[datetime] = None) -> float:
    if last_practiced_at is None:
        return 0.0
    ref = now or datetime.now()
    delta = (ref - last_practiced_at).total_seconds()
    return max(0.0, delta / 86400.0)


def compute_adaptive_plan(
    *,
    requested_count: int,
    adaptive_mode: bool,
    self_rated_level: Optional[str] = None,
    mastery_profile: Optional[dict] = None,
    base_difficulty: str = "mixed",
) -> AdaptivePlan:
    """根据用户三维历史画像（或冷启动自评）决定倒 U 型题量与 E/M/H 配比。"""
    settings = get_settings()
    max_q = int(getattr(settings, "quiz_max_question_count", 15))
    clamped_req = max(3, min(max_q, int(requested_count or 5)))

    total_answered = 0
    mastery_score: Optional[float] = None
    if mastery_profile:
        total_answered = (
            int(mastery_profile.get("easy_total", 0))
            + int(mastery_profile.get("medium_total", 0))
            + int(mastery_profile.get("hard_total", 0))
        )
        if total_answered >= 3:
            mastery_score = float(mastery_profile.get("mastery_score", 50.0))

    # 计算推荐题量与难度说明
    if mastery_score is not None:
        if mastery_score < 45.0:
            rec_count = 4
            diff_hint = "以 easy 基础概念与常见易错点为主（约 70% easy + 30% medium），帮助建立正反馈"
            reason = f"当前领域掌握度 {round(mastery_score)}%，建议小步高频巩固基础"
        elif mastery_score < 80.0:
            rec_count = 6
            diff_hint = "以 medium 场景理解与少量 hard 综合辨析为主（约 20% easy + 50% medium + 30% hard）"
            reason = f"当前领域处于成长期（{round(mastery_score)}%），适度加题强化迁移与变式"
        else:
            rec_count = 3
            diff_hint = "精炼高阶排查题（约 30% medium + 70% hard），聚焦边界条件与工程权衡"
            reason = f"当前领域掌握度已达 {round(mastery_score)}%，收敛为 3 道高难精测"
    else:
        level = self_rated_level or (mastery_profile.get("self_rated_level") if mastery_profile else None)
        if level == "unfamiliar":
            rec_count = 4
            diff_hint = "冷启动陌生领域：以 easy 入门核心概念为主（75% easy + 25% medium）"
            reason = "冷启动「陌生」模式：先出 4 道基础题降低门槛"
        elif level == "mastered":
            rec_count = 3
            diff_hint = "冷启动高手模式：跳过死记硬背，直接以 hard 深度推理题为主"
            reason = "冷启动「熟练」模式：直接上 3 道高阶辨析检验上限"
        else:
            rec_count = 6
            diff_hint = "均衡进阶：easy、medium、hard 按 2:3:1 梯度递进"
            reason = "冷启动「略懂」模式：推荐 6 题阶梯检测盲区"

    final_count = rec_count if adaptive_mode else clamped_req
    final_count = max(3, min(max_q, final_count))

    difficulty_instruction = diff_hint if base_difficulty == "mixed" else base_difficulty
    return AdaptivePlan(
        question_count=final_count,
        difficulty_instruction=difficulty_instruction,
        reason=reason,
        recommended_count=rec_count,
    )
