# Session handoff：交接清单

> 最后更新：2026-11-12

## 当前阶段

**`zhixing-quiz` V2.4（在 V2.3 基础上完成「后端全链路 5 段耗时 + 流式首字 TTFT / 中途断流自动重连监控与诊断压测脚本」、「等待文案移除『可逛其他页』与首页双重计时去重 + 跨页 `originTag` 精准隔离」、以及「曲线页重构为纯洞察看板 + 至多 1 枚轻重练入口」）已完成原型门控确认、前后端实现、双端编译与 Playwright 全流程验收。**

## 已完成核心改造

1. **V2.4 后端全链路 5 段耗时与流式 TTFT 监控 + 自测诊断脚本（[`quiz_chain.py`](../backend/app/llm/quiz_chain.py)、[`quiz_service.py`](../backend/app/services/quiz_service.py)、[`task_repository.py`](../backend/app/repositories/task_repository.py)、[`monitor_quiz_latency.py`](../backend/scripts/monitor_quiz_latency.py)）**：
   - 保持 `.env` 当前 `deepseek-ai/DeepSeek-V3.2` 与 Prompt 不变（待后续测试新模型），新增 `QuizTaskTelemetry` 结构并拆解 `queue_wait_ms`、`domain_classify_ms`、`rag_search_ms`、`llm_ttft_ms`（首字延迟）、`llm_total_ms`、`completion_tokens`、`tps`、`db_save_ms` 与 `attempt` / `retry_reason`。
   - `generate_quiz_with_telemetry` 通过 `chain.astream(...)` 实时追踪首字停顿（`>30s`）与中途断流（`>25s`）并自动快速重试 1 次（不半路误杀正常吐字），同时推送实时进度 `AI 正在编排第 X/Y 题...`。
   - 3 组对照监控实测已精确定位慢因：ARQ 排队（`77~482ms`）、域分类（`4~95ms`）、Tavily（`1.2~3.2s`）、落库（`46~71ms`）均正常，瓶颈在 `DeepSeek-V3.2` 吞吐 `20.1~21.8 tok/s` 且 3~6 题输出达 `958~1,869 tokens`（`50.21s~89.65s`）。
2. **V2.4 等待文案精简、首页防重计时与按钮态精确隔离（[`pages/index/index.tsx`](../frontend/src/pages/index/index.tsx)、[`BackgroundTaskPill`](../frontend/src/components/BackgroundTaskPill/index.tsx)、[`backgroundQuizManager.ts`](../frontend/src/services/backgroundQuizManager.ts)、[`pages/knowledge/index.tsx`](../frontend/src/pages/knowledge/index.tsx)、[`pages/profile/index.tsx`](../frontend/src/pages/profile/index.tsx)）**：
   - 彻底清除前端所有「可逛其他页」「可先切页浏览或刷错题」提示文案；首页主按钮仅保留简洁 `出题中 (Xs)`，在首页等待时不重复叠放底部悬浮胶囊，切离首页后再展示单条实时阶段胶囊。
   - 为口袋文档（`knowledge-doc:${doc_id}`）与我的错题卡（`profile-card`）补全 `originTag` 精确隔离，避免首页出题时其他页按钮连带误转圈。
3. **V2.4 曲线页「纯洞察 + 至多 1 枚轻入口」重构（[`v2-mastery-and-progress-redesign.html`](02-design/prototypes/v2-mastery-and-progress-redesign.html)、[`pages/mastery/index.tsx`](../frontend/src/pages/mastery/index.tsx)、[`pages/mastery/index.scss`](../frontend/src/pages/mastery/index.scss)）**：
   - 先通过原型确认后重构曲线页：`schedule-card` 改为轻巧「下次遗忘节点」洞察卡（移除 `按曲线安排出题 →` 大按钮）；移除底部巨型 `秒开清零 / 再刷一组` 按钮与每张错题卡下方的 `秒开重做 / AI 变式` 按钮群。
   - 仅当存在待巩固错题时在「待巩固错题」标题旁放 1 枚轻胶囊 `重练 N 题 ›`（与实际 `slice(0, 6)` 抽取题数精确对齐），无错题时整页 `0` 个刷题按钮。
4. **V2.3 / V2.2 / V2.1 核心底座能力（一并保留）**：
   - Redis + ARQ 域级 Pre-Warm 预热池（`allow_prewarm: true`）、差异化实测+预测双轨曲线、周明细与印章下钻、未交卷草稿分离、3 步诊断结论、自包含 `custom-tab-bar` (`4350` B 独立 `index.wxss`)。

## 已执行的真实校验（2026-11-12，基于 V2.4 最终代码重跑）

- **后端静态检查、单测与实时 3 组对照监控**：
  - `cd /Users/leileigwl/Work/Learn/new/zhixing-quiz/backend && uv run ruff check app tests` -> **`All checks passed!`**
  - `cd /Users/leileigwl/Work/Learn/new/zhixing-quiz/backend && uv run pytest -q` -> **`191 passed`**（含 V2.4 TTFT 假死重试与 `QuizTaskTelemetry` 透传测试）。
  - `uv run python scripts/monitor_quiz_latency.py` 实测 3 组全部 `completed`：分布式锁 3 题·联网 `73.07s`（`20.9 tok/s`）、RAG 检索 3 题·纯 LLM `50.21s`（`20.1 tok/s`）、HTTP/3 自适应 6 题·联网 `89.65s`（`21.8 tok/s`）。
- **双端编译与 Playwright 移动端 H5 V2.4 E2E（`375×812` & `390×844`）**：
  - `pnpm typecheck`、`NODE_ENV=development pnpm build:h5` 与 `pnpm build:weapp:local` 均退出码 `0`（`frontend/dist/` 保留最新微信小程序构建产物，含独立 `dist/custom-tab-bar/index.wxss`）。
  - Playwright 实测：首页等待中不渲染重复 `.bg-pill` 且按钮只显示 `出题中 (Xs)`、切换至口袋页时文档按钮维持 `出题 →` 且悬浮胶囊实时展示 `AI 正在编排 3 道题目...`、曲线页 `.schedule-go=0` / `.btn-secondary-ai=0` / `.zx-btn-obsidian=0` 且仅有 `1` 枚标题旁轻重练胶囊、`PAGE_ERRORS: 0`、`CONSOLE_ERRORS: 0`、`HTTP_ERRORS: 0`。

## 本地已启动服务状态

- `zhixing-quiz-mysql-1` (`127.0.0.1:3306`, Healthy) & `zhixing-quiz-redis-1` (`127.0.0.1:6379`, Healthy)
- Standalone Chroma HTTP Server (`127.0.0.1:8001`)
- ARQ Worker (`uv run arq app.workers.arq_worker.WorkerSettings`)
- FastAPI 2-Worker API (`http://127.0.0.1:8000`) & Taro H5 Dev Server (`http://127.0.0.1:10086`)

## 尚待生产部署确认项

- 本机 `.env` 已配置真实 LLM、Embedding 与 Tavily 联网搜索配置；若在微信真机启用一次性订阅消息提醒，仍需在 `.env` 填入 `WECHAT_SUBSCRIBE_TEMPLATE_ID`、`WECHAT_APP_ID` / `WECHAT_APP_SECRET` 并在微信开发者工具打开 `frontend/dist/` 做真机测试；若需使用 Endor 云端漏洞审计，请先在本机安装并登录 `endorctl`。
