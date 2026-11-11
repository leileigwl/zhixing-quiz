# Tasks

## 1. MySQL 幂等表结构演进与启动自愈

- [ ] 1.1 在 `backend/app/core/db.py` 中新增基于 `INFORMATION_SCHEMA.COLUMNS` 的幂等列迁移逻辑，为 `quiz_tasks` 增加 `stage`、为 `quiz_sessions` 增加 `image_status` / `image_notice`、为 `reports` 增加 `status` / `error_message`，并同步更新 `recover_stale_jobs()` 回收卡死的 `generating` 状态；通过单元测试（Mock cursor）及本地 MySQL 8.0 重启验证已有数据不丢失且新列存在。

## 2. 异步出题阶段进度与文字先出、配图后台补齐

- [ ] 2.1 更新 `backend/app/models/quiz.py` 与 `backend/app/repositories/{task_repository,quiz_repository}.py`，支持读写 `stage` / `stage_message`、部分更新单题 `image_url` 及 `image_status` / `image_notice`；通过 pytest 验证仓储函数 SQL 参数与字段映射正确。
- [ ] 2.2 改造 `backend/app/services/quiz_service.py` 与 `backend/app/api/v1/routes/quiz.py`：在 `_execute_quiz_task` 推进阶段提示并在文本入库后即刻完成出题任务，将配图拆出至后台异步任务并发补齐；新增带 JWT 与归属校验的 `GET /api/v1/quiz/{quiz_id}/images` 查询端点，并补齐单元测试验证配图未完即可返回题目、配图异常不阻断主流程且他人越权返回 403/4004。

## 3. 秒返判分、XP 幂等与异步 AI 复盘报告

- [ ] 3.1 更新 `backend/app/models/report.py`、`backend/app/services/scoring_service.py` 与 `backend/app/repositories/quiz_repository.py`，实现服务端基于标准答案重算 `is_correct` 与 `accuracy`，并使用事务 + `INSERT IGNORE` 保护 `answer_records` 与 `add_user_xp` 仅在首次提交时发放 XP；通过 pytest 验证作弊篡改 `is_correct` 无效且重复交卷不报错、不重复加分。
- [ ] 3.2 改造 `backend/app/services/report_service.py` 与 `backend/app/api/v1/routes/report.py`：新增 `POST /api/v1/report/submit`（<50ms 秒返算分并启动后台 AI 总结）与 `GET /api/v1/report/{quiz_id}`（归属校验 + 轮询报告状态），同时保持原 `POST /api/v1/report/generate` 向后兼容且共用幂等落库路径；补齐单元测试与接口集成用例并同步更新 `docs/02-design/system-architecture.md` 接口契约。

## 4. 知识库多编码解析、Markdown 切分与非阻塞异步 RAG

- [ ] 4.1 升级 `backend/app/services/document_loader_service.py`：实现 `.txt` / `.md` 的 `utf-8-sig` / `utf-8` / `gb18030` 多编码自动解码与空内容提示，并对 `.md` 增加按 `# / ## / ###` 标题先拆节、再按 `chunk_size` / `chunk_overlap` 二次切分；在 `backend/tests/test_document_loader_service.py` 新增 GBK 与 Markdown 多章节测试用例并全部通过。
- [ ] 4.2 升级 `backend/app/services/vector_store_service.py`、`knowledge_service.py` 与 `rag_service.py`：`add_document_chunks` 按每批 32 条分批写入 Chroma，文件写盘/删盘改用 `asyncio.to_thread`，RAG Agent 中的 `search_knowledge_base` 改为 `async def` + `asyncio.to_thread` 非阻塞检索；在 `test_vector_store_service.py`、`test_knowledge_service.py` 与 `test_rag_service.py` 补齐分批写入与异步工具用例并验证 `uv run ruff check app tests` 与 `uv run pytest` 全绿。

## 5. 前端渐进式交互改造（H5 + 微信小程序双端）

- [ ] 5.1 更新 `frontend/src/services/api.ts` 与 `quizSessionStore.ts`：对齐出题阶段提示字段 `stage_message`，新增 `getQuizImages`、`submitQuizReport` 与 `pollReportStatus` 封装（保持对旧历史字段的兼容），并移除前端写死的 XP 公式改读服务端返回值；通过 `pnpm typecheck` 校验无报错。
- [ ] 5.2 更新 `frontend/src/pages/{index,knowledge,quiz,report}/index.tsx` 及样式：出题等待弹窗展示实时 `stage_message`；`QuizPage` 在 `image_status === 'generating'` 时后台每 2.5s 轮询增量挂图不中断答题；`ReportPage` 交卷后秒现圆环正确率与 XP、AI 复盘模块展示局部骨架并 2 秒轮询补全；同步核验 `pnpm build:weapp:local` 与 `pnpm build:h5` 编译通过。

## 6. 全链路联调与规范收口

- [ ] 6.1 启动本地 MySQL 8.0、FastAPI 后端与 H5 服务，跑通“上传 GBK/Markdown 文档 → 异步出题阶段提示 → 秒进答题页渐进补图 → 秒返算分 + 重复提交幂等验证 → 异步报告轮询完成”全链路真实联调，并完成 Playwright 移动端 5 屏零报错截图核验。
- [ ] 6.2 同步更新 `docs/ARCHITECTURE.md`、`docs/session-handoff.md`，并在验收通过后准备执行 OpenSpec `sync-specs` / `archive` 收口。
