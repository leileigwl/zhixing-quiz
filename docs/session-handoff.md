# Session handoff：交接清单

> 最后更新：2026-11-12

## 当前阶段

**`zhixing-quiz` V2.0（`openspec/changes/v2-adaptive-platform-upgrade/`）已完成前端重构、后端架构升级、分布式 Redis/ARQ/Chroma HTTP 多进程联调、Skill 安全/架构审计加固与全端编译验收，所有 OpenSpec 任务（Stage 0–4）均已 `[x]` 收口并通过 `--strict` 校验。**

## 已完成核心改造

1. **Stage 1：前端 MOVEPOP 方案 B 全量重构（[`frontend/src/`](../frontend/src)）**：
   - 严格对齐 [`v2-ui-design-system.md`](02-design/v2-ui-design-system.md)：暖石膏画布 (`#F6F5F1`) × 奶油黄 (`#F4D06F`) × 雾天蓝 (`#CBE5F5`) × 黑曜石悬浮胶囊 (`#18191E`)，全端零竞品名称残留、零 `XP` 外露、统一纯 CSS 层叠几何图标。
   - **4 Tab 黑曜石悬浮胶囊 Dock**：`今日` (`pages/index`) / `口袋` (`pages/knowledge`) / `曲线` (`pages/mastery`) / `我的` (`pages/profile`)；微信小程序走 `src/custom-tab-bar`，H5 通过 `useDidShow`/`useDidHide` 单例门控渲染；跨端 `<Canvas type="2d">` 真实绘制 `R(t)=e^(-t/S)` 学习记忆曲线与 `7 日复习节律柱图`。
   - 答题页修复「`< 上一题`」只读回看与锁题逻辑（`currentIndex === 0` 保持布局稳定防穿透），并支持 DeepSeek 式「联网搜索」独立胶囊行 + 题目数量 `3/自适应/5/10/15`。
2. **Stage 2 & 3：后端分布式基础设施、自适应引擎与 SM-2 延迟召回（[`backend/`](../backend) + [`docker-compose.yml`](../docker-compose.yml)）**：
   - **基础设施**：新增 `redis:7-alpine` (`:6379`)、独立 Chroma HTTP 服务（`chromadb` 1.5.9 on `:8001`）、ARQ 异步 Worker 进程（[`arq_worker.py`](../backend/app/workers/arq_worker.py)），支持 Uvicorn `--workers 2` 安全运行。
   - **MySQL 12 表与无损回填**：[`db.py`](../backend/app/core/db.py) 新增 `domains`、`questions`、`user_knowledge_mastery`、`review_cards`、`subscribe_quotas`，以 `GET_LOCK` 串行化初始化、`17` 项幂等列迁移及存量 V1 `backfill_v1_data()`。
   - **核心引擎**：[`adaptive_service.py`](../backend/app/services/adaptive_service.py)（倒 U 题量与 E/M/H 配比）、[`domain_classifier.py`](../backend/app/services/domain_classifier.py)（关键词秒分 + LLM 语义归并）、[`search_service.py`](../backend/app/services/search_service.py) & [`rag_service.py`](../backend/app/services/rag_service.py)（LCEL `RunnableBranch` 可控路由）、[`review_service.py`](../backend/app/services/review_service.py)（SM-2 `1→3→7→15→30` + ARQ `_defer_by` + 小时级 Cron + 微信订阅推送）、[`mastery_service.py`](../backend/app/services/mastery_service.py)（60s Redis 缓存 + 图谱总览）。
3. **Stage 4：Skill 审计加固**：
   - [`rate_limit.py`](../backend/app/core/rate_limit.py)：Redis Lua 原子滑动窗口脚本消除多 Worker TOCTOU 竞态。
   - [`mastery_repository.py`](../backend/app/repositories/mastery_repository.py)：`upsert_mastery_after_submission` 增加 `conn.begin() + SELECT ... FOR UPDATE` 事务行锁防同域并发覆盖丢失更新。
   - [`document_loader_service.py`](../backend/app/services/document_loader_service.py) & [`knowledge_service.py`](../backend/app/services/knowledge_service.py)：上传文件名清洗防控制字符/路径前缀注入，`.docx` 解压总体积上限 50MB 防压缩炸弹。
   - [`task_repository.py`](../backend/app/repositories/task_repository.py)：统一异步任务缓存/查询字段 `result_json`，修复跨 Worker/ARQ 轮询完成状态时 `result` 为空的联调缺陷。

## 已执行的真实校验（2026-11-12，全部基于最终代码重跑）

- **OpenSpec**：`openspec validate "v2-adaptive-platform-upgrade" --strict` -> 通过（全部 Task 已勾选）。
- **后端静态检查与单测**：
  - `cd /Users/leileigwl/Work/Learn/new/zhixing-quiz/backend && uv run ruff check app tests` -> **`All checks passed!`**
  - `cd /Users/leileigwl/Work/Learn/new/zhixing-quiz/backend && uv run pytest -q` -> **`183 passed in 1.55s`**（含 LCEL 分支、倒 U 自适应、SM-2、ARQ `_defer_by`、Redis Lua 限流、`docx` 压缩炸弹、并发幂等及 HTTP Mock 微信推送；注：`endorctl` CLI 未在本机安装且本地 `.env` 的 `TAVILY_API_KEY` / `WECHAT_SUBSCRIBE_TEMPLATE_ID` 为空，该两项外部通道通过单测 Mock 验证并按设计优雅降级）。
- **真实多进程运行时全链路联调（MySQL 8.0 + Redis 7 + Chroma HTTP `:8001` + ARQ Worker + Uvicorn `--workers 2`）**：
  - **限流与新接口**：`GET /api/v1/health`、`GET /api/v1/mastery/overview`、`GET /api/v1/reviews/due` 均返回 `200`；连续 6 次请求 `/quiz/generate/async` 精确返回 `[200, 200, 200, 200, 200, 429]`。
  - **真实上传/自适应出题/提交/SM-2**：上传 `hybrid_rag_notes.md` 经 ARQ + Chroma HTTP 解析为 `ready` 并自动归类至 `RAG 架构`；自适应出题（冷启动陌生模式）经 ARQ 返回 `4` 题 (`source_type=kb_rag`)；交卷秒返 `streak_days=1`、`domain_mastery_after=77.27`、`due_cards_created=1`，二次提交严格返回 `already_submitted=True, xp_awarded=False, xp_gain=0`；ARQ 后台报告生成完成。
- **前端构建与 Playwright 6 屏全链路 E2E**：
  - `cd /Users/leileigwl/Work/Learn/new/zhixing-quiz/frontend && pnpm typecheck && pnpm build:weapp:local && NODE_ENV=development pnpm build:h5` -> 全部通过（0 TS 错误，双端打包成功）。
  - Playwright（`390×844` · `2x` DPR）重跑最终代码：覆盖 `Home -> Knowledge -> Mastery -> Profile -> QuizPrevReadonly -> Report`，`PAGE_ERRORS: 0`、`CONSOLE_ERRORS: 0`、`HTTP_ERRORS: 0`，6 屏均无横向溢出 (`scrollW=390`)，Curve Canvas 渲染 `39,839` 非透明像素，答题页实测「`中等难度 · 只读回看`」。

## 本地已启动服务状态

- `zhixing-quiz-mysql-1` (`127.0.0.1:3306`, Healthy) & `zhixing-quiz-redis-1` (`127.0.0.1:6379`, Healthy)
- Standalone Chroma HTTP Server (`127.0.0.1:8001`)
- ARQ Worker (`uv run arq app.workers.arq_worker.WorkerSettings`)
- FastAPI 2-Worker API (`http://127.0.0.1:8000`) & Taro H5 Dev Server (`http://127.0.0.1:10086`)

## 尚待生产部署确认项

- 若启用真实在线联网搜索与微信一次性订阅消息提醒，需在 `.env` 填入 `TAVILY_API_KEY` 与 `WECHAT_SUBSCRIBE_TEMPLATE_ID`（及对应小程序 `WECHAT_APP_ID` / `WECHAT_APP_SECRET`），并结合微信开发者工具做真机授权测试；若需使用 Endor 云端漏洞审计，请先在本机安装并登录 `endorctl`。
