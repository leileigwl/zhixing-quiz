# Session handoff：交接清单

> 最后更新：2026-11-11

## 当前阶段

**Phase 1–5 本地全栈构建、真实 MySQL 8.0 + Chroma + 硅基流动大模型全链路联调，以及 H5 5 屏真浏览器交互与 UI 对齐验收均已完成并通过；当前后端（`:8000`）与 H5 前端（`:10086`）常驻运行中，可直接打开浏览器查验，后续仅余微信开发者工具真机预览与云主机 1Panel 上线部署。**

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

- **真实基础设施**：OrbStack `zhixing-quiz-mysql-1`（MySQL 8.0）容器运行正常（`Up` / `healthy`），7 张表 `answer_records`、`image_generation_logs`、`kb_documents`、`quiz_sessions`、`quiz_tasks`、`reports`、`users` 已建表。
- **后端静态检查与单测**：
  - `cd /Users/leileigwl/Work/Learn/new/zhixing-quiz/backend && uv run ruff check app tests`：**`All checks passed!`**
  - `cd /Users/leileigwl/Work/Learn/new/zhixing-quiz/backend && uv run pytest`：**20 个测试文件共 154 个用例全部通过**（`154 passed, 1 warning`；单测层使用 Mock 隔离外部网络/数据库）。
  - `docker compose config -q`：**通过**。
- **真实全链路 API 端到端集成测试（无 Mock，连接真实 MySQL + Chroma + 硅基流动 DeepSeek-V3 & BAAI/bge-m3）**：
  - 验证未携带 JWT 访问 `/api/v1/user/profile` 返回 `401` (`code: 4010`) 拦截成功；
  - 验证 `dev-login` 签发 JWT、`GET/PUT /user/profile`、`POST /knowledge/documents` 上传 Markdown 文档并用 `BAAI/bge-m3` 写入 Chroma 至 `ready`、基于文档 RAG 与自由主题两条路径异步出题 + 2 秒轮询完成、跨用户查询他人任务/文档返回 `403`/`400` 隔离拦截、提交答卷生成 AI 复盘报告并增加 XP、查询历史与详情、以及 `DELETE /knowledge/documents/{doc_id}` 删除清理全部通过。
- **前端构建与真浏览器 5 屏 UI/交互全链路测试**：
  - `cd /Users/leileigwl/Work/Learn/new/zhixing-quiz/frontend && pnpm typecheck`：**通过**（0 TS 错误）。
  - `cd /Users/leileigwl/Work/Learn/new/zhixing-quiz/frontend && pnpm build:weapp`：**通过**（编译输出至 `frontend/dist/`）。
  - Playwright + 本机 Google Chrome（`390×844` 移动端视口，`2x` DPR）实测 `http://localhost:10086`：走通“首页快捷主题填充 & 开关交互 → 知识库上传 Markdown 等候 `已就绪` → 发起 RAG 闯关出题 → 逐题作答展开解析 → AI 复盘报告与题目回顾 → 返回首页核验实时 XP 增长与最近记录 → 我的页面 KPI/历史/昵称修改与还原”。
  - 全程 5 屏 **0 Console Error、0 Page Error、0 API >=400 错误、0 横向溢出（`scrollWidth === 390`）**，视觉布局经逐屏截图核验与设计稿一致。

## 本地已启动的查看入口

- **H5 前端预览**：`http://localhost:10086`（`pnpm dev:h5` Watch 模式后台运行中）
- **FastAPI 后端健康检查 & Swagger 文档**：`http://127.0.0.1:8000/api/v1/health` / `http://127.0.0.1:8000/docs`（`uv run uvicorn app.main:app` 后台运行中）
- **MySQL 8.0 容器**：`zhixing-quiz-mysql-1`（`127.0.0.1:3306`）

## 尚待用户实机/生产确认项

- **微信开发者工具真机预览**：使用微信开发者工具导入 [`frontend/`](../frontend)，勾选「不校验合法域名」即可调用本地 `http://localhost:8000/api/v1` 并实测 `wx.login`（需在 `backend/.env` 配置真实 `WECHAT_APP_ID` / `WECHAT_APP_SECRET`）。
- **云端生产部署**：按 [`docker-compose.yml`](../docker-compose.yml) 在云主机 1Panel 部署时设置 `APP_ENV=production`、32 位以上随机 `JWT_SECRET`、`ALLOW_DEV_LOGIN=false` 及 HTTPS 域名反代，再用 `TARO_APP_API_BASE_URL=https://你的域名/api/v1 pnpm build:weapp` 构建体验版。
