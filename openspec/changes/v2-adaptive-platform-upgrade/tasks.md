# Tasks

> **执行纪律**：按「原型图片审阅 → 前端参数确认与页面实现 → 基础设施演进 → 后端 AI 与队列改造 → 全链路压测联调」严格分期推进。V2.0 全部 4 个阶段已完成开发、联调、Skill 安全/架构复核与多进程实测收口。

## 0. 立项重塑、架构规划图与原型确认门控

- [x] 0.1 产出 V2 立项与技术选型论证白皮书 [`docs/02-design/v2-architecture-and-rationale.md`](../../docs/02-design/v2-architecture-and-rationale.md)，明确 Redis+ARQ 队列权衡、ReAct vs LCEL 意图路由、12 表 ER 演进与自适应公式。
- [x] 0.2 完成高净度极简三套定调方案 [`v2-editorial-3palettes.html`](../../docs/02-design/prototypes/v2-editorial-3palettes.html) 导出审阅并由用户拍板定稿 **方案 B（`MOVEPOP` 暖石膏 × 奶油黄 × 雾天蓝）**，沉淀组件与排版速查表 [`docs/02-design/v2-ui-design-system.md`](../../docs/02-design/v2-ui-design-system.md)。

## 1. 前端交互与极简高净度 UI 先行升级（严格对照方案 B 规范）

- [x] 1.1 更新 `frontend/src/services/api.ts` 与状态存储：对接冷启动自评参数、`question_count`（倒 U 智能推荐或 `3/5/10/15`）、DeepSeek 式 `enable_web_search` 显式开关、知识域自动分类列表、学习记忆曲线与每周节律接口及错题复习订阅接口（无会员体系）。
- [x] 1.2 对照 [`docs/02-design/v2-ui-design-system.md`](../../docs/02-design/v2-ui-design-system.md) 升级 `frontend/src/pages/{index,knowledge,quiz,report}/index.tsx` 与底部黑曜石悬浮胶囊 Dock：实现首页 7 日节律条、双卡 Bento（`04 错题` 奶油黄 + `当前主攻域` 雾天蓝）、出题输入舱（DeepSeek 胶囊行与 `seg-bar` 独立分行防折行）、知识库 `DAYPATCH` 磨砂半透明口袋、答题页「`‹ 上一题`」只读回看与 220ms 展解析缓冲、复盘页「`学习记忆曲线 R(t)` + 本周 7 日节律柱图」（统一使用层叠几何微缩图标）；必要时借助 `context7` 核验 Taro 4 API 与 `mobbin` 复核真机交互，完成 `pnpm typecheck` 与浏览器全屏无报错核验。

## 2. 分布式基础设施与数据库 V2 演进

- [x] 2.1 更新 `docker-compose.yml` 与 `backend/pyproject.toml`：引入 `redis:7`、`chromadb/chroma` 独立 HTTP 容器与 `arq` Worker 服务配置，升级 `config.py` 支持 `REDIS_URL`、`CHROMA_HOST/PORT`、微信小程序订阅模板 ID，允许 FastAPI API 切换多 Worker 启动模式。
- [x] 2.2 更新 `backend/app/core/db.py` 与新增仓储层：基于 `INFORMATION_SCHEMA` 幂等扩建 `domains`、`questions`、`user_knowledge_mastery`、`review_cards`、`subscribe_quotas` 5 张新表及现有表扩展列，编写历史 `quiz_sessions` 回填兼容迁移逻辑并补全单元测试。
- [x] 2.3 实现分布式限流器、Redis 画像缓存与 ARQ Worker 框架（`app/workers/`）：替代单机内存限流器与 `_background_tasks`，支持出题/向量化/AI归类/配图/复盘入队执行与任务状态同步。

## 3. 后端 AI 路由、自适应引擎与延迟错题召回

- [x] 3.1 重构 `rag_service.py` / `search_service.py` 为可控 LCEL `RunnableBranch` 意图路由：移除慢速 `create_react_agent` 循环，支持按需触发 Tavily、直接 Chroma HTTP 向量检索与 DeepSeek 直出，并在结果标注 `source_type`。
- [x] 3.2 实现 AI 自动领域归类服务与画像自适应决策器（`adaptive_service.py`）：上传文档/出题自动归并到 `domains`，出题前基于 `user_knowledge_mastery`（含冷启动 `self_rated_level`）与遗忘保持率计算推荐题量与 E/M/H 配比，并校验 `question_count` 上限扩展至 15。
- [x] 3.3 实现 SM-2 错题复习引擎与 ARQ 延迟召回（`review_service.py`）：交卷即更新单题 `review_cards` 与三维掌握画像、投递 ARQ `_defer_by` 延迟激活任务 + 每小时 Cron 补偿扫表任务，对接微信订阅消息发送与配额扣减；实现 `GET /api/v1/mastery/overview` 供图谱页消费。

## 4. 全链路联调、上线前安全审计（Skill 门控）与文档收口

- [x] 4.1 跑通 Redis + ARQ + 独立 Chroma + 多 Worker FastAPI + MySQL 全链路集成测试与 Playwright / `source-command-e2e` 移动端闭环测试（验证自适应出题、上一题回看、学习记忆曲线渲染与重复交卷/防并发竞态）。
- [x] 4.2 上线前后端质量与安全审计门控：触发 `source-command-python-review`、`review-security` / `cs-audit` 与 `endor-labs-agent-kit`（`sca-remediation` / `ai-sast-remediation` / `cicd-posture`），重点核查 JWT 鉴权防越权、PDF/Word/MD 上传解析注入与体积限制、Redis/ARQ 幂等、`.env`/密钥防泄露及依赖 CVE。
- [x] 4.3 同步更新 `docs/ARCHITECTURE.md`、`docs/02-design/system-architecture.md` 与 `docs/session-handoff.md`，验证 `uv run ruff check app tests && uv run pytest` 与 `pnpm build:weapp:local` 全绿并执行 Git 提交与 OpenSpec 归档。
