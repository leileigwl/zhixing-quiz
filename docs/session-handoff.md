# Session handoff：交接清单

> 最后更新：2026-11-12

## 当前阶段

**`zhixing-quiz` V2.2（在 V2.1 基础上完成首页一屏化重塑、曲线=日程联动与历史实测节点、本周学习印章/节律可下钻明细、未交卷草稿分离、`本次诊断结论`三步人话复盘及非阻塞后台异步出题悬浮胶囊）已完成前后端升级、双端编译与 Playwright 全流程验收。**

## 已完成核心改造

1. **V2.2 首页一屏直达 + 轻量化出题交互（[`frontend/src/pages/index/index.tsx`](../frontend/src/pages/index/index.tsx)）**：
   - 首页重塑为「顶部状态条（问候/连胜/待复习秒刷微胶囊）+ 居中核心 `发起新测验` 大卡 + 底部胶囊 Dock」，实测 `390×844` 一屏 `scrollH=844` 零滑动看完；去掉原首页 7 日条、全部系统横条、巨大双 Bento 与最近记录。
   - 出题卡片仅保留主题输入、3 枚快捷词、`智能搜索` 开关与 `快速 3题 / 智能推荐` 2 项直选；三源粘贴文本与多文档多选收敛至「`+ 资料/文档`」半屏抽屉，知识域限定、熟悉度自评、题量微调与 AI 配图收敛至「`设置 ⚙`」抽屉。
2. **V2.2 非阻塞分级异步与客户端镜像缓存（[`backgroundQuizManager.ts`](../frontend/src/services/backgroundQuizManager.ts)、[`BackgroundTaskPill`](../frontend/src/components/BackgroundTaskPill/index.tsx)、[`quizSessionStore.ts`](../frontend/src/services/quizSessionStore.ts)）**：
   - 耗时 AI 出题（含口袋单文档出题、曲线计划出题、错题 AI 变式）移除全屏遮罩，改为按钮原地转圈 + 跨页面轻量悬浮进度胶囊（可自由切换去刷错题或浏览其他页；留首页时就绪自动进题，切走则胶囊转绿点击进入）；交卷结算与错题毕业维持局部防重放锁。
   - 客户端接入 SWR 画像/错题缓存与按 `quiz_id` 隔离的作答草稿持久化，避免切换页面重载丢失；历史列表区分 `is_submitted=False` 为「`待完成 · 继续 ›`」直接断点续刷，不再误标 `0%`。
3. **V2.2 差异化实测曲线 + 曲线日程联动 + 本周进度下钻 + 3步诊断报告（[`mastery_service.py`](../backend/app/services/mastery_service.py)、[`pages/mastery/index.tsx`](../frontend/src/pages/mastery/index.tsx)、[`pages/report/index.tsx`](../frontend/src/pages/report/index.tsx)、[`pages/profile/index.tsx`](../frontend/src/pages/profile/index.tsx)）**：
   - [`build_retention_curve`](../backend/app/services/mastery_service.py) 叠加各知识域真实历次已交卷得分节点（`is_actual`）与专属稳定性 `S`，生成跨领域显著差异的波形，并在 [`MasteryOverviewResponse.next_plan`](../backend/app/models/mastery.py) 计算跌破 50% 临界天数、下次建议复习时机、题量及难度侧重，曲线页支持「按曲线安排出题 →」。
   - 本周进度柱图与「我的 · 本周学习印章」接入 [`get_user_weekly_sessions`](../backend/app/repositories/mastery_repository.py) 当日测验明细下钻（点击任意日期查看学过哪些测验、题数、正确率与薄弱点）。
   - 报告页首屏新增「本次诊断结论」三步人话卡（本次答题与失分点 / 曲线保持率变化原因 / 后续日程与秒开安排）。
4. **微信小程序主端与后端核心基座（V2.0/V2.1）**：
   - 自包含 [`custom-tab-bar`](../frontend/src/custom-tab-bar/index.tsx) 产出 `4350` B 独立 `index.wxss`（`styleIsolation: 'apply-shared'`）、六页统一安全区底距；MySQL 12 表 + Redis Lua 原子限流 + Chroma HTTP (`:8001`) + ARQ Worker + 真实 Tavily 实时联网检索。

## 已执行的真实校验（2026-11-12，基于 V2.2 最终代码重跑）

- **后端静态检查与单测**：
  - `cd /Users/leileigwl/Work/Learn/new/zhixing-quiz/backend && uv run ruff check app tests` -> **`All checks passed!`**
  - `cd /Users/leileigwl/Work/Learn/new/zhixing-quiz/backend && uv run pytest -q` -> **`188 passed in 1.73s`**（含 V2.2 域曲线实测分叉、日程临界推算、周明细下钻及 V2.1 即时 SM-2 全覆盖）。
- **双端编译与 Playwright 移动端 H5 V2.2 E2E（`390×844` · `2x` DPR）**：
  - `pnpm typecheck`、`NODE_ENV=development pnpm build:h5` 与 `pnpm build:weapp:local` 均退出码 `0`（`frontend/dist/` 当前保留最新微信小程序构建产物，含独立 `dist/custom-tab-bar/index.wxss`）。
  - Playwright 实测 V2.2 完整链路：首页 `scrollH=844 <= 844` 一屏零滚动、`+ 资料/文档` 与 `⚙` 抽屉正常开关、发起出题零全屏遮罩（`.zx-loading-overlay=0`）并自由切到 `曲线` 与 `我的` 页面查看悬浮胶囊、切换知识域重绘曲线并点击本周印章/柱图展开具体测验明细、后台就绪后点击绿色胶囊进题交卷验证 3 步诊断结论与双轨曲线：`PAGE_ERRORS: 0`、`CONSOLE_ERRORS: 0`、`HTTP_ERRORS: 0`。

## 本地已启动服务状态

- `zhixing-quiz-mysql-1` (`127.0.0.1:3306`, Healthy) & `zhixing-quiz-redis-1` (`127.0.0.1:6379`, Healthy)
- Standalone Chroma HTTP Server (`127.0.0.1:8001`)
- ARQ Worker (`uv run arq app.workers.arq_worker.WorkerSettings`)
- FastAPI 2-Worker API (`http://127.0.0.1:8000`) & Taro H5 Dev Server (`http://127.0.0.1:10086`)

## 尚待生产部署确认项

- 本机 `.env` 已配置真实 LLM、Embedding 与 Tavily 联网搜索配置；若在微信真机启用一次性订阅消息提醒，仍需在 `.env` 填入 `WECHAT_SUBSCRIBE_TEMPLATE_ID`、`WECHAT_APP_ID` / `WECHAT_APP_SECRET` 并在微信开发者工具打开 `frontend/dist/` 做真机测试；若需使用 Endor 云端漏洞审计，请先在本机安装并登录 `endorctl`。
