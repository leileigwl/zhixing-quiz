"""LangChain ChatOpenAI 工厂（兼容 DeepSeek / 硅基流动 / OpenAI 兼容端点）"""

from functools import lru_cache

from langchain_openai import ChatOpenAI

from app.core.config import get_settings, resolve_llm_config


_REASONING_MODEL_MARKERS = ("reasoner", "-r1", "qwq", "o1-", "o3-", "/o1", "/o3")


def _supports_json_object_mode(model_name: str, llm_json_mode: bool) -> bool:
    if not llm_json_mode:
        return False
    lowered = (model_name or "").strip().lower()
    return not any(marker in lowered for marker in _REASONING_MODEL_MARKERS)


@lru_cache()
def get_chat_model(temperature: float = 0.4) -> ChatOpenAI:
    settings = get_settings()
    api_key, base_url, model = resolve_llm_config(settings)
    kwargs: dict = {
        "model": model,
        "base_url": base_url,
        "api_key": api_key,
        "temperature": temperature,
        "max_tokens": getattr(settings, "llm_max_tokens", 4096),
        "request_timeout": 150.0,
        "max_retries": 0,
    }
    if _supports_json_object_mode(model, getattr(settings, "llm_json_mode", True)):
        kwargs["model_kwargs"] = {"response_format": {"type": "json_object"}}
    return ChatOpenAI(**kwargs)
