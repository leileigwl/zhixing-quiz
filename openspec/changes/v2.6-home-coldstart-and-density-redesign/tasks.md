# Tasks: V2.6 首页冷启动引导、去英文化、长屏呼吸感与档案折叠压缩

- [ ] 1. **OpenSpec 规范与方案审阅** <!-- id: 1-spec-review -->
  - [x] 1.1 完成 `/grill-me` 交互访谈并敲定冷启动、舒展排版、折叠压缩与资料修改细节
  - [ ] 1.2 编写 `openspec/changes/v2.6-home-coldstart-and-density-redesign/specs/home-coldstart-and-density.md`
  - [ ] 1.3 提交用户审阅获批

- [ ] 2. **高保真可交互原型先行更新与验证** <!-- id: 2-prototype -->
  - [ ] 2.1 制作 V2.6 高保真交互原型 `docs/02-design/prototypes/v26-home-density-prototype.html`
  - [ ] 2.2 呈现冷启动新用户态（待解锁攻坚域）与老用户态（重点攻坚）对比切换
  - [ ] 2.3 呈现长屏舒展比例与「我的」档案折叠展开交互
  - [ ] 2.4 使用 Playwright 渲染高分辨率截图核验视觉品质

- [ ] 3. **前端首页核心改造** <!-- id: 3-frontend-home -->
  - [ ] 3.1 [frontend/src/pages/index/index.tsx](file:///Users/leileigwl/Work/Learn/new/zhixing-quiz/frontend/src/pages/index/index.tsx)：
    - 全面去英文化：替换 `DUE TODAY` 为 `今日待巩固`，`FOCUS DOMAIN` 为 `重点攻坚`；
    - 新增新用户冷启动判断（未做过题时展示「待解锁攻坚 · 完成首测自动定位」），点击自动填充推荐考点；
  - [ ] 3.2 [frontend/src/pages/index/index.scss](file:///Users/leileigwl/Work/Learn/new/zhixing-quiz/frontend/src/pages/index/index.scss)：
    - 优化长屏机型垂直比例，调整卡片外边距与输入区呼吸感，彻底消除突兀空旷感。

- [ ] 4. **前端「我的」档案页折叠压缩与表单编辑** <!-- id: 4-frontend-profile -->
  - [ ] 4.1 [frontend/src/pages/profile/index.tsx](file:///Users/leileigwl/Work/Learn/new/zhixing-quiz/frontend/src/pages/profile/index.tsx)：
    - 新增历史练习档案默认展示 3 条与「展开全部 N 条 ⌄ / 收起 ‹」折叠逻辑；
    - 新增错题巩固本默认折叠逻辑；
    - 重构个人信息卡片为清晰直观的编辑表单（微信 `chooseAvatar` + 昵称取消/保存）；
  - [ ] 4.2 [frontend/src/pages/profile/index.scss](file:///Users/leileigwl/Work/Learn/new/zhixing-quiz/frontend/src/pages/profile/index.scss)：
    - 列表项轻量化样式，行高压缩约 40%，头像相机角标与编辑按钮样式。

- [ ] 5. **双端构建、测试与稳态提交** <!-- id: 5-build-and-commit -->
  - [ ] 5.1 执行 `pnpm typecheck` 验证无类型报错
  - [ ] 5.2 执行 `NODE_ENV=development pnpm build:h5` 与 `pnpm build:weapp:local` 双端编译
  - [ ] 5.3 运行 Playwright 端到端脚本测试真实渲染效果
  - [ ] 5.4 执行 `uv run pytest -q` 确保后端单测全绿
  - [ ] 5.5 执行 `git status --short` 排敏并提交稳态 Git 检查点
