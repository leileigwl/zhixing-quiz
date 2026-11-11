"""LLM 结构化输出 JSON 提取工具"""

from __future__ import annotations

import json
import re


def extract_json_object(text: str) -> dict:
    """从 LLM 输出中提取 JSON 对象，兼容 markdown 代码块包裹。"""
    match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    raw = match.group(1).strip() if match else text.strip()
    return json.loads(raw)
