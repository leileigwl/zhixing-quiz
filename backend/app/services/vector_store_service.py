"""向量存储服务 - 基于 Chroma 的多用户隔离知识库向量检索"""

from __future__ import annotations

import threading
from functools import lru_cache
from typing import Optional

import structlog
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings

from app.core.config import get_settings, resolve_embedding_config

logger = structlog.get_logger()

CHUNK_WRITE_BATCH_SIZE = 32
_chroma_init_lock = threading.RLock()


@lru_cache
def get_embeddings() -> Embeddings:
    """获取 OpenAI 兼容模式的 Embedding 实例。

    check_embedding_ctx_length=False：禁用 langchain_openai 默认的 tiktoken 分词，
    避免百炼 / 硅基流动等服务端收到 token id 数组后报错。
    """
    from langchain_openai import OpenAIEmbeddings

    settings = get_settings()
    api_key, base_url, model = resolve_embedding_config(settings)
    return OpenAIEmbeddings(
        model=model,
        base_url=base_url,
        api_key=api_key,
        check_embedding_ctx_length=False,
    )


def get_user_vector_store(user_id: int, embeddings: Optional[Embeddings] = None):
    """获取指定用户的 Chroma 向量库实例（按用户 ID 独立集合隔离）。

    Chroma 的 SharedSystemClient / RustBindingsAPI 在并发首次初始化时非线程安全，
    通过可重入锁串行化实例化，避免 asyncio.to_thread 并发上传/检索触发竞态异常。
    """
    from langchain_chroma import Chroma

    settings = get_settings()
    with _chroma_init_lock:
        return Chroma(
            collection_name=f"kb_user_{user_id}",
            embedding_function=embeddings or get_embeddings(),
            persist_directory=settings.chroma_persist_dir,
        )


def add_document_chunks(
    user_id: int,
    doc_id: str,
    chunks: list[Document],
    embeddings: Optional[Embeddings] = None,
    batch_size: int = CHUNK_WRITE_BATCH_SIZE,
) -> int:
    """将文档分块按固定批次写入用户向量库，返回写入的分块数量。"""
    if not chunks:
        return 0

    vector_store = get_user_vector_store(user_id, embeddings=embeddings)

    for chunk in chunks:
        chunk.metadata = {
            **chunk.metadata,
            "doc_id": doc_id,
            "user_id": user_id,
        }

    step = max(1, batch_size)
    total_added = 0
    for idx in range(0, len(chunks), step):
        batch = chunks[idx : idx + step]
        ids = vector_store.add_documents(documents=batch)
        total_added += len(ids)

    logger.info(
        "document_chunks_added",
        user_id=user_id,
        doc_id=doc_id,
        chunk_count=total_added,
        batches=(len(chunks) + step - 1) // step,
    )
    return total_added


def delete_document_vectors(
    user_id: int,
    doc_id: str,
    embeddings: Optional[Embeddings] = None,
) -> None:
    """从用户向量库中删除指定文档的所有向量。"""
    vector_store = get_user_vector_store(user_id, embeddings=embeddings)
    vector_store.delete(where={"doc_id": doc_id})
    logger.info("document_vectors_deleted", user_id=user_id, doc_id=doc_id)


def similarity_search(
    user_id: int,
    doc_id: str,
    query: str,
    k: Optional[int] = None,
    embeddings: Optional[Embeddings] = None,
) -> list[Document]:
    """在用户向量库中检索指定文档的相关分块。"""
    settings = get_settings()
    k = k or settings.kb_retrieve_top_k

    vector_store = get_user_vector_store(user_id, embeddings=embeddings)
    return vector_store.similarity_search(query, k=k, filter={"doc_id": doc_id})
