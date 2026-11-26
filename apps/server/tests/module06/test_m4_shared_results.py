from io import BytesIO

from PIL import Image
from sqlalchemy import func, select

from app.adapters.ark_image import ArkImageClient, ImageGenerationResponse
from app.entrypoints.recovery import provider_inventory
from app.modules.assets.models import PrivateFile
from app.modules.assets.routes import get_storage
from app.modules.creation.models import CreationOutput
from app.modules.execution import runner
from app.shared.config import get_settings

from ..module05.test_canvas import API, create_draft, setup_task


def test_three_entries_share_assets_review_and_delivery_without_extra_calls(
    client, db, monkeypatch,
):
    from app.main import app

    headers, sku, _, task = setup_task(client, db)
    base = f"{API}/tasks/{task['id']}"
    settings = get_settings()
    monkeypatch.setattr(settings, "image_budget_cents", 100)
    monkeypatch.setattr(settings, "image_ceiling_cents", 1)

    png = BytesIO()
    Image.new("RGB", (1024, 1024), "red").save(png, format="PNG")
    body = png.getvalue()
    files = {}
    calls = []

    class Store:
        def put(self, key, stream, mime, size):
            files[key] = stream.read()

        def read(self, key, byte_range):
            return BytesIO(files[key])

    def generate(_, request):
        calls.append(request.prompt)
        return ImageGenerationResponse.model_validate({
            "request_id": f"fixture-{len(calls)}",
            "data": [{"url": "https://example.test/three-entries.png"}],
        })

    store = Store()
    monkeypatch.setitem(app.dependency_overrides, get_storage, lambda: store)
    monkeypatch.setattr(ArkImageClient, "generate", generate)
    monkeypatch.setattr(runner, "download", lambda *_: body)

    entries = {}
    for entry in ("quick", "canvas", "batch"):
        draft = create_draft(client, headers, task, sku, entry=entry, prompt=f"{entry} output")
        if entry == "batch":
            response = client.post(f"{base}/batches/image/executions", headers=headers, json={
                "idempotency_key": entry,
                "items": [{"id": draft["id"], "expected_version": draft["version"]}],
            })
        else:
            response = client.post(
                f"{API}/creations/{draft['id']}/executions", headers=headers,
                json={"expected_version": draft["version"], "idempotency_key": entry},
            )
        assert response.status_code == 202, response.text
        job = response.json()[0]["execution"] if entry == "batch" else response.json()
        identifier = job["outputs"][0]["id"]
        entries[entry] = identifier
        for _ in range(2):
            runner.process(db, identifier, store, settings)
        review = client.post(f"{API}/assets/{identifier}/review", headers=headers, json={
            "decision": "approved", "version": 1,
        })
        assert review.status_code == 200, review.text

    rows = client.get(f"{base}/results").json()
    by_version = {row["version_id"]: row for row in rows}
    assert len(rows) == len({row["asset_id"] for row in rows}) == 3
    assert set(by_version) == set(entries.values())
    for identifier in entries.values():
        assert client.get(f"{API}/assets/{identifier}").json()["asset_id"] == (
            by_version[identifier]["asset_id"]
        )
        assert by_version[identifier]["status"] == "approved"

    pos = next(
        p for p in task["positions"] if p["purpose"] == "main" and p["product_id"] == sku["id"]
    )
    adoption = f"{API}/delivery-positions/{pos['id']}/adoption"
    receipts = []
    for identifier in entries.values():
        adopted = client.put(adoption, headers=headers, json={"version_id": identifier})
        assert adopted.status_code == 200, adopted.text
        receipt = adopted.json()
        receipts.append(receipt)
        assert client.get(adoption).json()["version_id"] == identifier
        assert client.get(receipt["download"]).content == body
    assert client.get(receipts[0]["download"]).status_code == 409

    def counts():
        return (
            db.scalar(select(func.count()).select_from(CreationOutput)),
            db.scalar(select(func.count()).select_from(PrivateFile)),
            len(files), len(calls),
        )

    original = counts()
    assert original[2:] == (3, 3)
    before = client.get(f"{base}/canvas").json()
    quick = entries["quick"]
    preview = client.get(f"{base}/results/{quick}/preview?file_version=1")
    assert (preview.status_code, preview.headers["content-type"]) == (200, "image/jpeg")
    with Image.open(BytesIO(preview.content)) as thumbnail:
        assert thumbnail.getpixel((0, 0))[0] > 240
    assert client.get(f"{base}/canvas").json() == before
    assert counts() == original
    point = {"id": f"result:{quick}", "x": 30, "y": 40}
    layout = f"{base}/canvas/layout"
    assert client.put(layout, headers=headers, json={
        "expected_version": 0, "positions": [point],
    }).status_code == 200
    assert len(client.get(f"{base}/canvas").json()["nodes"]) == len(before["nodes"]) + 1
    assert counts() == original
    assert client.put(layout, headers=headers, json={
        "expected_version": 1, "positions": [],
    }).status_code == 200
    assert client.get(f"{base}/canvas").json()["nodes"] == before["nodes"]
    assert client.get(f"{base}/results").json() == rows
    assert counts() == original
    provider_records = provider_inventory(db)
    assert {row["output_id"] for row in provider_records} == set(entries.values())
    assert {row["provider_id"] for row in provider_records} == {
        "fixture-1", "fixture-2", "fixture-3",
    }
