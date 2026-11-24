"""user_repository 邮箱用户：查找与并发重复注册回查"""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pymysql
import pytest

from app.repositories import user_repository


def _fake_pool(cursor):
    conn = MagicMock()

    @asynccontextmanager
    async def cursor_cm():
        yield cursor

    conn.cursor = cursor_cm

    @asynccontextmanager
    async def acquire():
        yield conn

    pool = MagicMock()
    pool.acquire = acquire
    return pool


@pytest.mark.asyncio
async def test_find_user_by_email_maps_row():
    cursor = AsyncMock()
    cursor.fetchone = AsyncMock(return_value=(5, "em_x", "学习者", "", 10, 3, "a@b.com"))
    with patch.object(user_repository, "get_mysql_pool", return_value=_fake_pool(cursor)):
        user = await user_repository.find_user_by_email("a@b.com")
    assert user["id"] == 5 and user["email"] == "a@b.com" and user["streak_days"] == 3
    assert cursor.execute.await_args.args[1] == ("a@b.com",)


@pytest.mark.asyncio
async def test_create_user_with_email_inserts_openid_and_email():
    cursor = AsyncMock()
    cursor.lastrowid = 42
    with patch.object(user_repository, "get_mysql_pool", return_value=_fake_pool(cursor)):
        user = await user_repository.create_user_with_email("em_abc", "a@b.com")
    assert user["id"] == 42 and user["openid"] == "em_abc"
    sql, params = cursor.execute.await_args.args
    assert "INSERT INTO users (openid, email)" in sql
    assert params == ("em_abc", "a@b.com")


@pytest.mark.asyncio
async def test_create_user_with_email_duplicate_returns_existing():
    cursor = AsyncMock()
    cursor.execute = AsyncMock(side_effect=pymysql.err.IntegrityError(1062, "Duplicate entry"))
    existing = {"id": 9, "email": "a@b.com"}
    with patch.object(user_repository, "get_mysql_pool", return_value=_fake_pool(cursor)), patch.object(
        user_repository, "find_user_by_email", new=AsyncMock(return_value=existing)
    ):
        user = await user_repository.create_user_with_email("em_abc", "a@b.com")
    assert user is existing


@pytest.mark.asyncio
async def test_find_user_by_email_without_pool_returns_none():
    with patch.object(user_repository, "get_mysql_pool", return_value=None):
        assert await user_repository.find_user_by_email("a@b.com") is None
