# 知行快刷（ZhiXing Quiz）

> AI 知识库自测与智能闯关微信小程序（独立生产化重构版）

## AI 与开发工作入口

- **首先阅读**：[`AGENTS.md`](./AGENTS.md)（工作规则总入口）
- **产品边界**：[`docs/PRODUCT.md`](./docs/PRODUCT.md)（上线范围与排除项）
- **技术约束**：[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)（技术栈、JWT 与安全红线、禁止引入清单）
- **交接清单**：[`docs/session-handoff.md`](./docs/session-handoff.md)（当前阶段、验证记录与下一步）

## 详细设计文档

- [详细产品需求文档（PRD）](./docs/01-product/PRD.md)
- [系统架构、目录树、表结构与接口契约](./docs/02-design/system-architecture.md)
- [前端 5 屏交互原型图](./docs/02-design/prototypes/zhixing-quiz-prototype.html)

## 本地开发命令（`uv` + `pnpm`）

```bash
# 1. 启动 MySQL 8.0（需先启动 OrbStack / Docker）
docker compose up -d mysql

# 2. 启动后端 FastAPI（在 backend/.env 配好模型 Key 后）
cd backend
cp .env.example .env
uv sync && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# 3. 运行后端质量检查与单元测试
uv run ruff check app tests
uv run pytest

# 4. 启动前端 H5 或微信小程序开发监听（统一使用 pnpm）
cd ../frontend
pnpm install
pnpm dev:h5           # 浏览器调试 H5（输出至 dist-h5/）
pnpm dev:weapp        # 监听并编译微信小程序开发版至 dist/（连接 http://127.0.0.1:8000/api/v1）
pnpm build:weapp:local # 单次构建本地微信小程序调试包至 dist/
# 生产发布：TARO_APP_API_BASE_URL=https://你的域名/api/v1 pnpm build:weapp
```
