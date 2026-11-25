from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.modules.tasks.models import Task

from .conftest import login


def test_team_handover_preserves_authorship(client: TestClient, db: Session) -> None:
    token = login(client)
    headers = {"X-CSRF-Token": token}
    task = Task(tenant_id="alpha", created_by="dina", name="秋冬上新")
    db.add(task)
    db.commit()
    path = "/api/v1/company/members"
    members = client.get(path)
    assert members.status_code == 200
    assert "bob" not in [m["id"] for m in members.json()]
    assert (
        client.post(
            f"{path}/alice/disable",
            headers=headers,
            json={
                "expected_version": 1,
                "successor": "dina",
            },
        ).status_code
        == 409
    )
    assert (
        client.patch(
            f"{path}/alice",
            headers=headers,
            json={
                "expected_version": 1,
                "role": "viewer",
                "download_allowed": False,
            },
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"{path}/dina/disable",
            headers=headers,
            json={
                "expected_version": 1,
                "successor": "bob",
            },
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"{path}/dina/disable",
            headers=headers,
            json={
                "expected_version": 1,
                "successor": "alice",
            },
        ).status_code
        == 204
    )
    db.refresh(task)
    assert task.created_by == "dina"
    assert task.owner_id == "alice"
    assert client.get("/api/v1/company/records").json()[0]["action"] == "停用并交接"
    login(client, "vern")
    assert client.get(path).status_code == 403
