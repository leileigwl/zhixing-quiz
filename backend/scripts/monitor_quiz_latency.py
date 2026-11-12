"""V2.4 出题后台全链路耗时监控与多轮自测诊断脚本。

通过真实 HTTP API 发起多组不同场景（联网开启/关闭）的异步出题并持续轮询，
汇总每轮 5 段毫秒级耗时（排队 / 域分类 / 检索 / LLM TTFT / LLM 生成 / 落库）与重试原因。
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
from typing import Any

import httpx


DEFAULT_TRIALS: list[dict[str, Any]] = [
    {
        "label": "分布式锁(快速3题·联网)",
        "user_input": "请帮我检验「分布式锁」的核心机制与易错点",
        "question_count": 3,
        "enable_web_search": True,
        "adaptive_mode": False,
    },
    {
        "label": "RAG检索(快速3题·纯LLM)",
        "user_input": "请帮我检验「RAG 检索」的核心机制与易错点",
        "question_count": 3,
        "enable_web_search": False,
        "adaptive_mode": False,
    },
    {
        "label": "HTTP3(自适应·联网)",
        "user_input": "请帮我检验「HTTP/3」的核心机制与易错点",
        "question_count": 3,
        "enable_web_search": True,
        "adaptive_mode": True,
    },
]


async def run_trial(client: httpx.AsyncClient, headers: dict[str, str], trial: dict[str, Any]) -> dict[str, Any]:
    t0 = time.perf_counter()
    create_resp = await client.post(
        "/api/v1/quiz/generate/async",
        headers=headers,
        json={
            "user_input": trial["user_input"],
            "question_count": trial["question_count"],
            "enable_web_search": trial["enable_web_search"],
            "adaptive_mode": trial["adaptive_mode"],
            "generate_images": False,
            "allow_prewarm": False,
        },
    )
    create_resp.raise_for_status()
    task_id = create_resp.json()["data"]["task_id"]

    last_stage_msg = ""
    final_data: dict[str, Any] = {}
    stages_seen: list[str] = []

    while True:
        await asyncio.sleep(0.5)
        st_resp = await client.get(f"/api/v1/quiz/task/{task_id}", headers=headers)
        st_resp.raise_for_status()
        final_data = st_resp.json()["data"]
        stage_msg = f"{final_data.get('stage')}:{final_data.get('stage_message') or ''}"
        if stage_msg != last_stage_msg:
            last_stage_msg = stage_msg
            elapsed_s = round(time.perf_counter() - t0, 1)
            stages_seen.append(f"{elapsed_s}s->{stage_msg}")
            print(f"  [{trial['label']} | {elapsed_s:5.1f}s] {stage_msg}", flush=True)
        if final_data["status"] in ("completed", "failed"):
            break
        if time.perf_counter() - t0 > 210:
            break

    wall_ms = int((time.perf_counter() - t0) * 1000)
    tel = final_data.get("telemetry") or {}
    return {
        "label": trial["label"],
        "task_id": task_id,
        "status": final_data.get("status"),
        "wall_ms": wall_ms,
        "error": final_data.get("error_message"),
        "telemetry": tel,
        "stages": stages_seen,
    }


async def main() -> None:
    base_url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
    async with httpx.AsyncClient(base_url=base_url, timeout=30.0) as client:
        login = await client.post("/api/v1/user/dev-login", json={})
        login.raise_for_status()
        token = login.json()["data"]["token"]
        headers = {"Authorization": f"Bearer {token}"}

        results: list[dict[str, Any]] = []
        for trial in DEFAULT_TRIALS:
            print(f"\n=== Running Trial: {trial['label']} ===", flush=True)
            res = await run_trial(client, headers, trial)
            results.append(res)

    print("\n=== MONITORING SUMMARY (5-STAGE TELEMETRY) ===")
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
