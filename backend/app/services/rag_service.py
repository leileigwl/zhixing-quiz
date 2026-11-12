"""知识库 RAG 检索服务 - 基于 LCEL RunnableBranch 直连 Chroma HTTP 与并行联网三源融合"""

from __future__ import annotations

import asyncio
from typing import Optional

import structlog
from langchain_core.runnables import RunnableBranch, RunnableLambda

from app.services import search_service, vector_store_service

logger = structlog.get_logger()

MAX_CONTEXT_LENGTH = 4200
MIN_KB_SUFFICIENT_CHARS = 280


def _format_kb_docs(docs: list) -> str:
    if not docs:
        return ""
    return "\n\n".join(doc.page_content for doc in docs if getattr(doc, "page_content", "")).strip()


async def _retrieve_kb_chunks(
    user_id: int,
    doc_id: Optional[str],
    query: str,
    doc_ids: Optional[list[str]] = None,
) -> str:
    try:
        kwargs = {
            "user_id": user_id,
            "query": query,
        }
        if doc_ids and len(doc_ids) > 1:
            kwargs["doc_ids"] = doc_ids
            kwargs["doc_id"] = doc_id or doc_ids[0]
        else:
            kwargs["doc_id"] = doc_id or (doc_ids[0] if doc_ids else "")

        docs = await asyncio.to_thread(
            vector_store_service.similarity_search,
            **kwargs,
        )
        return _format_kb_docs(docs)
    except Exception as exc:
        logger.warning(
            "kb_retrieval_failed",
            user_id=user_id,
            doc_id=doc_id,
            doc_ids=doc_ids,
            error=str(exc),
        )
        return ""


async def resolve_rag_context(
    user_input: str,
    user_id: int,
    doc_id: Optional[str] = None,
    enable_web_search: bool = False,
    doc_ids: Optional[list[str]] = None,
) -> tuple[str, str]:
    """LCEL 确定性分支并行融合「用户文本 + 私有知识库（单/多篇）+ 联网核验」，返回 (context, source_type)。"""
    clean_ids = [d for d in (doc_ids or []) if d]
    if doc_id and doc_id not in clean_ids:
        clean_ids.insert(0, doc_id)
    primary_doc_id = clean_ids[0] if clean_ids else None

    if enable_web_search:
        # 并行执行 Chroma HTTP 向量检索与 Tavily 联网检索，大幅削减等待延迟
        kb_task = _retrieve_kb_chunks(
            user_id=user_id,
            doc_id=primary_doc_id,
            query=user_input[:400],
            doc_ids=clean_ids,
        )
        web_task = search_service.resolve_knowledge_context(
            user_input[:500],
            enable_web_search=True,
        )
        kb_text, (web_text, web_src) = await asyncio.gather(kb_task, web_task)
    else:
        kb_text = await _retrieve_kb_chunks(
            user_id=user_id,
            doc_id=primary_doc_id,
            query=user_input[:400],
            doc_ids=clean_ids,
        )
        web_text, web_src = "", "llm_direct"

    async def _kb_only(payload: dict) -> dict:
        text = payload["kb_text"]
        if not text:
            return {"context": "", "source_type": "llm_direct"}
        return {
            "context": f"【私有知识库摘录】\n{text}"[:MAX_CONTEXT_LENGTH],
            "source_type": "kb_rag",
        }

    async def _kb_plus_web(payload: dict) -> dict:
        w_text = payload["web_text"]
        w_src = payload["web_src"]
        if not w_text and payload.get("retry_web_if_short"):
            w_text, w_src = await search_service.resolve_knowledge_context(
                payload["user_input"][:500],
                enable_web_search=True,
            )
        kb = payload["kb_text"]
        merged_parts = []
        if kb:
            merged_parts.append(f"【私有知识库摘录】\n{kb}")
        if w_text:
            merged_parts.append(f"【联网核验补充】\n{w_text}")
        merged = "\n\n".join(merged_parts)[:MAX_CONTEXT_LENGTH]
        src = "web_search" if w_src == "web_search" and w_text else ("kb_rag" if kb else "llm_direct")
        return {"context": merged, "source_type": src}

    branch = RunnableBranch(
        (
            lambda x: bool(x.get("enable_web_search"))
            or (len(x.get("kb_text", "")) < MIN_KB_SUFFICIENT_CHARS and bool(x.get("allow_auto_web"))),
            RunnableLambda(_kb_plus_web),
        ),
        RunnableLambda(_kb_only),
    )

    result = await branch.ainvoke(
        {
            "user_input": user_input,
            "kb_text": kb_text,
            "web_text": web_text,
            "web_src": web_src,
            "enable_web_search": enable_web_search,
            "allow_auto_web": enable_web_search,
            "retry_web_if_short": False,
        }
    )
    return str(result.get("context") or ""), str(result.get("source_type") or "kb_rag")


async def fetch_rag_context(
    user_input: str,
    user_id: int,
    doc_id: str,
    enable_web_search: bool = False,
) -> str:
    """兼容接口：返回整合后的知识库参考资料摘要。"""
    ctx, _ = await resolve_rag_context(
        user_input=user_input,
        user_id=user_id,
        doc_id=doc_id,
        enable_web_search=enable_web_search,
    )
    return ctx
