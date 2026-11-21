from __future__ import annotations

import json

import httpx
import pytest
from pydantic import ValidationError

from app.adapters.ark_video import ArkVideoClient, ArkVideoError, VideoGenerationRequest
from app.shared.config import Settings

TASKS_PATH = "/api/v3/contents/generations/tasks"
TASK_ID = "cgt-20261122080000-example"
TEST_KEY = "test-video-key"


def test_create_and_query_same_seedance_task() -> None:
    requests: list[tuple[str, str]] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append((request.method, request.url.path))
        assert request.headers["Authorization"] == f"Bearer {TEST_KEY}"
        if request.method == "POST":
            assert json.loads(request.content) == {
                "model": "doubao-seedance-2-0-260128",
                "content": [{"type": "text", "text": "米白色运动鞋棚拍"}],
                "duration": 5,
                "ratio": "16:9",
                "resolution": "720p",
                "watermark": True,
                "generate_audio": False,
            }
            return httpx.Response(200, json={"id": TASK_ID})
        if len(requests) == 2:
            return httpx.Response(200, json={"id": TASK_ID, "status": "queued", "content": None})
        return httpx.Response(
            200,
            json={
                "id": TASK_ID,
                "status": "succeeded",
                "content": {"video_url": "https://output.example/video.mp4?signature=test"},
                "usage": {"completion_tokens": 108900, "total_tokens": 108900},
            },
        )

    settings = Settings(ark_api_key=TEST_KEY, _env_file=None)
    assert settings.ark_video_model == "doubao-seedance-2-0-260128"
    with ArkVideoClient(settings, transport=httpx.MockTransport(handle)) as client:
        created = client.create_task(VideoGenerationRequest(prompt=" 米白色运动鞋棚拍 "))
        assert created.id == TASK_ID
        assert created.http_status == 200
        assert client.get_task(created.id).status == "queued"
        result = client.get_task(created.id)

    assert requests == [
        ("POST", TASKS_PATH),
        ("GET", f"{TASKS_PATH}/{TASK_ID}"),
        ("GET", f"{TASKS_PATH}/{TASK_ID}"),
    ]
    assert result.status == "succeeded"
    assert str(result.video_url) == "https://output.example/video.mp4?signature=test"
    assert result.total_tokens == 108900


@pytest.mark.parametrize("duration", [3, 16])
def test_rejects_duration_outside_seedance_20_range(duration: int) -> None:
    with pytest.raises(ValidationError):
        VideoGenerationRequest(prompt="商品展示", duration=duration)


@pytest.mark.parametrize("timeout", [False, True])
def test_create_does_not_retry_or_include_provider_body(timeout: bool) -> None:
    calls = 0

    def handle(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if timeout:
            raise httpx.ReadTimeout(TEST_KEY, request=request)
        return httpx.Response(
            429,
            json={"error": {"code": "SetLimitExceeded", "message": TEST_KEY}},
        )

    settings = Settings(ark_api_key=TEST_KEY, _env_file=None)
    with ArkVideoClient(settings, transport=httpx.MockTransport(handle)) as client:
        with pytest.raises(ArkVideoError) as caught:
            client.create_task(VideoGenerationRequest(prompt="商品展示"))

    error = caught.value
    assert calls == 1
    assert error.category == ("provider_timeout" if timeout else "rate_limited")
    assert error.provider_code == (None if timeout else "SetLimitExceeded")
    assert TEST_KEY not in str(error)
    assert error.__cause__ is None


def test_distinguishes_failed_task_from_missing_success_result() -> None:
    bodies = iter(
        [
            {
                "id": TASK_ID,
                "status": "failed",
                "error": {"code": "InternalError", "message": TEST_KEY},
            },
            {"id": TASK_ID, "status": "succeeded", "content": {}},
        ]
    )
    settings = Settings(ark_api_key=TEST_KEY, _env_file=None)
    transport = httpx.MockTransport(lambda _: httpx.Response(200, json=next(bodies)))
    with ArkVideoClient(settings, transport=transport) as client:
        failed = client.get_task(TASK_ID)
        assert failed.status == "failed"
        assert failed.error_code == "InternalError"
        assert TEST_KEY not in repr(failed)
        with pytest.raises(ArkVideoError, match="缺少视频 URL"):
            client.get_task(TASK_ID)
