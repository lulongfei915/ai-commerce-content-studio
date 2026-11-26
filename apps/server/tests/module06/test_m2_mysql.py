"""Opt-in acceptance on a migrated scratch MySQL database and private object storage."""

import hashlib
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from io import BytesIO
from threading import Barrier, Event
from time import monotonic, sleep
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.adapters.ark_image import ArkImageClient, ImageGenerationResponse
from app.adapters.object_storage import S3Storage
from app.main import app
from app.modules.assets.models import PrivateFile
from app.modules.assets.routes import get_storage
from app.modules.creation.models import CreationOutput
from app.modules.execution import runner
from app.modules.execution.models import ImageStep
from app.modules.identity.models import Membership, Tenant, User
from app.modules.identity.security import get_login_limiter
from app.modules.identity.service import hash_password
from app.shared.config import get_settings
from app.shared.db import get_db

from ..module02.conftest import ORIGIN, PASSWORD
from ..module03.test_production_setup import API, create_product
from ..module05.test_canvas import create_draft


@pytest.mark.skipif(
    not os.environ.get("STUDIO_M2_MYSQL"), reason="requires scratch MySQL and MinIO"
)
def test_concurrent_delivery_and_batch_workers(monkeypatch):
    engine = create_engine(os.environ["STUDIO_M2_MYSQL"])
    assert engine.url.database and engine.url.database.startswith("studio_m2_")
    sessions = sessionmaker(engine, expire_on_commit=False, autoflush=False)
    settings = get_settings()
    live = os.environ.get("STUDIO_M2_LIVE_PROVIDER") == "1"
    marker = uuid4().hex[:12]
    tenant, user = (f"m2-{marker}", f"m2-user-{marker}")
    email = f"{user}@example.test"
    store = S3Storage(settings)
    png = BytesIO()
    Image.new("RGB", (1024, 1024), "#735343").save(png, format="PNG")
    body = png.getvalue()
    keys = [f"fixtures/{tenant}/{sku}.png" for sku in ("RED", "BLUE")]
    monkeypatch.setattr(settings, "image_tenant_slots", 2)
    monkeypatch.setattr(settings, "image_provider_slots", 2)
    monkeypatch.setattr(settings, "image_budget_unlimited", False)
    monkeypatch.setattr(settings, "image_ceiling_cents", 75 if live else 1)
    monkeypatch.setattr(settings, "image_budget_cents", settings.image_ceiling_cents * 4)

    def db_dependency():
        with sessions() as db:
            yield db

    monkeypatch.setitem(app.dependency_overrides, get_db, db_dependency)
    monkeypatch.setitem(app.dependency_overrides, get_login_limiter, lambda: lambda *_: None)
    monkeypatch.setitem(app.dependency_overrides, get_storage, lambda: store)
    with sessions.begin() as db:
        db.add_all([
            Tenant(id=tenant, slug=tenant, name=tenant),
            User(id=user, email=email, password_hash=hash_password(PASSWORD)),
        ])
        db.flush()
        db.add(Membership(tenant_id=tenant, user_id=user, role="admin", download_allowed=True))
        db.flush()
        for key in keys:
            db.add(PrivateFile(
                id=key.split("/")[-1].replace(".png", f"-{marker}"),
                tenant_id=tenant, created_by=user, status="ready",
                filename="fixture.png", content_type="image/png", size_bytes=len(body),
                version=1, expires_at=datetime.utcnow() + timedelta(days=1),
                object_key=key, width=1024, height=1024,
            ))
            store.put(key, BytesIO(body), "image/png", len(body))

    credentials = {"tenant_slug": tenant, "email": email, "password": PASSWORD}
    generated = []
    calls = []
    entered = Barrier(3)
    release = Event()

    def work(identifier):
        with sessions() as db:
            runner.process(db, identifier, store, settings)

    if not live:
        def generate(_, request):
            calls.append(request)
            ordinal = len(calls)
            if ordinal <= 2:
                entered.wait(timeout=8)
                assert release.wait(timeout=8)
            return ImageGenerationResponse.model_validate({
                "request_id": f"fixture-{ordinal}",
                "data": [{"url": "https://example.test/generated.png"}],
            })

        monkeypatch.setattr(ArkImageClient, "generate", generate)
        monkeypatch.setattr(runner, "download", lambda *_: body)

    try:
        with TestClient(app) as client, ThreadPoolExecutor(max_workers=3) as pool:
            auth = client.post(f"{API}/sessions", json=credentials, headers={
                "Origin": ORIGIN, "X-Studio-Login": "1",
            })
            assert auth.status_code == 201, auth.text
            token = auth.json()["csrf_token"]
            headers = {"X-CSRF-Token": token}
            products = [
                create_product(
                    client, token, sku, photo_ids=[f"{sku}-{marker}"],
                    facts={"specification": {"value": "素色低帮鞋", "evidence": "合成样本"}},
                )
                for sku in ("RED", "BLUE")
            ]
            red, blue = products
            task = client.post(f"{API}/tasks", headers=headers, json={
                "product_ids": [p["id"] for p in products], "contents": ["main", "detail"],
            }).json()
            task_url = f"{API}/tasks/{task['id']}"
            pos = next(
                p for p in task["positions"]
                if p["product_id"] == red["id"] and p["purpose"] == "main"
            )
            draft = create_draft(client, headers, task, red, entry="quick")
            race = Barrier(2)

            def reserve(key):
                race.wait(timeout=5)
                return client.post(
                    f"{API}/creations/{draft['id']}/executions", headers=headers,
                    json={"expected_version": 1, "idempotency_key": key, "position_id": pos["id"]},
                )

            competing = [pool.submit(reserve, f"reserve-{i}") for i in range(2)]
            responses = [future.result(timeout=12) for future in competing]
            assert sorted(response.status_code for response in responses) == [202, 409]
            prior = next(response.json() for response in responses if response.status_code == 202)
            cancelled = client.post(f"{API}/executions/{prior['id']}/cancel", headers=headers)
            assert cancelled.status_code == 200, cancelled.text
            refreshed = client.get(task_url).json()["positions"]
            assert next(p["status"] for p in refreshed if p["id"] == pos["id"]) == "unfilled"
            drafts = [
                create_draft(
                    client, headers, task, sku, entry="batch", primary=False,
                    purpose=purpose, parameters={"count": count},
                    prompt=f"合成测试商品 {sku['sku']}，展示鞋面的轮廓，使用纯白背景",
                )
                for sku, purpose, count in ((red, "main", 1), (blue, "main", 2), (red, "detail", 1))
            ]
            batch_url = f"{task_url}/batches/image/executions"
            submitted = client.post(batch_url, headers=headers, json={
                "idempotency_key": f"batch-{marker}",
                "items": [{"id": row["id"], "expected_version": row["version"]} for row in drafts],
            })
            assert submitted.status_code == 202, submitted.text
            jobs = [row["execution"] for row in submitted.json()]
            first, second, queued, last = [
                output["id"] for job in jobs for output in job["outputs"]
            ]
            generated.extend((first, second, queued, last))

            def status(identifier):
                with sessions() as db:
                    return db.get_one(CreationOutput, identifier).status

            active = [pool.submit(work, identifier) for identifier in (first, second)]
            try:
                if live:
                    deadline = monotonic() + 10
                    while monotonic() < deadline and (
                        status(first), status(second)
                    ) != ("generating", "generating"):
                        sleep(0.025)
                else:
                    entered.wait(timeout=8)
                assert (status(first), status(second)) == ("generating", "generating")
                work(queued)
                assert status(queued) == "queued"
            finally:
                release.set()
            for future in active:
                future.result(timeout=100)
            work(first)
            assert status(first) == "pending_review"
            available = client.get(f"{task_url}/results").json()
            assert [row["version_id"] for row in available] == [first]
            assert status(last) == "queued"

            if not live:
                original = runner.download

                def interrupted(*_):
                    raise OSError("fixture archive interruption")

                with monkeypatch.context() as patch:
                    patch.setattr(runner, "download", interrupted)
                    work(second)
                assert runner.download is original and status(second) == "save_failed"
                retry = client.post(f"{API}/outputs/{second}/retry", headers=headers)
                assert retry.status_code == 200 and status(first) == "pending_review"
            work(second)
            for identifier in (queued, last):
                work(identifier)
                work(identifier)
            assert all(status(identifier) == "pending_review" for identifier in generated)
            if not live:
                assert len(calls) == 4
                approved = client.post(f"{API}/assets/{first}/review", headers=headers, json={
                    "decision": "approved", "version": 1,
                })
                assert approved.status_code == 200, approved.text
                versions = client.get(f"{task_url}/results").json()
                original = next(item for item in versions if item["version_id"] == first)
                preview = client.get(
                    f"{task_url}/results/{first}/preview",
                    params={"source_version": original["version"], "file_version": 1},
                )
                assert preview.status_code == 200
                assert preview.headers["content-type"] == "image/jpeg"
                candidates = client.get(f"{API}/assets", params={"task_id": task["id"]}).json()
                assert [(item["asset_id"], item["version_id"]) for item in candidates] == [
                    (original["asset_id"], first),
                ]
                assert candidates[0]["matching_positions"] == [pos["id"]]
                adoption = client.get(f"{API}/delivery-positions/{pos['id']}/adoption").json()
                assert adoption["version_id"] == first
            assert client.get(f"{task_url}/canvas").json()["nodes"] == []
            with sessions() as db:
                for identifier in generated:
                    step = db.get_one(ImageStep, identifier)
                    with store.read(f"generated/{tenant}/{identifier}.png", None) as archive:
                        content = archive.read()
                    assert Image.open(BytesIO(content)).size == (1024, 1024)
                    print(
                        f"output={identifier} request={step.provider_id} "
                        f"sha256={hashlib.sha256(content).hexdigest()} "
                        f"reserved_cents={step.reserved_cents} fee_state={step.fee_state}"
                    )
    finally:
        for key in [*keys, *(f"generated/{tenant}/{identifier}.png" for identifier in generated)]:
            store.delete(key)
        engine.dispose()
