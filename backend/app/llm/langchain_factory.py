"""LangChain ChatOpenAI 工厂（兼容 DeepSeek / 硅基流动 / OpenAI 兼容端点）"""

from functools import lru_cache

from langchain_openai import ChatOpenAI

from app.core.config import get_settings, resolve_llm_config


@lru_cache()
def get_chat_model(temperature: float = 0.4) -> ChatOpenAI:
    settings = get_settings()
    api_key, base_url, model = resolve_llm_config(settings)
    return ChatOpenAI(
        model=model,
        base_url=base_url,
        api_key=api_key,
        temperature=temperature,
        max_tokens=4096,
    )
