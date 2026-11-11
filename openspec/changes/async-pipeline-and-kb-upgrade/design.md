# Design

## Context

- 约束与技术栈基线参见 [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md)：保留 FastAPI + `aiomysql` 原生 SQL + 单 Worker (`--workers 1`) + Chroma 本地集合 `kb_user_{user_id}` + Taro 4 双端轮询，不引入 Celery / Redis 集群 / WebSocket。
- 业务动机与目标能力参见 [`proposal.md`](./proposal.md) 与 [`specs/`](./specs)。

## Goals / Non-Goals

**Goals:**
- 将长耗时 LLM 报告生成与文生图并发耗时从同步等待/出题阻塞链路上剥离，实现前端“秒返算分、文字先答题、AI 复盘与配图后台渐进补齐”。
- 修复 `answer_records` 唯一键冲突报错，把判分权威和 XP 结算收口到后端幂等事务。
- 消除 `knowledge_service` 同步磁盘 I/O 与 `rag_service` 同步工具对 Uvicorn 单 Worker 事件循环的阻塞，并增强 `.md` / `.txt` 解码及 Markdown 章节切分质量。

**Non-Goals:**
- 不引入外部消息队列（Celery / RabbitMQ）、WebSocket / SSE 推送改造或独立向量数据库集群。
- 不修改现有 `users` / `quiz_sessions` 既有接口的破坏性字段，确保历史闯关回看与既有 154 个单元测试平滑过渡。

## Decisions

### Decision 1: MySQL 8.0 启动幂等列迁移（不依赖破坏性重建）
- **选择**：在 [`db.py`](../../../backend/app/core/db.py) 的 `init_mysql()` 中通过查询 `INFORMATION_SCHEMA.COLUMNS` 检测并执行幂等 `ALTER TABLE`：
  - `quiz_tasks` 新增 `stage VARCHAR(32) NOT NULL DEFAULT 'queued'`
  - `quiz_sessions` 新增 `image_status VARCHAR(20) NOT NULL DEFAULT 'none'`、`image_notice VARCHAR(255) NULL`
  - `reports` 新增 `status VARCHAR(20) NOT NULL DEFAULT 'completed'`、`error_message VARCHAR(500) NULL`（历史旧数据默认视为 `'completed'`）
  - `recover_stale_jobs()` 同步扩充清理重启遗留的 `reports.status='generating'` 与 `quiz_sessions.image_status='generating'`。
- **理由与备选方案**：MySQL 8.0 不支持 `ADD COLUMN IF NOT EXISTS` 语法，采用 `INFORMATION_SCHEMA.COLUMNS` 判空后按需执行 `ALTER TABLE` 可确保本地现有 Docker 卷与生产存量库零停机无损升级。放弃引入 Alembic 全家桶，符合 `ARCHITECTURE.md` 保持轻量化启动自动建表的原则。

### Decision 2: 出题阶段进度与「文字先出、配图后台补齐」
- **选择**：
  - [`quiz_service.py`](../../../backend/app/services/quiz_service.py) 在 `_execute_quiz_task` 依次推进 `task_repository.update_task_stage(task_id, stage)`：`fetching_context` -> `generating_quiz` -> `completed`；
  - 当 `req.generate_images=True` 时，文本题库生成并写入 `quiz_sessions(image_status='generating')` 后立即标记 `quiz_tasks` 为 `completed`（带出 `image_status='generating'`），同时 `asyncio.create_task(_run_background_images(quiz_id, user_id, quiz_output.questions))` 后台跑原 `image_service.generate_images_for_quiz` 并发限流生成；每生成/完成一批后更新 `quiz_sessions.questions_json` 中的 `image_url` 及最终 `image_status`（`completed` / `partial` / `failed`）与 `image_notice`；
  - 新增 `GET /api/v1/quiz/{quiz_id}/images`（JWT + `user_id` 归属校验），供 [`QuizPage`](../../../frontend/src/pages/quiz/index.tsx) 在 `image_status === 'generating'` 时每 2.5 秒轮询同步新图片 URL 到本地状态与 `quizSessionStore`。
- **理由与备选方案**：用户无需干等 10~30 秒文生图即可立即阅读第 1 题；若改用 SSE/WebSocket 推送虽然即时，但微信小程序网络层长连接维护成本高且违反本项目不引 WebSocket 的边界约束。

### Decision 3: 「秒返判分 + XP 幂等」与异步 AI 报告双端点
- **选择**：
  - 新增 `POST /api/v1/report/submit` 与 `GET /api/v1/report/{quiz_id}`：
    1. 校验 `(quiz_id, user_id)` 归属并取出服务端保存的标准 `questions_json`；
    2. 在服务端重算每道题的 `is_correct`（比对排序后的标准答案列表）、`correct_count`、`wrong_count`、`accuracy` 与 `xp_gain = 10 + correct_count * 2`；
    3. 使用 MySQL 事务保护首次落库：`INSERT IGNORE` 写入 `answer_records`，仅当 `rowcount > 0` 时调用 `user_repository.add_user_xp(user_id, xp_gain)` 并返回 `xp_awarded=True`；若 `answer_records` 已存在且报告已处于 `generating`/`completed`，幂等返回已有成绩与 `xp_awarded=False`、`xp_gain=0`（以及当前 `report_status`）；
    4. 若 `reports` 尚无成功记录，写入/更新 `reports(status='generating', report_json='{}')` 并 `asyncio.create_task(_run_report_generation(...))` 后台调用 LLM 生成报告后写回 `status='completed'`（失败写 `status='failed'` + `error_message`）。
  - 兼容原 `POST /api/v1/report/generate`：保留路由与响应模型不变，内部同样先走幂等检查与服务端判分，若已生成过则直接返回已有报告且不重复插表或加分。
- **理由与备选方案**：把判分与 XP 权威从前端收回后端、且通过事务内条件写消除 `Duplicate entry`；相比直接删除 `/report/generate` 的做法，双接口共存让旧客户端与已有单测平滑迁移。

### Decision 4: 文档多编码、Markdown 章节切分与异步 RAG 工具
- **选择**：
  - [`document_loader_service.py`](../../../backend/app/services/document_loader_service.py)：
    - 对 `.md` / `.txt` 依次尝试 `utf-8-sig` -> `utf-8` -> `gb18030` 解码，避免 Windows 笔记直接报错；
    - 对 `.md` 先用 `MarkdownHeaderTextSplitter(headers_to_split_on=[("#", "h1"), ("##", "h2"), ("###", "h3")])` 按章节拆分，并将层级路径拼接为前缀上下文保留在段落前，再经 `RecursiveCharacterTextSplitter` 按 `kb_chunk_size` / `kb_chunk_overlap` 控制长度；若文档无 Markdown 标题或为 PDF/DOCX/TXT，仍走原递归切分器。
  - [`vector_store_service.py`](../../../backend/app/services/vector_store_service.py)：`add_document_chunks` 按每批 `32` 个分块调用 `vector_store.add_documents`，降低 SiliconFlow / DashScope Embedding 单次超时与限流失败概率。
  - [`knowledge_service.py`](../../../backend/app/services/knowledge_service.py) & [`rag_service.py`](../../../backend/app/services/rag_service.py)：本地文件写入/删除统一用 `asyncio.to_thread`；将 `rag_service._build_knowledge_base_tool` 中的 `search_knowledge_base` 改为 `async def`，内部通过 `await asyncio.to_thread(vector_store_service.similarity_search, ...)` 调度，彻底释放 Uvicorn 单进程事件循环。

## Risks / Trade-offs

- **[Risk] 后台配图任务与交卷读题并发写 `quiz_sessions`**：背景补图只更新 `questions_json` 中的 `image_url` 与 `image_status`/`image_notice`，不会修改题目 `id`、`stem`、`options` 与 `answer`；判分只读取题目 `id` 与 `answer`，两者字段正交无逻辑冲突。
- **[Risk] 进程重启中断正在生成的报告/配图**：通过扩展 `recover_stale_jobs()` 在启动时把遗留 `'generating'` 状态安全转为 `'failed'`/`'partial'`，前端轮询可立即收敛退出并提示用户；`ReportPage` 在 `report_status='failed'` 时仍完整展示服务端算出的圆环正确率与本地错题解析回顾。
- **[Risk] 后端新增路由与字段需前端同步兼容**：前端 `QuizPage`、`ReportPage` 与 `api.ts` 保持对历史记录详情（老结构不含 `image_status` 时默认 `'none'`）的默认兜底，确保已落库历史闯关可正常回看。

## Migration Plan

1. 升级 `backend/app/core/db.py` 启动 DDL 幂等列迁移与自愈逻辑（无停机风险）。
2. 完成后端 Repository / Service / Router 改造并补全 pytest 单元测试（涵盖 XP 幂等、重复提交、异步配图、阶段进度、GBK 解码与 Markdown 标题切分、异步 RAG）。
3. 完成前端 `api.ts`、轮询提示、答题页渐进配图与报告页秒开算分改造。
4. 先在开发态本地 MySQL + 硅基流动实模型跑通全链路与 Playwright/真机联调，再更新 `docs/ARCHITECTURE.md` / `docs/02-design/system-architecture.md` / `docs/session-handoff.md`。
