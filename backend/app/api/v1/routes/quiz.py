"""出题路由（全量 JWT 鉴权 + 滑动窗口限流 + 任务归属校验）"""

from fastapi import APIRouter, Depends

from app.core.auth import get_current_user
from app.core.config import get_settings
from app.core.rate_limit import check_rate_limit
from app.models.common import ApiResponse
from app.models.quiz import QuizGenerateRequest
from app.services.quiz_service import (
    create_quiz_task,
    get_quiz_images_status,
    get_quiz_task_status,
    handle_quiz_generate,
)

router = APIRouter(prefix="/quiz", tags=["quiz"])


def _enforce_quiz_rate_limit(user_id: int) -> None:
    settings = get_settings()
    limit = int(getattr(settings, "quiz_rate_limit_per_minute", 5))
    check_rate_limit(f"quiz:user:{user_id}", max_requests=limit, window_seconds=60)


@router.post("/generate", response_model=ApiResponse)
async def quiz_generate(
    req: QuizGenerateRequest,
    user_id: int = Depends(get_current_user),
):
    _enforce_quiz_rate_limit(user_id)
    result = await handle_quiz_generate(req, user_id=user_id)
    return ApiResponse.success(data=result.model_dump())


@router.post("/generate/async", response_model=ApiResponse)
async def quiz_generate_async(
    req: QuizGenerateRequest,
    user_id: int = Depends(get_current_user),
):
    """异步创建出题任务，立即返回 task_id。"""
    _enforce_quiz_rate_limit(user_id)
    result = await create_quiz_task(req, user_id=user_id)
    return ApiResponse.success(data=result.model_dump())


@router.get("/task/{task_id}", response_model=ApiResponse)
async def quiz_task_status(
    task_id: str,
    user_id: int = Depends(get_current_user),
):
    """轮询查询任务状态（校验归属当前用户）。"""
    result = await get_quiz_task_status(task_id, user_id=user_id)
    return ApiResponse.success(data=result.model_dump())


@router.get("/{quiz_id}/images", response_model=ApiResponse)
async def quiz_images_status(
    quiz_id: str,
    user_id: int = Depends(get_current_user),
):
    """轮询查询题目后台配图补齐状态（校验归属当前用户）。"""
    result = await get_quiz_images_status(quiz_id, user_id=user_id)
    return ApiResponse.success(data=result.model_dump())
