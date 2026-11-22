from __future__ import annotations

from collections.abc import Iterator
from importlib import import_module

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.main import app
from app.shared.db import Base, get_db

ORIGIN = "http://localhost:5173"
PASSWORD = "studio-test-password-02"


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        if "tenants" in Base.metadata.tables:
            models = import_module("app.modules.identity.models")
            auth = import_module("app.modules.identity.service")
            password_hash = auth.hash_password(PASSWORD)
            for tenant in ("alpha", "beta"):
                session.add(models.Tenant(id=tenant, slug=tenant, name=tenant.title()))
            session.flush()
            for user, company, role, downloadable in [
                ("alice", "alpha", "admin", True),
                ("dina", "alpha", "designer", True),
                ("rene", "alpha", "reviewer", True),
                ("vern", "alpha", "viewer", True),
                ("denied", "alpha", "designer", False),
                ("bob", "beta", "admin", True),
            ]:
                session.add(
                    models.User(id=user, email=f"{user}@example.test", password_hash=password_hash)
                )
                session.flush()
                session.add(
                    models.Membership(
                        tenant_id=company, user_id=user, role=role, download_allowed=downloadable
                    )
                )
            session.commit()
        yield session
    engine.dispose()


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: db
    if "tenants" in Base.metadata.tables:
        security = import_module("app.modules.identity.security")
        app.dependency_overrides[security.get_login_limiter] = lambda: lambda _identity, _ip: None
    with TestClient(app) as browser:
        yield browser
    app.dependency_overrides.clear()


def login(client: TestClient, user: str = "alice", company: str = "alpha") -> str:
    response = client.post(
        "/api/v1/sessions",
        json={
            "tenant_slug": company,
            "email": f"{user}@example.test",
            "password": PASSWORD,
        },
        headers={"Origin": ORIGIN, "X-Studio-Login": "1"},
    )
    assert response.status_code == 201, response.text
    return str(response.json()["csrf_token"])
