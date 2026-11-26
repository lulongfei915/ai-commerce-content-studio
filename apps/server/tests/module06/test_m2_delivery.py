import json
from io import BytesIO
from zipfile import ZipFile

from app.main import app
from app.modules.assets.models import PrivateFile
from app.modules.assets.routes import get_storage
from app.modules.creation.models import CreationOutput
from app.shared.config import get_settings

from ..module03.test_production_setup import API, photo
from ..module05.test_canvas import create_draft, setup_task


def test_module_spec_matching_reservation_and_partial_package(client, db, monkeypatch):
    headers, red, _, task = setup_task(client, db)
    base = f"{API}/tasks/{task['id']}"
    rows = [
        {"purpose": "main", "module": "商品主图", "count": 2},
        {"purpose": "detail", "module": "鞋面", "count": 1, "ratio": "1:1", "resolution": "1K"},
        {"purpose": "detail", "module": "鞋底", "count": 1, "ratio": "1:1", "resolution": "1K"},
        {"purpose": "video", "module": "带货视频", "count": 1},
    ]
    rows = [{**row, "product_id": red["id"]} for row in rows]
    response = client.put(
        f"{base}/requirements", headers=headers,
        json={"expected_version": task["version"], "rows": rows},
    )
    task = response.json()
    assert response.status_code == 200 and len(task["positions"]) == 5
    upper, sole = [
        next(p for p in task["positions"] if p["module"] == name)
        for name in ("鞋面", "鞋底")
    ]
    draft = create_draft(client, headers, task, red, purpose="detail")
    settings = get_settings()
    monkeypatch.setattr(settings, "image_budget_cents", 10)
    monkeypatch.setattr(settings, "image_ceiling_cents", 1)
    path = f"{API}/creations/{draft['id']}/executions"
    payload = {"expected_version": 1, "idempotency_key": "upper", "position_id": upper["id"]}
    accepted = client.post(path, headers=headers, json=payload)
    assert accepted.status_code == 202, accepted.text
    assert client.post(path, headers=headers, json=payload).json() == accepted.json()
    duplicate = client.post(
        path, headers=headers, json={**payload, "idempotency_key": "duplicate"},
    )
    assert duplicate.status_code == 409

    body = b"archived PNG fixture"
    photo(db, "upper-archive", "alpha", "alice")
    file = db.get(PrivateFile, "upper-archive")
    file.width = file.height = 1024
    file.size_bytes = len(body)
    output_id = accepted.json()["outputs"][0]["id"]
    output = db.get(CreationOutput, output_id)
    output.status, output.file_id, output.file_version = "pending_review", file.id, file.version
    db.commit()

    class Store:
        def read(self, key, byte_range):
            assert key == file.object_key
            return BytesIO(body)

    app.dependency_overrides[get_storage] = Store
    approved = client.post(
        f"{API}/assets/{output_id}/review", headers=headers,
        json={"decision": "approved", "version": 1},
    )
    assert approved.status_code == 200
    upper_url = f"{API}/delivery-positions/{upper['id']}/adoption"
    receipt = client.get(upper_url).json()
    assert receipt["version_id"] == output_id
    assert client.put(
        f"{API}/delivery-positions/{sole['id']}/adoption",
        headers=headers, json={"version_id": output_id},
    ).status_code == 409
    asset = client.get(f"{API}/assets?task_id={task['id']}").json()[0]
    assert asset["matching_positions"] == [upper["id"]]
    package = client.get(f"{base}/delivery-package")
    assert package.status_code == 200
    with ZipFile(BytesIO(package.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert len(manifest) == 5
        adopted = [row for row in manifest if "file" in row]
        assert len(adopted) == 1
        assert archive.read(adopted[0]["file"]) == body
        assert set(archive.namelist()) == {"manifest.json", adopted[0]["file"]}

    image_only = client.put(
        f"{base}/requirements", headers=headers,
        json={"expected_version": task["version"], "rows": [rows[1]]},
    )
    assert image_only.status_code == 200, image_only.text
    task = image_only.json()
    complete = client.get(f"{base}/delivery-package")
    assert complete.status_code == 200
    with ZipFile(BytesIO(complete.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert len(manifest) == 1 and manifest[0]["status"] == "可交付"
        assert archive.read(manifest[0]["file"]) == body
        assert archive.testzip() is None

    rows[1]["ratio"], rows[1]["resolution"] = "4:3", "2K"
    edit = {"expected_version": task["version"], "rows": [rows[1]]}
    assert client.post(f"{base}/requirements/preview", headers=headers, json=edit).json() == {
        "removed": 1,
    }
    assert client.put(f"{base}/requirements", headers=headers, json=edit).status_code == 200
    assert client.get(upper_url).json() is None
    assert client.get(receipt["download"]).status_code == 409
    assert db.get(CreationOutput, output_id).file_id == "upper-archive"


def test_two_sku_delivery_plan_expands_to_twelve_positions(client, db):
    headers, red, blue, task = setup_task(client, db)
    rows = [
        {"product_id": product["id"], "purpose": purpose, "module": module, "count": count}
        for product in (red, blue)
        for purpose, module, count in (
            ("main", "商品主图", 2), ("detail", "细节", 3), ("video", "带货视频", 1),
        )
    ]
    response = client.put(
        f"{API}/tasks/{task['id']}/requirements", headers=headers,
        json={"expected_version": task["version"], "rows": rows},
    )
    assert response.status_code == 200
    positions = response.json()["positions"]
    assert len({p["id"] for p in positions}) == 12
    assert sum(p["purpose"] == "video" for p in positions) == 2
