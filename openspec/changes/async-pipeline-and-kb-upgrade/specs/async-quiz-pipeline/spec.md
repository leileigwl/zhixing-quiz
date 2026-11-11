# Spec Delta

## Purpose

提供异步出题任务的细粒度阶段进度查询能力，并支持题库文本就绪后立即开放作答、题目配图在后台异步补齐与渐进刷新的流转能力，降低用户进入答题页的等待时延。

## ADDED Requirements

### Requirement: 异步出题阶段进度可见性
The system SHALL expose current execution stage on quiz task status queries so clients can display accurate step-level progress.

#### Scenario: 正常查询出题阶段流转
- **WHEN** 已登录用户创建异步出题任务并轮询自己的任务状态接口
- **THEN** 系统返回 `status` 以及当前阶段 `stage`（依次流转为 `queued`、`fetching_context`、`generating_quiz`、`completed` 或 `failed`）与面向用户的阶段提示文案 `stage_message`

#### Scenario: 越权查询他人任务阶段
- **WHEN** 用户查询不属于当前登录账号的 `task_id`
- **THEN** 系统拒绝访问并返回鉴权失败错误，不泄露任务阶段与题目内容

### Requirement: 文本题目先就绪与配图异步补齐
When image generation is enabled, the system SHALL mark the quiz task as completed once the text questions are persisted and generate question images asynchronously in the background.

#### Scenario: 开启配图后秒进答题页并异步补图
- **WHEN** 用户发起开启配图的出题请求且文字题目生成并入库完成
- **THEN** 出题任务状态立即转为 `completed` 并返回题目列表与配图初始状态 `image_status="generating"`，同时后台任务在不阻塞答题的前提下生成配图并逐步更新对应题目的 `image_url`

#### Scenario: 客户端轮询获取补全后的题目配图
- **WHEN** 答题页在 `image_status` 为 `generating` 期间按周期查询题库配图状态且归属当前用户
- **THEN** 系统返回最新的每题 `image_url` 映射、当前 `image_status`（`none` / `generating` / `completed` / `partial` / `failed`）及必要的提示 `image_notice`，全部结束后客户端停止轮询

#### Scenario: 配图生成失败或超限时的静默降级
- **WHEN** 后台配图触发每日额度上限或外部生图服务异常
- **THEN** 已就绪的文字题目与答题流程保持正常可用，`image_status` 最终收敛为终态并附带清晰 `image_notice` 提示，不阻断用户提交答卷
