"""MySQL 连接池、V2 12 表自动建表 DDL、幂等列迁移、存量数据回填与启动自愈。"""

from __future__ import annotations

import json
from typing import Final

import aiomysql
import structlog

from app.core.config import get_settings
from app.services.domain_classifier import classify_domain_deterministic

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
        streak_days INT NOT NULL DEFAULT 0,
        last_practice_date DATE NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_users_openid (openid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS domains (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(100) NOT NULL,
        color_token VARCHAR(24) NOT NULL DEFAULT 'blue',
        doc_count INT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_domains_user_name (user_id, name),
        KEY idx_domains_user_id (user_id),
        CONSTRAINT fk_domains_user_id
            FOREIGN KEY (user_id) REFERENCES users (id)
            ON DELETE CASCADE
            ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS quiz_sessions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        quiz_id VARCHAR(64) NOT NULL,
        user_id BIGINT UNSIGNED NULL,
        domain_id BIGINT UNSIGNED NULL,
        domain_name VARCHAR(100) NULL,
        source_type VARCHAR(32) NOT NULL DEFAULT 'llm_direct',
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
        KEY idx_quiz_sessions_domain_id (domain_id),
        KEY idx_quiz_sessions_created_at (created_at),
        CONSTRAINT fk_quiz_sessions_user_id
            FOREIGN KEY (user_id) REFERENCES users (id)
            ON DELETE SET NULL
            ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS questions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        question_uid VARCHAR(96) NOT NULL,
        quiz_id VARCHAR(64) NOT NULL,
        user_id BIGINT UNSIGNED NULL,
        domain_id BIGINT UNSIGNED NULL,
        q_type VARCHAR(20) NOT NULL DEFAULT 'single',
        stem TEXT NOT NULL,
        options_json JSON NOT NULL,
        answer_json JSON NOT NULL,
        explanation TEXT NULL,
        knowledge_point VARCHAR(255) NOT NULL DEFAULT '',
        difficulty VARCHAR(16) NOT NULL DEFAULT 'medium',
        image_url VARCHAR(500) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_questions_uid (question_uid),
        KEY idx_questions_quiz (quiz_id),
        KEY idx_questions_user_domain (user_id, domain_id),
        CONSTRAINT fk_questions_quiz_id
            FOREIGN KEY (quiz_id) REFERENCES quiz_sessions (quiz_id)
            ON DELETE CASCADE
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
        adaptive_mode TINYINT(1) NOT NULL DEFAULT 0,
        self_rated_level VARCHAR(20) NULL,
        enable_web_search TINYINT(1) NOT NULL DEFAULT 0,
        doc_id VARCHAR(64) NULL,
        domain_id BIGINT UNSIGNED NULL,
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
        domain_id BIGINT UNSIGNED NULL,
        domain_name VARCHAR(100) NULL,
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
        KEY idx_kb_documents_domain_id (domain_id),
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
    """
    CREATE TABLE IF NOT EXISTS user_knowledge_mastery (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        domain_id BIGINT UNSIGNED NOT NULL,
        self_rated_level VARCHAR(20) NULL,
        mastery_score DECIMAL(5, 2) NOT NULL DEFAULT 50.00,
        easy_correct INT NOT NULL DEFAULT 0,
        easy_total INT NOT NULL DEFAULT 0,
        medium_correct INT NOT NULL DEFAULT 0,
        medium_total INT NOT NULL DEFAULT 0,
        hard_correct INT NOT NULL DEFAULT 0,
        hard_total INT NOT NULL DEFAULT 0,
        avg_duration_ms INT NOT NULL DEFAULT 0,
        stability_days DECIMAL(6, 2) NOT NULL DEFAULT 5.00,
        retention_rate DECIMAL(5, 2) NOT NULL DEFAULT 85.00,
        last_practiced_at DATETIME NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_mastery_user_domain (user_id, domain_id),
        KEY idx_mastery_user (user_id),
        CONSTRAINT fk_mastery_user_id
            FOREIGN KEY (user_id) REFERENCES users (id)
            ON DELETE CASCADE
            ON UPDATE CASCADE,
        CONSTRAINT fk_mastery_domain_id
            FOREIGN KEY (domain_id) REFERENCES domains (id)
            ON DELETE CASCADE
            ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS review_cards (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        domain_id BIGINT UNSIGNED NULL,
        question_uid VARCHAR(96) NOT NULL,
        quiz_id VARCHAR(64) NOT NULL,
        question_id VARCHAR(32) NOT NULL,
        easiness_factor DECIMAL(4, 2) NOT NULL DEFAULT 2.50,
        interval_days INT NOT NULL DEFAULT 1,
        repetitions INT NOT NULL DEFAULT 0,
        status ENUM('active', 'due', 'mastered') NOT NULL DEFAULT 'active',
        next_review_at DATETIME NOT NULL,
        last_reviewed_at DATETIME NULL,
        notified_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_review_user_quid (user_id, question_uid),
        KEY idx_review_due (user_id, status, next_review_at),
        CONSTRAINT fk_review_user_id
            FOREIGN KEY (user_id) REFERENCES users (id)
            ON DELETE CASCADE
            ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS subscribe_quotas (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        template_id VARCHAR(128) NOT NULL DEFAULT 'default_review_reminder',
        remaining_count INT NOT NULL DEFAULT 0,
        preferred_hour TINYINT UNSIGNED NOT NULL DEFAULT 20,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_sub_user_tpl (user_id, template_id),
        CONSTRAINT fk_sub_user_id
            FOREIGN KEY (user_id) REFERENCES users (id)
            ON DELETE CASCADE
            ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
]


# 注意保持前 5 项顺序，以兼容既有迁移顺序约定及新增 V2 幂等扩展列
COLUMN_MIGRATIONS: Final[list[tuple[str, str, str]]] = [
    ("quiz_tasks", "stage", "VARCHAR(32) NOT NULL DEFAULT 'queued'"),
    ("quiz_sessions", "image_status", "VARCHAR(20) NOT NULL DEFAULT 'none'"),
    ("quiz_sessions", "image_notice", "VARCHAR(255) NULL"),
    ("reports", "status", "VARCHAR(20) NOT NULL DEFAULT 'completed'"),
    ("reports", "error_message", "VARCHAR(500) NULL"),
    ("users", "streak_days", "INT NOT NULL DEFAULT 0"),
    ("users", "last_practice_date", "DATE NULL"),
    ("kb_documents", "domain_id", "BIGINT UNSIGNED NULL"),
    ("kb_documents", "domain_name", "VARCHAR(100) NULL"),
    ("quiz_sessions", "domain_id", "BIGINT UNSIGNED NULL"),
    ("quiz_sessions", "domain_name", "VARCHAR(100) NULL"),
    ("quiz_sessions", "source_type", "VARCHAR(32) NOT NULL DEFAULT 'llm_direct'"),
    ("quiz_tasks", "adaptive_mode", "TINYINT(1) NOT NULL DEFAULT 0"),
    ("quiz_tasks", "self_rated_level", "VARCHAR(20) NULL"),
    ("quiz_tasks", "enable_web_search", "TINYINT(1) NOT NULL DEFAULT 0"),
    ("quiz_tasks", "doc_id", "VARCHAR(64) NULL"),
    ("quiz_tasks", "domain_id", "BIGINT UNSIGNED NULL"),
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


async def _get_or_create_domain_in_cursor(
    cursor, user_id: int, name: str, color_token: str
) -> int:
    await cursor.execute(
        "INSERT INTO domains (user_id, name, color_token) VALUES (%s, %s, %s) "
        "ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)",
        (user_id, name, color_token),
    )
    await cursor.execute("SELECT LAST_INSERT_ID()")
    row = await cursor.fetchone()
    return int(row[0])


async def backfill_v1_data(cursor) -> None:
    """幂等回填 V1 存量知识库、测验与单题数据到 V2 领域/单题/掌握度表中。"""
    # 1. 回填未归类的 kb_documents
    await cursor.execute(
        "SELECT doc_id, user_id, file_name FROM kb_documents WHERE domain_id IS NULL"
    )
    unclassified_docs = await cursor.fetchall()
    for doc_id, user_id, file_name in unclassified_docs:
        d_name, d_color = classify_domain_deterministic(file_name)
        d_id = await _get_or_create_domain_in_cursor(cursor, int(user_id), d_name, d_color)
        await cursor.execute(
            "UPDATE kb_documents SET domain_id = %s, domain_name = %s WHERE doc_id = %s",
            (d_id, d_name, doc_id),
        )

    # 2. 回填尚未拆分到 questions / domain_id 的 quiz_sessions
    await cursor.execute(
        "SELECT quiz_id, user_id, title, user_input, questions_json, created_at "
        "FROM quiz_sessions WHERE user_id IS NOT NULL AND domain_id IS NULL"
    )
    legacy_sessions = await cursor.fetchall()
    for quiz_id, user_id, title, user_input, raw_q_json, created_at in legacy_sessions:
        uid = int(user_id)
        d_name, d_color = classify_domain_deterministic(f"{title} {user_input or ''}")
        d_id = await _get_or_create_domain_in_cursor(cursor, uid, d_name, d_color)
        await cursor.execute(
            "UPDATE quiz_sessions SET domain_id = %s, domain_name = %s WHERE quiz_id = %s",
            (d_id, d_name, quiz_id),
        )

        questions = json.loads(raw_q_json) if isinstance(raw_q_json, str) else raw_q_json
        if isinstance(questions, list):
            for q in questions:
                if not isinstance(q, dict) or not q.get("id"):
                    continue
                q_uid = f"{quiz_id}:{q['id']}"
                await cursor.execute(
                    "INSERT IGNORE INTO questions "
                    "(question_uid, quiz_id, user_id, domain_id, q_type, stem, "
                    "options_json, answer_json, explanation, knowledge_point, difficulty, image_url, created_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (
                        q_uid,
                        quiz_id,
                        uid,
                        d_id,
                        q.get("type", "single"),
                        q.get("stem", ""),
                        json.dumps(q.get("options") or [], ensure_ascii=False),
                        json.dumps(q.get("answer") or [], ensure_ascii=False),
                        q.get("explanation", ""),
                        q.get("knowledge_point", ""),
                        q.get("difficulty", "medium"),
                        q.get("image_url"),
                        created_at,
                    ),
                )

        # 若有历史答题记录且 user_knowledge_mastery 尚未建立，同步写入初始画像
        await cursor.execute(
            "SELECT accuracy, total_questions, correct_count, created_at "
            "FROM answer_records WHERE quiz_id = %s",
            (quiz_id,),
        )
        ar = await cursor.fetchone()
        if ar:
            acc, tot_q, corr_q, ar_at = float(ar[0]), int(ar[1]), int(ar[2]), ar[3]
            await cursor.execute(
                "INSERT IGNORE INTO user_knowledge_mastery "
                "(user_id, domain_id, mastery_score, medium_correct, medium_total, "
                "stability_days, retention_rate, last_practiced_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                (uid, d_id, acc, corr_q, tot_q, 5.0 if acc >= 60 else 2.5, max(45.0, acc), ar_at),
            )

    # 3. 同步用户初始连续打卡天数（若为 0 但有历史交卷记录）
    await cursor.execute(
        "UPDATE users u "
        "LEFT JOIN ("
        "  SELECT user_id, COUNT(DISTINCT DATE(created_at)) AS active_days, MAX(DATE(created_at)) AS last_day "
        "  FROM answer_records WHERE user_id IS NOT NULL GROUP BY user_id"
        ") s ON u.id = s.user_id "
        "SET u.streak_days = GREATEST(u.streak_days, COALESCE(s.active_days, 0)), "
        "u.last_practice_date = COALESCE(u.last_practice_date, s.last_day) "
        "WHERE s.active_days IS NOT NULL AND u.streak_days = 0"
    )


async def init_mysql() -> None:
    """初始化数据库、12 张 V2 业务表与存量回填。"""
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
            await cursor.execute("SELECT GET_LOCK('zhixing_quiz_schema_init', 30)")
            try:
                for statement in SCHEMA_STATEMENTS:
                    await cursor.execute(statement)
                await _ensure_column_migrations(cursor, settings.mysql_database)
                await backfill_v1_data(cursor)
            finally:
                await cursor.execute("SELECT RELEASE_LOCK('zhixing_quiz_schema_init')")

    logger.info("mysql_v2_initialized", database=settings.mysql_database)


async def recover_stale_jobs() -> tuple[int, int]:
    """服务启动时回收因进程重启中断的异步任务；启用 ARQ 时不误杀队列中待消费任务。"""
    pool = get_mysql_pool()
    if pool is None:
        return 0, 0

    settings = get_settings()
    if settings.enable_arq_queue:
        # ARQ 持久化队列模式：仅清理处于运行中断孤儿状态的记录（交由 ARQ retry / Cron 处理或保守跳过 pending）
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
