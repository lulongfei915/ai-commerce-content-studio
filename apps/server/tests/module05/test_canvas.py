from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.modules.creation.models import CreationOutput

from ..module02.conftest import login
from ..module03.test_production_setup import API, create_product, photo


def setup_task(client: TestClient, db: Session) -> tuple[dict, dict, dict, dict]:
    csrf = login(client)
    headers = {"X-CSRF-Token": csrf}
    photo(db, "red-canvas", "alpha", "alice")
    photo(db, "blue-canvas", "alpha", "alice")
    photo(db, "pending-canvas", "alpha", "alice", "pending")
    facts = {key: {"value": "样本", "evidence": "实拍"} for key in ("color", "size", "structure")}
    red = create_product(client, csrf, "RED-CANVAS", facts=facts, photo_ids=["red-canvas"])
    blue = create_product(client, csrf, "BLUE-CANVAS", photo_ids=["blue-canvas"])
    response = client.post(
        f"{API}/tasks",
        headers=headers,
        json={"product_ids": [red["id"], blue["id"]], "contents": ["main", "video"]},
    )
    assert response.status_code == 201, response.text
    return headers, red, blue, response.json()


def create_draft(
    client: TestClient, headers: dict, task: dict, product: dict, **extra: object
) -> dict:
    response = client.post(
        f"{API}/tasks/{task['id']}/creations",
        headers=headers,
        json={"product_id": product["id"], "purpose": "main", "prompt": "实拍棚拍", **extra},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_layout_conflict_and_personal_viewport_are_independent(
    client: TestClient, db: Session
) -> None:
    headers, red, _, task = setup_task(client, db)
    url = f"{API}/tasks/{task['id']}/canvas"
    response = client.get(url)
    assert response.status_code == 200, response.text
    assert response.json()["nodes"] == []
    draft = create_draft(client, headers, task, red)
    pos = {"id": f"creation:{draft['id']}", "x": 120, "y": -45}
    body = {"expected_version": 0, "positions": [pos]}
    assert client.put(f"{url}/layout", headers=headers, json=body).status_code == 200
    stale = client.put(f"{url}/layout", headers=headers, json={**body, "positions": []})
    assert stale.status_code == 409
    viewport = {"expected_version": 0, "x": -70, "y": 40, "zoom": 0.65}
    assert client.put(f"{url}/viewport", headers=headers, json=viewport).status_code == 200
    assert client.put(f"{url}/viewport", headers=headers, json=viewport).status_code == 409
    loaded = client.get(url).json()
    assert loaded["layout"] == {"version": 1, "positions": [pos]}
    assert loaded["viewport"] == {"version": 1, "x": -70, "y": 40, "zoom": 0.65}
    assert client.get(f"{API}/creations/{draft['id']}").json() == draft
    viewer = {"X-CSRF-Token": login(client, "vern")}
    assert client.get(url).json()["viewport"] is None
    assert client.put(f"{url}/viewport", headers=viewer, json=viewport).status_code == 200
    assert client.put(f"{url}/layout", headers=viewer, json=body).status_code == 403
    login(client, "bob", "beta")
    assert client.get(url).status_code == 404


def test_reference_projection_keeps_id_and_rejects_dangling_label(
    client: TestClient, db: Session
) -> None:
    headers, red, _, task = setup_task(client, db)
    draft = create_draft(client, headers, task, red)
    url = f"{API}/creations/{draft['id']}"
    db.add(
        CreationOutput(
            id="own-result",
            creation_id=draft["id"],
            execution_id="execution-one",
            output_index=0,
            version=1,
            status="approved",
        )
    )
    db.commit()
    for kind, source, code in [
        ("upload", "blue-canvas", "reference_other_sku"),
        ("upload", "pending-canvas", "reference_not_ready"),
        ("result", "own-result", "reference_cycle"),
    ]:
        response = client.post(
            f"{url}/references",
            headers=headers,
            json={"expected_version": 1, "kind": kind, "source_id": source},
        )
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == code
    added = client.post(
        f"{url}/references",
        headers=headers,
        json={
            "expected_version": 1,
            "kind": "upload",
            "source_id": "red-canvas",
            "usage": "product",
        },
    )
    assert added.status_code == 200, added.text
    ref = added.json()["references"][0]
    canvas = client.get(f"{API}/tasks/{task['id']}/canvas").json()
    assert canvas["edges"] == [
        {
            "id": ref["id"],
            "source": "upload:red-canvas",
            "target": f"creation:{draft['id']}",
            "usage": "product",
        },
    ]
    prompt = f"实拍棚拍 [[ref:{ref['id']}]]"
    assert (
        client.patch(
            url, headers=headers, json={"expected_version": 2, "prompt": prompt}
        ).status_code
        == 200
    )
    snapshot = client.get(f"{url}/input-snapshot")
    assert snapshot.status_code == 200, snapshot.text
    refs = snapshot.json()["references"]
    assert [(r["id"], r["file_id"], r["file_version"], r["usage"]) for r in refs] == [
        (ref["id"], "red-canvas", 2, "product"),
    ]
    assert (
        client.delete(
            f"{url}/references/{ref['id']}?expected_version=3", headers=headers
        ).status_code
        == 200
    )
    assert client.get(url).json()["prompt"] == prompt
    assert client.get(f"{url}/readiness").json()["issues"] == [
        {"field": "prompt", "code": "reference_label_dangling"},
    ]
    assert client.get(f"{url}/input-snapshot").status_code == 422
    assert client.get(f"{API}/tasks/{task['id']}/canvas").json()["edges"] == []


def test_task_canvas_returns_video_draft_without_cross_task_leak(
    client: TestClient, db: Session
) -> None:
    headers, red, _, task = setup_task(client, db)
    other = client.post(
        f"{API}/tasks",
        headers=headers,
        json={"product_ids": [red["id"]], "contents": ["main"], "name": "另一个任务"},
    ).json()
    draft = create_draft(client, headers, task, red, purpose="video")
    assert draft["video_parameters"]["duration"] == 5
    assert client.get(f"{API}/tasks/{task['id']}/canvas").json()["creations"] == [draft]
    assert client.get(f"{API}/tasks/{other['id']}/canvas").json()["creations"] == []
    rejected = client.put(
        f"{API}/tasks/{other['id']}/canvas/layout",
        headers=headers,
        json={
            "expected_version": 0,
            "positions": [{"id": f"creation:{draft['id']}", "x": 0, "y": 0}],
        },
    )
    assert rejected.status_code == 422


def test_result_lineage_rejects_indirect_cycles_and_is_scoped(
    client: TestClient, db: Session
) -> None:
    headers, red, blue, task = setup_task(client, db)
    first = create_draft(client, headers, task, red)
    next_draft = create_draft(client, headers, task, red, primary=False)
    other_sku = create_draft(client, headers, task, blue)
    for source, draft, status in [("one", first, "approved"), ("two", next_draft, "needs_review")]:
        photo(db, f"media-{source}", "alpha", "alice")
        db.add(
            CreationOutput(
                id=source,
                creation_id=draft["id"],
                execution_id=f"exec-{source}",
                output_index=0,
                version=1,
                status=status,
                file_id=f"media-{source}",
                file_version=2,
            )
        )
        db.commit()
    for target, source, issue in [
        (other_sku, "one", "reference_other_sku"),
        (first, "two", "reference_not_ready"),
        (next_draft, "one", None),
        (first, "two", "reference_cycle"),
    ]:
        response = client.post(
            f"{API}/creations/{target['id']}/references",
            headers=headers,
            json={"expected_version": 1, "kind": "result", "source_id": source},
        )
        if issue:
            assert response.status_code == 422
            assert response.json()["detail"]["code"] == issue
        else:
            assert response.status_code == 200, response.text
    using_raw_file = client.post(
        f"{API}/creations/{first['id']}/references",
        headers=headers,
        json={"expected_version": 1, "kind": "upload", "source_id": "media-two"},
    )
    assert using_raw_file.status_code == 422
    assert using_raw_file.json()["detail"]["code"] == "reference_result_required"
    other = client.post(
        f"{API}/tasks",
        headers=headers,
        json={"product_ids": [red["id"]], "contents": ["main"]},
    ).json()
    own = client.get(f"{API}/tasks/{task['id']}/canvas").json()["nodes"]
    assert next(node for node in own if node["id"] == "result:one")["execution_id"] == "exec-one"
    assert client.get(f"{API}/tasks/{other['id']}/canvas").json()["nodes"] == []
    spoofed_node = client.put(
        f"{API}/tasks/{other['id']}/canvas/layout",
        headers=headers,
        json={
            "expected_version": 0,
            "positions": [{"id": "upload:media-two", "x": 10, "y": 20}],
        },
    )
    assert spoofed_node.status_code == 422
