# Design: 知行快刷 V2.0 技术与工程实现设计

## Context

- 架构选型白皮书与权衡矩阵已在 [`docs/02-design/v2-architecture-and-rationale.md`](../../docs/02-design/v2-architecture-and-rationale.md) 中完整定义。
- 架构蓝图与 6 屏 UI 原型已固化至 [`v2-architecture-diagram.html`](../../docs/02-design/prototypes/v2-architecture-diagram.html) 与 [`zhixing-quiz-v2-prototype.html`](../../docs/02-design/prototypes/zhixing-quiz-v2-prototype.html)。

## Goals / Non-Goals

- **Goals**:
  - 消除 V1 `--workers 1`、进程内内存队列与嵌入式 Chroma 锁限制，让系统具备多 Worker 水平扩展与持久化削峰/延迟调度能力。
  - 建立单题级与知识域级三维掌握数据底座，支撑冷启动与后续历史驱动的自适应题量（3~15 题）与难度配比输出，并用轻量 SVG/Canvas 图表直观呈现记忆衰减与能力强弱。
  - 去掉 LangGraph ReAct 多轮死循环，实现可控意图路由（仅按需调用 Tavily）并将出题稳定压缩至 5~12s。
- **Non-Goals**:
  - 暂不引入 Kafka、RabbitMQ、Celery 或 K8s 微服务拆分（Redis + ARQ + 独立 Chroma HTTP Server 已足够优雅解决本场景并发与延迟任务问题且运维可控）。
  - 暂不在微信小程序端强行上 SSE Token 逐字流式（保留更稳妥的 Redis 阶段缓存 + 2s 轮询）。

## Decisions

1. **为什么选择 Redis + ARQ 而不是重型 MQ 或留守进程内存**：
   - Redis 同时承载分布式限流、知识域画像读缓存、任务状态加速读与 ARQ 异步/延迟任务队列，避免多套中间件维护成本；ARQ 原生基于 Python `asyncio`，可直接复用 `aiomysql` 异步仓储。
2. **延迟提醒“ARQ `_defer_by` + Cron 扫表补偿”双保险**：
   - 答错收录卡片时按间隔投递精确延迟任务；同时每小时跑一次 Cron 扫表对漏激活卡片幂等补发，保证 Redis 重启不丢失提醒。
3. **为什么前端先出原型图与图谱再做后端改造**：
   - 遵循 `AGENTS.md` 原型确认门控，先让用户对「记忆曲线图谱」「冷启动自评」「3/5/10/15 题量挡位」「上一题只读回看」等视觉参数确认或微调后，再锁死前后端契约并推进数据库与后端迁移。

## Risks / Trade-offs

- **独立 Chroma HTTP Server 网络延迟**：由本机函数调用变为本地内网 HTTP 调用会增加约 2~5ms 单次检索开销，但彻底根除了多进程 SQLite/HNSW 锁冲突，整体吞吐与安全性收益远大于代价。
- **V1 历史数据迁移**：现有 `quiz_sessions.questions_json` 中的历史题目与 `kb_documents` 需要一段一次性/懒加载回填脚本拆解写入 `questions` 与默认 `domains`，确保老用户升级后图表立即可用。
