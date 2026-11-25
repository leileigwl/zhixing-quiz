# syntax=docker/dockerfile:1
# 知行快刷（ZhiXing Quiz）后端 Docker 镜像（单 Worker 异步模式，配合 Docker Compose / 1Panel 部署）

FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app

# 可选：国内服务器构建时传入 PyPI 镜像（阿里云 ECS 内网推荐 http://mirrors.cloud.aliyuncs.com/pypi/simple/）。
# 留空则保持原行为（直连 PyPI、按 uv.lock 安装）；设置后仍按 uv.lock 导出的精确版本 + 哈希校验安装，
# 因此即使镜像走 http，包内容也由 uv.lock 中的 sha256 保证完整性。
ARG PYPI_MIRROR=

RUN if [ -n "$PYPI_MIRROR" ]; then \
        MIRROR_HOST=$(echo "$PYPI_MIRROR" | sed -E 's#^[a-z]+://([^/:]+).*#\1#'); \
        pip install --no-cache-dir -i "$PYPI_MIRROR" --trusted-host "$MIRROR_HOST" uv; \
    else \
        pip install --no-cache-dir uv; \
    fi

COPY pyproject.toml uv.lock* ./
RUN if [ -n "$PYPI_MIRROR" ]; then \
        uv venv /app/.venv \
        && uv export --frozen --no-dev --no-emit-project -o /tmp/requirements.txt \
        && VIRTUAL_ENV=/app/.venv uv pip install --require-hashes --index-url "$PYPI_MIRROR" \
           --allow-insecure-host "$(echo "$PYPI_MIRROR" | sed -E 's#^[a-z]+://([^/:]+).*#\1#')" -r /tmp/requirements.txt; \
    else \
        uv sync --frozen --no-dev --no-install-project || uv sync --no-dev --no-install-project; \
    fi

FROM python:3.12-slim

ENV TZ=Asia/Shanghai \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH" \
    APP_PORT=8000

# 可选：Debian 镜像主机（阿里云 ECS 内网推荐 mirrors.cloud.aliyuncs.com），留空保持默认 deb.debian.org
ARG DEBIAN_MIRROR=

RUN if [ -n "$DEBIAN_MIRROR" ]; then sed -i "s#deb.debian.org#${DEBIAN_MIRROR}#g" /etc/apt/sources.list.d/debian.sources; fi \
    && apt-get update \
    && apt-get install -y --no-install-recommends tzdata ca-certificates \
    && ln -snf /usr/share/zoneinfo/${TZ} /etc/localtime && echo ${TZ} > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/.venv /app/.venv
COPY . .

RUN mkdir -p /app/data/chroma /app/data/uploads /app/data/static/quiz-images

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('APP_PORT', '8000') + '/api/v1/health', timeout=3)" || exit 1

# V2 架构：Chroma 独立 HTTP 服务 + Redis 分布式限流与 ARQ 队列，支持多 Worker 水平扩展
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${APP_PORT:-8000} --workers ${UVICORN_WORKERS:-2}"]
