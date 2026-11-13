# 知行快刷（ZhiXing Quiz）项目交接与生产检查清单

> 本文档面向后续接手的开发工具 / AI 助手 / 工程师，涵盖项目架构、本地运行、测试验证、大模型热切换指南、生产上线风险清单以及近期修复基线。

---

## 1. 技术栈与目录索引

### 1.1 前端（`frontend/`）
- **框架**：Taro 4.1.11 + React 18 + TypeScript + Sass（同时支持 H5 与微信小程序 `weapp`）
- **核心页面**：
  - `src/pages/index/index.tsx`：首页（冷启动引导、今日待巩固 / 重点攻坚双砖块、出题工作台、资料/设置半屏弹窗、后台出题状态同步）
  - `src/pages/knowledge/index.tsx`：知识口袋（文档上传/管理、领域过滤、检索、一键组卷）
  - `src/pages/mastery/index.tsx`：记忆曲线（SM-2 遗忘曲线、知识域掌握度分布、待巩固队列、秒开复习）
  - `src/pages/profile/index.tsx`：学习档案（微信头像/昵称编辑、本周学习印章日历下钻、错题巩固本手风琴展开/AI 变式/掌握毕业、历史练习档案折叠与续答）
  - `src/pages/quiz/index.tsx`：沉浸答题页（支持首次作答、历史未交卷续答、错题巩固模式、已交卷只读回顾、顶部轻反馈条与避坑解析卡）
  - `src/pages/report/index.tsx`：成绩结算报告页（准确率、错题入队、AI 诊断总结）
- **导航与后台状态**：
  - `src/custom-tab-bar/index.tsx` & `index.scss`：微信小程序原生自定义底部悬浮胶囊导航（纯 CSS 几何矢量图标，无 Emoji）
  - `src/components/FloatingDock/index.tsx`：H5 端底部悬浮胶囊导航
  - `src/services/backgroundQuizManager.ts` + `src/components/BackgroundTaskPill/`：跨页面后台出题调度、轮询与悬浮胶囊通知

### 1.2 后端（`backend/`）
- **框架**：FastAPI + Pydantic v2 + LangChain (`langchain-openai`) + aiomysql (MySQL 8.0) + Redis 7 + ARQ Worker + ChromaDB
- **关键模块**：
  - `app/core/config.py`：全局配置、生产安全校验（`validate_runtime_security`）、通用模型解析（`resolve_llm_config` / `resolve_embedding_config`）
  - `app/llm/langchain_factory.py`：`get_chat_model()` 工厂（兼容 OpenAI 协议端点与推理模型）
  - `app/llm/json_utils.py`：`extract_json_object()`（兼容 `<think>` 标签、Markdown 代码块与前后说明文本）
  - `app/workers/arq_worker.py`：ARQ 异步出题队列 Worker（支持 chunk 空闲超时监控与降级）
  - `app/services/`：出题（`quiz_service.py`）、自适应难度（`adaptive_service.py`）、SM-2 复习（`review_service.py`）、RAG 检索（`rag_service.py` / `vector_store_service.py`）、联网搜索（`search_service.py`）、配图（`image_service.py` / `cos_service.py`）

---

## 2. 本地开发与验证命令

### 2.1 基础设施（Docker Compose）
```bash
# 启动 MySQL 8.0 + Redis 7（或全栈容器化启动）
docker compose up -d mysql redis
```

### 2.2 后端服务与单测
```bash
cd backend

# 1. 启动 Chroma HTTP 服务（端口 8001）
uv run chroma run --host 127.0.0.1 --port 8001 --path ./data/chroma

# 2. 启动 ARQ 异步出题 Worker
uv run arq app.workers.arq_worker.WorkerSettings

# 3. 启动 FastAPI（端口 8000）
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2

# 4. 运行后端全量单元测试（当前 193 passed）
uv run pytest -q
```

### 2.3 前端构建与校验
```bash
cd frontend

# TypeScript 类型检查
pnpm typecheck

# H5 本地开发调试（http://127.0.0.1:10086）
pnpm dev:h5

# 微信小程序本地构建（输出至 frontend/dist/，用微信开发者工具导入）
pnpm build:weapp:local

# 微信小程序生产构建（必须注入 HTTPS API 基址！）
TARO_APP_API_BASE_URL="https://your-api.example.com" pnpm build:weapp
```

---

## 3. 后续切换大模型（DeepSeek → 其他模型）指南

项目后端已解耦底层大模型，只需修改 `backend/.env` 并重启 FastAPI 与 ARQ Worker 即可无缝切换任何 **OpenAI 兼容接口**（如 DeepSeek-V3/R1、通义千问 Qwen、智谱 GLM、豆包、硅基流动、OpenAI、OneAPI/NewAPI 代理等）：

```env
# 优先读取 LLM_*，未配置时回落到 DEEPSEEK_*
LLM_API_KEY=sk-your-new-key
LLM_BASE_URL=https://api.siliconflow.cn/v1
LLM_MODEL=Qwen/Qwen2.5-72B-Instruct

# 可选兼容开关（针对推理模型 / 不支持 json_object 的端点）：
# 若切到 DeepSeek-R1 / QwQ / o1 / o3 或报 response_format 400 错误时，可设为 false
LLM_JSON_MODE=true
LLM_MAX_TOKENS=4096
```

**已内置的模型切换保护机制**：
1. `app/llm/langchain_factory.py` 会自动识别模型名称中的 `reasoner` / `-r1` / `qwq` / `o1-` / `o3-` 标记（或 `LLM_JSON_MODE=false`），自动省略 `response_format={"type": "json_object"}`，避免部分模型或中转端返回 `400 Bad Request`。
2. `app/llm/json_utils.py` 会自动剥离 `<think>...</think>` 推理过程标签，并在代码块或带说明文字的响应中提取最外层 JSON。
3. **注意事项**：
   - 若切换到推理模型（如 R1 / QwQ），思考过程会消耗大量 Token，建议将 `LLM_MAX_TOKENS` 调大至 `8192`，并适当放宽 `QUIZ_TASK_TIMEOUT_SECONDS=240`。
   - 向量模型（Embedding）支持通过 `EMBEDDING_API_KEY` / `EMBEDDING_BASE_URL` / `EMBEDDING_MODEL` 独立配置；**注意切换 Embedding 模型后，Chroma 中旧向量维度若不一致需重建知识库索引**。

---

## 4. 生产环境上线前必查问题清单（Production Audit）

以下为当前代码审计中最明显、上线生产前必须处理的要点：

1. **生产构建缺少 `TARO_APP_API_BASE_URL` 环境变量保护**
   - `frontend/config/prod.ts` 读取 `process.env.TARO_APP_API_BASE_URL`，若直接执行 `pnpm build:weapp` 未传该变量，`API_BASE_URL` 会为空字符串，导致小程序请求全部失败。
   - 发布前务必确认传入正式 `https://` 域名，并在微信小程序后台配置 `request`、`uploadFile`、`downloadFile` 合法域名。

2. **安全配置强制切换（`backend/.env`）**
   - 生产环境必须设置 `APP_ENV=production`、`APP_DEBUG=false`、`ALLOW_DEV_LOGIN=false`。
   - `JWT_SECRET` 必须为至少 32 位高强度随机字符串（`Settings.validate_runtime_security()` 会在 `production` 模式下强制校验并拒绝默认弱密钥启动）。
   - `CORS_ORIGINS` 建议收窄为实际 H5 域名白名单，避免 `*`。

3. **图片与文件存储（本地回落 → 腾讯云 COS）**
   - 当前开发模式开启了 `ALLOW_LOCAL_IMAGE_FALLBACK=true`，配图与上传文件落在 `./data/`。
   - 若生产采用多容器/多实例部署，本地磁盘不共享且容器重启易丢失（除非挂载共享持久化卷），建议生产配置完整 `COS_*` 参数并关闭本地回落。

4. **Chroma 并发与多 Worker 写入**
   - 生产环境若启用了多 Uvicorn Worker 或独立 ARQ Worker，**务必通过 `CHROMA_HOST` + `CHROMA_PORT` 连接独立 Chroma HTTP 服务**，不要多进程同时读写本地嵌入式 SQLite Chroma 目录。

5. **微信登录与订阅消息**
   - 生产环境需填写真实 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`（以及错题到期提醒模板 `WECHAT_SUBSCRIBE_TEMPLATE_ID`），否则 `POST /api/v1/user/login` 会失败。

6. **数据库表结构变更管理**
   - 当前依赖 `MYSQL_AUTO_INIT=true` 在启动时执行 `CREATE TABLE IF NOT EXISTS` 与轻量字段补齐；长期生产演进建议引入 Alembic 进行版本化 Schema 迁移。

---

## 5. 近期关键修复记录（2026-11-13 基线）

- **`941fc97`**：修复从「学习档案 -> 历史未交卷测验」进入答题页时，因条件提前 `return` 位于 `useMemo` 之前导致的 `Minified React error #310`（Hook 数量不一致崩溃）。
- **`d46b49c`**：修复微信小程序从二级页返回后底部 `custom-tab-bar` 无法点击的问题：
  - 为 `custom-tab-bar` 补齐 `:host` 固定定位防止宿主容器高度塌陷；
  - 移除 `hoverClass` 避免 Taro 编译生成 `catchtouchmove="eh"` 吞掉微移点击；
  - 为矢量图标子元素统一添加 `pointer-events: none !important`；
  - 修正 `ProfilePage` / `MasteryPage` 中 `subscribeBackgroundQuiz` 在 `useDidShow` 内重复订阅的问题。
- **大模型切换加固**：增强 `extract_json_object` 对 `<think>` 推理块的剥离能力，并在 `langchain_factory.py` 中增加 `LLM_JSON_MODE` 与推理模型自动识别保护。
