"""MySQL 连接池、自动建表 DDL 与启动自愈。"""

from __future__ import annotations

from typing import Final

import aiomysql
import structlog

from app.core.config import get_settings

logger = structlog.get_logger()

_pool: aiomysql.Pool | None = None

SCHEMA_STATEMENTS: Final[list[str]] = [
    """
    CREATE TABLE IF NOT EXISTS users (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        openid VARCHAR(64) NOT NULL,
        nickname VARCHAR(100) NOT NULL DEFAULT '学习者',
        avatar_url VARCHAR(500) NOT NULL DEFAULT '',
        total_xp INT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_users_openid (openid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS quiz_sessions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        quiz_id VARCHAR(64) NOT NULL,
        user_id BIGINT UNSIGNED NULL,
        title VARCHAR(255) NOT NULL,
        summary TEXT NULL,
        user_input TEXT NULL,
        questions_json JSON NOT NULL,
        image_status VARCHAR(20) NOT NULL DEFAULT 'none',
        image_notice VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_quiz_sessions_quiz_id (quiz_id),
        KEY idx_quiz_sessions_user_id (user_id),
        KEY idx_quiz_sessions_created_at (created_at),
        CONSTRAINT fk_quiz_sessions_user_id
            FOREIGN KEY (user_id) REFERENCES users (id)
            ON DELETE SET NULL
            ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS answer_records (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        quiz_id VARCHAR(64) NOT NULL,
        user_id BIGINT UNSIGNED NULL,
        records_json JSON NOT NULL,
        total_questions INT NOT NULL,
        correct_count INT NOT NULL,
        accuracy DECIMAL(5, 2) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_answer_records_quiz_id (quiz_id),
        KEY idx_answer_records_user_id (user_id),
        KEY idx_answer_records_created_at (created_at),
        CONSTRAINT fk_answer_records_user_id
            FOREIGN KEY (user_id) REFERENCES users (id)
            ON DELETE SET NULL
            ON UPDATE CASCADE,
        CONSTRAINT fk_answer_records_quiz_id
            FOREIGN KEY (quiz_id) REFERENCES quiz_sessions (quiz_id)
            ON DELETE CASCADE
            ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS reports (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        quiz_id VARCHAR(64) NOT NULL,
        user_id BIGINT UNSIGNED NULL,
        report_json JSON NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'completed',
        error_message VARCHAR(500) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_reports_quiz_id (quiz_id),
        KEY idx_reports_user_id (user_id),
        KEY idx_reports_created_at (created_at),
        CONSTRAINT fk_reports_user_id
            FOREIGN KEY (user_id) REFERENCES users (id)
            ON DELETE SET NULL
            ON UPDATE CASCADE,
        CONSTRAINT fk_reports_quiz_id
            FOREIGN KEY (quiz_id) REFERENCES quiz_sessions (quiz_id)
            ON DELETE CASCADE
            ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS quiz_tasks (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        task_id VARCHAR(64) NOT NULL,
        user_id BIGINT UNSIGNED NULL,
        status ENUM('pending', 'running', 'completed', 'failed') NOT NULL DEFAULT 'pending',
        stage VARCHAR(32) NOT NULL DEFAULT 'queued',
        user_input TEXT NOT NULL,
        question_count INT NOT NULL DEFAULT 5,
        difficulty VARCHAR(10) NOT NULL DEFAULT 'mixed',
        result_json JSON NULL,
        error_message VARCHAR(500) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_quiz_tasks_task_id (task_id),
        KEY idx_quiz_tasks_user_id (user_id),
        KEY idx_quiz_tasks_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS kb_documents (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        doc_id VARCHAR(64) NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_type VARCHAR(20) NOT NULL,
        file_size INT NOT NULL,
        status ENUM('processing', 'ready', 'failed') NOT NULL DEFAULT 'processing',
        chunk_count INT NOT NULL DEFAULT 0,
        error_message VARCHAR(500) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_kb_documents_doc_id (doc_id),
        KEY idx_kb_documents_user_id (user_id),
        CONSTRAINT fk_kb_documents_user_id
            FOREIGN KEY (user_id) REFERENCES users (id)
            ON DELETE CASCADE
            ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS image_generation_logs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        quiz_id VARCHAR(64) NULL,
        question_id VARCHAR(32) NULL,
        image_url VARCHAR(500) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_image_gen_logs_user_created (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
]


COLUMN_MIGRATIONS: Final[list[tuple[str, str, str]]] = [
    ("quiz_tasks", "stage", "VARCHAR(32) NOT NULL DEFAULT 'queued'"),
    ("quiz_sessions", "image_status", "VARCHAR(20) NOT NULL DEFAULT 'none'"),
    ("quiz_sessions", "image_notice", "VARCHAR(255) NULL"),
    ("reports", "status", "VARCHAR(20) NOT NULL DEFAULT 'completed'"),
    ("reports", "error_message", "VARCHAR(500) NULL"),
]


async def _ensure_column_migrations(cursor, db_name: str) -> None:
    """幂等补充存量表新增列（兼容 MySQL 8.0，不重复添加已存在列）。"""
    for table_name, column_name, column_def in COLUMN_MIGRATIONS:
        await cursor.execute(
            "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND COLUMN_NAME = %s",
            (db_name, table_name, column_name),
        )
        row = await cursor.fetchone()
        if not row or row[0] == 0:
            await cursor.execute(
                f"ALTER TABLE `{table_name}` ADD COLUMN `{column_name}` {column_def}"
            )
            logger.info(
                "mysql_column_migrated",
                table=table_name,
                column=column_name,
            )


async def init_mysql() -> None:
    """初始化数据库与 7 张核心业务表。"""
    global _pool

    if _pool is not None:
        return

    settings = get_settings()

    bootstrap_conn = await aiomysql.connect(
        host=settings.mysql_host,
        port=settings.mysql_port,
        user=settings.mysql_user,
        password=settings.mysql_password,
        charset=settings.mysql_charset,
        autocommit=True,
    )
    try:
        async with bootstrap_conn.cursor() as cursor:
            await cursor.execute(
                f"CREATE DATABASE IF NOT EXISTS `{settings.mysql_database}` "
                f"CHARACTER SET {settings.mysql_charset} COLLATE utf8mb4_unicode_ci"
            )
    finally:
        bootstrap_conn.close()

    _pool = await aiomysql.create_pool(
        host=settings.mysql_host,
        port=settings.mysql_port,
        user=settings.mysql_user,
        password=settings.mysql_password,
        db=settings.mysql_database,
        charset=settings.mysql_charset,
        minsize=settings.mysql_pool_minsize,
        maxsize=settings.mysql_pool_maxsize,
        autocommit=True,
    )

    async with _pool.acquire() as conn:
        async with conn.cursor() as cursor:
            for statement in SCHEMA_STATEMENTS:
                await cursor.execute(statement)
            await _ensure_column_migrations(cursor, settings.mysql_database)

    logger.info("mysql_initialized", database=settings.mysql_database)


async def recover_stale_jobs() -> tuple[int, int]:
    """服务启动时回收因进程重启中断的异步出题任务、文档解析、报告及后台配图任务。"""
    pool = get_mysql_pool()
    if pool is None:
        return 0, 0

    async with pool.acquire() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute(
                "UPDATE quiz_tasks SET status = 'failed', stage = 'failed', "
                "error_message = '服务重启导致任务中断，请重新发起出题' "
                "WHERE status IN ('pending', 'running')"
            )
            stale_tasks = cursor.rowcount

            await cursor.execute(
                "UPDATE kb_documents SET status = 'failed', "
                "error_message = '服务重启导致文档解析中断，请重新上传' "
                "WHERE status = 'processing'"
            )
            stale_docs = cursor.rowcount

            await cursor.execute(
                "UPDATE reports SET status = 'failed', "
                "error_message = '服务重启导致复盘报告生成中断，请刷新或重新生成' "
                "WHERE status = 'generating'"
            )
            stale_reports = cursor.rowcount

            await cursor.execute(
                "UPDATE quiz_sessions SET image_status = 'partial', "
                "image_notice = '部分配图因服务重启未完成，文字题目可正常作答' "
                "WHERE image_status = 'generating'"
            )
            stale_images = cursor.rowcount

    if stale_tasks or stale_docs or stale_reports or stale_images:
        logger.warning(
            "stale_jobs_recovered",
            stale_tasks=stale_tasks,
            stale_docs=stale_docs,
            stale_reports=stale_reports,
            stale_images=stale_images,
        )
    return stale_tasks, stale_docs


def get_mysql_pool() -> aiomysql.Pool | None:
    return _pool


async def close_mysql_pool() -> None:
    global _pool

    if _pool is None:
        return

    _pool.close()
    await _pool.wait_closed()
    _pool = None
    logger.info("mysql_pool_closed")
