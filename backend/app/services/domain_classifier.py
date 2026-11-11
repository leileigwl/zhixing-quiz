"""知识领域识别与颜色令牌分配（支持关键词秒分 + LLM 语义归并）"""

from __future__ import annotations

import json
from typing import Optional

import structlog

logger = structlog.get_logger()

DOMAIN_KEYWORD_RULES: list[tuple[str, str, tuple[str, ...]]] = [
    ("RAG 架构", "butter", ("rag", "bm25", "rrf", "chroma", "embedding", "检索", "向量", "重排")),
    ("计算机网络", "blue", ("http", "tcp", "udp", "quic", "dns", "tls", "网络", "socket")),
    ("大模型与 AI", "purple", ("transformer", "attention", "llm", "agent", "langchain", "langgraph", "大模型", "提示词")),
    ("后端分布式", "purple", ("redis", "mysql", "arq", "fastapi", "并发", "分布式", "锁", "事务", "docker")),
    ("数据结构与算法", "butter", ("算法", "动态规划", "二叉树", "图论", "排序", "复杂度", "链表")),
    ("核心英语", "sage", ("english", "vocab", "grammar", "英语", "词汇", "词根", "语法", "阅读理解")),
]

COLOR_ROTATION: tuple[str, ...] = ("blue", "butter", "purple", "sage")


def classify_domain_deterministic(
    text: str,
    existing_domains: Optional[list[str]] = None,
) -> tuple[str, str]:
    """基于关键词与已有域优先级在毫秒内完成分类，返回 (domain_name, color_token)。"""
    lower = (text or "").lower()

    if existing_domains:
        for existing in existing_domains:
            if existing and existing.lower() in lower:
                token = infer_color_token(existing)
                return existing, token

    for domain_name, color_token, keywords in DOMAIN_KEYWORD_RULES:
        if any(kw in lower for kw in keywords):
            return domain_name, color_token

    return "综合知识域", "blue"


def infer_color_token(domain_name: str, seed_idx: int = 0) -> str:
    lower = (domain_name or "").lower()
    for candidate, color_token, keywords in DOMAIN_KEYWORD_RULES:
        if candidate == domain_name or any(kw in lower for kw in keywords):
            return color_token
    return COLOR_ROTATION[seed_idx % len(COLOR_ROTATION)]


async def classify_domain_with_llm(
    text_snippet: str,
    existing_domains: Optional[list[str]] = None,
) -> tuple[str, str]:
    """先用规则快速命中，未命中且大模型可用时尝试语义归并到简洁 2~8 字领域名。"""
    name, color = classify_domain_deterministic(text_snippet, existing_domains)
    if name != "综合知识域":
        return name, color

    cleaned = (text_snippet or "").strip()
    if len(cleaned) < 6:
        return name, color

    try:
        from langchain_core.prompts import ChatPromptTemplate

        from app.core.config import get_settings, resolve_llm_config
        from app.llm.langchain_factory import get_chat_model

        settings = get_settings()
        api_key, _, _ = resolve_llm_config(settings)
        if not api_key:
            return name, color

        llm = get_chat_model(temperature=0.0)
        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    "你是知识库分类助手。请把用户内容归类到一个简短中文学科/技术领域名（2~6个汉字，如：计算机网络、操作系统、机器学习、微观经济学、core english）。"
                    "若已有领域列表中存在高度相似的领域，请优先直接复用原名。只输出 JSON：{\"domain\": \"领域名\"}。",
                ),
                (
                    "human",
                    "已有领域：{existing}\n内容摘要：{snippet}",
                ),
            ]
        )
        chain = prompt | llm
        res = await chain.ainvoke(
            {
                "existing": ", ".join(existing_domains or []) or "无",
                "snippet": cleaned[:500],
            }
        )
        raw = (res.content or "").strip()
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            parsed = json.loads(raw[start : end + 1])
            candidate = str(parsed.get("domain", "")).strip()[:20]
            if candidate:
                return candidate, infer_color_token(candidate, len(existing_domains or []))
    except Exception as exc:
        logger.debug("llm_domain_classify_fallback", error=str(exc))

    return name, color
