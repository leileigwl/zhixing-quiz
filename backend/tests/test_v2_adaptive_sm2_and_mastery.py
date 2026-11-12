"""V2 核心能力单测：倒U自适应、SM-2、WeChat 订阅推送、Redis 限流与 mastery/reviews API"""

from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.auth import create_token
from app.core.exceptions import RateLimitError
from app.core.rate_limit import check_rate_limit_async
from app.main import app
from app.models.quiz import AnswerRecord, Question, QuestionOption
from app.services import adaptive_service, domain_classifier, report_service, review_service


def _sample_question(qid: str = "q1", diff: str = "medium") -> Question:
    return Question(
        id=qid,
        type="single",
        stem=f"测试题干 {qid}",
        options=[
            QuestionOption(key="A", text="选项A"),
            QuestionOption(key="B", text="选项B"),
        ],
        answer=["A"],
        explanation="解析",
        knowledge_point="考点A",
        difficulty=diff,
    )


class TestAdaptiveEngine:
    def test_cold_start_inverted_u_counts(self):
        unfamiliar = adaptive_service.compute_adaptive_plan(
            requested_count=5,
            adaptive_mode=True,
            self_rated_level="unfamiliar",
        )
        familiar = adaptive_service.compute_adaptive_plan(
            requested_count=5,
            adaptive_mode=True,
            self_rated_level="familiar",
        )
        mastered = adaptive_service.compute_adaptive_plan(
            requested_count=5,
            adaptive_mode=True,
            self_rated_level="mastered",
        )
        assert unfamiliar.question_count == 4
        assert familiar.question_count == 6
        assert mastered.question_count == 3

    def test_history_profile_drives_inverted_u(self):
        low = adaptive_service.compute_adaptive_plan(
            requested_count=5,
            adaptive_mode=True,
            mastery_profile={"easy_total": 3, "medium_total": 1, "hard_total": 0, "mastery_score": 32.0},
        )
        mid = adaptive_service.compute_adaptive_plan(
            requested_count=5,
            adaptive_mode=True,
            mastery_profile={"easy_total": 2, "medium_total": 3, "hard_total": 1, "mastery_score": 66.0},
        )
        high = adaptive_service.compute_adaptive_plan(
            requested_count=5,
            adaptive_mode=True,
            mastery_profile={"easy_total": 2, "medium_total": 4, "hard_total": 4, "mastery_score": 88.0},
        )
        assert low.question_count == 4
        assert mid.question_count == 6
        assert high.question_count == 3

    def test_retention_curve_clamped_bounds(self):
        r0 = adaptive_service.compute_retention_rate(0.0, 5.0)
        r_far = adaptive_service.compute_retention_rate(100.0, 5.0)
        assert r0 == 100.0
        assert r_far == 18.0

    def test_dual_track_retention_curve_varies_by_accuracy(self):
        from app.models.quiz import QuizGenerateRequest
        from app.services import mastery_service

        c_high = mastery_service.build_retention_curve(
            12.0, 92.0, mastery_score=90.0, session_accuracy=100.0, days_elapsed=1.0
        )
        c_low = mastery_service.build_retention_curve(
            2.2, 48.0, mastery_score=38.0, session_accuracy=25.0, days_elapsed=1.0
        )
        assert len(c_high) == 6 and len(c_low) == 6
        assert all(p.baseline_pct is not None for p in c_high)
        assert c_high[2].retention_pct > c_low[2].retention_pct + 20.0
        assert c_high[4].retention_pct > c_low[4].retention_pct + 20.0

        # review_card_ids 模式下允许 1 题直练，普通模式仍拒绝 2 题
        req_review = QuizGenerateRequest(user_input="复习错题", question_count=1, review_card_ids=[11])
        assert req_review.question_count == 1
        with pytest.raises(ValueError):
            QuizGenerateRequest(user_input="普通出题", question_count=2)


class TestSM2ReviewAndWeChatPush:
    def test_sm2_step_progression_and_graduation(self):
        # 1 -> 3 -> 7 (3 次答对后毕业为 mastered)
        r1 = review_service.compute_sm2_next(0, 2.5, is_correct=True)
        r2 = review_service.compute_sm2_next(1, 2.55, is_correct=True)
        r3 = review_service.compute_sm2_next(2, 2.60, is_correct=True)
        reset = review_service.compute_sm2_next(2, 2.5, is_correct=False)

        assert r1[:2] == (1, 1) and r1[3] == "active"
        assert r2[:2] == (2, 3) and r2[3] == "active"
        assert r3[:2] == (3, 7) and r3[3] == "mastered"
        assert reset[:2] == (0, 1) and reset[3] == "active"

    @pytest.mark.asyncio
    async def test_submission_enqueues_arq_deferred_job_on_wrong_answer(self):
        fake_arq = AsyncMock()
        q1 = _sample_question("q1", "hard")
        rec1 = AnswerRecord(question_id="q1", selected_answers=["B"], is_correct=False, duration_ms=1200)

        with (
            patch("app.services.review_service.mastery_repository.get_review_card_by_uid", AsyncMock(return_value=None)),
            patch("app.services.review_service.mastery_repository.upsert_review_card", AsyncMock(return_value=99)),
            patch("app.services.review_service.get_arq_pool", return_value=fake_arq),
        ):
            created = await review_service.process_submission_reviews(
                user_id=7,
                quiz_id="quiz_abc",
                domain_id=3,
                questions=[q1],
                graded_records=[rec1],
            )
        assert created == 1
        fake_arq.enqueue_job.assert_awaited_once()
        args, kwargs = fake_arq.enqueue_job.call_args
        assert args == ("job_activate_review_reminder", 99)
        assert kwargs["_defer_by"] == timedelta(days=1)
        assert kwargs["_expires"] > kwargs["_defer_by"]

    @pytest.mark.asyncio
    async def test_wechat_subscribe_push_with_mock_http(self):
        settings = MagicMock()
        settings.wechat_subscribe_template_id = "tpl_123"
        settings.wechat_app_id = "wx_appid"
        settings.wechat_app_secret = "wx_secret"

        with (
            patch("app.services.review_service.get_settings", return_value=settings),
            patch("app.services.review_service.mastery_repository.consume_subscribe_quota", AsyncMock(return_value=True)),
            patch("app.services.review_service._fetch_wechat_access_token", AsyncMock(return_value="tok_abc")),
            patch("app.services.review_service.httpx.AsyncClient") as mock_client_cls,
        ):
            mock_client = AsyncMock()
            mock_resp = MagicMock()
            mock_resp.json.return_value = {"errcode": 0, "errmsg": "ok"}
            mock_client.post.return_value = mock_resp
            mock_client_cls.return_value.__aenter__.return_value = mock_client

            ok = await review_service.dispatch_wechat_subscribe_reminder(
                user_id=7,
                openid="wx_real_openid_1",
                domain_name="RAG 架构",
                due_count=2,
            )
            assert ok is True
            mock_client.post.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_wechat_subscribe_skips_when_unconfigured(self):
        settings = MagicMock()
        settings.wechat_subscribe_template_id = ""
        settings.wechat_app_id = ""
        settings.wechat_app_secret = ""
        with patch("app.services.review_service.get_settings", return_value=settings):
            ok = await review_service.dispatch_wechat_subscribe_reminder(7, "wx_1", "RAG 架构", 1)
            assert ok is False


class TestDomainClassifierAndRedisRateLimit:
    def test_keyword_classifier_and_rotation(self):
        name, color = domain_classifier.classify_domain_deterministic("深入学习 Chroma RRF 检索")
        assert name == "RAG 架构"
        assert color == "butter"

    @pytest.mark.asyncio
    async def test_async_rate_limit_blocks_when_redis_over_limit(self):
        fake_redis = MagicMock()
        fake_redis.eval = AsyncMock(side_effect=[1, 0])

        with patch("app.core.rate_limit.get_redis", return_value=fake_redis):
            await check_rate_limit_async("quiz:user:9", max_requests=5, window_seconds=60)
            with pytest.raises(RateLimitError):
                await check_rate_limit_async("quiz:user:9", max_requests=5, window_seconds=60)
        assert fake_redis.eval.await_count == 2

    def test_docx_zip_bomb_and_filename_sanitization(self, tmp_path):
        import zipfile

        from app.services import document_loader_service, knowledge_service

        cleaned = knowledge_service._sanitize_display_filename("../../evil\r\n<script>.md")
        assert cleaned == "evilscript.md"
        assert "/" not in cleaned and "\n" not in cleaned and "<" not in cleaned
        bad_zip = tmp_path / "bomb.docx"
        with zipfile.ZipFile(bad_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("word/document.xml", "A" * 1024)
        with patch.object(document_loader_service, "MAX_DOCX_UNCOMPRESSED_BYTES", 512):
            with pytest.raises(ValueError, match="压缩炸弹|过大"):
                document_loader_service._guard_docx_zip_bomb(str(bad_zip))


@pytest.mark.asyncio
class TestMasteryAndReviewRoutes:
    async def test_mastery_overview_endpoint(self):
        token = create_token(user_id=12, openid="wx_12")
        rows = [
            {
                "domain_id": 1,
                "name": "RAG 架构",
                "color_token": "butter",
                "mastery_score": 74.0,
                "easy_correct": 4,
                "easy_total": 4,
                "medium_correct": 3,
                "medium_total": 4,
                "hard_correct": 1,
                "hard_total": 2,
                "avg_duration_ms": 2100,
                "stability_days": 8.0,
                "retention_rate": 86.0,
                "last_practiced_at": datetime.now() - timedelta(days=1),
                "doc_count": 2,
                "due_review_count": 1,
            }
        ]
        with (
            patch("app.services.mastery_service.cache_get_json", AsyncMock(return_value=None)),
            patch("app.services.mastery_service.cache_set_json", AsyncMock()),
            patch("app.services.mastery_service.user_repository.get_user_by_id", AsyncMock(return_value={"id": 12, "streak_days": 5})),
            patch("app.services.mastery_service.mastery_repository.list_user_mastery_rows", AsyncMock(return_value=rows)),
            patch("app.services.mastery_service.mastery_repository.get_user_daily_counts", AsyncMock(return_value={})),
            patch("app.services.mastery_service.mastery_repository.get_seven_day_forecast", AsyncMock(return_value=[1, 0, 2, 0, 1, 0, 0])),
            patch("app.services.mastery_service.mastery_repository.list_due_review_cards", AsyncMock(return_value=(1, []))),
            patch("app.services.mastery_service.mastery_repository.get_subscribe_quota", AsyncMock(return_value=3)),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.get("/api/v1/mastery/overview", headers={"Authorization": f"Bearer {token}"})

        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["streak_days"] == 5
        assert data["due_review_total"] == 1
        assert len(data["domains"]) == 1
        assert len(data["retention_curve"]) == 6
        assert len(data["weekly_rhythm"]) == 7

    async def test_reviews_due_mark_and_subscribe_endpoints(self):
        token = create_token(user_id=12, openid="wx_12")
        session_row = {
            "quiz_id": "quiz_1",
            "user_id": 12,
            "domain_id": 1,
            "questions": [{"id": "q1"}],
        }
        with (
            patch(
                "app.services.mastery_service.mastery_repository.list_due_review_cards",
                AsyncMock(return_value=(1, [{
                    "card_id": 11,
                    "question_id": "q1",
                    "quiz_id": "quiz_1",
                    "domain_id": 1,
                    "domain_name": "RAG 架构",
                    "stem": "什么 是 RRF？",
                    "knowledge_point": "倒数排序融合",
                    "difficulty": "medium",
                    "interval_days": 1,
                    "next_review_at": "2026-11-12 10:00:00",
                }])),
            ),
            patch("app.api.v1.routes.reviews.quiz_repository.get_quiz_session_for_user", AsyncMock(return_value=session_row)),
            patch("app.api.v1.routes.reviews.mastery_repository.upsert_review_card", AsyncMock(return_value=11)),
            patch("app.api.v1.routes.reviews.mastery_repository.grant_subscribe_quota", AsyncMock(return_value=4)),
            patch("app.api.v1.routes.reviews.mastery_service.invalidate_mastery_cache", AsyncMock()),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                r_due = await client.get("/api/v1/reviews/due", headers={"Authorization": f"Bearer {token}"})
                r_mark = await client.post(
                    "/api/v1/reviews/mark",
                    json={"quiz_id": "quiz_1", "question_id": "q1", "action": "add"},
                    headers={"Authorization": f"Bearer {token}"},
                )
                r_sub = await client.post(
                    "/api/v1/reviews/subscribe",
                    json={"count": 1, "preferred_hour": 21},
                    headers={"Authorization": f"Bearer {token}"},
                )

        assert r_due.status_code == 200
        assert r_due.json()["data"]["total_due"] == 1
        assert r_mark.status_code == 200
        assert r_mark.json()["data"]["status"] == "due"
        assert r_sub.status_code == 200
        assert r_sub.json()["data"]["remaining_count"] == 4

    async def test_duplicate_submit_does_not_double_update_v2_mastery(self):
        from app.models.report import ReportSubmitRequest, SubmittedAnswerItem

        q1 = _sample_question("q1", "hard")
        session_row = {
            "quiz_id": "quiz_dup",
            "user_id": 12,
            "domain_id": 1,
            "domain_name": "RAG 架构",
            "title": "RAG 测试",
            "questions": [q1.model_dump()],
        }
        with (
            patch("app.services.report_service.quiz_repository.get_quiz_session_for_user", AsyncMock(return_value=session_row)),
            patch("app.services.report_service.quiz_repository.get_answer_record_by_quiz", AsyncMock(return_value=None)),
            patch("app.services.report_service.quiz_repository.persist_submission_with_xp", AsyncMock(return_value=False)),
            patch("app.services.report_service.quiz_repository.save_report", AsyncMock()),
            patch("app.services.report_service._dispatch_report_generation", AsyncMock()),
            patch("app.services.report_service._update_v2_learning_state", new_callable=AsyncMock) as mock_v2,
        ):
            res = await report_service.handle_report_submit(
                ReportSubmitRequest(
                    quiz_id="quiz_dup",
                    answer_records=[SubmittedAnswerItem(question_id="q1", selected_answers=["A"], duration_ms=100)],
                ),
                user_id=12,
            )
        assert res.already_submitted is True
        mock_v2.assert_not_awaited()

    async def test_wrong_card_immediately_due_and_source_cards_graduate(self):
        fake_arq = AsyncMock()
        q1 = _sample_question("q1", "medium")
        q1.source_card_id = 501
        rec_wrong = AnswerRecord(question_id="q1", selected_answers=["B"], is_correct=False, duration_ms=1000)

        with (
            patch("app.services.review_service.mastery_repository.get_review_card_by_uid", AsyncMock(return_value=None)),
            patch("app.services.review_service.mastery_repository.upsert_review_card", AsyncMock(return_value=501)) as mock_upsert,
            patch("app.services.review_service.get_arq_pool", return_value=fake_arq),
        ):
            created = await review_service.process_submission_reviews(
                user_id=7,
                quiz_id="quiz_x",
                domain_id=2,
                questions=[q1],
                graded_records=[rec_wrong],
            )
        assert created == 1
        assert mock_upsert.call_args.kwargs["status"] == "due"
        assert mock_upsert.call_args.kwargs["immediately_due"] is True

        # 第 3 次答对变式巩固题时，应直接核销毕业原卡 501 为 mastered
        rec_right = AnswerRecord(question_id="q1", selected_answers=["A"], is_correct=True, duration_ms=900)
        orig_card = {
            "card_id": 501,
            "domain_id": 2,
            "easiness_factor": 2.6,
            "interval_days": 3,
            "repetitions": 2,
            "status": "due",
        }
        with (
            patch("app.services.review_service.mastery_repository.get_review_cards_by_ids", AsyncMock(return_value=[orig_card])),
            patch("app.services.review_service.mastery_repository.update_review_card_progress", AsyncMock(return_value=501)) as mock_prog,
            patch("app.services.review_service.get_arq_pool", return_value=fake_arq),
        ):
            progressed, matched = await review_service.progress_source_review_cards(
                user_id=7,
                questions=[q1],
                graded_records=[rec_right],
                source_card_ids=[501],
            )
        assert progressed == 1
        assert matched == {"q1"}
        assert mock_prog.call_args.kwargs["status"] == "mastered"
        assert mock_prog.call_args.kwargs["repetitions"] == 3

    async def test_instant_review_practice_submit_route(self):
        token = create_token(user_id=12, openid="wx_12")
        orig_cards = [
            {
                "card_id": 11,
                "domain_id": 1,
                "easiness_factor": 2.6,
                "interval_days": 3,
                "repetitions": 2,
                "status": "due",
            }
        ]
        with (
            patch("app.services.review_service.mastery_repository.get_review_cards_by_ids", AsyncMock(return_value=orig_cards)),
            patch("app.services.review_service.mastery_repository.update_review_card_progress", AsyncMock(return_value=11)),
            patch("app.services.review_service.mastery_repository.upsert_mastery_after_submission", AsyncMock(return_value=82.0)),
            patch("app.services.review_service.mastery_repository.update_user_streak_on_submit", AsyncMock(return_value=3)),
            patch("app.services.review_service.mastery_repository.list_due_review_cards", AsyncMock(return_value=(0, []))),
            patch("app.services.review_service.mastery_service.invalidate_mastery_cache", AsyncMock()),
            patch("app.services.review_service.get_arq_pool", return_value=None),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.post(
                    "/api/v1/reviews/practice/submit",
                    json={"items": [{"card_id": 11, "selected_answers": ["A"], "is_correct": True, "duration_ms": 800}]},
                    headers={"Authorization": f"Bearer {token}"},
                )
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["practiced_count"] == 1
        assert data["correct_count"] == 1
        assert data["graduated_count"] == 1
        assert data["remaining_due"] == 0


class TestV22ScheduleAndWeeklyDrilldown:
    def test_domain_curve_varies_with_actual_history_and_schedule(self):
        from app.services import mastery_service

        curve_a = mastery_service.build_retention_curve(
            stability_days=3.0,
            current_retention=54.0,
            mastery_score=52.0,
            history_points=[
                {"day_label": "11/10", "accuracy": 40.0, "title": "HTTP/3"},
                {"day_label": "11/11", "accuracy": 60.0, "title": "QUIC"},
            ],
        )
        curve_b = mastery_service.build_retention_curve(
            stability_days=15.0,
            current_retention=91.0,
            mastery_score=92.0,
            history_points=[
                {"day_label": "11/10", "accuracy": 85.0, "title": "BM25"},
                {"day_label": "11/11", "accuracy": 95.0, "title": "RRF"},
            ],
        )
        actual_a = [p for p in curve_a if p.is_actual]
        actual_b = [p for p in curve_b if p.is_actual]
        assert len(actual_a) == 2 and len(actual_b) == 2
        assert [p.retention_pct for p in curve_a] != [p.retention_pct for p in curve_b]
        assert curve_a[-1].retention_pct < curve_b[-1].retention_pct

        sched = mastery_service.compute_schedule_for_domain(
            domain_id=1,
            domain_name="计算机网络",
            stability_days=3.0,
            retention_rate=58.0,
            mastery_score=52.0,
            recommended_count=4,
            due_review_count=0,
        )
        assert sched.critical_days > 0
        assert "明日" in sched.when_label or "天后" in sched.when_label
        assert "4 题" in sched.reason

    def test_weekly_rhythm_includes_drilldown_sessions(self):
        from datetime import datetime

        from app.services import mastery_service

        today_str = datetime.now().strftime("%Y-%m-%d")
        rhythm = mastery_service.build_weekly_rhythm(
            daily_counts={today_str: 5},
            daily_sessions={
                today_str: [
                    {
                        "quiz_id": "quiz_1",
                        "title": "Transformer 注意力",
                        "domain_name": "大模型与 AI",
                        "question_count": 5,
                        "accuracy": 80.0,
                        "weak_points": ["KV Cache"],
                    }
                ]
            },
        )
        today_item = next(d for d in rhythm if d.is_today)
        assert today_item.date_str == today_str
        assert today_item.quiz_count == 1
        assert today_item.avg_accuracy == 80.0
        assert today_item.sessions[0].title == "Transformer 注意力"


class TestV23PrewarmAndSmartSearch:
    async def test_prewarm_cache_hit_consumes_and_creates_completed_task(self):
        from app.models.quiz import QuizGenerateRequest, QuizOutput
        from app.services import quiz_service

        sample_output = QuizOutput(
            title="预热测验：计算机网络",
            summary="后台预生成巩固题组",
            questions=[_sample_question(f"q{i}", "medium") for i in range(1, 4)],
        )
        cached_payload = {
            "quiz_output": sample_output.model_dump(),
            "domain_id": 2,
            "domain_name": "计算机网络",
            "source_type": "llm_direct",
            "recommended_count": 3,
            "adaptive_reason": "预热加速",
        }
        with (
            patch("app.services.quiz_service.cache_get_json", AsyncMock(return_value=cached_payload)),
            patch("app.services.quiz_service.cache_delete", AsyncMock()) as mock_del,
            patch("app.services.quiz_service.task_repository.create_task", AsyncMock()),
            patch("app.services.quiz_service._persist_quiz_session_and_questions", AsyncMock()),
            patch("app.services.quiz_service.task_repository.update_task_status", AsyncMock()) as mock_done,
            patch("app.services.quiz_service.schedule_domain_prewarm", AsyncMock()) as mock_refill,
        ):
            res = await quiz_service.create_quiz_task(
                QuizGenerateRequest(
                    user_input="按曲线安排巩固计算机网络",
                    question_count=3,
                    adaptive_mode=True,
                    domain_id=2,
                    allow_prewarm=True,
                ),
                user_id=9,
            )
        assert res.task_id.startswith("task_")
        mock_del.assert_awaited_once()
        mock_done.assert_awaited_once()
        assert mock_done.call_args.args[1] == "completed"
        mock_refill.assert_awaited_once_with(9, 2)


class TestV24TelemetryAndRetry:
    """V2.4 出题全链路 5 段耗时埋点、TTFT 假死自动重试与任务状态透传单测"""

    async def test_ttft_stall_triggers_retry_and_records_telemetry(self):
        from app.models.quiz import QuizOutput
        from app.services import quiz_service

        sample_output = QuizOutput(
            title="分布式锁核验",
            summary="重试恢复验证",
            questions=[_sample_question(f"q{i}", "medium") for i in range(1, 4)],
        )
        call_count = 0

        async def _flaky_stream(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise TimeoutError("llm_ttft_stall_28s")
            cb = kwargs.get("on_question_progress")
            if cb:
                await cb(2)
            return sample_output, {
                "model": "deepseek-ai/DeepSeek-V3.2",
                "llm_ttft_ms": 920,
                "llm_total_ms": 14500,
                "output_chars": 1280,
                "completion_tokens": 410,
                "tps": 30.2,
            }

        with (
            patch("app.services.quiz_service.generate_quiz_with_telemetry", side_effect=_flaky_stream),
            patch("app.services.quiz_service.task_repository.update_task_stage", AsyncMock()) as mock_stage,
        ):
            out, tel = await quiz_service._generate_quiz_with_retry(
                task_id="task_retry_demo",
                user_input="分布式锁",
                question_count=3,
                difficulty="medium",
                search_context="",
                telemetry={"queue_wait_ms": 42, "rag_search_ms": 1150},
            )

        assert call_count == 2
        assert len(out.questions) == 3
        assert tel["attempt"] == 2
        assert "llm_ttft_stall_28s" in (tel["retry_reason"] or "")
        assert tel["llm_ttft_ms"] == 920
        assert tel["tps"] == 30.2
        assert mock_stage.await_count >= 2

    async def test_get_quiz_task_status_returns_telemetry(self):
        from app.services import quiz_service

        cached_row = {
            "task_id": "task_obs_1",
            "user_id": 5,
            "status": "running",
            "stage": "generating_quiz",
            "stage_message": "AI 正在编排第 2/3 题...",
            "telemetry": {
                "model": "deepseek-ai/DeepSeek-V3.2",
                "attempt": 1,
                "queue_wait_ms": 35,
                "rag_search_ms": 2100,
                "context_chars": 1800,
                "source_type": "web_search",
            },
            "result_json": None,
            "error_message": None,
        }
        with patch("app.services.quiz_service.task_repository.get_task", AsyncMock(return_value=cached_row)):
            status = await quiz_service.get_quiz_task_status("task_obs_1", user_id=5)

        assert status.stage_message == "AI 正在编排第 2/3 题..."
        assert status.telemetry is not None
        assert status.telemetry.queue_wait_ms == 35
        assert status.telemetry.rag_search_ms == 2100
        assert status.telemetry.source_type == "web_search"




