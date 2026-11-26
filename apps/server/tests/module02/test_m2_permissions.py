from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import app
from app.modules.assets.routes import get_storage
from app.modules.execution.models import ImageStep
from app.modules.products.models import Product
from app.modules.tasks.models import Task
from app.shared.config import get_settings

from ..module03.test_production_setup import API, photo
from ..module05.test_canvas import create_draft, setup_task
from .conftest import login


def test_four_roles_use_actual_business_actions(client, db, monkeypatch):
    app.dependency_overrides[get_storage] = object
    headers, product, _, task = setup_task(client, db)
    draft = create_draft(client, headers, task, product)
    settings = get_settings()
    monkeypatch.setattr(settings, "image_budget_cents", 10)
    monkeypatch.setattr(settings, "image_ceiling_cents", 1)
    pos = next(p for p in task["positions"] if p["product_id"] == product["id"])
    task_path = f"{API}/tasks/{task['id']}"
    paths = {
        "manage": ("GET", f"{API}/company/members", None, 200),
        "create": ("POST", f"{API}/creations/{draft['id']}/executions", {
            "expected_version": 1, "idempotency_key": "permissions",
        }, 202),
        "review": ("POST", f"{API}/assets/absent/review", {
            "version": 1, "decision": "approved",
        }, 404),
        "adopt": ("PUT", f"{API}/delivery-positions/{pos['id']}/adoption", {
            "version_id": "absent",
        }, 404),
        "download": ("GET", f"{task_path}/delivery-package", None, 409),
    }
    for user, grants in [
        ("alice", set(paths)),
        ("dina", {"create", "adopt", "download"}),
        ("rene", {"review", "download"}),
        ("vern", set()),
        ("denied", {"create", "adopt"}),
    ]:
        csrf = login(client, user)
        for action, (method, path, data, allowed) in paths.items():
            if action == "create":
                data = {**data, "idempotency_key": f"permissions-{user}"}
            response = client.request(method, path, headers={"X-CSRF-Token": csrf}, json=data)
            assert response.status_code == (allowed if action in grants else 403), (
                user, action, response.text,
            )
        assert client.get(task_path).status_code == 200


def test_handover_keeps_assets_and_rejects_old_session(
    client: TestClient, db: Session, monkeypatch,
):
    from app.modules.assets.models import PrivateFile
    from app.modules.creation.models import CreationOutput

    headers, product, _, task = setup_task(client, db)
    draft = create_draft(client, headers, task, product)
    task_row = db.get_one(Task, task["id"])
    product_row = db.get_one(Product, product["id"])
    task_row.owner_id = product_row.owner_id = "rene"
    db.commit()
    settings = get_settings()
    monkeypatch.setattr(settings, "image_budget_cents", 10)
    monkeypatch.setattr(settings, "image_ceiling_cents", 1)
    result = client.post(
        f"{API}/creations/{draft['id']}/executions", headers=headers,
        json={"expected_version": 1, "idempotency_key": "handover"},
    )
    identifier = result.json()["outputs"][0]["id"]
    photo(db, "handover-file", "alpha", "alice")
    item = db.get_one(CreationOutput, identifier)
    file = db.get_one(PrivateFile, "handover-file")
    item.status, item.file_id, item.file_version = "pending_review", file.id, file.version
    db.commit()
    review_path = f"{API}/assets/{identifier}/review"
    with TestClient(app) as previous:
        reviewer = {"X-CSRF-Token": login(previous, "rene")}
        assert previous.post(
            review_path, headers=reviewer, json={"version": 1, "decision": "approved"},
        ).status_code == 200
        assets = client.get(f"{API}/assets").json()
        quality_path = f"{API}/assets/{identifier}/quality"
        assert db.get_one(ImageStep, identifier).decision["user_id"] == "rene"
        response = client.post(
            f"{API}/company/members/rene/disable", headers=headers,
            json={"expected_version": 1, "successor": "dina"},
        )
        assert response.status_code == 204, response.text
        assert previous.get(f"{API}/assets").status_code == 401
        assert previous.post(
            review_path, headers=reviewer, json={"version": 1, "decision": "approved"},
        ).status_code == 401
    db.refresh(task_row)
    db.refresh(product_row)
    assert task_row.owner_id == product_row.owner_id == "dina"
    assert task_row.created_by == product_row.created_by == "alice"
    assert client.get(f"{API}/assets").json() == assets
    assert client.get(quality_path).json()["decision"]["user_id"] == "rene"
    actions = {item["action"] for item in client.get(f"{API}/company/records").json()}
    assert {"提交图片生成", "批准素材", "停用并交接"} <= actions
