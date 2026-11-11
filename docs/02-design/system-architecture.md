# 知行快刷｜系统架构、目录结构与接口设计

> 本文档为 [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) 的 V2.0 工程细化说明书，包含完整文件树、MySQL 12 表结构、REST API 契约（含知识掌握图谱与 SM-2 错题复习端点）与并发安全加固细节。

---

## 1. 目标仓库完整目录树

```text
/Users/leileigwl/Work/Learn/new/zhixing-quiz/
├── AGENTS.md                           # AI 工作规则总入口（先读谁、怎么改、何时问、如何交接）
├── README.md                           # 项目简介、本地与 Docker 启动命令、文档索引
├── .gitignore                          # 排除 .venv, .env, data/, node_modules, dist/
├── docker-compose.yml                  # V2 一键编排：mysql:8.0 + redis:7-alpine + chroma(:8001) + api(--workers 2) + worker(arq)
│
├── docs/
│   ├── PRODUCT.md                      # 产品边界宪法（包含项 / 排除项 / 核心操作）
│   ├── ARCHITECTURE.md                 # 技术与安全约束（部署图 / 分层 / 禁引入清单）
│   ├── session-handoff.md              # 连续性交接清单（每轮更新进度、真实校验结果与下一步）
│   ├── 01-product/
│   │   └── PRD.md                      # 详细产品需求文档
│   ├── 02-design/
│   │   ├── system-architecture.md      # 本文档：完整工程目录、DB/API 契约
│   │   ├── v2-architecture-and-rationale.md # V2 技术选型白皮书
│   │   ├── v2-ui-design-system.md      # MOVEPOP 方案 B 视觉与组件规范
│   │   └── prototypes/
│   │       └── v2-editorial-3palettes.html # 三套高净度交互定调原型
│   └── 99-archive/                     # 过时资料归档
│
├── backend/                            # Python 3.12 后端服务（uv 管理）
│   ├── pyproject.toml                  # 依赖声明（含 redis / arq）、pytest 与 ruff 配置
│   ├── uv.lock                         # uv 锁定精确版本号
│   ├── Dockerfile                      # 基于 uv / python:3.12-slim 的多 Worker/ARQ/Chroma 镜像
│   ├── .env.example                    # 完整环境变量模板（含 Redis/Chroma/ARQ/微信订阅模板 ID）
│   ├── scripts/
│   │   └── init_mysql.py               # 手动建库建表入口
│   ├── tests/                          # Pytest 测试集（含 V2 自适应/SM-2/LCEL/Lua限流单测）
│   └── app/
│       ├── main.py                     # FastAPI 入口：安全自检、MySQL/Redis/ARQ 生命周期、全路由挂载
│       ├── workers/
│       │   └── arq_worker.py           # 独立 ARQ Worker + 每小时 Cron 复习扫表
│       ├── api/v1/routes/
│       │   ├── health.py               # GET /api/v1/health
│       │   ├── user.py                 # login / dev-login / profile / quizzes
│       │   ├── knowledge.py            # documents CRUD + status
│       │   ├── quiz.py                 # generate / generate/async / task/{task_id} / {quiz_id}/images
│       │   ├── report.py               # submit / {quiz_id} / generate
│       │   ├── mastery.py              # GET /api/v1/mastery/overview
│       │   └── reviews.py              # GET /reviews/due + POST /reviews/mark + POST /reviews/subscribe
│       ├── core/
│       │   ├── config.py               # Settings + validate_runtime_security()
│       │   ├── db.py                   # aiomysql 连接池、GET_LOCK、12 表 DDL/回填、recover_stale_jobs()
│       │   ├── redis_client.py         # Redis 异步连接池、ARQ Pool、60s JSON 缓存
│       │   ├── auth.py                 # HS256 JWT 签发、解析、get_current_user
│       │   ├── rate_limit.py           # Redis Lua 原子滑动窗口限流器（离线降级本地）
│       │   ├── security.py             # 敏感词过滤
│       │   └── exceptions.py           # 统一业务异常
│       ├── models/                     # Pydantic v2 请求与响应模型（含 mastery.py）
│       ├── llm/                        # 大模型调用层（extract_json_object / langchain_factory）
│       ├── prompts/                    # V2 Prompt 模板层
│       ├── repositories/               # MySQL 异步 SQL 与 FOR UPDATE 事务仓储（含 mastery_repository）
│       └── services/                   # 业务编排（含 adaptive/domain_classifier/mastery/review/LCEL rag&search）
│
└── frontend/                           # Taro 4 + React 18 + TS（MOVEPOP 方案 B）
    ├── config/                         # dist-h5(hash) 与 dist(weapp) 双输出隔离
    └── src/
        ├── custom-tab-bar/             # 微信小程序端自定义悬浮黑曜石胶囊 Dock
        ├── components/                 # FloatingDock / GeometricProp / RetentionCurveCanvas / SevenDayRhythmBar
        ├── services/                   # api.ts / quizSessionStore.ts / v2Adapters.ts
        └── pages/                      # index / knowledge / mastery / profile / quiz / report
```

---

## 2. 既有项目可复用文件移植对照表

数据源：[`yu-ai-learn-main`](file:///Users/leileigwl/Work/Learn/AI%20%E9%97%AF%E5%85%B3%E5%AD%A6%E4%B9%A0%E5%B0%8F%E7%A8%8B%E5%BA%8F%E9%A1%B9%E7%9B%AE/yu-ai-learn-main)

| 处理类别 | 源文件路径 | 落地处理说明 |
| --- | --- | --- |
| **直接移植** | `services/{document_loader_service,scoring_service,history_service,report_service}.py`<br>`prompts/*.py`、`models/{common,knowledge,quiz,report}.py`<br>`repositories/{user,knowledge,quiz,image}_repository.py`<br>`core/security.py`、`utils/id_generator.py` | 核心逻辑、SQL 与 Prompt 已验证稳定，直接移植并清理教程品牌注释。 |
| **移植并抽共用 helper** | `llm/{quiz_chain,report_chain}.py` | 将重复的 `_extract_json` 抽到 `llm/json_utils.py`，消除重复代码。 |
| **适配多模型 & 阻塞保护** | `core/config.py`、`llm/langchain_factory.py`、`services/vector_store_service.py`、`services/knowledge_service.py` | 支持通用 `LLM_*`/`EMBEDDING_*` 并兼容 `DEEPSEEK_*`/`DASHSCOPE_*`；保留 `check_embedding_ctx_length=False`；文件加载与 Chroma 写入包进 `asyncio.to_thread`。 |
| **安全与生产级加固** | `core/{auth,db,exceptions}.py`、`repositories/task_repository.py`、`services/{user,quiz,search,rag,cos,image}_service.py`、`api/v1/routes/*.py`、`main.py` | ① `APP_ENV=production` 强校验 `JWT_SECRET` 长度与非默认值；② 禁用生产 `dev-login`；③ 全站 AI 路由接入 `get_current_user` + `task_id` 归属检查 + 滑动窗口限流；④ 重启自愈卡死任务/文档；⑤ 无 COS 时降级静态托管。 |
| **彻底重做（待原型确认）** | `frontend/src/**`、`frontend/config/prod.ts` | Phase 2 确认 HTML 原型图后重写 UI 样式、3 Tab 架构、本地题库会话缓存、4010 自动静默重登及 H5 上传兼容。 |

---

## 3. JWT 鉴权与生产安全细节

1. **Token 结构与校验 (`app/core/auth.py`)**：
   - Payload 字段：`{"user_id": int, "openid": str, "token_type": "access", "iat": timestamp, "exp": timestamp}`，使用 `HS256` 签名。
   - `get_current_user` 解析 JWT 后，当数据库连接池处于活跃状态时自动校验 `user_repository.get_user_by_id(user_id)`，避免删库重建后旧 Token 触发外键 500 错误（若在纯 Mock 单元测试下无连接池，则直接返回 `user_id` 保持测试轻量）。
2. **环境隔离门禁 (`app/core/config.py`)**：
   - 启动阶段自动调用 `validate_runtime_security()`：当 `APP_ENV=production` 时，若 `jwt_secret` 为默认值或 `< 32` 字符，直接阻断启动。
   - `POST /api/v1/user/dev-login` 仅当 `app_env != "production"` 且 `allow_dev_login=True` 时可用。
3. **接口归属与防刷保护**：
   - `GET /api/v1/quiz/task/{task_id}` 强制要求 `row["user_id"] == current_user_id`，防止他人猜测 `task_id` 越权窃取题库。
   - `POST /api/v1/quiz/generate` 与 `/quiz/generate/async` 绑定用户级滑动窗口限流（默认每分钟 `5` 次）。

---

## 4. 数据库表结构（MySQL 8.0 · 12 张表）

| 表名 | 核心用途 | 主键 / 唯一键 / 外键 |
| --- | --- | --- |
| `users` | 用户、累计 XP 与连续打卡 (`streak_days/last_practice_date`) | `id`, `UNIQUE(openid)` |
| `domains` | 用户知识域归类、色标与文档计数 | `id`, `UNIQUE(user_id, name)`, `FK(user_id -> users.id)` |
| `kb_documents` | 私有文档状态、所属领域与分块数量 | `id`, `UNIQUE(doc_id)`, `FK(user_id -> users.id)` |
| `quiz_sessions` | 生成的题库快照、`domain_id/domain_name/source_type` 与配图状态 | `id`, `UNIQUE(quiz_id)`, `FK(user_id -> users.id)` |
| `questions` | 规范化单题表（支持错题巩固快速联查题干与考点） | `id`, `UNIQUE(question_uid)`, `IDX(quiz_id, domain_id)` |
| `answer_records` | 答题明细与正确率（含 `mark_review`） | `id`, `UNIQUE(quiz_id)`, `FK(quiz_id -> quiz_sessions.quiz_id)` |
| `reports` | AI 复盘报告 JSON 与生成状态 | `id`, `UNIQUE(quiz_id)`, `FK(quiz_id -> quiz_sessions.quiz_id)` |
| `quiz_tasks` | 异步出题状态、阶段 (`stage`) 与自适应参数 | `id`, `UNIQUE(task_id)`, `IDX(user_id, status)` |
| `image_generation_logs` | 题目配图每日额度审计 | `id`, `IDX(user_id, created_at)` |
| `user_knowledge_mastery` | 三维难度正确率 (E/M/H)、稳定性 `S`、即时保持率与熟练度自评 | `id`, `UNIQUE(user_id, domain_id)` |
| `review_cards` | SM-2 间隔重复错题卡 (`ef/interval_days/repetitions/status/next_review_at`) | `id`, `UNIQUE(user_id, question_uid)`, `IDX(user_id, status, next_review_at)` |
| `subscribe_quotas` | 微信一次性订阅消息提醒配额与偏好小时 | `id`, `UNIQUE(user_id, template_id)` |

---

## 5. REST API 契约表（前缀 `/api/v1`）

| 路由 | 方法 | 鉴权 | 限流 / 归属校验 | 作用 |
| --- | --- | --- | --- | --- |
| `/health` | `GET` | 公开 | 无 | 探活与容器健康检查 |
| `/user/login` | `POST` | 公开 | 调微信 `jscode2session` | 微信小程序静默登录签发 JWT |
| `/user/dev-login` | `POST` | 公开（仅非生产 + 开关） | 生产环境 403 禁用 | H5/本地开发模拟登录 |
| `/user/profile` | `GET` / `PUT` | 必选 JWT | 仅本人 | 获取统计档案（含 `streak_days`）/ 更新昵称头像 |
| `/user/quizzes` | `GET` | 必选 JWT | 仅本人 | 分页获取历史闯关记录（含领域与来源标签） |
| `/user/quizzes/{quiz_id}` | `GET` | 必选 JWT | 校验 `user_id` | 回看单次题库、答卷与报告 |
| `/knowledge/documents` | `POST` / `GET` | 必选 JWT | 10MB / 10 篇 + 防压缩炸弹 | 上传异步入 ARQ + Chroma HTTP 解析 / 列表 |
| `/knowledge/documents/{doc_id}` | `GET` / `DELETE` | 必选 JWT | 校验 `user_id` | 轮询解析状态与自动归类领域 / 级联删除 |
| `/quiz/generate/async` | `POST` | 必选 JWT | **Redis Lua 限流** + 校验 `doc_id` | 创建自适应异步出题任务并入 ARQ 队列 |
| `/quiz/task/{task_id}` | `GET` | 必选 JWT | **校验任务归属 `user_id`** | 轮询任务阶段与完整出题结果 (`recommended_count/source_type/domain`) |
| `/quiz/{quiz_id}/images` | `GET` | 必选 JWT | **校验测验归属 `user_id`** | 轮询题目后台异步配图 URL |
| `/quiz/generate` | `POST` | 必选 JWT | Redis Lua 限流 + 校验 `doc_id` | 同步出题 |
| `/report/submit` | `POST` | 必选 JWT | **校验归属 + 单事务防并发覆盖 + SM-2** | 秒返算分、更新三维画像与打卡、创建错题卡与 ARQ `_defer_by` |
| `/report/{quiz_id}` | `GET` | 必选 JWT | **校验测验归属 `user_id`** | 轮询 AI 复盘报告生成状态与内容 |
| `/report/generate` | `POST` | 必选 JWT | 归属当前用户 + 幂等 | 同步报告接口（向后兼容） |
| `/mastery/overview` | `GET` | 必选 JWT | 仅本人（60s Redis 缓存） | 获取学习记忆曲线、三维矩阵、7 日节律与未来 7 天到期预测 |
| `/reviews/due` | `GET` | 必选 JWT | 仅本人 | 获取当前到期 SM-2 错题/巩固列表 |
| `/reviews/mark` | `POST` | 必选 JWT | **校验 `quiz_id` 归属** | 手动加入待复习 (`add`) 或标记已掌握毕业 (`skip`) |
| `/reviews/subscribe` | `POST` | 必选 JWT | 仅本人 | 登记微信订阅消息推送配额与提醒时段 |
