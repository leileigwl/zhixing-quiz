"""腾讯云 COS 对象存储服务（含本地静态目录回落模式）"""

from __future__ import annotations

import asyncio
import os
from functools import lru_cache

import structlog
from qcloud_cos import CosConfig, CosS3Client

from app.core.config import get_settings

logger = structlog.get_logger()


@lru_cache
def _get_cos_client() -> CosS3Client:
    settings = get_settings()
    config = CosConfig(
        Region=settings.cos_region,
        SecretId=settings.cos_secret_id,
        SecretKey=settings.cos_secret_key,
        Scheme="https",
    )
    return CosS3Client(config)


def _build_public_url(key: str) -> str:
    settings = get_settings()
    if settings.cos_domain:
        return f"https://{settings.cos_domain}/{key}"
    return f"https://{settings.cos_bucket}.cos.{settings.cos_region}.myqcloud.com/{key}"


def _put_object_sync(data: bytes, key: str, content_type: str) -> None:
    settings = get_settings()
    client = _get_cos_client()
    client.put_object(
        Bucket=settings.cos_bucket,
        Body=data,
        Key=key,
        ContentType=content_type,
    )


def _save_local_static_sync(data: bytes, key: str, local_dir: str) -> str:
    """将图片落盘到本地静态托管目录，防止路径穿越。"""
    clean_name = os.path.basename(key.strip("/")) or "image.png"
    parent_parts = [
        p for p in os.path.dirname(key.strip("/")).split("/") if p and p not in (".", "..")
    ]
    # 若 key 自带 cos_upload_prefix 开头（如 quiz-images/quiz_1），直接映射到静态目录子路径
    if parent_parts and parent_parts[0] == "quiz-images":
        parent_parts = parent_parts[1:]

    target_dir = os.path.join(local_dir, *parent_parts) if parent_parts else local_dir
    os.makedirs(target_dir, exist_ok=True)
    target_path = os.path.join(target_dir, clean_name)

    with open(target_path, "wb") as f:
        f.write(data)

    rel_path = "/".join([*parent_parts, clean_name]) if parent_parts else clean_name
    return rel_path


async def upload_image_bytes(data: bytes, key: str, content_type: str = "image/png") -> str:
    """上传图片字节流；配置了 COS 时上传腾讯云 COS，否则在开启静态回落时写入本地静态目录。"""
    settings = get_settings()
    has_cos = bool(
        settings.cos_secret_id
        and settings.cos_secret_key
        and settings.cos_bucket
        and settings.cos_region
    )

    if has_cos:
        await asyncio.to_thread(_put_object_sync, data, key, content_type)
        url = _build_public_url(key)
        logger.info("cos_upload_success", key=key)
        return url

    if getattr(settings, "allow_local_image_fallback", False) is True:
        local_dir = getattr(settings, "local_image_dir", "./data/static/quiz-images")
        public_base = (getattr(settings, "public_base_url", "http://localhost:8000") or "").rstrip(
            "/"
        )
        rel_path = await asyncio.to_thread(_save_local_static_sync, data, key, local_dir)
        url = f"{public_base}/static/quiz-images/{rel_path}"
        logger.info("local_image_fallback_saved", key=key, url=url)
        return url

    raise RuntimeError("COS 未配置，无法上传图片")
