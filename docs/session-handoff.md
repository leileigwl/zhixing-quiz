# Session handoff：交接清单

> 最后更新：2026-11-11

## 当前阶段

**OpenSpec 变更 [`async-pipeline-and-kb-upgrade`](../openspec/changes/async-pipeline-and-kb-upgrade/proposal.md)（MySQL 8.0 幂等列迁移与自愈 + 异步出题阶段进度与文字先出/配图后台补齐 + 服务端重判/XP 幂等/秒返算分与异步 AI 复盘 + 知识库 GBK/UTF-8-SIG 多编码解析、Markdown 章节切分、Chroma 并发锁与分批写入、非阻塞 `asyncio.to_thread` RAG + 前端 H5/微信小程序渐进式交互）已全部开发完成并完成真库/大模型/浏览器端到端验收；当前后端（`:8000`）与 H5 前端（`:10086`）常驻运行，`frontend/dist/` 已构建指向 `http://127.0.0.1:8000/api/v1` 的本地微信开发者工具调试包。**

## 已完成事项

1. **工程文档与原型归档**：
   - [`AGENTS.md`](../AGENTS.md)、[`docs/PRODUCT.md`](PRODUCT.md)、[`docs/ARCHITECTURE.md`](ARCHITECTURE.md)、[`docs/01-product/PRD.md`](01-product/PRD.md)、[`docs/02-design/system-architecture.md`](02-design/system-architecture.md)。
   - 用户 UI 参考图归档于 [`docs/99-archive/references/ui-reference-v1.jpg`](99-archive/references/ui-reference-v1.jpg)，交互式 5 屏原型图位于 [`docs/02-design/prototypes/zhixing-quiz-prototype.html`](02-design/prototypes/zhixing-quiz-prototype.html)。
2. **后端服务（[`backend/`](../backend) + [`docker-compose.yml`](../docker-compose.yml)）**：
   - `uv` 管理依赖与虚拟环境（`pyproject.toml` + `uv.lock`），本地 `.env` 已配置真实硅基流动 `DeepSeek-V3`（出题/报告）与 `BAAI/bge-m3`（向量入库），OrbStack `zhixing-quiz-mysql-1`（MySQL 8.0，已配置 `+08:00` 时区并自动初始化全部 7 张表）健康运行于 `127.0.0.1:3306`。
   - **联调修复**：[`quiz_repository.py`](../backend/app/repositories/quiz_repository.py) `get_user_quiz_list` 改用 `COALESCE(ar.total_questions, JSON_LENGTH(qs.questions_json), 0)`，确保未交卷记录也能正确显示题数而非 `共 0 题`；[`docker-compose.yml`](../docker-compose.yml) MySQL 增加 `--default-time-zone=+08:00`。
3. **前端服务（[`frontend/`](../frontend)）**：
   - 统一使用 `pnpm` 管理依赖（已生成 `pnpm-lock.yaml`，无 `npm` 产物）；[`package.json`](../frontend/package.json) 修正 `dev:h5` / `dev:weapp` 监听参数并新增 `build:weapp:local`，[`config/index.ts`](../frontend/config/index.ts) 关闭 Taro 4 `prebundle` 规避 pnpm 下 `webpack-dev-server` watch 崩溃，并强制在生产构建校验 `TARO_APP_API_BASE_URL`（禁止误打入 `api.example.com` 占位域名）；[`project.config.json`](../frontend/project.config.json) 关闭本地 `urlCheck`。
   - **联调与 UI 对齐修复**：
     - [`api.ts`](../frontend/src/services/api.ts)：`ensureAuthToken()` 在 `request()` 与文档上传前置阻塞无 token 并发请求并加 `3s` 登录失败冷却防接口风暴；`weapp` 端严格仅走 `Taro.login()` -> `/user/login` 真实微信登录（无 `dev-login` 回落分支），`H5` 仅在开发态使用 `/user/dev-login`；[`config/dev.ts`](../frontend/config/dev.ts) 默认指向 `http://127.0.0.1:8000/api/v1`。
     - [`app.scss`](../frontend/src/app.scss)：修复 `html` `clamp(16Px, 5.3333vw, 22Px)` 及 `:root` 意外覆写 `1rem` 导致的 H5 全局缩放缩小（修复后 `390px` 视口实测 `htmlFontSize = 20.8px`、`textarea = 14.56px`），同时锁定 `taro-textarea-core` 内层文本域字体继承与禁用右下角拖拽缩放手柄。
     - [`api.ts`](../frontend/src/services/api.ts) 与 [`pages/index/index.tsx`](../frontend/src/pages/index/index.tsx)：`request()` 与 `useDidShow()` 在无 token 时等待 `ensureLogin()`，消除首屏并发 `401` 竞态，并保证答题返程实时刷新头部 `XP` 经验徽章。
     - [`pages/report/index.tsx`](../frontend/src/pages/report/index.tsx) 与 [`pages/report/index.scss`](../frontend/src/pages/report/index.scss)：统一报告页卡片纵向间距，补齐答对/答错统计块边框与分栏间距。
     - [`pages/profile/index.tsx`](../frontend/src/pages/profile/index.tsx)：为编辑态/展示态行添加独立 `key` 并阻止点击冒泡，修复“保存昵称后立刻再次触发编辑框”的 React DOM 节点复用问题。

## 已执行的真实校验（2026-11-11，全部基于最终代码重跑确认）

- **真实基础设施**：OrbStack `zhixing-quiz-mysql-1`（MySQL 8.0）容器运行正常（`Up` / `healthy`），已通过重启与二次冷启动验证基于 `INFORMATION_SCHEMA.COLUMNS` 的幂等列迁移（`quiz_tasks.stage`、`quiz_sessions.image_status` / `image_notice`、`reports.status` / `error_message`），存量数据零丢失（`users=5`、`quiz_sessions=9`、`reports=8` 迁移前核验保留）。
- **后端静态检查与单测**：
  - `cd /Users/leileigwl/Work/Learn/new/zhixing-quiz/backend && uv run ruff check app tests`：**`All checks passed!`**
  - `cd /Users/leileigwl/Work/Learn/new/zhixing-quiz/backend && uv run pytest`：**23 个测试文件共 174 个用例全部通过**（`174 passed, 1 warning in 2.11s`；含 `test_db_migrations.py`、`test_async_quiz_pipeline.py`、`test_async_report_and_xp.py` 及 Chroma 并发锁/分批写入/GBK/Markdown/async RAG 等新增测试）。
- **真实全链路 API 端到端集成测试（无 Mock，连接真实 MySQL + Chroma + 硅基流动 LLM & Embedding）**：
  - 验证并发上传 `GBK` `.txt` 与多章节 `# / ## / ###` `.md` 至 `ready`（Chroma `_chroma_init_lock` 修复了多线程并发初始化 `RustBindingsAPI` 竞态问题，`chunk_count` 分别为 `1` 和 `3`）；
  - 验证异步出题实时阶段迁移 `queued -> fetching_context -> generating_quiz -> completed`、文字先就绪且跨用户查询 `/quiz/{quiz_id}/images` 返回 `403`、未配置生图 Key 时后台非阻塞降级至 `image_status=failed` 与友好提示；
  - 验证 `POST /api/v1/report/submit` 约 **15.1ms** 秒返且无视客户端篡改的 `is_correct: true` 严格按标准答案重算 `accuracy`、二次重复提交返回 `already_submitted=True` / `xp_gain=0` 不重复加分、`GET /api/v1/report/{quiz_id}` 跨用户拦截 `403` 并轮询至 `completed`。
- **前端构建与真浏览器 5 屏 UI/交互全链路测试**：
  - `cd /Users/leileigwl/Work/Learn/new/zhixing-quiz/frontend && pnpm typecheck`：**通过**（0 TS 错误）。
  - `cd /Users/leileigwl/Work/Learn/new/zhixing-quiz/frontend && pnpm build:weapp:local`：**通过**（编译输出至 `frontend/dist/`，`dist/common.js` 仅包含 `http://127.0.0.1:8000/api/v1`，无 `api.example.com`）；`NODE_ENV=development pnpm build:h5` 编译通过。
  - Playwright + `chromium_headless_shell`（`390×844` 移动端视口，`2x` DPR）实测 `http://localhost:10086`：覆盖 `Index -> Knowledge -> 异步出题阶段遮罩 -> Quiz 逐题作答 -> Report 秒级算分 + XP(+16 XP) + 异步复盘报告完成 -> Profile 累计 XP/历史同步`。
  - 全程 5 屏 **0 Console Error、0 Page Error、0 HTTP >= 400 错误、0 横向溢出（`scrollWidth=390 === innerWidth=390`）**。

## 本地已启动的查看入口

- **H5 前端预览**：`http://localhost:10086`（`pnpm dev:h5` Watch 模式后台运行中）
- **FastAPI 后端健康检查 & Swagger 文档**：`http://127.0.0.1:8000/api/v1/health` / `http://127.0.0.1:8000/docs`（`uv run uvicorn app.main:app` 后台运行中）
- **MySQL 8.0 容器**：`zhixing-quiz-mysql-1`（`127.0.0.1:3306`）

## 尚待用户实机/生产确认项

- **微信开发者工具真机预览**：使用微信开发者工具导入 [`frontend/`](../frontend)，勾选「不校验合法域名」即可调用本地 `http://localhost:8000/api/v1` 并实测 `wx.login`（需在 `backend/.env` 配置真实 `WECHAT_APP_ID` / `WECHAT_APP_SECRET`）。
- **云端生产部署**：按 [`docker-compose.yml`](../docker-compose.yml) 在云主机 1Panel 部署时设置 `APP_ENV=production`、32 位以上随机 `JWT_SECRET`、`ALLOW_DEV_LOGIN=false` 及 HTTPS 域名反代，再用 `TARO_APP_API_BASE_URL=https://你的域名/api/v1 pnpm build:weapp` 构建体验版。
