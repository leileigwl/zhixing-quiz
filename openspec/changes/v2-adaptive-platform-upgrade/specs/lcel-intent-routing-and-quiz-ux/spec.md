# Spec Delta

## Purpose

将后端 AI 出题检索从黑盒慢速 LangGraph ReAct 循环重构为可控的 LCEL 意图路由流水线，保留稳妥的阶段轮询模式，并在前端答题流中补齐「上一题」只读回看解析与可配题量挡位。

## ADDED Requirements

### Requirement: 可控 LCEL 意图路由取代 ReAct 黑盒循环
The system SHALL replace the multi-turn ReAct agent loop in quiz context retrieval with deterministic LCEL conditional routing (`RunnableBranch`) governed by explicit web-search toggle, URL/recency signals, and direct vector recall, tagging every generated session with its `source_type`.

#### Scenario: 常规主题跳过无效搜索直出 DeepSeek
- **WHEN** 用户未选择知识库文档且未开启「联网补充最新资料」（输入也不含 URL）
- **THEN** 后端跳过 Tavily 搜索与 ReAct 中间推理环节，直接调用结构化出题链路生成题目并标注 `source_type="llm_direct"`

#### Scenario: 开启联网增强或包含 URL 时按需检索
- **WHEN** 用户开启「联网补充最新资料」或输入包含网页 URL（且系统已配置 Tavily Key）
- **THEN** LCEL 路由先提取/搜索参考资料再进入出题生成，并在响应元数据记录 `source_type="web_search"`（或与知识库结合为 `kb_rag`）

### Requirement: 答题过程支持「上一题」只读回看与可配题量
The system SHALL support configurable quiz lengths (`3 / 5 / 10 / 15` or adaptive recommendation) and allow users to navigate back to previous questions during an active session while locking already-submitted answers against post-explanation score tampering.

#### Scenario: 前端 DeepSeek 风格胶囊按钮显式切换联网与配图
- **WHEN** 用户在出题输入卡内点击切换 `🌐 智能搜索` 或 `🎨 题目配图` 胶囊开关
- **THEN** 交互以 `120ms` 轻缩按压响应（无廉价炫光）并将 `enable_web_search` / `generate_images` 参数实时传入异步出题请求

#### Scenario: 答题过程中点击「上一题」查看解析与节奏缓冲
- **WHEN** 用户在答题页作答多题后点击「上一题」或顶部已答序号圆点
- **THEN** 页面切回对应历史题目并完整展示用户此前选项、标准答案与详细解析，已提交题目处于只读锁定态不可修改；新交题后经 `220ms` 柔和缓冲展开解析卡片
