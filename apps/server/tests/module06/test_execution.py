from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.adapters.ark_image import ArkImageClient, ImageGenerationResponse
from app.modules.assets.models import PrivateFile
from app.modules.execution import runner
from app.modules.execution.models import Execution
from app.shared.config import get_settings

from ..module03.test_production_setup import API, create_product
from ..module05.test_canvas import create_draft, setup_task


def test_quick_image_without_product_inputs_reaches_provider_as_text(client, db, monkeypatch):
    headers, _, _, _ = setup_task(client, db)
    product = create_product(client, headers["X-CSRF-Token"], "TEXT-ONLY")
    response = client.post(
        f"{API}/tasks",
        headers=headers,
        json={"product_ids": [product["id"]], "contents": ["main"]},
    )
    assert response.status_code == 201, response.text
    task = response.json()
    prompt = "生成一只猫"
    draft = create_draft(client, headers, task, product, entry="quick", prompt=prompt)
    path = f"{API}/creations/{draft['id']}"
    assert client.get(path + "/readiness").json() == {"issues": []}
    assert client.get(path + "/input-snapshot").json()["product_photos"] == []

    settings = get_settings()
    monkeypatch.setattr(settings, "image_budget_cents", 2)
    monkeypatch.setattr(settings, "image_ceiling_cents", 1)
    response = client.post(
        path + "/executions",
        headers=headers,
        json={"expected_version": 1, "idempotency_key": "text"},
    )
    assert response.status_code == 202, response.text
    job = response.json()
    assert job["outputs"][0]["status"] == "queued"
    requests = []

    def generate(_, request):
        requests.append(request.to_payload())
        return ImageGenerationResponse.model_validate(
            {"data": [{"url": "https://example.test/cat.png"}]}
        )

    monkeypatch.setattr(ArkImageClient, "generate", generate)
    runner.process(db, job["outputs"][0]["id"], None, settings)
    assert len(requests) == 1
    assert requests[0]["prompt"] == prompt
    assert "image" not in requests[0]

    canvas = create_draft(client, headers, task, product, prompt=prompt)
    rejected = client.post(
        f"{API}/creations/{canvas['id']}/executions",
        headers=headers,
        json={"expected_version": 1, "idempotency_key": "canvas"},
    )
    assert rejected.status_code == 422
    assert rejected.json()["detail"]["code"] == "product_inputs_incomplete"


def test_quick_image_with_incomplete_facts_keeps_valid_product_photo(client, db, monkeypatch):
    headers, _, product, task = setup_task(client, db)
    draft = create_draft(client, headers, task, product, entry="quick")
    monkeypatch.setattr(get_settings(), "image_budget_cents", 2)
    monkeypatch.setattr(get_settings(), "image_ceiling_cents", 1)
    path = f"{API}/creations/{draft['id']}/executions"
    data = {"expected_version": 1, "idempotency_key": "photo"}
    response = client.post(path, headers=headers, json=data)
    assert response.status_code == 202, response.text
    job = db.get(Execution, response.json()["id"])
    assert job.snapshot["product_photos"] == product["photos"]
    assert job.snapshot["product_fact_version"] == product["fact_version"]

    photo = db.get(PrivateFile, "blue-canvas")
    assert photo is not None
    photo.status = "inactive"
    db.commit()
    rejected = client.post(path, headers=headers, json={**data, "idempotency_key": "inactive"})
    assert rejected.status_code == 422
    assert rejected.json()["detail"]["fields"] == ["product_photo_invalid"]


def test_idempotent_submission_reserves_budget_and_cancel_releases_it(
    client: TestClient, db: Session, monkeypatch
) -> None:
    headers, product, _, task = setup_task(client, db)
    draft = create_draft(client, headers, task, product)
    path = f"{API}/creations/{draft['id']}/executions"
    body = {"expected_version": draft["version"], "idempotency_key": "first-click"}
    settings = get_settings()
    for budget, ceiling in ((0, 0), (5, 0), (0, 5)):
        monkeypatch.setattr(settings, "image_budget_cents", budget)
        monkeypatch.setattr(settings, "image_ceiling_cents", ceiling)
        rejected = client.post(path, headers=headers, json=body)
        assert rejected.status_code == 402
        assert rejected.json() == {"detail": "budget_not_configured"}
    assert client.get(path).json() == []
    monkeypatch.setattr(settings, "image_budget_cents", 5)
    monkeypatch.setattr(settings, "image_ceiling_cents", 5)
    first = client.post(path, headers=headers, json=body)
    assert first.status_code == 202, first.text
    job = first.json()
    assert job["outputs"][0]["status"] == "queued"
    assert client.post(path, headers=headers, json=body).json() == job
    another = {**body, "idempotency_key": "another"}
    rejected = client.post(path, headers=headers, json=another)
    assert rejected.status_code == 402
    assert rejected.json() == {"detail": "budget_unavailable"}
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


def test_unlimited_images_still_reserve_and_can_retry(client, db, monkeypatch):
    from app.modules.creation.models import CreationOutput
    from app.modules.execution.models import ImageStep

    headers, product, _, task = setup_task(client, db)
    draft = create_draft(client, headers, task, product, entry="quick")
    settings = get_settings()
    monkeypatch.setattr(settings, "image_budget_unlimited", True)
    monkeypatch.setattr(settings, "image_budget_cents", 0)
    monkeypatch.setattr(settings, "image_ceiling_cents", 0)
    path = f"{API}/creations/{draft['id']}"
    body = {"expected_version": draft["version"], "idempotency_key": "unlimited"}
    rejected = client.post(path + "/executions", headers=headers, json=body)
    assert rejected.json() == {"detail": "budget_not_configured"}

    monkeypatch.setattr(settings, "image_ceiling_cents", 18)
    response = client.post(path + "/executions", headers=headers, json=body)
    assert response.status_code == 202, response.text
    item = response.json()["outputs"][0]
    assert (item["status"], item["reserved_cents"], item["fee_state"]) == ("queued", 18, "reserved")

    output = db.get(CreationOutput, item["id"])
    step = db.get(ImageStep, item["id"])
    output.status, step.actual_cents, step.fee_state = "generation_failed", 0, "released"
    db.commit()
    retry = client.post(f"{API}/outputs/{output.id}/retry", headers=headers)
    assert retry.status_code == 200, retry.text
    assert retry.json()["outputs"][0] == item

    monkeypatch.setattr(settings, "assistance_ceiling_cents", 1)
    assistance = client.post(
        path + "/assistances",
        headers=headers,
        json={"kind": "optimize", "expected_version": draft["version"]},
    )
    assert assistance.json() == {"detail": "budget_not_configured"}
