"""题库相关数据模型（支持 3~15 题常规出题、错题 1~15 题精准重练、多文档并行融合 RAG 与原卡关联）"""

from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator


class QuestionOption(BaseModel):
    key: str = Field(description="选项标识，如 A、B、C、D")
    text: str = Field(description="选项文本")


class Question(BaseModel):
    id: str = Field(description="题目编号，如 q1")
    type: Literal["single", "multiple", "judge"] = Field(description="题型")
    stem: str = Field(description="题干")
    options: list[QuestionOption] = Field(description="选项列表")
    answer: list[str] = Field(description="正确答案的 key 列表")
    explanation: str = Field(description="详细讲解")
    knowledge_point: str = Field(description="知识点标签")
    difficulty: Literal["easy", "medium", "hard"] = Field(description="难度")
    image_url: str | None = Field(default=None, description="AI 生成的题目配图 URL（可选）")
    source_card_id: Optional[int] = Field(default=None, description="关联的原 SM-2 错题卡 ID（可选）")


class QuizOutput(BaseModel):
    """AI 生成题库的结构化输出 Schema"""

    title: str = Field(description="学习主题")
    summary: str = Field(description="本次题库的主题摘要")
    questions: list[Question] = Field(description="题目列表")


class QuizGenerateRequest(BaseModel):
    user_input: str = Field(
        min_length=1,
        max_length=2000,
        description="用户输入的学习主题或提问",
    )
    reference_text: Optional[str] = Field(
        default=None,
        max_length=12000,
        description="可选，用户直接提供/粘贴的大段参考文本与讲义原文",
    )
    question_count: int = Field(default=5, ge=1, le=15, description="题目数量（常规 3~15 题，错题巩固支持 1~15 题）")
    difficulty: Literal["easy", "medium", "hard", "mixed"] = Field(
        default="mixed", description="难度"
    )
    adaptive_mode: bool = Field(
        default=False, description="是否启用后端画像驱动的倒 U 自适应题量与难度配比"
    )
    self_rated_level: Optional[Literal["unfamiliar", "familiar", "mastered"]] = Field(
        default=None, description="冷启动自评熟悉度"
    )
    doc_id: str | None = Field(
        default=None, description="可选，单篇知识库文档 ID（向后兼容）"
    )
    doc_ids: Optional[list[str]] = Field(
        default=None, description="可选，多篇知识库文档 ID 列表（支持三源并行融合 RAG）"
    )
    domain_id: Optional[int] = Field(
        default=None, description="可选，指定目标专注知识域 ID"
    )
    enable_web_search: bool = Field(
        default=False, description="前端显式联网搜索开关"
    )
    generate_images: bool = Field(
        default=False, description="是否为每道题目生成配图"
    )
    review_card_ids: Optional[list[int]] = Field(
        default=None, description="可选，针对到期错题卡定向巩固出题"
    )
    allow_prewarm: bool = Field(
        default=False, description="是否允许命中当前域后台预出题缓存以实现 0.1s 秒开"
    )

    @model_validator(mode="after")
    def _validate_question_count_with_mode(self):
        if not self.review_card_ids and self.question_count < 3:
            raise ValueError("常规出题数量不能少于 3 题")
        return self


class QuizGenerateResponse(BaseModel):
    quiz_id: str
    title: str
    summary: str
    questions: list[Question]
    source_type: Literal["llm_direct", "kb_rag", "web_search"] = "llm_direct"
    domain_id: Optional[int] = None
    domain_name: Optional[str] = None
    recommended_count: Optional[int] = None
    adaptive_reason: Optional[str] = None
    image_status: Literal["none", "generating", "completed", "partial", "failed"] = "none"
    image_notice: str | None = Field(
        default=None, description="配图相关的提示信息（如未登录/额度已用完/后台补图中等），无异常时为 None"
    )


class AnswerRecord(BaseModel):
    question_id: str
    selected_answers: list[str]
    is_correct: bool
    duration_ms: int = Field(ge=0)
    mark_review: bool = False


class QuizTaskCreateResponse(BaseModel):
    """创建出题任务的响应"""

    task_id: str


class QuizTaskTelemetry(BaseModel):
    """出题后台任务分阶段耗时与重试可观测指标。"""

    model: Optional[str] = None
    attempt: int = 1
    retry_reason: Optional[str] = None
    queue_wait_ms: Optional[int] = None
    context_prep_ms: Optional[int] = None
    domain_classify_ms: Optional[int] = None
    rag_search_ms: Optional[int] = None
    llm_ttft_ms: Optional[int] = None
    llm_total_ms: Optional[int] = None
    db_save_ms: Optional[int] = None
    total_ms: Optional[int] = None
    context_chars: int = 0
    output_chars: int = 0
    completion_tokens: Optional[int] = None
    tps: Optional[float] = None
    source_type: Optional[str] = None
    prewarm_hit: bool = False


class QuizTaskStatusResponse(BaseModel):
    """轮询任务状态的响应"""

    task_id: str
    status: Literal["pending", "running", "completed", "failed"]
    stage: Literal["queued", "fetching_context", "generating_quiz", "completed", "failed"] = "queued"
    stage_message: str | None = None
    telemetry: QuizTaskTelemetry | None = None
    result: "QuizGenerateResponse | None" = None
    error_message: str | None = None


class QuizImagesResponse(BaseModel):
    """轮询题库后台配图补齐状态"""

    quiz_id: str
    image_status: Literal["none", "generating", "completed", "partial", "failed"]
    image_urls: dict[str, str] = Field(default_factory=dict)
    image_notice: str | None = None
