# Proposal

## Why

当前「知行快刷」已跑通微信小程序真机登录与 H5/后端全链路，但在长耗时大模型与知识库场景下仍有四处明显瓶颈：① 提交答卷后 `POST /api/v1/report/generate` 同步等待 LLM 输出导致前端需要设 600 秒超长超时，且重复提交同场测验会触发数据库唯一索引冲突报错并存在前端自行算分隐患；② 开启题目配图时需等全部文生图完成后整套题库才变为 `completed`，拖慢进入答题页速度；③ 知识库解析与向量入库缺少编码容错、Markdown 章节感知切分与分批防限流，且 RAG Agent 检索工具为同步函数会短暂阻塞 Uvicorn 单 Worker 事件循环；④ 异步任务缺少阶段级状态提示。为支撑小程序真机弱网稳定运行与更高质量的 AI 知识库出题体验，需对异步流水线、XP 幂等与知识库切分链路进行一次系统性升级。

## What Changes

- **出题文字先行、配图后台异步补齐与阶段进度**：`GET /api/v1/quiz/task/{task_id}` 增加任务阶段字段 `stage`（如 `fetching_context` / `generating_quiz` / `completed`）与实时文案提示；文本题目生成并入库后即可让前端进入答题页，若开启配图则在后台异步并发生成并写回题目 `image_url`，前端答题页按需轮询刷新配图状态。
- **秒开算分 + 异步 AI 复盘报告 + 服务端 XP 幂等结算**：新增异步复盘提交端点 `POST /api/v1/report/submit` 与状态查询端点 `GET /api/v1/report/{quiz_id}`。交卷时由服务端根据题库标准答案重新核对 `is_correct`、幂等持久化答卷记录并结算单场唯一一次 `xp_gain`（<50ms 立即返回正确率、对错题数与经验增量），同时后台异步触发 LLM 总结生成并在报告页每 2 秒轮询补齐复盘卡片；保留原 `POST /api/v1/report/generate` 接口以平滑兼容既有调用。
- **知识库切分解析增强与非阻塞异步 RAG**：支持 `.txt` / `.md` 的多编码自动识别（UTF-8 / UTF-8-SIG / GBK）、Markdown 按标题层级（`# / ## / ###`）先分组再字符切分避免跨章节混淆、Chroma 向量写入分批提交（Chunk Batching）并补全本地文档读写 `asyncio.to_thread` 异步化；将 [`rag_service.py`](../../../backend/app/services/rag_service.py) 中的 `search_knowledge_base` 改为异步工具（内部走 `asyncio.to_thread` 调用 Chroma 检索），彻底消除对单 Worker 事件循环的阻塞。

## Capabilities

### New Capabilities

- `async-quiz-pipeline`: 异步出题任务的阶段进度可见性，以及“文本题目先就绪、题目配图后台异步补齐并随页刷新”的渐进式加载能力。
- `async-report-and-xp`: 交卷秒返服务端权威判分与幂等 XP 经验结算，以及 AI 复盘报告后台异步生成与轮询补齐能力（兼容原同步接口）。
- `kb-parsing-and-rag`: 知识库文档的多编码容错读取、Markdown 章节标题感知切分、分批向量入库、文件 I/O 线程隔离以及 RAG Agent 异步检索能力。

### Modified Capabilities

<!-- 当前仓库尚无既有 openspec/specs/，全部能力均作为首版基线能力在此创建。 -->

## Impact

- **后端代码**：`backend/app/core/db.py`（为 `quiz_tasks` 增加 `stage` 字段、为 `reports` / `quiz_sessions` 增加渐进状态支持并完善启动自愈迁移）、`backend/app/models/{quiz,report}.py`、`backend/app/repositories/{task_repository,quiz_repository,user_repository}.py`、`backend/app/services/{quiz_service,report_service,knowledge_service,document_loader_service,vector_store_service,rag_service,scoring_service}.py`、`backend/app/api/v1/routes/{quiz,report}.py`。
- **前端代码**：`frontend/src/services/api.ts`、`frontend/src/services/quizSessionStore.ts`、`frontend/src/pages/{index,knowledge,quiz,report}/index.tsx` 及对应样式。
- **架构约束兼容性**：严格维持 `Router -> Service -> Repository` 分层、`aiomysql` 原生 SQL、`uvicorn --workers 1`、全量 JWT 鉴权与任务/报告归属隔离，不引入 Celery / Redis / WebSocket。
