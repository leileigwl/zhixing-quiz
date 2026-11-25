# 前端原型图目录（Phase 2 门控）

本目录存放「知行快刷」基于用户参考图 [`ui-reference-v1.jpg`](../../99-archive/references/ui-reference-v1.jpg) 制作的高保真交互式 HTML 原型图。  
**工作规则**：原型图经用户确认后，再据此开始编写 `frontend/` 下的 Taro H5 与微信小程序页面代码。

## 当前原型文件

- **V1 上线基线**：[`zhixing-quiz-prototype.html`](zhixing-quiz-prototype.html)（5 屏并排总览与单机沉浸体验）。
- **V2 二次开发规划图（待审阅确认）**：
  - [`v2-bold-3d-lab.html`](v2-bold-3d-lab.html)：3 套大胆个性 · 高品质 3D 实验样板（方向 1 破框 Bento 空间视差撞色 / 方向 2 实体硬件机能拟物 3D / 方向 3 全屏实时 Three.js WebGL 空间场景）。
  - [`v2-ui-style-lab.html`](v2-ui-style-lab.html)：3 套独立开发 IP 画风 & 实动 MG 动画对比实验室（方案 A 暖奶芝士×墨小喵 / 方案 B 深夜黑灯×夜学黑猫 / 方案 C 软杏奶油×云朵小白猫，支持实时点击测试开屏动画与 DeepSeek 式胶囊开关）。
  - [`v2-architecture-diagram.html`](v2-architecture-diagram.html)：V2 系统部署与高并发解耦架构图（Multi-Worker + Redis + ARQ + 独立 Chroma + LCEL 路由）与 12 表 ER 关系图。
  - [`zhixing-quiz-v2-prototype.html`](zhixing-quiz-v2-prototype.html)：V2 早期多物种 6 屏交互探索稿（已按高净度审美重定调至 `v2-editorial-3palettes.html`）。
  - [`v2-editorial-3palettes.html`](v2-editorial-3palettes.html)：V2.0 极简高净度三套定调方案与核心内页延续标准（`LUCEN 虹彩雾白` / `MOVEPOP 暖石膏` / `lingobud 天雾暖阳` + `DAYPATCH` 半透明口袋 + 只读上一题回看 + `学习记忆曲线`）。
  - [`v2-mastery-and-progress-redesign.html`](v2-mastery-and-progress-redesign.html)：V2.4 等待文案去重与曲线页「洞察优先 + 至多 1 枚轻入口」重构交互原型（已获用户确认并落地）。
  - [`v2-quiz-feedback-prototype.html`](v2-quiz-feedback-prototype.html)：V2.5 答题正误纯净知性反馈交互原型（定位创作与深度学习：告别花哨连击/秒杀打击感弹窗；答错时选项左右微抖 + 进度条下非阻塞纠错条 + 自动展开避坑笔记；答对时选项轻柔 Q 弹 + 微信轻短震 + 零弹窗打扰 + 极简思路复盘折叠条）。
  - [`v26-home-density-prototype.html`](v26-home-density-prototype.html)：V2.6 首页冷启动引导、去英文化、长屏舒展与档案折叠交互原型（零做题新用户右卡显示「待解锁攻坚 · 待首测定位」；界面全英文字样换纯正中文；首页垂直自适应舒展消除过大留白；档案页记录紧凑化并默认折叠前 3 条；个人卡片表单式修改头像与昵称）。
  - [`v27-tap-feel-and-retention-curve.html`](v27-tap-feel-and-retention-curve.html)：V2.7 点按手感与「学习记忆曲线」重设计交互原型（**待用户确认**）：左屏「现状 / 改进」手感对比 + 44px 热区可视化（热区扩展、按下 ≤1 帧反馈并至少保持 90ms、选项卡按压态、异步按钮即时「处理中」）；右屏曲线改为按真实日期排布的时间轴（实测节点 → 已发生遗忘衰减 → 今天 → 若巩固 / 不巩固双分支）、跌破 50% 倒计时与可点锚点，并可拖动「距上次练习 N 天」验证曲线逐日变化。审计依据见 [`../tap-feel-audit.md`](../tap-feel-audit.md)。
  - [`v28-email-login.html`](v28-email-login.html)：V2.8 H5 邮箱验证码登录交互原型（**待用户视觉确认**；用户已于 2026-11-24 批准鉴权范围变更并要求同步实现）：邮箱输入 + 「获取验证码」60s 倒计时 + 6 位数字验证码 + 协议勾选（44px 热区）+ 黑曜石「登录」主按钮；右侧可模拟 验证码错误 / 次数过多 / 过期 / 429 / 503 / 断网 等后端返回逐一查看错误态。按下态沿用 V2.7 手感规范（≥44px、按下至少保持 90ms）。
  - [`v29-responsive-layout.html`](v29-responsive-layout.html)：V2.9 H5 响应式布局交互原型（**2026-11-25 用户已确认**，唯一改动：iPad 竖屏 768–1099 保留底部 Dock、内容加宽居中 720，导航不放左边；已按此实现到 `frontend/`）：顶部切换 手机 390 / iPad 竖屏 820 / iPad 横屏 1180 / 电脑 1440 / 跟随窗口 预览，预览框内按真实媒体查询排布，也可新标签直接拖窗口验证。断点 `<768` 保持现网底部 Dock；`768–1099` 保留底部 Dock、内容加宽居中 720；`≥1100` 改 232px 侧栏 + 内容 1120 多栏（首页 7:5、口袋 5:7、曲线 8:4、我的 4:8、答题题干/选项 5:7 并排、登录左右分屏、复盘双栏），弹层在 ≥768 变居中对话框；hover / focus-visible 态、≥44px 热区、键盘答题（1–4 / Enter / ←，建议项）；所有页面底部展示备案号「浙ICP备2026102405号-1」链接工信部。页面底部附「断点与改动清单」（逐页改动、涉及文件、工作量 ≈8.75 人日、Taro H5 实现方式：条件编译包裹的媒体查询 + `useViewportTier` hook，不影响 weapp）与 3 个设计选择（均已确认）。

  1. **闯关首页（Tab 1）**：顶部用户简况 + XP 徽章、多行输入卡片、快捷示例标签、配图开关、开始出题按钮与轮询加载态、最近闯关入口。
  2. **知识库页（Tab 2）**：上传规范提示（格式/10MB/10 篇）、上传区域、文档卡片列表（状态标签、切片数、开始闯关、删除）。
  3. **闯关答题页（二级页）**：题号与进度条、题型/知识点徽章、配图示意图容器、选项状态（默认/选中/正确绿/错误红）、详细解析折叠区、下一题/查看报告按钮。
  4. **复盘报告页（二级页）**：正确率圆环与绿红计数、评价标题、掌握/薄弱知识点标签、三句核心总结、下一步建议、今日学习金句分享卡片、返回首页按钮。
  5. **我的页面（Tab 3）**：头像昵称卡片（支持编辑）、2×2 学习数据看板、历史闯关记录列表与跳转回看。
