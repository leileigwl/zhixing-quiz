"""报告服务：服务端权威判分、XP 幂等结算、异步 AI 复盘生成"""

from __future__ import annotations

import asyncio
from typing import Optional

import structlog

from app.core.exceptions import (
    AuthorizationError,
    ReportGenerationError,
    ResourceNotFoundError,
)
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
from app.repositories import quiz_repository, user_repository
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
        _schedule_background_report(
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

    await quiz_repository.save_report(
        quiz_id=req.quiz_id,
        user_id=user_id,
        report_json={},
        status="generating",
        error_message=None,
    )
    _schedule_background_report(
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
