"""异步出题阶段进度与渐进式后台补图测试"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.auth import create_token
from app.main import app
from app.models.quiz import Question, QuestionOption, QuizGenerateRequest, QuizOutput
from app.repositories import quiz_repository
from app.services import quiz_service


@pytest.fixture
def sample_output():
    return QuizOutput(
        title="异步出题测试",
        summary="验证文字先出、配图后补",
        questions=[
            Question(
                id="q1",
                type="single",
                stem="示例题1",
                options=[
                    QuestionOption(key="A", text="选项A"),
                    QuestionOption(key="B", text="选项B"),
                ],
                answer=["A"],
                explanation="解析1",
                knowledge_point="知识点1",
                difficulty="easy",
            ),
            Question(
                id="q2",
                type="judge",
                stem="示例题2",
                options=[
                    QuestionOption(key="A", text="正确"),
                    QuestionOption(key="B", text="错误"),
                ],
                answer=["B"],
                explanation="解析2",
                knowledge_point="知识点2",
                difficulty="easy",
            ),
        ],
    )


@pytest.mark.asyncio
async def test_execute_quiz_task_returns_before_images_and_tracks_stages(sample_output):
    stage_calls = []

    async def fake_stage(task_id: str, stage: str):
        stage_calls.append(stage)

    image_started = asyncio.Event()
    image_release = asyncio.Event()

    async def slow_images(questions, user_id, quiz_id, on_image_ready=None):
        image_started.set()
        await image_release.wait()
        return {"q1": "https://cdn.example.com/q1.png", "q2": "https://cdn.example.com/q2.png"}, None

    with patch(
        "app.services.quiz_service.task_repository.update_task_stage",
        side_effect=fake_stage,
    ), patch(
        "app.services.quiz_service.fetch_knowledge_context",
        new_callable=AsyncMock,
        return_value="",
    ), patch(
        "app.services.quiz_service.generate_quiz",
        new_callable=AsyncMock,
        return_value=sample_output,
    ), patch(
        "app.services.quiz_service.quiz_repository.save_quiz_session",
        new_callable=AsyncMock,
    ) as mock_save_session, patch(
        "app.services.quiz_service.quiz_repository.update_quiz_images",
        new_callable=AsyncMock,
    ) as mock_update_images, patch(
        "app.services.quiz_service.image_service.generate_images_for_quiz",
        side_effect=slow_images,
    ):
        req = QuizGenerateRequest(user_input="测试异步补图", question_count=3, generate_images=True)
        res = await quiz_service._execute_quiz_task("task_abc", req, user_id=7)

        assert stage_calls == ["fetching_context", "generating_quiz"]
        assert res.image_status == "generating"
        assert len(res.questions) == 2
        mock_save_session.assert_awaited_once()
        assert mock_save_session.call_args.kwargs["image_status"] == "generating"

        await asyncio.wait_for(image_started.wait(), timeout=1.0)
        image_release.set()
        await asyncio.sleep(0.05)

        mock_update_images.assert_awaited()
        final_kwargs = mock_update_images.await_args_list[-1].kwargs
        assert final_kwargs["image_status"] == "completed"
        assert len(final_kwargs["image_map"]) == 2


@pytest.mark.asyncio
async def test_background_images_partial_and_failed_degrade_gracefully(sample_output):
    with patch(
        "app.services.quiz_service.image_service.generate_images_for_quiz",
        new_callable=AsyncMock,
        return_value=({"q1": "https://cdn.example.com/q1.png"}, None),
    ), patch(
        "app.services.quiz_service.quiz_repository.update_quiz_images",
        new_callable=AsyncMock,
    ) as mock_update:
        await quiz_service._run_background_quiz_images("quiz_1", 7, sample_output.questions)
        assert mock_update.await_args.kwargs["image_status"] == "partial"

    with patch(
        "app.services.quiz_service.image_service.generate_images_for_quiz",
        new_callable=AsyncMock,
        side_effect=RuntimeError("dashscope down"),
    ), patch(
        "app.services.quiz_service.quiz_repository.update_quiz_images",
        new_callable=AsyncMock,
    ) as mock_update:
        await quiz_service._run_background_quiz_images("quiz_2", 7, sample_output.questions)
        assert mock_update.await_args.kwargs["image_status"] == "failed"


@pytest.mark.asyncio
async def test_quiz_images_endpoint_checks_ownership():
    token_owner = create_token(user_id=1, openid="u1")
    token_other = create_token(user_id=2, openid="u2")

    with patch(
        "app.services.quiz_service.quiz_repository.get_quiz_images",
        new_callable=AsyncMock,
        return_value={
            "quiz_id": "quiz_owned",
            "user_id": 1,
            "image_status": "partial",
            "image_notice": "部分完成",
            "image_urls": {"q1": "http://localhost:8000/static/quiz-images/q1.png"},
        },
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            ok_resp = await client.get(
                "/api/v1/quiz/quiz_owned/images",
                headers={"Authorization": f"Bearer {token_owner}"},
            )
            deny_resp = await client.get(
                "/api/v1/quiz/quiz_owned/images",
                headers={"Authorization": f"Bearer {token_other}"},
            )

    assert ok_resp.status_code == 200
    assert ok_resp.json()["data"]["image_status"] == "partial"
    assert ok_resp.json()["data"]["image_urls"]["q1"].endswith("q1.png")
    assert deny_resp.status_code == 403
    assert deny_resp.json()["code"] == 4003


@pytest.mark.asyncio
async def test_task_status_returns_stage_and_message():
    token = create_token(user_id=1, openid="u1")
    with patch(
        "app.services.quiz_service.task_repository.get_task",
        new_callable=AsyncMock,
        return_value={
            "task_id": "task_123",
            "user_id": 1,
            "status": "running",
            "stage": "fetching_context",
            "result_json": None,
            "error_message": None,
        },
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(
                "/api/v1/quiz/task/task_123",
                headers={"Authorization": f"Bearer {token}"},
            )

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["stage"] == "fetching_context"
    assert "检索" in data["stage_message"]


@pytest.mark.asyncio
async def test_update_quiz_images_merges_urls_cleanly():
    cursor = AsyncMock()
    cursor.fetchone = AsyncMock(
        return_value=(
            '[{"id": "q1", "stem": "S1", "image_url": null}, {"id": "q2", "stem": "S2"}]',
        )
    )

    conn = MagicMock()
    conn.cursor.return_value.__aenter__ = AsyncMock(return_value=cursor)
    conn.cursor.return_value.__aexit__ = AsyncMock(return_value=False)

    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)

    with patch("app.repositories.quiz_repository.get_mysql_pool", return_value=pool):
        await quiz_repository.update_quiz_images(
            "quiz_99",
            {"q1": "https://img/q1.png"},
            "completed",
            None,
        )

    update_call = cursor.execute.await_args_list[-1]
    assert "UPDATE quiz_sessions SET questions_json = %s" in update_call.args[0]
    params = update_call.args[1]
    assert "https://img/q1.png" in params[0]
    assert params[1] == "completed"
