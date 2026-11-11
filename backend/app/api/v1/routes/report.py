"""报告路由（JWT 鉴权 + 秒返算分异步复盘 + 兼容旧接口）"""

from fastapi import APIRouter, Depends

from app.core.auth import get_current_user
from app.models.common import ApiResponse
from app.models.report import ReportGenerateRequest, ReportSubmitRequest
from app.services.report_service import (
    get_report_status,
    handle_report_generate,
    handle_report_submit,
)

router = APIRouter(prefix="/report", tags=["report"])


@router.post("/submit", response_model=ApiResponse)
async def report_submit(
    req: ReportSubmitRequest,
    user_id: int = Depends(get_current_user),
):
    """秒返服务端权威判分与幂等 XP 结算，并启动后台 AI 复盘报告生成。"""
    result = await handle_report_submit(req, user_id=user_id)
    return ApiResponse.success(data=result.model_dump())


@router.get("/{quiz_id}", response_model=ApiResponse)
async def report_status(
    quiz_id: str,
    user_id: int = Depends(get_current_user),
):
    """轮询查询指定测验的 AI 复盘报告生成状态（校验归属当前用户）。"""
    result = await get_report_status(quiz_id, user_id=user_id)
    return ApiResponse.success(data=result.model_dump())


@router.post("/generate", response_model=ApiResponse)
async def report_generate(
    req: ReportGenerateRequest,
    user_id: int = Depends(get_current_user),
):
    result = await handle_report_generate(req, user_id=user_id)
    return ApiResponse.success(data=result.model_dump())
