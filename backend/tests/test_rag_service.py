"""V2 rag_service 单元测试（LCEL RunnableBranch 直连 Chroma + 按需联网增强）"""

from unittest.mock import AsyncMock, patch

import pytest
from langchain_core.documents import Document

from app.services import rag_service


@pytest.mark.asyncio
async def test_retrieve_kb_chunks_joins_documents():
    docs = [Document(page_content="片段一：Hybrid RAG"), Document(page_content="片段二：BM25 + Dense")]
    with patch("app.services.rag_service.vector_store_service.similarity_search", return_value=docs):
        text = await rag_service._retrieve_kb_chunks(user_id=1, doc_id="doc_1", query="RAG")
        assert "片段一：Hybrid RAG" in text
        assert "片段二：BM25 + Dense" in text


@pytest.mark.asyncio
async def test_retrieve_kb_chunks_returns_empty_on_error():
    with patch(
        "app.services.rag_service.vector_store_service.similarity_search",
        side_effect=RuntimeError("chroma unavailable"),
    ):
        text = await rag_service._retrieve_kb_chunks(user_id=1, doc_id="doc_1", query="RAG")
        assert text == ""


@pytest.mark.asyncio
async def test_resolve_rag_context_kb_only_without_web():
    kb_docs = [Document(page_content="私有知识库详尽技术文档" * 30)]
    with (
        patch("app.services.rag_service.vector_store_service.similarity_search", return_value=kb_docs),
        patch("app.services.rag_service.search_service.resolve_knowledge_context", new_callable=AsyncMock) as mock_web,
    ):
        ctx, src = await rag_service.resolve_rag_context(
            user_input="Hybrid RAG",
            user_id=1,
            doc_id="doc_1",
            enable_web_search=False,
        )
        assert src == "kb_rag"
        assert "私有知识库摘录" in ctx
        mock_web.assert_not_awaited()


@pytest.mark.asyncio
async def test_resolve_rag_context_combines_kb_and_web_when_enabled():
    kb_docs = [Document(page_content="本地架构规范摘录")]
    with (
        patch("app.services.rag_service.vector_store_service.similarity_search", return_value=kb_docs),
        patch(
            "app.services.rag_service.search_service.resolve_knowledge_context",
            new_callable=AsyncMock,
            return_value=("最新官方文档补充", "web_search"),
        ) as mock_web,
    ):
        ctx, src = await rag_service.resolve_rag_context(
            user_input="Hybrid RAG",
            user_id=1,
            doc_id="doc_1",
            enable_web_search=True,
        )
        assert src == "web_search"
        assert "私有知识库摘录" in ctx
        assert "联网核验补充" in ctx
        mock_web.assert_awaited_once()


@pytest.mark.asyncio
async def test_resolve_rag_context_truncates_and_handles_empty():
    huge_docs = [Document(page_content="A" * 5000)]
    with patch("app.services.rag_service.vector_store_service.similarity_search", return_value=huge_docs):
        ctx = await rag_service.fetch_rag_context("RAG", user_id=1, doc_id="doc_1", enable_web_search=False)
        assert len(ctx) == rag_service.MAX_CONTEXT_LENGTH

    with patch("app.services.rag_service.vector_store_service.similarity_search", return_value=[]):
        ctx, src = await rag_service.resolve_rag_context("RAG", user_id=1, doc_id="doc_missing", enable_web_search=False)
        assert ctx == ""
        assert src == "llm_direct"
