"""秒返服务端权威判分、XP 幂等结算与异步 AI 复盘报告测试"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.auth import create_token
from app.main import app
from app.models.quiz import Question, QuestionOption
from app.models.report import ReportOutput, SubmittedAnswerItem
from app.repositories import quiz_repository
from app.services.scoring_service import calculate_xp_gain, grade_submitted_answers


@pytest.fixture
def sample_questions():
    return [
        Question(
            id="q1",
            type="single",
            stem="Q1",
            options=[
                QuestionOption(key="A", text="A1"),
                QuestionOption(key="B", text="B1"),
            ],
            answer=["A"],
            explanation="E1",
            knowledge_point="KP1",
            difficulty="easy",
        ),
        Question(
            id="q2",
            type="multiple",
            stem="Q2",
            options=[
                QuestionOption(key="A", text="A2"),
                QuestionOption(key="B", text="B2"),
                QuestionOption(key="C", text="C2"),
            ],
            answer=["A", "C"],
            explanation="E2",
            knowledge_point="KP2",
            difficulty="medium",
        ),
    ]


def test_grade_submitted_answers_ignores_client_is_correct_and_deduplicates(sample_questions):
    forged = [
        SubmittedAnswerItem(question_id="q1", selected_answers=["B"], is_correct=True, duration_ms=100),
        SubmittedAnswerItem(question_id="q2", selected_answers=["C", "A"], is_correct=False, duration_ms=200),
        # 恶意重复刷同一题 id 企图垫高 correct_count
        SubmittedAnswerItem(question_id="q2", selected_answers=["A", "C"], is_correct=True, duration_ms=50),
    ]
    graded, summary = grade_submitted_answers(sample_questions, forged)
    assert len(graded) == 2
    assert graded[0].is_correct is False
    assert graded[1].is_correct is True
    assert summary["correct"] == 1
    assert summary["accuracy"] == 50
    assert calculate_xp_gain(summary["correct"]) == 12


@pytest.mark.asyncio
async def test_persist_submission_with_xp_idempotent_transaction():
    cursor = AsyncMock()
    conn = MagicMock()
    conn.begin = AsyncMock()
    conn.commit = AsyncMock()
    conn.rollback = AsyncMock()
    conn.cursor.return_value.__aenter__ = AsyncMock(return_value=cursor)
    conn.cursor.return_value.__aexit__ = AsyncMock(return_value=False)

    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)

    # 首次插入成功：rowcount=1，应执行 UPDATE users SET total_xp
    cursor.rowcount = 1
    with patch("app.repositories.quiz_repository.get_mysql_pool", return_value=pool):
        first = await quiz_repository.persist_submission_with_xp("q_1", 7, [], 2, 1, 50, 12)
    assert first is True
    assert any("UPDATE users SET total_xp" in c.args[0] for c in cursor.execute.await_args_list)
    conn.commit.assert_awaited_once()

    # 重复插入：INSERT IGNORE 命中唯一键 rowcount=0，不得加经验
    cursor.execute.reset_mock()
    conn.commit.reset_mock()
    cursor.rowcount = 0
    with patch("app.repositories.quiz_repository.get_mysql_pool", return_value=pool):
        second = await quiz_repository.persist_submission_with_xp("q_1", 7, [], 2, 1, 50, 12)
    assert second is False
    assert not any("UPDATE users SET total_xp" in c.args[0] for c in cursor.execute.await_args_list)
    conn.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_report_submit_returns_immediately_and_blocks_duplicate_xp(sample_questions):
    token = create_token(user_id=1, openid="u1")
    llm_started = asyncio.Event()
    llm_release = asyncio.Event()

    async def slow_report(**kwargs):
        llm_started.set()
        await llm_release.wait()
        return ReportOutput(
            accuracy=50,
            mastered_points=["KP2"],
            weak_points=["KP1"],
            three_line_summary=["1", "2", "3"],
            advice=["A1"],
            share_quote="坚持就是胜利",
        )

    session_data = {
        "quiz_id": "quiz_async_1",
        "user_id": 1,
        "title": "测试测验",
        "summary": "摘要",
        "questions": [q.model_dump() for q in sample_questions],
    }

    with patch(
        "app.services.report_service.quiz_repository.get_quiz_session_for_user",
        new_callable=AsyncMock,
        return_value=session_data,
    ), patch(
        "app.services.report_service.quiz_repository.get_answer_record_by_quiz",
        new_callable=AsyncMock,
        side_effect=[
            None,
            {
                "records": [],
                "total_questions": 2,
                "correct_count": 1,
                "accuracy": 50,
            },
        ],
    ), patch(
        "app.services.report_service.quiz_repository.get_report_record",
        new_callable=AsyncMock,
        return_value={"user_id": 1, "report": None, "status": "generating", "error_message": None},
    ), patch(
        "app.services.report_service.quiz_repository.persist_submission_with_xp",
        new_callable=AsyncMock,
        return_value=True,
    ) as mock_persist, patch(
        "app.services.report_service.quiz_repository.save_report",
        new_callable=AsyncMock,
    ) as mock_save_rp, patch(
        "app.services.report_service.generate_report",
        side_effect=slow_report,
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            payload = {
                "quiz_id": "quiz_async_1",
                "answer_records": [
                    {"question_id": "q1", "selected_answers": ["B"], "is_correct": True, "duration_ms": 100},
                    {"question_id": "q2", "selected_answers": ["A", "C"], "duration_ms": 200},
                ],
            }
            resp1 = await client.post("/api/v1/report/submit", json=payload, headers={"Authorization": f"Bearer {token}"})
            assert resp1.status_code == 200
            d1 = resp1.json()["data"]
            assert d1["accuracy"] == 50
            assert d1["correct_count"] == 1
            assert d1["xp_awarded"] is True
            assert d1["xp_gain"] == 12
            assert d1["report_status"] == "generating"

            # 重复提交应幂等返回且不再奖励 XP
            resp2 = await client.post("/api/v1/report/submit", json=payload, headers={"Authorization": f"Bearer {token}"})
            assert resp2.status_code == 200
            d2 = resp2.json()["data"]
            assert d2["already_submitted"] is True
            assert d2["xp_awarded"] is False
            assert d2["xp_gain"] == 0

            await asyncio.wait_for(llm_started.wait(), timeout=1.0)
            llm_release.set()
            await asyncio.sleep(0.05)

    mock_persist.assert_awaited_once()
    assert mock_save_rp.await_args_list[-1].kwargs["status"] == "completed"


@pytest.mark.asyncio
async def test_report_status_and_submit_ownership_protection():
    token_other = create_token(user_id=2, openid="u2")
    with patch(
        "app.services.report_service.quiz_repository.get_quiz_session_for_user",
        new_callable=AsyncMock,
        return_value={"quiz_id": "quiz_1", "user_id": 1, "title": "T", "summary": "S", "questions": []},
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            r1 = await client.post(
                "/api/v1/report/submit",
                json={"quiz_id": "quiz_1", "answer_records": []},
                headers={"Authorization": f"Bearer {token_other}"},
            )
            r2 = await client.get(
                "/api/v1/report/quiz_1",
                headers={"Authorization": f"Bearer {token_other}"},
            )
    assert r1.status_code == 403
    assert r2.status_code == 403


@pytest.mark.asyncio
async def test_report_submit_missing_quiz_returns_404():
    token = create_token(user_id=1, openid="u1")
    with patch(
        "app.services.report_service.quiz_repository.get_quiz_session_for_user",
        new_callable=AsyncMock,
        return_value=None,
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/v1/report/submit",
                json={"quiz_id": "quiz_missing", "answer_records": []},
                headers={"Authorization": f"Bearer {token}"},
            )
    assert resp.status_code == 404
    assert resp.json()["code"] == 4004
