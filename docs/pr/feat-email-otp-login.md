# feat: H5 邮箱验证码（OTP）登录

> 分支：`feat/email-otp-login`（基于 `chore/phase0-ci-and-frontend-tests`，仅本地提交，未 push）  
> 鉴权范围变更已由仓库所有者于 **2026-11-24** 明确批准。  
> **UI 依照 V2.8 原型 [`docs/02-design/prototypes/v28-email-login.html`](../02-design/prototypes/v28-email-login.html) 实现，待用户视觉确认**；如需调整请先改原型再同步页面。

## 背景

- 小程序为个人主体，上线暂缓；**H5 成为当前主要目标**。
- 生产 H5 此前没有任何登录通道（只有 weapp `wx.login` 与非生产 `dev-login`），无法对外开放。
- 个人主体无法使用短信验证码与微信手机号组件，因此采用 **邮箱 + 6 位验证码**，经普通个人邮箱（163 / QQ 授权码）的通用 SMTP 发送；服务商只由环境变量决定，后续切换阿里云 DirectMail 只改 `.env`。
- `wx.login` 与 `dev-login` 保持不变；小程序扫码绑定同一账号为后续需求（本 PR 不做）。

## 改动

### 后端（FastAPI）
- **新接口**（前缀 `/api/v1`，公开）：
  - `POST /auth/email/send-code {email}`：校验并规范化邮箱 → 生成 6 位码（`secrets`）→ 以 `HMAC-SHA256(JWT_SECRET, email:code)` 存储（TTL 10 分钟，重新获取覆盖旧码）→ SMTP 发信。限流：同邮箱 60s 冷却（`SET NX EX`）、同邮箱每日 ≤10 次、同 IP 每小时 ≤20 次。响应与账号是否存在无关，不回传验证码。发信失败作废本次码并释放冷却（当日次数照计）。
  - `POST /auth/email/verify {email, code}`：每码最多 5 次（Redis Lua 原子计数）、`hmac.compare_digest` 常量时间比较、成功即删除（以 `DEL` 返回值保证并发单次使用）；同 IP 每 10 分钟 ≤30 次。按邮箱查/建用户，签发与微信登录**完全相同**的 JWT（`user_id` 隔离规则不变）。
  - 错误码：`4011` 邮箱格式、`4012` 错误或过期（含「还可尝试 N 次」）、`4013` 次数超限（码作废）——均 HTTP 400，**刻意避开 4010** 以免前端误触发静默重登；`4290` 限流；`5030` 依赖不可用（HTTP 503）。
- **存储**：Redis 优先（`zx:otp:code:*` / `zx:otp:cd:*`，键名为邮箱 sha256 摘要，不含明文邮箱）；开发/测试无 Redis 时回落进程内存；**production 无 Redis 时返回 503**（多 Worker 下内存不共享）。
- **邮件**（`app/services/mail_service.py`）：`smtplib` 在线程池执行；`SMTP_USE_SSL=true` 走 465 SSL，否则明文连接后按服务器能力 STARTTLS；中文纯文本 + HTML 双版本模板，主题「知行快刷 验证码」。未配 SMTP 时：dev/test 控制台后端（验证码打日志）；**production 返回 503**，启动日志告警 `email_login_disabled`（不阻断其它功能启动）。
- **数据库**：`users` 新增 `email VARCHAR(254) NULL` + `UNIQUE KEY uk_users_email`。沿用仓库既有的启动幂等迁移（`COLUMN_MIGRATIONS` + 新增 `INDEX_MIGRATIONS`，`INFORMATION_SCHEMA` 检查后 `ALTER`），新库建表 DDL 同步包含该列。邮箱用户 `openid = 'em_' + sha256(email)[:40]` 以满足 `openid NOT NULL UNIQUE`；并发重复注册（1062）回查已存在用户。
- `rate_limit.check_rate_limit(_async)` 增加可选 `message` 参数（默认文案不变）。
- 新环境变量：见下文「部署步骤」。

### 前端（Taro H5 / weapp）
- 原型：`docs/02-design/prototypes/v28-email-login.html`（MOVEPOP 暖石膏，可切换模拟后端返回逐一查看错误态）。
- 新页面 `pages/login/index`：邮箱输入（可清空）、「获取验证码」60s 倒计时（以结束时间戳计算，切后台不走慢）、6 位数字验证码（粘贴自动去非数字）、《用户协议》《隐私政策》勾选（占位弹窗）、黑曜石「登录」主按钮；就地红字 / 顶部非阻塞提示条两类错误展示；所有可点元素热区 ≥44px（实测 H5 构建：按钮 54px 高、勾选/清空 46×46），按下态 `hoverClass` + `hoverStayTime=90ms`。
- `services/api.ts`：`sendEmailCode` / `verifyEmailCode`（成功后与 wx.login 一致地保存 token 与用户、解除登录等待）、`AuthApiError`（携带业务码）、`redirectToLogin`（仅 H5，去重、已在登录页不跳）。H5 无 token 且无法静默登录、或 4010 重登失败时 `reLaunch` 到登录页；登录成功 `reLaunch` 回「今日」。**weapp 行为不变**（`wx.login`），开发态 H5 仍自动 dev-login。
- 纯逻辑 `services/emailLogin.ts`（校验 / 倒计时 / 按钮文案 / 错误映射）与 `services/useCountdown.ts`（Hook），均无 Taro 依赖。
- 测试替身：`Input`/`Textarea` mock 透传 Taro `e.detail.value`，新增 `Taro.reLaunch` mock。
- `vitest.config.ts` 覆盖率统计**新增** `src/pages/login/index.tsx`（阈值未改动）。
- 既有 2 个用例按新需求更新期望（非放宽）：生产 H5 无 token / 4010 重登失败，原先断言「直接抛错」，现在断言「跳转登录页并抛错」；另加「已在登录页时不重复跳转」用例保留原错误文案。

### 文档
- `README.md`（163/QQ 授权码 SMTP 配置）、`docs/PRODUCT.md`、`docs/01-product/PRD.md`、`docs/ARCHITECTURE.md`、`docs/02-design/system-architecture.md`（接口契约、安全细节、§4.1 迁移 SQL）、原型 README、`docs/session-handoff.md`。

## 测试

本地沙箱（Linux · Python 3.12 · uv · Node 22 · pnpm 10.20.0）实际执行：

| 命令 | 结果 |
| --- | --- |
| `cd backend && uv run ruff check app tests` | `All checks passed!` |
| `cd backend && uv run pytest -q` | **242 passed**（原 199 + 新增 43） |
| `cd frontend && pnpm lint` | 0 errors，4 warnings（均为既有页面 `exhaustive-deps`，本 PR 未新增） |
| `pnpm typecheck` | 通过 |
| `pnpm test:coverage` | **11 files / 124 passed**（原 77 + 新增 47）；覆盖率 lines 85.36 / branches 84.52 / functions 84.07 |
| `TARO_APP_API_BASE_URL=https://api.example.com TARO_APP_ALLOW_PLACEHOLDER_API=1 pnpm build:h5` | 退出码 0（仅既有包体积告警） |
| 同上 `pnpm build:weapp` | 退出码 0（`dist/pages/login/*` 已生成，weapp 不会跳转该页） |

后端新增用例覆盖：发码→校验成功签发 JWT、新用户建号 / 老用户复用、响应不泄露注册状态、错误码剩余次数、格式错误不消耗次数、过期、5 次上限作废、单次使用、重发作废旧码、60s 冷却、每日上限、按 IP 限流（含 `CLIENT_IP_HEADER`）、非法邮箱、未发码直接校验、**邮箱登录 JWT 访问 `/user/profile` 成功 / 无 token 401**、SMTP 失败 503 后可立即重试、production 缺 SMTP / 缺 Redis 返回 503、控制台后端仅限非生产、SMTP SSL 登录与邮件内容、STARTTLS、SMTP 认证失败映射、Redis 存储原子语义（fake client）、`users.email` DDL 与索引幂等迁移、repository 查找 / 插入 / 1062 回查。SMTP 发送在单测中全部 mock。

额外冒烟（非单测）：
- 本地启动 uvicorn（无 MySQL / Redis）+ 本地 `aiosmtpd` 假 SMTP：`send-code` 真实走 `smtplib` 投递成功，收到主题「知行快刷 验证码」、发件人「知行快刷 <…>」、正文含 6 位码与 HTML 版本；冷却 429、非法邮箱 4011、错码 4012（剩 4 次）、SMTP 不可达 5030 均符合预期；`verify` 正确码因无 MySQL 在建号步骤返回 500（预期，未连库）。
- Playwright（headless Chromium，390×844）打开 `build:h5` 产物、拦截 API：无 token 启动自动进入 `#/pages/login/index` → 发码倒计时 → 错码显示「还可尝试 4 次」→ 正确码登录后跳回 `#/pages/index/index` 且 token 写入本地存储；无页面 JS 错误。

## 风险

- **未实机验证**：未用真实 163/QQ 邮箱发信（授权码、日发信上限、进垃圾箱概率均未验证）；未在 iOS Safari / Android / 微信内置浏览器真机测试；未连真实 MySQL / Redis 跑完整登录（`verify` 建号仅 mock 与 repository 单测）。
- 个人邮箱 SMTP 有日发信量上限且易被判垃圾邮件；用户量上来需切阿里云 DirectMail（仅改 env）。
- 生产必须 Redis 在线，否则邮箱登录 503（其余功能不受影响）。
- 反向代理后需设置 `CLIENT_IP_HEADER=X-Real-IP`，否则所有请求按代理 IP 共享「每小时 20 次发码」额度；同时请确认代理会**覆盖**该头（防伪造绕过）。
- 验证码在建号/查库前已被消费：若此时数据库异常，用户需重新获取验证码（不影响安全性）。
- 《用户协议》《隐私政策》为占位弹窗，正式公开前需补正文。
- 暂无「退出登录」入口；H5 账号切换需清除站点数据（后续可在「我的」页补）。
- 邮箱用户 JWT 中 `openid` 为伪 openid（`em_…`），后续做小程序扫码绑定时需设计合并 / 绑定策略。
- UI 尚待用户对照原型做视觉确认。

## 部署步骤

1. **数据库**：后端启动时 `init_mysql()` 会自动幂等补齐；若生产关闭了 `MYSQL_AUTO_INIT`，先手工执行（详见 `docs/02-design/system-architecture.md` §4.1）：
   ```sql
   ALTER TABLE `users` ADD COLUMN `email` VARCHAR(254) NULL;
   ALTER TABLE `users` ADD UNIQUE KEY `uk_users_email` (`email`);
   ```
2. **邮箱**：在 163 或 QQ 邮箱网页版开启 SMTP 服务并生成授权码。
3. **`backend/.env`** 新增（示例为 163；QQ 把 HOST 换成 `smtp.qq.com`）：
   ```env
   SMTP_HOST=smtp.163.com
   SMTP_PORT=465
   SMTP_USER=你的邮箱@163.com
   SMTP_PASSWORD=你的SMTP授权码
   SMTP_FROM=你的邮箱@163.com
   SMTP_USE_SSL=true
   CLIENT_IP_HEADER=X-Real-IP   # 1Panel/Nginx 反代时
   ```
   可选调优（默认值）：`EMAIL_CODE_TTL_SECONDS=600`、`EMAIL_CODE_COOLDOWN_SECONDS=60`、`EMAIL_CODE_DAILY_LIMIT=10`、`EMAIL_CODE_MAX_ATTEMPTS=5`、`EMAIL_CODE_IP_HOURLY_LIMIT=20`、`EMAIL_VERIFY_IP_LIMIT_PER_10MIN=30`、`SMTP_TIMEOUT_SECONDS=10`。
4. 确认 Redis 在线（`docker compose` 已包含），`docker compose up -d --build` 重启 API。启动日志不应出现 `email_login_disabled`。
5. 前端：`TARO_APP_API_BASE_URL=https://你的域名/api/v1 pnpm build:h5`，部署 `frontend/dist-h5/`。
6. 冒烟：用自己的邮箱走一遍「获取验证码 → 收信 → 登录 → 出题」，并检查垃圾邮件箱。
