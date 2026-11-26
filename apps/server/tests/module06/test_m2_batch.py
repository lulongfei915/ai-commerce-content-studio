from sqlalchemy import func, select

from app.modules.execution.models import Execution
from app.shared.config import get_settings

from ..module03.test_production_setup import API
from ..module05.test_canvas import create_draft, setup_task


def test_batch_is_atomic_idempotent_and_freezes_each_output(client, db, monkeypatch):
    headers, red, blue, task = setup_task(client, db)
    base = f"{API}/tasks/{task['id']}/batches/image"
    confirmed = client.post(
        f"{API}/products/{blue['id']}/facts", headers=headers,
        json={"expected_version": blue["version"], "facts": red["facts"]},
    )
    assert confirmed.status_code == 201, confirmed.text
    drafts = [
        create_draft(client, headers, task, product, entry="batch", primary=False, **extra)
        for product, extra in (
            (red, {}),
            (blue, {"parameters": {"count": 2}}),
            (red, {"prompt": ""}),
        )
    ]
    settings = get_settings()
    monkeypatch.setattr(settings, "image_budget_cents", 4)
    monkeypatch.setattr(settings, "image_ceiling_cents", 1)
    def payload():
        return {
            "idempotency_key": "first-batch",
            "items": [{"id": row["id"], "expected_version": row["version"]} for row in drafts],
        }

    failed = client.post(f"{base}/executions", headers=headers, json=payload())
    assert failed.status_code == 422, failed.text
    assert failed.json()["detail"]["item_id"] == drafts[2]["id"]
    db.rollback()
    assert db.scalar(select(func.count()).select_from(Execution)) == 0
    path = f"{API}/creations/{drafts[2]['id']}"
    drafts[2] = client.patch(
        path, headers=headers, json={"expected_version": 1, "prompt": "独立配置"},
    ).json()
    accepted = client.post(f"{base}/executions", headers=headers, json=payload())
    assert accepted.status_code == 202, accepted.text
    jobs = accepted.json()
    assert [len(j["execution"]["outputs"]) for j in jobs] == [1, 2, 1]
    assert client.post(f"{base}/executions", headers=headers, json=payload()).json() == jobs
    repeat = {**payload(), "idempotency_key": "another-key"}
    assert client.post(f"{base}/executions", headers=headers, json=repeat).status_code == 409
    assert {j["item_id"] for j in client.get(f"{base}/executions").json()} == {
        row["id"] for row in drafts
    }
    assert len(client.get(f"{API}/tasks/{task['id']}/canvas").json()["nodes"]) == 0
    assert db.get(Execution, jobs[-1]["execution"]["id"]).snapshot["draft"]["prompt"] == "独立配置"
    assert client.patch(
        path, headers=headers, json={"expected_version": drafts[2]["version"], "prompt": "覆盖"},
    ).status_code == 409
    copy = client.post(
        f"{base}/items/{drafts[2]['id']}/copy", headers=headers,
        json={"expected_version": drafts[2]["version"]},
    )
    assert copy.status_code == 201, copy.text
    assert copy.json()["id"] != drafts[2]["id"]
    assert copy.json()["prompt"] == "独立配置"
    assert copy.json()["batch_position_id"] is None
    assert len(client.get(f"{base}/executions").json()) == 3


def test_batch_public_changes_preserve_field_overrides(client, db):
    headers, red, blue, task = setup_task(client, db)
    base = f"{API}/tasks/{task['id']}/batches"
    inherited = create_draft(client, headers, task, red, entry="batch", prompt="")
    manual = create_draft(
        client, headers, task, blue, entry="batch", prompt="单项正文", parameters={"count": 2},
    )
    video = create_draft(client, headers, task, red, entry="batch", purpose="video", prompt="")
    public = client.put(
        f"{base}/image", headers=headers,
        json={"expected_version": 0, "prompt": "公共正文", "count": 3,
              "ratio": "3:4", "resolution": "2K"},
    )
    assert public.status_code == 200, public.text
    read = lambda row: client.get(f"{API}/creations/{row['id']}").json()  # noqa: E731
    assert (read(inherited)["prompt"], read(inherited)["parameters"]["count"]) == ("公共正文", 3)
    assert (read(manual)["prompt"], read(manual)["parameters"]["count"]) == ("单项正文", 2)
    assert read(video)["prompt"] == ""
    assert client.get(f"{base}/image").json()["version"] == 1
    parameters = read(inherited)["parameters"]
    assert (parameters["ratio"], parameters["resolution"]) == ("3:4", "2K")
    current = read(manual)
    result = client.post(
        f"{base}/image/items/{current['id']}/restore", headers=headers,
        json={"expected_version": current["version"], "field": "prompt"},
    )
    assert result.status_code == 200, result.text
    assert (result.json()["prompt"], result.json()["parameters"]["count"]) == ("公共正文", 2)


def test_batch_scope_change_clears_old_sku_references_and_can_restore_defaults(client, db):
    from ..module05.test_canvas import add_product_photo_reference

    headers, red, blue, task = setup_task(client, db)
    draft = create_draft(client, headers, task, red, entry="batch", prompt="手写正文")
    draft = add_product_photo_reference(client, headers, draft, red["photos"][0])
    url = f"{API}/tasks/{task['id']}/batches/image"
    new_position = next(
        p for p in task["positions"] if p["product_id"] == blue["id"] and p["purpose"] == "main"
    )
    item = f"{url}/items/{draft['id']}"
    changed = client.patch(
        item, headers=headers,
        json={"expected_version": draft["version"], "position_id": new_position["id"]},
    )
    assert changed.status_code == 200, changed.text
    current = changed.json()
    assert current["references"] == []
    assert (current["product_id"], current["prompt"]) == (blue["id"], "手写正文")
    assert client.get(f"{API}/creations/{draft['id']}/readiness").json()["issues"]
    assert client.put(
        url, headers=headers, json={"expected_version": 0, "prompt": "默认正文", "count": 2},
    ).status_code == 200
    current = client.get(f"{API}/creations/{draft['id']}").json()
    restored = client.post(
        f"{item}/restore", headers=headers, json={"expected_version": current["version"]},
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["prompt"] == "默认正文"
    assert restored.json()["parameters"]["count"] == 2
    assert client.delete(
        f"{item}?expected_version={restored.json()['version']}", headers=headers,
    ).status_code == 204
    assert client.get(f"{API}/tasks/{task['id']}/creations?entry=batch").json() == []
