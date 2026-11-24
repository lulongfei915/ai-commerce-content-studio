import base64
import json
from datetime import datetime, timedelta
from email import policy
from email.parser import BytesParser
from io import BytesIO

import httpx
import pytest
from PIL import Image
from pydantic import SecretStr

from app.modules.creation.models import CreationOutput
from app.modules.execution.models import Execution, ImageStep
from app.shared.config import get_settings

from ..module03.test_production_setup import API
from ..module05.test_canvas import create_draft, setup_task

PARAMETERS = {
    "provider": "gpt-image",
    "model": "gpt-image-2",
    "ratio": "3:4",
    "resolution": "1.5K",
    "quality": "low",
    "count": 1,
}


def png(width, height):
    stream = BytesIO()
    Image.new("RGB", (width, height), "red").save(stream, "PNG")
    return stream.getvalue()


@pytest.fixture
def gpt_settings(monkeypatch):
    settings = get_settings()
    monkeypatch.setitem(settings.__dict__, "itaiapi_api_key", SecretStr("test-itaiapi"))
    monkeypatch.setitem(settings.__dict__, "itaiapi_image_models", "gpt-image-2")
    monkeypatch.setitem(settings.__dict__, "itaiapi_image_ceiling_cents", 13)
    monkeypatch.setattr(settings, "image_budget_cents", 20)
    return settings


def test_capabilities_and_draft_validation(client, db, gpt_settings):
    headers, product, _, task = setup_task(client, db)
    path = f"{API}/tasks/{task['id']}/creations"
    body = {"product_id": product["id"], "purpose": "main", "entry": "canvas", "primary": False}
    caps = client.get(f"{API}/creation-capabilities").json()
    by_provider = {item["provider"]: item for item in caps["models"]}
    assert set(by_provider) == {"ark", "gpt-image"}
    model = by_provider["gpt-image"]
    assert model["model"] == "gpt-image-2"
    assert {"low", "medium", "high", "auto"} <= set(model["qualities"])
    assert {"ratio": "3:4", "resolution": "1.5K", "width": 1152, "height": 1536} in model["sizes"]
    for field, value in (("quality", "max"), ("resolution", "4K"), ("model", "gpt-image-2.6")):
        response = client.post(path, headers=headers, json={
            **body, "parameters": {**PARAMETERS, field: value},
        })
        assert response.status_code == 422
        assert response.json()["detail"]["field"] == f"parameters.{field}"
    draft = client.post(path, headers=headers, json={**body, "parameters": PARAMETERS})
    assert draft.status_code == 201, draft.text
    assert client.get(f"{API}/creations/{draft.json()['id']}").json()["parameters"] == PARAMETERS


def test_images_api_encodes_generation_and_edits(gpt_settings):
    from app.adapters.gpt_image import GptImageClient

    calls = []
    image = png(16, 16)

    def handle(request):
        calls.append(request)
        assert request.headers["Authorization"] == "Bearer test-itaiapi"
        assert request.url.host == "xinapi.itaiapi.com"
        return httpx.Response(
            200, headers={"x-request-id": "image-123"},
            json={"data": [{"b64_json": base64.b64encode(image).decode()}]},
        )

    with GptImageClient(gpt_settings, transport=httpx.MockTransport(handle)) as provider:
        for references in ([], [("image/png", image), ("image/png", image)]):
            result = provider.generate("gpt-image-2", "test", "1152x1536", "low", references)
            assert result.body == image
            assert result.request_id == "image-123"
    assert [req.url.path for req in calls] == ["/v1/images/generations", "/v1/images/edits"]
    payload = dict(
        model="gpt-image-2", prompt="test", size="1152x1536", quality="low",
        output_format="png", n=1,
    )
    assert json.loads(calls[0].content) == payload
    multipart = BytesParser(policy=policy.default).parsebytes(
        f"Content-Type: {calls[1].headers['content-type']}\r\n\r\n".encode() + calls[1].content
    )
    parts = list(multipart.iter_parts())
    assert {
        part.get_param("name", header="content-disposition"): part.get_content().strip()
        for part in parts if part.get_filename() is None
    } == {name: str(value) for name, value in payload.items()}
    files = [part for part in parts if part.get_filename()]
    assert [part.get_param("name", header="content-disposition") for part in files] == [
        "image[]", "image[]",
    ]
    assert all(part.get_payload(decode=True) == image for part in files)


@pytest.mark.parametrize(
    "status, body, category",
    [
        (401, {}, "authentication"),
        (403, {}, "authentication"),
        (404, {"error": {"code": "model_not_found"}}, "invalid_request"),
        (429, {}, "rate_limited"),
        (504, {}, "provider_unavailable"),
        (200, {"data": [{"b64_json": "bad@"}]}, "invalid_response"),
        (200, {"error": {"code": "unexpected_error"}}, "invalid_response"),
    ],
)
def test_gateway_failure_contract(gpt_settings, status, body, category):
    from app.adapters.gpt_image import GptImageClient
    from app.adapters.image_errors import ImageProviderError

    def handle(request):
        return httpx.Response(
            status, headers={"x-request-id": "test-request", "retry-after": "15"}, json=body
        )

    with GptImageClient(gpt_settings, transport=httpx.MockTransport(handle)) as provider:
        with pytest.raises(ImageProviderError) as caught:
            provider.generate("gpt-image-2", "test", "1024x1024", "low", [])
    assert caught.value.category == category
    assert caught.value.status_code == status
    assert caught.value.request_id == "test-request"
    assert caught.value.retry_after == (15 if status == 429 else None)


def test_worker_recovers_inline_object_after_interrupted_commit(client, db, gpt_settings):
    from app.modules.execution.runner import process

    headers, product, _, task = setup_task(client, db)
    draft = create_draft(client, headers, task, product, parameters=PARAMETERS)
    accepted = client.post(
        f"{API}/creations/{draft['id']}/executions",
        headers=headers,
        json={"expected_version": draft["version"], "idempotency_key": "recover-inline"},
    )
    assert accepted.status_code == 202, accepted.text
    identifier = accepted.json()["outputs"][0]["id"]
    output = db.get(CreationOutput, identifier)
    step = db.get(ImageStep, identifier)
    expired_lease = (datetime.utcnow() - timedelta(seconds=5)).replace(microsecond=0)
    output.status, step.lease = "generating", expired_lease
    db.commit()
    object_key = f"generated/alpha/{identifier}/{expired_lease:%Y%m%d%H%M%S}.png"

    class Store:
        def read(self, key, byte_range):
            assert key == object_key
            return BytesIO(png(1152, 1536))

    process(db, identifier, Store(), gpt_settings)
    assert output.status == "saving"
    assert step.result_object_key == object_key
    process(db, identifier, Store(), gpt_settings)
    assert output.status == "pending_review"


@pytest.mark.parametrize("width,expected", [(1152, "pending_review"), (1254, "result_unavailable")])
def test_worker_keeps_gpt_result_on_archive_retry(
    client, db, monkeypatch, gpt_settings, width, expected
):
    from app.adapters.gpt_image import GptImageClient
    from app.main import app
    from app.modules.assets.routes import get_storage
    from app.modules.execution.runner import process

    headers, product, _, task = setup_task(client, db)
    draft = create_draft(client, headers, task, product, parameters=PARAMETERS)
    path = f"{API}/creations/{draft['id']}/executions"
    request = {"expected_version": draft["version"], "idempotency_key": "gpt"}
    accepted = client.post(path, headers=headers, json=request)
    assert accepted.status_code == 202, accepted.text
    job = accepted.json()
    assert client.post(path, headers=headers, json=request).json() == job
    identifier = job["outputs"][0]["id"]
    assert job["outputs"][0]["reserved_cents"] == 13
    snapshot = db.get(Execution, job["id"]).snapshot
    assert (snapshot["provider"], snapshot["model"], snapshot["size"], snapshot["quality"]) == (
        "gpt-image", "gpt-image-2", "1152x1536", "low",
    )
    image = png(width, 1536)
    calls = []

    def handle(request):
        calls.append(request)
        assert request.url.path == "/v1/images/edits"
        return httpx.Response(
            200, headers={"x-request-id": "gpt-output"},
            json={"data": [{"b64_json": base64.b64encode(image).decode()}]},
        )

    init = GptImageClient.__init__
    monkeypatch.setattr(GptImageClient, "__init__", lambda self, settings: init(
        self, settings, transport=httpx.MockTransport(handle),
    ))

    class Store:
        files = {"sample-red-canvas": png(16, 16)}
        fail_archive = True

        def put(self, key, body, content_type, size):
            self.files[key] = body.read()

        def read(self, key, byte_range):
            if self.fail_archive and key.startswith("generated/"):
                self.fail_archive = False
                raise OSError("storage temporarily unavailable")
            return BytesIO(self.files[key])

    store = Store()
    app.dependency_overrides[get_storage] = lambda: store
    process(db, identifier, store, gpt_settings)
    assert db.get(CreationOutput, identifier).status == "saving"
    process(db, identifier, store, gpt_settings)
    assert db.get(CreationOutput, identifier).status == "save_failed"
    assert client.post(f"{API}/outputs/{identifier}/retry", headers=headers).status_code == 200
    process(db, identifier, store, gpt_settings)
    assert db.get(CreationOutput, identifier).status == expected
    assert len(calls) == 1
    if expected == "pending_review":
        outcome = client.post(f"{API}/assets/{identifier}/review", headers=headers, json={
            "decision": "approved", "version": 1,
        })
        assert outcome.status_code == 200, outcome.text
        position = next(item for item in task["positions"] if item["product_id"] == product["id"])
        receipt = client.get(f"{API}/delivery-positions/{position['id']}/adoption").json()
        assert client.get(receipt["download"]).content == image
    else:
        state = client.get(f"{API}/executions/{job['id']}").json()["outputs"][0]
        assert state["error"] == "result_size_mismatch"
        assert state["result_size"] == "1254x1536"
        assert client.post(f"{API}/outputs/{identifier}/retry", headers=headers).status_code == 409
