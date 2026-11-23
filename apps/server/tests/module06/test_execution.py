from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.shared.config import get_settings

from ..module03.test_production_setup import API
from ..module05.test_canvas import create_draft, setup_task


def test_idempotent_submission_reserves_budget_and_cancel_releases_it(
    client: TestClient, db: Session, monkeypatch
) -> None:
    headers, product, _, task = setup_task(client, db)
    draft = create_draft(client, headers, task, product)
    path = f"{API}/creations/{draft['id']}/executions"
    body = {"expected_version": draft["version"], "idempotency_key": "first-click"}
    assert client.post(path, headers=headers, json=body).status_code == 402
    monkeypatch.setattr(get_settings(), "image_budget_cents", 5)
    monkeypatch.setattr(get_settings(), "image_ceiling_cents", 5)
    first = client.post(path, headers=headers, json=body)
    assert first.status_code == 202, first.text
    job = first.json()
    assert job["outputs"][0]["status"] == "queued"
    assert client.post(path, headers=headers, json=body).json() == job
    another = {**body, "idempotency_key": "another"}
    assert client.post(path, headers=headers, json=another).status_code == 402
    cancelled = client.post(f"{API}/executions/{job['id']}/cancel", headers=headers)
    assert cancelled.json()["outputs"][0]["status"] == "cancelled"
    assert client.post(path, headers=headers, json=another).status_code == 202


def test_lost_worker_moves_to_unknown_and_requires_reconciliation(client, db, monkeypatch):
    from app.modules.creation.models import CreationOutput
    from app.modules.execution.runner import process

    headers, product, _, task = setup_task(client, db)
    draft = create_draft(client, headers, task, product)
    settings = get_settings()
    monkeypatch.setattr(settings, "image_budget_cents", 10)
    monkeypatch.setattr(settings, "image_ceiling_cents", 10)
    job = client.post(
        f"{API}/creations/{draft['id']}/executions",
        headers=headers,
        json={"expected_version": 1, "idempotency_key": "crash"},
    ).json()
    identifier = job["outputs"][0]["id"]
    output = db.get(CreationOutput, identifier)
    output.status = "generating"
    db.commit()
    process(db, identifier, None, settings)
    assert output.status == "unknown"
    path = f"{API}/outputs/{identifier}"
    assert client.post(path + "/retry", headers=headers).status_code == 409
    evidence = {
        "outcome": "not_accepted",
        "actual_cents": 0,
        "provider_id": "test-original",
        "evidence": "测试账单核对，原请求未受理",
    }
    r = client.post(path + "/reconcile", headers=headers, json=evidence)
    assert r.status_code == 200, r.text
    assert client.post(path + "/reconcile", headers=headers, json=evidence).status_code == 409
    assert client.post(path + "/retry", headers=headers).json()["outputs"][0]["status"] == "queued"
