# Spec Delta

## Purpose

引入 Redis 7、ARQ 异步及延迟任务队列与独立 Chroma HTTP 服务，将后端从 V1 单 Worker 内存架构升级为可水平扩展、断电不丢任务、限流与画像可跨进程共享的生产级异步架构。

## ADDED Requirements

### Requirement: 多 Worker 兼容的独立向量服务与 Redis 限流缓存
The system SHALL decouple Chroma into a standalone HTTP server and back rate limiting, task status caching, and mastery profile caching with Redis so FastAPI can scale horizontally across multiple workers.

#### Scenario: 多 API Worker 并发写入与限流共享
- **WHEN** 系统以 `--workers > 1` 启动多个 FastAPI 实例且多用户并发上传文档或发起出题限流检查
- **THEN** 限流计数通过 Redis 滑动窗口全局一致生效，向量写入与检索通过独立 Chroma HTTP 服务执行而不触发本地文件锁竞态

### Requirement: ARQ 异步任务持久化与延迟调度可靠性
The system SHALL enqueue long-running AI generation, document ingestion, domain classification, and timed review activation jobs into ARQ with bounded retries and fallback recovery.

#### Scenario: 服务重启后队列任务持续消费
- **WHEN** 用户提交异步出题或上传文档后 API 或 Worker 短暂重启
- **THEN** 已入队任务保留在 Redis/ARQ 中并由恢复后的 Worker 继续消费与状态更新，不因单次进程重启而永久卡死
