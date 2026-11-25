from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select

from app.modules.identity.domain import Permission
from app.modules.identity.security import (
    ActiveIdentity,
    Database,
    WriteIdentity,
    require_permission,
)
from app.modules.identity.team import record
from app.modules.products.schemas import Category
from app.shared.studio_errors import check_version

from .models import Template, TemplateVersion
from .schemas import (
    TemplateContent,
    TemplateEdit,
    TemplatePage,
    TemplatePurpose,
    TemplateStatus,
    TemplateView,
    VersionInput,
)
from .service import find_template, publish, version_content, view

router = APIRouter(prefix="/templates", tags=["公司模板"])


@router.get("")
def list_templates(
    identity: ActiveIdentity,
    db: Database,
    manage: bool = False,
    category: Category | None = None,
    purpose: TemplatePurpose | None = None,
    cursor: Annotated[str | None, Query(max_length=36)] = None,
) -> TemplatePage:
    require_permission(identity, Permission.MANAGE if manage else Permission.VIEW)
    query = select(Template).where(Template.tenant_id == identity.tenant.id)
    if not manage:
        query = query.where(Template.enabled.is_(True), Template.published_version.is_not(None))
        if category or purpose:
            query = query.join(
                TemplateVersion,
                (TemplateVersion.template_id == Template.id)
                & (TemplateVersion.number == Template.published_version),
            )
            if category:
                query = query.where(TemplateVersion.content["category"].as_string() == category)
            if purpose:
                query = query.where(TemplateVersion.content["purpose"].as_string() == purpose)
    if cursor:
        query = query.where(Template.id > cursor)
    page = list(db.scalars(query.order_by(Template.id).limit(31)))
    items = []
    for item in page[:30]:
        published = (
            version_content(db, item, item.published_version) if item.published_version else None
        )
        row = view(item, None if manage else published)
        if manage and published:
            row.published_content = published
            row.has_unpublished_changes = published != row.content
        items.append(row)
    return TemplatePage(items=items, next_cursor=page[29].id if len(page) > 30 else None)


@router.post("", status_code=201)
def create_template(data: TemplateContent, identity: WriteIdentity, db: Database) -> TemplateView:
    require_permission(identity, Permission.MANAGE)
    item = Template(tenant_id=identity.tenant.id, draft=data.model_dump())
    db.add(item)
    db.commit()
    return view(item)


@router.patch("/{template_id}")
def edit_template(
    template_id: str, data: TemplateEdit, identity: WriteIdentity, db: Database
) -> TemplateView:
    require_permission(identity, Permission.MANAGE)
    item = find_template(db, identity.tenant.id, template_id, lock=True)
    check_version(item.version, data.expected_version)
    item.draft = data.model_dump(exclude={"expected_version"})
    item.version += 1
    db.commit()
    return view(item)


@router.post("/{template_id}/publish")
def publish_template(
    template_id: str, data: VersionInput, identity: WriteIdentity, db: Database
) -> TemplateView:
    require_permission(identity, Permission.MANAGE)
    item = find_template(db, identity.tenant.id, template_id, lock=True)
    check_version(item.version, data.expected_version)
    record(db, identity, "发布模板", f"{item.draft['name']} · V{(item.published_version or 0) + 1}")
    return publish(db, item)


@router.post("/{template_id}/status")
def set_template_status(
    template_id: str, data: TemplateStatus, identity: WriteIdentity, db: Database
) -> TemplateView:
    require_permission(identity, Permission.MANAGE)
    item = find_template(db, identity.tenant.id, template_id, lock=True)
    check_version(item.version, data.expected_version)
    if item.published_version is None:
        raise HTTPException(409, "template_not_published")
    item.enabled = data.enabled
    record(db, identity, "启用模板" if data.enabled else "停用模板", item.draft["name"])
    item.version += 1
    db.commit()
    return view(item)


@router.get("/{template_id}/versions/{number}")
def get_template_version(
    template_id: str, number: int, identity: ActiveIdentity, db: Database
) -> TemplateContent:
    require_permission(identity, Permission.VIEW)
    return version_content(db, find_template(db, identity.tenant.id, template_id), number)
