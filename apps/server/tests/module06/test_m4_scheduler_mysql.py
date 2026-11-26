"""Exercise two tenants and competing workers with MySQL row locks."""

import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event, Lock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.adapters.ark_image import ArkImageClient, ImageGenerationResponse
from app.entrypoints import scheduler
from app.main import app
from app.modules.creation.models import CreationOutput
from app.modules.execution import runner
from app.modules.identity.models import Membership, Tenant, User
from app.modules.identity.security import get_login_limiter
from app.modules.identity.service import hash_password
from app.shared.config import Settings, get_settings
from app.shared.db import get_db

from ..module02.conftest import ORIGIN, PASSWORD
from ..module03.test_production_setup import API, create_product
from ..module05.test_canvas import create_draft


@pytest.mark.skipif(not os.getenv("STUDIO_M4_MYSQL"), reason="requires a scratch MySQL database")
def test_two_tenants_share_worker_capacity_and_do_not_resend(monkeypatch):
    url = os.environ["STUDIO_M4_MYSQL"]
    assert url.rsplit("/", 1)[-1].startswith("studio_m4_")
    engine = create_engine(url)
    sessions = sessionmaker(engine, expire_on_commit=False, autoflush=False)
    settings = Settings(
        _env_file=None, image_ceiling_cents=1, image_budget_cents=10,
        image_budget_unlimited=False, image_tenant_slots=1, image_provider_slots=2,
    )
    marker = uuid4().hex[:9]
    tenants = [f"{letter}-{marker}" for letter in ("a", "b")]
    with sessions.begin() as db:
        for tenant in tenants:
            db.add(Tenant(id=tenant, slug=tenant, name=tenant))
            db.add(User(id=tenant, email=f"{tenant}@example.test",
                        password_hash=hash_password(PASSWORD)))
        db.flush()
        db.add_all(Membership(tenant_id=t, user_id=t, role="admin") for t in tenants)

    def database():
        with sessions() as db:
            yield db

    monkeypatch.setitem(app.dependency_overrides, get_db, database)
    monkeypatch.setitem(app.dependency_overrides, get_login_limiter, lambda: lambda *_: None)
    monkeypatch.setitem(app.dependency_overrides, get_settings, lambda: settings)
    ids: list[list[str]] = []
    for tenant in tenants:
        outputs = []
        ids.append(outputs)
        with TestClient(app) as client:
            auth = client.post(f"{API}/sessions", json={
                "tenant_slug": tenant, "email": f"{tenant}@example.test", "password": PASSWORD,
            }, headers={"Origin": ORIGIN, "X-Studio-Login": "1"})
            assert auth.status_code == 201, auth.text
            token = auth.json()["csrf_token"]
            headers = {"Origin": ORIGIN, "X-CSRF-Token": token}
            sku = create_product(client, token, tenant)
            response = client.post(f"{API}/tasks", headers=headers, json={
                "product_ids": [sku["id"]], "contents": ["main"],
            })
            assert response.status_code == 201, response.text
            for ordinal in range(2):
                draft = create_draft(
                    client, headers, response.json(), sku,
                    entry="quick", primary=False, prompt=f"{tenant} {ordinal}",
                )
                result = client.post(f"{API}/creations/{draft['id']}/executions", headers=headers,
                                     json={"expected_version": 1, "idempotency_key": str(ordinal)})
                assert result.status_code == 202, result.text
                outputs.append(result.json()["outputs"][0]["id"])
    queue = []
    monkeypatch.setattr(scheduler, "SessionLocal", sessions)
    monkeypatch.setattr(scheduler.celery_app, "send_task",
                        lambda _, args, **options: queue.append(args[0]))
    scheduler.dispatch()
    a, b = ids
    ours = {item for tenant in ids for item in tenant}
    assert [item for item in queue if item in ours] == [a[0], b[0], a[1], b[1]]

    calls = []
    seen = Lock()
    active = Barrier(3)
    release = Event()

    def generate(_, request):
        with seen:
            calls.append(request.prompt)
            ordinal = len(calls)
        if ordinal <= 2:
            active.wait(timeout=8)
            assert release.wait(timeout=8)
        return ImageGenerationResponse.model_validate({
            "request_id": f"m4-simulated-{ordinal}",
            "data": [{"url": "https://provider.example/result.png"}],
        })

    def work(identifier):
        with sessions() as db:
            runner.process(db, identifier, None, settings)

    def status(identifier):
        with sessions() as db:
            return db.get_one(CreationOutput, identifier).status

    monkeypatch.setattr(ArkImageClient, "generate", generate)
    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            spending = [pool.submit(work, row[0]) for row in ids]
            try:
                active.wait(timeout=8)
                checks = [pool.submit(work, identifier) for identifier in (a[1], b[1], a[0])]
                for check in checks:
                    check.result(timeout=5)
                assert [status(identifier) for identifier in [a[0], b[0], a[1], b[1]]] == [
                    "generating", "generating", "queued", "queued",
                ]
                assert len(calls) == 2
            finally:
                release.set()
            for future in spending:
                future.result(timeout=8)
            for future in [pool.submit(work, row[1]) for row in ids]:
                future.result(timeout=8)
        assert sorted(calls) == sorted(f"{tenant} {ordinal}" for tenant in tenants
                                      for ordinal in range(2))
    finally:
        engine.dispose()
