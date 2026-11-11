# 知行快刷｜系统架构、目录结构与接口设计

> 本文档为 [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) 的工程细化说明书，包含完整文件树、既有代码逐文件移植清单、MySQL 7 表结构、REST API 契约与 JWT 生产加固细节。

---

## 1. 目标仓库完整目录树

```text
/Users/leileigwl/Work/Learn/new/zhixing-quiz/
├── AGENTS.md                           # AI 工作规则总入口（先读谁、怎么改、何时问、如何交接）
├── README.md                           # 项目简介、本地与 Docker 启动命令、文档索引
├── .gitignore                          # 排除 .venv, .env, data/, node_modules, dist/
├── docker-compose.yml                  # 生产/本地一键编排：mysql:8.0 + api（含数据持久卷与健康检查）
│
├── docs/
│   ├── PRODUCT.md                      # 产品边界宪法（包含项 / 排除项 / 核心操作）
│   ├── ARCHITECTURE.md                 # 技术与安全约束（部署图 / 分层 / 禁引入清单）
│   ├── session-handoff.md              # 连续性交接清单（每轮更新进度、真实校验结果与下一步）
│   ├── 01-product/
│   │   └── PRD.md                      # 详细产品需求文档
│   ├── 02-design/
│   │   ├── system-architecture.md      # 本文档：完整工程目录、DB/API 契约与移植对照表
│   │   └── prototypes/
│   │       └── README.md               # Phase 2 前端原型图存放与确认门控说明
│   └── 99-archive/                     # 过时资料归档
│
├── backend/                            # Python 3.12 后端服务（uv 管理）
│   ├── pyproject.toml                  # 依赖声明、pytest 与 ruff 配置
│   ├── uv.lock                         # uv 锁定精确版本号
│   ├── Dockerfile                      # 基于 uv / python:3.12-slim 的单 Worker 生产镜像
│   ├── .env.example                    # 完整环境变量模板（含生产 JWT 门禁说明）
│   ├── scripts/
│   │   └── init_mysql.py               # 手动建库建表入口
│   ├── tests/                          # 20+ Pytest 测试文件（全 Mock 外部 LLM/COS/微信）
│   │   ├── conftest.py
│   │   ├── test_api.py
│   │   ├── test_auth.py
│   │   ├── test_cos_service.py
│   │   ├── test_document_loader_service.py
│   │   ├── test_image_service.py
│   │   ├── test_knowledge_api.py
│   │   ├── test_knowledge_repository.py
│   │   ├── test_knowledge_service.py
│   │   ├── test_models.py
│   │   ├── test_production_hardening.py  # 新增：生产 JWT 密钥门禁、dev-login 禁令、限流、task 越权、静态降级
│   │   ├── test_prompt_contract.py
│   │   ├── test_quiz_doc_id_integration.py
│   │   ├── test_quiz_image_integration.py
│   │   ├── test_quiz_search_integration.py
│   │   ├── test_rag_service.py
│   │   ├── test_scoring.py
│   │   ├── test_search_service.py
│   │   ├── test_security.py
│   │   ├── test_user_api.py
│   │   └── test_vector_store_service.py
│   └── app/
│       ├── __init__.py
│       ├── main.py                     # FastAPI 入口：安全自检、MySQL 初始化、断电任务回收、/static 托管、异常拦截
│       ├── api/v1/routes/
│       │   ├── health.py               # GET /api/v1/health
│       │   ├── user.py                 # login / dev-login / profile / quizzes
│       │   ├── knowledge.py            # documents CRUD + status
│       │   ├── quiz.py                 # generate / generate/async / task/{task_id}
│       │   └── report.py               # generate
│       ├── core/
│       │   ├── config.py               # Settings + validate_runtime_security()
│       │   ├── db.py                   # aiomysql 连接池、7 表 DDL、recover_stale_jobs()
│       │   ├── auth.py                 # HS256 JWT 签发、解析、get_current_user (含 DB 用户存在性校验)
│       │   ├── rate_limit.py           # 内存滑动窗口限流器（防刷 AI 余额）
│       │   ├── security.py             # 敏感词过滤
│       │   └── exceptions.py           # 统一业务异常
│       ├── models/                     # Pydantic v2 请求与响应模型
│       │   ├── common.py
│       │   ├── user.py
│       │   ├── knowledge.py
│       │   ├── quiz.py
│       │   └── report.py
│       ├── llm/                        # 大模型调用层
│       │   ├── json_utils.py           # 共用 extract_json_object 容错提取器
│       │   ├── langchain_factory.py    # 兼容硅基流动 / DeepSeek / OpenAI 的 ChatOpenAI 工厂
│       │   ├── output_schemas.py
│       │   ├── quiz_chain.py
│       │   └── report_chain.py
│       ├── prompts/                    # Prompt 模板层
│       │   ├── quiz_prompt.py
│       │   ├── report_prompt.py
│       │   ├── rag_prompt.py
│       │   └── search_prompt.py
│       ├── repositories/               # MySQL 数据访问层（纯异步 SQL）
│       │   ├── user_repository.py
│       │   ├── knowledge_repository.py
│       │   ├── quiz_repository.py
│       │   ├── task_repository.py      # get_task 返回 user_id 供归属校验；fail_stale_tasks
│       │   └── image_repository.py
│       ├── services/                   # 业务编排层
│       │   ├── user_service.py
│       │   ├── history_service.py
│       │   ├── document_loader_service.py
│       │   ├── vector_store_service.py
│       │   ├── knowledge_service.py
│       │   ├── search_service.py
│       │   ├── rag_service.py
│       │   ├── quiz_service.py
│       │   ├── scoring_service.py
│       │   ├── report_service.py
│       │   ├── cos_service.py
│       │   └── image_service.py
│       └── utils/
│           └── id_generator.py
│
└── frontend/                           # Taro 4 + React 18 + TS（pnpm 管理，已按确认原型落地）
    ├── package.json                    # pnpm 脚本（dev:h5 / dev:weapp / build:h5 / build:weapp / typecheck）
    ├── pnpm-lock.yaml                  # pnpm 锁定的依赖版本
    ├── project.config.json             # 微信小程序工程配置（miniprogramRoot: dist/）
    ├── tsconfig.json
    ├── babel.config.js
    ├── types/global.d.ts
    ├── config/
    │   ├── index.ts                    # dist-h5(hash) 与 dist(weapp) 双输出隔离
    │   ├── dev.ts
    │   └── prod.ts
    └── src/
        ├── index.html
        ├── app.ts                      # 启动自动静默登录（weapp wx.login / 开发态 H5 dev-login）
        ├── app.config.ts               # 3 个底部 Tab（闯关 / 知识库 / 我的）+ 答题/报告二级页
        ├── app.scss                    # :root, page 全局设计令牌与 H5 响应式基准
        ├── assets/                     # 6 张 81×81 抗锯齿 PNG Tab 图标
        ├── services/
        │   ├── api.ts                  # 请求封装、4010 单飞静默续签、2 秒轮询、H5/微信双端上传
        │   └── quizSessionStore.ts     # 本地题库与答卷缓存（解决 URL 参数过长截断）
        └── pages/
            ├── index/                  # Tab 1：闯关首页
            ├── knowledge/              # Tab 2：私有知识库
            ├── profile/                # Tab 3：我的与历史记录
            ├── quiz/                   # 二级页：知识自测答题
            └── report/                 # 二级页：闯关复盘报告
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

## 4. 数据库表结构（MySQL 8.0 · 7 张表）

| 表名 | 核心用途 | 主键 / 唯一键 / 外键 |
| --- | --- | --- |
| `users` | 用户与累计 XP | `id`, `UNIQUE(openid)` |
| `quiz_sessions` | 生成的题库快照 JSON 与配图状态 (`image_status/image_notice`) | `id`, `UNIQUE(quiz_id)`, `FK(user_id -> users.id ON DELETE SET NULL)` |
| `answer_records` | 答题明细与正确率 | `id`, `UNIQUE(quiz_id)`, `FK(quiz_id -> quiz_sessions.quiz_id ON DELETE CASCADE)` |
| `reports` | AI 复盘报告 JSON 与生成状态 (`status/error_message`) | `id`, `UNIQUE(quiz_id)`, `FK(quiz_id -> quiz_sessions.quiz_id ON DELETE CASCADE)` |
| `quiz_tasks` | 异步出题状态与阶段 (`status/stage`) | `id`, `UNIQUE(task_id)`, `IDX(user_id, status)` |
| `kb_documents` | 私有文档状态 (`processing/ready/failed`) | `id`, `UNIQUE(doc_id)`, `FK(user_id -> users.id ON DELETE CASCADE)` |
| `image_generation_logs` | 题目配图每日额度审计 | `id`, `IDX(user_id, created_at)` |

---

## 5. REST API 契约表（前缀 `/api/v1`）

| 路由 | 方法 | 鉴权 | 限流 / 归属校验 | 作用 |
| --- | --- | --- | --- | --- |
| `/health` | `GET` | 公开 | 无 | 探活与容器健康检查 |
| `/user/login` | `POST` | 公开 | 调微信 `jscode2session` | 微信小程序静默登录签发 JWT |
| `/user/dev-login` | `POST` | 公开（仅非生产 + 开关） | 生产环境 403 禁用 | H5/本地开发模拟登录 |
| `/user/profile` | `GET` / `PUT` | 必选 JWT | 仅本人 | 获取统计档案 / 更新昵称头像 |
| `/user/quizzes` | `GET` | 必选 JWT | 仅本人 | 分页获取历史闯关记录 |
| `/user/quizzes/{quiz_id}` | `GET` | 必选 JWT | 校验 `user_id` | 回看单次题库、答卷与报告 |
| `/knowledge/documents` | `POST` / `GET` | 必选 JWT | 10MB / 10 篇限制 | 上传异步解析 / 获取文档列表 |
| `/knowledge/documents/{doc_id}` | `GET` / `DELETE` | 必选 JWT | 校验 `user_id` | 轮询解析状态 / 三处级联删除 |
| `/quiz/generate/async` | `POST` | 必选 JWT | 每分钟限流 + 校验 `doc_id` | 秒级创建异步出题任务 |
| `/quiz/task/{task_id}` | `GET` | 必选 JWT | **校验任务归属 `user_id`** | 每 2 秒轮询任务状态与阶段进度 (`stage/stage_message`) |
| `/quiz/{quiz_id}/images` | `GET` | 必选 JWT | **校验测验归属 `user_id`** | 轮询题目后台异步配图 URL 与 `image_status` |
| `/quiz/generate` | `POST` | 必选 JWT | 每分钟限流 + 校验 `doc_id` | 同步出题（调试/测试） |
| `/report/submit` | `POST` | 必选 JWT | **校验归属 + 服务端重算 + 事务幂等 XP** | 秒返算分与 XP，启动后台 AI 复盘报告 |
| `/report/{quiz_id}` | `GET` | 必选 JWT | **校验测验归属 `user_id`** | 每 2 秒轮询 AI 复盘报告生成状态与内容 |
| `/report/generate` | `POST` | 必选 JWT | 归属当前用户 + 幂等防重复 | 同步报告接口（兼容保留，内部已幂等） |
