"""题库 / 答题 / 报告数据访问层"""

from __future__ import annotations

import json
from typing import Optional

import structlog

from app.core.db import get_mysql_pool

logger = structlog.get_logger()


async def save_quiz_session(
    quiz_id: str,
    user_id: Optional[int],
    title: str,
    summary: str,
    user_input: str,
    questions_json: list,
    image_status: str = "none",
    image_notice: Optional[str] = None,
    domain_id: Optional[int] = None,
    domain_name: Optional[str] = None,
    source_type: str = "llm_direct",
) -> None:
    pool = get_mysql_pool()
    if pool is None:
        return
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO quiz_sessions "
                "(quiz_id, user_id, domain_id, domain_name, source_type, title, summary, user_input, questions_json, image_status, image_notice) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    quiz_id,
                    user_id,
                    domain_id,
                    domain_name,
                    source_type or "llm_direct",
                    title,
                    summary,
                    user_input,
                    json.dumps(questions_json, ensure_ascii=False),
                    image_status,
                    image_notice,
                ),
            )


async def get_quiz_images(quiz_id: str) -> Optional[dict]:
    """查询指定测验的题目配图状态与每题 image_url 映射。"""
    pool = get_mysql_pool()
    if pool is None:
        return None
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT user_id, questions_json, image_status, image_notice "
                "FROM quiz_sessions WHERE quiz_id = %s",
                (quiz_id,),
            )
            row = await cur.fetchone()
            if row is None:
                return None

            raw_questions = json.loads(row[1]) if isinstance(row[1], str) else row[1]
            image_urls = {
                q["id"]: q["image_url"]
                for q in (raw_questions or [])
                if isinstance(q, dict) and q.get("id") and q.get("image_url")
            }
            return {
                "quiz_id": quiz_id,
                "user_id": row[0],
                "image_status": row[2] or "none",
                "image_notice": row[3],
                "image_urls": image_urls,
            }


async def update_quiz_images(
    quiz_id: str,
    image_map: dict[str, str],
    image_status: str,
    image_notice: Optional[str] = None,
) -> None:
    """增量写回题库配图 URL 与当前配图状态（保留其余题目字段不动）。"""
    pool = get_mysql_pool()
    if pool is None:
        return
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT questions_json FROM quiz_sessions WHERE quiz_id = %s",
                (quiz_id,),
            )
            row = await cur.fetchone()
            if row is None:
                return

            questions = json.loads(row[0]) if isinstance(row[0], str) else row[0]
            if isinstance(questions, list) and image_map:
                for q in questions:
                    if isinstance(q, dict) and q.get("id") in image_map:
                        q["image_url"] = image_map[q["id"]]

            await cur.execute(
                "UPDATE quiz_sessions SET questions_json = %s, image_status = %s, image_notice = %s "
                "WHERE quiz_id = %s",
                (
                    json.dumps(questions, ensure_ascii=False),
                    image_status,
                    image_notice,
                    quiz_id,
                ),
            )


async def get_quiz_session_for_user(quiz_id: str) -> Optional[dict]:
    """按 quiz_id 获取测验原始题目与归属用户，供服务端判分与越权校验。"""
    pool = get_mysql_pool()
    if pool is None:
        return None
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT quiz_id, user_id, title, summary, questions_json, "
                "domain_id, domain_name, source_type, user_input "
                "FROM quiz_sessions WHERE quiz_id = %s",
                (quiz_id,),
            )
            row = await cur.fetchone()
            if row is None:
                return None
            return {
                "quiz_id": row[0],
                "user_id": row[1],
                "title": row[2],
                "summary": row[3],
                "questions": json.loads(row[4]) if isinstance(row[4], str) else row[4],
                "domain_id": row[5],
                "domain_name": row[6],
                "source_type": row[7] or "llm_direct",
                "user_input": row[8] or "",
            }


async def get_answer_record_by_quiz(quiz_id: str) -> Optional[dict]:
    """按 quiz_id 查询已提交的答题统计。"""
    pool = get_mysql_pool()
    if pool is None:
        return None
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT records_json, total_questions, correct_count, accuracy "
                "FROM answer_records WHERE quiz_id = %s",
                (quiz_id,),
            )
            row = await cur.fetchone()
            if row is None:
                return None
            return {
                "records": json.loads(row[0]) if isinstance(row[0], str) else row[0],
                "total_questions": int(row[1]),
                "correct_count": int(row[2]),
                "accuracy": round(float(row[3])),
            }


async def get_report_record(quiz_id: str) -> Optional[dict]:
    """按 quiz_id 查询报告表当前状态与内容。"""
    pool = get_mysql_pool()
    if pool is None:
        return None
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT user_id, report_json, status, error_message "
                "FROM reports WHERE quiz_id = %s",
                (quiz_id,),
            )
            row = await cur.fetchone()
            if row is None:
                return None
            rp_json = json.loads(row[1]) if isinstance(row[1], str) else row[1]
            return {
                "user_id": row[0],
                "report": rp_json if isinstance(rp_json, dict) and rp_json else None,
                "status": row[2] or "completed",
                "error_message": row[3],
            }


async def persist_submission_with_xp(
    quiz_id: str,
    user_id: int,
    records_json: list,
    total_questions: int,
    correct_count: int,
    accuracy: float,
    xp_gain: int,
) -> bool:
    """在同一事务内幂等写入答卷并发放首次经验值；重复提交返回 False 且不重复加分。"""
    pool = get_mysql_pool()
    if pool is None:
        return True
    async with pool.acquire() as conn:
        await conn.begin()
        try:
            async with conn.cursor() as cur:
                await cur.execute(
                    "INSERT IGNORE INTO answer_records "
                    "(quiz_id, user_id, records_json, total_questions, correct_count, accuracy) "
                    "VALUES (%s, %s, %s, %s, %s, %s)",
                    (
                        quiz_id,
                        user_id,
                        json.dumps(records_json, ensure_ascii=False),
                        total_questions,
                        correct_count,
                        accuracy,
                    ),
                )
                inserted = cur.rowcount > 0
                if inserted and xp_gain > 0:
                    await cur.execute(
                        "UPDATE users SET total_xp = total_xp + %s WHERE id = %s",
                        (xp_gain, user_id),
                    )
            await conn.commit()
            return inserted
        except Exception:
            await conn.rollback()
            raise


async def save_answer_record(
    quiz_id: str,
    user_id: Optional[int],
    records_json: list,
    total_questions: int,
    correct_count: int,
    accuracy: float,
) -> bool:
    pool = get_mysql_pool()
    if pool is None:
        return True
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT IGNORE INTO answer_records "
                "(quiz_id, user_id, records_json, total_questions, correct_count, accuracy) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (
                    quiz_id,
                    user_id,
                    json.dumps(records_json, ensure_ascii=False),
                    total_questions,
                    correct_count,
                    accuracy,
                ),
            )
            return cur.rowcount > 0


async def save_report(
    quiz_id: str,
    user_id: Optional[int],
    report_json: dict,
    status: str = "completed",
    error_message: Optional[str] = None,
) -> None:
    pool = get_mysql_pool()
    if pool is None:
        return
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO reports (quiz_id, user_id, report_json, status, error_message) "
                "VALUES (%s, %s, %s, %s, %s) "
                "ON DUPLICATE KEY UPDATE "
                "report_json = VALUES(report_json), "
                "status = VALUES(status), "
                "error_message = VALUES(error_message)",
                (
                    quiz_id,
                    user_id,
                    json.dumps(report_json, ensure_ascii=False),
                    status,
                    error_message,
                ),
            )


async def get_user_quiz_count(user_id: int) -> int:
    pool = get_mysql_pool()
    if pool is None:
        return 0
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT COUNT(*) FROM quiz_sessions WHERE user_id = %s",
                (user_id,),
            )
            row = await cur.fetchone()
            return row[0] if row else 0


async def get_user_answer_stats(user_id: int) -> dict:
    """获取用户答题统计：总答对题数、平均正确率。"""
    pool = get_mysql_pool()
    if pool is None:
        return {"correct_count": 0, "average_accuracy": 0}
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT COALESCE(SUM(correct_count), 0), COALESCE(AVG(accuracy), 0) "
                "FROM answer_records WHERE user_id = %s",
                (user_id,),
            )
            row = await cur.fetchone()
            return {
                "correct_count": int(row[0]) if row else 0,
                "average_accuracy": round(float(row[1])) if row else 0,
            }


async def get_user_quiz_list(user_id: int, page: int, page_size: int) -> tuple[list[dict], int]:
    """分页获取用户闯关历史。返回 (items, total)。"""
    pool = get_mysql_pool()
    if pool is None:
        return [], 0
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            # 总数
            await cur.execute(
                "SELECT COUNT(*) FROM quiz_sessions WHERE user_id = %s",
                (user_id,),
            )
            total = (await cur.fetchone())[0]

            # 列表
            offset = (page - 1) * page_size
            await cur.execute(
                "SELECT qs.quiz_id, qs.title, "
                "COALESCE(ar.accuracy, 0), COALESCE(ar.total_questions, JSON_LENGTH(qs.questions_json), 0), "
                "qs.created_at, qs.domain_name, qs.source_type "
                "FROM quiz_sessions qs "
                "LEFT JOIN answer_records ar ON qs.quiz_id = ar.quiz_id "
                "WHERE qs.user_id = %s "
                "ORDER BY qs.created_at DESC "
                "LIMIT %s OFFSET %s",
                (user_id, page_size, offset),
            )
            rows = await cur.fetchall()
            items = [
                {
                    "quiz_id": r[0],
                    "title": r[1],
                    "accuracy": float(r[2]),
                    "question_count": r[3],
                    "created_at": r[4].strftime("%Y-%m-%d %H:%M:%S") if r[4] else "",
                    "domain_name": r[5],
                    "source_type": r[6] or "llm_direct",
                }
                for r in rows
            ]
            return items, total


async def get_quiz_detail(quiz_id: str, user_id: int) -> Optional[dict]:
    """获取单次闯关完整详情。"""
    pool = get_mysql_pool()
    if pool is None:
        return None
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT quiz_id, title, summary, user_input, questions_json, "
                "image_status, image_notice, created_at, domain_id, domain_name, source_type "
                "FROM quiz_sessions WHERE quiz_id = %s AND user_id = %s",
                (quiz_id, user_id),
            )
            qs_row = await cur.fetchone()
            if qs_row is None:
                return None

            result = {
                "quiz_id": qs_row[0],
                "title": qs_row[1],
                "summary": qs_row[2],
                "user_input": qs_row[3],
                "questions": json.loads(qs_row[4]) if isinstance(qs_row[4], str) else qs_row[4],
                "image_status": qs_row[5] or "none",
                "image_notice": qs_row[6],
                "created_at": qs_row[7].strftime("%Y-%m-%d %H:%M:%S") if qs_row[7] else "",
                "domain_id": qs_row[8],
                "domain_name": qs_row[9],
                "source_type": qs_row[10] or "llm_direct",
            }

            # 答题记录
            await cur.execute(
                "SELECT records_json FROM answer_records WHERE quiz_id = %s",
                (quiz_id,),
            )
            ar_row = await cur.fetchone()
            if ar_row:
                result["answer_records"] = json.loads(ar_row[0]) if isinstance(ar_row[0], str) else ar_row[0]

            # 报告
            await cur.execute(
                "SELECT report_json, status, error_message FROM reports WHERE quiz_id = %s",
                (quiz_id,),
            )
            rp_row = await cur.fetchone()
            if rp_row:
                rp_json = json.loads(rp_row[0]) if isinstance(rp_row[0], str) else rp_row[0]
                rp_status = rp_row[1] or "completed"
                result["report_status"] = rp_status
                result["report_error"] = rp_row[2]
                if rp_status == "completed" and isinstance(rp_json, dict) and rp_json:
                    result["report"] = rp_json

            return result
