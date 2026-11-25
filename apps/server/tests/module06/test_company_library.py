from uuid import uuid4

from app.modules.creation.models import CreationOutput

from ..module03.test_production_setup import API, photo
from ..module05.test_canvas import create_draft, setup_task


def test_library_targets_and_batch_replacement(client, db):
    headers, product, other, task = setup_task(client, db)
    source = create_draft(client, headers, task, product, entry="quick")
    target = create_draft(client, headers, task, product, entry="batch")
    create_draft(client, headers, task, other, entry="canvas")
    for index, name in enumerate(["first", "second"]):
        photo(db, name, "alpha", "alice")
        db.add(
            CreationOutput(
                id=name,
                creation_id=source["id"],
                execution_id="legacy",
                output_index=index,
                version=1,
                status="approved",
                file_id=name,
                file_version=2,
            )
        )
    db.commit()
    details = client.get(f"{API}/assets/first/source").json()
    assert details["product"].endswith(product["sku"])
    assert details["evidence"] == "历史输入快照未记录"
    path = f"{API}/assets/first/reference-targets"
    assert [t["id"] for t in client.get(path, params={"task_id": task["id"]}).json()] == [
        target["id"]
    ]
    url = f"{API}/creations/{target['id']}/references"
    for version, name in enumerate(["first", "second"], 1):
        response = client.post(
            url,
            headers=headers,
            json={
                "expected_version": version,
                "kind": "result",
                "source_id": name,
                "source_version": 1,
                "file_version": 2,
                "company_library": True,
            },
        )
        assert response.status_code == 200, response.text
        assert [r["source_id"] for r in response.json()["references"]] == [name]
    db.add(
        CreationOutput(
            id="submitted",
            creation_id=target["id"],
            execution_id="earlier",
            output_index=0,
            version=1,
            status="queued",
        )
    )
    db.commit()
    assert client.get(path, params={"task_id": task["id"]}).json() == []
    assert (
        client.post(
            url,
            headers=headers,
            json={
                "expected_version": 3,
                "kind": "result",
                "source_id": "first",
                "company_library": True,
            },
        ).status_code
        == 409
    )


def test_empty_target_creates_referenced_draft_atomically(client, db):
    headers, red, blue, origin = setup_task(client, db)
    source = create_draft(client, headers, origin, red)
    photo(db, "asset", "alpha", "alice")
    db.add(
        CreationOutput(
            id="approved",
            creation_id=source["id"],
            execution_id="legacy",
            output_index=0,
            version=1,
            status="approved",
            file_id="asset",
            file_version=2,
        )
    )
    db.commit()
    task = client.post(
        f"{API}/tasks",
        headers=headers,
        json={
            "product_ids": [blue["id"]],
            "contents": ["main"],
        },
    ).json()
    path = f"{API}/assets/approved/reference-draft"
    data = dict(
        task_id=task["id"],
        expected_version=task["version"],
        request_id=str(uuid4()),
        add_product=False,
        source_version=1,
        file_version=2,
    )
    assert client.post(path, headers=headers, json=data).status_code == 404
    data["add_product"] = True
    assert client.post(path, headers=headers, json={**data, "file_version": 3}).status_code == 422
    assert client.get(f"{API}/tasks/{task['id']}").json() == task
    result = client.post(path, headers=headers, json=data)
    assert result.status_code == 200, result.text
    draft = result.json()["draft"]
    assert (draft["entry"], draft["product_id"], draft["task_id"]) == (
        "quick",
        red["id"],
        task["id"],
    )
    assert [(ref["source_id"], ref["file_version"]) for ref in draft["references"]] == [
        ("approved", 2)
    ]
    assert client.post(path, headers=headers, json=data).json() == result.json()
    assert client.get(f"{API}/tasks/{task['id']}/creations?primary=false").json() == [draft]
    assert client.get(f"{API}/tasks/{task['id']}/results").json() == []


def test_template_variables_bind_at_explicit_application(client, db):
    headers, product, _, task = setup_task(client, db)
    draft = create_draft(client, headers, task, product)
    prompt = "{{商品名称}} / {{SKU}} / {{商品事实}}"
    template = client.post(
        f"{API}/templates",
        headers=headers,
        json={
            "name": "变量模板",
            "category": "apparel",
            "purpose": "main",
            "prompt": prompt,
        },
    ).json()
    base = f"{API}/templates/{template['id']}"
    assert (
        client.post(f"{base}/publish", headers=headers, json={"expected_version": 1}).status_code
        == 200
    )
    result = client.post(
        f"{API}/creations/{draft['id']}/template",
        headers=headers,
        json={
            "expected_version": draft["version"],
            "template_id": template["id"],
            "template_version": 1,
            "prompt_action": "replace",
        },
    )
    assert result.status_code == 200, result.text
    assert result.json()["prompt"].startswith(f"{product['name']} / {product['sku']} / 样本")
    assert client.get(f"{base}/versions/1").json()["prompt"] == prompt
