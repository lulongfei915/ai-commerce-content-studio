import json
import shutil
import subprocess
from datetime import datetime
from io import BytesIO
from zipfile import ZipFile

import pytest
from pydantic import SecretStr
from sqlalchemy import select

from app.adapters.ark_video import VideoGenerationRequest, VideoReference, matches_video_dimensions
from app.main import app
from app.modules.assets.routes import get_storage
from app.modules.execution.models import Execution, ImageStep
from app.modules.execution.video_runner import save_result
from app.shared.config import Settings, get_settings

from ..module05.test_canvas import API, create_draft, setup_task


def test_seedance_25_first_frame_accepts_long_fixed_duration():
    request = VideoGenerationRequest(
        model="doubao-seedance-2-5-260628",
        prompt="商品展示", duration=24, ratio="adaptive",
        references=[VideoReference(role="first_frame", url="https://media.example/frame.png")],
    )
    assert request.to_payload()["duration"] == 24
    assert request.to_payload()["ratio"] == "adaptive"


def test_video_dimension_table_handles_non_widescreen_outputs():
    assert matches_video_dimensions(960, 960, "1:1", "720p")
    assert matches_video_dimensions(1470, 630, "21:9", "720p")
    assert matches_video_dimensions(834, 1112, "3:4", "720p")
    assert matches_video_dimensions(960, 960, "adaptive", "720p", frame_size=[1280, 1280])
    assert not matches_video_dimensions(720, 720, "1:1", "720p")
    assert not matches_video_dimensions(720, 720, "adaptive", "720p", frame_size=[1280, 1280])


@pytest.mark.parametrize("entry", ["quick", "canvas", "batch"])
def test_video_prompt_assistance_only_changes_prompt(client, db, monkeypatch, entry):
    from app.modules.prompt_assist import routes

    headers, red, _, task = setup_task(client, db)
    draft = create_draft(client, headers, task, red, entry=entry, purpose="video")
    settings = get_settings()
    monkeypatch.setattr(settings, "image_budget_cents", 10)
    monkeypatch.setattr(settings, "assistance_ceiling_cents", 1)

    def suggest(_settings, instruction, *_):
        assert "商品视频" in instruction
        return "平稳推进，展示商品轮廓", "test-request", {}

    monkeypatch.setattr(routes, "suggest", suggest)
    path = f"{API}/creations/{draft['id']}/assistances"
    response = client.post(path, headers=headers, json={
        "expected_version": draft["version"], "kind": "optimize",
    })
    assert response.status_code == 201, response.text
    item = response.json()
    assert client.get(f"{API}/creations/{draft['id']}").json()["prompt"] == draft["prompt"]
    path = f"{API}/assistances/{item['id']}"
    applied = client.post(f"{path}/apply", headers=headers)
    assert applied.status_code == 200, applied.text
    assert applied.json()["prompt"] == item["suggestion"]
    restored = client.post(f"{path}/undo", headers=headers)
    assert restored.status_code == 200, restored.text
    assert restored.json()["prompt"] == draft["prompt"]
    assert restored.json()["storyboard"] is None
    assert db.scalar(select(Execution).where(Execution.creation_id == draft["id"])) is None


@pytest.fixture
def video_provider(monkeypatch):
    settings = Settings(ark_api_key=SecretStr("test-key"), video_budget_unlimited=True,
                        image_budget_unlimited=True, image_ceiling_cents=1)
    monkeypatch.setitem(app.dependency_overrides, get_settings, lambda: settings)


def test_batch_video_freezes_multiple_independent_outputs(client, db, video_provider):
    headers, red, _, task = setup_task(client, db)
    drafts = [
        create_draft(client, headers, task, red, entry="batch", primary=False,
                     purpose="video", video_parameters={"count": count})
        for count in (1, 2, 1)
    ]
    path = f"{API}/tasks/{task['id']}/batches/video/executions"
    data = {"idempotency_key": "video-batch", "items": [
        {"id": item["id"], "expected_version": item["version"]} for item in drafts
    ]}
    response = client.post(path, headers=headers, json=data)
    assert response.status_code == 202, response.text
    assert [len(row["execution"]["outputs"]) for row in response.json()] == [1, 2, 1]
    assert client.post(path, headers=headers, json=data).json() == response.json()


def test_ten_images_submit_while_two_skus_wait_for_independent_video_confirmation(
    client, db, video_provider,
):
    headers, red, blue, _ = setup_task(client, db)
    response = client.post(f"{API}/tasks", headers=headers, json={
        "product_ids": [red["id"], blue["id"]], "contents": ["main", "detail", "video"],
    })
    assert response.status_code == 201, response.text
    task = response.json()
    base = f"{API}/tasks/{task['id']}"
    # Reuse the red SKU's validated fact shape on the second SKU, with its own bound photo.
    update = client.post(f"{API}/products/{blue['id']}/facts", headers=headers, json={
        "expected_version": blue["version"], "facts": red["facts"],
        "photo_ids": [photo["file_id"] for photo in blue["photos"]],
    })
    assert update.status_code == 201, update.text
    blue = update.json()
    requirements = [
        {"product_id": product["id"], "purpose": purpose, "module": module, "count": count}
        for product in (red, blue)
        for purpose, module, count in (
            ("main", "商品主图", 2), ("detail", "商品细节", 3), ("video", "带货视频", 1),
        )
    ]
    response = client.put(f"{base}/requirements", headers=headers, json={
        "expected_version": task["version"], "rows": requirements,
    })
    assert response.status_code == 200, response.text
    task = response.json()
    assert len(task["positions"]) == 12
    rows = {"image": [], "video": []}
    by_id = {}
    for position in task["positions"]:
        media = "video" if position["purpose"] == "video" else "image"
        product = red if position["product_id"] == red["id"] else blue
        draft = create_draft(client, headers, task, product, entry="batch", primary=False,
                             purpose=position["purpose"], position_id=position["id"])
        rows[media].append({"id": draft["id"], "expected_version": draft["version"]})
        by_id[draft["id"]] = position["id"]
    image_submit = {"idempotency_key": "images", "items": rows["image"]}
    images = client.post(f"{base}/batches/image/executions", headers=headers, json=image_submit)
    assert images.status_code == 202, images.text
    video_submit = {"idempotency_key": "films", "items": rows["video"]}
    path = f"{base}/batches/video/executions"
    for row in rows["video"]:
        blocked = client.post(path, headers=headers, json=video_submit)
        assert blocked.status_code == 422
        assert blocked.json()["detail"]["item_id"] == row["id"]
        confirmed = client.post(f"{API}/creations/{row['id']}/storyboard", headers=headers, json={
            "expected_version": row["expected_version"], "position_id": by_id[row["id"]],
            "shots": [{"duration": 5, "visual": "由远及近展示商品"}],
        })
        assert confirmed.status_code == 200, confirmed.text
        row["expected_version"] = confirmed.json()["version"]
    assert client.post(path, headers=headers, json=video_submit).status_code == 202
    assert client.post(f"{base}/batches/image/executions", headers=headers,
                       json=image_submit).json() == images.json()


def test_confirmed_storyboard_is_frozen_and_input_changes_invalidate_it(
    client, db, video_provider,
):
    headers, red, _, task = setup_task(client, db)
    draft = create_draft(client, headers, task, red, purpose="video")
    position = next(p for p in task["positions"] if
                    p["purpose"] == "video" and p["product_id"] == red["id"])
    path = f"{API}/creations/{draft['id']}"
    shots = [{"duration": 5, "visual": "商品全貌", "narration": "", "fact_keys": ["color"]}]
    confirmed = client.post(f"{path}/storyboard", headers=headers, json={
        "expected_version": draft["version"], "position_id": position["id"], "shots": shots,
    })
    assert confirmed.status_code == 200, confirmed.text
    response = client.post(f"{path}/executions", headers=headers, json={
        "expected_version": confirmed.json()["version"], "idempotency_key": "film",
    })
    assert response.status_code == 202, response.text
    job = db.get(Execution, response.json()["id"])
    assert job.position_id == position["id"]
    assert job.snapshot["storyboard"]["shots"] == shots
    assert "商品全貌" in job.snapshot["video_request"]["prompt"]
    updated = client.patch(path, headers=headers, json={
        "expected_version": confirmed.json()["version"], "prompt": "新画面",
    })
    assert updated.status_code == 200, updated.text
    assert client.post(f"{path}/executions", headers=headers, json={
        "expected_version": updated.json()["version"], "idempotency_key": "stale",
    }).status_code == 409


@pytest.mark.parametrize("entry", ["quick", "canvas", "batch"])
def test_film_review_rework_and_export(client, db, monkeypatch, tmp_path, video_provider, entry):
    from app.modules.creation.models import CreationOutput

    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        pytest.skip("full MP4 decode requires ffmpeg and ffprobe")
    headers, red, _, task = setup_task(client, db)
    base = f"{API}/tasks/{task['id']}"
    requirements = client.put(f"{base}/requirements", headers=headers, json={
        "expected_version": task["version"], "rows": [
            {"product_id": red["id"], "purpose": "main", "module": "商品主图", "count": 4},
            {"product_id": red["id"], "purpose": "video", "module": "带货视频", "count": 1,
             "ratio": "16:9", "resolution": "720p", "duration": 5},
        ],
    })
    assert requirements.status_code == 200, requirements.text
    task = requirements.json()
    assert len(task["positions"]) == 5
    position = next(p for p in task["positions"] if
                    p["purpose"] == "video" and p["product_id"] == red["id"])
    draft = create_draft(
        client, headers, task, red, entry=entry, purpose="video",
        **({"position_id": position["id"]} if entry == "batch" else {}),
    )
    path = f"{API}/creations/{draft['id']}"
    shots = [{"duration": 5, "visual": "商品全貌", "narration": "", "fact_keys": []}]
    confirmed = client.post(f"{path}/storyboard", headers=headers, json={
        "expected_version": draft["version"], "position_id": position["id"], "shots": shots,
    })
    assert confirmed.status_code == 200, confirmed.text
    item_version = confirmed.json()["version"]
    if entry == "batch":
        response = client.post(f"{base}/batches/video/executions", headers=headers, json={
            "idempotency_key": "film",
            "items": [{"id": draft["id"], "expected_version": item_version}],
        })
        assert response.status_code == 202, response.text
        job = response.json()[0]["execution"]
    else:
        response = client.post(f"{path}/executions", headers=headers, json={
            "expected_version": item_version, "idempotency_key": "film",
        })
        assert response.status_code == 202, response.text
        job = response.json()
    name = tmp_path / "result.mp4"
    subprocess.run([
        "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=24",
        "-t", "5", "-c:v", "libx264", "-preset", "ultrafast", str(name),
    ], check=True)
    body = name.read_bytes()

    class Store:
        files = {}

        def put(self, key, stream, mime, size):
            self.files[key] = stream.read()

        def read(self, key, byte_range):
            data = self.files[key]
            if byte_range:
                data = data[byte_range[0]:byte_range[1] + 1]
            return BytesIO(data)

    store = Store()
    monkeypatch.setitem(app.dependency_overrides, get_storage, lambda: store)
    monkeypatch.setattr("app.modules.execution.video_runner.download", lambda *_: body)
    output = db.get_one(CreationOutput, job["outputs"][0]["id"])
    save_result(db, db.get_one(Execution, job["id"]), output, db.get_one(ImageStep, output.id),
                store, Settings(), datetime.utcnow())
    db.commit()
    result_path = f"{API}/assets/{output.id}"
    preview = client.get(f"{base}/results/{output.id}/preview?file_version=1",
                         headers={"Range": "bytes=0-11"})
    assert (preview.status_code, preview.content) == (206, body[:12])
    invalid = client.post(f"{result_path}/review", headers=headers, json={
        "decision": "rejected", "version": 1, "reason": "镜头太快",
        "time_notes": [{"start": 4, "end": 6, "note": "加长停留"}],
    })
    assert invalid.status_code == 422
    decision = {"decision": "rejected", "version": 1, "reason": "镜头太快",
                "time_notes": [{"start": 2, "end": 4, "note": "加长停留"}]}
    assert client.post(f"{result_path}/review", headers=headers, json=decision).status_code == 200
    recorded = client.get(f"{result_path}/quality").json()["decision"]
    assert recorded["time_notes"] == decision["time_notes"]
    retry = client.post(f"{result_path}/rework", headers=headers, json={
        "expected_version": item_version, "idempotency_key": "rework",
    })
    assert retry.status_code == 202, retry.text
    reworked = db.get_one(Execution, retry.json()["id"])
    assert "镜头太快\n2.0-4.0 秒：加长停留" in reworked.snapshot["video_request"]["prompt"]
    assert "加长停留" not in db.get_one(Execution, job["id"]).snapshot["video_request"]["prompt"]
    new = db.get_one(CreationOutput, retry.json()["outputs"][0]["id"])
    assert (new.version, new.asset_id, output.status) == (2, output.asset_id, "rejected")
    save_result(db, db.get_one(Execution, retry.json()["id"]), new, db.get_one(ImageStep, new.id),
                store, Settings(), datetime.utcnow())
    db.commit()
    assert client.post(f"{API}/assets/{new.id}/review", headers=headers,
                       json={"decision": "approved", "version": 2}).status_code == 200
    adopted = client.get(f"{API}/delivery-positions/{position['id']}/adoption").json()
    assert adopted["version_id"] == new.id
    package = client.get(f"{base}/delivery-package")
    assert package.status_code == 200, package.text
    with ZipFile(BytesIO(package.content)) as archive:
        row = next(item for item in json.loads(archive.read("manifest.json")) if item.get("file"))
        assert row["storyboard"]["shots"] == shots
        assert archive.read(row["file"]) == body
