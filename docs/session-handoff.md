# Session handoff：交接清单

> 最后更新：2026-11-12

## 当前阶段

**`zhixing-quiz` V2.1（在 V2.0 `openspec/changes/v2-adaptive-platform-upgrade/` 全量合入基础上，完成微信小程序主端适配、三源并行检索 + 实时 Tavily 核验、错题秒开 SM-2 闭环、真实双轨记忆曲线与归一化 7 日节律柱图）已完成前后端重构、实网联调与双端编译验收。**

## 已完成核心改造

1. **V2.0 基础架构与 MOVEPOP 方案 B 重构（Stage 1–4）**：
   - 暖石膏画布 (`#F6F5F1`) × 奶油黄 (`#F4D06F`) × 雾天蓝 (`#CBE5F5`) × 黑曜石悬浮胶囊 (`#18191E`)，全端零竞品名称残留、零 `XP` 外露、统一纯 CSS 层叠几何图标；`redis:7-alpine` + Chroma HTTP (`:8001`) + ARQ Worker + Uvicorn `--workers 2` + MySQL 12 表行锁事务与 Redis Lua 原子限流。
2. **V2.1 微信小程序主端深度适配（[`frontend/src/`](../frontend/src)）**：
   - **彻底修复微信自定义 TabBar 竖排失效**：[`src/custom-tab-bar/index.tsx`](../frontend/src/custom-tab-bar/index.tsx) 改为自包含组件，显式配置 [`index.config.ts`](../frontend/src/custom-tab-bar/index.config.ts) (`styleIsolation: 'apply-shared'`) 并直接使用静态 hex 颜色的 [`index.scss`](../frontend/src/custom-tab-bar/index.scss)，确保产物独立产出完整 [`dist/custom-tab-bar/index.wxss`](../frontend/dist/custom-tab-bar/index.wxss)。
   - **安全区防遮挡与滚动条隐藏**：六端页面统一 `padding-bottom: calc(220px + env(safe-area-inset-bottom))` 与 `overflow-x: hidden`；[`app.scss`](../frontend/src/app.scss) 隐藏全端滚动条；首页新增横向 `<ScrollView scrollX>`「专注知识域」切换条与文件名优雅省略，消除多知识域混杂与截断生硬问题。
   - **性能与交互降延迟**：首页/曲线/个人页接入 SWR 本地秒开缓存（[`v2Adapters.ts`](../frontend/src/services/v2Adapters.ts)），出题与报告轮询升级为 `700ms → 1100ms` 阶梯高频轮询。
3. **V2.1 错题 SM-2 即时闭环与三源并行出题（[`backend/`](../backend) + [`frontend/`](../frontend)）**：
   - **新错题即时到期 + 原卡升级毕业**：做错或手动标记 (`mark_review`) 后立即以 `status='due'` 入列（不再次日才可见）；[`quiz_sessions`](../backend/app/core/db.py) 新增 `source_review_card_ids_json` 追踪变式重练回写原卡进度；新增 [`POST /api/v1/reviews/practice/submit`](../backend/app/api/v1/routes/reviews.py) 秒级结算直刷进度（`1→3→7→15→30→mastered`）；修复 `review_card_ids` 仅 `1~2` 题时 422 校验崩溃。
   - **错题 `<100ms` 秒开主动回忆 + 手风琴错题本**：首页奶油黄 DUE 卡、`我的`与`曲线`错题本支持直接展开完整选项/用户误选/答案/解析，点击「秒开回顾」`<110ms` 直达作答，答题解析区按需提供「↻ AI 换一道同类变式题」与「我已掌握 (`skip`)」。
   - **三源并行融合 + 真实 Tavily 联网搜索**：[`rag_service.py`](../backend/app/services/rag_service.py) 通过 `asyncio.gather` 并行触发 Chroma HTTP 多文档 (`doc_ids`) 与 Tavily 实时联网检索，叠加用户 `reference_text`（最高 12000 字）形成三源出题融合，并开启 `ENABLE_WEB_SEARCH=true`。
   - **真实双轨记忆曲线与归一化 7 日柱图**：[`mastery_service.py`](../backend/app/services/mastery_service.py) 基于真实准确率与 SM-2 稳定性 `S` 数学建模「巩固后保持轨迹」及灰色虚线「未复习遗忘参考 (`baseline_pct`)」，交卷即随 [`ReportSubmitResponse`](../backend/app/models/report.py) 返回当前域真实曲线；[`SevenDayRhythmBar`](../frontend/src/components/SevenDayRhythmBar/index.tsx) 改为按本周最大题数动态归一化展示高度与数字。

## 已执行的真实校验（2026-11-12，全部基于 V2.1 最终代码重跑）

- **OpenSpec**：`openspec validate "v2-adaptive-platform-upgrade" --strict` -> 通过（全部 Task 已勾选）；`rg -n "墨墨" docs/ openspec/ frontend/src/ backend/` -> `0` 命中。
- **后端静态检查与单测**：
  - `cd /Users/leileigwl/Work/Learn/new/zhixing-quiz/backend && uv run ruff check app tests` -> **`All checks passed!`**
  - `cd /Users/leileigwl/Work/Learn/new/zhixing-quiz/backend && uv run pytest -q` -> **`186 passed in 1.84s`**（含 V2.1 即时到期、原卡升级毕业、`POST /reviews/practice/submit`、双轨曲线分歧、1 题错题变式校验）。
- **真实多进程运行时全链路联调（MySQL 8.0 + Redis 7 + Chroma HTTP `:8001` + ARQ Worker + Uvicorn `--workers 2` + 真实 Tavily）**：
  - `POST /quiz/generate/async` 传入主题 + `reference_text` + 多文档 `doc_ids` + `enable_web_search=true` 经真实 Tavily 联网检索于 `41.27s` 返回 `source_type='web_search'`、`3` 题。
  - 提交 `0%` 错题后 `GET /reviews/due` 即刻返回 `total_due=3`（含 `options/answer/explanation/user_selected`）；`review_card_ids` 1 题变式重练提交 `100%` 推进原卡进度 (`reviewed_cards_progressed=1`)；高/低正确率交卷曲线实测明显分叉 (`[46.3, 22.0, 38.0, 18.0, 18.0, 18.0]` vs `[73.8, 38.1, 83.7, 48.2, 23.1, 18.0]`)；`/reviews/practice/submit` 连续 3 轮触发 `graduated_total=1`。
- **双端编译与 Playwright 移动端 E2E（`390×844` · `2x` DPR）**：
  - `cd /Users/leileigwl/Work/Learn/new/zhixing-quiz/frontend && pnpm typecheck && pnpm build:weapp:local && NODE_ENV=development pnpm build:h5`（并二次重编 `weapp` 保持 `dist/` 为微信小程序产物）-> 全部 `exit 0`；`dist/custom-tab-bar/index.wxss` (`4350` B) 与 `index.json` (`styleIsolation: "apply-shared"`) 验证齐全，全 6 页 `dist/pages/*/*.wxss` 含 `env(safe-area-inset-bottom)`。
  - Playwright 实测：首页聚焦域切换与粘贴资料抽屉展开无溢出 (`scrollW=390`)；点击奶油黄 `DUE TODAY` 以 **`108ms`** 秒开即时回顾页并完成本轮结算；`我的`页验证真实本周印章与手风琴错题卡片展开；`曲线`页与`报告`页双轨 Canvas 实绘 `48,589` 非透明像素且 7 日柱图按 `30 / 23` 归一化展示；`PAGE_ERRORS: 0`、`CONSOLE_ERRORS: 0`、`HTTP_ERRORS: 0`。

## 本地已启动服务状态

- `zhixing-quiz-mysql-1` (`127.0.0.1:3306`, Healthy) & `zhixing-quiz-redis-1` (`127.0.0.1:6379`, Healthy)
- Standalone Chroma HTTP Server (`127.0.0.1:8001`)
- ARQ Worker (`uv run arq app.workers.arq_worker.WorkerSettings`)
- FastAPI 2-Worker API (`http://127.0.0.1:8000`) & Taro H5 Dev Server (`http://127.0.0.1:10086`)

## 尚待生产部署确认项

- 本机 `.env` 已配置真实 LLM、Embedding 与 Tavily 联网搜索配置；若在微信真机启用一次性订阅消息提醒，仍需在 `.env` 填入 `WECHAT_SUBSCRIBE_TEMPLATE_ID`、`WECHAT_APP_ID` / `WECHAT_APP_SECRET` 并在微信开发者工具打开 `frontend/dist/` 做真机测试；若需使用 Endor 云端漏洞审计，请先在本机安装并登录 `endorctl`。
