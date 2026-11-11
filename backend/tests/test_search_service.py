"""V2 search_service 单元测试（LCEL RunnableBranch 可控路由，取代 ReAct 循环）"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import search_service


@pytest.fixture
def mock_settings_enabled():
    settings = MagicMock()
    settings.enable_web_search = True
    settings.tavily_api_key = "tvly-test-key"
    return settings


@pytest.fixture
def mock_settings_disabled():
    settings = MagicMock()
    settings.enable_web_search = False
    settings.tavily_api_key = "tvly-test-key"
    return settings


@pytest.fixture
def mock_settings_no_key():
    settings = MagicMock()
    settings.enable_web_search = True
    settings.tavily_api_key = ""
    return settings


@pytest.mark.asyncio
async def test_fetch_returns_empty_when_disabled(mock_settings_disabled):
    with patch("app.services.search_service.get_settings", return_value=mock_settings_disabled):
        ctx, src = await search_service.resolve_knowledge_context("Redis 分布式锁", enable_web_search=True)
        assert ctx == ""
        assert src == "llm_direct"


@pytest.mark.asyncio
async def test_fetch_returns_empty_when_no_api_key(mock_settings_no_key):
    with patch("app.services.search_service.get_settings", return_value=mock_settings_no_key):
        ctx, src = await search_service.resolve_knowledge_context("Redis 分布式锁", enable_web_search=True)
        assert ctx == ""
        assert src == "llm_direct"


@pytest.mark.asyncio
async def test_direct_branch_skips_search_without_toggle_or_recency(mock_settings_enabled):
    """未开启联网且无 URL / 时效词时，直接走 llm_direct，绝不浪费搜索额度。"""
    with (
        patch("app.services.search_service.get_settings", return_value=mock_settings_enabled),
        patch("app.services.search_service._run_tavily_search", new_callable=AsyncMock) as mock_search,
    ):
        ctx, src = await search_service.resolve_knowledge_context("Python 装饰器原理", enable_web_search=False)
        assert ctx == ""
        assert src == "llm_direct"
        mock_search.assert_not_called()


@pytest.mark.asyncio
async def test_explicit_web_search_calls_tavily_and_truncates(mock_settings_enabled):
    long_text = "x" * (search_service.MAX_CONTEXT_LENGTH + 1000)
    with (
        patch("app.services.search_service.get_settings", return_value=mock_settings_enabled),
        patch("app.services.search_service._run_tavily_search", new_callable=AsyncMock, return_value=long_text) as mock_search,
    ):
        ctx, src = await search_service.resolve_knowledge_context("LangChain LCEL", enable_web_search=True)
        assert src == "web_search"
        assert len(ctx) == search_service.MAX_CONTEXT_LENGTH
        mock_search.assert_awaited_once()


@pytest.mark.asyncio
async def test_url_input_routes_to_tavily_extract(mock_settings_enabled):
    with (
        patch("app.services.search_service.get_settings", return_value=mock_settings_enabled),
        patch("app.services.search_service._run_tavily_extract", new_callable=AsyncMock, return_value="官方更新日志") as mock_extract,
        patch("app.services.search_service._run_tavily_search", new_callable=AsyncMock) as mock_search,
    ):
        ctx, src = await search_service.resolve_knowledge_context(
            "帮我基于 https://docs.python.org/3/ 出题",
            enable_web_search=False,
        )
        assert src == "web_search"
        assert "官方更新日志" in ctx
        mock_extract.assert_awaited_once()
        mock_search.assert_not_called()


@pytest.mark.asyncio
async def test_recency_keyword_triggers_search_even_without_toggle(mock_settings_enabled):
    with (
        patch("app.services.search_service.get_settings", return_value=mock_settings_enabled),
        patch("app.services.search_service._run_tavily_search", new_callable=AsyncMock, return_value="2026 新特性") as mock_search,
    ):
        ctx, src = await search_service.resolve_knowledge_context("2026 最新 FastAPI 特性", enable_web_search=False)
        assert src == "web_search"
        assert "2026 新特性" in ctx
        mock_search.assert_awaited_once()


@pytest.mark.asyncio
async def test_timeout_or_error_gracefully_degrades(mock_settings_enabled):
    with (
        patch("app.services.search_service.get_settings", return_value=mock_settings_enabled),
        patch("app.services.search_service._run_tavily_search", side_effect=asyncio.TimeoutError()),
    ):
        result = await search_service.fetch_knowledge_context("Redis", enable_web_search=True)
        assert result == ""

    with (
        patch("app.services.search_service.get_settings", return_value=mock_settings_enabled),
        patch("app.services.search_service._run_tavily_search", side_effect=RuntimeError("network error")),
    ):
        ctx, src = await search_service.resolve_knowledge_context("Redis", enable_web_search=True)
        assert ctx == ""
        assert src == "llm_direct"
