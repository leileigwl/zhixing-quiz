# Spec Delta

## Purpose

提供交卷后即时权威判分、幂等 XP 经验结算与 AI 复盘报告后台异步生成及轮询补齐能力，解决同步生成报告的长连接超时问题与重复提交报错及刷分风险。

## ADDED Requirements

### Requirement: 交卷服务端权威判分与即时统计返回
The system SHALL evaluate submitted answers on the server against stored quiz questions and return immediate score metrics before AI report generation completes.

#### Scenario: 首次提交答卷秒返算分结果
- **WHEN** 已登录用户提交自己名下测验的作答选项列表至异步复盘提交接口
- **THEN** 服务端依据已保存的标准答案重算每题对错 `is_correct`、总正确率 `accuracy` 与对错题数，立即持久化答卷记录并以 `report_status="generating"` 返回即时成绩与本次经验值 `xp_gain`

#### Scenario: 提交不存在或非本人的测验
- **WHEN** 用户提交归属他人或不存在的 `quiz_id`
- **THEN** 系统拒绝结算并返回资源不存在或无权限错误，不修改任何统计与 XP

### Requirement: 答卷与经验值结算幂等性
The system MUST guarantee idempotent answer persistence and XP awarding per quiz session so duplicate submissions neither fail with duplicate-key errors nor award extra XP.

#### Scenario: 同场测验重复提交或弱网重试
- **WHEN** 用户因网络重试或刷新对同一 `quiz_id` 再次提交答卷
- **THEN** 系统幂等返回首次已结算的成绩与 `xp_gain`（且新增 `xp_awarded` 标识为 `false` 或仅在首次累加），不触发数据库唯一键异常且用户 `total_xp` 不重复增加

### Requirement: AI 复盘报告异步生成与轮询查询
The system SHALL generate the narrative AI review report asynchronously in the background and allow authorized owners to poll its completion status while preserving backward compatibility for legacy report generation callers.

#### Scenario: 后台异步生成并轮询补全报告
- **WHEN** 交卷触发异步报告生成后客户端轮询自己的报告状态查询接口
- **THEN** 生成中返回 `report_status="generating"`，完成后返回 `report_status="completed"` 与结构化报告内容；若大模型调用失败则收敛为 `report_status="failed"` 并返回明确错误信息供页面降级展示或重试

#### Scenario: 兼容原同步报告接口
- **WHEN** 既有客户端或测试调用原同步报告接口生成当前用户测验报告
- **THEN** 接口保持原有响应字段结构并通过统一的幂等校验规则落库，不产生唯一约束错误或重复 XP 累加
