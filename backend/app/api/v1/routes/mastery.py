"""知识域掌握画像与学习记忆曲线路由"""

from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.core.auth import get_current_user
from app.models.common import ApiResponse
from app.services import mastery_service

router = APIRouter(prefix="/mastery", tags=["mastery"])


@router.get("/overview", response_model=ApiResponse)
async def mastery_overview(
    domain_id: Optional[int] = Query(default=None, ge=1, description="可选，聚焦查看指定知识域"),
    user_id: int = Depends(get_current_user),
):
    """获取学习记忆曲线、知识域三维能力矩阵、本周节律及未来 7 天预测。"""
    result = await mastery_service.get_mastery_overview(user_id=user_id, domain_id=domain_id)
    return ApiResponse.success(data=result.model_dump())
