# 生产部署手册（单机 Docker Compose + 宿主机 Nginx）

> 适用：阿里云 ECS（Ubuntu 24.04，2 核 / 2G 级内存）单机部署知行快刷后端 + H5。
> 当前线上：<https://study.leileigwl.cn>（ICP 备案 浙ICP备2026102405号-1）。
> 本文件与 `deploy/` 下所有文件**不含任何密钥**；真实 `backend/.env` 只存在于服务器。

## 1. 架构

```
浏览器 ──HTTPS──▶ 宿主机 Nginx(80/443, Let's Encrypt)
                   ├─ /                      → /var/www/zhixing-quiz/h5（H5 静态，hash 路由）
                   ├─ /api/*                 → 127.0.0.1:8010（API 容器 :8000）
                   └─ /static/quiz-images/*  → 127.0.0.1:8010（配图本地回落目录）
docker compose（项目名 zhixing-quiz-prod，deploy/docker-compose.prod.yml）
   api(uvicorn 单 worker) ─ worker(ARQ) ─ mysql:8.0 ─ redis:7 ─ chroma(HTTP)   ← 仅内部网络
命名卷：mysql_data / redis_data / chroma_data / uploads / quiz_images
```

- 只有 API 绑定 `127.0.0.1:8010`；MySQL / Redis / Chroma 不映射任何宿主机端口。
- 反向代理选用 **Ubuntu 自带 nginx + certbot**（而非 1Panel OpenResty）：1Panel v2 的应用商店安装需要走面板 UI / 开启 API 密钥，无法在不改面板设置的前提下无界面完成；apt nginx 可脚本化、证书由 `certbot.timer` 自动续期。
  **注意**：此后不要在 1Panel 里再安装 OpenResty（会抢 80/443）。如果以后想统一到 1Panel 管理，需先 `systemctl disable --now nginx` 再迁移站点。
- 小内存调优：MySQL 关闭 performance_schema、buffer pool 128M；Redis `maxmemory 96mb noeviction`（ARQ 队列不可淘汰）；各容器设 `mem_limit`；宿主机加 2G swap（`/swapfile`，已写入 fstab，`vm.swappiness=10`）。

## 2. 首次部署

```bash
# 服务器（root）
git clone https://github.com/leileigwl/zhixing-quiz.git /opt/zhixing-quiz
cd /opt/zhixing-quiz
cp backend/.env.example backend/.env && chmod 600 backend/.env
# 编辑 backend/.env，至少修改以下项（见 §3）
bash deploy/deploy.sh backend   # 构建镜像并启动容器，等待 /api/v1/health
bash deploy/deploy.sh nginx     # 安装/渲染 nginx，首次自动签发证书
```

H5 在开发机（或 CI）构建后上传：

```bash
cd frontend
pnpm install --frozen-lockfile
TARO_APP_API_BASE_URL=https://study.leileigwl.cn/api/v1 pnpm build:h5   # 必须带 /api/v1，见 config/apiBaseUrl.ts
tar -czf /tmp/h5.tar.gz -C dist-h5 .   # H5 产物目录为 frontend/dist-h5
scp /tmp/h5.tar.gz root@服务器:/tmp/
ssh root@服务器 'cd /opt/zhixing-quiz && bash deploy/deploy.sh web /tmp/h5.tar.gz'
```

> 生产构建**不要**设置 `TARO_APP_ALLOW_PLACEHOLDER_API`（仅 CI 冒烟用）。

## 3. `backend/.env` 生产必填项

| 变量 | 生产取值 |
|---|---|
| `APP_ENV` / `APP_DEBUG` / `ALLOW_DEV_LOGIN` | `production` / `false` / `false` |
| `JWT_SECRET` | 64 位随机串：`openssl rand -hex 32` |
| `MYSQL_PASSWORD` | 随机串：`openssl rand -hex 24`（compose 同时用它初始化 MySQL root） |
| `CORS_ORIGINS` / `PUBLIC_BASE_URL` | `https://study.leileigwl.cn` |
| `CLIENT_IP_HEADER` | `X-Real-IP`（nginx 用 `$remote_addr` 覆盖写入） |
| `REDIS_URL` / `CHROMA_HOST` / `MYSQL_HOST` | 由 compose 覆盖为 `redis://redis:6379/0` / `chroma` / `mysql` |
| `ENABLE_ARQ_QUEUE` | `true`（已部署 worker 容器） |
| `ALLOW_LOCAL_IMAGE_FALLBACK` | `true`（未配 COS 时配图落到 `quiz_images` 卷） |
| `SMTP_*` | 163 邮箱 + 客户端授权码（见 `.env.example` 注释） |
| `LLM_*`/`DEEPSEEK_*`、`EMBEDDING_*`/`DASHSCOPE_*`、`TAVILY_API_KEY` | AI 出题 / 知识库 / 联网搜索所需，留空时这些功能不可用但服务可启动 |
| `PYPI_MIRROR` / `DEBIAN_MIRROR`（可选，非密钥） | 阿里云 ECS 构建加速：`http://mirrors.cloud.aliyuncs.com/pypi/simple/` / `mirrors.cloud.aliyuncs.com`（内网镜像；实测 `mirrors.aliyun.com` 公网 HTTP/1.1 被限速，pip 几乎下载不动）。Python 依赖仍按 `uv.lock` 哈希校验 |

修改 `.env` 后执行 `bash deploy/deploy.sh backend`（会重建并重启 api/worker）。

## 4. 日常运维

```bash
cd /opt/zhixing-quiz
bash deploy/deploy.sh status            # 容器状态、健康检查、内存
bash deploy/deploy.sh update            # git reset --hard origin/main 后重建（.env 不受影响）
docker compose --env-file backend/.env -f deploy/docker-compose.prod.yml logs -f --tail 100 api
```

- 证书：`systemctl list-timers certbot.timer`；续期后 `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh` 自动重载 nginx。
- H5 回滚：上一版保存在 `/var/www/zhixing-quiz/h5.prev`。
- MySQL 备份（建议加 cron）：
  `docker compose ... exec -T mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction zhixing_quiz' | gzip > /root/backup/zx-$(date +%F).sql.gz`

## 5. 端口与安全组

- 安全组只需放行 22 / 80 / 443（以及 1Panel 面板端口，建议限制来源 IP）。
- 3306 / 6379 / 8001 / 8010 均不应对公网开放；compose 已保证不监听公网地址。
- 同机已有 `hello-agent-h5.service`（uvicorn :8000），本部署不占用 8000。
