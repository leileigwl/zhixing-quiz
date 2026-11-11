"""报告 Chain"""

import json

from langchain_core.prompts import ChatPromptTemplate

from app.llm.json_utils import extract_json_object
from app.llm.langchain_factory import get_chat_model
from app.models.quiz import AnswerRecord, Question
from app.models.report import ReportOutput
from app.prompts.report_prompt import REPORT_HUMAN_PROMPT, REPORT_SYSTEM_PROMPT


async def generate_report(
    topic: str,
    questions: list[Question],
    answer_records: list[AnswerRecord],
    score_summary: dict,
) -> ReportOutput:
    llm = get_chat_model(temperature=0.5)

    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", REPORT_SYSTEM_PROMPT),
            ("human", REPORT_HUMAN_PROMPT),
        ]
    )

    chain = prompt | llm

    result = await chain.ainvoke(
        {
            "topic": topic,
            "quiz_json": json.dumps(
                [q.model_dump() for q in questions], ensure_ascii=False
            ),
            "answer_records": json.dumps(
                [r.model_dump() for r in answer_records], ensure_ascii=False
            ),
            "score_summary": json.dumps(score_summary, ensure_ascii=False),
        }
    )

    content = result.content
    if not content:
        raise ValueError("LLM 返回报告内容为空")

    data = extract_json_object(content)
    return ReportOutput.model_validate(data)
