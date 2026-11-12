# Session handoff：交接清单

> 最后更新：2026-11-12

## 当前阶段

**`zhixing-quiz` V2.3（在 V2.2 基础上完成首页「极简不空旷」双砖平衡一屏与小屏防裁切、`SevenDayRhythmBar` 柱图去晕染与均线/胶囊选中态精修、曲线页冗余 AI 按钮瘦身与 `originTag` 按钮状态隔离、报告页 `"ARQ"` 术语彻底替换为白话微信提醒、以及“后端域级 pre-warm Redis 预备题库 (`0.1s` 秒开) + JSON 强制格式 + 智能跳过冗余联网检索”非换模型速度优化）已完成前后端升级、双端编译与 Playwright 全流程验收。**

## 已完成核心改造

1. **V2.3 首页一屏平衡重塑与 375px 小屏零裁切（[`frontend/src/pages/index/index.tsx`](../frontend/src/pages/index/index.tsx)）**：
   - 修复 V2.2 顶部留白过多与 `375px` 小屏右上角徽章裁切问题，顶栏收敛为精简胶囊「`曲线日程 ›`」，新增 `176px` 紧凑双砖（左侧暖黄 `DUE TODAY` `0.1s` 秒开到期错题，右侧天蓝 `FOCUS DOMAIN` 带 `allow_prewarm: true` 一键开刷最需巩固知识域），下方衔接紧凑 `发起新测验` 大卡，在 `375×812` 与 `390×844` 均严格一屏零滚动。
2. **V2.3 图表/文案去工程化打磨与状态隔离（[`SevenDayRhythmBar`](../frontend/src/components/SevenDayRhythmBar/index.tsx)、[`pages/mastery/index.tsx`](../frontend/src/pages/mastery/index.tsx)、[`pages/report/index.tsx`](../frontend/src/pages/report/index.tsx)、[`backgroundQuizManager.ts`](../frontend/src/services/backgroundQuizManager.ts)）**：
   - 修复 `SevenDayRhythmBar` 胶囊轨道外圈蓝色模糊阴影与顶端圆角缝隙，拓宽柱条至 `34px×116px`，补充每周日均虚线参考线（`.zx-bar-avg-line`）与清晰的日期选中胶囊（`.zx-bar-lbl-pill.is-selected`）。
   - 移除 `MasteryPage` 底部曾与 `.bg-pill` 重叠的冗余 `btn-secondary-ai` 按钮，全站补充 `.has-bg-pill` 底部安全避让空间，并通过 `originTag` 隔离后台任务触发来源的按钮转圈状态（首页大卡、Focus 砖与曲线页 CTA 互不误伤）。
   - 报告页底部「`开启明日 ARQ 到期提醒`」改为通俗文案「**`开启微信复习提醒（明晚 20:00）`**」。
3. **V2.3 非换模型提速与 Redis 域级 Pre-Warm 预热池（[`quiz_service.py`](../backend/app/services/quiz_service.py)、[`arq_worker.py`](../backend/app/workers/arq_worker.py)、[`search_service.py`](../backend/app/services/search_service.py)、[`langchain_factory.py`](../backend/app/llm/langchain_factory.py)）**：
   - 保留 `.env` 当前 `deepseek-ai/DeepSeek-V3.2` 配置，改为工程侧结构性提速：`ChatOpenAI` 启用 `response_format={"type": "json_object"}`、`classify_domain_with_llm` 加 `2.5s` 超时兜底、Tavily 检索收紧为 `max_results=3` 与 `8s` 超时、且当提供 `>= 200` 字参考资料且无时效性关键词时智能跳过外网检索。
   - 新增 ARQ 后台预备任务 `job_prewarm_domain_quiz` 与 Redis 预热缓存（`zx:prewarm:{user_id}:{domain_id}`），交卷更新画像后静默在后台为薄弱/活跃知识域预生成一套自适应测验；用户点击首页 Sky 焦点砖或曲线页 `按曲线安排出题` 时携带 `allow_prewarm: true`，命中即 **`0.1s` 瞬时进入答题** 并后台自动补货下一套。
4. **V2.2 / V2.1 核心底座能力（一并保留）**：
   - 非阻塞后台异步出题悬浮胶囊（`.bg-pill`）、实测+预测双轨差异化记忆曲线、周明细与印章下钻、未交卷草稿分离（`is_submitted=False`）、`本次诊断结论` 3 步复盘、自包含 `custom-tab-bar` (`4350` B 独立 `index.wxss`)、MySQL 12 表 + Redis Lua 原子限流 + Chroma HTTP (`:8001`) + ARQ Worker。

## 已执行的真实校验（2026-11-12，基于 V2.3 最终代码重跑）

- **后端静态检查与单测**：
  - `cd /Users/leileigwl/Work/Learn/new/zhixing-quiz/backend && uv run ruff check app tests` -> **`All checks passed!`**
  - `cd /Users/leileigwl/Work/Learn/new/zhixing-quiz/backend && uv run pytest -q` -> **`189 passed`**（含 V2.3 `TestV23PrewarmAndSmartSearch` Redis 预热消费与智能跳过外网检索覆盖）。
  - 真实环境 Pre-Warm 链路实测：`generate_and_cache_prewarm_quiz` 缓存 6 题后，HTTP `POST /api/v1/quiz/generate/async`（`allow_prewarm=true`）+ `GET /api/v1/quiz/task/{id}` 返回 `completed` 实测耗时 **`0.106s`**。
- **双端编译与 Playwright 移动端 H5 V2.3 E2E（`375×812` & `390×844`）**：
  - `pnpm typecheck`、`NODE_ENV=development pnpm build:h5` 与 `pnpm build:weapp:local` 均退出码 `0`（`frontend/dist/` 保留最新微信小程序构建产物，含 `4350` B 独立 `dist/custom-tab-bar/index.wxss`）。
  - Playwright 实测：`375×812`（`scrollH=812`、`right=359<=375`）与 `390×844`（`scrollH=844`、`right=373<=390`）首页双砖+卡片一屏零裁切；点击焦点砖不误伤首页大卡按钮、曲线页 `.btn-secondary-ai=0`、`.has-bg-pill` 避让悬浮胶囊（`ctaBottom=673 < pillTop=711`）、`SevenDayRhythmBar` 日均线与选中胶囊就位、报告页 `0` `"ARQ"` 字样且呈现「`开启微信复习提醒（明晚 20:00）`」，`PAGE_ERRORS: 0`、`CONSOLE_ERRORS: 0`、`HTTP_ERRORS: 0`。

## 本地已启动服务状态

- `zhixing-quiz-mysql-1` (`127.0.0.1:3306`, Healthy) & `zhixing-quiz-redis-1` (`127.0.0.1:6379`, Healthy)
- Standalone Chroma HTTP Server (`127.0.0.1:8001`)
- ARQ Worker (`uv run arq app.workers.arq_worker.WorkerSettings`)
- FastAPI 2-Worker API (`http://127.0.0.1:8000`) & Taro H5 Dev Server (`http://127.0.0.1:10086`)

## 尚待生产部署确认项

- 本机 `.env` 已配置真实 LLM、Embedding 与 Tavily 联网搜索配置；若在微信真机启用一次性订阅消息提醒，仍需在 `.env` 填入 `WECHAT_SUBSCRIBE_TEMPLATE_ID`、`WECHAT_APP_ID` / `WECHAT_APP_SECRET` 并在微信开发者工具打开 `frontend/dist/` 做真机测试；若需使用 Endor 云端漏洞审计，请先在本机安装并登录 `endorctl`。
