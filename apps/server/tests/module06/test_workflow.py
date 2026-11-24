from importlib import import_module
from io import BytesIO

from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.adapters.ark_image import ArkImageClient, ImageGenerationResponse
from app.main import app
from app.modules.assets.routes import get_storage
from app.modules.commerce.models import ModelCall
from app.shared.config import get_settings

from ..module03.test_production_setup import API
from ..module05.test_canvas import create_draft, setup_task


def test_worker_archives_once_and_delivery_checks_approval(
    client: TestClient, db: Session, monkeypatch
) -> None:
    headers, product, _, task = setup_task(client, db)
    draft = create_draft(client, headers, task, product)
    settings = get_settings()
    monkeypatch.setattr(settings, "image_budget_cents", 10)
    monkeypatch.setattr(settings, "image_ceiling_cents", 10)
    monkeypatch.setattr(settings, "assistance_ceiling_cents", 5)
    path = f"{API}/creations/{draft['id']}/executions"
    job = client.post(path, headers=headers, json={"expected_version": 1, "idempotency_key": "run"})
    identifier = job.json()["outputs"][0]["id"]
    assert client.get(f"{API}/reviews").status_code == 200
    from app.modules.execution import runner

    png = BytesIO()
    Image.new("RGB", (1024, 1024), "red").save(png, format="PNG")
    files = {"sample-red-canvas": png.getvalue()}

    class Store:
        def put(self, key, body, content_type, size):
            if key not in files:
                files[key] = b""
                raise OSError("simulated archive interruption")
            files[key] = body.read()

        def read(self, key, byte_range):
            return BytesIO(files[key])

    calls = []

    def generate(self, request):
        calls.append(request)
        return ImageGenerationResponse.model_validate(
            {"data": [{"url": "https://example.test/one.png"}], "request_id": "test-request"}
        )

    monkeypatch.setattr(ArkImageClient, "generate", generate)
    monkeypatch.setattr(runner, "download", lambda *_: png.getvalue())
    app.dependency_overrides[get_storage] = Store
    runner.process(db, identifier, Store(), settings)
    runner.process(db, identifier, Store(), settings)
    assert (
        client.get(f"{API}/executions/{job.json()['id']}").json()["outputs"][0]["status"]
        == "save_failed"
    )
    retry = client.post(f"{API}/outputs/{identifier}/retry", headers=headers)
    assert retry.json()["outputs"][0]["status"] == "saving"
    runner.process(db, identifier, Store(), settings)
    assert len(calls) == 1
    assert calls[0].image[0].startswith("data:image/png;base64,")
    result = client.get(f"{API}/tasks/{task['id']}/results").json()[0]
    assert result["status"] == "pending_review"
    assert [item["version_id"] for item in client.get(f"{API}/reviews").json()] == [identifier]
    assert db.scalar(select(ModelCall.id)) is None
    pos = next(
        p for p in task["positions"] if p["product_id"] == product["id"] and p["purpose"] == "main"
    )
    adopt = f"{API}/delivery-positions/{pos['id']}/adoption"
    assert client.put(adopt, headers=headers, json={"version_id": identifier}).status_code == 409
    review = f"{API}/assets/{identifier}/review"
    decision = {"version": 1, "decision": "approved"}
    assert client.post(review, headers=headers, json=decision).status_code == 200
    assert client.post(review, headers=headers, json=decision).status_code == 409
    receipt = client.put(adopt, headers=headers, json={"version_id": identifier}).json()
    assert client.get(receipt["download"]).content == png.getvalue()
    assert client.delete(adopt, headers=headers).status_code == 204
    assert client.get(receipt["download"]).status_code == 409
    second = client.put(adopt, headers=headers, json={"version_id": identifier}).json()
    assert second["download"] != receipt["download"]
    revoked = client.post(
        f"{API}/assets/{identifier}/revoke",
        headers=headers,
        json={"version": 1, "reason": "标签需重新核对"},
    )
    assert revoked.status_code == 200
    assert client.get(second["download"]).status_code == 409


def test_assistance_binds_draft_version_and_undo(client: TestClient, db: Session, monkeypatch):
    headers, product, _, task = setup_task(client, db)
    draft = create_draft(client, headers, task, product)
    cards = client.get(f"{API}/prompt-cards")
    assert cards.status_code == 200
    from app.modules.prompt_assist import routes

    monkeypatch.setattr(routes, "suggest", lambda *_: ("棚拍建议", "request-1", {}))
    settings = get_settings()
    monkeypatch.setattr(settings, "image_budget_cents", 10)
    monkeypatch.setattr(settings, "assistance_ceiling_cents", 0)
    source = f"{API}/creations/{draft['id']}/assistances"
    data = {"kind": "optimize", "expected_version": 1}
    rejected = client.post(source, headers=headers, json=data)
    assert rejected.status_code == 402
    assert rejected.json() == {"detail": "budget_not_configured"}
    assert client.get(source).json() == []
    monkeypatch.setattr(settings, "assistance_ceiling_cents", 5)
    response = client.post(source, headers=headers, json=data)
    assert response.status_code == 201, response.text
    item = response.json()
    base = f"{API}/assistances/{item['id']}"
    assert client.post(base + "/apply", headers=headers).json()["prompt"] == "棚拍建议"
    assert client.post(base + "/undo", headers=headers).json()["prompt"] == draft["prompt"]
    assert client.post(base + "/apply", headers=headers).status_code == 409


def test_legacy_archive_remains_reviewable_and_rework_creates_one_child(client, db, monkeypatch):
    from datetime import datetime

    from app.modules.assets.models import PrivateFile
    from app.modules.creation.models import CreationOutput
    from app.modules.execution.models import ImageStep

    headers, product, _, task = setup_task(client, db)
    draft = create_draft(client, headers, task, product, parameters={"count": 3})
    monkeypatch.setattr(get_settings(), "image_ceiling_cents", 1)
    monkeypatch.setattr(get_settings(), "image_budget_cents", 4)
    job = client.post(
        f"{API}/creations/{draft['id']}/executions",
        headers=headers,
        json={"expected_version": 1, "idempotency_key": "pair"},
    ).json()
    parent_id = job["outputs"][1]["id"]
    parent = db.get(CreationOutput, parent_id)
    parent.status = "blocked"
    step = db.get(ImageStep, parent_id)
    step.quality = {"rule": "historical", "reason": "old flag"}
    step.error = "old_error"
    step.lease = datetime.utcnow()
    missing = db.get(CreationOutput, job["outputs"][2]["id"])
    missing.status = "check_error"
    db.add(
        PrivateFile(
            id=parent_id,
            tenant_id="alpha",
            created_by="alice",
            filename="archived.png",
            content_type="image/png",
            size_bytes=1,
            status="ready",
            version=1,
            object_key="archived.png",
            expires_at=datetime.utcnow(),
        )
    )
    db.flush()
    parent.file_id, parent.file_version = parent_id, 1
    db.commit()
    migration = import_module("migrations.versions.0009_manual_review")
    with Operations.context(MigrationContext.configure(db.connection())):
        migration.upgrade()
    db.commit()
    db.refresh(parent)
    db.refresh(step)
    db.refresh(missing)
    assert parent.status == "pending_review"
    assert step.lease is None and step.error is None
    assert step.quality == {"rule": "historical", "reason": "old flag"}
    assert missing.status == "result_unavailable"
    review = f"{API}/assets/{parent_id}/review"
    decision = {"decision": "rejected", "version": 1}
    assert client.post(review, headers=headers, json=decision).status_code == 422
    response = client.post(
        review,
        headers=headers,
        json={
            **decision,
            "reason": "结构不符",
            "regions": [{"x": 0.1, "y": 0.2, "width": 0.2, "height": 0.2, "note": "鞋面"}],
        },
    )
    assert response.status_code == 200
    child = client.post(
        f"{API}/assets/{parent_id}/rework",
        headers=headers,
        json={"expected_version": 1, "idempotency_key": "redo-one"},
    ).json()
    assert len(child["outputs"]) == 1
    version = db.get(CreationOutput, child["outputs"][0]["id"])
    assert (version.status, version.asset_id, version.version, version.output_index) == (
        "queued",
        parent.asset_id,
        2,
        1,
    )
    assert db.get(CreationOutput, job["outputs"][0]["id"]).status == "queued"
