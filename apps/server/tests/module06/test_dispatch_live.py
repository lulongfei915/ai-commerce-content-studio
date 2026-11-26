"""Opt-in integration with Redis, a Celery worker and a private MinIO bucket."""

import os
from io import BytesIO
from time import monotonic, sleep
from uuid import uuid4

import pytest
from celery.contrib.testing.worker import start_worker
from fastapi.testclient import TestClient
from PIL import Image
from redis import Redis
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.adapters.ark_image import ArkImageClient, ImageGenerationResponse
from app.adapters.object_storage import S3Storage
from app.entrypoints import scheduler, worker
from app.main import app
from app.modules.assets.routes import get_storage
from app.modules.execution import runner
from app.modules.identity.models import Membership, Tenant, User
from app.modules.identity.security import get_login_limiter
from app.modules.identity.service import hash_password
from app.shared.config import get_settings
from app.shared.db import Base, get_db

from ..module02.conftest import PASSWORD
from ..module03.test_production_setup import API
from ..module05.test_canvas import add_product_photo_reference, create_draft, setup_task


@pytest.mark.skipif(
    not os.environ.get("STUDIO_LIVE_IMAGE_QUEUE"), reason="requires Redis and MinIO"
)
def test_redis_loss_worker_and_private_download(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path}/images.db")
    Base.metadata.create_all(engine)
    sessions = sessionmaker(engine, expire_on_commit=False)
    settings = get_settings()
    if bucket := os.environ.get("STUDIO_LIVE_IMAGE_BUCKET"):
        monkeypatch.setattr(settings, "storage_bucket", bucket)
    marker = uuid4().hex
    queue = f"image-test-{marker}"
    storage = S3Storage(settings)
    png = BytesIO()
    Image.new("RGB", (1024, 1024), "red").save(png, format="PNG")
    generated = png.getvalue()
    broker = Redis.from_url(settings.redis_url)
    sent = []
    archived = []

    def generate(_, payload):
        sent.append(payload)
        return ImageGenerationResponse.model_validate(
            {"request_id": marker, "data": [{"url": "https://provider.example/image.png"}]}
        )

    def get_session():
        with sessions() as session:
            yield session

    monkeypatch.setattr(settings, "image_ceiling_cents", 5)
    monkeypatch.setattr(settings, "image_budget_cents", 40)
    monkeypatch.setattr(settings, "image_budget_unlimited", False)
    monkeypatch.setattr("app.shared.db.SessionLocal", sessions)
    monkeypatch.setattr(scheduler, "SessionLocal", sessions)
    monkeypatch.setattr(ArkImageClient, "generate", generate)
    monkeypatch.setattr(runner, "download", lambda *_: generated)
    real_send = worker.celery_app.send_task
    monkeypatch.setattr(
        worker.celery_app,
        "send_task",
        lambda name, **kwargs: real_send(name, queue=queue, **kwargs),
    )
    monkeypatch.setitem(app.dependency_overrides, get_db, get_session)
    monkeypatch.setitem(app.dependency_overrides, get_login_limiter, lambda: lambda *_: None)
    monkeypatch.setitem(app.dependency_overrides, get_storage, lambda: storage)
    monkeypatch.setattr("app.adapters.object_storage.get_object_storage", lambda: storage)
    source_key = f"fixtures/{marker}/input.png"
    try:
        with sessions() as db, TestClient(app) as client:
            db.add_all(
                [
                    Tenant(id="alpha", slug="alpha", name="Alpha"),
                    User(
                        id="alice",
                        email="alice@example.test",
                        password_hash=hash_password(PASSWORD),
                    ),
                ]
            )
            db.flush()
            db.add(
                Membership(tenant_id="alpha", user_id="alice", role="admin", download_allowed=True)
            )
            db.commit()
            headers, product, _, task = setup_task(client, db)
            from app.modules.assets.models import PrivateFile

            file = db.get(PrivateFile, "red-canvas")
            file.object_key, file.size_bytes = source_key, len(generated)
            db.commit()
            storage.put(source_key, BytesIO(generated), "image/png", len(generated))
            jobs = []
            for entry in ("quick", "canvas"):
                for variant in ("default", "custom"):
                    draft = create_draft(
                        client,
                        headers,
                        task,
                        product,
                        entry=entry,
                        primary=False,
                        prompt=f"检查图片 {variant}",
                        parameters={"ratio": "1:1", "count": 1},
                    )
                    if variant == "custom":
                        draft = add_product_photo_reference(
                            client, headers, draft, product["photos"][0]
                        )
                    result = client.post(
                        f"{API}/creations/{draft['id']}/executions",
                        headers=headers,
                        json={
                            "expected_version": draft["version"],
                            "idempotency_key": f"{entry}-{variant}",
                        },
                    )
                    assert result.status_code == 202, result.text
                    jobs.append(result.json())
            batch_items = [
                add_product_photo_reference(
                    client, headers,
                    create_draft(
                        client, headers, task, product, entry="batch", primary=False,
                        parameters={"count": count},
                    ),
                    product["photos"][0],
                )
                for count in (1, 2, 1)
            ]
            batch = client.post(
                f"{API}/tasks/{task['id']}/batches/image/executions",
                headers=headers,
                json={
                    "idempotency_key": marker,
                    "items": [
                        {"id": item["id"], "expected_version": item["version"]}
                        for item in batch_items
                    ],
                },
            )
            assert batch.status_code == 202, batch.text
            batch_jobs = [row["execution"] for row in batch.json()]
            assert [len(job["outputs"]) for job in batch_jobs] == [1, 2, 1]
            archived.extend(
                f"generated/alpha/{output['id']}.png"
                for job in [*jobs, *batch_jobs] for output in job["outputs"]
            )
            scheduler.dispatch()
            assert broker.llen(queue) == 8
            broker.delete(queue)
            with start_worker(
                worker.celery_app,
                pool="solo",
                queues=[queue],
                perform_ping_check=False,
                shutdown_timeout=15,
            ):
                deadline = monotonic() + 45
                while monotonic() < deadline:
                    scheduler.dispatch()
                    statuses = [
                        output["status"]
                        for job in [*jobs, *batch_jobs]
                        for output in client.get(f"{API}/executions/{job['id']}").json()["outputs"]
                    ]
                    if statuses == ["pending_review"] * 8:
                        break
                    sleep(0.25)
                assert statuses == ["pending_review"] * 8
            pos = next(
                p
                for p in task["positions"]
                if p["product_id"] == product["id"] and p["purpose"] == "main"
            )
            for j in jobs:
                identifier = j["outputs"][0]["id"]
                approved = client.post(
                    f"{API}/assets/{identifier}/review",
                    headers=headers,
                    json={"decision": "approved", "version": 1},
                )
                assert approved.status_code == 200
                receipt = client.put(
                    f"{API}/delivery-positions/{pos['id']}/adoption",
                    headers=headers,
                    json={"version_id": identifier},
                ).json()
                assert client.get(receipt["download"]).content == generated
            assert len(sent) == 8
            assert sum(bool(request.image) for request in sent) == 6
    finally:
        for key in [source_key, *archived]:
            storage.delete(key)
        broker.delete(queue)
        engine.dispose()
