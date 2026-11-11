"""出题 Chain"""

import structlog
from langchain_core.prompts import ChatPromptTemplate

from app.llm.json_utils import extract_json_object
from app.llm.langchain_factory import get_chat_model
from app.models.quiz import QuizOutput
from app.prompts.quiz_prompt import QUIZ_HUMAN_PROMPT, QUIZ_SYSTEM_PROMPT, SEARCH_CONTEXT_TEMPLATE

logger = structlog.get_logger()


async def generate_quiz(
    user_input: str,
    question_count: int = 5,
    difficulty: str = "mixed",
    search_context: str = "",
) -> QuizOutput:
    llm = get_chat_model(temperature=0.4)

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

    chain = prompt | llm

    result = await chain.ainvoke(
        {
            "user_input": user_input,
            "question_count": question_count,
            "difficulty": difficulty,
            "search_context_section": search_context_section,
        }
    )

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
