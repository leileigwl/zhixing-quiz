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
- **前端样式与页面改动（强制原型门控）**：用户提出前端样式或界面修改需求时，必须先在 [`docs/02-design/prototypes/`](docs/02-design/prototypes/README.md) 制作或更新可交互 HTML 原型图并经用户确认，**确认通过后再编写或修改 `frontend/` 页面代码**。
- **过时文档处理**：淘汰或被替代的设计文档归档至 `docs/99-archive/`，不要在多个文档里重复抄录同一份完整规范（入口文档只写核心边界与跳转链接）。

## 何时必须停下来问用户

- 涉及改变产品核心功能范围、删减或新增核心业务模块时。
- 涉及调整 JWT 鉴权范围、放开匿名调用收费 AI 接口、修改用户数据隔离规则、或变更生产费用/额度阈值时。
- 涉及更换数据库选型、更换部署方式、或执行不可逆的数据/环境操作时。
- 若只是文件归档、文档内链修复、代码内边界加固或按既有文档补测试，按本规则直接处理并记录到交接清单。

## 每轮结束时（必须交接）

1. **Git 检查点提交**：每当大部分改动或一个主要开发/规范阶段完成后（且检查测试通过、确认无 `.env`/密钥/本地运行时数据 `backend/data/`），应先执行一次 `git commit` 固化当前稳定基线，再继续下一阶段开发。
2. 更新 [`docs/session-handoff.md`](docs/session-handoff.md)：写明日期、当前阶段、本轮做了什么、实际执行的命令与测试通过情况（**未实际启动服务或未执行的端到端联调必须明确标记为“未实机验证”**）、未决事项与下一步计划。
3. 不得把仅通过 Mock 测试的单元测试说成已完成真实微信真机或线上域名端到端联调。
