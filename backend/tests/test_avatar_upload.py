"""头像上传：魔数校验、大小上限、存储与写回档案。"""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.auth import create_token
from app.main import app
from app.services import avatar_service

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"\x00" * 64


@pytest.fixture
def auth_header():
    token = create_token(user_id=7, openid="em_test")
    return {"Authorization": f"Bearer {token}"}


class TestDetect:
    @pytest.mark.parametrize(
        ("data", "ext"), [(JPEG, "jpg"), (PNG, "png"), (WEBP, "webp"), (b"GIF89a" + b"\x00" * 8, "gif")]
    )
    def test_known_types(self, data, ext):
        assert avatar_service.detect_image_type(data)[0] == ext

    @pytest.mark.parametrize(
        "data", [b"<svg xmlns='http://www.w3.org/2000/svg'></svg>", b"%PDF-1.4", b"hello", b""]
    )
    def test_rejects_non_images(self, data):
        assert avatar_service.detect_image_type(data) is None


@pytest.mark.asyncio
class TestAvatarAPI:
    async def _post(self, headers, data: bytes, filename="a.jpg", ctype="image/jpeg"):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.post(
                "/api/v1/user/avatar", headers=headers, files={"file": (filename, data, ctype)}
            )

    async def test_upload_saves_and_updates_profile(self, auth_header):
        upload = AsyncMock(return_value="https://study.example.cn/static/quiz-images/avatars/u7_x.jpg")
        update = AsyncMock()
        with patch.object(avatar_service.cos_service, "upload_image_bytes", upload), patch.object(
            avatar_service.user_repository, "update_user_profile", update
        ), patch.object(avatar_service, "check_rate_limit_async", AsyncMock()):
            resp = await self._post(auth_header, JPEG)
        body = resp.json()
        assert resp.status_code == 200 and body["code"] == 0
        assert body["data"]["avatar_url"].endswith("u7_x.jpg")
        key = upload.await_args.args[1]
        assert key.startswith("quiz-images/avatars/u7_") and key.endswith(".jpg")
        assert upload.await_args.args[2] == "image/jpeg"
        update.assert_awaited_once_with(7, None, body["data"]["avatar_url"])

    async def test_content_type_comes_from_magic_not_filename(self, auth_header):
        upload = AsyncMock(return_value="https://x/avatars/a.png")
        with patch.object(avatar_service.cos_service, "upload_image_bytes", upload), patch.object(
            avatar_service.user_repository, "update_user_profile", AsyncMock()
        ), patch.object(avatar_service, "check_rate_limit_async", AsyncMock()):
            resp = await self._post(auth_header, PNG, filename="evil.html", ctype="text/html")
        assert resp.json()["code"] == 0
        assert upload.await_args.args[1].endswith(".png")
        assert upload.await_args.args[2] == "image/png"

    async def test_rejects_svg(self, auth_header):
        upload = AsyncMock()
        with patch.object(avatar_service.cos_service, "upload_image_bytes", upload):
            resp = await self._post(auth_header, b"<svg></svg>", filename="a.svg", ctype="image/svg+xml")
        assert resp.status_code == 400
        assert resp.json()["code"] == 4002
        upload.assert_not_awaited()

    async def test_rejects_too_large(self, auth_header):
        upload = AsyncMock()
        big = JPEG + b"\x00" * avatar_service.AVATAR_MAX_BYTES
        with patch.object(avatar_service.cos_service, "upload_image_bytes", upload):
            resp = await self._post(auth_header, big)
        assert resp.status_code == 400
        assert resp.json()["message"] == avatar_service.MSG_TOO_LARGE
        upload.assert_not_awaited()

    async def test_requires_login(self):
        resp = await self._post({}, JPEG)
        assert resp.status_code == 401
