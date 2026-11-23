"""Seed users or output rows for the browser run against its isolated SQLite database."""

import os
import sys

from sqlalchemy import select

from app.main import app  # noqa: F401 - register the ORM models
from app.modules.assets.models import PrivateFile
from app.modules.creation.models import Creation, CreationOutput
from app.modules.identity.models import Membership, Tenant, User
from app.modules.identity.service import hash_password
from app.shared.db import SessionLocal


def main() -> None:
    if not os.environ.get("DATABASE_URL", "").startswith("sqlite:////tmp/studio-m105-followup-"):
        raise SystemExit("Use the isolated M1-05 browser database.")
    action, *args = sys.argv[1:]
    with SessionLocal() as db:
        if action == "account":
            slug, email = args
            if db.scalar(select(Tenant.id).where(Tenant.slug == slug)):
                return
            tenant = Tenant(slug=slug, name="造物 Studio 验收")
            user = User(
                email=email, password_hash=hash_password(os.environ["STUDIO_CANVAS_PASSWORD"])
            )
            db.add_all([tenant, user])
            db.flush()
            db.add(
                Membership(
                    tenant_id=tenant.id, user_id=user.id, role="admin", download_allowed=True
                )
            )
        elif action == "result":
            version, creation_id, file_id, status = args
            creation = db.get(Creation, creation_id)
            media = db.get(PrivateFile, file_id)
            assert creation and media and creation.tenant_id == media.tenant_id
            db.add(
                CreationOutput(
                    id=version,
                    creation_id=creation_id,
                    execution_id=f"exec-{version}",
                    output_index=0,
                    version=1,
                    status=status,
                    file_id=file_id,
                    file_version=media.version,
                )
            )
        else:
            raise SystemExit("Unknown test fixture action.")
        db.commit()


if __name__ == "__main__":
    main()
