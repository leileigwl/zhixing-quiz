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
  - [`v2-quiz-feedback-prototype.html`](v2-quiz-feedback-prototype.html)：V2.5 答题正误情绪反馈交互原型（答错左右抖动 + 顶部防踩坑弹窗条 + 自动展开避坑拆解 vs 答对 Q 弹 + 4 套连击/秒杀/硬核/拿捏提示条 + 解析轻量收起）。

  1. **闯关首页（Tab 1）**：顶部用户简况 + XP 徽章、多行输入卡片、快捷示例标签、配图开关、开始出题按钮与轮询加载态、最近闯关入口。
  2. **知识库页（Tab 2）**：上传规范提示（格式/10MB/10 篇）、上传区域、文档卡片列表（状态标签、切片数、开始闯关、删除）。
  3. **闯关答题页（二级页）**：题号与进度条、题型/知识点徽章、配图示意图容器、选项状态（默认/选中/正确绿/错误红）、详细解析折叠区、下一题/查看报告按钮。
  4. **复盘报告页（二级页）**：正确率圆环与绿红计数、评价标题、掌握/薄弱知识点标签、三句核心总结、下一步建议、今日学习金句分享卡片、返回首页按钮。
  5. **我的页面（Tab 3）**：头像昵称卡片（支持编辑）、2×2 学习数据看板、历史闯关记录列表与跳转回看。
