"""知识域、单题规范化存储、三维掌握画像、SM-2 错题卡与订阅配额仓储"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Optional

import structlog

from app.core.db import get_mysql_pool

logger = structlog.get_logger()


async def list_user_domains(user_id: int) -> list[dict]:
    pool = get_mysql_pool()
    if pool is None:
        return []
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT d.id, d.name, d.color_token, "
                "(SELECT COUNT(*) FROM kb_documents kd WHERE kd.domain_id = d.id AND kd.user_id = d.user_id) AS real_doc_count "
                "FROM domains d WHERE d.user_id = %s ORDER BY d.updated_at DESC",
                (user_id,),
            )
            rows = await cur.fetchall()
            return [
                {
                    "domain_id": int(r[0]),
                    "name": r[1],
                    "color_token": r[2] or "blue",
                    "doc_count": int(r[3] or 0),
                }
                for r in rows
            ]


async def get_or_create_domain(user_id: int, name: str, color_token: str = "blue") -> dict:
    pool = get_mysql_pool()
    if pool is None:
        return {"domain_id": 1, "name": name, "color_token": color_token}
    clean_name = (name or "综合知识域").strip()[:100]
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO domains (user_id, name, color_token) VALUES (%s, %s, %s) "
                "ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)",
                (user_id, clean_name, color_token),
            )
            await cur.execute("SELECT LAST_INSERT_ID()")
            row = await cur.fetchone()
            domain_id = int(row[0])
            await cur.execute(
                "SELECT name, color_token FROM domains WHERE id = %s",
                (domain_id,),
            )
            info = await cur.fetchone()
            return {
                "domain_id": domain_id,
                "name": info[0] if info else clean_name,
                "color_token": (info[1] if info else color_token) or "blue",
            }


async def get_domain_by_id(domain_id: int, user_id: int) -> Optional[dict]:
    pool = get_mysql_pool()
    if pool is None:
        return None
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id, name, color_token FROM domains WHERE id = %s AND user_id = %s",
                (domain_id, user_id),
            )
            row = await cur.fetchone()
            if row is None:
                return None
            return {
                "domain_id": int(row[0]),
                "name": row[1],
                "color_token": row[2] or "blue",
            }


async def save_normalized_questions(
    quiz_id: str,
    user_id: Optional[int],
    domain_id: Optional[int],
    questions: list[dict],
) -> None:
    pool = get_mysql_pool()
    if pool is None or not questions:
        return
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            for q in questions:
                q_id = q.get("id")
                if not q_id:
                    continue
                q_uid = f"{quiz_id}:{q_id}"
                await cur.execute(
                    "INSERT IGNORE INTO questions "
                    "(question_uid, quiz_id, user_id, domain_id, q_type, stem, "
                    "options_json, answer_json, explanation, knowledge_point, difficulty, image_url) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (
                        q_uid,
                        quiz_id,
                        user_id,
                        domain_id,
                        q.get("type", "single"),
                        q.get("stem", ""),
                        json.dumps(q.get("options") or [], ensure_ascii=False),
                        json.dumps(q.get("answer") or [], ensure_ascii=False),
                        q.get("explanation", ""),
                        q.get("knowledge_point", ""),
                        q.get("difficulty", "medium"),
                        q.get("image_url"),
                    ),
                )


async def get_mastery_by_domain(user_id: int, domain_id: int) -> Optional[dict]:
    pool = get_mysql_pool()
    if pool is None:
        return None
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT self_rated_level, mastery_score, easy_correct, easy_total, "
                "medium_correct, medium_total, hard_correct, hard_total, "
                "avg_duration_ms, stability_days, retention_rate, last_practiced_at "
                "FROM user_knowledge_mastery WHERE user_id = %s AND domain_id = %s",
                (user_id, domain_id),
            )
            row = await cur.fetchone()
            if row is None:
                return None
            return {
                "self_rated_level": row[0],
                "mastery_score": float(row[1]),
                "easy_correct": int(row[2]),
                "easy_total": int(row[3]),
                "medium_correct": int(row[4]),
                "medium_total": int(row[5]),
                "hard_correct": int(row[6]),
                "hard_total": int(row[7]),
                "avg_duration_ms": int(row[8]),
                "stability_days": float(row[9]),
                "retention_rate": float(row[10]),
                "last_practiced_at": row[11],
            }


async def list_user_mastery_rows(user_id: int) -> list[dict]:
    pool = get_mysql_pool()
    if pool is None:
        return []
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT d.id, d.name, d.color_token, "
                "COALESCE(m.mastery_score, 50.0), COALESCE(m.easy_correct, 0), COALESCE(m.easy_total, 0), "
                "COALESCE(m.medium_correct, 0), COALESCE(m.medium_total, 0), "
                "COALESCE(m.hard_correct, 0), COALESCE(m.hard_total, 0), "
                "COALESCE(m.avg_duration_ms, 0), COALESCE(m.stability_days, 5.0), "
                "COALESCE(m.retention_rate, 85.0), m.last_practiced_at, "
                "(SELECT COUNT(*) FROM kb_documents kd WHERE kd.domain_id = d.id AND kd.user_id = d.user_id) AS doc_cnt, "
                "(SELECT COUNT(*) FROM review_cards rc WHERE rc.domain_id = d.id AND rc.user_id = d.user_id "
                "  AND rc.status != 'mastered' AND (rc.next_review_at <= NOW() OR rc.status = 'due')) AS due_cnt "
                "FROM domains d "
                "LEFT JOIN user_knowledge_mastery m ON m.domain_id = d.id AND m.user_id = d.user_id "
                "WHERE d.user_id = %s "
                "ORDER BY COALESCE(m.last_practiced_at, d.updated_at) DESC",
                (user_id,),
            )
            rows = await cur.fetchall()
            return [
                {
                    "domain_id": int(r[0]),
                    "name": r[1],
                    "color_token": r[2] or "blue",
                    "mastery_score": float(r[3]),
                    "easy_correct": int(r[4]),
                    "easy_total": int(r[5]),
                    "medium_correct": int(r[6]),
                    "medium_total": int(r[7]),
                    "hard_correct": int(r[8]),
                    "hard_total": int(r[9]),
                    "avg_duration_ms": int(r[10]),
                    "stability_days": float(r[11]),
                    "retention_rate": float(r[12]),
                    "last_practiced_at": r[13],
                    "doc_count": int(r[14] or 0),
                    "due_review_count": int(r[15] or 0),
                }
                for r in rows
            ]


async def upsert_mastery_after_submission(
    user_id: int,
    domain_id: int,
    easy_correct: int,
    easy_total: int,
    medium_correct: int,
    medium_total: int,
    hard_correct: int,
    hard_total: int,
    avg_duration_ms: int,
    self_rated_level: Optional[str] = None,
) -> float:
    """累加领域三维难度表现并重算加权掌握分、遗忘稳定性 S 与即时保持率。"""
    pool = get_mysql_pool()
    if pool is None:
        return 50.0

    async with pool.acquire() as conn:
        await conn.begin()
        try:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT easy_correct, easy_total, medium_correct, medium_total, "
                    "hard_correct, hard_total, avg_duration_ms, stability_days "
                    "FROM user_knowledge_mastery WHERE user_id = %s AND domain_id = %s FOR UPDATE",
                    (user_id, domain_id),
                )
                existing = await cur.fetchone()

                if existing:
                    ec = int(existing[0]) + easy_correct
                    et = int(existing[1]) + easy_total
                    mc = int(existing[2]) + medium_correct
                    mt = int(existing[3]) + medium_total
                    hc = int(existing[4]) + hard_correct
                    ht = int(existing[5]) + hard_total
                    prev_dur = int(existing[6])
                    dur = round((prev_dur + avg_duration_ms) / 2) if prev_dur > 0 else avg_duration_ms
                    prev_s = float(existing[7])
                else:
                    ec, et, mc, mt, hc, ht = (
                        easy_correct,
                        easy_total,
                        medium_correct,
                        medium_total,
                        hard_correct,
                        hard_total,
                    )
                    dur = avg_duration_ms
                    prev_s = 5.0

                # 加权掌握分：基础 1.0x / 中等 1.4x / 困难 1.8x
                weighted_c = ec * 1.0 + mc * 1.4 + hc * 1.8
                weighted_t = et * 1.0 + mt * 1.4 + ht * 1.8
                mastery_score = round((weighted_c / weighted_t) * 100.0, 2) if weighted_t > 0 else 50.0

                session_total = easy_total + medium_total + hard_total
                session_correct = easy_correct + medium_correct + hard_correct
                session_acc = (session_correct / session_total) if session_total > 0 else 0.5

                if session_acc >= 0.75:
                    stability_days = round(min(45.0, prev_s * 1.45), 2)
                elif session_acc >= 0.5:
                    stability_days = round(min(30.0, prev_s * 1.1), 2)
                else:
                    stability_days = round(max(1.5, prev_s * 0.75), 2)

                retention_rate = round(min(98.0, max(62.0, mastery_score * 0.4 + session_acc * 60.0)), 2)

                await cur.execute(
                    "INSERT INTO user_knowledge_mastery "
                    "(user_id, domain_id, self_rated_level, mastery_score, "
                    "easy_correct, easy_total, medium_correct, medium_total, "
                    "hard_correct, hard_total, avg_duration_ms, stability_days, retention_rate, last_practiced_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW()) "
                    "ON DUPLICATE KEY UPDATE "
                    "self_rated_level = COALESCE(VALUES(self_rated_level), self_rated_level), "
                    "mastery_score = VALUES(mastery_score), "
                    "easy_correct = VALUES(easy_correct), easy_total = VALUES(easy_total), "
                    "medium_correct = VALUES(medium_correct), medium_total = VALUES(medium_total), "
                    "hard_correct = VALUES(hard_correct), hard_total = VALUES(hard_total), "
                    "avg_duration_ms = VALUES(avg_duration_ms), "
                    "stability_days = VALUES(stability_days), "
                    "retention_rate = VALUES(retention_rate), "
                    "last_practiced_at = NOW()",
                    (
                        user_id,
                        domain_id,
                        self_rated_level,
                        mastery_score,
                        ec,
                        et,
                        mc,
                        mt,
                        hc,
                        ht,
                        dur,
                        stability_days,
                        retention_rate,
                    ),
                )
            await conn.commit()
            return mastery_score
        except Exception:
            await conn.rollback()
            raise


async def upsert_review_card(
    user_id: int,
    domain_id: Optional[int],
    quiz_id: str,
    question_id: str,
    interval_days: int = 1,
    easiness_factor: float = 2.5,
    repetitions: int = 0,
    status: str = "active",
    immediately_due: bool = False,
) -> Optional[int]:
    pool = get_mysql_pool()
    if pool is None:
        return None
    question_uid = f"{quiz_id}:{question_id}"
    next_at = datetime.now() if immediately_due else datetime.now() + timedelta(days=interval_days)
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO review_cards "
                "(user_id, domain_id, question_uid, quiz_id, question_id, "
                "easiness_factor, interval_days, repetitions, status, next_review_at, last_reviewed_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW()) "
                "ON DUPLICATE KEY UPDATE "
                "easiness_factor = VALUES(easiness_factor), "
                "interval_days = VALUES(interval_days), "
                "repetitions = VALUES(repetitions), "
                "status = VALUES(status), "
                "next_review_at = VALUES(next_review_at), "
                "last_reviewed_at = NOW(), "
                "id = LAST_INSERT_ID(id)",
                (
                    user_id,
                    domain_id,
                    question_uid,
                    quiz_id,
                    question_id,
                    easiness_factor,
                    interval_days,
                    repetitions,
                    status,
                    next_at,
                ),
            )
            await cur.execute("SELECT LAST_INSERT_ID()")
            row = await cur.fetchone()
            return int(row[0]) if row else None


async def get_review_card_by_uid(user_id: int, question_uid: str) -> Optional[dict]:
    pool = get_mysql_pool()
    if pool is None:
        return None
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id, domain_id, easiness_factor, interval_days, repetitions, status "
                "FROM review_cards WHERE user_id = %s AND question_uid = %s",
                (user_id, question_uid),
            )
            row = await cur.fetchone()
            if row is None:
                return None
            return {
                "card_id": int(row[0]),
                "domain_id": row[1],
                "easiness_factor": float(row[2]),
                "interval_days": int(row[3]),
                "repetitions": int(row[4]),
                "status": row[5],
            }


async def activate_review_card(card_id: int) -> Optional[dict]:
    """将已到期但仍为 active 的卡片激活为 due 并返回推送上下文。"""
    pool = get_mysql_pool()
    if pool is None:
        return None
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT rc.id, rc.user_id, rc.domain_id, rc.quiz_id, rc.question_id, "
                "rc.next_review_at, rc.status, u.openid, COALESCE(d.name, '综合知识域') "
                "FROM review_cards rc "
                "JOIN users u ON u.id = rc.user_id "
                "LEFT JOIN domains d ON d.id = rc.domain_id "
                "WHERE rc.id = %s",
                (card_id,),
            )
            row = await cur.fetchone()
            if row is None:
                return None
            status = row[6]
            if status == "mastered":
                return None
            await cur.execute(
                "UPDATE review_cards SET status = 'due' WHERE id = %s AND status = 'active'",
                (card_id,),
            )
            return {
                "card_id": int(row[0]),
                "user_id": int(row[1]),
                "domain_id": row[2],
                "quiz_id": row[3],
                "question_id": row[4],
                "openid": row[7],
                "domain_name": row[8],
            }


async def find_due_unnotified_cards(limit: int = 100) -> list[dict]:
    """Cron 扫表补偿：找出已到期但尚未激活或通知的卡片。"""
    pool = get_mysql_pool()
    if pool is None:
        return []
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT rc.id, rc.user_id, u.openid, COALESCE(d.name, '综合知识域'), COUNT(*) AS cnt "
                "FROM review_cards rc "
                "JOIN users u ON u.id = rc.user_id "
                "LEFT JOIN domains d ON d.id = rc.domain_id "
                "WHERE rc.status IN ('active', 'due') AND rc.next_review_at <= NOW() AND rc.notified_at IS NULL "
                "GROUP BY rc.id, rc.user_id, u.openid, d.name "
                "ORDER BY rc.next_review_at ASC LIMIT %s",
                (limit,),
            )
            rows = await cur.fetchall()
            if rows:
                card_ids = [int(r[0]) for r in rows]
                placeholders = ", ".join(["%s"] * len(card_ids))
                await cur.execute(
                    f"UPDATE review_cards SET status = 'due' WHERE id IN ({placeholders}) AND status = 'active'",
                    tuple(card_ids),
                )
            return [
                {
                    "card_id": int(r[0]),
                    "user_id": int(r[1]),
                    "openid": r[2],
                    "domain_name": r[3],
                }
                for r in rows
            ]


async def mark_cards_notified(card_ids: list[int]) -> None:
    pool = get_mysql_pool()
    if pool is None or not card_ids:
        return
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            placeholders = ", ".join(["%s"] * len(card_ids))
            await cur.execute(
                f"UPDATE review_cards SET notified_at = NOW() WHERE id IN ({placeholders})",
                tuple(card_ids),
            )


def _extract_user_selected(records_raw, question_id: str) -> list[str]:
    try:
        records = json.loads(records_raw) if isinstance(records_raw, str) else records_raw
        for r in records or []:
            if isinstance(r, dict) and r.get("question_id") == question_id:
                return [str(x) for x in (r.get("selected_answers") or [])]
    except Exception:
        pass
    return []


async def count_unresolved_review_cards(
    user_id: int,
    domain_id: Optional[int] = None,
) -> int:
    pool = get_mysql_pool()
    if pool is None:
        return 0
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            where = "user_id = %s AND status != 'mastered'"
            params: list = [user_id]
            if domain_id is not None:
                where += " AND domain_id = %s"
                params.append(domain_id)
            await cur.execute(f"SELECT COUNT(*) FROM review_cards WHERE {where}", tuple(params))
            row = await cur.fetchone()
            return int(row[0]) if row else 0


async def list_due_review_cards(
    user_id: int,
    limit: int = 20,
    domain_id: Optional[int] = None,
    include_all_unresolved: bool = False,
) -> tuple[int, list[dict]]:
    pool = get_mysql_pool()
    if pool is None:
        return 0, []
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            where_clauses = ["rc.user_id = %s", "rc.status != 'mastered'"]
            params: list = [user_id]
            if not include_all_unresolved:
                where_clauses.append("(rc.next_review_at <= NOW() OR rc.status = 'due')")
            if domain_id is not None:
                where_clauses.append("rc.domain_id = %s")
                params.append(domain_id)
            where_sql = " AND ".join(where_clauses)

            await cur.execute(f"SELECT COUNT(*) FROM review_cards rc WHERE {where_sql}", tuple(params))
            total_due = int((await cur.fetchone())[0])

            await cur.execute(
                "SELECT rc.id, rc.question_id, rc.quiz_id, rc.domain_id, COALESCE(d.name, '综合知识域'), "
                "COALESCE(q.q_type, 'single'), COALESCE(q.stem, '历史错题巩固'), "
                "q.options_json, q.answer_json, COALESCE(q.explanation, ''), "
                "COALESCE(q.knowledge_point, ''), COALESCE(q.difficulty, 'medium'), "
                "rc.repetitions, rc.interval_days, rc.status, rc.next_review_at, rc.last_reviewed_at, "
                "ar.records_json "
                "FROM review_cards rc "
                "LEFT JOIN domains d ON d.id = rc.domain_id "
                "LEFT JOIN questions q ON q.question_uid = rc.question_uid "
                "LEFT JOIN answer_records ar ON ar.quiz_id = rc.quiz_id "
                f"WHERE {where_sql} "
                "ORDER BY (rc.status = 'due') DESC, rc.next_review_at ASC LIMIT %s",
                tuple([*params, limit]),
            )
            rows = await cur.fetchall()
            items: list[dict] = []
            for r in rows:
                opts = json.loads(r[7]) if isinstance(r[7], str) else (r[7] or [])
                ans = json.loads(r[8]) if isinstance(r[8], str) else (r[8] or [])
                q_type = r[5] if r[5] in ("single", "multiple", "judge") else "single"
                diff = r[11] if r[11] in ("easy", "medium", "hard") else "medium"
                st = r[14] if r[14] in ("active", "due", "mastered") else "due"
                items.append(
                    {
                        "card_id": int(r[0]),
                        "question_id": r[1],
                        "quiz_id": r[2],
                        "domain_id": r[3],
                        "domain_name": r[4],
                        "q_type": q_type,
                        "stem": r[6],
                        "options": opts if isinstance(opts, list) else [],
                        "answer": [str(a) for a in (ans if isinstance(ans, list) else [])],
                        "explanation": r[9] or "",
                        "user_selected": _extract_user_selected(r[17], r[1]),
                        "knowledge_point": r[10] or "",
                        "difficulty": diff,
                        "repetitions": int(r[12] or 0),
                        "interval_days": int(r[13] or 1),
                        "status": st,
                        "next_review_at": r[15].strftime("%Y-%m-%d %H:%M:%S") if r[15] else "",
                        "last_reviewed_at": r[16].strftime("%Y-%m-%d %H:%M:%S") if r[16] else None,
                    }
                )
            return total_due, items


async def get_review_cards_by_ids(user_id: int, card_ids: list[int]) -> list[dict]:
    """按 card_ids 批量读取 SM-2 卡片元信息与题干上下文，供变式出题与核销推进。"""
    pool = get_mysql_pool()
    if pool is None or not card_ids:
        return []
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            placeholders = ", ".join(["%s"] * len(card_ids))
            await cur.execute(
                "SELECT rc.id, rc.domain_id, rc.easiness_factor, rc.interval_days, rc.repetitions, rc.status, "
                "rc.quiz_id, rc.question_id, COALESCE(q.stem, ''), COALESCE(q.knowledge_point, ''), "
                "COALESCE(q.explanation, ''), COALESCE(d.name, '综合知识域') "
                "FROM review_cards rc "
                "LEFT JOIN questions q ON q.question_uid = rc.question_uid "
                "LEFT JOIN domains d ON d.id = rc.domain_id "
                f"WHERE rc.user_id = %s AND rc.id IN ({placeholders})",
                tuple([user_id, *card_ids]),
            )
            rows = await cur.fetchall()
            return [
                {
                    "card_id": int(r[0]),
                    "domain_id": r[1],
                    "easiness_factor": float(r[2] or 2.5),
                    "interval_days": int(r[3] or 1),
                    "repetitions": int(r[4] or 0),
                    "status": r[5] or "due",
                    "quiz_id": r[6],
                    "question_id": r[7],
                    "stem": r[8],
                    "knowledge_point": r[9],
                    "explanation": r[10],
                    "domain_name": r[11],
                }
                for r in rows
            ]


async def update_review_card_progress(
    card_id: int,
    user_id: int,
    interval_days: int,
    easiness_factor: float,
    repetitions: int,
    status: str,
    immediately_due: bool = False,
) -> Optional[int]:
    """直接按主键 card_id 更新已有错题卡 SM-2 进度（答对推进/毕业，答错留在待练队列）。"""
    pool = get_mysql_pool()
    if pool is None:
        return None
    next_at = datetime.now() if immediately_due else datetime.now() + timedelta(days=interval_days)
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE review_cards SET easiness_factor = %s, interval_days = %s, "
                "repetitions = %s, status = %s, next_review_at = %s, last_reviewed_at = NOW() "
                "WHERE id = %s AND user_id = %s",
                (easiness_factor, interval_days, repetitions, status, next_at, card_id, user_id),
            )
            return card_id if cur.rowcount > 0 else None


async def get_review_cards_context(user_id: int, card_ids: list[int]) -> list[dict]:
    """根据勾选的错题卡 ID 读取原始题干与考点，供变式复习出题。"""
    pool = get_mysql_pool()
    if pool is None or not card_ids:
        return []
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            placeholders = ", ".join(["%s"] * len(card_ids))
            await cur.execute(
                "SELECT rc.id, q.stem, q.knowledge_point, q.explanation, COALESCE(d.name, '综合知识域') "
                "FROM review_cards rc "
                "LEFT JOIN questions q ON q.question_uid = rc.question_uid "
                "LEFT JOIN domains d ON d.id = rc.domain_id "
                f"WHERE rc.user_id = %s AND rc.id IN ({placeholders})",
                tuple([user_id, *card_ids]),
            )
            rows = await cur.fetchall()
            return [
                {
                    "card_id": int(r[0]),
                    "stem": r[1] or "",
                    "knowledge_point": r[2] or "",
                    "explanation": r[3] or "",
                    "domain_name": r[4],
                }
                for r in rows
            ]


async def get_user_daily_counts(user_id: int, days: int = 7) -> dict[str, int]:
    """查询过去 N 天每日答卷题数，供 MOVEPOP 7 日节律柱状图渲染。"""
    pool = get_mysql_pool()
    if pool is None:
        return {}
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT DATE_FORMAT(created_at, '%%Y-%%m-%%d') AS d, COALESCE(SUM(total_questions), 0) "
                "FROM answer_records "
                "WHERE user_id = %s AND created_at >= DATE_SUB(CURDATE(), INTERVAL %s DAY) "
                "GROUP BY DATE_FORMAT(created_at, '%%Y-%%m-%%d')",
                (user_id, days),
            )
            rows = await cur.fetchall()
            return {str(r[0]): int(r[1]) for r in rows}


async def get_user_weekly_sessions(user_id: int, days: int = 7) -> dict[str, list[dict]]:
    """查询过去 N 天每天完成的具体测验明细，供本周节律与印章点击下钻。"""
    pool = get_mysql_pool()
    if pool is None:
        return {}
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT DATE_FORMAT(ar.created_at, '%%Y-%%m-%%d') AS d, ar.quiz_id, "
                "COALESCE(qs.title, '专题测验'), COALESCE(qs.domain_name, '综合知识域'), "
                "ar.total_questions, ar.accuracy, rp.report_json "
                "FROM answer_records ar "
                "LEFT JOIN quiz_sessions qs ON qs.quiz_id = ar.quiz_id "
                "LEFT JOIN reports rp ON rp.quiz_id = ar.quiz_id AND rp.status = 'completed' "
                "WHERE ar.user_id = %s AND ar.created_at >= DATE_SUB(CURDATE(), INTERVAL %s DAY) "
                "ORDER BY ar.created_at DESC",
                (user_id, days),
            )
            rows = await cur.fetchall()
            grouped: dict[str, list[dict]] = {}
            for r in rows:
                d_str = str(r[0])
                weak_points: list[str] = []
                raw_rp = r[6]
                if raw_rp:
                    try:
                        rp_dict = json.loads(raw_rp) if isinstance(raw_rp, str) else raw_rp
                        if isinstance(rp_dict, dict):
                            weak_points = [str(w) for w in (rp_dict.get("weak_points") or [])[:3] if w]
                    except Exception:
                        weak_points = []
                grouped.setdefault(d_str, []).append(
                    {
                        "quiz_id": str(r[1]),
                        "title": str(r[2] or "专题测验"),
                        "domain_name": str(r[3] or "综合知识域"),
                        "question_count": int(r[4] or 0),
                        "accuracy": round(float(r[5] or 0), 1),
                        "weak_points": weak_points,
                    }
                )
            return grouped


async def get_domain_recent_history(
    user_id: int,
    domain_id: Optional[int] = None,
    limit: int = 4,
) -> list[dict]:
    """查询指定领域（或全局）最近几场已交卷记录，按时间正序输出真实曲线节点。"""
    pool = get_mysql_pool()
    if pool is None:
        return []
    where_clause = "ar.user_id = %s"
    params: list = [user_id]
    if domain_id is not None:
        where_clause += " AND qs.domain_id = %s"
        params.append(domain_id)
    params.append(limit)
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                f"SELECT ar.quiz_id, COALESCE(qs.title, '专题测验'), ar.accuracy, ar.created_at "
                f"FROM answer_records ar "
                f"INNER JOIN quiz_sessions qs ON qs.quiz_id = ar.quiz_id "
                f"WHERE {where_clause} "
                f"ORDER BY ar.created_at DESC LIMIT %s",
                tuple(params),
            )
            rows = await cur.fetchall()
            ordered = list(reversed(rows))
            return [
                {
                    "quiz_id": str(r[0]),
                    "title": str(r[1] or "专题测验"),
                    "accuracy": round(float(r[2] or 0), 1),
                    "day_label": r[3].strftime("%m/%d") if r[3] else "历史",
                }
                for r in ordered
            ]


async def get_seven_day_forecast(user_id: int) -> list[int]:
    """统计未来 7 天每天预计到期的错题卡数量。"""
    pool = get_mysql_pool()
    if pool is None:
        return [0] * 7
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT DATEDIFF(DATE(next_review_at), CURDATE()) AS day_offset, COUNT(*) "
                "FROM review_cards "
                "WHERE user_id = %s AND status != 'mastered' "
                "AND next_review_at BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 6 DAY) "
                "GROUP BY day_offset",
                (user_id,),
            )
            rows = await cur.fetchall()
            counts = [0] * 7
            for offset, cnt in rows:
                idx = int(offset or 0)
                if 0 <= idx < 7:
                    counts[idx] = int(cnt)
            return counts


async def update_user_streak_on_submit(user_id: int) -> int:
    """更新用户连续打卡天数（当天不重复加，连续天 +1，断签重置为 1）。"""
    pool = get_mysql_pool()
    if pool is None:
        return 1
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT streak_days, last_practice_date FROM users WHERE id = %s",
                (user_id,),
            )
            row = await cur.fetchone()
            today = datetime.now().date()
            if not row:
                return 1
            curr_streak = int(row[0] or 0)
            last_date = row[1]

            if last_date == today:
                return max(1, curr_streak)
            if last_date == today - timedelta(days=1):
                next_streak = max(1, curr_streak + 1)
            else:
                next_streak = 1

            await cur.execute(
                "UPDATE users SET streak_days = %s, last_practice_date = %s WHERE id = %s",
                (next_streak, today, user_id),
            )
            return next_streak


async def grant_subscribe_quota(
    user_id: int,
    template_id: str,
    count: int = 1,
    preferred_hour: int = 20,
) -> int:
    pool = get_mysql_pool()
    if pool is None:
        return count
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO subscribe_quotas (user_id, template_id, remaining_count, preferred_hour) "
                "VALUES (%s, %s, %s, %s) "
                "ON DUPLICATE KEY UPDATE "
                "remaining_count = remaining_count + VALUES(remaining_count), "
                "preferred_hour = VALUES(preferred_hour)",
                (user_id, template_id, count, preferred_hour),
            )
            await cur.execute(
                "SELECT remaining_count FROM subscribe_quotas WHERE user_id = %s AND template_id = %s",
                (user_id, template_id),
            )
            row = await cur.fetchone()
            return int(row[0]) if row else count


async def get_subscribe_quota(user_id: int, template_id: str = "default_review_reminder") -> int:
    pool = get_mysql_pool()
    if pool is None:
        return 0
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT remaining_count FROM subscribe_quotas WHERE user_id = %s AND template_id = %s",
                (user_id, template_id),
            )
            row = await cur.fetchone()
            return int(row[0]) if row else 0


async def consume_subscribe_quota(user_id: int, template_id: str) -> bool:
    pool = get_mysql_pool()
    if pool is None:
        return False
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE subscribe_quotas SET remaining_count = remaining_count - 1 "
                "WHERE user_id = %s AND template_id = %s AND remaining_count > 0",
                (user_id, template_id),
            )
            return cur.rowcount > 0
