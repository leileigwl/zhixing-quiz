"""知识库文档业务服务：上传、异步解析、状态查询、级联删除"""

from __future__ import annotations

import asyncio
import os
import uuid

import structlog

from app.core.config import get_settings
from app.core.exceptions import KnowledgeBaseError
from app.core.redis_client import get_arq_pool
from app.models.knowledge import (
    KnowledgeDocumentItem,
    KnowledgeListResponse,
    KnowledgeStatusResponse,
    KnowledgeUploadResponse,
)
from app.repositories import knowledge_repository, mastery_repository
from app.services import (
    document_loader_service,
    domain_classifier,
    mastery_service,
    vector_store_service,
)

logger = structlog.get_logger()

SUPPORTED_EXTENSIONS = {"pdf", "docx", "md", "txt"}

_background_kb_tasks: set[asyncio.Task] = set()


def _write_upload_file_sync(upload_dir: str, file_path: str, content: bytes) -> None:
    os.makedirs(upload_dir, exist_ok=True)
    with open(file_path, "wb") as f:
        f.write(content)


def _remove_upload_file_sync(file_path: str) -> None:
    if os.path.exists(file_path):
        os.remove(file_path)


def _sanitize_display_filename(filename: str) -> str:
    """剥离路径前缀与控制字符，避免伪造文件名注入日志或界面。"""
    base = os.path.basename((filename or "").strip())
    cleaned = "".join(ch for ch in base if ord(ch) >= 32 and ch not in ("\x7f", "<", ">"))
    return (cleaned or "document.txt")[:180]


def _get_extension(filename: str) -> str:
    _, ext = os.path.splitext(_sanitize_display_filename(filename))
    return ext.lstrip(".").lower()


async def handle_upload(user_id: int, filename: str, content: bytes) -> KnowledgeUploadResponse:
    """校验并保存上传的文档，后台异步解析处理。"""
    settings = get_settings()

    safe_filename = _sanitize_display_filename(filename)
    file_type = _get_extension(safe_filename)
    if file_type not in SUPPORTED_EXTENSIONS:
        raise KnowledgeBaseError(
            f"不支持的文件格式：{file_type or '未知'}，仅支持 PDF/Word/Markdown/文本文件"
        )

    if len(content) == 0:
        raise KnowledgeBaseError("上传文件不能为空")

    max_size_bytes = settings.kb_max_file_size_mb * 1024 * 1024
    if len(content) > max_size_bytes:
        raise KnowledgeBaseError(f"文件大小超过限制（最大 {settings.kb_max_file_size_mb}MB）")

    existing_count = await knowledge_repository.count_documents(user_id)
    if existing_count >= settings.kb_max_documents_per_user:
        raise KnowledgeBaseError(
            f"知识库文档数量已达上限（最多 {settings.kb_max_documents_per_user} 篇），请先删除部分文档"
        )

    doc_id = f"doc_{uuid.uuid4().hex[:12]}"

    file_path = os.path.join(settings.kb_upload_dir, f"{doc_id}.{file_type}")
    await asyncio.to_thread(_write_upload_file_sync, settings.kb_upload_dir, file_path, content)

    await knowledge_repository.create_document(
        doc_id=doc_id,
        user_id=user_id,
        file_name=safe_filename,
        file_type=file_type,
        file_size=len(content),
    )

    arq_pool = get_arq_pool()
    if settings.enable_arq_queue and arq_pool is not None:
        await arq_pool.enqueue_job(
            "job_ingest_document",
            doc_id,
            user_id,
            file_path,
            file_type,
            safe_filename,
            _job_id=f"kb:{doc_id}",
        )
    else:
        task = asyncio.create_task(_process_document(doc_id, user_id, file_path, file_type, safe_filename))
        _background_kb_tasks.add(task)
        task.add_done_callback(_background_kb_tasks.discard)

    return KnowledgeUploadResponse(doc_id=doc_id, file_name=safe_filename, status="processing")


async def run_ingest_document_job(
    doc_id: str,
    user_id: int,
    file_path: str,
    file_type: str,
    filename: str | None = None,
) -> None:
    """后台异步解析文档：分块 -> Chroma HTTP 向量化 -> 领域归类 -> 更新状态与缓存。"""
    try:
        logger.info("kb_document_processing_started", doc_id=doc_id, user_id=user_id)

        chunks = await asyncio.to_thread(
            document_loader_service.load_and_split, file_path, file_type
        )
        if not chunks:
            raise ValueError("文档解析后未提取到任何内容")

        chunk_count = await asyncio.to_thread(
            vector_store_service.add_document_chunks, user_id, doc_id, chunks
        )

        # AI + 关键词混合归类所属知识域，并失效用户掌握画像缓存
        snippet_parts = [filename or ""] + [
            getattr(c, "page_content", "")[:260] for c in chunks[:3]
        ]
        snippet = "\n".join(part for part in snippet_parts if part).strip()
        try:
            existing_domains = [
                d["name"] for d in await mastery_repository.list_user_domains(user_id)
            ]
            domain_name, color_token = await domain_classifier.classify_domain_with_llm(
                snippet, existing_domains
            )
            domain = await mastery_repository.get_or_create_domain(
                user_id=user_id,
                name=domain_name,
                color_token=color_token,
            )
            await knowledge_repository.update_document_domain(
                doc_id,
                domain["domain_id"],
                domain["name"],
            )
            await mastery_service.invalidate_mastery_cache(user_id)
        except Exception as dom_exc:
            logger.warning(
                "kb_document_domain_classify_failed",
                doc_id=doc_id,
                error=str(dom_exc),
            )

        await knowledge_repository.update_document_status(
            doc_id, "ready", chunk_count=chunk_count
        )
        logger.info(
            "kb_document_processing_completed",
            doc_id=doc_id,
            user_id=user_id,
            chunk_count=chunk_count,
        )
    except Exception as e:
        logger.error("kb_document_processing_failed", doc_id=doc_id, user_id=user_id, error=str(e))
        await knowledge_repository.update_document_status(
            doc_id, "failed", error_message=str(e)[:500]
        )


async def _process_document(
    doc_id: str,
    user_id: int,
    file_path: str,
    file_type: str,
    filename: str | None = None,
) -> None:
    """进程内 asyncio 降级执行器（兼容未启用 ARQ 的本地或单元测试环境）。"""
    await run_ingest_document_job(doc_id, user_id, file_path, file_type, filename)


async def list_documents(user_id: int) -> KnowledgeListResponse:
    rows = await knowledge_repository.list_documents(user_id)
    items = [KnowledgeDocumentItem.model_validate(row) for row in rows]
    return KnowledgeListResponse(items=items)


async def get_document_status(user_id: int, doc_id: str) -> KnowledgeStatusResponse:
    row = await knowledge_repository.get_document(doc_id, user_id)
    if row is None:
        raise KnowledgeBaseError("文档不存在")
    return KnowledgeStatusResponse(
        doc_id=row["doc_id"],
        file_name=row["file_name"],
        status=row["status"],
        chunk_count=row["chunk_count"],
        domain_id=row.get("domain_id"),
        domain_name=row.get("domain_name"),
        error_message=row.get("error_message"),
    )


async def delete_document(user_id: int, doc_id: str) -> None:
    """删除文档：级联清理向量、本地文件、数据库记录，任一步失败仅记录日志。"""
    row = await knowledge_repository.get_document(doc_id, user_id)
    if row is None:
        raise KnowledgeBaseError("文档不存在")

    settings = get_settings()

    try:
        await asyncio.to_thread(vector_store_service.delete_document_vectors, user_id, doc_id)
    except Exception as e:
        logger.warning("kb_document_vector_delete_failed", doc_id=doc_id, error=str(e))

    try:
        file_path = os.path.join(settings.kb_upload_dir, f"{doc_id}.{row['file_type']}")
        await asyncio.to_thread(_remove_upload_file_sync, file_path)
    except Exception as e:
        logger.warning("kb_document_file_delete_failed", doc_id=doc_id, error=str(e))

    try:
        await knowledge_repository.delete_document(doc_id, user_id)
    except Exception as e:
        logger.warning("kb_document_db_delete_failed", doc_id=doc_id, error=str(e))

    await mastery_service.invalidate_mastery_cache(user_id)
