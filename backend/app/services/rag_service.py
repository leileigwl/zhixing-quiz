"""知识库 RAG 检索服务 - 基于 LCEL RunnableBranch 直连 Chroma HTTP 与按需联网增强"""

from __future__ import annotations

import asyncio

import structlog
from langchain_core.runnables import RunnableBranch, RunnableLambda

from app.services import search_service, vector_store_service

logger = structlog.get_logger()

MAX_CONTEXT_LENGTH = 3500
MIN_KB_SUFFICIENT_CHARS = 280


def _format_kb_docs(docs: list) -> str:
    if not docs:
        return ""
    return "\n\n".join(doc.page_content for doc in docs if getattr(doc, "page_content", "")).strip()


async def _retrieve_kb_chunks(user_id: int, doc_id: str, query: str) -> str:
    try:
        docs = await asyncio.to_thread(
            vector_store_service.similarity_search,
            user_id=user_id,
            doc_id=doc_id,
            query=query,
        )
        return _format_kb_docs(docs)
    except Exception as exc:
        logger.warning("kb_retrieval_failed", user_id=user_id, doc_id=doc_id, error=str(exc))
        return ""


async def resolve_rag_context(
    user_input: str,
    user_id: int,
    doc_id: str,
    enable_web_search: bool = False,
) -> tuple[str, str]:
    """LCEL 确定性分支检索私有知识库（可选联网补充），返回 (context, source_type)。"""
    kb_text = await _retrieve_kb_chunks(user_id=user_id, doc_id=doc_id, query=user_input)

    async def _kb_only(payload: dict) -> dict:
        text = payload["kb_text"]
        if not text:
            return {"context": "", "source_type": "llm_direct"}
        return {
            "context": f"【私有知识库摘录】\n{text}"[:MAX_CONTEXT_LENGTH],
            "source_type": "kb_rag",
        }

    async def _kb_plus_web(payload: dict) -> dict:
        web_text, web_src = await search_service.resolve_knowledge_context(
            payload["user_input"],
            enable_web_search=True,
        )
        kb = payload["kb_text"]
        merged_parts = []
        if kb:
            merged_parts.append(f"【私有知识库摘录】\n{kb}")
        if web_text:
            merged_parts.append(f"【联网核验补充】\n{web_text}")
        merged = "\n\n".join(merged_parts)[:MAX_CONTEXT_LENGTH]
        src = "web_search" if web_src == "web_search" and web_text else ("kb_rag" if kb else "llm_direct")
        return {"context": merged, "source_type": src}

    branch = RunnableBranch(
        (
            lambda x: bool(x.get("enable_web_search"))
            or len(x.get("kb_text", "")) < MIN_KB_SUFFICIENT_CHARS
            and bool(x.get("allow_auto_web")),
            RunnableLambda(_kb_plus_web),
        ),
        RunnableLambda(_kb_only),
    )

    result = await branch.ainvoke(
        {
            "user_input": user_input,
            "kb_text": kb_text,
            "enable_web_search": enable_web_search,
            "allow_auto_web": enable_web_search,
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
