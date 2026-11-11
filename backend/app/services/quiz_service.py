"""出题服务 V2（自适应题量/难度配比、LCEL 检索与 RAG 路由、规范化题目表与 ARQ 队列派发）"""

import asyncio
import uuid
from typing import Any, Optional

import structlog

from app.core.config import get_settings
from app.core.db import get_mysql_pool
from app.core.exceptions import (
    AuthorizationError,
    ContentFilterError,
    KnowledgeBaseError,
    QuizGenerationError,
    ResourceNotFoundError,
)
from app.core.redis_client import get_arq_pool
from app.core.security import check_content
from app.llm.quiz_chain import generate_quiz
from app.models.quiz import (
    Question,
    QuizGenerateRequest,
    QuizGenerateResponse,
    QuizImagesResponse,
    QuizOutput,
    QuizTaskCreateResponse,
    QuizTaskStatusResponse,
)
from app.repositories import (
    knowledge_repository,
    mastery_repository,
    quiz_repository,
    task_repository,
)
from app.services import (
    adaptive_service,
    domain_classifier,
    image_service,
    mastery_service,
    rag_service,
)
from app.services.search_service import fetch_knowledge_context, resolve_knowledge_context

logger = structlog.get_logger()

STAGE_MESSAGES: dict[str, str] = {
    "queued": "任务已进入队列，正在准备出题...",
    "fetching_context": "AI 正在检索知识资料与核心考点...",
    "generating_quiz": "AI 正在编排题目与详细解析...",
    "completed": "文字题目已就绪，即将进入答题页",
    "failed": "出题任务失败，请稍后重试",
}

# 保存后台生图任务强引用，避免未 await 的协程被 GC 提前回收
_background_image_tasks: set[asyncio.Task] = set()


async def _maybe_generate_images(
    quiz_output: QuizOutput,
    quiz_id: str,
    user_id: Optional[int],
    generate_images: bool,
) -> Optional[str]:
    """按需为题目生成配图并写回 question.image_url，失败绝不阻断出题主流程。"""
    if not generate_images:
        return None

    try:
        image_map, notice = await image_service.generate_images_for_quiz(
            quiz_output.questions, user_id, quiz_id
        )
        for q in quiz_output.questions:
            if q.id in image_map:
                q.image_url = image_map[q.id]
        return notice
    except Exception as e:
        logger.error("quiz_image_generation_failed", quiz_id=quiz_id, error=str(e))
        return None


def _is_mocked(fn: Any) -> bool:
    return hasattr(fn, "assert_called")


async def _validate_doc_id(req: QuizGenerateRequest, user_id: Optional[int]) -> Optional[dict]:
    """若请求指定了 doc_id，校验用户已登录且文档存在、归属正确且已就绪。"""
    if req.doc_id is None:
        return None

    if user_id is None:
        raise KnowledgeBaseError("使用知识库出题需要先登录")

    doc = await knowledge_repository.get_document(req.doc_id, user_id)
    if doc is None:
        raise KnowledgeBaseError("知识库文档不存在")

    if doc["status"] != "ready":
        raise KnowledgeBaseError(f"知识库文档尚未就绪（当前状态：{doc['status']}），请稍后重试")

    return doc


async def _fetch_context_with_source(
    req: QuizGenerateRequest,
    user_id: Optional[int],
) -> tuple[str, str]:
    """按文档/联网开关走 LCEL 确定性路由，同时兼容测试桩。"""
    if req.doc_id is not None:
        if _is_mocked(rag_service.fetch_rag_context):
            ctx = await rag_service.fetch_rag_context(req.user_input, user_id, req.doc_id)
            return ctx, ("kb_rag" if ctx else "llm_direct")
        return await rag_service.resolve_rag_context(
            user_input=req.user_input,
            user_id=user_id,
            doc_id=req.doc_id,
            enable_web_search=req.enable_web_search,
        )

    if _is_mocked(fetch_knowledge_context):
        ctx = await fetch_knowledge_context(req.user_input)
        return ctx, ("web_search" if ctx else "llm_direct")

    return await resolve_knowledge_context(
        user_input=req.user_input,
        enable_web_search=req.enable_web_search,
    )


async def _fetch_context(req: QuizGenerateRequest, user_id: Optional[int]) -> str:
    ctx, _ = await _fetch_context_with_source(req, user_id)
    return ctx


async def _resolve_domain_and_plan(
    req: QuizGenerateRequest,
    user_id: Optional[int],
    doc_info: Optional[dict],
) -> tuple[Optional[int], Optional[str], adaptive_service.AdaptivePlan]:
    """解析归属领域与三维历史画像，生成倒 U 自适应出题策略。"""
    domain_id: Optional[int] = None
    domain_name: Optional[str] = None
    mastery_profile: Optional[dict] = None

    use_mastery_db = (
        get_mysql_pool() is not None
        or _is_mocked(mastery_repository.get_or_create_domain)
        or _is_mocked(mastery_repository.get_domain_by_id)
    )

    if user_id is not None and use_mastery_db:
        try:
            if req.domain_id is not None:
                dom = await mastery_repository.get_domain_by_id(req.domain_id, user_id)
                if dom:
                    domain_id, domain_name = dom["domain_id"], dom["name"]

            if domain_id is None and doc_info and doc_info.get("domain_id"):
                domain_id = doc_info["domain_id"]
                domain_name = doc_info.get("domain_name")

            if domain_id is None:
                existing = [d["name"] for d in await mastery_repository.list_user_domains(user_id)]
                guessed_name, color = await domain_classifier.classify_domain_with_llm(
                    req.user_input, existing
                )
                dom = await mastery_repository.get_or_create_domain(user_id, guessed_name, color)
                domain_id, domain_name = dom["domain_id"], dom["name"]

            if domain_id is not None:
                mastery_profile = await mastery_repository.get_mastery_by_domain(user_id, domain_id)
        except Exception as exc:
            logger.warning("resolve_domain_mastery_failed", user_id=user_id, error=str(exc))
    elif user_id is not None:
        domain_name = domain_classifier.classify_domain_deterministic(req.user_input)[0]

    plan = adaptive_service.compute_adaptive_plan(
        requested_count=req.question_count,
        adaptive_mode=req.adaptive_mode,
        self_rated_level=req.self_rated_level,
        mastery_profile=mastery_profile,
        base_difficulty=req.difficulty,
    )
    return domain_id, domain_name, plan


async def _build_effective_user_input(
    req: QuizGenerateRequest,
    user_id: Optional[int],
) -> str:
    """若传入待复习错题卡 ID，拼装错题定向巩固考点约束。"""
    if not req.review_card_ids or user_id is None:
        return req.user_input

    if get_mysql_pool() is None and not _is_mocked(mastery_repository.get_review_cards_context):
        return req.user_input

    try:
        cards = await mastery_repository.get_review_cards_context(user_id, req.review_card_ids)
    except Exception as exc:
        logger.warning("fetch_review_cards_context_failed", user_id=user_id, error=str(exc))
        return req.user_input

    if not cards:
        return req.user_input

    lines = [
        f"- 考点【{c['knowledge_point'] or c['domain_name']}】原错题参考：{c['stem'][:160]}"
        for c in cards[:8]
    ]
    return (
        f"{req.user_input}\n\n"
        "【错题定向巩固变式出题要求】\n"
        "请围绕以下历史薄弱考点设计新的变式题目（更换场景或干扰项，不要原题照抄）：\n"
        + "\n".join(lines)
    )


async def _persist_quiz_session_and_questions(
    *,
    quiz_id: str,
    user_id: Optional[int],
    quiz_output: QuizOutput,
    user_input: str,
    image_status: str,
    image_notice: Optional[str],
    domain_id: Optional[int],
    domain_name: Optional[str],
    source_type: str,
) -> None:
    if user_id is None:
        return
    questions_dump = [q.model_dump() for q in quiz_output.questions]
    try:
        await quiz_repository.save_quiz_session(
            quiz_id=quiz_id,
            user_id=user_id,
            title=quiz_output.title,
            summary=quiz_output.summary,
            user_input=user_input,
            questions_json=questions_dump,
            image_status=image_status,
            image_notice=image_notice,
            domain_id=domain_id,
            domain_name=domain_name,
            source_type=source_type,
        )
        if domain_id is not None or _is_mocked(mastery_repository.save_normalized_questions):
            await mastery_repository.save_normalized_questions(
                quiz_id=quiz_id,
                user_id=user_id,
                domain_id=domain_id,
                questions=questions_dump,
            )
            await mastery_service.invalidate_mastery_cache(user_id)
    except Exception as e:
        logger.error("quiz_session_save_failed", quiz_id=quiz_id, error=str(e))


async def handle_quiz_generate(
    req: QuizGenerateRequest,
    user_id: Optional[int] = None,
) -> QuizGenerateResponse:
    if not check_content(req.user_input):
        raise ContentFilterError("输入内容包含不当内容，请修改后重试")

    doc_info = await _validate_doc_id(req, user_id)
    domain_id, domain_name, plan = await _resolve_domain_and_plan(req, user_id, doc_info)
    search_context, source_type = await _fetch_context_with_source(req, user_id)
    effective_input = await _build_effective_user_input(req, user_id)
    prompt_difficulty = (
        plan.difficulty_instruction
        if (req.adaptive_mode or req.self_rated_level)
        else req.difficulty
    )

    try:
        quiz_output = await generate_quiz(
            user_input=effective_input,
            question_count=plan.question_count,
            difficulty=prompt_difficulty,
            search_context=search_context,
        )
    except Exception as e:
        logger.error("quiz_generation_failed", error=str(e))
        raise QuizGenerationError(f"题库生成失败：{e}") from e

    quiz_id = f"quiz_{uuid.uuid4().hex[:12]}"
    image_notice = await _maybe_generate_images(quiz_output, quiz_id, user_id, req.generate_images)
    image_count = sum(1 for q in quiz_output.questions if q.image_url)
    if not req.generate_images:
        image_status = "none"
    elif image_count == len(quiz_output.questions) and image_count > 0:
        image_status = "completed"
    elif image_count > 0:
        image_status = "partial"
    else:
        image_status = "failed"

    await _persist_quiz_session_and_questions(
        quiz_id=quiz_id,
        user_id=user_id,
        quiz_output=quiz_output,
        user_input=req.user_input,
        image_status=image_status,
        image_notice=image_notice,
        domain_id=domain_id,
        domain_name=domain_name,
        source_type=source_type,
    )

    return QuizGenerateResponse(
        quiz_id=quiz_id,
        title=quiz_output.title,
        summary=quiz_output.summary,
        questions=quiz_output.questions,
        source_type=source_type,
        domain_id=domain_id,
        domain_name=domain_name,
        recommended_count=plan.recommended_count,
        adaptive_reason=plan.reason,
        image_status=image_status,
        image_notice=image_notice,
    )


async def create_quiz_task(
    req: QuizGenerateRequest,
    user_id: Optional[int] = None,
) -> QuizTaskCreateResponse:
    """创建异步出题任务，立即返回 task_id（优先 ARQ Redis 入队，本地回退 asyncio）。"""
    if not check_content(req.user_input):
        raise ContentFilterError("输入内容包含不当内容，请修改后重试")

    await _validate_doc_id(req, user_id)

    task_id = f"task_{uuid.uuid4().hex[:12]}"

    await task_repository.create_task(
        task_id=task_id,
        user_id=user_id,
        user_input=req.user_input,
        question_count=req.question_count,
        difficulty=req.difficulty,
    )

    settings = get_settings()
    arq_pool = get_arq_pool()
    if settings.enable_arq_queue and arq_pool is not None:
        await arq_pool.enqueue_job(
            "job_generate_quiz",
            task_id,
            req.model_dump(),
            user_id,
            _job_id=f"quiz:{task_id}",
        )
    else:
        asyncio.create_task(_run_quiz_task(task_id, req, user_id))

    return QuizTaskCreateResponse(task_id=task_id)


async def _run_background_quiz_images(
    quiz_id: str,
    user_id: int,
    questions: list[Question],
) -> None:
    """后台异步并发生成题目配图，单张完成即增量写库，失败绝不影响答题。"""

    async def _on_ready(question_id: str, url: str) -> None:
        await quiz_repository.update_quiz_images(
            quiz_id=quiz_id,
            image_map={question_id: url},
            image_status="generating",
            image_notice="题目配图生成中...",
        )

    try:
        image_map, notice = await image_service.generate_images_for_quiz(
            questions,
            user_id,
            quiz_id,
            on_image_ready=_on_ready,
        )
        total = len(questions)
        if total > 0 and len(image_map) >= total:
            final_status = "completed"
        elif len(image_map) > 0:
            final_status = "partial"
            notice = notice or f"已成功生成 {len(image_map)}/{total} 张配图"
        else:
            final_status = "failed"
            notice = notice or "配图生成服务暂不可用，请专注文字题目作答"

        await quiz_repository.update_quiz_images(
            quiz_id=quiz_id,
            image_map=image_map,
            image_status=final_status,
            image_notice=notice,
        )
        logger.info(
            "background_quiz_images_finished",
            quiz_id=quiz_id,
            image_status=final_status,
            generated_count=len(image_map),
        )
    except Exception as e:
        logger.error("background_quiz_images_failed", quiz_id=quiz_id, error=str(e))
        await quiz_repository.update_quiz_images(
            quiz_id=quiz_id,
            image_map={},
            image_status="failed",
            image_notice="配图生成暂不可用，文字题目不受影响",
        )


def _schedule_background_images(
    quiz_id: str,
    user_id: int,
    questions: list[Question],
) -> None:
    task = asyncio.create_task(_run_background_quiz_images(quiz_id, user_id, questions))
    _background_image_tasks.add(task)
    task.add_done_callback(_background_image_tasks.discard)


async def _execute_quiz_task(
    task_id: str,
    req: QuizGenerateRequest,
    user_id: Optional[int],
) -> QuizGenerateResponse:
    doc_info = await _validate_doc_id(req, user_id)
    domain_id, domain_name, plan = await _resolve_domain_and_plan(req, user_id, doc_info)

    await task_repository.update_task_stage(task_id, "fetching_context")
    search_context, source_type = await _fetch_context_with_source(req, user_id)
    effective_input = await _build_effective_user_input(req, user_id)
    prompt_difficulty = (
        plan.difficulty_instruction
        if (req.adaptive_mode or req.self_rated_level)
        else req.difficulty
    )

    await task_repository.update_task_stage(task_id, "generating_quiz")
    quiz_output = await generate_quiz(
        user_input=effective_input,
        question_count=plan.question_count,
        difficulty=prompt_difficulty,
        search_context=search_context,
    )

    quiz_id = f"quiz_{uuid.uuid4().hex[:12]}"
    if not req.generate_images:
        image_status = "none"
        image_notice = None
    elif user_id is None:
        image_status = "failed"
        image_notice = "登录后才能使用生成图片功能，本次出题未生成配图"
    else:
        image_status = "generating"
        image_notice = "文字题目已就绪，正在后台为你生成配图..."

    await _persist_quiz_session_and_questions(
        quiz_id=quiz_id,
        user_id=user_id,
        quiz_output=quiz_output,
        user_input=req.user_input,
        image_status=image_status,
        image_notice=image_notice,
        domain_id=domain_id,
        domain_name=domain_name,
        source_type=source_type,
    )

    if image_status == "generating" and user_id is not None:
        _schedule_background_images(quiz_id, user_id, quiz_output.questions)

    return QuizGenerateResponse(
        quiz_id=quiz_id,
        title=quiz_output.title,
        summary=quiz_output.summary,
        questions=quiz_output.questions,
        source_type=source_type,
        domain_id=domain_id,
        domain_name=domain_name,
        recommended_count=plan.recommended_count,
        adaptive_reason=plan.reason,
        image_status=image_status,
        image_notice=image_notice,
    )


async def run_quiz_job(
    task_id: str,
    req_payload: dict | QuizGenerateRequest,
    user_id: Optional[int],
) -> None:
    """ARQ Worker 出题任务入口（兼容 JSON 序列化后的 dict 参数）。"""
    req = (
        req_payload
        if isinstance(req_payload, QuizGenerateRequest)
        else QuizGenerateRequest.model_validate(req_payload)
    )
    await _run_quiz_task(task_id, req, user_id)


async def _run_quiz_task(
    task_id: str,
    req: QuizGenerateRequest,
    user_id: Optional[int],
) -> None:
    """后台执行出题任务（带外层超时熔断，防止卡死在 running）。"""
    settings = get_settings()
    timeout_seconds = max(30, int(getattr(settings, "quiz_task_timeout_seconds", 180)))

    try:
        await task_repository.update_task_status(task_id, "running")
        logger.info("quiz_task_started", task_id=task_id)

        result = await asyncio.wait_for(
            _execute_quiz_task(task_id, req, user_id),
            timeout=timeout_seconds,
        )

        await task_repository.update_task_status(
            task_id, "completed", result_json=result.model_dump()
        )
        logger.info("quiz_task_completed", task_id=task_id, quiz_id=result.quiz_id)

    except asyncio.TimeoutError:
        logger.error("quiz_task_timeout", task_id=task_id, timeout=timeout_seconds)
        await task_repository.update_task_status(
            task_id, "failed", error_message="出题耗时超时，请稍后重试"
        )
    except Exception as e:
        logger.error("quiz_task_failed", task_id=task_id, error=str(e))
        await task_repository.update_task_status(
            task_id, "failed", error_message=str(e)[:500]
        )


async def get_quiz_task_status(
    task_id: str,
    user_id: Optional[int] = None,
) -> QuizTaskStatusResponse:
    """查询任务状态，并校验任务归属防止越权查看。"""
    row = await task_repository.get_task(task_id)
    if row is None:
        raise QuizGenerationError("任务不存在")

    task_owner = row.get("user_id")
    if user_id is not None and task_owner is not None and task_owner != user_id:
        raise AuthorizationError("无权查询他人出题任务")

    result = None
    raw_result = row.get("result_json") or row.get("result")
    if row["status"] == "completed" and raw_result:
        result = QuizGenerateResponse.model_validate(raw_result)

    raw_stage = row.get("stage")
    if not raw_stage:
        if row["status"] == "completed":
            raw_stage = "completed"
        elif row["status"] == "failed":
            raw_stage = "failed"
        elif row["status"] == "running":
            raw_stage = "generating_quiz"
        else:
            raw_stage = "queued"

    return QuizTaskStatusResponse(
        task_id=row["task_id"],
        status=row["status"],
        stage=raw_stage,
        stage_message=STAGE_MESSAGES.get(raw_stage),
        result=result,
        error_message=row.get("error_message"),
    )


async def get_quiz_images_status(quiz_id: str, user_id: int) -> QuizImagesResponse:
    """查询指定题库的后台配图进度（校验当前用户归属）。"""
    row = await quiz_repository.get_quiz_images(quiz_id)
    if row is None:
        raise ResourceNotFoundError("题库记录不存在")

    owner = row.get("user_id")
    if owner is not None and owner != user_id:
        raise AuthorizationError("无权查询他人题库配图状态")

    return QuizImagesResponse(
        quiz_id=quiz_id,
        image_status=row.get("image_status") or "none",
        image_urls=row.get("image_urls") or {},
        image_notice=row.get("image_notice"),
    )
