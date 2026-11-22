import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.assets.models import PrivateFile

from .conftest import login

API = "/api/v1"


def create_product(client: TestClient, csrf: str, sku: str, **extra: object) -> dict:
    response = client.post(
        f"{API}/products",
        headers={"X-CSRF-Token": csrf},
        json={"sku": sku, "name": "帆布鞋", "category": "apparel", **extra},
    )
    assert response.status_code == 201, response.text
    return response.json()


def photo(db: Session, file_id: str, tenant: str, user: str, status: str = "ready") -> None:
    from datetime import datetime

    db.add(
        PrivateFile(
            id=file_id,
            tenant_id=tenant,
            created_by=user,
            status=status,
            filename="sample.png",
            content_type="image/png",
            size_bytes=1200,
            version=2,
            expires_at=datetime(2030, 1, 1),
            object_key=f"sample-{file_id}",
        )
    )
    db.commit()


def test_sku_owns_its_actual_photo_and_fact_history(client: TestClient, db: Session) -> None:
    csrf = login(client, "dina")
    photo(db, "red-photo", "alpha", "alice")
    photo(db, "blue-photo", "alpha", "dina")
    photo(db, "other-photo", "beta", "bob")
    photo(db, "pending-photo", "alpha", "dina", "pending")
    red_facts = {
        "color": {"value": "红色", "evidence": "实物核对"},
        "size": {"value": "38", "evidence": "鞋盒标签"},
        "structure": {"value": "低帮", "evidence": "样品记录"},
    }
    red = create_product(client, csrf, "SHOE-RED", facts=red_facts, photo_ids=["red-photo"])
    blue = create_product(client, csrf, "SHOE-BLUE", photo_ids=["blue-photo"])
    assert red["photos"] == [{"file_id": "red-photo", "version": 2}]
    assert blue["photos"] == [{"file_id": "blue-photo", "version": 2}]
    assert red["facts"]["size"]["evidence"] == "鞋盒标签"
    headers = {"X-CSRF-Token": csrf}
    url = f"{API}/products/{blue['id']}/facts"
    for file_id, status in [("red-photo", 409), ("pending-photo", 422), ("other-photo", 404)]:
        result = client.post(
            url, headers=headers, json={"expected_version": 1, "photo_ids": [file_id]}
        )
        assert result.status_code == status, result.text
    result = client.post(url, headers=headers, json={"expected_version": 1, "facts": red_facts})
    assert result.status_code == 201, result.text
    assert result.json()["fact_version"] == 2
    assert result.json()["photos"] == blue["photos"]
    old = client.get(f"{url}/1")
    assert old.status_code == 200 and old.json()["facts"] == {}
    assert (
        client.post(url, headers=headers, json={"expected_version": 1, "photo_ids": []}).status_code
        == 409
    )
    name_edit = client.patch(
        f"{API}/products/{blue['id']}",
        headers=headers,
        json={
            "expected_version": 2,
            "name": "蓝色帆布鞋",
        },
    )
    assert name_edit.json()["fact_version"] == 2
    assert name_edit.json()["version"] == 3
    assert client.get(f"{API}/products?q=SHOE-BLUE").json()["items"][0]["id"] == blue["id"]


def test_draft_scope_and_explicit_membership(client: TestClient) -> None:
    csrf = login(client)
    headers = {"X-CSRF-Token": csrf}
    red = create_product(client, csrf, "RED")
    blue = create_product(client, csrf, "BLUE", category="beauty")
    for body in [
        {"product_ids": [], "contents": ["main"]},
        {"product_ids": [red["id"]], "contents": []},
    ]:
        assert client.post(f"{API}/tasks", headers=headers, json=body).status_code == 422
    result = client.post(
        f"{API}/tasks",
        headers=headers,
        json={
            "product_ids": [red["id"]],
            "contents": ["main"],
            "name": "春季上新",
        },
    )
    assert result.status_code == 201, result.text
    draft = result.json()
    assert draft["status"] == "draft"
    assert [p["purpose"] for p in draft["positions"]] == ["main"]
    assert "photo_required" in draft["products"][0]["readiness"]["main"]
    assert "color" in draft["products"][0]["readiness"]["main"]
    url = f"{API}/tasks/{draft['id']}/products"
    assert len(client.get(f"{API}/tasks/{draft['id']}").json()["products"]) == 1
    add = client.post(
        url, headers=headers, json={"expected_version": 1, "product_ids": [blue["id"]]}
    )
    assert add.status_code == 200, add.text
    updated = add.json()
    assert updated["version"] == 2
    assert updated["positions"][0] == draft["positions"][0]
    assert {p["product_id"] for p in updated["positions"]} == {red["id"], blue["id"]}
    assert all(p["purpose"] == "main" for p in updated["positions"])
    assert "capacity" in updated["products"][1]["readiness"]["main"]
    assert "color" not in updated["products"][1]["readiness"]["main"]
    assert (
        client.post(
            url, headers=headers, json={"expected_version": 2, "product_ids": [blue["id"]]}
        ).status_code
        == 409
    )
    assert client.get(f"{API}/tasks?q=BLUE").json()["items"][0]["id"] == draft["id"]


def test_permissions_and_atomic_create(client: TestClient, db: Session) -> None:
    csrf = login(client, "bob", "beta")
    other = create_product(client, csrf, "OTHER")
    csrf = login(client)
    headers = {"X-CSRF-Token": csrf}
    first = create_product(client, csrf, "FIRST")
    assert client.get(f"{API}/products/{other['id']}").status_code == 404
    result = client.post(
        f"{API}/tasks",
        headers=headers,
        json={
            "product_ids": [first["id"], other["id"]],
            "contents": ["main"],
        },
    )
    assert result.status_code == 404
    assert client.get(f"{API}/tasks").json()["items"] == []

    from app.modules.tasks.models import DeliveryPosition, Task, TaskProduct

    with db.bind.begin() as connection:
        connection.exec_driver_sql("""
            CREATE TRIGGER reject_position BEFORE INSERT ON delivery_positions
            BEGIN SELECT RAISE(ABORT, 'test write failure'); END
        """)
    with TestClient(client.app, raise_server_exceptions=False) as safe_client:
        safe_client.cookies.update(client.cookies)
        assert (
            safe_client.post(
                f"{API}/tasks",
                headers=headers,
                json={
                    "product_ids": [first["id"]],
                    "contents": ["main"],
                },
            ).status_code
            == 500
        )
    db.rollback()
    for table in (Task, TaskProduct, DeliveryPosition):
        assert db.scalar(select(func.count()).select_from(table)) == 0
    viewer = login(client, "vern")
    assert (
        client.post(
            f"{API}/tasks",
            headers={"X-CSRF-Token": viewer},
            json={
                "product_ids": [first["id"]],
                "contents": ["main"],
            },
        ).status_code
        == 403
    )


def test_photo_preview_is_tenant_and_sku_scoped(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from io import BytesIO

    from PIL import Image

    from app.main import app
    from app.modules.assets.routes import get_storage

    from ..module02.test_files import MemoryStorage, reserve, upload

    storage = MemoryStorage({})
    monkeypatch.setitem(app.dependency_overrides, get_storage, lambda: storage)
    csrf = login(client, "dina")
    image = BytesIO()
    Image.new("RGB", (1000, 800), "red").save(image, "PNG")
    file_id = reserve(client, csrf, len(image.getvalue()))
    assert upload(client, file_id, csrf, image.getvalue()) == 204
    assert (
        client.post(f"{API}/files/{file_id}/complete", headers={"X-CSRF-Token": csrf}).status_code
        == 200
    )
    product = create_product(client, csrf, "RED", photo_ids=[file_id])
    other = create_product(client, csrf, "BLUE")
    login(client, "vern")
    url = f"{API}/products/{product['id']}/photos/{file_id}/preview"
    response = client.get(url)
    assert response.status_code == 200 and response.headers["Content-Type"] == "image/jpeg"
    with Image.open(BytesIO(response.content)) as preview:
        assert max(preview.size) == 384
    assert client.get(f"{API}/files/{file_id}/content").status_code == 403
    assert client.get(f"{API}/products/{other['id']}/photos/{file_id}/preview").status_code == 404
    login(client, "bob", "beta")
    assert client.get(url).status_code == 404


def test_generation_preflight_rejects_incomplete_and_invalidated_inputs(
    client: TestClient, db: Session
) -> None:
    from fastapi import HTTPException

    from app.modules.products.service import get_product, require_generation_inputs

    csrf = login(client)
    photo(db, "sample", "alpha", "alice")
    data = create_product(
        client,
        csrf,
        "CUP",
        category="home",
        photo_ids=["sample"],
        facts={
            "dimensions": {"value": "7×8 cm", "evidence": "量尺"},
            "structure": {"value": "单层", "evidence": "结构图"},
        },
    )
    product = get_product(db, "alpha", data["id"])
    assert require_generation_inputs(db, product, "main")[0].file_id == "sample"
    with pytest.raises(HTTPException) as incomplete:
        require_generation_inputs(db, product, "detail")
    assert incomplete.value.detail == {"code": "product_inputs_incomplete", "fields": ["parts"]}
    file = db.get(PrivateFile, "sample")
    assert file is not None
    file.status = "inactive"
    db.commit()
    with pytest.raises(HTTPException) as inactive:
        require_generation_inputs(db, product, "main")
    assert inactive.value.detail["fields"] == ["product_photo_invalid"]
