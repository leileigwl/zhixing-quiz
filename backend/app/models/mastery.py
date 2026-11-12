"""知识域画像、学习记忆曲线与间隔重复复习数据模型"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class DifficultyMatrixStats(BaseModel):
    easy_accuracy: float = 0.0
    medium_accuracy: float = 0.0
    hard_accuracy: float = 0.0
    easy_total: int = 0
    medium_total: int = 0
    hard_total: int = 0


class DomainMasterySummary(BaseModel):
    domain_id: int
    name: str
    color_token: str = "blue"
    doc_count: int = 0
    mastery_score: float = 50.0
    retention_rate: float = 85.0
    stability_days: float = 5.0
    due_review_count: int = 0
    recommended_count: int = 6
    below_threshold: bool = False
    difficulty_stats: DifficultyMatrixStats = Field(default_factory=DifficultyMatrixStats)


class RetentionCurvePoint(BaseModel):
    day_label: str
    retention_pct: float
    baseline_pct: Optional[float] = None
    is_today: bool = False
    is_recovery: bool = False


class WeeklyRhythmDay(BaseModel):
    day_label: str
    date_num: str
    completed_count: int = 0
    is_today: bool = False
    active: bool = False


class MasteryOverviewResponse(BaseModel):
    streak_days: int = 0
    overall_retention: float = 85.0
    due_review_total: int = 0
    subscribe_remaining: int = 0
    focus_domain: Optional[DomainMasterySummary] = None
    domains: list[DomainMasterySummary] = Field(default_factory=list)
    retention_curve: list[RetentionCurvePoint] = Field(default_factory=list)
    weekly_rhythm: list[WeeklyRhythmDay] = Field(default_factory=list)
    seven_day_forecast: list[int] = Field(default_factory=lambda: [0, 0, 0, 0, 0, 0, 0])


class DueReviewCardItem(BaseModel):
    card_id: int
    question_id: str
    quiz_id: str
    domain_id: Optional[int] = None
    domain_name: str = "综合知识域"
    q_type: Literal["single", "multiple", "judge"] = "single"
    stem: str
    options: list[dict] = Field(default_factory=list)
    answer: list[str] = Field(default_factory=list)
    explanation: str = ""
    user_selected: list[str] = Field(default_factory=list)
    knowledge_point: str = ""
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    repetitions: int = 0
    interval_days: int = 1
    status: Literal["active", "due", "mastered"] = "due"
    next_review_at: str
    last_reviewed_at: Optional[str] = None


class DueReviewsResponse(BaseModel):
    total_due: int = 0
    unresolved_total: int = 0
    domain_id: Optional[int] = None
    items: list[DueReviewCardItem] = Field(default_factory=list)


class ReviewMarkRequest(BaseModel):
    quiz_id: str
    question_id: str
    action: Literal["add", "skip"] = "add"


class ReviewPracticeItem(BaseModel):
    card_id: int
    selected_answers: list[str] = Field(default_factory=list)
    is_correct: bool
    duration_ms: int = Field(default=0, ge=0)
    mark_review: bool = False


class ReviewPracticeSubmitRequest(BaseModel):
    items: list[ReviewPracticeItem] = Field(min_length=1, max_length=50)


class ReviewPracticeSubmitResponse(BaseModel):
    practiced_count: int = 0
    correct_count: int = 0
    graduated_count: int = 0
    remaining_due: int = 0
    streak_days: int = 0


class SubscribeQuotaRequest(BaseModel):
    template_id: str = "default_review_reminder"
    count: int = Field(default=1, ge=1, le=20)
    preferred_hour: int = Field(default=20, ge=0, le=23)
