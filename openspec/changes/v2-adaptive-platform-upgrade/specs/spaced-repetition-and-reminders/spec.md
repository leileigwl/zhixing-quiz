# Spec Delta

## Purpose

基于单题粒度实现 SM-2 间隔重复错题队列（`review_cards`），利用 ARQ 延迟任务与定时扫表补偿实现到期激活，并结合微信小程序订阅消息配额与站内横幅完成“过一段时间回顾错题”的闭环召回。

## ADDED Requirements

### Requirement: 错题自动收录与 SM-2 间隔调度
The system SHALL persist missed questions (and user-marked tricky questions) into `review_cards` and schedule `next_review_at` via SM-2 intervals (`1 -> 3 -> 7 -> 15 -> 30` days), graduating cards to `mastered` after consecutive correct reviews.

#### Scenario: 交卷后自动收录错题并投递延迟提醒
- **WHEN** 用户交卷存在答错题目或手动标记「蒙对加入复习」
- **THEN** 系统在数据库中写入/重置对应 `review_cards`（`interval_days=1`）并向 ARQ 投递精确延迟任务，当复习连续答对达到毕业阈值时卡片状态更新为 `mastered`

### Requirement: 延迟激活、定时补偿兜底与双渠道召回
The system SHALL combine ARQ deferred jobs with an hourly Cron sweep fallback to trigger review reminders reliably via WeChat subscribe messages when quota is available and via an in-app due banner regardless of push quota.

#### Scenario: 订阅配额充足时准点推送并扣减配额
- **WHEN** 某用户的复习卡到期且 `subscribe_quotas.remaining_count > 0`
- **THEN** ARQ Worker 按用户偏好时段幂等调用微信订阅消息推送待复习题数并扣减 1 次配额；若无配额，则在用户打开小程序首页时通过顶部「今日待复习错题」横幅提醒并支持一键开启专题复习
