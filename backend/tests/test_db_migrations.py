"""数据库幂等列迁移与启动自愈测试"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.db import COLUMN_MIGRATIONS, _ensure_column_migrations, recover_stale_jobs


@pytest.mark.asyncio
async def test_ensure_column_migrations_adds_only_missing_columns():
    cursor = AsyncMock()
    # 模拟前 2 列不存在 (0)，后 3 列已存在 (1)
    cursor.fetchone = AsyncMock(side_effect=[(0,), (0,), (1,), (1,), (1,)])

    await _ensure_column_migrations(cursor, "zhixing_quiz")

    alter_calls = [
        call.args[0]
        for call in cursor.execute.await_args_list
        if call.args[0].startswith("ALTER TABLE")
    ]
    assert len(alter_calls) == 2
    assert "`quiz_tasks` ADD COLUMN `stage`" in alter_calls[0]
    assert "`quiz_sessions` ADD COLUMN `image_status`" in alter_calls[1]


@pytest.mark.asyncio
async def test_ensure_column_migrations_is_idempotent_when_all_exist():
    cursor = AsyncMock()
    cursor.fetchone = AsyncMock(side_effect=[(1,)] * len(COLUMN_MIGRATIONS))

    await _ensure_column_migrations(cursor, "zhixing_quiz")

    alter_calls = [
        call.args[0]
        for call in cursor.execute.await_args_list
        if call.args[0].startswith("ALTER TABLE")
    ]
    assert alter_calls == []


@pytest.mark.asyncio
async def test_recover_stale_jobs_updates_tasks_docs_reports_and_images():
    cursor = AsyncMock()
    rowcounts = iter([2, 1, 3, 4])

    async def fake_execute(sql, *args):
        cursor.rowcount = next(rowcounts)

    cursor.execute = AsyncMock(side_effect=fake_execute)

    conn = MagicMock()
    conn.cursor.return_value.__aenter__ = AsyncMock(return_value=cursor)
    conn.cursor.return_value.__aexit__ = AsyncMock(return_value=False)

    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)

    with patch("app.core.db.get_mysql_pool", return_value=pool):
        tasks, docs = await recover_stale_jobs()

    assert (tasks, docs) == (2, 1)
    executed_sqls = [call.args[0] for call in cursor.execute.await_args_list]
    assert any("UPDATE reports SET status = 'failed'" in sql for sql in executed_sqls)
    assert any("UPDATE quiz_sessions SET image_status = 'partial'" in sql for sql in executed_sqls)
