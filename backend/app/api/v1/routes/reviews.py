"""SM-2 错题间隔重复、主动标记巩固与微信订阅消息配额路由"""

from fastapi import APIRouter, Depends, Query

from app.core.auth import get_current_user
from app.core.config import get_settings
from app.core.exceptions import AuthorizationError, ResourceNotFoundError
from app.models.common import ApiResponse
from app.models.mastery import ReviewMarkRequest, SubscribeQuotaRequest
from app.repositories import mastery_repository, quiz_repository
from app.services import mastery_service

router = APIRouter(prefix="/reviews", tags=["reviews"])


@router.get("/due", response_model=ApiResponse)
async def get_due_reviews(
    limit: int = Query(default=20, ge=1, le=50),
    user_id: int = Depends(get_current_user),
):
    """获取当前用户已到期的 SM-2 错题/巩固队列。"""
    result = await mastery_service.get_due_reviews(user_id=user_id, limit=limit)
    return ApiResponse.success(data=result.model_dump())


@router.post("/mark", response_model=ApiResponse)
async def mark_review_card(
    req: ReviewMarkRequest,
    user_id: int = Depends(get_current_user),
):
    """主动将某道题加入待巩固（due）或标记为已掌握（skip -> mastered）。"""
    session = await quiz_repository.get_quiz_session_for_user(req.quiz_id)
    if session is None:
        raise ResourceNotFoundError("测验记录不存在")
    owner = session.get("user_id")
    if owner is not None and owner != user_id:
        raise AuthorizationError("无权操作他人测验题目")

    valid_ids = {q.get("id") for q in (session.get("questions") or []) if isinstance(q, dict)}
    if req.question_id not in valid_ids:
        raise ResourceNotFoundError("指定题目不存在")

    is_skip = req.action == "skip"
    status = "mastered" if is_skip else "due"
    card_id = await mastery_repository.upsert_review_card(
        user_id=user_id,
        domain_id=session.get("domain_id"),
        quiz_id=req.quiz_id,
        question_id=req.question_id,
        interval_days=30 if is_skip else 1,
        easiness_factor=2.5,
        repetitions=3 if is_skip else 0,
        status=status,
        immediately_due=(not is_skip),
    )
    await mastery_service.invalidate_mastery_cache(user_id)
    return ApiResponse.success(data={"card_id": card_id or 0, "status": status})


@router.post("/subscribe", response_model=ApiResponse)
async def grant_subscribe(
    req: SubscribeQuotaRequest,
    user_id: int = Depends(get_current_user),
):
    """微信订阅消息弹窗授权成功后登记可用一次性推送配额。"""
    settings = get_settings()
    configured_tpl = (getattr(settings, "wechat_subscribe_template_id", "") or "").strip()
    tpl_id = (req.template_id or "").strip() or configured_tpl or "default_review_reminder"
    if configured_tpl and tpl_id == "default_review_reminder":
        tpl_id = configured_tpl

    remaining = await mastery_repository.grant_subscribe_quota(
        user_id=user_id,
        template_id=tpl_id,
        count=req.count,
        preferred_hour=req.preferred_hour,
    )
    await mastery_service.invalidate_mastery_cache(user_id)
    return ApiResponse.success(data={"remaining_count": remaining})
