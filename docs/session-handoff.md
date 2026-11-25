# Session handoff：交接清单

> 最后更新：2026-11-25（V2.9 响应式改版进行中，见下方「当前进度」）

## 当前进度（V2.9 响应式改版 · 2026-11-25 · 进行中）

> 用户 2026-11-25 20:19 确认 V2.9 原型，唯一改动：**iPad 竖屏 768–1099 保留底部 Dock，只把内容加宽居中（最大宽 720），导航不放左边**；其余按原型默认。授权 agent 自行判断细节、CI 全绿后自行合并 PR 并上线 https://study.leileigwl.cn 。

- [x] PR #3（部署文件）已合并到 main（`dc3a060`）。
- [ ] PR ①（分支 `feat/v29-responsive`）：导航外壳（`ResponsiveNav` = 手机/竖屏底部 Dock、≥1100 `SideNav` 侧栏）+ 备案页脚 `IcpFooter`（4 个 tab 页）+ 全局手感（focus-visible / hover / `.zx-hit` 44px 热区 / 内容容器 720·1120）+ `useViewportTier` / `tierFromWidth` + **修复「未登录时地址是登录页、画面是首页」**（`services/authGuard.ts`，路由初始化前同步切到登录页）+ 登录邮箱记录与 `logout()`；原型与改动清单已按竖屏决定同步修改。
- [ ] PR ②：四个 tab 页宽屏多栏布局 +「我的」页账号区（邮箱 + 退出登录）。
- [ ] PR ③：答题（5:7 并排 + 键盘 1–4/A–D、Enter、←）/ 登录分屏 / 复盘双栏 / 弹层居中对话框（Esc）/ 其余页面备案号。
- [ ] 上线：`TARO_APP_API_BASE_URL=https://study.leileigwl.cn/api/v1 pnpm build:h5` → 备份 `/var/www/zhixing-quiz/h5` 为 `h5.bak-<日期>` → 上传替换；服务器 `/opt/zhixing-quiz` 拉最新 main（后端无改动则不重建）。

**下一步**：看上面第一个未勾选项。截图脚本与假后端数据在项目工作区 `work/shot_v29_app.py`、`work/mockapi.py`（不入库），截图存 `v29-screens/`。

**未实机验证**：iOS Safari / iPad 真机 / 微信内置浏览器未测；weapp 仅确认编译产物 wxss 与改动前逐字节一致，未在微信开发者工具里打开。

---

## 本轮（2026-11-25）· V2.9 H5 响应式布局原型（分支 `design/v29-responsive`，仅本地提交）

- 只出原型、未改 `frontend/`：[`v29-responsive-layout.html`](02-design/prototypes/v29-responsive-layout.html)（**待用户确认**），覆盖 4 个 tab 页 + 答题 / 复盘 / 登录（V2.8 宽屏版），断点 `<768` / `768–1099` / `≥1100`，页底备案号「浙ICP备2026102405号-1」；文件内附断点与改动清单、工作量与 Taro H5 实现方式。索引已更新。
- 校验：Playwright 在 390 / 820 / 1180 / 1440 四宽度打开原型逐页检查，无横向溢出、无文字截断、无 JS 错误；首页截图存于项目工作区 `proto-screens/`（不入库）。未跑前端闸门（无代码改动）。
- 待决：用户确认原型及 3 个设计选择（平板导航形态 / 答题宽屏并排 / 手机端备案号位置）后再按清单分 3 个 PR 实现。

---

## 本轮（2026-11-24 · 下午）· H5 邮箱验证码登录

**当前阶段**：用户决定小程序（个人主体）上线暂缓，**H5 为主目标**；短信 / 微信手机号组件不可用，改为「邮箱 + 6 位验证码」登录，经个人邮箱（163/QQ 授权码）通用 SMTP 发送。**用户已于 2026-11-24 明确批准该鉴权范围变更**，并要求同步做原型与实现、出 PR 描述。

### 本轮做了什么
1. 后端：`POST /api/v1/auth/email/send-code`、`/auth/email/verify`（HMAC 存码、10 分钟 TTL、每码 5 次、常量时间比较、单次使用；邮箱 60s 冷却 / 每日 10 次 / IP 限流；不泄露账号存在性；签发与微信登录同一 JWT）；通用 SMTP 发信（仅 `SMTP_*` 配置），dev/test 无 SMTP 时控制台打印验证码，production 缺 SMTP 或 Redis 返回 503；`users.email` 可空唯一列 + 启动幂等列/索引迁移。
2. 原型：[`v28-email-login.html`](02-design/prototypes/v28-email-login.html)（**待用户视觉确认**）。
3. 前端：H5 登录页 `pages/login/index`、`api.ts` 发码/校验/401→登录页、纯逻辑 `emailLogin.ts` + `useCountdown.ts`；weapp 仍 `wx.login`，开发态 H5 仍 dev-login。
4. 文档：README（SMTP 授权码配置）、PRODUCT / PRD / ARCHITECTURE / system-architecture（含 §4.1 迁移 SQL）、PR 描述 [`docs/pr/feat-email-otp-login.md`](pr/feat-email-otp-login.md)。

### 实际执行的命令与结果
- `cd backend && uv run ruff check app tests` → `All checks passed!`
- `cd backend && uv run pytest -q` → **`242 passed`**（原 199 + 新增 43）
- `cd frontend && pnpm lint` → `0 errors, 4 warnings`（既有）；`pnpm typecheck` → 通过
- `pnpm test:coverage` → **`11 files / 124 passed`**，lines 85.36 / branches 84.52 / functions 84.07
- `TARO_APP_API_BASE_URL=https://api.example.com TARO_APP_ALLOW_PLACEHOLDER_API=1 pnpm build:h5` / `pnpm build:weapp` → 均退出码 0（沙箱 `frontend/dist/` 现为占位地址生产包）
- 冒烟：本地 uvicorn（无 MySQL/Redis）+ `aiosmtpd` 假 SMTP，`send-code` 实际经 smtplib 投递成功、邮件主题/发件人/正文正确，429/4011/4012/5030 符合预期；Playwright 打开 H5 构建产物（拦截 API），无 token 自动进登录页 → 发码倒计时 → 错码提示 → 登录后回首页并写入 token，无页面 JS 错误。
- **未实机验证**：未用真实 163/QQ 邮箱发信（授权码、日发信上限、垃圾箱概率未验证）；未连真实 MySQL/Redis 跑完整 verify 建号；未在 iOS Safari / Android / 微信内置浏览器真机测试；GitHub CI 未实际运行（未 push）。

### 未决事项 / 下一步
1. **请用户对照 V2.8 原型确认登录页视觉**，有调整先改原型再改页面。
2. 用户配置 163/QQ 授权码后做一次真实发信 + 登录冒烟（含垃圾箱检查）；生产反代设置 `CLIENT_IP_HEADER=X-Real-IP` 并确认代理覆盖该头。
3. 补《用户协议》《隐私政策》正文（当前为占位弹窗）；「我的」页补「退出登录」。
4. 后续：小程序扫码绑定同一邮箱账号（需设计 `em_` 伪 openid 与微信 openid 的绑定 / 合并策略）。
5. 上线前按 AGENTS.md 执行安全审计门控（本 PR 新增公开接口）。
6. 之前遗留的 V2.7 原型确认等事项仍有效（见下文）。

---

## 本轮（2026-11-24 · 上午）· Phase 0（分支 `chore/phase0-ci-and-frontend-tests`）

### Phase 0：工程化闸门 + 记忆曲线修复 + 点按手感审计

**当前阶段**：在 V2.4 基础上进入「vmark 式工程流程」Phase 0——H5 为主目标、weapp 次之。本轮只做工程化、逻辑修复与原型，**未改任何前端视觉样式**（样式提案见 V2.7 原型，待用户确认）。

### 本轮做了什么
1. **CI**：`.github/workflows/ci.yml`（`pull_request` + push `main`，`concurrency` 取消旧运行）。backend：uv + Python 3.12 → `uv sync --frozen` → `ruff` → `pytest`；frontend：pnpm（`packageManager: pnpm@10.20.0`）+ Node 22 → `install --frozen-lockfile` → `lint` → `typecheck` → `test:coverage` → `build:h5` / `build:weapp`（占位 `TARO_APP_API_BASE_URL=https://api.example.com` + `TARO_APP_ALLOW_PLACEHOLDER_API=1`），依赖缓存。
2. **前端测试基建**：Vitest 3 + jsdom + Testing Library + coverage-v8；`test/mocks/taro.ts`、`test/mocks/components.tsx` 替身（globalThis 单例，支持 `vi.resetModules()` 重新加载有模块级状态的服务）；时区固定 `Asia/Shanghai`。脚本：`test` / `test:watch` / `test:coverage` / `lint` / `check:all`。ESLint 9 flat config（`react-hooks/rules-of-hooks: error`，已验证能拦住 #310 那类「早 return 后调用 Hook」）。
3. **测试**：`api.ts`（BASE_URL/Bearer、业务错误、404、4010 静默重登重放、重登失败不无限重试、无登录通道直接抛错、任务/报告轮询完成/失败/超时/取消）、`backgroundQuizManager.ts`（订阅即推送、退订、反复订阅不累积监听器、running→计时→阶段文案→completed、停留发起页自动跳转、运行中防重复、失败停表、失败后可重发）、`quizSessionStore.ts`、`v2Adapters.ts`、`RetentionCurveCanvas` / `SevenDayRhythmBar` 抽出的纯数据层 `chartModel.ts` / `rhythmModel.ts`（绘制与 DOM 输出保持不变）、`config/apiBaseUrl.ts`。覆盖率阈值（仅统计被测逻辑文件）：lines/statements 70、functions 70、branches 70，当前 81.25 / 81.25 / 78.48 / 81.08。
4. **生产构建 fail-fast**（HANDOFF §4-1）：`frontend/config/apiBaseUrl.ts`，缺失 / 非 https / 占位域名直接中止构建；已实测 3 种失败场景退出码 1、占位放行后两端构建成功。
5. **Git hooks**：`.githooks/pre-commit`（暂存前端文件 ESLint + tsc、后端 ruff、拦截 `.env` 与 `backend/data/`）、`.githooks/pre-push`（`pnpm check:all` + ruff + pytest）；`bash scripts/setup-git-hooks.sh` 启用（本沙箱克隆已启用并实际触发过）。
6. **AI 配置**：`AGENTS.md` 声明为唯一事实来源并新增「质量闸门」；`CLAUDE.md` 仅 `@AGENTS.md`；中文 PR 模板与 bug / feature Issue 模板。
7. **修复「学习记忆曲线每天看起来一样」**（`fix(mastery)`，含前后端回归测试）：
   - 后端根因①：总览态「若巩固」= `max(今日+8, 掌握分×0.55+44)`，今日保持率低于约 `掌握分×0.55+36` 后，右半段（若巩固 / +3 / +7 / +14 天）只由静态掌握分决定，日日相同 → 改为锚定今日实时保持率：`今日 + (100-今日) × (0.35 + 0.4×掌握分/100)`。
   - 后端根因②：「全部域」视图左段取全局最近测验、右段却是 focus 域保持率 → 历史改按 focus 域查询。
   - 前端根因③：`/mastery/overview` 任意失败（含生产 H5 无登录）都静默回退 `buildFallbackMasteryOverview`，其曲线（92/74/58/46/…/72/60）与周节律柱高（48/64/35/78…）都是写死的 → 改为由真实历史推算（实测节点 → e^(-t/S) 衰减到今天 → 投影），无历史时返回空曲线。
   - 前端根因④：`buildRealCalendarStrip` 用 `toISOString()`（UTC），北京时间 0~8 点日期错一天 → 改本地日期。
8. **点按手感审计 + V2.7 原型**：[`docs/02-design/tap-feel-audit.md`](02-design/tap-feel-audit.md)、[`v27-tap-feel-and-retention-curve.html`](02-design/prototypes/v27-tap-feel-and-retention-curve.html)（**待用户确认**，确认前不改 `frontend/` 样式）。
9. 顺带：修复 `backend/app/llm/langchain_factory.py` 的 ruff I001（main 上 `ruff check` 原本是失败的）。

### 实际执行的命令与结果（2026-11-24，本沙箱 Linux / Node 22.23 / Python 3.12.16 / uv 0.13.9 / pnpm 10.20.0）
- `cd backend && uv run ruff check app tests` → `All checks passed!`
- `cd backend && uv run pytest -q` → **`199 passed`**（原 193 + 新增 `tests/test_mastery_curve_daily_variation.py` 6 个；其中 3 个在修复前实测失败）
- `cd frontend && pnpm install --frozen-lockfile` → 成功
- `pnpm lint` → `0 errors, 4 warnings`（均为既有页面 `react-hooks/exhaustive-deps` 警告，未改页面代码）
- `pnpm typecheck` → 通过
- `pnpm test:coverage` → **`7 files / 77 passed`**，覆盖率达阈值
- `TARO_APP_API_BASE_URL=https://api.example.com TARO_APP_ALLOW_PLACEHOLDER_API=1 pnpm build:h5` / `pnpm build:weapp` → 均退出码 0（注：本沙箱 `frontend/dist/` 现为占位地址的生产包，本地调试请重新 `pnpm build:weapp:local`）
- `.githooks/pre-push` 手动全量执行 → 通过；之后的提交均经 `pre-commit` 实际触发
- 原型：Playwright（headless Chromium）打开 V2.7 原型截图检查，`pageerror` / console error 为 0
- **未实机验证**：未启动 FastAPI / MySQL / Redis / Chroma，曲线修复只经单元测试与 mock 验证，未在真实账号数据上逐日观察；点按审计为 SCSS 静态推算，未在 iOS Safari / Android / 微信真机测量；GitHub Actions 工作流未在 GitHub 上实际运行过（无推送凭据）。

### 未决事项 / 下一步
1. **请用户确认 V2.7 原型**（点按手感 + 记忆曲线时间轴重设计），确认后按审计「三、修复提案」落地 `usePressable` / 热区 / 曲线新布局，并补 Playwright 热区 ≥44px 断言。
2. ~~**H5 生产登录方案（需用户决策）**~~（2026-11-24 已决：邮箱验证码登录，见本文件顶部）：生产 H5 没有任何登录通道（只有 weapp `wx.login` 与 dev-login），H5 作为主目标上线前必须定方案；涉及鉴权范围，按规则先问用户。
3. `SevenDayRhythmBar` 周均虚线内联 px 与柱子设计稿 px 单位不一致（位置约偏高 1 倍），随 V2.7 原型一起确认后修。
4. 后端 `live_retention = 100·e^(-t/S)` 不考虑交卷时的 `retention_rate`（刚交卷恒为 100%），是否改为 `retention_rate·e^(-t/S)` 属模型口径，待确认。
5. `inferDomainFromText` 关键词 `词` 过宽（「唐诗宋词」会被归到「核心英语」），待产品确认关键词表。
6. 4 条既有 `exhaustive-deps` 警告、`api.ts` 覆盖率 59% 可在后续逐步收紧；推送后在 GitHub 上确认 CI 首次运行结果。

---

## 上一轮（2026-11-12）· V2.4

### 当前阶段（V2.4）

**`zhixing-quiz` V2.4（在 V2.3 基础上完成「后端全链路 5 段耗时 + 流式首字 TTFT / 中途断流自动重连监控与诊断压测脚本」、「等待文案移除『可逛其他页』与首页双重计时去重 + 跨页 `originTag` 精准隔离」、以及「曲线页重构为纯洞察看板 + 至多 1 枚轻重练入口」）已完成原型门控确认、前后端实现、双端编译与 Playwright 全流程验收。**

### 已完成核心改造

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

### 已执行的真实校验（2026-11-12，基于 V2.4 最终代码重跑）

- **后端静态检查、单测与实时 3 组对照监控**：
  - `cd /Users/leileigwl/Work/Learn/new/zhixing-quiz/backend && uv run ruff check app tests` -> **`All checks passed!`**
  - `cd /Users/leileigwl/Work/Learn/new/zhixing-quiz/backend && uv run pytest -q` -> **`191 passed`**（含 V2.4 TTFT 假死重试与 `QuizTaskTelemetry` 透传测试）。
  - `uv run python scripts/monitor_quiz_latency.py` 实测 3 组全部 `completed`：分布式锁 3 题·联网 `73.07s`（`20.9 tok/s`）、RAG 检索 3 题·纯 LLM `50.21s`（`20.1 tok/s`）、HTTP/3 自适应 6 题·联网 `89.65s`（`21.8 tok/s`）。
- **双端编译与 Playwright 移动端 H5 V2.4 E2E（`375×812` & `390×844`）**：
  - `pnpm typecheck`、`NODE_ENV=development pnpm build:h5` 与 `pnpm build:weapp:local` 均退出码 `0`（`frontend/dist/` 保留最新微信小程序构建产物，含独立 `dist/custom-tab-bar/index.wxss`）。
  - Playwright 实测：首页等待中不渲染重复 `.bg-pill` 且按钮只显示 `出题中 (Xs)`、切换至口袋页时文档按钮维持 `出题 →` 且悬浮胶囊实时展示 `AI 正在编排 3 道题目...`、曲线页 `.schedule-go=0` / `.btn-secondary-ai=0` / `.zx-btn-obsidian=0` 且仅有 `1` 枚标题旁轻重练胶囊、`PAGE_ERRORS: 0`、`CONSOLE_ERRORS: 0`、`HTTP_ERRORS: 0`。

### 本地已启动服务状态（2026-11-12 开发机记录，本轮沙箱未启动这些服务）

- `zhixing-quiz-mysql-1` (`127.0.0.1:3306`, Healthy) & `zhixing-quiz-redis-1` (`127.0.0.1:6379`, Healthy)
- Standalone Chroma HTTP Server (`127.0.0.1:8001`)
- ARQ Worker (`uv run arq app.workers.arq_worker.WorkerSettings`)
- FastAPI 2-Worker API (`http://127.0.0.1:8000`) & Taro H5 Dev Server (`http://127.0.0.1:10086`)

### 尚待生产部署确认项

- 本机 `.env` 已配置真实 LLM、Embedding 与 Tavily 联网搜索配置；若在微信真机启用一次性订阅消息提醒，仍需在 `.env` 填入 `WECHAT_SUBSCRIBE_TEMPLATE_ID`、`WECHAT_APP_ID` / `WECHAT_APP_SECRET` 并在微信开发者工具打开 `frontend/dist/` 做真机测试；若需使用 Endor 云端漏洞审计，请先在本机安装并登录 `endorctl`。
