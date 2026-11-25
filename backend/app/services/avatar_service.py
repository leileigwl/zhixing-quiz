"""用户头像上传：校验图片魔数与大小 → 存储（COS 或本地静态目录回落）→ 写回 users.avatar_url。

H5 端在浏览器里先把图片裁成正方形并压缩到 256px JPEG 再上传，正常只有几十 KB；
这里仍按 2MB 上限与魔数严格校验，不信任客户端的文件名和 Content-Type，且不接受 SVG（可内嵌脚本）。
"""

from __future__ import annotations

import secrets
from typing import Optional

import structlog

from app.core.exceptions import InvalidUploadError
from app.core.rate_limit import check_rate_limit_async
from app.repositories import user_repository
from app.services import cos_service

logger = structlog.get_logger()

AVATAR_MAX_BYTES = 2 * 1024 * 1024
AVATAR_UPLOADS_PER_HOUR = 20
MSG_BAD_TYPE = "头像仅支持 JPG / PNG / WebP / GIF 图片"
MSG_TOO_LARGE = "头像图片不能超过 2MB"
MSG_EMPTY = "头像图片不能为空"


def detect_image_type(data: bytes) -> Optional[tuple[str, str]]:
    """按文件头魔数识别图片类型，返回 (扩展名, Content-Type)；不认识返回 None。"""
    if data[:3] == b"\xff\xd8\xff":
        return "jpg", "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png", "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp", "image/webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif", "image/gif"
    return None


def validate_avatar_bytes(data: bytes) -> tuple[str, str]:
    if not data:
        raise InvalidUploadError(MSG_EMPTY)
    if len(data) > AVATAR_MAX_BYTES:
        raise InvalidUploadError(MSG_TOO_LARGE)
    kind = detect_image_type(data)
    if kind is None:
        raise InvalidUploadError(MSG_BAD_TYPE)
    return kind


async def upload_avatar(user_id: int, data: bytes) -> str:
    """保存头像并更新用户档案，返回可公开访问的 https 地址。"""
    ext, content_type = validate_avatar_bytes(data)
    await check_rate_limit_async(
        f"avatar:user:{user_id}",
        max_requests=AVATAR_UPLOADS_PER_HOUR,
        window_seconds=3600,
        message="头像更换过于频繁，请稍后再试",
    )
    # 文件名带随机串：每次更换都是新地址，避免浏览器 / CDN 缓存旧头像
    key = f"quiz-images/avatars/u{int(user_id)}_{secrets.token_hex(8)}.{ext}"
    url = await cos_service.upload_image_bytes(data, key, content_type)
    await user_repository.update_user_profile(user_id, None, url)
    logger.info("avatar_uploaded", user_id=user_id, size=len(data), content_type=content_type)
    return url
