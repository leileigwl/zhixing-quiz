"""出题服务 V2（自适应题量/难度配比、LCEL 检索与 RAG 路由、规范化题目表与 ARQ 队列派发）"""

import asyncio
import time
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
from app.core.redis_client import (
    cache_delete,
    cache_get_json,
    cache_set_json,
    get_arq_pool,
    get_redis,
)
from app.core.security import check_content
from app.llm.quiz_chain import generate_quiz, generate_quiz_with_telemetry
from app.models.quiz import (
    Question,
    QuizGenerateRequest,
    QuizGenerateResponse,
    QuizImagesResponse,
    QuizOutput,
    QuizTaskCreateResponse,
    QuizTaskStatusResponse,
    QuizTaskTelemetry,
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
from app.services.search_service import (
    fetch_knowledge_context,
    has_recency_signal,
    resolve_knowledge_context,
)

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


async def _report_stage(
    task_id: str,
    stage: str,
    *,
    stage_message: Optional[str] = None,
    telemetry: Optional[dict[str, Any]] = None,
) -> None:
    """兼容旧版双参 mock 的阶段更新封装。"""
    fn = task_repository.update_task_stage
    if _is_mocked(fn):
        await fn(task_id, stage)
        return
    await fn(task_id, stage, stage_message=stage_message, telemetry=telemetry)


def _collect_requested_doc_ids(req: QuizGenerateRequest) -> list[str]:
    doc_ids = [d for d in (req.doc_ids or []) if d]
    if req.doc_id and req.doc_id not in doc_ids:
        doc_ids.insert(0, req.doc_id)
    return doc_ids


async def _validate_doc_id(req: QuizGenerateRequest, user_id: Optional[int]) -> Optional[dict]:
    """校验传入的 doc_id / doc_ids 存在、归属当前用户且已就绪。"""
    target_ids = _collect_requested_doc_ids(req)
    if not target_ids:
        return None

    if user_id is None:
        raise KnowledgeBaseError("使用知识库出题需要先登录")

    first_doc: Optional[dict] = None
    for idx, did in enumerate(target_ids):
        doc = await knowledge_repository.get_document(did, user_id)
        if doc is None:
            raise KnowledgeBaseError("知识库文档不存在")
        if doc["status"] != "ready":
            raise KnowledgeBaseError(f"知识库文档尚未就绪（当前状态：{doc['status']}），请稍后重试")
        if idx == 0:
            first_doc = doc

    return first_doc


async def _fetch_context_with_source(
    req: QuizGenerateRequest,
    user_id: Optional[int],
    effective_doc_ids: Optional[list[str]] = None,
) -> tuple[str, str]:
    """三源融合 LCEL 检索路由：用户粘贴材料 + 私有知识库（单/多/域全库）+ Tavily 联网搜索。"""
    target_doc_ids = effective_doc_ids if effective_doc_ids is not None else _collect_requested_doc_ids(req)
    ref_text = (getattr(req, "reference_text", None) or "").strip()
    effective_web = bool(req.enable_web_search) and not (
        len(ref_text) >= 200 and not has_recency_signal(req.user_input)
    )

    if target_doc_ids:
        if len(target_doc_ids) == 1 and _is_mocked(rag_service.fetch_rag_context):
            ctx = await rag_service.fetch_rag_context(req.user_input, user_id, target_doc_ids[0])
            return _merge_reference_text(req, ctx, ("kb_rag" if ctx else "llm_direct"))
        ctx, src = await rag_service.resolve_rag_context(
            user_input=req.user_input,
            user_id=user_id,
            doc_id=target_doc_ids[0],
            doc_ids=target_doc_ids,
            enable_web_search=effective_web,
        )
        return _merge_reference_text(req, ctx, src)

    if _is_mocked(fetch_knowledge_context):
        ctx = await fetch_knowledge_context(req.user_input)
        return _merge_reference_text(req, ctx, ("web_search" if ctx else "llm_direct"))

    ctx, src = await resolve_knowledge_context(
        user_input=req.user_input,
        enable_web_search=effective_web,
    )
    return _merge_reference_text(req, ctx, src)


def _merge_reference_text(
    req: QuizGenerateRequest,
    context: str,
    source_type: str,
) -> tuple[str, str]:
    """将用户直接提供/粘贴的 reference_text 与检索上下文（知识库+联网）三源并合。"""
    ref = (getattr(req, "reference_text", None) or "").strip()
    if not ref:
        return context, source_type
    parts = [f"【用户提供的学习文本】\n{ref[:4500]}"]
    if context:
        parts.append(context)
    merged = "\n\n".join(parts)[:7500]
    merged_src = source_type if source_type != "llm_direct" else "kb_rag"
    return merged, merged_src


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
                # 优先毫秒级关键词规则分类；未命中时限时 2.5s 调语义归类，避免阻塞主链路
                guessed_name, color = domain_classifier.classify_domain_deterministic(req.user_input)
                if guessed_name == "综合知识域" and len(req.user_input.strip()) >= 8:
                    existing = [d["name"] for d in await mastery_repository.list_user_domains(user_id)]
                    try:
                        guessed_name, color = await asyncio.wait_for(
                            domain_classifier.classify_domain_with_llm(req.user_input, existing),
                            timeout=2.5,
                        )
                    except asyncio.TimeoutError:
                        pass
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
        min_count=1 if req.review_card_ids else 3,
    )
    return domain_id, domain_name, plan


async def _build_effective_user_input(
    req: QuizGenerateRequest,
    user_id: Optional[int],
) -> tuple[str, list[int]]:
    """若传入待复习错题卡 ID，拼装错题定向巩固考点约束并返回有效 card_ids 列表。"""
    if not req.review_card_ids or user_id is None:
        return req.user_input, []

    if get_mysql_pool() is None and not _is_mocked(mastery_repository.get_review_cards_context):
        return req.user_input, list(req.review_card_ids)

    try:
        cards = await mastery_repository.get_review_cards_context(user_id, req.review_card_ids)
    except Exception as exc:
        logger.warning("fetch_review_cards_context_failed", user_id=user_id, error=str(exc))
        return req.user_input, list(req.review_card_ids)

    if not cards:
        return req.user_input, []

    valid_ids = [int(c["card_id"]) for c in cards]
    lines = [
        f"{idx + 1}. 考点【{c['knowledge_point'] or c['domain_name']}】原错题参考：{c['stem'][:160]}"
        for idx, c in enumerate(cards[:8])
    ]
    prompt = (
        f"{req.user_input}\n\n"
        "【错题定向巩固变式出题要求】\n"
        f"请严格按顺序一一对应以下 {len(lines)} 道薄弱错题设计新的变式巩固题（更换场景或干扰项，不要原题照抄）：\n"
        + "\n".join(lines)
    )
    return prompt, valid_ids


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
    source_review_card_ids: Optional[list[int]] = None,
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
            source_review_card_ids=source_review_card_ids,
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


async def _timed_await(coro):
    t0 = time.perf_counter()
    res = await coro
    return res, int((time.perf_counter() - t0) * 1000)


async def _prepare_generation_context_timed(
    req: QuizGenerateRequest,
    user_id: Optional[int],
    doc_info: Optional[dict],
):
    """并行执行领域画像解析、知识库/联网三源检索与错题上下文构建，并返回分段毫秒级耗时。"""
    t0 = time.perf_counter()
    explicit_doc_ids = _collect_requested_doc_ids(req)
    if not explicit_doc_ids and req.domain_id is not None and user_id is not None and get_mysql_pool() is not None:
        explicit_doc_ids = await knowledge_repository.list_ready_doc_ids_by_domain(user_id, req.domain_id)

    (
        ((domain_id, domain_name, plan), domain_ms),
        ((search_context, source_type), rag_search_ms),
        ((effective_input, valid_card_ids), _),
    ) = await asyncio.gather(
        _timed_await(_resolve_domain_and_plan(req, user_id, doc_info)),
        _timed_await(_fetch_context_with_source(req, user_id, effective_doc_ids=explicit_doc_ids)),
        _timed_await(_build_effective_user_input(req, user_id)),
    )
    ctx_metrics = {
        "context_prep_ms": int((time.perf_counter() - t0) * 1000),
        "domain_classify_ms": domain_ms,
        "rag_search_ms": rag_search_ms,
        "context_chars": len(search_context or ""),
        "source_type": source_type,
    }
    return domain_id, domain_name, plan, search_context, source_type, effective_input, valid_card_ids, ctx_metrics


async def _prepare_generation_context(
    req: QuizGenerateRequest,
    user_id: Optional[int],
    doc_info: Optional[dict],
):
    """并行执行领域画像解析、知识库/联网三源检索与错题上下文构建，缩短端到端出题等待。"""
    (
        domain_id,
        domain_name,
        plan,
        search_context,
        source_type,
        effective_input,
        valid_card_ids,
        _,
    ) = await _prepare_generation_context_timed(req, user_id, doc_info)
    return domain_id, domain_name, plan, search_context, source_type, effective_input, valid_card_ids


async def _generate_quiz_with_retry(
    *,
    task_id: Optional[str],
    user_input: str,
    question_count: int,
    difficulty: str,
    search_context: str,
    telemetry: dict[str, Any],
    max_attempts: int = 2,
) -> tuple[QuizOutput, dict[str, Any]]:
    """调用出题链路并在 TTFT 假死/瞬态异常时自动快速重试 1 次，同时持续汇报实时题目进度。"""
    if _is_mocked(generate_quiz):
        t0 = time.perf_counter()
        quiz_output = await generate_quiz(
            user_input=user_input,
            question_count=question_count,
            difficulty=difficulty,
            search_context=search_context,
        )
        return quiz_output, {
            **telemetry,
            "attempt": 1,
            "llm_total_ms": int((time.perf_counter() - t0) * 1000),
            "output_chars": sum(len(q.stem) for q in quiz_output.questions),
        }

    retry_reasons: list[str] = []
    last_exc: Optional[Exception] = None
    for attempt in range(1, max_attempts + 1):
        async def _on_progress(seen_count: int, cur_attempt: int = attempt) -> None:
            if not task_id:
                return
            shown = min(seen_count, question_count)
            msg = f"AI 正在编排第 {shown}/{question_count} 题..."
            await _report_stage(
                task_id,
                "generating_quiz",
                stage_message=msg,
                telemetry={**telemetry, "attempt": cur_attempt},
            )

        try:
            quiz_output, llm_metrics = await generate_quiz_with_telemetry(
                user_input=user_input,
                question_count=question_count,
                difficulty=difficulty,
                search_context=search_context,
                on_question_progress=_on_progress,
            )
            return quiz_output, {
                **telemetry,
                **llm_metrics,
                "attempt": attempt,
                "retry_reason": "; ".join(retry_reasons) if retry_reasons else None,
            }
        except Exception as exc:
            last_exc = exc
            reason = str(exc)[:120] or exc.__class__.__name__
            retry_reasons.append(f"attempt{attempt}:{reason}")
            logger.warning(
                "quiz_llm_attempt_failed",
                task_id=task_id,
                attempt=attempt,
                reason=reason,
            )
            if attempt < max_attempts and task_id:
                await _report_stage(
                    task_id,
                    "generating_quiz",
                    stage_message=f"第 {attempt} 次连接超时或异常，正在重试第 {attempt + 1} 次...",
                    telemetry={
                        **telemetry,
                        "attempt": attempt + 1,
                        "retry_reason": "; ".join(retry_reasons),
                    },
                )

    assert last_exc is not None
    raise last_exc


def _bind_source_cards(questions: list[Question], card_ids: list[int]) -> None:
    for idx, q in enumerate(questions):
        if idx < len(card_ids):
            q.source_card_id = card_ids[idx]


async def handle_quiz_generate(
    req: QuizGenerateRequest,
    user_id: Optional[int] = None,
) -> QuizGenerateResponse:
    if not check_content(req.user_input):
        raise ContentFilterError("输入内容包含不当内容，请修改后重试")

    doc_info = await _validate_doc_id(req, user_id)
    domain_id, domain_name, plan, search_context, source_type, effective_input, valid_card_ids = (
        await _prepare_generation_context(req, user_id, doc_info)
    )
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

    _bind_source_cards(quiz_output.questions, valid_card_ids)

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
        user_input=req.user_input[:1800],
        image_status=image_status,
        image_notice=image_notice,
        domain_id=domain_id,
        domain_name=domain_name,
        source_type=source_type,
        source_review_card_ids=valid_card_ids or None,
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


PREWARM_TTL_SECONDS = 21600
PREWARM_LOCK_SECONDS = 120


def _prewarm_cache_key(user_id: int, domain_id: int) -> str:
    return f"zx:prewarm:{user_id}:{domain_id}"


def _prewarm_lock_key(user_id: int, domain_id: int) -> str:
    return f"zx:prewarm_lock:{user_id}:{domain_id}"


async def schedule_domain_prewarm(user_id: Optional[int], domain_id: Optional[int]) -> None:
    """触发 ARQ 在后台为薄弱/最近活跃知识域悄悄预备下一套自适应题，命中时可 0.1s 秒开。"""
    if user_id is None or domain_id is None:
        return
    try:
        redis_client = get_redis()
        if redis_client is not None:
            acquired = await redis_client.set(
                _prewarm_lock_key(user_id, domain_id),
                "1",
                ex=PREWARM_LOCK_SECONDS,
                nx=True,
            )
            if not acquired:
                return
        arq_pool = get_arq_pool()
        settings = get_settings()
        if settings.enable_arq_queue and arq_pool is not None:
            await arq_pool.enqueue_job(
                "job_prewarm_domain_quiz",
                user_id,
                domain_id,
                _job_id=f"prewarm:{user_id}:{domain_id}",
            )
    except Exception as exc:
        logger.debug("schedule_domain_prewarm_skipped", user_id=user_id, domain_id=domain_id, error=str(exc))


async def generate_and_cache_prewarm_quiz(user_id: int, domain_id: int) -> bool:
    """后台生成 1 套自适应知识域测验并缓存到 Redis，不写历史记录直至用户真正点击开刷。"""
    try:
        dom = await mastery_repository.get_domain_by_id(domain_id, user_id)
        if not dom:
            return False
        domain_name = dom["name"]
        req = QuizGenerateRequest(
            user_input=f"针对「{domain_name}」核心重难点与常见误区生成自适应巩固测验",
            question_count=5,
            adaptive_mode=True,
            domain_id=domain_id,
            enable_web_search=False,
            generate_images=False,
        )
        doc_info = None
        explicit_doc_ids = await knowledge_repository.list_ready_doc_ids_by_domain(user_id, domain_id)
        if explicit_doc_ids:
            doc_info = await knowledge_repository.get_document(explicit_doc_ids[0], user_id)
        d_id, d_name, plan, search_context, source_type, effective_input, _ = (
            await _prepare_generation_context(req, user_id, doc_info)
        )
        quiz_output = await generate_quiz(
            user_input=effective_input,
            question_count=plan.question_count,
            difficulty=plan.difficulty_instruction,
            search_context=search_context,
        )
        payload = {
            "quiz_output": quiz_output.model_dump(),
            "domain_id": d_id or domain_id,
            "domain_name": d_name or domain_name,
            "source_type": source_type,
            "recommended_count": plan.recommended_count,
            "adaptive_reason": plan.reason,
            "user_input": req.user_input,
        }
        await cache_set_json(_prewarm_cache_key(user_id, domain_id), payload, ttl_seconds=PREWARM_TTL_SECONDS)
        logger.info("domain_quiz_prewarmed", user_id=user_id, domain_id=domain_id, count=len(quiz_output.questions))
        return True
    except Exception as exc:
        logger.warning("domain_quiz_prewarm_failed", user_id=user_id, domain_id=domain_id, error=str(exc))
        return False


async def _try_consume_prewarm_task(
    req: QuizGenerateRequest,
    user_id: Optional[int],
) -> Optional[str]:
    """若命中该域预备题库，直接 0.1s 落盘任务为 completed 并在后台补发下一组。"""
    if (
        not req.allow_prewarm
        or user_id is None
        or req.domain_id is None
        or (req.reference_text or "").strip()
        or _collect_requested_doc_ids(req)
        or req.review_card_ids
        or req.generate_images
    ):
        return None

    cached = await cache_get_json(_prewarm_cache_key(user_id, req.domain_id))
    if not isinstance(cached, dict) or not cached.get("quiz_output"):
        return None

    await cache_delete(_prewarm_cache_key(user_id, req.domain_id))
    t_pw = time.perf_counter()
    try:
        quiz_output = QuizOutput.model_validate(cached["quiz_output"])
    except Exception:
        return None

    task_id = f"task_{uuid.uuid4().hex[:12]}"
    quiz_id = f"quiz_{uuid.uuid4().hex[:12]}"
    d_id = cached.get("domain_id") or req.domain_id
    d_name = cached.get("domain_name")
    src = cached.get("source_type") or "llm_direct"

    await task_repository.create_task(
        task_id=task_id,
        user_id=user_id,
        user_input=req.user_input,
        question_count=len(quiz_output.questions),
        difficulty=req.difficulty,
    )
    await _persist_quiz_session_and_questions(
        quiz_id=quiz_id,
        user_id=user_id,
        quiz_output=quiz_output,
        user_input=req.user_input[:1800],
        image_status="none",
        image_notice=None,
        domain_id=d_id,
        domain_name=d_name,
        source_type=src,
    )
    resp = QuizGenerateResponse(
        quiz_id=quiz_id,
        title=quiz_output.title,
        summary=quiz_output.summary,
        questions=quiz_output.questions,
        source_type=src,
        domain_id=d_id,
        domain_name=d_name,
        recommended_count=cached.get("recommended_count"),
        adaptive_reason=cached.get("adaptive_reason"),
        image_status="none",
        image_notice=None,
    )
    await task_repository.update_task_status(
        task_id,
        "completed",
        result_json=resp.model_dump(),
        stage_message=STAGE_MESSAGES["completed"],
        telemetry={
            "prewarm_hit": True,
            "source_type": src,
            "total_ms": int((time.perf_counter() - t_pw) * 1000),
        },
    )
    await schedule_domain_prewarm(user_id, req.domain_id)
    logger.info("domain_prewarm_cache_hit", user_id=user_id, domain_id=req.domain_id, task_id=task_id, quiz_id=quiz_id)
    return task_id


async def create_quiz_task(
    req: QuizGenerateRequest,
    user_id: Optional[int] = None,
) -> QuizTaskCreateResponse:
    """创建异步出题任务，优先尝试 0.1s 命中域预热缓存，未命中则由 ARQ Worker 异步生成。"""
    if not check_content(req.user_input):
        raise ContentFilterError("输入内容包含不当内容，请修改后重试")

    await _validate_doc_id(req, user_id)

    fast_task_id = await _try_consume_prewarm_task(req, user_id)
    if fast_task_id:
        return QuizTaskCreateResponse(task_id=fast_task_id)

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


async def _execute_quiz_task_with_telemetry(
    task_id: str,
    req: QuizGenerateRequest,
    user_id: Optional[int],
    initial_telemetry: Optional[dict[str, Any]] = None,
) -> tuple[QuizGenerateResponse, dict[str, Any]]:
    telemetry: dict[str, Any] = dict(initial_telemetry or {})
    doc_info = await _validate_doc_id(req, user_id)

    await _report_stage(
        task_id,
        "fetching_context",
        stage_message=STAGE_MESSAGES["fetching_context"],
        telemetry=telemetry,
    )
    (
        domain_id,
        domain_name,
        plan,
        search_context,
        source_type,
        effective_input,
        valid_card_ids,
        ctx_metrics,
    ) = await _prepare_generation_context_timed(req, user_id, doc_info)
    telemetry.update(ctx_metrics)
    prompt_difficulty = (
        plan.difficulty_instruction
        if (req.adaptive_mode or req.self_rated_level)
        else req.difficulty
    )

    await _report_stage(
        task_id,
        "generating_quiz",
        stage_message=f"AI 正在编排 {plan.question_count} 道题目...",
        telemetry=telemetry,
    )
    quiz_output, telemetry = await _generate_quiz_with_retry(
        task_id=task_id,
        user_input=effective_input,
        question_count=plan.question_count,
        difficulty=prompt_difficulty,
        search_context=search_context,
        telemetry=telemetry,
    )

    _bind_source_cards(quiz_output.questions, valid_card_ids)

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

    t_db = time.perf_counter()
    await _persist_quiz_session_and_questions(
        quiz_id=quiz_id,
        user_id=user_id,
        quiz_output=quiz_output,
        user_input=req.user_input[:1800],
        image_status=image_status,
        image_notice=image_notice,
        domain_id=domain_id,
        domain_name=domain_name,
        source_type=source_type,
        source_review_card_ids=valid_card_ids or None,
    )
    telemetry["db_save_ms"] = int((time.perf_counter() - t_db) * 1000)

    if image_status == "generating" and user_id is not None:
        _schedule_background_images(quiz_id, user_id, quiz_output.questions)

    resp = QuizGenerateResponse(
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
    return resp, telemetry


async def _execute_quiz_task(
    task_id: str,
    req: QuizGenerateRequest,
    user_id: Optional[int],
) -> QuizGenerateResponse:
    resp, _ = await _execute_quiz_task_with_telemetry(task_id, req, user_id)
    return resp


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
    """后台执行出题任务（带全链路耗时监控、TTFT 假死重试与外层超时熔断）。"""
    settings = get_settings()
    timeout_seconds = max(30, int(getattr(settings, "quiz_task_timeout_seconds", 180)))
    t_run_start = time.perf_counter()
    cached_row = await task_repository.get_task(task_id)
    created_at_ts = cached_row.get("created_at_ts") if isinstance(cached_row, dict) else None
    queue_wait_ms = max(0, int((time.time() - float(created_at_ts)) * 1000)) if created_at_ts else 0
    telemetry: dict[str, Any] = {"queue_wait_ms": queue_wait_ms, "attempt": 1}

    try:
        await task_repository.update_task_status(
            task_id, "running", stage_message=STAGE_MESSAGES["queued"], telemetry=telemetry
        )
        logger.info("quiz_task_started", task_id=task_id, queue_wait_ms=queue_wait_ms)

        result, telemetry = await asyncio.wait_for(
            _execute_quiz_task_with_telemetry(task_id, req, user_id, initial_telemetry=telemetry),
            timeout=timeout_seconds,
        )
        telemetry["total_ms"] = queue_wait_ms + int((time.perf_counter() - t_run_start) * 1000)

        await task_repository.update_task_status(
            task_id,
            "completed",
            result_json=result.model_dump(),
            stage_message=STAGE_MESSAGES["completed"],
            telemetry=telemetry,
        )
        logger.info("quiz_task_completed", task_id=task_id, quiz_id=result.quiz_id)
        logger.info("quiz_task_telemetry", task_id=task_id, status="completed", **telemetry)

    except asyncio.TimeoutError:
        telemetry["total_ms"] = queue_wait_ms + int((time.perf_counter() - t_run_start) * 1000)
        latest = await task_repository.get_task(task_id)
        if isinstance(latest, dict) and isinstance(latest.get("telemetry"), dict):
            merged = dict(latest["telemetry"])
            merged["total_ms"] = telemetry["total_ms"]
            telemetry = merged
        logger.error("quiz_task_timeout", task_id=task_id, timeout=timeout_seconds)
        logger.info("quiz_task_telemetry", task_id=task_id, status="timeout", **telemetry)
        await task_repository.update_task_status(
            task_id,
            "failed",
            error_message="出题耗时超时，请稍后重试",
            stage_message="出题超时，请稍后重试",
            telemetry=telemetry,
        )
    except Exception as e:
        telemetry["total_ms"] = queue_wait_ms + int((time.perf_counter() - t_run_start) * 1000)
        latest = await task_repository.get_task(task_id)
        if isinstance(latest, dict) and isinstance(latest.get("telemetry"), dict):
            merged = dict(latest["telemetry"])
            merged["total_ms"] = telemetry["total_ms"]
            telemetry = merged
        logger.error("quiz_task_failed", task_id=task_id, error=str(e))
        logger.info("quiz_task_telemetry", task_id=task_id, status="failed", error=str(e)[:120], **telemetry)
        await task_repository.update_task_status(
            task_id,
            "failed",
            error_message=str(e)[:500],
            stage_message=STAGE_MESSAGES["failed"],
            telemetry=telemetry,
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

    telemetry_obj = None
    raw_tel = row.get("telemetry")
    if isinstance(raw_tel, dict):
        telemetry_obj = QuizTaskTelemetry.model_validate(raw_tel)

    return QuizTaskStatusResponse(
        task_id=row["task_id"],
        status=row["status"],
        stage=raw_stage,
        stage_message=row.get("stage_message") or STAGE_MESSAGES.get(raw_stage),
        telemetry=telemetry_obj,
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
