## 改了什么

<!-- 一两句话说明本 PR 的目的；关联 Issue：Closes #xx -->

## 改动类型

- [ ] 修复（fix）
- [ ] 新功能（feat）
- [ ] 重构 / 性能（refactor / perf）
- [ ] 测试 / CI / 工具链（test / ci / chore / build）
- [ ] 文档 / 原型（docs）

## 自检清单（对应 AGENTS.md「质量闸门」）

- [ ] 后端：`uv run ruff check app tests` 与 `uv run pytest -q` 通过（N passed）
- [ ] 前端：`pnpm check:all`（lint + typecheck + test:coverage）通过
- [ ] 前端：`pnpm build:h5` / `pnpm build:weapp` 可构建（生产构建需传 https 的 `TARO_APP_API_BASE_URL`）
- [ ] 修 bug 附带了能复现问题的测试
- [ ] **涉及前端样式 / 界面改动**：已在 `docs/02-design/prototypes/` 提供 HTML 原型并获用户确认（附链接）：
- [ ] 未提交 `.env`、密钥、`backend/data/` 或构建产物
- [ ] 已更新 `docs/session-handoff.md`（未实机验证的部分明确标注「未实机验证」）
- [ ] 涉及产品范围 / 鉴权 / 数据隔离 / 费用阈值变更时，已先与用户确认

## 验证方式

<!-- 实际执行过的命令与结果；H5（375×812）/ 微信开发者工具 / 真机 哪些做了、哪些没做 -->

## 截图 / 录屏（界面改动必填）

## 风险与回滚
