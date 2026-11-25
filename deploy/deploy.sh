#!/usr/bin/env bash
# 知行快刷 单机部署脚本（在服务器仓库根目录 /opt/zhixing-quiz 下执行，需 root）
#
#   bash deploy/deploy.sh backend          # 构建并启动 MySQL/Redis/Chroma/API/Worker（compose）
#   bash deploy/deploy.sh nginx            # 渲染宿主机 Nginx 配置；首次自动签发 Let's Encrypt 证书
#   bash deploy/deploy.sh web <h5.tar.gz>  # 发布 H5 静态产物（tar 包内为 frontend/dist-h5/ 的内容）
#   bash deploy/deploy.sh status           # 查看容器、健康检查与内存
#   bash deploy/deploy.sh update [分支]     # 拉取最新代码（默认 main）后重新执行 backend
#   bash deploy/deploy.sh backup-cron      # 安装 MySQL 每日 03:30 备份 cron（/etc/cron.d/zhixing-quiz-backup）
#
# 可用环境变量覆盖：DOMAIN、WEB_ROOT、API_UPSTREAM、COMPOSE_PROJECT
# 前置：backend/.env 已按 docs/deploy.md 创建并 chmod 600（本脚本不会生成或打印任何密钥）

set -euo pipefail

DOMAIN="${DOMAIN:-study.leileigwl.cn}"
WEB_ROOT="${WEB_ROOT:-/var/www/zhixing-quiz/h5}"
API_UPSTREAM="${API_UPSTREAM:-127.0.0.1:8010}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-zhixing-quiz-prod}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_DIR/backend/.env"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$REPO_DIR/deploy/docker-compose.prod.yml" -p "$COMPOSE_PROJECT")
NGINX_SITE="/etc/nginx/sites-available/zhixing-quiz.conf"

log() { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[deploy] %s\033[0m\n' "$*" >&2; exit 1; }

check_env() {
  [[ -f "$ENV_FILE" ]] || die "缺少 $ENV_FILE，请先参照 docs/deploy.md 创建"
  local mode; mode="$(stat -c %a "$ENV_FILE")"
  [[ "$mode" == "600" ]] || die "$ENV_FILE 权限为 $mode，请执行 chmod 600"
  grep -q '^APP_ENV=production' "$ENV_FILE" || die "backend/.env 必须设置 APP_ENV=production"
  grep -q '^ALLOW_DEV_LOGIN=false' "$ENV_FILE" || die "backend/.env 必须设置 ALLOW_DEV_LOGIN=false"
  grep -Eq '^MYSQL_PASSWORD=.{16,}' "$ENV_FILE" || die "MYSQL_PASSWORD 至少 16 位随机串"
  grep -Eq '^JWT_SECRET=.{32,}' "$ENV_FILE" || die "JWT_SECRET 至少 32 位随机串"
}

render() { # $1 模板 → stdout
  sed -e "s#__DOMAIN__#${DOMAIN}#g" -e "s#__WEB_ROOT__#${WEB_ROOT}#g" -e "s#__API_UPSTREAM__#${API_UPSTREAM}#g" "$1"
}

cmd_backend() {
  check_env
  log "构建并启动容器（项目 $COMPOSE_PROJECT）"
  "${COMPOSE[@]}" up -d --build --remove-orphans
  log "等待 API 健康检查 http://${API_UPSTREAM}/api/v1/health"
  for _ in $(seq 1 60); do
    if curl -fsS "http://${API_UPSTREAM}/api/v1/health" >/dev/null 2>&1; then log "API 就绪"; return 0; fi
    sleep 3
  done
  "${COMPOSE[@]}" logs --tail 80 api || true
  die "API 180s 内未就绪"
}

cmd_nginx() {
  command -v nginx >/dev/null || { log "安装 nginx + certbot"; apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx certbot; }
  install -d -m 755 /var/www/certbot "$WEB_ROOT"
  install -m 644 "$REPO_DIR/deploy/nginx/zhixing-security-headers.conf" /etc/nginx/snippets/zhixing-security-headers.conf
  rm -f /etc/nginx/sites-enabled/default

  if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
    log "首次签发证书：先启用纯 HTTP 配置供 ACME 校验"
    render "$REPO_DIR/deploy/nginx/study.http-only.conf.template" > "$NGINX_SITE"
    ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/zhixing-quiz.conf
    nginx -t && systemctl reload nginx
    certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" \
      --non-interactive --agree-tos --register-unsafely-without-email
  fi

  # 续期后自动重载 nginx（certbot.timer 每天两次检查续期）
  install -d /etc/letsencrypt/renewal-hooks/deploy
  printf '#!/bin/sh\nsystemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
  chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
  systemctl enable --now certbot.timer >/dev/null 2>&1 || true

  log "启用完整 HTTPS 配置"
  render "$REPO_DIR/deploy/nginx/study.conf.template" > "$NGINX_SITE"
  ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/zhixing-quiz.conf
  nginx -t && systemctl reload nginx
  log "Nginx 已生效：https://${DOMAIN}"
}

cmd_web() {
  local tarball="${1:-}"
  [[ -f "$tarball" ]] || die "用法：deploy.sh web <h5.tar.gz>"
  local stage; stage="$(mktemp -d)"
  tar -xzf "$tarball" -C "$stage"
  [[ -f "$stage/index.html" ]] || die "tar 包根目录缺少 index.html"
  install -d -m 755 "$WEB_ROOT"
  if [[ -d "$WEB_ROOT" && -n "$(ls -A "$WEB_ROOT" 2>/dev/null)" ]]; then
    rm -rf "${WEB_ROOT}.prev" && cp -a "$WEB_ROOT" "${WEB_ROOT}.prev"
  fi
  rsync -a --delete "$stage"/ "$WEB_ROOT"/ 2>/dev/null || { rm -rf "${WEB_ROOT:?}"/*; cp -a "$stage"/. "$WEB_ROOT"/; }
  chmod -R a+rX "$WEB_ROOT"
  rm -rf "$stage"
  log "H5 已发布到 $WEB_ROOT（上一版备份在 ${WEB_ROOT}.prev）"
}

cmd_status() {
  "${COMPOSE[@]}" ps
  curl -fsS "http://${API_UPSTREAM}/api/v1/health" && echo
  free -h
  docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}'
}

cmd_update() {
  local branch="${1:-main}"
  log "同步代码到 origin/${branch}（backend/.env 被 .gitignore 忽略，不受影响）"
  git -C "$REPO_DIR" fetch origin "$branch"
  git -C "$REPO_DIR" reset --hard "origin/${branch}"
  cmd_backend
}

cmd_backup_cron() {
  local cron_file=/etc/cron.d/zhixing-quiz-backup
  [[ "$(cat /etc/timezone 2>/dev/null || timedatectl show -p Timezone --value)" == "Asia/Shanghai" ]] \
    || log "警告：宿主机时区不是 Asia/Shanghai，cron 的 03:30 将按宿主机时区执行"
  chmod 755 "$REPO_DIR/deploy/backup-mysql.sh"
  # cron 文件里只有脚本路径，没有任何密码；密码由脚本运行时从 backend/.env 读取
  cat > "$cron_file" <<CRON
# 知行快刷 MySQL 每日备份（由 deploy/deploy.sh backup-cron 生成；宿主机时区 Asia/Shanghai）
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 3 * * * root $REPO_DIR/deploy/backup-mysql.sh >> /var/log/zhixing-quiz-backup.log 2>&1
CRON
  chmod 644 "$cron_file"
  cat > /etc/logrotate.d/zhixing-quiz-backup <<'ROTATE'
/var/log/zhixing-quiz-backup.log {
  monthly
  rotate 6
  compress
  missingok
  notifempty
}
ROTATE
  systemctl reload cron 2>/dev/null || true
  log "已安装 $cron_file（每天 03:30），日志 /var/log/zhixing-quiz-backup.log，备份目录 /var/backups/zhixing-quiz"
}

case "${1:-}" in
  backend) cmd_backend ;;
  nginx)   cmd_nginx ;;
  web)     shift; cmd_web "${1:-}" ;;
  status)  cmd_status ;;
  update)  shift; cmd_update "${1:-main}" ;;
  backup-cron) cmd_backup_cron ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
