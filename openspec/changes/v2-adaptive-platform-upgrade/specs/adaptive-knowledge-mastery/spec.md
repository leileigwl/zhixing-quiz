# Spec Delta

## Purpose

建立知识领域字典、单题规范化存储及用户知识域三维掌握画像（简单/中等/困难正确率、耗时、遗忘稳定性与保持率），使 AI 自动对上传文档与主题归类，并由后端数据驱动自适应题量与难度配比，同时在前端以学习记忆曲线与多维图谱直观呈现。

## ADDED Requirements

### Requirement: AI 自动领域归类与单题数据落库
The system SHALL automatically classify uploaded knowledge documents and quiz topics into user-scoped domains and persist normalized per-question metadata (`domain_id`, `difficulty`, `knowledge_point`) instead of relying solely on monolithic session JSON blobs.

#### Scenario: 上传多种格式文件后自动归并分类
- **WHEN** 用户上传 `.pdf`、`.docx`、`.md` 或 `.txt` 文档并完成解析分块
- **THEN** 后台异步识别文档主题并优先语义归并到用户已有 `domains`（若无高相似域则创建新域），在知识库列表页支持按领域筛选查看与刷题

### Requirement: 后端画像驱动的自适应题量与难度决策
The system SHALL inspect the user's `user_knowledge_mastery` profile (or cold-start self-rating when history is absent) before generating a quiz to dynamically determine recommended question count and difficulty distribution (`easy` / `medium` / `hard`).

#### Scenario: 陌生领域冷启动与高熟练度倒 U 型题量策略
- **WHEN** 用户在某个尚无历史记录的知识域发起出题并选择「陌生」或未自评
- **THEN** 后端下发较少偏基础的摸底题组（3~4 题，`easy` 占主导）；当用户处于成长期（`45% <= mastery < 80%`）时适量加至 6~8 题巩固变式；当领域 `mastery >= 80%` 快刷通时反向下调至 3 题高难精炼抽查，同时始终允许用户用显式题量参数（`3/5/10/15`）手动覆盖题数

#### Scenario: AI 自动归类与几何微缩图标映射
- **WHEN** 用户上传文档或生成新领域知识画像
- **THEN** 系统将该领域绑定到统一的低饱和配色与层叠几何微缩图标，用于前端 `DAYPATCH` 半透明知识口袋与卡片标识展示

### Requirement: 记忆保持率曲线与领域掌握图谱可视化
The system SHALL provide a memory curve and domain mastery visualization API exposing each domain's forgetting retention trajectory, 7-day due review forecast, and Easy/Medium/Hard mastery breakdown.

#### Scenario: 前端查询知识图谱与记忆曲线
- **WHEN** 用户打开图谱页查看个人学习强弱与遗忘趋势
- **THEN** 后端返回按领域聚合的当前保持率 `R(t)`、50% 遗忘预警状态、未来 7 天预测待复习题量及各难度正确率矩阵供前端渲染原生轻量图表
