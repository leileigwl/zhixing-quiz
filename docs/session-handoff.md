# Session handoff：交接清单

> 最后更新：2026-11-26 10:55 CST（**V3.0 已上线**：PR #11 合并为 main `6fa6ccb`，H5 已发布）

## 当前进度（V3.0 门头页 + 彩色视觉 + iPad 排布 + 备案贴底 · 2026-11-26 · 已上线 `6fa6ccb`）

- 上线：H5 已发布，`/opt/zhixing-quiz` 快进到 `6fa6ccb`，后端未重建（纯前端）。回滚：`cp -a /var/www/zhixing-quiz/h5.bak-20261126-1052/. /var/www/zhixing-quiz/h5/`。
- 部署密钥：沙箱 home 会被重置，新密钥 `hark-deploy-zhixing-2` 私钥放在工作区 `/workspace/.zx-keys/`（不入库），helper `/workspace/.zx-keys/ssh.py`；旧公钥 `hark-deploy-zhixing` 可从服务器 authorized_keys 删掉。
- MySQL 备份 cron 首次自动运行 2026-11-26 03:30 成功（12 张表）。

> 用户 2026-11-26 02:36 授权：配色改得更有颜色、新增公开门头页、修 iPad 排布与备案位置、加 E2E 与 CI，**做好直接上线，免确认原型**（AGENTS.md 原型门控按她的授权跳过，仍在 `docs/02-design/prototypes/v30-landing-and-color.html` 留设计记录）。

- [x] 门头页 `pages/landing/index`（仅 H5）；`authGuard`：未登录根路径 → 门头页，应用内页 → 登录页；已登录根路径 → 首页；门头页 / 登录页为公开页（`redirectToLogin` 在公开页不跳）。
- [x] V3.0 色彩 token（`app.scss`：靛紫主色 + 珊瑚 / 薄荷 / 天蓝 / 奶油黄 / 莓粉、hero 渐变），首页 / 口袋 / 曲线 / 我的 / 登录 / Dock / 侧栏已上色；`ProgressRing`、`OnboardingSteps`（示意已标注）、`utils/domainColor`。
- [x] iPad：根字号 ≥768 改 `clamp(24Px, 2.5vw, 26Px)`、内容宽 720→880，首页平板两列网格；备案页脚：`.zx-rpage` 纵向 flex + 页脚 `margin-top:auto`（贴底、在 Dock 之上）。
- [x] Playwright E2E（`frontend/e2e/`，`pnpm e2e`，mock 接口）本地 39 条通过（首轮）。
- [ ] 全量闸门、CI e2e job、PR、合并、上线、线上冒烟、截图归档。
- 截图：项目工作区 `v30-screens/`；截图脚本 `work/shot_v30.mjs`（不入库）。沙箱跑 Playwright 需 `NO_PROXY=127.0.0.1`。

---

## 上一轮（H5 基础问题修复 · 2026-11-25 · 已上线 `7248f76`）

- 回滚：H5 `cp -a /var/www/zhixing-quiz/h5.bak-20261125-2205/. /var/www/zhixing-quiz/h5/`；后端把 `zhixing-quiz-backend:prev-f70bdf3` 重新打成 prod 标签后 `up -d --no-deps api worker`。
- 线上浏览器冒烟（未登录进登录页、获取验证码先弹同意）Playwright 超时未跑通，curl 正常；本地生产构建 + mock 已验证。
- 待办：nginx 给 `.webmanifest` 补 `application/manifest+json`；下一轮视觉改版需先出原型（建议：主色区域与知识域配色、三步新手引导空状态、大数字/进度环/完成动效）。
- 备份 cron 首次自动运行 2026-11-26 03:30，查 `/var/log/zhixing-quiz-backup.log`。

> 用户 2026-11-25 21:22 反馈线上 H5 基础问题，要求先修基本问题、**本轮不做整体视觉改版**（配色与内容视觉她之后再定），授权 CI 全绿后合并并上线。图标补齐是她点名要求的，属于修复范围，未走原型门控；整体配色 / 内容改版仍须先出原型。

| # | 反馈 | 原因 | 修复 |
|---|---|---|---|
| 1 | 发验证码要先同意协议 | 只有「登录」检查勾选，「获取验证码」不检查 | 未勾选时点「获取验证码」/「登录」先弹同意确认，同意后自动勾选并继续，「暂不」不发送。注意 Taro/微信 `showModal` 按钮文字 ≤4 个汉字，超长直接失败（「同意并继续」踩过） |
| 2 | 邮箱不限类型 | 前后端正则只收 `[A-Za-z0-9._%+-]` 本地部分 + 纯字母顶级域；全角＠/「。」被拒；占位符写死 163 | 前后端同规则：RFC dot-atom 本地部分、任意域名、punycode / 中文域名（后端转 punycode）、NFKC 全角转半角；文案「支持任意邮箱」 |
| 3 | 不能改头像 | H5 点头像只弹 toast；后端没有上传接口（小程序也把 `wxfile://` 临时路径直接存库） | 新增 `POST /api/v1/user/avatar`（魔数校验、拒 SVG、≤2MB、限流、存 COS 或本地静态目录）；H5 选图→浏览器裁方压缩 256px→上传→即时显示；小程序先上传再存 https 地址。昵称修改在 H5 实测可用 |
| 4 | 新用户也有保持率 / 曲线 | 后端无数据时 `overall_retention=85`、照样画曲线、`streak=max(1,…)`；前端兜底 74%、「RAG 架构」示例域、假预测、`RetentionCurveCanvas` 少于 2 点画示意曲线 | 后端 `has_practice_data` / 域级 `has_practice`，无答题时 0 + 空曲线 + 无计划；前端各页空状态（`EmptyState`）+「去出第一组题」，无数据数字显示「—」 |
| 5 | 「计算机网络」不是自己的 | **前端** `groupDocumentsToPockets` 无文档时预置「计算机网络」「RAG 架构」两个示例口袋（保持 46%/78%）；后端注册不建域 | 删除示例口袋，空口袋显示上传引导；未练习口袋显示「未练习」。线上库查过：仅 1 个用户（id=1），0 个域 / 0 文档 / 0 测验，无需清理 |
| 6 | 填参考资料要直接带过去 | 「待解锁攻坚 · 点此填入」只往输入框塞一句「计算机核心高频考点」+ toast；新用户点「今日待巩固」跳到空曲线页 | 攻坚卡直接打开「导入参考资料」弹层并聚焦粘贴框；弹层内可直接上传文件，解析就绪后自动勾选；待巩固卡新用户直接聚焦出题框；口袋 / 我的页空状态按钮直接去上传 / 出题 |
| 7 | 图标也没有 | 卡片标题无图标；站点无 favicon / apple-touch-icon / manifest | `LineIcon`（SVG data URI 线性图标，H5 用原生 img）加到各卡片标题；品牌标生成 favicon.ico/svg、apple-touch-icon、icon-192/512、manifest（只进 H5 产物） |

**闸门（本地）**：后端 `ruff` 通过、`pytest` 275 passed；前端 `lint` 0 errors（4 条既有警告）、`typecheck` 通过、`test:coverage` 24 files / 230+ passed（lines ≈89 / branches ≈86.6 / functions ≈86.9，阈值 70 不变）、`build:h5` / `build:weapp` 通过。
**截图（mock 新用户后端，未连真实后端）**：项目工作区 `fix-screens/`（390 / 1032 / 1440 四个 tab 页、登录同意弹窗、攻坚卡打开资料弹层、换头像 + 改昵称），脚本 `work/shot_fix.py` + `work/mockapi_new.py`（不入库）。

**未实机验证**：iOS Safari / 微信内置浏览器选图（HEIC 转 JPEG）、真机上传头像到线上 `/static/quiz-images/avatars/`；小程序 `chooseAvatar` 上传（只编译通过）；真实邮箱发信。

---

## 上一轮（依赖安全升级 + MySQL 备份 · 2026-11-25 · 已上线）

> 用户 2026-11-25 授权：升级有漏洞的 Python 依赖、加 MySQL 每日备份，CI 全绿后自行合并并上线。另一个任务（zhixing-basic-fixes）同时在改前端/后端，本分支用独立 worktree，只动依赖 / 文档加载器 / deploy。

- [x] **Python 依赖**（`backend/pyproject.toml` + `uv.lock`）：pypdf 5.9.0 → **6.21.4**；cryptography 49.0.0 → **50.0.2**；langchain-core 0.3.86 → **1.8.4**、langchain-openai 0.3.35 → **1.8.5**、langchain-text-splitters 0.3.11 → **1.2.0**、langchain-chroma 0.2.6 → **1.2.0**、langchain-tavily 0.2.17 → 0.2.18（传递：langchain 0.3.30 → 1.5.2、langgraph 0.6.11 → 1.2.24、langgraph-checkpoint 3.0.1 → 4.3.2、langgraph-sdk 0.2.15 → 0.4.14）。删除未使用的 `langgraph` 直接依赖和 `langchain-community`（只用到 PyPDFLoader / Docx2txtLoader，改为直接调 pypdf / docx2txt，连带去掉 langchain 0.3、sqlalchemy、marshmallow）。
  - 为什么敢跨 langchain 1.x：漏洞修复版本全部在 1.x（0.3 线无修复）；代码只用 `ChatPromptTemplate`、`RunnableBranch/Lambda`、`Document`、`Embeddings`、`ChatOpenAI/OpenAIEmbeddings`、`Chroma`、`TavilySearch/Extract`、两个 splitter，这些在 1.x 无破坏性变化；ruff + 全量 pytest 通过，`ChatOpenAI(... max_tokens, request_timeout, max_retries, model_kwargs=response_format)` 构造与 `import app.main` 实测正常。**未用真实 LLM key 跑出题**（线上 key 仍为空）。
  - pypdf 6.x API：直接用 `PdfReader(path).pages[i].extract_text()`；加密 PDF 先试空密码，页数上限 `MAX_PDF_PAGES=500`，坏页跳过，损坏文件报友好错误；新增真实 PDF 单测（多页、空白页、损坏、超页数）。
- [x] **pip-audit 复查**：升级前 10 个包 128 条 → 升级后只剩 **chromadb 1.5.9（5 条，上游无修复版）**：CVE-2026-45829（未鉴权代码注入）、CVE-2026-45833、CVE-2026-45831、CVE-2026-45830。缓解：Chroma 服务只在 compose 内部网络（不映射宿主机端口），只有 api/worker 容器能访问；**风险仍在**——若 api 容器被攻破可横向利用。待 chromadb 发布修复版后升级（重建会同时更新 chroma 服务端镜像）。
- [x] **前端 pnpm audit**：`package.json#pnpm.overrides` 把 lodash-es 4.17.21 → 4.18.1、swiper 11.1.15 → 12.2.0（均为 Taro 传递依赖）。实测 H5 产物在 override 前后**逐字节一致**（项目未用 Swiper 组件，lodash-es 只在构建期），lint / typecheck / test:coverage（177 passed）/ build:h5 / build:weapp 通过。剩余 50 条（4 critical / 15 high）全部是构建与测试工具链：@tarojs/cli（download-git-repo→decompress/got/git-clone、adm-zip）、webpack 5.91 / webpack-dev-server / html-minifier / serialize-javascript / postcss(miniprogram-simulate) / esbuild / glob、vitest 3 / tinypool；不进入线上产物，修复需要 Taro 或 vitest 大版本升级，**本轮不硬升**，仅本地开发与 CI 有风险（不要用 dev server 打开不可信网页、不要 `taro init` 不可信模板）。
- [x] **MySQL 备份**：`deploy/backup-mysql.sh` + `bash deploy/deploy.sh backup-cron`（`/etc/cron.d/zhixing-quiz-backup`，每天 03:30，宿主机时区 Asia/Shanghai）；恢复步骤见 [`deploy.md` §4.1](deploy.md)。2026-11-25 21:35 已在服务器手动跑一次（脚本临时放 /tmp，ENV_FILE 指向线上 .env）：`/var/backups/zhixing-quiz/zhixing_quiz-20261125-213513.sql.gz`，gzip -t 通过、12 张表、`-- Dump completed`；导入临时库 `zq_restore_check` 演练恢复成功（12 表，users 行数与线上一致）后已删除。2026-11-25 21:46 已执行 `bash deploy/deploy.sh backup-cron` 安装 cron + logrotate，首次自动备份将在 2026-11-26 03:30 CST。
- [x] PR [#8](https://github.com/leileigwl/zhixing-quiz/pull/8) CI（backend + frontend）全绿后合并，main `f70bdf3`。
- [x] **上线（2026-11-25 21:47 CST）**：`git bundle` 上传 → 服务器 `/opt/zhixing-quiz` 快进到 `f70bdf3` → 旧镜像另存为 `zhixing-quiz-backend:prev-7c19fcb` → `compose build api`（阿里云内网 PyPI，按 uv.lock 哈希安装）→ `compose up -d --no-deps api worker`。**chroma 容器未重建**（仍跑旧镜像，同为 chromadb 1.5.9，避免无谓重启）；mysql / redis 未动。镜像内实测 pypdf 6.21.4 / cryptography 50.0.2 / langchain-core 1.8.4 / langchain 1.5.2 / langgraph 1.2.24。
- 冒烟：`https://study.leileigwl.cn/api/v1/health` 200 `{"status":"ok"}`、首页 200、hello-agent `127.0.0.1:8000` 200 且 `hello-agent-h5` active；未登录上传 `/api/v1/knowledge/documents` 返回 401（路由正常）；**在线上 api 容器内**用 pypdf 生成 2 页 PDF 调 `load_and_split` → 2 个分块、页码 0/1、文字正确（未写数据库）；api 容器连 chroma `heartbeat` 正常。api 145 MiB / worker 132 MiB，可用内存约 700 MB。
- 回滚后端：`docker tag zhixing-quiz-backend:prev-7c19fcb zhixing-quiz-backend:prod && docker compose --env-file backend/.env -f deploy/docker-compose.prod.yml -p zhixing-quiz-prod up -d --no-deps api worker`（并 `git reset --hard 7c19fcb`）。

**未实机验证**：登录后真实上传 PDF/Word → 向量化 → 出题全链路（线上 Embedding / LLM key 仍为空，上传会在向量化一步失败；只验证了解析环节）；langchain 1.x 下 ChatOpenAI 流式出题、OpenAIEmbeddings、TavilySearch 的真实调用；cron 03:30 首次自动执行（明早看 `/var/log/zhixing-quiz-backup.log`）。

**下一步 / 遗留**：
1. 明天确认 `/var/log/zhixing-quiz-backup.log` 有 03:30 记录、`/var/backups/zhixing-quiz/` 新增文件；建议加异地副本（OSS / ECS 快照），当前备份与库在同一块云盘。
2. 配好 LLM / Embedding key 后，用测试账号真实走一次上传 PDF → 出题，验证 langchain 1.x 链路。
3. chromadb 出修复版后升级并重建 chroma；前端工具链漏洞随 Taro / vitest 大版本升级处理。
4. 其余遗留同下文 V2.9 节（SMTP 真实发信、协议正文、上线前安全审计门控）。

**闸门（本分支）**：`uv run ruff check app tests` 通过；`uv run pytest -q` **246 passed**；`pnpm lint` 0 errors（4 条既有警告）；`typecheck` 通过；`test:coverage` 18 files / 177 passed（lines 87.5 / branches 87.57 / functions 86.01）；`build:h5` / `build:weapp`（占位 env）退出码 0。

---

## 更早（V2.9 响应式改版 · 2026-11-25 · 已上线）

> 用户 2026-11-25 20:19 确认 V2.9 原型，唯一改动：**iPad 竖屏 768–1099 保留底部 Dock，只把内容加宽居中（最大宽 720），导航不放左边**；其余按原型默认。授权 agent 自行判断细节、CI 全绿后自行合并 PR 并上线 https://study.leileigwl.cn 。

- [x] PR #3（部署文件）已合并（main `dc3a060`）。
- [x] PR ① [#4](https://github.com/leileigwl/zhixing-quiz/pull/4) 已合并（main `d05f88c`）：导航外壳（`ResponsiveNav` = 手机/竖屏底部 Dock、≥1100 `SideNav` 侧栏）+ 备案页脚 `IcpFooter` + 全局手感（focus-visible / hover / 44px 热区 / 内容容器 720·1120）+ `useViewportTier` / `tierFromWidth` + **修复「未登录时地址是登录页、画面是首页」** + 登录邮箱记录与 `logout()`；原型与改动清单已按竖屏决定同步修改。
- [x] PR ② [#5](https://github.com/leileigwl/zhixing-quiz/pull/5) 已合并（main `35f5a33`）：四个 tab 页宽屏多栏（首页 7:5 + 本周完成题数卡、口袋 5:7 / 竖屏 3 列、曲线 8:4 + Canvas 随宽度重绘、我的 4:8 sticky）+「我的」账号区（邮箱 + 退出登录）+ 小胶囊热区统一扩到 44px。
- [x] PR ③ [#6](https://github.com/leileigwl/zhixing-quiz/pull/6) 已合并（main `7c19fcb`）：答题（竖屏 680 窄栏 + sticky 操作栏；宽屏 5:7 并排 + 键位提示；键盘 1–4/A–D、Enter、← 由 `pages/quiz/quizKeys.ts` 决定）/ 登录（竖屏 440 白卡、宽屏左品牌面板）/ 复盘（宽屏侧栏 + 7:5）/ 首页两个弹层 ≥768 居中对话框 + `useEscClose` / 答题、登录、复盘页备案号。
- [x] **上线（2026-11-25 21:00 CST）**：沙箱 `TARO_APP_API_BASE_URL=https://study.leileigwl.cn/api/v1 pnpm build:h5`（构建自 `7c19fcb`）→ 服务器旧目录备份为 `/var/www/zhixing-quiz/h5.bak-20261125`（`deploy.sh web` 另留 `h5.prev`）→ 发布到 `/var/www/zhixing-quiz/h5`。服务器 `/opt/zhixing-quiz` 已快进到 `7c19fcb`（服务器访问 GitHub 超时，用 `git bundle` 上传后 fetch；原手工拷贝的 deploy 文件与仓库逐字节一致，已备份到 `/root/zq-predeploy-20261125/` 后清理）。后端自 `18eeab8` 起只有 Dockerfile/.dockerignore 变化且与运行中镜像一致，**未重建 api/worker**。
- 冒烟：首页 200、`/api/v1/health` 200 `{"status":"ok"}`、hello-agent `127.0.0.1:8000` 200 且服务 active、5 个容器 healthy/up；未登录访问 `/`、`/#/pages/index/index`、`/#/pages/mastery/index`、`/#/pages/profile/index`、`/#/pages/quiz/index`（正常 + 6 倍 CPU 降速）均稳定显示登录页；线上手机 390 / 电脑 1440 截图无溢出、无 JS 报错、备案号链接 `https://beian.miit.gov.cn/`。

**闸门（PR ③ 合并时）**：`pnpm lint` 0 errors（4 条既有 exhaustive-deps 警告）；`typecheck` 通过；`test:coverage` 18 files / 177 passed，lines 87.5 / branches 87.57 / functions 86.01（阈值 70 不变）；`build:h5` / `build:weapp`（占位 env）通过；weapp 产物 wxss 规则集合与改动前一致；GitHub CI 三个 PR 均 backend + frontend 全绿。后端未改动，未在本地重跑 ruff / pytest（CI 已跑且通过）。

**登录 bug 结论**：确有 bug，非偶发。无 token 直接打开 `/#/pages/index/index`（刷新首页、书签）时，App 在首页挂载过程中 `reLaunch` 到登录页，hash 变了但 Taro H5 路由随后又把首页设为可见。修复为 `services/authGuard.ts`：在 Taro 路由初始化前（`app.ts` 模块顶层）同步把地址切到登录页；token 过期（4010）路径也验证会回登录页。单测 `authGuard.test.ts`。

**未实机验证**：iOS Safari / iPad 真机（触控、旋转、外接键盘）/ 微信内置浏览器 / Android；登录后的线上页面（无测试账号，宽屏布局只在本地构建 + 假后端数据上截图验证）；weapp 未在微信开发者工具中打开（仅比对编译产物）。

**下一步 / 遗留**：
1. 用户在 iPad / 手机 / 电脑真机登录后走一遍首页 → 出题 → 答题（试键盘）→ 复盘 → 我的 → 退出登录。
2. 既有遗留仍有效：LLM / Embedding / Tavily 生产 key 未配置（出题不可用）；SMTP 真实发信未验证；pypdf / cryptography 漏洞；MySQL 无定时备份；《用户协议》《隐私政策》正文仍是占位；上线前安全审计门控（AGENTS.md）尚未执行。
3. 回滚 H5：`cp -a /var/www/zhixing-quiz/h5.bak-20261125/. /var/www/zhixing-quiz/h5/`（或 `h5.prev`）。
4. 截图脚本与假后端数据在项目工作区 `work/shot_v29_app.py`、`work/mockapi.py`（不入库）；截图在 `v29-screens/`。

---

## 本轮（2026-11-25）· V2.9 H5 响应式布局原型（分支 `design/v29-responsive`，仅本地提交）

- 只出原型、未改 `frontend/`：[`v29-responsive-layout.html`](02-design/prototypes/v29-responsive-layout.html)（2026-11-25 已确认并实现，见顶部），覆盖 4 个 tab 页 + 答题 / 复盘 / 登录（V2.8 宽屏版），断点 `<768` / `768–1099` / `≥1100`，页底备案号「浙ICP备2026102405号-1」；文件内附断点与改动清单、工作量与 Taro H5 实现方式。索引已更新。
- 校验：Playwright 在 390 / 820 / 1180 / 1440 四宽度打开原型逐页检查，无横向溢出、无文字截断、无 JS 错误；首页截图存于项目工作区 `proto-screens/`（不入库）。未跑前端闸门（无代码改动）。
- 待决：用户确认原型及 3 个设计选择（平板导航形态 / 答题宽屏并排 / 手机端备案号位置）后再按清单分 3 个 PR 实现。

---

## 本轮（2026-11-24 · 下午）· H5 邮箱验证码登录

**当前阶段**：用户决定小程序（个人主体）上线暂缓，**H5 为主目标**；短信 / 微信手机号组件不可用，改为「邮箱 + 6 位验证码」登录，经个人邮箱（163/QQ 授权码）通用 SMTP 发送。**用户已于 2026-11-24 明确批准该鉴权范围变更**，并要求同步做原型与实现、出 PR 描述。

### 本轮做了什么
1. 后端：`POST /api/v1/auth/email/send-code`、`/auth/email/verify`（HMAC 存码、10 分钟 TTL、每码 5 次、常量时间比较、单次使用；邮箱 60s 冷却 / 每日 10 次 / IP 限流；不泄露账号存在性；签发与微信登录同一 JWT）；通用 SMTP 发信（仅 `SMTP_*` 配置），dev/test 无 SMTP 时控制台打印验证码，production 缺 SMTP 或 Redis 返回 503；`users.email` 可空唯一列 + 启动幂等列/索引迁移。
2. 原型：[`v28-email-login.html`](02-design/prototypes/v28-email-login.html)（**待用户视觉确认**）。
3. 前端：H5 登录页 `pages/login/index`、`api.ts` 发码/校验/401→登录页、纯逻辑 `emailLogin.ts` + `useCountdown.ts`；weapp 仍 `wx.login`，开发态 H5 仍 dev-login。
4. 文档：README（SMTP 授权码配置）、PRODUCT / PRD / ARCHITECTURE / system-architecture（含 §4.1 迁移 SQL）、PR 描述 [`docs/pr/feat-email-otp-login.md`](pr/feat-email-otp-login.md)。

### 实际执行的命令与结果
- `cd backend && uv run ruff check app tests` → `All checks passed!`
- `cd backend && uv run pytest -q` → **`242 passed`**（原 199 + 新增 43）
- `cd frontend && pnpm lint` → `0 errors, 4 warnings`（既有）；`pnpm typecheck` → 通过
- `pnpm test:coverage` → **`11 files / 124 passed`**，lines 85.36 / branches 84.52 / functions 84.07
- `TARO_APP_API_BASE_URL=https://api.example.com TARO_APP_ALLOW_PLACEHOLDER_API=1 pnpm build:h5` / `pnpm build:weapp` → 均退出码 0（沙箱 `frontend/dist/` 现为占位地址生产包）
- 冒烟：本地 uvicorn（无 MySQL/Redis）+ `aiosmtpd` 假 SMTP，`send-code` 实际经 smtplib 投递成功、邮件主题/发件人/正文正确，429/4011/4012/5030 符合预期；Playwright 打开 H5 构建产物（拦截 API），无 token 自动进登录页 → 发码倒计时 → 错码提示 → 登录后回首页并写入 token，无页面 JS 错误。
- **未实机验证**：未用真实 163/QQ 邮箱发信（授权码、日发信上限、垃圾箱概率未验证）；未连真实 MySQL/Redis 跑完整 verify 建号；未在 iOS Safari / Android / 微信内置浏览器真机测试；GitHub CI 未实际运行（未 push）。

### 未决事项 / 下一步
1. **请用户对照 V2.8 原型确认登录页视觉**，有调整先改原型再改页面。
2. 用户配置 163/QQ 授权码后做一次真实发信 + 登录冒烟（含垃圾箱检查）；生产反代设置 `CLIENT_IP_HEADER=X-Real-IP` 并确认代理覆盖该头。
3. 补《用户协议》《隐私政策》正文（当前为占位弹窗）；「我的」页补「退出登录」。
4. 后续：小程序扫码绑定同一邮箱账号（需设计 `em_` 伪 openid 与微信 openid 的绑定 / 合并策略）。
5. 上线前按 AGENTS.md 执行安全审计门控（本 PR 新增公开接口）。
6. 之前遗留的 V2.7 原型确认等事项仍有效（见下文）。

---

## 本轮（2026-11-24 · 上午）· Phase 0（分支 `chore/phase0-ci-and-frontend-tests`）

### Phase 0：工程化闸门 + 记忆曲线修复 + 点按手感审计

**当前阶段**：在 V2.4 基础上进入「vmark 式工程流程」Phase 0——H5 为主目标、weapp 次之。本轮只做工程化、逻辑修复与原型，**未改任何前端视觉样式**（样式提案见 V2.7 原型，待用户确认）。

### 本轮做了什么
1. **CI**：`.github/workflows/ci.yml`（`pull_request` + push `main`，`concurrency` 取消旧运行）。backend：uv + Python 3.12 → `uv sync --frozen` → `ruff` → `pytest`；frontend：pnpm（`packageManager: pnpm@10.20.0`）+ Node 22 → `install --frozen-lockfile` → `lint` → `typecheck` → `test:coverage` → `build:h5` / `build:weapp`（占位 `TARO_APP_API_BASE_URL=https://api.example.com` + `TARO_APP_ALLOW_PLACEHOLDER_API=1`），依赖缓存。
2. **前端测试基建**：Vitest 3 + jsdom + Testing Library + coverage-v8；`test/mocks/taro.ts`、`test/mocks/components.tsx` 替身（globalThis 单例，支持 `vi.resetModules()` 重新加载有模块级状态的服务）；时区固定 `Asia/Shanghai`。脚本：`test` / `test:watch` / `test:coverage` / `lint` / `check:all`。ESLint 9 flat config（`react-hooks/rules-of-hooks: error`，已验证能拦住 #310 那类「早 return 后调用 Hook」）。
3. **测试**：`api.ts`（BASE_URL/Bearer、业务错误、404、4010 静默重登重放、重登失败不无限重试、无登录通道直接抛错、任务/报告轮询完成/失败/超时/取消）、`backgroundQuizManager.ts`（订阅即推送、退订、反复订阅不累积监听器、running→计时→阶段文案→completed、停留发起页自动跳转、运行中防重复、失败停表、失败后可重发）、`quizSessionStore.ts`、`v2Adapters.ts`、`RetentionCurveCanvas` / `SevenDayRhythmBar` 抽出的纯数据层 `chartModel.ts` / `rhythmModel.ts`（绘制与 DOM 输出保持不变）、`config/apiBaseUrl.ts`。覆盖率阈值（仅统计被测逻辑文件）：lines/statements 70、functions 70、branches 70，当前 81.25 / 81.25 / 78.48 / 81.08。
4. **生产构建 fail-fast**（HANDOFF §4-1）：`frontend/config/apiBaseUrl.ts`，缺失 / 非 https / 占位域名直接中止构建；已实测 3 种失败场景退出码 1、占位放行后两端构建成功。
5. **Git hooks**：`.githooks/pre-commit`（暂存前端文件 ESLint + tsc、后端 ruff、拦截 `.env` 与 `backend/data/`）、`.githooks/pre-push`（`pnpm check:all` + ruff + pytest）；`bash scripts/setup-git-hooks.sh` 启用（本沙箱克隆已启用并实际触发过）。
6. **AI 配置**：`AGENTS.md` 声明为唯一事实来源并新增「质量闸门」；`CLAUDE.md` 仅 `@AGENTS.md`；中文 PR 模板与 bug / feature Issue 模板。
7. **修复「学习记忆曲线每天看起来一样」**（`fix(mastery)`，含前后端回归测试）：
   - 后端根因①：总览态「若巩固」= `max(今日+8, 掌握分×0.55+44)`，今日保持率低于约 `掌握分×0.55+36` 后，右半段（若巩固 / +3 / +7 / +14 天）只由静态掌握分决定，日日相同 → 改为锚定今日实时保持率：`今日 + (100-今日) × (0.35 + 0.4×掌握分/100)`。
   - 后端根因②：「全部域」视图左段取全局最近测验、右段却是 focus 域保持率 → 历史改按 focus 域查询。
   - 前端根因③：`/mastery/overview` 任意失败（含生产 H5 无登录）都静默回退 `buildFallbackMasteryOverview`，其曲线（92/74/58/46/…/72/60）与周节律柱高（48/64/35/78…）都是写死的 → 改为由真实历史推算（实测节点 → e^(-t/S) 衰减到今天 → 投影），无历史时返回空曲线。
   - 前端根因④：`buildRealCalendarStrip` 用 `toISOString()`（UTC），北京时间 0~8 点日期错一天 → 改本地日期。
8. **点按手感审计 + V2.7 原型**：[`docs/02-design/tap-feel-audit.md`](02-design/tap-feel-audit.md)、[`v27-tap-feel-and-retention-curve.html`](02-design/prototypes/v27-tap-feel-and-retention-curve.html)（**待用户确认**，确认前不改 `frontend/` 样式）。
9. 顺带：修复 `backend/app/llm/langchain_factory.py` 的 ruff I001（main 上 `ruff check` 原本是失败的）。

### 实际执行的命令与结果（2026-11-24，本沙箱 Linux / Node 22.23 / Python 3.12.16 / uv 0.13.9 / pnpm 10.20.0）
- `cd backend && uv run ruff check app tests` → `All checks passed!`
- `cd backend && uv run pytest -q` → **`199 passed`**（原 193 + 新增 `tests/test_mastery_curve_daily_variation.py` 6 个；其中 3 个在修复前实测失败）
- `cd frontend && pnpm install --frozen-lockfile` → 成功
- `pnpm lint` → `0 errors, 4 warnings`（均为既有页面 `react-hooks/exhaustive-deps` 警告，未改页面代码）
- `pnpm typecheck` → 通过
- `pnpm test:coverage` → **`7 files / 77 passed`**，覆盖率达阈值
- `TARO_APP_API_BASE_URL=https://api.example.com TARO_APP_ALLOW_PLACEHOLDER_API=1 pnpm build:h5` / `pnpm build:weapp` → 均退出码 0（注：本沙箱 `frontend/dist/` 现为占位地址的生产包，本地调试请重新 `pnpm build:weapp:local`）
- `.githooks/pre-push` 手动全量执行 → 通过；之后的提交均经 `pre-commit` 实际触发
- 原型：Playwright（headless Chromium）打开 V2.7 原型截图检查，`pageerror` / console error 为 0
- **未实机验证**：未启动 FastAPI / MySQL / Redis / Chroma，曲线修复只经单元测试与 mock 验证，未在真实账号数据上逐日观察；点按审计为 SCSS 静态推算，未在 iOS Safari / Android / 微信真机测量；GitHub Actions 工作流未在 GitHub 上实际运行过（无推送凭据）。

### 未决事项 / 下一步
1. **请用户确认 V2.7 原型**（点按手感 + 记忆曲线时间轴重设计），确认后按审计「三、修复提案」落地 `usePressable` / 热区 / 曲线新布局，并补 Playwright 热区 ≥44px 断言。
2. ~~**H5 生产登录方案（需用户决策）**~~（2026-11-24 已决：邮箱验证码登录，见本文件顶部）：生产 H5 没有任何登录通道（只有 weapp `wx.login` 与 dev-login），H5 作为主目标上线前必须定方案；涉及鉴权范围，按规则先问用户。
3. `SevenDayRhythmBar` 周均虚线内联 px 与柱子设计稿 px 单位不一致（位置约偏高 1 倍），随 V2.7 原型一起确认后修。
4. 后端 `live_retention = 100·e^(-t/S)` 不考虑交卷时的 `retention_rate`（刚交卷恒为 100%），是否改为 `retention_rate·e^(-t/S)` 属模型口径，待确认。
5. `inferDomainFromText` 关键词 `词` 过宽（「唐诗宋词」会被归到「核心英语」），待产品确认关键词表。
6. 4 条既有 `exhaustive-deps` 警告、`api.ts` 覆盖率 59% 可在后续逐步收紧；推送后在 GitHub 上确认 CI 首次运行结果。

---

## 上一轮（2026-11-12）· V2.4

### 当前阶段（V2.4）

**`zhixing-quiz` V2.4（在 V2.3 基础上完成「后端全链路 5 段耗时 + 流式首字 TTFT / 中途断流自动重连监控与诊断压测脚本」、「等待文案移除『可逛其他页』与首页双重计时去重 + 跨页 `originTag` 精准隔离」、以及「曲线页重构为纯洞察看板 + 至多 1 枚轻重练入口」）已完成原型门控确认、前后端实现、双端编译与 Playwright 全流程验收。**

### 已完成核心改造

1. **V2.4 后端全链路 5 段耗时与流式 TTFT 监控 + 自测诊断脚本（[`quiz_chain.py`](../backend/app/llm/quiz_chain.py)、[`quiz_service.py`](../backend/app/services/quiz_service.py)、[`task_repository.py`](../backend/app/repositories/task_repository.py)、[`monitor_quiz_latency.py`](../backend/scripts/monitor_quiz_latency.py)）**：
   - 保持 `.env` 当前 `deepseek-ai/DeepSeek-V3.2` 与 Prompt 不变（待后续测试新模型），新增 `QuizTaskTelemetry` 结构并拆解 `queue_wait_ms`、`domain_classify_ms`、`rag_search_ms`、`llm_ttft_ms`（首字延迟）、`llm_total_ms`、`completion_tokens`、`tps`、`db_save_ms` 与 `attempt` / `retry_reason`。
   - `generate_quiz_with_telemetry` 通过 `chain.astream(...)` 实时追踪首字停顿（`>30s`）与中途断流（`>25s`）并自动快速重试 1 次（不半路误杀正常吐字），同时推送实时进度 `AI 正在编排第 X/Y 题...`。
   - 3 组对照监控实测已精确定位慢因：ARQ 排队（`77~482ms`）、域分类（`4~95ms`）、Tavily（`1.2~3.2s`）、落库（`46~71ms`）均正常，瓶颈在 `DeepSeek-V3.2` 吞吐 `20.1~21.8 tok/s` 且 3~6 题输出达 `958~1,869 tokens`（`50.21s~89.65s`）。
2. **V2.4 等待文案精简、首页防重计时与按钮态精确隔离（[`pages/index/index.tsx`](../frontend/src/pages/index/index.tsx)、[`BackgroundTaskPill`](../frontend/src/components/BackgroundTaskPill/index.tsx)、[`backgroundQuizManager.ts`](../frontend/src/services/backgroundQuizManager.ts)、[`pages/knowledge/index.tsx`](../frontend/src/pages/knowledge/index.tsx)、[`pages/profile/index.tsx`](../frontend/src/pages/profile/index.tsx)）**：
   - 彻底清除前端所有「可逛其他页」「可先切页浏览或刷错题」提示文案；首页主按钮仅保留简洁 `出题中 (Xs)`，在首页等待时不重复叠放底部悬浮胶囊，切离首页后再展示单条实时阶段胶囊。
   - 为口袋文档（`knowledge-doc:${doc_id}`）与我的错题卡（`profile-card`）补全 `originTag` 精确隔离，避免首页出题时其他页按钮连带误转圈。
3. **V2.4 曲线页「纯洞察 + 至多 1 枚轻入口」重构（[`v2-mastery-and-progress-redesign.html`](02-design/prototypes/v2-mastery-and-progress-redesign.html)、[`pages/mastery/index.tsx`](../frontend/src/pages/mastery/index.tsx)、[`pages/mastery/index.scss`](../frontend/src/pages/mastery/index.scss)）**：
   - 先通过原型确认后重构曲线页：`schedule-card` 改为轻巧「下次遗忘节点」洞察卡（移除 `按曲线安排出题 →` 大按钮）；移除底部巨型 `秒开清零 / 再刷一组` 按钮与每张错题卡下方的 `秒开重做 / AI 变式` 按钮群。
   - 仅当存在待巩固错题时在「待巩固错题」标题旁放 1 枚轻胶囊 `重练 N 题 ›`（与实际 `slice(0, 6)` 抽取题数精确对齐），无错题时整页 `0` 个刷题按钮。
4. **V2.3 / V2.2 / V2.1 核心底座能力（一并保留）**：
   - Redis + ARQ 域级 Pre-Warm 预热池（`allow_prewarm: true`）、差异化实测+预测双轨曲线、周明细与印章下钻、未交卷草稿分离、3 步诊断结论、自包含 `custom-tab-bar` (`4350` B 独立 `index.wxss`)。

### 已执行的真实校验（2026-11-12，基于 V2.4 最终代码重跑）

- **后端静态检查、单测与实时 3 组对照监控**：
  - `cd /Users/leileigwl/Work/Learn/new/zhixing-quiz/backend && uv run ruff check app tests` -> **`All checks passed!`**
  - `cd /Users/leileigwl/Work/Learn/new/zhixing-quiz/backend && uv run pytest -q` -> **`191 passed`**（含 V2.4 TTFT 假死重试与 `QuizTaskTelemetry` 透传测试）。
  - `uv run python scripts/monitor_quiz_latency.py` 实测 3 组全部 `completed`：分布式锁 3 题·联网 `73.07s`（`20.9 tok/s`）、RAG 检索 3 题·纯 LLM `50.21s`（`20.1 tok/s`）、HTTP/3 自适应 6 题·联网 `89.65s`（`21.8 tok/s`）。
- **双端编译与 Playwright 移动端 H5 V2.4 E2E（`375×812` & `390×844`）**：
  - `pnpm typecheck`、`NODE_ENV=development pnpm build:h5` 与 `pnpm build:weapp:local` 均退出码 `0`（`frontend/dist/` 保留最新微信小程序构建产物，含独立 `dist/custom-tab-bar/index.wxss`）。
  - Playwright 实测：首页等待中不渲染重复 `.bg-pill` 且按钮只显示 `出题中 (Xs)`、切换至口袋页时文档按钮维持 `出题 →` 且悬浮胶囊实时展示 `AI 正在编排 3 道题目...`、曲线页 `.schedule-go=0` / `.btn-secondary-ai=0` / `.zx-btn-obsidian=0` 且仅有 `1` 枚标题旁轻重练胶囊、`PAGE_ERRORS: 0`、`CONSOLE_ERRORS: 0`、`HTTP_ERRORS: 0`。

### 本地已启动服务状态（2026-11-12 开发机记录，本轮沙箱未启动这些服务）

- `zhixing-quiz-mysql-1` (`127.0.0.1:3306`, Healthy) & `zhixing-quiz-redis-1` (`127.0.0.1:6379`, Healthy)
- Standalone Chroma HTTP Server (`127.0.0.1:8001`)
- ARQ Worker (`uv run arq app.workers.arq_worker.WorkerSettings`)
- FastAPI 2-Worker API (`http://127.0.0.1:8000`) & Taro H5 Dev Server (`http://127.0.0.1:10086`)

### 尚待生产部署确认项

- 本机 `.env` 已配置真实 LLM、Embedding 与 Tavily 联网搜索配置；若在微信真机启用一次性订阅消息提醒，仍需在 `.env` 填入 `WECHAT_SUBSCRIBE_TEMPLATE_ID`、`WECHAT_APP_ID` / `WECHAT_APP_SECRET` 并在微信开发者工具打开 `frontend/dist/` 做真机测试；若需使用 Endor 云端漏洞审计，请先在本机安装并登录 `endorctl`。
