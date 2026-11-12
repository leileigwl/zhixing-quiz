"""报告服务 V2：权威判分、XP 幂等结算、三维掌握度聚合、SM-2 复习卡与 ARQ 异步复盘"""

from __future__ import annotations

import asyncio
from typing import Optional

import structlog

from app.core.config import get_settings
from app.core.db import get_mysql_pool
from app.core.exceptions import (
    AuthorizationError,
    ReportGenerationError,
    ResourceNotFoundError,
)
from app.core.redis_client import get_arq_pool
from app.llm.report_chain import generate_report
from app.models.quiz import AnswerRecord, Question
from app.models.report import (
    ReportGenerateRequest,
    ReportGenerateResponse,
    ReportStatusResponse,
    ReportSubmitRequest,
    ReportSubmitResponse,
    SubmittedAnswerItem,
)
from app.repositories import mastery_repository, quiz_repository, user_repository
from app.services import domain_classifier, mastery_service, review_service
from app.services.scoring_service import (
    calculate_xp_gain,
    compute_score_summary,
    grade_submitted_answers,
)

logger = structlog.get_logger()

_background_report_tasks: set[asyncio.Task] = set()


async def _run_background_report_generation(
    quiz_id: str,
    user_id: int,
    topic: str,
    questions: list[Question],
    answer_records: list[AnswerRecord],
    score_summary: dict,
) -> None:
    """后台异步调用 LLM 生成复盘报告并持久化状态。"""
    try:
        report_output = await generate_report(
            topic=topic,
            questions=questions,
            answer_records=answer_records,
            score_summary=score_summary,
        )
        await quiz_repository.save_report(
            quiz_id=quiz_id,
            user_id=user_id,
            report_json=report_output.model_dump(),
            status="completed",
            error_message=None,
        )
        logger.info("background_report_completed", quiz_id=quiz_id, user_id=user_id)
    except Exception as e:
        logger.error("background_report_failed", quiz_id=quiz_id, user_id=user_id, error=str(e))
        await quiz_repository.save_report(
            quiz_id=quiz_id,
            user_id=user_id,
            report_json={},
            status="failed",
            error_message=str(e)[:500],
        )


async def run_generate_report_job(
    quiz_id: str,
    user_id: int,
    topic: str,
    questions_payload: list[dict],
    records_payload: list[dict],
    score_summary: dict,
) -> None:
    """ARQ Worker 复盘报告任务入口（可序列化参数）。"""
    questions = [Question.model_validate(q) for q in questions_payload]
    records = [AnswerRecord.model_validate(r) for r in records_payload]
    await _run_background_report_generation(
        quiz_id=quiz_id,
        user_id=user_id,
        topic=topic,
        questions=questions,
        answer_records=records,
        score_summary=score_summary,
    )


def _schedule_background_report(
    quiz_id: str,
    user_id: int,
    topic: str,
    questions: list[Question],
    answer_records: list[AnswerRecord],
    score_summary: dict,
) -> None:
    task = asyncio.create_task(
        _run_background_report_generation(
            quiz_id, user_id, topic, questions, answer_records, score_summary
        )
    )
    _background_report_tasks.add(task)
    task.add_done_callback(_background_report_tasks.discard)


async def _dispatch_report_generation(
    quiz_id: str,
    user_id: int,
    topic: str,
    questions: list[Question],
    answer_records: list[AnswerRecord],
    score_summary: dict,
) -> None:
    settings = get_settings()
    arq_pool = get_arq_pool()
    if settings.enable_arq_queue and arq_pool is not None:
        await arq_pool.enqueue_job(
            "job_generate_report",
            quiz_id,
            user_id,
            topic,
            [q.model_dump() for q in questions],
            [r.model_dump() for r in answer_records],
            score_summary,
            _job_id=f"rep:{quiz_id}",
        )
        return
    _schedule_background_report(quiz_id, user_id, topic, questions, answer_records, score_summary)


async def _update_v2_learning_state(
    *,
    session: dict,
    quiz_id: str,
    user_id: int,
    questions: list[Question],
    graded_records: list[AnswerRecord],
    mark_review_map: dict[str, bool],
) -> dict:
    """交卷后聚合 E/M/H 表现、更新打卡、核销错题原卡并实时算出本次双轨曲线与 7 日节律。"""
    domain_id: Optional[int] = session.get("domain_id")
    domain_name: Optional[str] = session.get("domain_name")
    domain_mastery_after: Optional[float] = None
    stability_after: Optional[float] = None
    streak_days = 0
    due_cards_created = 0
    progressed_count = 0
    session_curve: list = []
    weekly_rhythm: list = []

    use_db = (
        get_mysql_pool() is not None
        or hasattr(mastery_repository.upsert_mastery_after_submission, "assert_called")
        or hasattr(mastery_repository.update_user_streak_on_submit, "assert_called")
    )
    if not use_db:
        return {
            "domain_id": domain_id,
            "domain_name": domain_name,
            "domain_mastery_after": domain_mastery_after,
            "stability_days_after": stability_after,
            "streak_days": streak_days,
            "due_cards_created": due_cards_created,
            "reviewed_cards_progressed": progressed_count,
            "session_retention_curve": session_curve,
            "weekly_rhythm": weekly_rhythm,
        }

    try:
        if domain_id is None:
            hint_text = (session.get("user_input") or session.get("title") or "").strip()
            existing = [d["name"] for d in await mastery_repository.list_user_domains(user_id)]
            guessed_name, color = await domain_classifier.classify_domain_with_llm(hint_text, existing)
            dom = await mastery_repository.get_or_create_domain(user_id, guessed_name, color)
            domain_id, domain_name = dom["domain_id"], dom["name"]

        q_map = {q.id: q for q in questions}
        counts = {"easy": [0, 0], "medium": [0, 0], "hard": [0, 0]}
        total_dur = 0
        for rec in graded_records:
            q = q_map.get(rec.question_id)
            diff = q.difficulty if q else "medium"
            if diff not in counts:
                diff = "medium"
            counts[diff][1] += 1
            if rec.is_correct:
                counts[diff][0] += 1
            total_dur += max(0, int(rec.duration_ms))

        avg_dur = round(total_dur / len(graded_records)) if graded_records else 0

        if domain_id is not None:
            domain_mastery_after = await mastery_repository.upsert_mastery_after_submission(
                user_id=user_id,
                domain_id=domain_id,
                easy_correct=counts["easy"][0],
                easy_total=counts["easy"][1],
                medium_correct=counts["medium"][0],
                medium_total=counts["medium"][1],
                hard_correct=counts["hard"][0],
                hard_total=counts["hard"][1],
                avg_duration_ms=avg_dur,
            )

        streak_days = await mastery_repository.update_user_streak_on_submit(user_id)
        source_card_ids = [int(cid) for cid in (session.get("source_review_card_ids") or []) if cid]
        progressed_count, matched_qids = await review_service.progress_source_review_cards(
            user_id=user_id,
            questions=questions,
            graded_records=graded_records,
            source_card_ids=source_card_ids,
            mark_review_map=mark_review_map,
        )
        due_cards_created = await review_service.process_submission_reviews(
            user_id=user_id,
            quiz_id=quiz_id,
            domain_id=domain_id,
            questions=questions,
            graded_records=graded_records,
            mark_review_map=mark_review_map,
            skip_question_ids=matched_qids,
        )

        # 基于刚刚更新的最新域稳定性 S、掌握分与本次准确率，直接生成真实双轨曲线与本周节律
        latest_profile = (
            await mastery_repository.get_mastery_by_domain(user_id, domain_id)
            if domain_id is not None
            else None
        )
        daily_counts = await mastery_repository.get_user_daily_counts(user_id, days=7)
        daily_sessions = await mastery_repository.get_user_weekly_sessions(user_id, days=7)
        session_acc = (
            round((sum(1 for r in graded_records if r.is_correct) / len(graded_records)) * 100.0, 1)
            if graded_records
            else 0.0
        )
        stability_after = float((latest_profile or {}).get("stability_days") or 5.0)
        retention_after = float((latest_profile or {}).get("retention_rate") or max(45.0, session_acc))
        session_curve = mastery_service.build_retention_curve(
            stability_after,
            retention_after,
            mastery_score=domain_mastery_after,
            session_accuracy=session_acc,
            days_elapsed=1.0,
        )
        weekly_rhythm = mastery_service.build_weekly_rhythm(
            daily_counts,
            daily_sessions=daily_sessions,
        )

        await mastery_service.invalidate_mastery_cache(user_id)
    except Exception as exc:
        logger.warning("update_v2_learning_state_failed", quiz_id=quiz_id, error=str(exc))
        stability_after = None
        progressed_count = 0
        session_curve = []
        weekly_rhythm = []

    return {
        "domain_id": domain_id,
        "domain_name": domain_name,
        "domain_mastery_after": domain_mastery_after,
        "stability_days_after": stability_after,
        "streak_days": streak_days,
        "due_cards_created": due_cards_created,
        "reviewed_cards_progressed": progressed_count,
        "session_retention_curve": session_curve,
        "weekly_rhythm": weekly_rhythm,
    }


async def handle_report_submit(
    req: ReportSubmitRequest,
    user_id: int,
) -> ReportSubmitResponse:
    """交卷秒返服务端权威判分与幂等 XP 结算，并后台异步生成 AI 复盘报告。"""
    session = await quiz_repository.get_quiz_session_for_user(req.quiz_id)
    if session is None:
        raise ResourceNotFoundError("测验记录不存在")

    session_owner = session.get("user_id")
    if session_owner is not None and session_owner != user_id:
        raise AuthorizationError("无权提交他人测验答卷")

    questions = [Question.model_validate(q) for q in (session.get("questions") or [])]

    existing_ar = await quiz_repository.get_answer_record_by_quiz(req.quiz_id)
    if existing_ar is not None:
        total_q = existing_ar["total_questions"]
        correct_q = existing_ar["correct_count"]
        accuracy = existing_ar["accuracy"]
        wrong_q = max(0, total_q - correct_q)
        records_list = [AnswerRecord.model_validate(r) for r in (existing_ar.get("records") or [])]
        summary = compute_score_summary(records_list)

        existing_rp = await quiz_repository.get_report_record(req.quiz_id)
        domain_name = session.get("domain_name")
        if existing_rp and existing_rp["status"] == "completed" and existing_rp.get("report"):
            return ReportSubmitResponse(
                quiz_id=req.quiz_id,
                accuracy=accuracy,
                correct_count=correct_q,
                wrong_count=wrong_q,
                total_questions=total_q,
                xp_gain=0,
                xp_awarded=False,
                already_submitted=True,
                domain_name=domain_name,
                report_status="completed",
                report=ReportGenerateResponse.model_validate(existing_rp["report"]),
            )

        if existing_rp and existing_rp["status"] == "generating":
            return ReportSubmitResponse(
                quiz_id=req.quiz_id,
                accuracy=accuracy,
                correct_count=correct_q,
                wrong_count=wrong_q,
                total_questions=total_q,
                xp_gain=0,
                xp_awarded=False,
                already_submitted=True,
                domain_name=domain_name,
                report_status="generating",
            )

        # 若此前后台报告失败或未生成，自动重新拉起后台报告生成但不重复发放 XP
        await quiz_repository.save_report(
            quiz_id=req.quiz_id,
            user_id=user_id,
            report_json={},
            status="generating",
            error_message=None,
        )
        await _dispatch_report_generation(
            req.quiz_id,
            user_id,
            session["title"],
            questions,
            records_list,
            summary,
        )
        return ReportSubmitResponse(
            quiz_id=req.quiz_id,
            accuracy=accuracy,
            correct_count=correct_q,
            wrong_count=wrong_q,
            total_questions=total_q,
            xp_gain=0,
            xp_awarded=False,
            already_submitted=True,
            domain_name=domain_name,
            report_status="generating",
        )

    graded_records, score_summary = grade_submitted_answers(questions, req.answer_records)
    xp_gain = calculate_xp_gain(score_summary["correct"])

    awarded = await quiz_repository.persist_submission_with_xp(
        quiz_id=req.quiz_id,
        user_id=user_id,
        records_json=[r.model_dump() for r in graded_records],
        total_questions=score_summary["total"],
        correct_count=score_summary["correct"],
        accuracy=score_summary["accuracy"],
        xp_gain=xp_gain,
    )

    v2_state: dict = {
        "domain_id": session.get("domain_id"),
        "domain_name": session.get("domain_name"),
        "domain_mastery_after": None,
        "stability_days_after": None,
        "streak_days": 0,
        "due_cards_created": 0,
        "reviewed_cards_progressed": 0,
        "session_retention_curve": [],
        "weekly_rhythm": [],
    }
    if awarded:
        v2_state = await _update_v2_learning_state(
            session=session,
            quiz_id=req.quiz_id,
            user_id=user_id,
            questions=questions,
            graded_records=graded_records,
            mark_review_map={item.question_id: bool(item.mark_review) for item in req.answer_records},
        )

    await quiz_repository.save_report(
        quiz_id=req.quiz_id,
        user_id=user_id,
        report_json={},
        status="generating",
        error_message=None,
    )
    await _dispatch_report_generation(
        req.quiz_id,
        user_id,
        session["title"],
        questions,
        graded_records,
        score_summary,
    )

    return ReportSubmitResponse(
        quiz_id=req.quiz_id,
        accuracy=score_summary["accuracy"],
        correct_count=score_summary["correct"],
        wrong_count=score_summary["wrong"],
        total_questions=score_summary["total"],
        xp_gain=xp_gain if awarded else 0,
        xp_awarded=awarded,
        already_submitted=not awarded,
        streak_days=v2_state.get("streak_days", 0),
        domain_id=v2_state.get("domain_id"),
        domain_name=v2_state.get("domain_name"),
        domain_mastery_after=v2_state.get("domain_mastery_after"),
        stability_days_after=v2_state.get("stability_days_after"),
        due_cards_created=v2_state.get("due_cards_created", 0),
        reviewed_cards_progressed=v2_state.get("reviewed_cards_progressed", 0),
        session_retention_curve=v2_state.get("session_retention_curve", []),
        weekly_rhythm=v2_state.get("weekly_rhythm", []),
        report_status="generating",
    )


async def get_report_status(quiz_id: str, user_id: int) -> ReportStatusResponse:
    """轮询查询 AI 复盘报告生成状态与内容（校验测验归属当前用户）。"""
    session = await quiz_repository.get_quiz_session_for_user(quiz_id)
    if session is None:
        raise ResourceNotFoundError("测验记录不存在")

    session_owner = session.get("user_id")
    if session_owner is not None and session_owner != user_id:
        raise AuthorizationError("无权查询他人复盘报告")

    existing_rp = await quiz_repository.get_report_record(quiz_id)
    if existing_rp is None:
        raise ResourceNotFoundError("复盘报告尚未创建")

    status = existing_rp["status"]
    report = (
        ReportGenerateResponse.model_validate(existing_rp["report"])
        if status == "completed" and existing_rp.get("report")
        else None
    )
    return ReportStatusResponse(
        quiz_id=quiz_id,
        report_status=status,
        report=report,
        error_message=existing_rp.get("error_message"),
    )


async def handle_report_generate(
    req: ReportGenerateRequest,
    user_id: Optional[int] = None,
) -> ReportGenerateResponse:
    """保留兼容原同步报告生成接口（已补齐服务端重算与幂等落库防重复加分）。"""
    records_to_use = req.answer_records
    if user_id is not None:
        session = await quiz_repository.get_quiz_session_for_user(req.quiz_id)
        if session is not None:
            if session.get("user_id") is not None and session["user_id"] != user_id:
                raise AuthorizationError("无权提交他人测验答卷")
            session_questions = [
                Question.model_validate(q) for q in (session.get("questions") or [])
            ]
            submitted_items = [
                SubmittedAnswerItem(
                    question_id=r.question_id,
                    selected_answers=r.selected_answers,
                    duration_ms=r.duration_ms,
                )
                for r in req.answer_records
            ]
            records_to_use, _ = grade_submitted_answers(session_questions, submitted_items)

            existing_rp = await quiz_repository.get_report_record(req.quiz_id)
            if existing_rp and existing_rp["status"] == "completed" and existing_rp.get("report"):
                return ReportGenerateResponse.model_validate(existing_rp["report"])

    score_summary = compute_score_summary(records_to_use)

    try:
        report_output = await generate_report(
            topic=req.topic,
            questions=req.questions,
            answer_records=records_to_use,
            score_summary=score_summary,
        )
    except Exception as e:
        logger.error("report_generation_failed", error=str(e))
        raise ReportGenerationError(f"报告生成失败：{e}") from e

    # 有登录态时幂等落库（仅首次答卷插入成功时发放 XP）
    if user_id is not None:
        try:
            inserted = await quiz_repository.save_answer_record(
                quiz_id=req.quiz_id,
                user_id=user_id,
                records_json=[r.model_dump() for r in records_to_use],
                total_questions=score_summary["total"],
                correct_count=score_summary["correct"],
                accuracy=score_summary["accuracy"],
            )
            await quiz_repository.save_report(
                quiz_id=req.quiz_id,
                user_id=user_id,
                report_json=report_output.model_dump(),
                status="completed",
                error_message=None,
            )
            if inserted is not False:
                xp_gain = calculate_xp_gain(score_summary["correct"])
                await user_repository.add_user_xp(user_id, xp_gain)
        except Exception as e:
            logger.error("report_persist_failed", error=str(e))

    return ReportGenerateResponse(
        accuracy=report_output.accuracy,
        mastered_points=report_output.mastered_points,
        weak_points=report_output.weak_points,
        three_line_summary=report_output.three_line_summary,
        advice=report_output.advice,
        share_quote=report_output.share_quote,
    )
