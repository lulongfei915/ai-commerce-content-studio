from io import BytesIO

from PIL import Image
from sqlalchemy import func, select

from app.adapters.ark_image import ArkImageClient, ImageGenerationResponse
from app.modules.execution import runner
from app.modules.execution.models import Execution
from app.shared.config import get_settings

from ..module02.test_files import MemoryStorage
from ..module03.test_production_setup import API, create_product
from ..module05.test_canvas import create_draft, setup_task


def test_five_batch_images_use_the_same_text_only_generation_as_quick(client, db, monkeypatch):
    headers, _, _, _ = setup_task(client, db)
    product = create_product(client, headers["X-CSRF-Token"], "BATCH-TEXT-ONLY")
    task_response = client.post(
        f"{API}/tasks", headers=headers,
        json={"product_ids": [product["id"]], "contents": ["main", "detail"]},
    )
    assert task_response.status_code == 201, task_response.text
    task = task_response.json()
    prompt = "柔和的棚拍光线，白色背景"
    quick = create_draft(client, headers, task, product, entry="quick", prompt=prompt)
    settings = get_settings()
    monkeypatch.setattr(settings, "image_budget_cents", 6)
    monkeypatch.setattr(settings, "image_ceiling_cents", 1)
    quick_job = client.post(
        f"{API}/creations/{quick['id']}/executions", headers=headers,
        json={"expected_version": quick["version"], "idempotency_key": "quick-text"},
    )
    assert quick_job.status_code == 202, quick_job.text
    drafts = [
        create_draft(
            client, headers, task, product, entry="batch", purpose=purpose,
            primary=False, prompt=prompt,
        )
        for purpose in ("main", "detail", "main", "detail", "detail")
    ]
    response = client.post(
        f"{API}/tasks/{task['id']}/batches/image/executions", headers=headers,
        json={
            "idempotency_key": "five-text-images",
            "items": [{"id": row["id"], "expected_version": row["version"]} for row in drafts],
        },
    )
    assert response.status_code == 202, response.text
    batch = response.json()
    assert [row["item_id"] for row in batch] == [draft["id"] for draft in drafts]
    jobs = [quick_job.json(), *(row["execution"] for row in batch)]
    assert len({job["id"] for job in jobs}) == 6
    assert all(len(job["outputs"]) == 1 for job in jobs)
    assert all(job["outputs"][0]["status"] == "queued" for job in jobs)

    requests = []

    def generate(_, request):
        requests.append(request.to_payload())
        return ImageGenerationResponse.model_validate(
            {"data": [{"url": "https://example.test/result.png"}]}
        )

    size = db.get_one(Execution, jobs[0]["id"]).snapshot["size"]
    png = BytesIO()
    Image.new("RGB", tuple(map(int, size.split("x")))).save(png, "PNG")
    monkeypatch.setattr(ArkImageClient, "generate", generate)
    monkeypatch.setattr(runner, "download", lambda *_: png.getvalue())
    storage = MemoryStorage({})
    for job in jobs:
        output = job["outputs"][0]["id"]
        runner.process(db, output, storage, settings)
        runner.process(db, output, storage, settings)

    assert len(requests) == 6
    assert requests[0]["prompt"] == prompt
    assert "image" not in requests[0]
    assert requests == [requests[0]] * 6
    results = client.get(f"{API}/tasks/{task['id']}/results").json()
    assert {row["version_id"] for row in results} == {job["outputs"][0]["id"] for job in jobs}
    assert all(row["status"] == "pending_review" for row in results)
    assert len(storage.objects) == 6


def test_batch_is_atomic_idempotent_and_freezes_each_output(client, db, monkeypatch):
    headers, red, blue, task = setup_task(client, db)
    base = f"{API}/tasks/{task['id']}/batches/image"
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
    assert failed.json()["detail"] == {
        "item_id": drafts[2]["id"], "code": "prompt_required", "field": "prompt",
    }
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
    assert db.get_one(Execution, jobs[0]["execution"]["id"]).snapshot["product_photos"] == []
    assert db.get(Execution, jobs[-1]["execution"]["id"]).snapshot["draft"]["prompt"] == "独立配置"
    record_url = f"{base}/executions/{jobs[-1]['execution']['id']}/record"
    record = client.get(record_url)
    assert record.status_code == 200, record.text
    assert record.json()["inputs"]["draft"]["id"] == drafts[2]["id"]
    assert record.json()["inputs"]["draft"]["prompt"] == "独立配置"
    assert record.json()["execution"] == jobs[-1]["execution"]
    assert client.get(f"{base}/executions/missing/record").status_code == 404
    assert client.get(record_url.replace("/image/", "/video/")).status_code == 404
    assert client.patch(
        path, headers=headers, json={"expected_version": drafts[2]["version"], "prompt": "覆盖"},
    ).status_code == 409
    monkeypatch.setattr(db, "autoflush", False)
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
    path = f"{API}/creations/{draft['id']}"
    other_photo = blue["photos"][0]
    rejected = client.post(
        f"{path}/references", headers=headers,
        json={
            "expected_version": draft["version"], "kind": "upload", "usage": "product",
            "source_id": other_photo["file_id"], "file_version": other_photo["version"],
        },
    )
    assert rejected.status_code == 422, rejected.text
    assert rejected.json()["detail"]["code"] == "reference_other_sku"
    draft = add_product_photo_reference(client, headers, draft, red["photos"][0])
    assert client.get(f"{path}/input-snapshot").json()["product_photos"] == red["photos"]
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
    assert client.get(f"{path}/readiness").json() == {"issues": []}
    assert client.get(f"{path}/input-snapshot").json()["product_photos"] == []
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
