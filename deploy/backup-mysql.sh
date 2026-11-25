#!/usr/bin/env bash
# 知行快刷 MySQL 每日备份（在服务器上以 root 运行，cron 由 `bash deploy/deploy.sh backup-cron` 安装）
#
#   bash deploy/backup-mysql.sh            # 立即备份一次
#
# 做什么：
#   1. 从 backend/.env 读取 MYSQL_PASSWORD / MYSQL_DATABASE（只在本进程内存里，不写进 cron、不出现在命令行参数）；
#   2. 在 compose 项目的 mysql 容器里执行 mysqldump --single-transaction（InnoDB 一致性快照，不锁表），
#      gzip 压缩到 $BACKUP_DIR/zhixing_quiz-YYYYmmdd-HHMMSS.sql.gz（目录 700、文件 600）；
#   3. 校验：gzip -t 可解压、含 CREATE TABLE、以 "-- Dump completed" 结尾，校验通过才改成正式文件名；
#   4. 删除超过 $RETENTION_DAYS 天的旧备份。
# 恢复步骤见 docs/deploy.md §4.1。
#
# 可用环境变量覆盖：ENV_FILE、BACKUP_DIR、RETENTION_DAYS、COMPOSE_PROJECT

set -euo pipefail
umask 077

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_DIR/backend/.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/zhixing-quiz}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-zhixing-quiz-prod}"
LOCK_FILE="/run/lock/zhixing-quiz-backup.lock"

log() { printf '%s [backup] %s\n' "$(date '+%F %T %Z')" "$*"; }
die() { log "失败：$*"; exit 1; }

# 读取 .env 中 KEY 的值（不 source，避免执行 .env 里的任意内容；去掉首尾引号）
read_env_value() {
  local line
  line="$(grep -E "^$1=" "$ENV_FILE" | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"
  line="${line%\'}"; line="${line#\'}"
  printf '%s' "$line"
}

exec 9>"$LOCK_FILE"
flock -n 9 || die "已有备份在运行（$LOCK_FILE）"

[[ -f "$ENV_FILE" ]] || die "缺少 $ENV_FILE"
MYSQL_PWD="$(read_env_value MYSQL_PASSWORD)"
[[ -n "$MYSQL_PWD" ]] || die "$ENV_FILE 未设置 MYSQL_PASSWORD"
export MYSQL_PWD   # 通过 `docker exec -e MYSQL_PWD`（不带值）传入容器，不出现在 ps 参数里
DB_NAME="$(read_env_value MYSQL_DATABASE)"
DB_NAME="${DB_NAME:-zhixing_quiz}"

CID="$(docker ps -q \
  --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" \
  --filter "label=com.docker.compose.service=mysql" | head -n 1)"
[[ -n "$CID" ]] || die "找不到运行中的 mysql 容器（compose 项目 ${COMPOSE_PROJECT}）"

install -d -m 700 "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
FINAL="$BACKUP_DIR/${DB_NAME}-${STAMP}.sql.gz"
PART="$BACKUP_DIR/.${DB_NAME}-${STAMP}.sql.gz.part"
trap 'rm -f "$PART"' EXIT

log "开始备份库 ${DB_NAME} → ${FINAL}"
START=$(date +%s)
docker exec -i -e MYSQL_PWD "$CID" \
  mysqldump -uroot \
    --single-transaction --quick \
    --routines --triggers --events \
    --set-gtid-purged=OFF \
    --default-character-set=utf8mb4 \
    --databases "$DB_NAME" \
  | gzip -6 > "$PART"

# 校验：能完整解压、包含建表语句、dump 正常结束
gzip -t "$PART" || die "gzip 校验失败"
TABLES="$(gzip -dc "$PART" | grep -c '^CREATE TABLE' || true)"
[[ "${TABLES:-0}" -gt 0 ]] || die "备份中没有 CREATE TABLE"
gzip -dc "$PART" | tail -n 1 | grep -q -- '-- Dump completed' || die "备份不完整（缺少 Dump completed 结尾）"

mv "$PART" "$FINAL"
chmod 600 "$FINAL"
trap - EXIT
SIZE="$(du -h "$FINAL" | cut -f1)"
log "完成：${FINAL}（${SIZE}，${TABLES} 张表，耗时 $(( $(date +%s) - START ))s）"

# 保留最近 RETENTION_DAYS 天（按文件修改时间）
DELETED="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "${DB_NAME}-*.sql.gz" -mtime "+$(( RETENTION_DAYS - 1 ))" -print -delete | wc -l)"
log "清理超过 ${RETENTION_DAYS} 天的旧备份：${DELETED} 个；当前共 $(find "$BACKUP_DIR" -maxdepth 1 -type f -name "${DB_NAME}-*.sql.gz" | wc -l) 个"
