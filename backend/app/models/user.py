"""用户相关数据模型（V2 扩展连续打卡天数与历史领域/来源标识）"""

from typing import Optional

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    code: str = Field(min_length=1, description="wx.login() 返回的 code")


class DevLoginRequest(BaseModel):
    dev_id: str = Field(
        default="dev_local_user",
        min_length=1,
        max_length=48,
        description="仅非生产环境用于 H5/本地测试的账号标识",
    )
    nickname: str = Field(
        default="知行体验官",
        min_length=1,
        max_length=40,
        description="本地测试用户昵称",
    )


class LoginResponse(BaseModel):
    token: str
    user: "UserBrief"


class UserBrief(BaseModel):
    id: int
    nickname: str
    avatar_url: str
    total_xp: int
    streak_days: int = 0


class UserProfile(BaseModel):
    id: int
    nickname: str
    avatar_url: str
    total_xp: int
    streak_days: int = 0
    quiz_count: int
    correct_count: int
    average_accuracy: int


class UpdateProfileRequest(BaseModel):
    nickname: Optional[str] = Field(default=None, max_length=100)
    avatar_url: Optional[str] = Field(default=None, max_length=500)


class QuizHistoryItem(BaseModel):
    quiz_id: str
    title: str
    accuracy: float
    question_count: int
    domain_name: Optional[str] = None
    source_type: Optional[str] = None
    created_at: str


class QuizHistoryList(BaseModel):
    items: list[QuizHistoryItem]
    total: int
    page: int
    page_size: int


class QuizDetailResponse(BaseModel):
    quiz_id: str
    title: str
    summary: str
    user_input: Optional[str] = None
    domain_name: Optional[str] = None
    source_type: Optional[str] = None
    questions: list
    answer_records: Optional[list] = None
    report: Optional[dict] = None
    image_status: str = "none"
    image_notice: Optional[str] = None
    report_status: Optional[str] = None
    report_error: Optional[str] = None
    created_at: str
