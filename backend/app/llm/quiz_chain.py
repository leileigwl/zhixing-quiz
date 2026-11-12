"""出题 Chain（含流式 TTFT / 吞吐耗时可观测与假死熔断）"""

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any, Optional

import structlog
from langchain_core.prompts import ChatPromptTemplate

from app.llm.json_utils import extract_json_object
from app.llm.langchain_factory import get_chat_model
from app.models.quiz import QuizOutput
from app.prompts.quiz_prompt import QUIZ_HUMAN_PROMPT, QUIZ_SYSTEM_PROMPT, SEARCH_CONTEXT_TEMPLATE

logger = structlog.get_logger()


def _build_quiz_prompt_and_inputs(
    user_input: str,
    question_count: int,
    difficulty: str,
    search_context: str,
) -> tuple[ChatPromptTemplate, dict[str, Any]]:
    search_context_section = (
        SEARCH_CONTEXT_TEMPLATE.format(search_context=search_context)
        if search_context
        else ""
    )
    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", QUIZ_SYSTEM_PROMPT),
            ("human", QUIZ_HUMAN_PROMPT),
        ]
    )
    inputs = {
        "user_input": user_input,
        "question_count": question_count,
        "difficulty": difficulty,
        "search_context_section": search_context_section,
    }
    return prompt, inputs


async def generate_quiz(
    user_input: str,
    question_count: int = 5,
    difficulty: str = "mixed",
    search_context: str = "",
) -> QuizOutput:
    llm = get_chat_model(temperature=0.4)
    prompt, inputs = _build_quiz_prompt_and_inputs(
        user_input=user_input,
        question_count=question_count,
        difficulty=difficulty,
        search_context=search_context,
    )
    chain = prompt | llm
    result = await chain.ainvoke(inputs)

    content = result.content
    logger.debug(
        "llm_quiz_raw_response",
        content_length=len(content) if content else 0,
        content_preview=content[:200] if content else "<empty>",
    )

    if not content:
        raise ValueError("LLM 返回内容为空")

    data = extract_json_object(content)
    return QuizOutput.model_validate(data)


async def generate_quiz_with_telemetry(
    user_input: str,
    question_count: int = 5,
    difficulty: str = "mixed",
    search_context: str = "",
    ttft_timeout_seconds: float = 30.0,
    chunk_idle_timeout_seconds: float = 25.0,
    total_timeout_seconds: float = 155.0,
    on_question_progress: Optional[Callable[[int], Awaitable[None]]] = None,
) -> tuple[QuizOutput, dict[str, Any]]:
    """通过流式输出精确采集 TTFT（首字延迟）、总生成耗时与增量题目进度。

    仅在「首字卡死超过 ttft_timeout」或「生成途中停流超过 chunk_idle_timeout」时触发快速熔断重试，
    不会在模型稳定吐字中途因固定短超时误杀。
    """
    llm = get_chat_model(temperature=0.4)
    prompt, inputs = _build_quiz_prompt_and_inputs(
        user_input=user_input,
        question_count=question_count,
        difficulty=difficulty,
        search_context=search_context,
    )
    chain = prompt | llm

    t_start = time.perf_counter()
    first_token_at: Optional[float] = None
    chunks: list[str] = []
    last_reported_q = 0
    completion_tokens: Optional[int] = None
    model_name = getattr(llm, "model_name", None) or getattr(llm, "model", None)

    stream = chain.astream(inputs)
    try:
        while True:
            elapsed = time.perf_counter() - t_start
            if elapsed >= total_timeout_seconds:
                raise TimeoutError(f"llm_total_timeout_{int(total_timeout_seconds)}s")

            step_timeout = (
                min(max(1.0, ttft_timeout_seconds - elapsed), total_timeout_seconds - elapsed)
                if first_token_at is None
                else min(chunk_idle_timeout_seconds, max(1.0, total_timeout_seconds - elapsed))
            )
            try:
                chunk = await asyncio.wait_for(stream.__anext__(), timeout=step_timeout)
            except StopAsyncIteration:
                break
            except asyncio.TimeoutError as exc:
                if first_token_at is None:
                    raise TimeoutError(f"llm_ttft_stall_{int(ttft_timeout_seconds)}s") from exc
                raise TimeoutError(f"llm_chunk_stall_{int(chunk_idle_timeout_seconds)}s") from exc

            usage_meta = getattr(chunk, "usage_metadata", None)
            if isinstance(usage_meta, dict) and usage_meta.get("output_tokens"):
                completion_tokens = int(usage_meta["output_tokens"])
            resp_meta = getattr(chunk, "response_metadata", None)
            if isinstance(resp_meta, dict):
                token_usage = resp_meta.get("token_usage") or resp_meta.get("usage")
                if isinstance(token_usage, dict) and token_usage.get("completion_tokens"):
                    completion_tokens = int(token_usage["completion_tokens"])

            piece = getattr(chunk, "content", "") or ""
            if isinstance(piece, list):
                piece = "".join(str(x.get("text", "") if isinstance(x, dict) else x) for x in piece)
            if piece:
                if first_token_at is None:
                    first_token_at = time.perf_counter()
                chunks.append(piece)
                if on_question_progress is not None:
                    joined = "".join(chunks)
                    seen_stems = joined.count('"stem"')
                    if seen_stems > last_reported_q:
                        last_reported_q = seen_stems
                        await on_question_progress(seen_stems)
    finally:
        aclose = getattr(stream, "aclose", None)
        if callable(aclose):
            try:
                await aclose()
            except Exception:
                pass

    content = "".join(chunks)
    total_ms = int((time.perf_counter() - t_start) * 1000)
    ttft_ms = int(((first_token_at or time.perf_counter()) - t_start) * 1000)
    logger.debug(
        "llm_quiz_raw_response",
        content_length=len(content),
        content_preview=content[:200] if content else "<empty>",
    )
    if not content:
        raise ValueError("LLM 返回内容为空")

    data = extract_json_object(content)
    quiz_output = QuizOutput.model_validate(data)
    gen_seconds = max(0.1, (total_ms - ttft_ms) / 1000.0)
    tps = round(completion_tokens / gen_seconds, 1) if completion_tokens else None
    telemetry = {
        "model": str(model_name) if model_name else None,
        "llm_ttft_ms": ttft_ms,
        "llm_total_ms": total_ms,
        "output_chars": len(content),
        "completion_tokens": completion_tokens,
        "tps": tps,
    }
    return quiz_output, telemetry
