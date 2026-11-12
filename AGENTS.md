# AGENTS.md：工作规则入口

本文件是 AI 编程助手与开发者在本仓库内工作的总入口与地图，负责说明先读什么、需求或技术变更写到哪里、何时必须暂停问用户，以及每轮结束时如何交接。  
产品边界以 [`docs/PRODUCT.md`](docs/PRODUCT.md) 为准，技术与安全约束以 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) 为准。

## 每轮开始前（必须先读）

1. 先阅读 [`docs/session-handoff.md`](docs/session-handoff.md)，掌握当前所处阶段、已完成事项、真实测试状态和下一步待办。
2. 再阅读 [`docs/PRODUCT.md`](docs/PRODUCT.md) 与 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)；需要具体表字段、接口契约或业务流程细节时，再按链接打开 [`docs/01-product/PRD.md`](docs/01-product/PRD.md) 与 [`docs/02-design/system-architecture.md`](docs/02-design/system-architecture.md)。
3. 以用户本轮的最新指令为最高优先级；若与旧交接记录或旧文档冲突，先同步更新对应事实来源文档，再改代码。

## 需求和设计变更规范

- **产品范围、用户角色、上线包含/排除项变化**：同步更新 [`docs/PRODUCT.md`](docs/PRODUCT.md) 与 [`docs/01-product/PRD.md`](docs/01-product/PRD.md)。
- **技术栈、数据模型、JWT/安全边界、部署或存储约束变化**：同步更新 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) 与 [`docs/02-design/system-architecture.md`](docs/02-design/system-architecture.md)。
- **前端样式与页面改动（强制原型门控）**：用户提出前端样式或界面修改需求时，必须先在 [`docs/02-design/prototypes/`](docs/02-design/prototypes/README.md) 制作或更新可交互 HTML 原型图并经用户确认，**确认通过后再编写或修改 `frontend/` 页面代码**；V2 样式与按钮排版严格对照 [`docs/02-design/v2-ui-design-system.md`](docs/02-design/v2-ui-design-system.md)（方案 B `MOVEPOP` 暖石膏风格）。
- **过时文档处理**：淘汰或被替代的设计文档归档至 `docs/99-archive/`，不要在多个文档里重复抄录同一份完整规范（入口文档只写核心边界与跳转链接）。

## 开发阶段 Skill 与上线前安全审计门控

> Antigravity 对全局/本地 Skill 采用**按需渐进加载（Progressive Disclosure）**，默认仅展示名称与简介，不会自动全量载入正文；请严格按下列里程碑主动调用对应 Skill / 插件：

- **设计定调与外部 API 对齐阶段**：查阅最新 Taro 4 / ARQ / LangChain 文档时使用 `context7`；UI 改版对标线上真实应用模式时使用 `mobbin` + `design-html` / `liquid-glass-design` + `prototype`。
- **后端核心模块编码完成后（Redis / ARQ / SQLAlchemy / 文件解析 / LCEL）**：执行 `source-command-python-review`、`improve-codebase-architecture` 与 `source-command-tdd`，检查并发锁、幂等投递、事务隔离与测试覆盖（`source-command-test-coverage`）。
- **上线部署 / 公开验收前（强制安全审计门控）**：上线前必须触发 `review-security` / `cs-audit` 与 **`endor-labs-agent-kit`**（`sca-remediation`、`ai-sast-remediation`、`cicd-posture`、`findings-browser`），专项检查 JWT/匿名配额防越权、PDF/Word/MD 上传解析安全性、SSRF/XSS、`.env` 密钥防泄露与三方依赖漏洞；并运行 `source-command-e2e` + 浏览器端到端核验。

## 何时必须停下来问用户

- 涉及改变产品核心功能范围、删减或新增核心业务模块时。
- 涉及调整 JWT 鉴权范围、放开匿名调用收费 AI 接口、修改用户数据隔离规则、或变更生产费用/额度阈值时。
- 涉及更换数据库选型、更换部署方式、或执行不可逆的数据/环境操作时。
- 若只是文件归档、文档内链修复、代码内边界加固或按既有文档补测试，按本规则直接处理并记录到交接清单。

## 每轮结束时（必须交接）

1. **Git 检查点提交（每轮验收后必提交）**：每轮对仓库做出实质改动并在所有相关 lint/测试/构建与端到端校验通过后，先通过 `git status --short` 确认无 `.env`/密钥/本地运行时数据 `backend/data/` 或临时产物，随即在向用户汇报前执行一次 `git commit` 固化当前基线（仅本地提交，除非用户明确要求否则不主动 `git push`）。
2. 更新 [`docs/session-handoff.md`](docs/session-handoff.md)：写明日期、当前阶段、本轮做了什么、实际执行的命令与测试通过情况（**未实际启动服务或未执行的端到端联调必须明确标记为“未实机验证”**）、未决事项与下一步计划。
3. 不得把仅通过 Mock 测试的单元测试说成已完成真实微信真机或线上域名端到端联调。
