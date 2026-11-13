"""LLM 结构化输出 JSON 提取工具"""

from __future__ import annotations

import json
import re


def extract_json_object(text: str) -> dict:
    """从 LLM 输出中提取 JSON 对象，兼容 <think> 思考块、markdown 代码块与前后说明文字。"""
    cleaned = re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE).strip()
    match = re.search(r"```(?:json)?\s*([\s\S]*?)```", cleaned)
    raw = match.group(1).strip() if match else cleaned
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end > start:
            return json.loads(raw[start : end + 1])
        raise
