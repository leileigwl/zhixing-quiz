"""用户相关数据模型"""

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


class UserProfile(BaseModel):
    id: int
    nickname: str
    avatar_url: str
    total_xp: int
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
    questions: list
    answer_records: Optional[list] = None
    report: Optional[dict] = None
    created_at: str
