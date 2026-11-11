"""可控知识检索路由服务 - 基于 LangChain LCEL RunnableBranch 取代慢速 ReAct 循环"""

from __future__ import annotations

import asyncio
import re
from typing import Any

import structlog
from langchain_core.runnables import RunnableBranch, RunnableLambda

from app.core.config import get_settings

logger = structlog.get_logger()

MAX_CONTEXT_LENGTH = 5000
SEARCH_TIMEOUT_SECONDS = 20

_URL_PATTERN = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)
_RECENCY_KEYWORDS = ("最新", "最近", "今日", "今年", "2025", "2026", "刚刚", "新发布", "changelog")


def extract_urls(text: str) -> list[str]:
    return _URL_PATTERN.findall(text or "")[:3]


def has_recency_signal(text: str) -> bool:
    lower = (text or "").lower()
    return any(kw in lower for kw in _RECENCY_KEYWORDS)


def _format_tavily_results(raw: Any) -> str:
    if raw is None:
        return ""
    if isinstance(raw, str):
        return raw.strip()
    if isinstance(raw, dict) and "results" in raw:
        items = raw.get("results") or []
    elif isinstance(raw, list):
        items = raw
    else:
        return str(raw)

    parts: list[str] = []
    for item in items[:6]:
        if isinstance(item, dict):
            title = str(item.get("title") or "").strip()
            url = str(item.get("url") or "").strip()
            content = str(item.get("raw_content") or item.get("content") or "").strip()
            if content:
                head = f"【{title}】({url})\n" if title else ""
                parts.append(f"{head}{content[:900]}")
        else:
            parts.append(str(item)[:800])
    return "\n\n".join(parts).strip()


async def _run_tavily_extract(urls: list[str], api_key: str) -> str:
    from langchain_tavily import TavilyExtract

    extractor = TavilyExtract(extract_depth="basic", tavily_api_key=api_key)
    raw = await asyncio.wait_for(
        extractor.ainvoke({"urls": urls}),
        timeout=SEARCH_TIMEOUT_SECONDS,
    )
    return _format_tavily_results(raw)


async def _run_tavily_search(query: str, api_key: str) -> str:
    from langchain_tavily import TavilySearch

    searcher = TavilySearch(
        max_results=5,
        include_raw_content=False,
        include_answer=False,
        tavily_api_key=api_key,
    )
    raw = await asyncio.wait_for(
        searcher.ainvoke({"query": query[:300]}),
        timeout=SEARCH_TIMEOUT_SECONDS,
    )
    return _format_tavily_results(raw)


def _build_lcel_search_router():
    """构建确定性 LCEL 意图分支：URL 抓取 / 显式或时效性联网 / 默认直出。"""

    async def _branch_url_extract(payload: dict) -> dict:
        urls = payload["urls"]
        api_key = payload["tavily_api_key"]
        try:
            text = await _run_tavily_extract(urls, api_key)
            return {
                "context": text[:MAX_CONTEXT_LENGTH],
                "source_type": "web_search" if text else "llm_direct",
            }
        except Exception as exc:
            logger.warning("lcel_tavily_extract_failed", error=str(exc))
            return {"context": "", "source_type": "llm_direct"}

    async def _branch_web_search(payload: dict) -> dict:
        query = payload["user_input"]
        api_key = payload["tavily_api_key"]
        try:
            text = await _run_tavily_search(query, api_key)
            return {
                "context": text[:MAX_CONTEXT_LENGTH],
                "source_type": "web_search" if text else "llm_direct",
            }
        except Exception as exc:
            logger.warning("lcel_tavily_search_failed", error=str(exc))
            return {"context": "", "source_type": "llm_direct"}

    async def _branch_direct(_payload: dict) -> dict:
        return {"context": "", "source_type": "llm_direct"}

    return RunnableBranch(
        (
            lambda x: bool(x.get("urls")) and bool(x.get("can_search")),
            RunnableLambda(_branch_url_extract),
        ),
        (
            lambda x: bool(x.get("can_search"))
            and (bool(x.get("enable_web_search")) or bool(x.get("has_recency"))),
            RunnableLambda(_branch_web_search),
        ),
        RunnableLambda(_branch_direct),
    )


async def resolve_knowledge_context(
    user_input: str,
    enable_web_search: bool = False,
) -> tuple[str, str]:
    """执行可控 LCEL 检索路由，返回 (context, source_type)。"""
    settings = get_settings()
    tavily_key = (getattr(settings, "tavily_api_key", "") or "").strip()
    global_enabled = bool(getattr(settings, "enable_web_search", False))
    can_search = global_enabled and bool(tavily_key)

    payload = {
        "user_input": user_input,
        "enable_web_search": enable_web_search,
        "urls": extract_urls(user_input),
        "has_recency": has_recency_signal(user_input),
        "can_search": can_search,
        "tavily_api_key": tavily_key,
    }

    if not can_search:
        if enable_web_search:
            logger.info("lcel_web_search_skipped_missing_key")
        return "", "llm_direct"

    router = _build_lcel_search_router()
    result = await router.ainvoke(payload)
    ctx = str(result.get("context") or "")[:MAX_CONTEXT_LENGTH]
    src = str(result.get("source_type") or "llm_direct")
    logger.info("lcel_search_routed", source_type=src, context_len=len(ctx))
    return ctx, src


async def fetch_knowledge_context(
    user_input: str,
    enable_web_search: bool = False,
) -> str:
    """兼容接口：返回纯参考资料文本（超时或失败降级为空字符串）。"""
    context, _ = await resolve_knowledge_context(user_input, enable_web_search=enable_web_search)
    return context
