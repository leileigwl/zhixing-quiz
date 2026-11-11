"""知行快刷（ZhiXing Quiz）后端配置与生产安全校验"""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings

DEFAULT_INSECURE_JWT_SECRETS = {
    "",
    "change-me-in-production",
    "dev-only-insecure-secret-change-in-production",
}
MIN_PRODUCTION_JWT_SECRET_LEN = 32


def _first_non_empty(*values: object, fallback: str = "") -> str:
    """从多个候选项中选取第一个真实非空字符串（兼容测试中的 MagicMock）。"""
    for val in values:
        if isinstance(val, str) and val.strip():
            return val.strip()
    return fallback


class Settings(BaseSettings):
    # 运行环境
    app_env: Literal["development", "test", "production"] = "development"
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    app_debug: bool = True
    log_level: str = "INFO"
    public_base_url: str = "http://localhost:8000"
    cors_origins: str = "*"

    # JWT 与鉴权
    jwt_secret: str = "dev-only-insecure-secret-change-in-production"
    jwt_expire_minutes: int = 43200  # 30 天
    allow_dev_login: bool = True

    # 通用对话大模型配置（优先读取 LLM_*，未填写时兼容 DEEPSEEK_*）
    llm_api_key: str = ""
    llm_base_url: str = ""
    llm_model: str = ""
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"

    # Tavily 联网搜索
    tavily_api_key: str = ""
    enable_web_search: bool = True

    # 文本向量化 Embedding（优先读取 EMBEDDING_*，未填写时兼容 DASHSCOPE_*）
    embedding_api_key: str = ""
    embedding_base_url: str = ""
    embedding_model: str = ""
    dashscope_api_key: str = ""
    dashscope_embedding_model: str = "text-embedding-v4"
    dashscope_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"

    # 知识库与 Chroma 向量存储
    chroma_persist_dir: str = "./data/chroma"
    kb_upload_dir: str = "./data/uploads"
    kb_max_documents_per_user: int = 10
    kb_max_file_size_mb: int = 10
    kb_chunk_size: int = 1000
    kb_chunk_overlap: int = 150
    kb_retrieve_top_k: int = 4

    # 限流与超时
    quiz_rate_limit_per_minute: int = 5
    quiz_task_timeout_seconds: int = 180

    # 题目配图（DashScope 千问文生图）
    dashscope_image_model: str = "qwen-image-2.0"
    dashscope_image_api_key: str = ""
    dashscope_image_base_url: str = ""
    image_gen_size: str = "512*512"
    image_gen_daily_limit: int = 20
    image_gen_max_concurrency: int = 5

    # 对象存储（腾讯云 COS + 可选本地静态目录回落）
    cos_secret_id: str = ""
    cos_secret_key: str = ""
    cos_region: str = ""
    cos_bucket: str = ""
    cos_upload_prefix: str = "quiz-images/"
    cos_domain: str = ""
    allow_local_image_fallback: bool = True
    local_image_dir: str = "./data/static/quiz-images"

    # 微信小程序
    wechat_app_id: str = ""
    wechat_app_secret: str = ""

    # MySQL 8.0
    mysql_host: str = "127.0.0.1"
    mysql_port: int = 3306
    mysql_user: str = "root"
    mysql_password: str = "zhixing_dev_pass"
    mysql_database: str = "zhixing_quiz"
    mysql_charset: str = "utf8mb4"
    mysql_pool_minsize: int = 1
    mysql_pool_maxsize: int = 10
    mysql_auto_init: bool = True

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    def get_cors_origins_list(self) -> list[str]:
        origins = [item.strip() for item in self.cors_origins.split(",") if item.strip()]
        return origins or ["*"]

    def validate_runtime_security(self) -> None:
        """生产环境启动前强校验关键安全配置，防止弱密钥上线裸奔。"""
        if self.app_env != "production":
            return

        secret = (self.jwt_secret or "").strip()
        if secret in DEFAULT_INSECURE_JWT_SECRETS or len(secret) < MIN_PRODUCTION_JWT_SECRET_LEN:
            raise RuntimeError(
                "生产环境禁止使用默认或过短的 JWT_SECRET，请设置至少 32 位随机密钥"
            )


def resolve_llm_config(settings: object) -> tuple[str, str, str]:
    """解析生效的对话大模型配置：(api_key, base_url, model)。"""
    api_key = _first_non_empty(
        getattr(settings, "llm_api_key", None),
        getattr(settings, "deepseek_api_key", None),
    )
    base_url = _first_non_empty(
        getattr(settings, "llm_base_url", None),
        getattr(settings, "deepseek_base_url", None),
        fallback="https://api.deepseek.com",
    )
    model = _first_non_empty(
        getattr(settings, "llm_model", None),
        getattr(settings, "deepseek_model", None),
        fallback="deepseek-chat",
    )
    return api_key, base_url, model


def resolve_embedding_config(settings: object) -> tuple[str, str, str]:
    """解析生效的向量模型配置：(api_key, base_url, model)。"""
    api_key = _first_non_empty(
        getattr(settings, "embedding_api_key", None),
        getattr(settings, "dashscope_api_key", None),
    )
    base_url = _first_non_empty(
        getattr(settings, "embedding_base_url", None),
        getattr(settings, "dashscope_base_url", None),
        fallback="https://dashscope.aliyuncs.com/compatible-mode/v1",
    )
    model = _first_non_empty(
        getattr(settings, "embedding_model", None),
        getattr(settings, "dashscope_embedding_model", None),
        fallback="text-embedding-v4",
    )
    return api_key, base_url, model


@lru_cache
def get_settings() -> Settings:
    return Settings()
