import json
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from pydantic import SecretStr

from app.adapters.ark_video import ArkVideoClient
from app.main import app
from app.modules.assets.routes import get_storage
from app.modules.execution import runner
from app.shared.config import Settings, get_settings

from ..module05.test_canvas import API, create_draft, setup_task


@pytest.mark.parametrize("entry", ["quick", "canvas"])
@pytest.mark.parametrize("unlimited", [False, True])
def test_video_submission_polls_existing_task_and_archives_result(
    client, db, monkeypatch, entry, unlimited,
):
    headers, _, product, task = setup_task(client, db)
    draft = create_draft(
        client, headers, task, product, entry=entry, purpose="video", prompt="散步",
    )
    monkeypatch.setenv("VIDEO_BUDGET_UNLIMITED", str(unlimited))
    settings = Settings(
        ark_api_key=SecretStr("test-key"),
        video_budget_cents=0 if unlimited else 100,
        video_ceiling_cents=0 if unlimited else 50,
    )
    monkeypatch.setitem(app.dependency_overrides, get_settings, lambda: settings)
    path = f"{API}/creations/{draft['id']}/executions"
    data = {"expected_version": draft["version"], "idempotency_key": "video"}
    response = client.post(path, headers=headers, json=data)
    assert response.status_code == 202, response.text
    job = response.json()
    assert job["media"] == "video"
    assert job["outputs"][0]["reserved_cents"] == (0 if unlimited else 50)
    assert job["outputs"][0]["actual_cents"] is None
    assert client.post(path, headers=headers, json=data).json() == job
    duplicate = client.post(path, headers=headers, json={**data, "idempotency_key": "new"})
    assert duplicate.status_code == 409
    output = job["outputs"][0]["id"]
    calls = []

    def provider(request):
        calls.append(request.method)
        if request.method == "POST":
            payload = json.loads(request.content)
            assert payload["content"] == [{"type": "text", "text": "散步"}]
            assert payload["duration"] == 5
            return httpx.Response(200, json={"id": "video-test-task"})
        assert request.url.path.endswith("/video-test-task")
        if len(calls) == 2:
            return httpx.Response(200, json={"id": "video-test-task", "status": "running"})
        return httpx.Response(200, json={
            "id": "video-test-task", "status": "succeeded",
            "content": {"video_url": "https://output.example/result.mp4"},
        })

    from app.modules.execution import video_runner
    from app.modules.execution.models import ImageStep

    init = ArkVideoClient.__init__
    monkeypatch.setattr(ArkVideoClient, "__init__", lambda self, settings: init(
        self, settings, transport=httpx.MockTransport(provider),
    ))
    monkeypatch.setattr(video_runner, "download", lambda *_: b"mp4")
    monkeypatch.setattr(video_runner, "inspect_media", lambda *_: SimpleNamespace(
        width=1280, height=720, duration_seconds=5,
    ))

    class Store:
        def __init__(self):
            self.files = {}

        def put(self, key, body, mime, size):
            assert (Path(key).suffix, mime, size) == (".mp4", "video/mp4", 3)
            self.files[key] = body.read()

        def read(self, key, byte_range):
            body = self.files[key]
            if byte_range:
                body = body[byte_range[0]:byte_range[1] + 1]
            return BytesIO(body)

    store = Store()
    app.dependency_overrides[get_storage] = lambda: store
    for status in ("generating", "generating", "saving", "pending_review"):
        runner.process(db, output, store, settings)
        actual = client.get(f"{API}/executions/{job['id']}").json()["outputs"][0]
        assert actual["status"] == status
        step = db.get(ImageStep, output)
        step.lease = None
        db.commit()
    assert calls == ["POST", "GET", "GET"]
    result = client.get(f"{API}/tasks/{task['id']}/results").json()[0]
    assert (result["media"], result["previewable"], result["duration"]) == ("video", True, 5)
    url = f"{API}/tasks/{task['id']}/results/{output}/preview?file_version=1"
    preview = client.get(url, headers={"Range": "bytes=0-1"})
    assert (preview.status_code, preview.content) == (206, b"mp")
    canvas = client.get(f"{API}/tasks/{task['id']}/canvas").json()
    assert any(node["id"] == f"result:{output}" for node in canvas["nodes"]) == (entry == "canvas")
