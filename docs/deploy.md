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
- MySQL 备份：见 §4.1（每日 03:30 自动备份，保留 14 天）。

### 4.1 MySQL 备份与恢复

**自动备份**（2026-11-25 起已在线上启用）：

```bash
cd /opt/zhixing-quiz
bash deploy/deploy.sh backup-cron   # 安装 /etc/cron.d/zhixing-quiz-backup：每天 03:30（宿主机时区 Asia/Shanghai）
bash deploy/backup-mysql.sh         # 立即手动备份一次
tail -n 20 /var/log/zhixing-quiz-backup.log
ls -lh /var/backups/zhixing-quiz/
```

- 脚本 [`deploy/backup-mysql.sh`](../deploy/backup-mysql.sh)：运行时从 `backend/.env` 读取 `MYSQL_PASSWORD` / `MYSQL_DATABASE`，通过 `docker exec -e MYSQL_PWD`（不带值，继承环境变量）传入容器，**cron 文件与进程参数里都不出现密码**；`mysqldump --single-transaction --quick --routines --triggers --events --databases zhixing_quiz`（InnoDB 一致性快照、不锁表）→ gzip。
- 产物：`/var/backups/zhixing-quiz/zhixing_quiz-YYYYmmdd-HHMMSS.sql.gz`（目录 700、文件 600，仅 root 可读）；先写 `.part` 临时文件，`gzip -t` 可解压 + 含 `CREATE TABLE` + 以 `-- Dump completed` 结尾三项校验通过后才改为正式文件名。
- 保留：删除修改时间超过 14 天的备份（`RETENTION_DAYS` 可覆盖）；`flock` 防止并发重复执行。
- 日志：`/var/log/zhixing-quiz-backup.log`（logrotate 每月轮转、保留 6 份）。
- **只在本机**：备份与数据库在同一块云盘上，防误删/误操作，不防整机或云盘故障。重要数据上线后建议再加异地副本（如阿里云 OSS 或定期下载到本地），或开启 ECS 云盘快照。

**恢复**（会覆盖线上库，先停写入）：

```bash
cd /opt/zhixing-quiz
C="docker compose --env-file backend/.env -f deploy/docker-compose.prod.yml -p zhixing-quiz-prod"
F=/var/backups/zhixing-quiz/zhixing_quiz-20261125-213513.sql.gz   # 选要恢复的文件
gzip -t "$F" && zcat "$F" | grep -c '^CREATE TABLE'                 # 1) 确认文件完好

bash deploy/backup-mysql.sh                                          # 2) 恢复前先给当前库再备份一次
$C stop api worker                                                   # 3) 停止写入

export MYSQL_PWD="$(grep -E '^MYSQL_PASSWORD=' backend/.env | cut -d= -f2-)"
MID=$($C ps -q mysql)
zcat "$F" | docker exec -i -e MYSQL_PWD "$MID" mysql -uroot            # 4) 导入（备份含 CREATE DATABASE/USE 与 DROP TABLE IF EXISTS，按表覆盖）
unset MYSQL_PWD

$C start api worker                                                  # 5) 恢复服务
curl -fsS http://127.0.0.1:8010/api/v1/health
```

- 只想**先演练、不动线上库**：把库名替换后导入临时库，核对后删除（2026-11-25 首次备份已按此演练通过：12 张表、行数与线上一致）：

```bash
zcat "$F" | sed 's/`zhixing_quiz`/`zq_restore_check`/g' | docker exec -i -e MYSQL_PWD "$MID" mysql -uroot
docker exec -e MYSQL_PWD "$MID" mysql -uroot -e 'SHOW TABLES FROM zq_restore_check; DROP DATABASE zq_restore_check;'
```

- 备份文件里只有 `zhixing_quiz` 库，不含 MySQL 用户/权限；Redis（ARQ 队列、限流计数）与 Chroma 向量库、`uploads` 卷不在此备份范围内（向量可由原文档重新入库）。

## 5. 端口与安全组

- 安全组只需放行 22 / 80 / 443（以及 1Panel 面板端口，建议限制来源 IP）。
- 3306 / 6379 / 8001 / 8010 均不应对公网开放；compose 已保证不监听公网地址。
- 同机已有 `hello-agent-h5.service`（uvicorn :8000），本部署不占用 8000。
