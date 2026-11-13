"""生产加固与安全边界测试"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.auth import create_token, get_current_user
from app.core.config import Settings, resolve_embedding_config, resolve_llm_config
from app.core.exceptions import AuthenticationError
from app.llm.json_utils import extract_json_object
from app.main import app
from app.models.quiz import Question, QuestionOption, QuizOutput
from app.services import cos_service


class TestProductionSecurityGuard:
    def test_production_rejects_default_jwt_secret(self):
        settings = Settings(app_env="production", jwt_secret="change-me-in-production")
        with pytest.raises(RuntimeError, match="JWT_SECRET"):
            settings.validate_runtime_security()

    def test_production_rejects_short_jwt_secret(self):
        settings = Settings(app_env="production", jwt_secret="too-short-secret")
        with pytest.raises(RuntimeError, match="JWT_SECRET"):
            settings.validate_runtime_security()

    def test_production_accepts_strong_jwt_secret(self):
        settings = Settings(
            app_env="production",
            jwt_secret="x9P4mQ2vR8nK5wL7zJ3bN6cM1yH0tF4dA",
        )
        settings.validate_runtime_security()

    def test_multi_provider_llm_and_embedding_resolution(self):
        settings = Settings(
            llm_api_key="sk-siliconflow",
            llm_base_url="https://api.siliconflow.cn/v1",
            llm_model="deepseek-ai/DeepSeek-V3",
            embedding_api_key="sk-embed",
            embedding_base_url="https://api.siliconflow.cn/v1",
            embedding_model="BAAI/bge-m3",
        )
        assert resolve_llm_config(settings) == (
            "sk-siliconflow",
            "https://api.siliconflow.cn/v1",
            "deepseek-ai/DeepSeek-V3",
        )
        assert resolve_embedding_config(settings) == (
            "sk-embed",
            "https://api.siliconflow.cn/v1",
            "BAAI/bge-m3",
        )


class TestExtractJsonObject:
    def test_parses_plain_and_fenced_json(self):
        assert extract_json_object('{"a": 1}') == {"a": 1}
        assert extract_json_object('```json\n{"a": 2}\n```') == {"a": 2}

    def test_strips_reasoning_think_tags_and_prose(self):
        raw = '<think>let me analyze\n{"bad": true}</think>\nHere is result:\n{"questions": [1, 2]}\nDone.'
        assert extract_json_object(raw) == {"questions": [1, 2]}


class TestJsonObjectModeDetection:
    def test_skips_json_mode_for_reasoning_models(self):
        from app.llm.langchain_factory import _supports_json_object_mode

        assert _supports_json_object_mode("deepseek-chat", True) is True
        assert _supports_json_object_mode("deepseek-reasoner", True) is False
        assert _supports_json_object_mode("deepseek-ai/DeepSeek-R1", True) is False
        assert _supports_json_object_mode("Qwen/QwQ-32B", True) is False
        assert _supports_json_object_mode("gpt-4o", False) is False


@pytest.mark.asyncio
class TestDevLoginGate:
    async def test_dev_login_succeeds_in_development(self):
        dev_settings = Settings(app_env="development", allow_dev_login=True)
        mock_user = {
            "id": 9,
            "openid": "dev_demo",
            "nickname": "知行体验官",
            "avatar_url": "",
            "total_xp": 0,
        }
        with patch("app.services.user_service.get_settings", return_value=dev_settings), patch(
            "app.services.user_service.user_repository.find_user_by_openid",
            new_callable=AsyncMock,
            return_value=mock_user,
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.post(
                    "/api/v1/user/dev-login",
                    json={"dev_id": "demo", "nickname": "知行体验官"},
                )
        assert resp.status_code == 200
        body = resp.json()
        assert body["code"] == 0
        assert body["data"]["token"]
        assert body["data"]["user"]["id"] == 9

    async def test_dev_login_forbidden_in_production(self):
        prod_settings = Settings(
            app_env="production",
            allow_dev_login=True,
            jwt_secret="x9P4mQ2vR8nK5wL7zJ3bN6cM1yH0tF4dA",
        )
        with patch("app.services.user_service.get_settings", return_value=prod_settings):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.post(
                    "/api/v1/user/dev-login",
                    json={"dev_id": "demo", "nickname": "知行体验官"},
                )
        assert resp.status_code == 403
        assert resp.json()["code"] == 4003


@pytest.mark.asyncio
class TestAuthorizationAndRateLimit:
    async def test_task_status_rejects_other_user(self):
        token_user_2 = create_token(user_id=2, openid="user_2")
        with patch(
            "app.services.quiz_service.task_repository.get_task",
            new_callable=AsyncMock,
            return_value={
                "task_id": "task_secret",
                "user_id": 1,
                "status": "completed",
                "result_json": None,
                "error_message": None,
            },
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.get(
                    "/api/v1/quiz/task/task_secret",
                    headers={"Authorization": f"Bearer {token_user_2}"},
                )
        assert resp.status_code == 403
        assert resp.json()["code"] == 4003

    async def test_rate_limit_blocks_excess_requests_per_user(self):
        token_1 = create_token(user_id=11, openid="u11")
        token_2 = create_token(user_id=12, openid="u12")
        mock_output = QuizOutput(
            title="Test",
            summary="Summary",
            questions=[
                Question(
                    id="q1",
                    type="single",
                    stem="1+1=?",
                    options=[
                        QuestionOption(key="A", text="2"),
                        QuestionOption(key="B", text="3"),
                    ],
                    answer=["A"],
                    explanation="1+1=2",
                    knowledge_point="基础",
                    difficulty="easy",
                )
            ],
        )
        limited_settings = Settings(quiz_rate_limit_per_minute=2)

        with patch("app.api.v1.routes.quiz.get_settings", return_value=limited_settings), patch(
            "app.services.quiz_service.generate_quiz",
            new_callable=AsyncMock,
            return_value=mock_output,
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                for _ in range(2):
                    ok_resp = await client.post(
                        "/api/v1/quiz/generate",
                        json={"user_input": "数学", "question_count": 3, "difficulty": "easy"},
                        headers={"Authorization": f"Bearer {token_1}"},
                    )
                    assert ok_resp.status_code == 200

                blocked_resp = await client.post(
                    "/api/v1/quiz/generate",
                    json={"user_input": "数学", "question_count": 3, "difficulty": "easy"},
                    headers={"Authorization": f"Bearer {token_1}"},
                )
                assert blocked_resp.status_code == 429
                assert blocked_resp.json()["code"] == 4290

                # 不同用户互不干扰
                other_resp = await client.post(
                    "/api/v1/quiz/generate",
                    json={"user_input": "数学", "question_count": 3, "difficulty": "easy"},
                    headers={"Authorization": f"Bearer {token_2}"},
                )
                assert other_resp.status_code == 200

    async def test_get_current_user_rejects_deleted_user_when_db_online(self):
        token = create_token(user_id=888, openid="deleted_user")
        request = MagicMock()
        request.headers = {"Authorization": f"Bearer {token}"}

        with patch("app.core.auth.get_mysql_pool", return_value=MagicMock()), patch(
            "app.core.auth.user_repository.get_user_by_id",
            new_callable=AsyncMock,
            return_value=None,
        ):
            with pytest.raises(AuthenticationError, match="失效"):
                await get_current_user(request)


@pytest.mark.asyncio
class TestLocalStaticImageFallback:
    async def test_saves_to_local_static_dir_when_cos_unconfigured(self, tmp_path):
        settings = Settings(
            cos_secret_id="",
            cos_secret_key="",
            cos_bucket="",
            cos_region="",
            allow_local_image_fallback=True,
            local_image_dir=str(tmp_path),
            public_base_url="https://api.example.com/",
        )
        with patch("app.services.cos_service.get_settings", return_value=settings):
            url = await cos_service.upload_image_bytes(
                b"fake-png-bytes", "quiz-images/quiz_99/q1.png"
            )

        assert url == "https://api.example.com/static/quiz-images/quiz_99/q1.png"
        assert (tmp_path / "quiz_99" / "q1.png").read_bytes() == b"fake-png-bytes"
