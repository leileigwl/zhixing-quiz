"""JWT 鉴权模块"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import Request

from app.core.config import get_settings
from app.core.db import get_mysql_pool
from app.core.exceptions import AuthenticationError
from app.repositories import user_repository

ALGORITHM = "HS256"


def create_token(user_id: int, openid: str) -> str:
    """签发访问 JWT Token（含签发时间、过期时间与 token_type）。"""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {
        "user_id": user_id,
        "openid": openid,
        "token_type": "access",
        "iat": now,
        "exp": expire,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    """解析并校验 JWT Token，失败时抛出 AuthenticationError。"""
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[ALGORITHM],
            options={"require": ["exp", "user_id"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise AuthenticationError("登录已过期，请重新登录") from exc
    except jwt.InvalidTokenError as exc:
        raise AuthenticationError("无效的登录凭证") from exc

    token_type = payload.get("token_type")
    if token_type is not None and token_type != "access":
        raise AuthenticationError("无效的登录凭证类型")

    user_id = payload.get("user_id")
    if not isinstance(user_id, int) or isinstance(user_id, bool) or user_id <= 0:
        raise AuthenticationError("无效的用户身份信息")

    return payload


def _extract_token(request: Request) -> Optional[str]:
    """从请求 Header 中提取 Bearer Token。"""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
        return token or None
    return None


async def get_current_user(request: Request) -> int:
    """必选鉴权依赖，返回 user_id；当数据库在线时同步校验用户记录存在。"""
    token = _extract_token(request)
    if not token:
        raise AuthenticationError()

    payload = decode_token(token)
    user_id = payload["user_id"]

    # 若 MySQL 连接池在线，核验用户仍存在于库中，避免失效账户触发外键错误
    if get_mysql_pool() is not None:
        user = await user_repository.get_user_by_id(user_id)
        if user is None:
            raise AuthenticationError("用户不存在或登录凭证已失效")

    return user_id


async def get_optional_user(request: Request) -> Optional[int]:
    """可选鉴权依赖，返回 user_id 或 None，不抛出异常。"""
    token = _extract_token(request)
    if not token:
        return None
    try:
        payload = decode_token(token)
        return payload["user_id"]
    except AuthenticationError:
        return None
