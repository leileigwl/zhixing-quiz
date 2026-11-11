"""出题服务"""

import asyncio
import uuid
from typing import Optional

import structlog

from app.core.config import get_settings
from app.core.exceptions import (
    AuthorizationError,
    ContentFilterError,
    KnowledgeBaseError,
    QuizGenerationError,
    ResourceNotFoundError,
)
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
from app.repositories import knowledge_repository, quiz_repository, task_repository
from app.services import image_service, rag_service
from app.services.search_service import fetch_knowledge_context

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


async def _validate_doc_id(req: QuizGenerateRequest, user_id: Optional[int]) -> None:
    """若请求指定了 doc_id，校验用户已登录且文档存在、归属正确且已就绪。"""
    if req.doc_id is None:
        return

    if user_id is None:
        raise KnowledgeBaseError("使用知识库出题需要先登录")

    doc = await knowledge_repository.get_document(req.doc_id, user_id)
    if doc is None:
        raise KnowledgeBaseError("知识库文档不存在")

    if doc["status"] != "ready":
        raise KnowledgeBaseError(f"知识库文档尚未就绪（当前状态：{doc['status']}），请稍后重试")


async def _fetch_context(req: QuizGenerateRequest, user_id: Optional[int]) -> str:
    """根据是否指定 doc_id 选择知识库 RAG 或联网搜索获取参考资料。"""
    if req.doc_id is not None:
        return await rag_service.fetch_rag_context(req.user_input, user_id, req.doc_id)
    return await fetch_knowledge_context(req.user_input)


async def handle_quiz_generate(
    req: QuizGenerateRequest,
    user_id: Optional[int] = None,
) -> QuizGenerateResponse:
    if not check_content(req.user_input):
        raise ContentFilterError("输入内容包含不当内容，请修改后重试")

    await _validate_doc_id(req, user_id)
    search_context = await _fetch_context(req, user_id)

    try:
        quiz_output = await generate_quiz(
            user_input=req.user_input,
            question_count=req.question_count,
            difficulty=req.difficulty,
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

    if user_id is not None:
        try:
            await quiz_repository.save_quiz_session(
                quiz_id=quiz_id,
                user_id=user_id,
                title=quiz_output.title,
                summary=quiz_output.summary,
                user_input=req.user_input,
                questions_json=[q.model_dump() for q in quiz_output.questions],
                image_status=image_status,
                image_notice=image_notice,
            )
        except Exception as e:
            logger.error("quiz_session_save_failed", error=str(e))

    return QuizGenerateResponse(
        quiz_id=quiz_id,
        title=quiz_output.title,
        summary=quiz_output.summary,
        questions=quiz_output.questions,
        image_status=image_status,
        image_notice=image_notice,
    )


async def create_quiz_task(
    req: QuizGenerateRequest,
    user_id: Optional[int] = None,
) -> QuizTaskCreateResponse:
    """创建异步出题任务，立即返回 task_id。"""
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
    await task_repository.update_task_stage(task_id, "fetching_context")
    search_context = await _fetch_context(req, user_id)

    await task_repository.update_task_stage(task_id, "generating_quiz")
    quiz_output = await generate_quiz(
        user_input=req.user_input,
        question_count=req.question_count,
        difficulty=req.difficulty,
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

    if user_id is not None:
        try:
            await quiz_repository.save_quiz_session(
                quiz_id=quiz_id,
                user_id=user_id,
                title=quiz_output.title,
                summary=quiz_output.summary,
                user_input=req.user_input,
                questions_json=[q.model_dump() for q in quiz_output.questions],
                image_status=image_status,
                image_notice=image_notice,
            )
        except Exception as e:
            logger.error("quiz_session_save_failed", task_id=task_id, error=str(e))

    if image_status == "generating" and user_id is not None:
        _schedule_background_images(quiz_id, user_id, quiz_output.questions)

    return QuizGenerateResponse(
        quiz_id=quiz_id,
        title=quiz_output.title,
        summary=quiz_output.summary,
        questions=quiz_output.questions,
        image_status=image_status,
        image_notice=image_notice,
    )


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
    if row["status"] == "completed" and row.get("result_json"):
        result = QuizGenerateResponse.model_validate(row["result_json"])

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
