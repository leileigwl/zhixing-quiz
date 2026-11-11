"""报告相关数据模型"""

from typing import Literal, Optional

from pydantic import BaseModel, Field

from .quiz import AnswerRecord, Question


class ReportGenerateRequest(BaseModel):
    quiz_id: str
    topic: str
    questions: list[Question]
    answer_records: list[AnswerRecord]


class SubmittedAnswerItem(BaseModel):
    """前端交卷作答明细（服务端忽略客户端传入的 is_correct 并权威重算）。"""

    question_id: str
    selected_answers: list[str]
    duration_ms: int = Field(default=0, ge=0)
    is_correct: Optional[bool] = None


class ReportSubmitRequest(BaseModel):
    quiz_id: str
    answer_records: list[SubmittedAnswerItem]


class ReportOutput(BaseModel):
    """AI 生成报告的结构化输出 Schema"""

    accuracy: int = Field(description="正确率百分比")
    mastered_points: list[str] = Field(description="掌握较好的知识点")
    weak_points: list[str] = Field(description="薄弱知识点")
    three_line_summary: list[str] = Field(description="三句知识总结")
    advice: list[str] = Field(description="后续建议")
    share_quote: str = Field(description="一句可用于分享的学习金句")


class ReportGenerateResponse(BaseModel):
    accuracy: int
    mastered_points: list[str]
    weak_points: list[str]
    three_line_summary: list[str]
    advice: list[str]
    share_quote: str


class ReportSubmitResponse(BaseModel):
    quiz_id: str
    accuracy: int
    correct_count: int
    wrong_count: int
    total_questions: int
    xp_gain: int
    xp_awarded: bool
    already_submitted: bool = False
    report_status: Literal["generating", "completed", "failed"]
    report: Optional[ReportGenerateResponse] = None
    error_message: Optional[str] = None


class ReportStatusResponse(BaseModel):
    quiz_id: str
    report_status: Literal["generating", "completed", "failed"]
    report: Optional[ReportGenerateResponse] = None
    error_message: Optional[str] = None
