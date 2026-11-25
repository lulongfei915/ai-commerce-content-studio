from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from ..module03.test_production_setup import create_product, photo
from .conftest import login

API = "/api/v1"
PARAMS = {"model": "seedream-5.5", "ratio": "1:1", "resolution": "1K", "count": 1}


def test_template_publish_creates_immutable_versions(client: TestClient) -> None:
    headers = {"X-CSRF-Token": login(client)}
    body = {
        "name": "棚拍",
        "category": "apparel",
        "purpose": "main",
        "prompt": "第一版",
        "parameters": PARAMS,
    }
    created = client.post(f"{API}/templates", headers=headers, json=body)
    assert created.status_code == 201, created.text
    url = f"{API}/templates/{created.json()['id']}"
    published = client.post(f"{url}/publish", headers=headers, json={"expected_version": 1})
    assert published.status_code == 200, published.text
    edited = client.patch(
        url, headers=headers, json={**body, "prompt": "第二版", "expected_version": 2}
    )
    assert edited.status_code == 200
    manager = client.get(f"{API}/templates?manage=true").json()["items"][0]
    assert manager["has_unpublished_changes"]
    assert manager["published_content"]["prompt"] == "第一版"
    assert manager["content"]["prompt"] == "第二版"
    assert client.get(f"{url}/versions/1").json()["prompt"] == "第一版"
    assert (
        client.post(f"{url}/publish", headers=headers, json={"expected_version": 3}).json()[
            "published_version"
        ]
        == 2
    )
    assert client.get(f"{url}/versions/2").json()["prompt"] == "第二版"
    assert (
        client.post(
            f"{url}/status", headers=headers, json={"expected_version": 4, "enabled": False}
        ).status_code
        == 200
    )
    assert client.get(f"{url}/versions/1").json()["prompt"] == "第一版"
    assert (
        client.post(
            f"{url}/status", headers=headers, json={"expected_version": 5, "enabled": True}
        ).status_code
        == 200
    )


def test_creative_draft_preserves_independent_reference_and_prompt(
    client: TestClient, db: Session
) -> None:
    csrf = login(client)
    headers = {"X-CSRF-Token": csrf}
    product = create_product(client, csrf, "M104-SHOE")
    task = client.post(
        f"{API}/tasks", headers=headers, json={"product_ids": [product["id"]], "contents": ["main"]}
    ).json()
    photo(db, "case-photo", "alpha", "alice")
    photo(db, "pending", "alpha", "alice", "pending")
    case_input = {
        "name": "棚拍参考",
        "category": "apparel",
        "file_id": "case-photo",
        "source": "品牌提供",
    }
    created_case = client.post(f"{API}/cases", headers=headers, json=case_input)
    assert created_case.status_code == 201, created_case.text
    case = created_case.json()
    assert client.get(f"{API}/cases?media=image&q=棚拍").json()["items"][0]["id"] == case["id"]
    root = f"{API}/tasks/{task['id']}/creations"
    created = client.post(
        root,
        headers=headers,
        json={
            "product_id": product["id"],
            "purpose": "main",
            "prompt": "我的正文",
            "parameters": PARAMS,
        },
    )
    assert created.status_code == 201, created.text
    url = f"{API}/creations/{created.json()['id']}"
    references = f"{url}/references"
    for kind, source, code in [
        ("case", case["id"], "case_not_licensed"),
        ("upload", "pending", "reference_not_ready"),
    ]:
        result = client.post(
            references,
            headers=headers,
            json={"expected_version": 1, "kind": kind, "source_id": source},
        )
        assert result.status_code == 422 and result.json()["detail"]["code"] == code
    licensed = client.patch(
        f"{API}/cases/{case['id']}",
        headers=headers,
        json={"expected_version": 1, "usage_scope": "仅用于该公司主图", "usage_purposes": ["main"]},
    )
    assert licensed.status_code == 200
    added = client.post(
        references,
        headers=headers,
        json={"expected_version": 1, "kind": "case", "source_id": case["id"]},
    )
    assert added.status_code == 200, added.text
    assert added.json()["parameters"] == {**PARAMS, "provider": "ark", "quality": None}
    template = client.post(
        f"{API}/templates",
        headers=headers,
        json={
            "name": "新模板",
            "category": "apparel",
            "purpose": "main",
            "prompt": "公司提示",
            "parameters": {**PARAMS, "count": 2},
        },
    ).json()
    template_url = f"{API}/templates/{template['id']}"
    assert (
        client.post(
            f"{template_url}/publish", headers=headers, json={"expected_version": 1}
        ).status_code
        == 200
    )
    apply_body = {
        "expected_version": 2,
        "template_id": template["id"],
        "template_version": 1,
        "prompt_action": "keep",
    }
    applied = client.post(f"{url}/template", headers=headers, json=apply_body)
    assert applied.status_code == 200, applied.text
    assert applied.json()["prompt"] == "我的正文"
    assert applied.json()["references"] == added.json()["references"]
    assert applied.json()["parameters"]["count"] == 2
    invalid = client.patch(
        url, headers=headers, json={"expected_version": 3, "parameters": {**PARAMS, "count": 10}}
    )
    assert invalid.status_code == 422 and invalid.json()["detail"]["field"] == "parameters.count"
    assert (
        client.post(
            f"{template_url}/status",
            headers=headers,
            json={"expected_version": 2, "enabled": False},
        ).status_code
        == 200
    )
    assert client.get(f"{url}/readiness").json()["issues"][0]["code"] == "template_disabled"
    assert client.get(url).json()["prompt"] == "我的正文"


def test_revoked_case_blocks_ready_draft_without_rewriting_it(
    client: TestClient, db: Session
) -> None:
    csrf = login(client)
    headers = {"X-CSRF-Token": csrf}
    photo(db, "sku-photo", "alpha", "alice")
    photo(db, "licensed-photo", "alpha", "alice")
    facts = {
        key: {"value": "样本", "evidence": "样品记录"} for key in ("color", "size", "structure")
    }
    product = create_product(client, csrf, "M104-READY", facts=facts, photo_ids=["sku-photo"])
    task = client.post(
        f"{API}/tasks",
        headers=headers,
        json={
            "product_ids": [product["id"]],
            "contents": ["main", "detail"],
        },
    ).json()
    case = client.post(
        f"{API}/cases",
        headers=headers,
        json={
            "name": "获准参考",
            "category": "apparel",
            "file_id": "licensed-photo",
            "source": "授权样本",
            "usage_scope": "限主图",
            "usage_purposes": ["main"],
        },
    ).json()
    root = f"{API}/tasks/{task['id']}/creations"
    draft = client.post(
        root,
        headers=headers,
        json={"product_id": product["id"], "purpose": "main", "prompt": " 手写正文\n"},
    ).json()
    details = client.post(
        root, headers=headers, json={"product_id": product["id"], "purpose": "detail"}
    ).json()
    reference = {"expected_version": 1, "kind": "case", "source_id": case["id"]}
    disallowed = client.post(
        f"{API}/creations/{details['id']}/references", headers=headers, json=reference
    )
    assert disallowed.status_code == 422
    assert disallowed.json()["detail"]["code"] == "case_not_licensed"
    url = f"{API}/creations/{draft['id']}"
    result = client.post(f"{url}/references", headers=headers, json=reference)
    assert result.status_code == 200
    saved = result.json()
    assert saved["prompt"] == " 手写正文\n"
    assert client.get(f"{url}/readiness").json() == {"issues": []}
    assert (
        client.patch(
            f"{API}/cases/{case['id']}",
            headers=headers,
            json={
                "expected_version": 1,
                "usage_scope": None,
            },
        ).status_code
        == 200
    )
    assert client.get(f"{url}/readiness").json() == {
        "issues": [{"field": "references.0", "code": "case_not_licensed"}],
    }
    assert client.get(url).json() == saved
    designer = {"X-CSRF-Token": login(client, "dina")}
    assert (
        client.patch(
            f"{API}/cases/{case['id']}",
            headers=designer,
            json={
                "expected_version": 2,
                "usage_scope": None,
            },
        ).status_code
        == 403
    )
    login(client, "bob", "beta")
    assert client.get(url).status_code == 404
    assert client.get(f"{API}/cases/{case['id']}").status_code == 404
