# Spec Delta

## Purpose

提升私有知识库上传、文档解析切分、分批向量化入库与 RAG 智能检索的兼容性和非阻塞并发能力，避免编码报错、跨章节语义割裂及单进程事件循环阻塞。

## ADDED Requirements

### Requirement: 文本类文档多编码兼容与空内容拦截
The system SHALL decode uploaded `.txt` and `.md` documents across common Chinese and UTF encodings and reject empty or unreadable documents with clear actionable error states.

#### Scenario: GBK 或带 BOM 编码文档正常解析
- **WHEN** 用户上传 `GB18030`/`GBK` 或带 BOM 的 `UTF-8` 格式 `.txt`/`.md` 笔记
- **THEN** 文档解析器自动探测并完成文本解码，成功进入切分与向量入库流程且不发生乱码或解码崩溃

#### Scenario: 扫描版纯图片 PDF 或空白文档告警
- **WHEN** 用户上传无法提取出任何有效文本的扫描版 PDF 或空白文档
- **THEN** 文档状态更新为 `failed` 并记录明确可读提示（说明暂不支持纯图片扫描 PDF 或内容为空），不写入空向量

### Requirement: Markdown 章节标题感知切分
The system SHALL split Markdown documents along heading boundaries before applying chunk size limits so sections and their headings remain semantically intact.

#### Scenario: 多章节 Markdown 笔记切分
- **WHEN** 用户上传包含多级 `#` / `##` / `###` 标题的 Markdown 文档
- **THEN** 系统优先按标题层级拆分为语义单元并保留所属章节标题上下文，仅当单个章节超出切片长度上限时再做重叠二次切分

### Requirement: 分批向量入库与解析进度状态
The system SHALL batch vector embedding writes and expose document processing stage or chunk progress without blocking request handling.

#### Scenario: 多切片文档分批写入向量库
- **WHEN** 文档切分产生大量文本块需要向量化入库
- **THEN** 系统按固定批次大小顺序写入向量库并保留完整 `user_id` 与 `doc_id` 隔离元数据，降低外部向量接口单次请求超时与限流风险

### Requirement: 非阻塞异步知识库检索工具与文件 I/O
The system MUST execute knowledge base file reads/writes, deletions, and RAG vector retrieval tools asynchronously off the main event loop while preserving per-user isolation.

#### Scenario: 并发请求下执行 RAG 检索出题
- **WHEN** 用户基于私有知识库文档发起异步出题并触发知识库向量检索
- **THEN** 检索工具以异步方式将阻塞型向量查询调度至后台线程执行，保持主事件循环可同时响应其他用户的健康检查与轮询请求，且仅返回当前用户当前文档下的匹配片段
