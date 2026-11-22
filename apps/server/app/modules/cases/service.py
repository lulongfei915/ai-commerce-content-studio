from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.assets.models import PrivateFile
from app.shared.studio_errors import reject

from .models import Case


def find_case(db: Session, tenant: str, identifier: str, *, lock: bool = False) -> Case:
    query = select(Case).where(Case.tenant_id == tenant, Case.id == identifier)
    item = db.scalar(query.with_for_update() if lock else query)
    if item is None:
        raise HTTPException(404, "case_not_found")
    return item


def ready_file(db: Session, tenant: str, identifier: str, field: str) -> PrivateFile:
    item = db.scalar(
        select(PrivateFile).where(
            PrivateFile.tenant_id == tenant,
            PrivateFile.id == identifier,
            PrivateFile.status == "ready",
            PrivateFile.object_key.is_not(None),
        )
    )
    if item is None:
        reject(field, "reference_not_ready")
    return item


def licensed_case_file(
    db: Session, tenant: str, identifier: str, category: str, purpose: str, field: str
) -> tuple[Case, PrivateFile]:
    item = db.scalar(select(Case).where(Case.tenant_id == tenant, Case.id == identifier))
    if item is None:
        reject(field, "reference_not_ready")
    if not item.usage_scope or purpose not in item.usage_purposes:
        reject(field, "case_not_licensed")
    if item.category != category or (item.media != "image" and purpose != "video"):
        reject(field, "case_incompatible")
    file = ready_file(db, tenant, item.file_id, field)
    if file.version != item.file_version:
        reject(field, "reference_version_invalid")
    return item, file
