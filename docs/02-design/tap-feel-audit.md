# 点按手感审计（V2.7 · 2026-11-24）

> 状态：**审计结论 + 修复提案，待用户确认原型后再改 `frontend/`**。  
> 交互原型：[`prototypes/v27-tap-feel-and-retention-curve.html`](prototypes/v27-tap-feel-and-retention-curve.html)（左屏「现状 / 改进」手感对比 + 热区可视化）。  
> 方法：静态审计 `frontend/src/**/*.tsx` 中全部 `onClick`（74 处）及对应 SCSS；尺寸按 `designWidth: 750` 换算（SCSS 中 `1px` 设计稿 = 375 宽屏上 `0.5` CSS px，经 H5 `pxtransform` → rem / 小程序 → rpx）。行高按全局 `line-height: 1.5` 估算。**全部为静态推算，未实机验证**（未在 iOS Safari / Android Chrome / 微信真机上测量）。

## 一、结论（为什么「点起来不跟手」）

| # | 问题 | 影响端 | 证据 |
| :-- | :-- | :-- | :-- |
| F1 | **大量可点控件热区远小于 44px**（Apple HIG 44pt / 微信建议 ≥ 44px），约 25 个控件在 20~29px 之间，进度点只有 5px | H5 + weapp | 见下表 |
| F2 | **微信小程序里 `:active` 对 `<View>` 基本不生效**，需要 `hoverClass`；全站按压反馈依赖 `.zx-press:active`，而 `hoverClass` 已在 `d46b49c` 为修 tab 栏吞点击而移除 → 小程序端几乎所有控件**按下无反馈** | weapp | `app.scss` `.zx-press:active`、`custom-tab-bar/index.scss` `.wx-dock-tab:active`；`hoverClass` 全仓 0 处 |
| F3 | **按压反馈只在手指按住期间存在且有 120ms 过渡**：快速轻点（约 50~100ms）时缩放还没画出来就松手了，用户「看不到自己点中了」 | H5 | `.zx-press { transition: transform 120ms }` + `:active { scale(0.96) }` |
| F4 | **答题选项卡 `.opt-card`（全站最高频的点按）没有任何按压态**，只有松手后才变「选中」 | H5 + weapp | `pages/quiz/index.scss` `.opt-card` 无 `:active`/`zx-press` |
| F5 | **异步操作无即时「处理中」态**：如曲线页 / 档案页「移出错题」`await markQuestionForReview` 返回后才 toast，弱网下像没点中，还可能重复点击 | H5 + weapp | `pages/mastery/index.tsx` `handleMarkMastered`、`pages/profile` 错题操作 |
| F6 | **反馈形式偏「闪」**：`opacity: 0.88` 叠加缩放，深色胶囊上像闪烁而不是被按下；`zx-btn-obsidian` 只缩 0.98 几乎看不出 | H5 | `app.scss` |
| F7 | 部分可点元素只是纯文本（`sheet-link`、`docs-reset`、`review-toggle`），无底色无热区扩展 | H5 + weapp | 见下表 |
| F8 | 可点 `View` 无语义（除底部 Dock 外没有 `aria-label` / role），读屏与键盘不可达 | H5 | 全站 |
| F9（顺带发现的 UI 缺陷） | `SevenDayRhythmBar` 周均虚线用**内联 CSS px**（`calc(44px + N px)`）定位，而柱子高度是设计稿 px（被换算为一半），两者单位不一致 → 周均线位置约偏高 1 倍，常落在柱区之外 | H5 + weapp | `components/SevenDayRhythmBar/index.tsx` + `index.scss` `.zx-bar-track { height: 116px }` |

已排除的问题：
- **300ms 点击延迟**：H5 `index.html` 已设 `width=device-width, user-scalable=no`，现代浏览器不再有 300ms 延迟。
- **点击高亮色块**：Taro H5 运行时已给 `.taro-app-wrap` 设 `-webkit-tap-highlight-color: transparent`。
- **`pointer-events`**：tab 栏图标子元素 `pointer-events: none` 已在 `d46b49c` 修好；`is-disabled` 控件用 `pointer-events: none` 属预期。
- **`onTouch*` / `catchMove`**：业务代码中 0 处，不存在手势吞点击。

## 二、热区小于 44px 的控件（静态推算，CSS px @375 宽）

| 页面 | 控件 class | 估算高度 | 备注 |
| :-- | :-- | --: | :-- |
| 答题 | `qdot`（进度点，可点跳题） | **5** | 最严重 |
| 全局 | `bg-pill-close`（后台出题胶囊 ✕） | 20 | |
| 档案 | `btn-edit-name-pill` | ~20 | |
| 首页 | `tool-chip`、`seg-item` | ~23 | 出题舱高频 |
| 首页 | `quick-chip` | ~24 | |
| 口袋 | `btn-doc-del`（删除圆钮） | 24 | 删除类，误触代价高 |
| 首页 | `sheet-done` | ~25 | |
| 首页 | `topbar-badge` | ~26 | |
| 曲线 | `md-btn`、`mastery-compact-cta` | ~26 | |
| 档案 | `due-act-btn`、`btn-due-variant`、`btn-due-go` | ~26 | |
| 答题 | `mark-review-pill` | ~26 | |
| 曲线 | `domain-pill` | ~27 | |
| 首页 | `ds-pill` | 28 | |
| 口袋 | `btn-doc-quiz` | ~28 | |
| 档案 | `btn-cancel-name` / `btn-save-name` | ~28 | |
| 首页 | `sheet-pill`；档案 `fold-toggle-pill` | ~29 | |
| 口袋 | `kb-upload-pill` | ~33 | |
| 全局 | `zx-dock-tab`（H5 Dock）/ `wx-dock-tab`（小程序 tab） | 41 / 40 | 接近，可接受但建议热区补到 44 |
| 答题 / 报告 | `btn-instant-secondary` / `btn-remind` | 41 | 同上 |
| 首页 / 口袋 / 报告 | `sheet-link`、`docs-reset`、`review-toggle` | 文本行高 ~16 | 纯文字链接 |

达标：`zx-btn-obsidian` 48、`btn-prev` 46、`opt-card`、`mini-tile`、`pocket-card`、`history-card`、`sheet-doc-row` 等整卡点击。

## 三、修复提案（确认原型后按此落地，样式改动均需先过原型门控）

1. **统一热区规则**：新增全局 mixin / class `.zx-hit`，用 `::after { inset: -Ypx -Xpx }` 把热区补到 ≥ 44px，**视觉尺寸基本不变**；对小胶囊同时把视觉高度提到 32~34px（原型左屏「改进」）。
2. **统一按压反馈 `usePressable`**（新 hook + `.is-pressed` class）：
   - H5：`onTouchStart` 立即加 `is-pressed`（反馈 ≤ 1 帧），`onTouchEnd/Cancel` 后**至少保持 90ms** 再移除，快速轻点也看得见；
   - weapp：使用 Taro 原生 `hoverClass='is-pressed' hoverStartTime={20} hoverStayTime={90}`；**自定义 tab 栏除外**（`d46b49c` 已证实 `hoverClass` 会生成 `catchtouchmove` 吞微移点击，tab 栏继续用自身 `bindtap` + 手动 class）。
   - 反馈形式：缩放 0.965（大按钮 0.985）+ 底色加深一级，去掉 `opacity` 闪烁。
3. **答题选项卡加按压态**：按下浅灰 + 下沉，松手才判定选中；保留现有微信轻震（`vibrateShort`）。
4. **异步按钮即时 pending**：`移出错题 / AI 变式 / 去刷 / 保存昵称` 点下即进入「处理中…」并禁用，接口返回后恢复或回滚（乐观更新）。
5. **进度点热区**：`qdot` 视觉 5px 不变，热区扩到 44px。
6. **文本链接**补 `padding` + 热区扩展（`sheet-link`、`docs-reset`、`review-toggle`）。
7. **可访问性**：可点 `View` 补 `role='button'` / `aria-label`（H5）。
8. **F9 周均虚线**：改为 `Taro.pxTransform()` 计算 `bottom`，与柱子同单位（属视觉位置变化，随本次原型一起确认）。
9. **验收**：Playwright 在 375×812 / 390×844 下断言所有可点元素 `getBoundingClientRect` 热区 ≥ 44px；微信开发者工具真机预览确认按下反馈（需用户真机，当前**未实机验证**）。
