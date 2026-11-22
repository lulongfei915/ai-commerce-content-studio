from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, Response
from sqlalchemy import or_, select

from app.modules.assets.routes import Storage, stream_private_file
from app.modules.identity.domain import Permission
from app.modules.identity.security import (
    ActiveIdentity,
    Database,
    WriteIdentity,
    require_permission,
)
from app.modules.products.schemas import Category
from app.shared.studio_errors import check_version, reject

from .models import Case
from .schemas import CaseCreate, CaseLicense, CasePage, CaseView, Media
from .service import find_case, ready_file

router = APIRouter(prefix="/cases", tags=["案例"])


def view(item: Case) -> CaseView:
    return CaseView.model_validate(item, from_attributes=True)


@router.get("")
def list_cases(
    identity: ActiveIdentity,
    db: Database,
    q: Annotated[str, Query(max_length=100)] = "",
    category: Category | None = None,
    media: Media | None = None,
    cursor: Annotated[str | None, Query(max_length=36)] = None,
) -> CasePage:
    require_permission(identity, Permission.VIEW)
    query = select(Case).where(Case.tenant_id == identity.tenant.id)
    if q:
        query = query.where(
            or_(Case.name.contains(q, autoescape=True), Case.source.contains(q, autoescape=True))
        )
    if category:
        query = query.where(Case.category == category)
    if media:
        query = query.where(Case.media == media)
    if cursor:
        query = query.where(Case.id > cursor)
    page = list(db.scalars(query.order_by(Case.id).limit(31)))
    return CasePage(
        items=[view(item) for item in page[:30]],
        next_cursor=page[29].id if len(page) > 30 else None,
    )


@router.post("", status_code=201)
def create_case(data: CaseCreate, identity: WriteIdentity, db: Database) -> CaseView:
    require_permission(identity, Permission.MANAGE)
    file = ready_file(db, identity.tenant.id, data.file_id, "file_id")
    if data.usage_scope and not data.usage_purposes:
        reject("usage_purposes", "case_scope_required")
    item = Case(
        **data.model_dump(exclude={"usage_scope", "usage_purposes"}),
        tenant_id=identity.tenant.id,
        file_version=file.version,
        media=file.content_type.split("/", 1)[0],
        usage_scope=data.usage_scope or None,
        usage_purposes=list(dict.fromkeys(data.usage_purposes)) if data.usage_scope else [],
    )
    db.add(item)
    db.commit()
    return view(item)


@router.get("/{case_id}")
def get_case(case_id: str, identity: ActiveIdentity, db: Database) -> CaseView:
    require_permission(identity, Permission.VIEW)
    return view(find_case(db, identity.tenant.id, case_id))


@router.patch("/{case_id}")
def update_case_license(
    case_id: str, data: CaseLicense, identity: WriteIdentity, db: Database
) -> CaseView:
    require_permission(identity, Permission.MANAGE)
    item = find_case(db, identity.tenant.id, case_id, lock=True)
    check_version(item.version, data.expected_version)
    if data.usage_scope and not data.usage_purposes:
        reject("usage_purposes", "case_scope_required")
    item.usage_scope = data.usage_scope or None
    item.usage_purposes = list(dict.fromkeys(data.usage_purposes)) if data.usage_scope else []
    item.version += 1
    db.commit()
    return view(item)


@router.get("/{case_id}/preview", response_class=Response)
def case_preview(
    case_id: str, request: Request, identity: ActiveIdentity, db: Database, storage: Storage
) -> Response:
    require_permission(identity, Permission.VIEW)
    item = find_case(db, identity.tenant.id, case_id)
    file = ready_file(db, identity.tenant.id, item.file_id, "file_id")
    if file.version != item.file_version:
        raise HTTPException(404, "case_preview_unavailable")
    if item.media == "image":
        from app.modules.assets.preview import image_preview

        key = file.object_key
        if key is None:
            raise HTTPException(404, "case_preview_unavailable")
        db.rollback()
        return image_preview(storage, key, max_bytes=20 * 1024 * 1024)
    require_permission(identity, Permission.DOWNLOAD)
    return stream_private_file(file, request, identity, db, storage, inline=True)
