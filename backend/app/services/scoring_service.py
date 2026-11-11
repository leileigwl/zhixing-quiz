"""计分服务（含服务端权威判分与 XP 计算）"""

from app.models.quiz import AnswerRecord, Question
from app.models.report import SubmittedAnswerItem


def calculate_xp_gain(correct_count: int) -> int:
    """计算单次完成测验应获经验值：完成保底 +10，每答对 1 题 +2。"""
    return 10 + max(0, correct_count) * 2


def compute_score_summary(answer_records: list[AnswerRecord]) -> dict:
    total = len(answer_records)
    correct = sum(1 for r in answer_records if r.is_correct)
    accuracy = round(correct / total * 100) if total > 0 else 0
    avg_duration = (
        round(sum(r.duration_ms for r in answer_records) / total) if total > 0 else 0
    )

    return {
        "total": total,
        "correct": correct,
        "wrong": total - correct,
        "accuracy": accuracy,
        "avg_duration_ms": avg_duration,
    }


def grade_submitted_answers(
    questions: list[Question],
    submitted: list[SubmittedAnswerItem],
) -> tuple[list[AnswerRecord], dict]:
    """根据服务端标准答案重算每题对错（按 question_id 去重防刷分）。"""
    question_map = {q.id: q for q in questions}
    seen_ids: set[str] = set()
    graded: list[AnswerRecord] = []

    for item in submitted:
        if item.question_id in seen_ids:
            continue
        seen_ids.add(item.question_id)

        q = question_map.get(item.question_id)
        if q is None:
            is_correct = False
        else:
            expected = sorted({ans.strip() for ans in q.answer})
            actual = sorted({ans.strip() for ans in item.selected_answers})
            is_correct = bool(expected) and expected == actual

        graded.append(
            AnswerRecord(
                question_id=item.question_id,
                selected_answers=list(item.selected_answers),
                is_correct=is_correct,
                duration_ms=item.duration_ms,
                mark_review=bool(getattr(item, "mark_review", False)),
            )
        )

    return graded, compute_score_summary(graded)
