import os
from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.modules.identity.models import Membership, Tenant, User
from app.modules.identity.service import hash_password
from app.shared.config import get_settings

from ..module02.conftest import PASSWORD, client  # noqa: F401
from ..module02.conftest import db as sqlite_db  # noqa: F401


@pytest.fixture(autouse=True)
def isolate_provider_credentials(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch):
    settings = get_settings()
    if (
        request.node.name != "test_concurrent_delivery_and_batch_workers"
        or os.environ.get("STUDIO_M2_LIVE_PROVIDER") != "1"
    ):
        monkeypatch.setattr(settings, "ark_api_key", None)
    monkeypatch.setattr(settings, "itaiapi_api_key", None)


@pytest.fixture
def db(request: pytest.FixtureRequest) -> Iterator[Session]:
    url = os.environ.get("STUDIO_TEST_IMAGE_DATABASE")
    if not url:
        yield request.getfixturevalue("sqlite_db")
        return
    engine = create_engine(url)
    with engine.connect() as connection:
        transaction = connection.begin()
        with Session(
            connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
        ) as session:
            tenant = Tenant(id="alpha", slug="alpha", name="Test Alpha")
            user = User(
                id="alice", email="alice@example.test", password_hash=hash_password(PASSWORD)
            )
            session.add_all([tenant, user])
            session.flush()
            session.add(
                Membership(tenant_id="alpha", user_id="alice", role="admin", download_allowed=True)
            )
            session.commit()
            yield session
        transaction.rollback()
    engine.dispose()
