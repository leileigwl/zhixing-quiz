"""用户路由"""

from fastapi import APIRouter, Depends, File, Query, UploadFile

from app.core.auth import get_current_user
from app.models.common import ApiResponse
from app.models.user import DevLoginRequest, LoginRequest, UpdateProfileRequest
from app.services import avatar_service, history_service, user_service

router = APIRouter(prefix="/user", tags=["user"])


@router.post("/login", response_model=ApiResponse)
async def login(req: LoginRequest):
    """微信小程序 code 登录并签发 JWT。"""
    result = await user_service.handle_login(req.code)
    return ApiResponse.success(data=result.model_dump())


@router.post("/dev-login", response_model=ApiResponse)
async def dev_login(req: DevLoginRequest):
    """仅非生产环境用于 H5/本地测试的快捷登录，生产环境强制返回 403。"""
    result = await user_service.handle_dev_login(req.dev_id, req.nickname)
    return ApiResponse.success(data=result.model_dump())


@router.get("/profile", response_model=ApiResponse)
async def get_profile(user_id: int = Depends(get_current_user)):
    result = await user_service.get_profile(user_id)
    return ApiResponse.success(data=result.model_dump())


@router.put("/profile", response_model=ApiResponse)
async def update_profile(
    req: UpdateProfileRequest,
    user_id: int = Depends(get_current_user),
):
    await user_service.update_profile(user_id, req.nickname, req.avatar_url)
    return ApiResponse.success()


@router.post("/avatar", response_model=ApiResponse)
async def upload_avatar(
    file: UploadFile = File(...),
    user_id: int = Depends(get_current_user),
):
    """上传头像图片（multipart，字段名 file）；返回新的 avatar_url 并已写回档案。"""
    # 多读 1 字节即可判断是否超限，避免把超大文件整个读进内存
    data = await file.read(avatar_service.AVATAR_MAX_BYTES + 1)
    url = await avatar_service.upload_avatar(user_id, data)
    return ApiResponse.success(data={"avatar_url": url})


@router.get("/quizzes", response_model=ApiResponse)
async def get_quiz_list(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    user_id: int = Depends(get_current_user),
):
    result = await history_service.get_quiz_history(user_id, page, page_size)
    return ApiResponse.success(data=result.model_dump())


@router.get("/quizzes/{quiz_id}", response_model=ApiResponse)
async def get_quiz_detail(
    quiz_id: str,
    user_id: int = Depends(get_current_user),
):
    result = await history_service.get_quiz_detail(quiz_id, user_id)
    if result is None:
        return ApiResponse.error(code=4004, message="闯关记录不存在")
    return ApiResponse.success(data=result.model_dump())
