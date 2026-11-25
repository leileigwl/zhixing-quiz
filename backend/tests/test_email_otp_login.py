"""邮箱验证码（OTP）登录：发码 / 校验 / 限流 / 单次使用 / 查建用户 / JWT 可用性 / SMTP 发送（全 mock）"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.auth import decode_token
from app.core.config import Settings
from app.core.exceptions import ServiceUnavailableError
from app.main import app
from app.services import email_otp_service, mail_service

EMAIL = "Julia.Test@163.com"
NORM_EMAIL = "julia.test@163.com"
SEND_URL = "/api/v1/auth/email/send-code"
VERIFY_URL = "/api/v1/auth/email/verify"


def make_settings(**overrides) -> Settings:
    base = dict(
        app_env="test",
        jwt_secret="unit-test-secret-for-email-otp-0123456789",
        smtp_host="",
        smtp_user="",
        smtp_password="",
        smtp_from="",
        client_ip_header="",
    )
    base.update(overrides)
    return Settings(**base)


class Clock:
    def __init__(self) -> None:
        self.t = 1_000.0

    def __call__(self) -> float:
        return self.t


@pytest.fixture(autouse=True)
def _isolate_store():
    email_otp_service.reset_memory_store()
    yield
    email_otp_service.reset_memory_store()


@pytest.fixture
def settings():
    s = make_settings()
    with patch("app.services.email_otp_service.get_settings", return_value=s):
        yield s


@pytest.fixture
def clock():
    c = Clock()
    with patch("app.services.email_otp_service._now", c):
        yield c


@pytest.fixture
def sent_codes():
    """mock 掉发信，记录 (email, code)。"""
    sent: list[tuple[str, str]] = []

    async def fake_send(_settings, to_email, code):
        sent.append((to_email, code))

    with patch.object(mail_service, "send_login_code", side_effect=fake_send) as m:
        m.sent = sent
        yield sent


@pytest.fixture
def user_repo():
    created = {}

    async def find_by_email(email):
        return created.get(email)

    async def create_with_email(openid, email):
        user = {
            "id": 100 + len(created),
            "openid": openid,
            "nickname": "学习者",
            "avatar_url": "",
            "total_xp": 0,
            "streak_days": 0,
            "email": email,
        }
        created[email] = user
        return user

    with patch(
        "app.services.email_otp_service.user_repository.find_user_by_email",
        new=AsyncMock(side_effect=find_by_email),
    ) as find_mock, patch(
        "app.services.email_otp_service.user_repository.create_user_with_email",
        new=AsyncMock(side_effect=create_with_email),
    ) as create_mock:
        yield {"users": created, "find": find_mock, "create": create_mock}


async def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _send(client, email=EMAIL):
    return await client.post(SEND_URL, json={"email": email})


async def _verify(client, code, email=EMAIL):
    return await client.post(VERIFY_URL, json={"email": email, "code": code})


# ---------------------------------------------------------------------------
# 纯函数
# ---------------------------------------------------------------------------


class TestPureHelpers:
    def test_normalize_email_lowercases_and_strips(self):
        assert email_otp_service.normalize_email("  A.B@QQ.com ") == "a.b@qq.com"

    @pytest.mark.parametrize(
        "bad", ["", "abc", "a@b", "a@@b.com", "a b@c.com", ".a@b.com", "a..b@c.com", "x" * 250 + "@a.com"]
    )
    def test_normalize_email_rejects_invalid(self, bad):
        with pytest.raises(Exception) as exc:
            email_otp_service.normalize_email(bad)
        assert getattr(exc.value, "code", None) == 4011

    def test_generate_code_is_six_digits(self):
        for _ in range(200):
            code = email_otp_service.generate_code()
            assert len(code) == 6 and code.isdigit()

    def test_hash_is_bound_to_email_and_not_plaintext(self):
        h1 = email_otp_service.hash_code("s", "a@b.com", "123456")
        assert "123456" not in h1
        assert h1 != email_otp_service.hash_code("s", "c@d.com", "123456")

    def test_email_openid_is_stable_and_fits_column(self):
        oid = email_otp_service.email_openid(NORM_EMAIL)
        assert oid == email_otp_service.email_openid(NORM_EMAIL)
        assert oid.startswith("em_") and len(oid) <= 64


# ---------------------------------------------------------------------------
# HTTP 接口
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestSendAndVerify:
    async def test_happy_path_new_user_gets_jwt(self, settings, sent_codes, user_repo):
        async with await _client() as client:
            resp = await _send(client)
            assert resp.status_code == 200
            body = resp.json()
            assert body["code"] == 0
            assert body["data"]["cooldown_seconds"] == 60
            assert body["data"]["expires_in_seconds"] == 600
            assert "code" not in body["data"]  # 明文验证码绝不回传
            assert sent_codes and sent_codes[0][0] == NORM_EMAIL

            code = sent_codes[0][1]
            resp = await _verify(client, code)
        assert resp.status_code == 200
        data = resp.json()["data"]
        payload = decode_token(data["token"])
        assert payload["user_id"] == data["user"]["id"] == 100
        assert payload["openid"] == email_otp_service.email_openid(NORM_EMAIL)
        user_repo["create"].assert_awaited_once()

    async def test_existing_user_is_reused(self, settings, sent_codes, user_repo):
        user_repo["users"][NORM_EMAIL] = {
            "id": 7,
            "openid": "em_existing",
            "nickname": "老用户",
            "avatar_url": "",
            "total_xp": 30,
            "streak_days": 2,
            "email": NORM_EMAIL,
        }
        async with await _client() as client:
            await _send(client, email="  JULIA.test@163.COM ")
            resp = await _verify(client, sent_codes[0][1], email="julia.test@163.com")
        assert resp.status_code == 200
        assert resp.json()["data"]["user"]["id"] == 7
        assert resp.json()["data"]["user"]["nickname"] == "老用户"
        user_repo["create"].assert_not_awaited()

    async def test_generic_response_does_not_leak_registration(self, settings, sent_codes, user_repo):
        user_repo["users"]["old@qq.com"] = {"id": 1}
        async with await _client() as client:
            r_new = await _send(client, email="new@qq.com")
            r_old = await _send(client, email="old@qq.com")
        assert r_new.json() == r_old.json()
        user_repo["find"].assert_not_awaited()

    async def test_wrong_code_reports_remaining_attempts(self, settings, sent_codes, user_repo):
        async with await _client() as client:
            await _send(client)
            real = sent_codes[0][1]
            wrong = "000000" if real != "000000" else "111111"
            resp = await _verify(client, wrong)
            assert resp.status_code == 400
            assert resp.json()["code"] == 4012
            assert "4" in resp.json()["message"]
            # 错误一次后正确码仍可用
            ok = await _verify(client, real)
        assert ok.status_code == 200

    async def test_malformed_code_is_rejected_without_consuming_attempt(
        self, settings, sent_codes, user_repo
    ):
        async with await _client() as client:
            await _send(client)
            for bad in ["12345", "abcdef", "1234567"]:
                resp = await _verify(client, bad)
                assert resp.json()["code"] == 4012
            ok = await _verify(client, sent_codes[0][1])
        assert ok.status_code == 200

    async def test_code_expires_after_ttl(self, settings, sent_codes, user_repo, clock):
        async with await _client() as client:
            await _send(client)
            clock.t += settings.email_code_ttl_seconds + 1
            resp = await _verify(client, sent_codes[0][1])
        assert resp.status_code == 400
        assert resp.json()["code"] == 4012
        assert resp.json()["message"] == "验证码错误或已过期"

    async def test_attempt_limit_burns_code(self, settings, sent_codes, user_repo):
        async with await _client() as client:
            await _send(client)
            real = sent_codes[0][1]
            wrong = "000000" if real != "000000" else "111111"
            codes = []
            for _ in range(settings.email_code_max_attempts):
                codes.append((await _verify(client, wrong)).json()["code"])
            assert codes[:-1] == [4012] * (settings.email_code_max_attempts - 1)
            assert codes[-1] == 4013
            # 达到上限后，正确的码也已作废
            after = await _verify(client, real)
        assert after.json()["code"] == 4012

    async def test_code_is_single_use(self, settings, sent_codes, user_repo):
        async with await _client() as client:
            await _send(client)
            code = sent_codes[0][1]
            first = await _verify(client, code)
            second = await _verify(client, code)
        assert first.status_code == 200
        assert second.status_code == 400
        assert second.json()["code"] == 4012

    async def test_resend_invalidates_previous_code(self, settings, sent_codes, user_repo, clock):
        async with await _client() as client:
            await _send(client)
            clock.t += settings.email_code_cooldown_seconds + 1
            await _send(client)
            old, new = sent_codes[0][1], sent_codes[1][1]
            if old != new:
                assert (await _verify(client, old)).json()["code"] == 4012
            assert (await _verify(client, new)).status_code == 200

    async def test_cooldown_blocks_second_send_within_60s(self, settings, sent_codes, clock):
        async with await _client() as client:
            first = await _send(client)
            clock.t += 30
            second = await _send(client)
            clock.t += 31
            third = await _send(client)
        assert first.status_code == 200
        assert second.status_code == 429
        assert second.json()["code"] == 4290
        assert "60" in second.json()["message"]
        assert third.status_code == 200
        assert len(sent_codes) == 2

    async def test_daily_limit_per_email(self, sent_codes, clock):
        s = make_settings(email_code_daily_limit=3, email_code_cooldown_seconds=1)
        with patch("app.services.email_otp_service.get_settings", return_value=s):
            async with await _client() as client:
                statuses = []
                for _ in range(4):
                    statuses.append((await _send(client)).status_code)
                    clock.t += 2
        assert statuses == [200, 200, 200, 429]
        assert len(sent_codes) == 3

    async def test_per_ip_limit(self, sent_codes):
        s = make_settings(email_code_ip_hourly_limit=2)
        with patch("app.services.email_otp_service.get_settings", return_value=s):
            async with await _client() as client:
                r1 = await _send(client, email="a1@qq.com")
                r2 = await _send(client, email="a2@qq.com")
                r3 = await _send(client, email="a3@qq.com")
        assert [r1.status_code, r2.status_code, r3.status_code] == [200, 200, 429]
        assert r3.json()["message"] == "操作过于频繁，请稍后再试"

    async def test_client_ip_header_is_honoured_when_configured(self, sent_codes):
        s = make_settings(email_code_ip_hourly_limit=1, client_ip_header="X-Real-IP")
        with patch("app.services.email_otp_service.get_settings", return_value=s), patch(
            "app.api.v1.routes.auth.get_settings", return_value=s
        ):
            async with await _client() as client:
                r1 = await client.post(
                    SEND_URL, json={"email": "b1@qq.com"}, headers={"X-Real-IP": "1.1.1.1"}
                )
                r2 = await client.post(
                    SEND_URL, json={"email": "b2@qq.com"}, headers={"X-Real-IP": "2.2.2.2"}
                )
                r3 = await client.post(
                    SEND_URL, json={"email": "b3@qq.com"}, headers={"X-Real-IP": "1.1.1.1"}
                )
        assert [r1.status_code, r2.status_code, r3.status_code] == [200, 200, 429]

    async def test_invalid_email_returns_4011(self, settings, sent_codes):
        async with await _client() as client:
            resp = await _send(client, email="not-an-email")
        assert resp.status_code == 400
        assert resp.json()["code"] == 4011
        assert sent_codes == []

    async def test_verify_without_send_is_generic_error(self, settings, user_repo):
        async with await _client() as client:
            resp = await _verify(client, "123456")
        assert resp.status_code == 400
        assert resp.json()["code"] == 4012
        user_repo["find"].assert_not_awaited()

    async def test_jwt_from_email_login_works_on_authed_endpoint(
        self, settings, sent_codes, user_repo
    ):
        async with await _client() as client:
            await _send(client)
            token = (await _verify(client, sent_codes[0][1])).json()["data"]["token"]
            user_row = {
                "id": 100,
                "openid": "em_x",
                "nickname": "学习者",
                "avatar_url": "",
                "total_xp": 0,
                "streak_days": 0,
            }
            with patch(
                "app.services.user_service.user_repository.get_user_by_id",
                new=AsyncMock(return_value=user_row),
            ), patch(
                "app.services.user_service.quiz_repository.get_user_quiz_count",
                new=AsyncMock(return_value=0),
            ), patch(
                "app.services.user_service.quiz_repository.get_user_answer_stats",
                new=AsyncMock(return_value={"correct_count": 0, "average_accuracy": 0}),
            ):
                authed = await client.get(
                    "/api/v1/user/profile", headers={"Authorization": f"Bearer {token}"}
                )
                anon = await client.get("/api/v1/user/profile")
        assert authed.status_code == 200
        assert authed.json()["data"]["id"] == 100
        assert anon.status_code == 401

    async def test_smtp_failure_returns_503_and_allows_immediate_retry(self, settings):
        calls = {"n": 0}

        async def flaky(_s, _to, _code):
            calls["n"] += 1
            if calls["n"] == 1:
                raise ServiceUnavailableError("验证码发送失败，请稍后重试")

        with patch.object(mail_service, "send_login_code", side_effect=flaky):
            async with await _client() as client:
                first = await _send(client)
                second = await _send(client)
        assert first.status_code == 503
        assert first.json()["code"] == 5030
        assert second.status_code == 200


# ---------------------------------------------------------------------------
# 生产环境门禁
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestProductionGate:
    PROD = dict(app_env="production", jwt_secret="x9P4mQ2vR8nK5wL7zJ3bN6cM1yH0tF4dA")

    async def test_production_without_smtp_refuses_send(self):
        s = make_settings(**self.PROD)
        with patch("app.services.email_otp_service.get_settings", return_value=s), patch.object(
            mail_service, "_send_via_smtp_blocking"
        ) as smtp:
            async with await _client() as client:
                resp = await _send(client)
        assert resp.status_code == 503
        assert resp.json()["code"] == 5030
        smtp.assert_not_called()

    async def test_production_without_redis_refuses_memory_store(self):
        s = make_settings(**self.PROD, smtp_host="smtp.163.com", smtp_user="me@163.com")
        with patch("app.services.email_otp_service.get_settings", return_value=s), patch(
            "app.services.email_otp_service.get_redis", return_value=None
        ):
            async with await _client() as client:
                resp = await _send(client)
        assert resp.status_code == 503

    async def test_console_backend_never_used_in_production(self):
        s = make_settings(**self.PROD)
        with pytest.raises(ServiceUnavailableError):
            await mail_service.send_login_code(s, NORM_EMAIL, "123456")

    async def test_console_backend_logs_in_dev(self):
        s = make_settings(app_env="development")
        with patch.object(mail_service, "_send_via_smtp_blocking") as smtp, patch.object(
            mail_service.logger, "warning"
        ) as warn:
            await mail_service.send_login_code(s, NORM_EMAIL, "654321")
        smtp.assert_not_called()
        assert warn.call_args.kwargs["code"] == "654321"


# ---------------------------------------------------------------------------
# SMTP 发送（smtplib 全 mock）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestSmtpSender:
    async def test_ssl_smtp_login_and_message(self):
        s = make_settings(
            smtp_host="smtp.163.com",
            smtp_port=465,
            smtp_user="sender@163.com",
            smtp_password="AUTHCODE",
            smtp_from="sender@163.com",
            smtp_use_ssl=True,
        )
        server = MagicMock()
        with patch("app.services.mail_service.smtplib.SMTP_SSL", return_value=server) as ssl_cls:
            await mail_service.send_login_code(s, NORM_EMAIL, "246810")
        ssl_cls.assert_called_once()
        assert ssl_cls.call_args.args[:2] == ("smtp.163.com", 465)
        server.login.assert_called_once_with("sender@163.com", "AUTHCODE")
        msg = server.send_message.call_args.args[0]
        assert msg["To"] == NORM_EMAIL
        assert msg["Subject"] == "知行快刷 验证码"
        assert "sender@163.com" in msg["From"]
        text = msg.get_body(preferencelist=("plain",)).get_content()
        html = msg.get_body(preferencelist=("html",)).get_content()
        assert "246810" in text and "246810" in html
        assert "10 分钟" in text
        server.quit.assert_called_once()

    async def test_starttls_when_ssl_disabled(self):
        s = make_settings(
            smtp_host="smtpdm.aliyun.com",
            smtp_port=80,
            smtp_user="no-reply@mail.example.com",
            smtp_password="pw",
            smtp_use_ssl=False,
        )
        server = MagicMock()
        server.has_extn.return_value = True
        with patch("app.services.mail_service.smtplib.SMTP", return_value=server):
            await mail_service.send_login_code(s, NORM_EMAIL, "135790")
        server.starttls.assert_called_once()
        server.send_message.assert_called_once()

    async def test_smtp_error_maps_to_service_unavailable(self):
        import smtplib

        s = make_settings(smtp_host="smtp.qq.com", smtp_user="u@qq.com", smtp_password="x")
        server = MagicMock()
        server.login.side_effect = smtplib.SMTPAuthenticationError(535, b"auth failed")
        with patch("app.services.mail_service.smtplib.SMTP_SSL", return_value=server):
            with pytest.raises(ServiceUnavailableError):
                await mail_service.send_login_code(s, NORM_EMAIL, "000111")


# ---------------------------------------------------------------------------
# Redis 存储（fake client，验证原子语义）
# ---------------------------------------------------------------------------


class FakeRedis:
    def __init__(self):
        self.kv: dict[str, object] = {}

    async def set(self, key, value, nx=False, ex=None):
        if nx and key in self.kv:
            return None
        self.kv[key] = value
        return True

    async def delete(self, key):
        return 1 if self.kv.pop(key, None) is not None else 0

    def pipeline(self, transaction=True):
        outer = self

        class Pipe:
            def __init__(self):
                self.ops = []

            def delete(self, key):
                self.ops.append(("del", key))

            def hset(self, key, mapping):
                self.ops.append(("hset", key, mapping))

            def expire(self, key, ttl):
                self.ops.append(("expire", key, ttl))

            async def execute(self):
                for op in self.ops:
                    if op[0] == "del":
                        outer.kv.pop(op[1], None)
                    elif op[0] == "hset":
                        outer.kv[op[1]] = {k: str(v) for k, v in op[2].items()}

        return Pipe()

    async def eval(self, script, numkeys, key):
        h = self.kv.get(key)
        if not isinstance(h, dict):
            return None
        h["a"] = str(int(h["a"]) + 1)
        return [h["h"], int(h["a"])]


@pytest.mark.asyncio
class TestRedisStore:
    async def test_redis_store_full_cycle(self, settings, sent_codes, user_repo):
        fake = FakeRedis()
        with patch("app.services.email_otp_service.get_redis", return_value=fake), patch(
            "app.core.rate_limit.get_redis", return_value=None
        ):
            async with await _client() as client:
                assert (await _send(client)).status_code == 200
                assert (await _send(client)).status_code == 429  # SET NX 冷却
                code = sent_codes[0][1]
                assert (await _verify(client, code)).status_code == 200
                assert (await _verify(client, code)).json()["code"] == 4012
        stored_values = [v for v in fake.kv.values() if isinstance(v, dict)]
        assert stored_values == []  # 用后即删


def test_smtp_env_aliases_and_enabled_flag(monkeypatch):
    """SMTP_FROM_EMAIL 等价于 SMTP_FROM；SMTP_ENABLED=false 时视为未配置。"""
    from app.core.config import Settings

    for key in ("SMTP_FROM", "SMTP_FROM_EMAIL", "SMTP_ENABLED", "SMTP_HOST"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("SMTP_HOST", "smtp.163.com")
    monkeypatch.setenv("SMTP_FROM_EMAIL", "sender@163.com")
    s = Settings(_env_file=None)
    assert s.smtp_from == "sender@163.com"
    assert s.smtp_configured is True

    monkeypatch.setenv("SMTP_ENABLED", "false")
    assert Settings(_env_file=None).smtp_configured is False
