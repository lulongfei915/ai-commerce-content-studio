import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from .conftest import ORIGIN, PASSWORD, login


def test_session_is_scoped_to_active_membership(client: TestClient, db: Session) -> None:
    assert client.get("/api/v1/me").status_code == 401
    token = login(client)
    response = client.get("/api/v1/me")
    assert response.json()["tenant"]["slug"] == "alpha"
    assert response.json()["role"] == "admin"
    assert response.headers["Cache-Control"] == "no-store"
    assert response.json()["csrf_token"] == token
    db.execute(text("UPDATE memberships SET active = 0 WHERE user_id = 'alice'"))
    db.commit()
    assert client.get("/api/v1/me").status_code == 401


def test_login_and_logout_check_csrf_and_logout_revokes_cookie(client: TestClient) -> None:
    assert (
        client.post(
            "/api/v1/sessions",
            json={
                "tenant_slug": "alpha",
                "email": "alice@example.test",
                "password": PASSWORD,
            },
            headers={"Origin": "https://other.example", "X-Studio-Login": "1"},
        ).status_code
        == 403
    )
    token = login(client)
    cookie = client.cookies.get("studio_session")
    assert cookie
    assert client.delete("/api/v1/sessions/current").status_code == 403
    assert (
        client.delete(
            "/api/v1/sessions/current",
            headers={
                "X-CSRF-Token": token,
                "Origin": "https://other.example",
            },
        ).status_code
        == 403
    )
    assert (
        client.delete("/api/v1/sessions/current", headers={"X-CSRF-Token": token}).status_code
        == 204
    )
    client.cookies.set("studio_session", cookie)
    assert client.get("/api/v1/me").status_code == 401


@pytest.mark.parametrize(
    ("user", "role", "expected"),
    [
        ("alice", "admin", {"manage", "create", "review", "adopt", "download", "view"}),
        ("dina", "designer", {"create", "adopt", "download", "view"}),
        ("rene", "reviewer", {"review", "download", "view"}),
        ("vern", "viewer", {"view"}),
        ("denied", "designer", {"create", "adopt", "view"}),
    ],
)
def test_role_grants_and_download_flag(
    client: TestClient,
    user: str,
    role: str,
    expected: set[str],
) -> None:
    login(client, user)
    response = client.get("/api/v1/me").json()
    assert response["role"] == role
    assert set(response["permissions"]) == expected


def test_correct_password_for_wrong_tenant_has_generic_denial(client: TestClient) -> None:
    response = client.post(
        "/api/v1/sessions",
        json={
            "tenant_slug": "beta",
            "email": "alice@example.test",
            "password": PASSWORD,
        },
        headers={"Origin": ORIGIN, "X-Studio-Login": "1"},
    )
    assert response.status_code == 401
    assert response.json() == {"detail": "invalid_credentials"}


def test_expired_session_and_malformed_login_are_safe(client: TestClient, db: Session) -> None:
    login(client)
    db.execute(text("UPDATE login_sessions SET expires_at = '2000-01-01 00:00:00'"))
    db.commit()
    assert client.get("/api/v1/me").status_code == 401
    private_value = "private-validation-value" * 20
    invalid = client.post(
        "/api/v1/sessions",
        json={
            "tenant_slug": "alpha",
            "email": "alice@example.test",
            "password": private_value,
        },
        headers={"X-Studio-Login": "1"},
    )
    assert invalid.status_code == 422
    assert private_value not in invalid.text


def test_configured_admin_requires_fresh_otp(client: TestClient, db: Session) -> None:
    import pyotp
    from cryptography.fernet import Fernet
    from pydantic import SecretStr

    from app.main import app
    from app.shared.config import get_settings

    encryption_key = Fernet.generate_key()
    secret = pyotp.random_base32()
    encrypted = Fernet(encryption_key).encrypt(secret.encode()).decode()
    db.execute(
        text("UPDATE memberships SET totp_secret_encrypted = :secret WHERE role = 'admin'"),
        {"secret": encrypted},
    )
    db.commit()
    settings = get_settings().model_copy(
        update={"auth_totp_key": SecretStr(encryption_key.decode())}
    )
    app.dependency_overrides[get_settings] = lambda: settings
    request = {"tenant_slug": "alpha", "email": "alice@example.test", "password": PASSWORD}
    headers = {"Origin": ORIGIN, "X-Studio-Login": "1"}
    assert client.post("/api/v1/sessions", json=request, headers=headers).status_code == 401
    request["otp"] = pyotp.TOTP(secret).now()
    assert client.post("/api/v1/sessions", json=request, headers=headers).status_code == 201
    assert client.post("/api/v1/sessions", json=request, headers=headers).status_code == 401
