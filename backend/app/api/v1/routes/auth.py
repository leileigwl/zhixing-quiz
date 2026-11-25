"""邮箱验证码登录路由（H5 主登录通道；与 /user/login 微信登录签发同一种 JWT）"""

from fastapi import APIRouter, Request

from app.core.config import get_settings
from app.models.common import ApiResponse
from app.models.user import EmailSendCodeRequest, EmailVerifyRequest
from app.services import email_otp_service

router = APIRouter(prefix="/auth", tags=["auth"])


def get_client_ip(request: Request) -> str:
    """取客户端 IP：配置了 CLIENT_IP_HEADER（反代可信头）时优先读取其第一个值。"""
    header = get_settings().client_ip_header.strip()
    if header:
        value = request.headers.get(header, "")
        first = value.split(",")[0].strip()
        if first:
            return first[:64]
    return request.client.host if request.client else "unknown"


@router.post("/email/send-code", response_model=ApiResponse)
async def send_email_code(req: EmailSendCodeRequest, request: Request):
    """发送 6 位邮箱登录验证码（60s 冷却、每日上限、按 IP 限流；响应不泄露账号是否存在）。"""
    data = await email_otp_service.send_login_code(req.email, get_client_ip(request))
    return ApiResponse.success(data=data, message=data["message"])


@router.post("/email/verify", response_model=ApiResponse)
async def verify_email_code(req: EmailVerifyRequest, request: Request):
    """校验邮箱验证码，成功后按邮箱查/建用户并签发 JWT。"""
    result = await email_otp_service.verify_login_code(
        req.email, req.code, get_client_ip(request)
    )
    return ApiResponse.success(data=result.model_dump())
