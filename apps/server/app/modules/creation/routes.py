from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.sql.elements import ColumnElement

from app.modules.identity.domain import Permission
from app.modules.identity.models import new_id
from app.modules.identity.security import (
    ActiveIdentity,
    Database,
    WriteIdentity,
    require_permission,
)
from app.modules.products.service import get_fact
from app.modules.tasks.service import get_task
from app.modules.templates.schemas import VersionInput
from app.shared.studio_errors import check_version, reject

from .capabilities import MAX_OUTPUTS, MODEL, SIZES, ImageParameters, validate_parameters
from .models import Creation
from .references import resolve_reference
from .schemas import (
    ApplyTemplate,
    Capabilities,
    CreationCreate,
    CreationEdit,
    CreationEntry,
    CreationView,
    InputSnapshot,
    Readiness,
    ReferenceCreate,
    ReferenceEdit,
    ReuseDraft,
    VideoParameters,
)
from .service import (
    apply_template,
    build_input_snapshot,
    get_creation,
    member_product,
    readiness,
    reuse_configuration,
    save,
    view,
)

router = APIRouter(tags=["共用创作草稿"])


def entry_filter(entry: CreationEntry) -> ColumnElement[bool]:
    if entry == "quick":
        return or_(Creation.entry == entry, Creation.entry.is_(None))
    return Creation.entry == entry


@router.get("/creation-capabilities")
def get_creation_capabilities(identity: ActiveIdentity) -> Capabilities:
    require_permission(identity, Permission.VIEW)
    return Capabilities(model=MODEL, max_outputs=MAX_OUTPUTS, sizes=SIZES)


@router.get("/tasks/{task_id}/creations")
def list_creations(
    task_id: str,
    identity: ActiveIdentity,
    db: Database,
    primary: bool = True,
    cursor: Annotated[str, Query(max_length=36)] = "",
    entry: CreationEntry = "quick",
) -> list[CreationView]:
    require_permission(identity, Permission.VIEW)
    tenant = identity.tenant.id
    get_task(db, tenant, task_id)
    query = select(Creation).where(
        Creation.tenant_id == tenant,
        Creation.task_id == task_id,
        Creation.id > cursor,
        entry_filter(entry),
    )
    if primary:
        query = query.where(Creation.slot.in_(("primary", f"{entry}-primary")))
    return [view(item) for item in db.scalars(query.order_by(Creation.id).limit(100))]


@router.post("/tasks/{task_id}/creations", status_code=201)
def create_creation(
    task_id: str, data: CreationCreate, identity: WriteIdentity, db: Database
) -> CreationView:
    require_permission(identity, Permission.CREATE)
    tenant = identity.tenant.id
    get_task(db, tenant, task_id, lock=True)
    product = member_product(db, tenant, task_id, data.product_id)
    if data.primary:
        existing = db.scalar(
            select(Creation)
            .where(
                Creation.tenant_id == tenant,
                Creation.task_id == task_id,
                Creation.product_id == product.id,
                Creation.purpose == data.purpose,
                Creation.slot.in_(("primary", f"{data.entry}-primary")),
                entry_filter(data.entry),
            )
            .with_for_update()
        )
        if existing is not None:
            return view(existing)
    fact = get_fact(db, product, product.fact_version)
    if data.purpose != "video":
        if data.video_parameters is not None:
            reject("video_parameters", "parameters_media_mismatch")
        validate_parameters(data.parameters, len(fact.photos))
    item = Creation(
        tenant_id=tenant,
        task_id=task_id,
        product_id=product.id,
        purpose=data.purpose,
        prompt=data.prompt,
        parameters=data.parameters.model_dump(),
        video_parameters=(data.video_parameters or VideoParameters()).model_dump()
        if data.purpose == "video"
        else None,
        slot=f"{data.entry}-primary" if data.primary else new_id(),
        entry=data.entry,
    )
    db.add(item)
    db.commit()
    return view(item)


@router.get("/creations/{creation_id}")
def read_creation(creation_id: str, identity: ActiveIdentity, db: Database) -> CreationView:
    require_permission(identity, Permission.VIEW)
    return view(get_creation(db, identity.tenant.id, creation_id))


def editable(db: Database, identity: WriteIdentity, identifier: str, expected: int) -> Creation:
    require_permission(identity, Permission.CREATE)
    item = get_creation(db, identity.tenant.id, identifier, lock=True)
    check_version(item.version, expected)
    return item


@router.post("/creations/{creation_id}/reuse")
def reuse_draft(
    creation_id: str, data: ReuseDraft, identity: WriteIdentity, db: Database
) -> CreationView:
    require_permission(identity, Permission.CREATE)
    tenant = identity.tenant.id
    target = get_creation(db, tenant, creation_id)
    get_task(db, tenant, target.task_id, lock=True)
    db.expire(target)
    target = editable(db, identity, creation_id, data.expected_version)
    source = get_creation(db, tenant, data.source_id, lock=True)
    if source.task_id != target.task_id:
        raise HTTPException(404, "creation_not_found")
    check_version(source.version, data.source_version)
    return reuse_configuration(db, target, source)


@router.patch("/creations/{creation_id}")
def edit_creation(
    creation_id: str, data: CreationEdit, identity: WriteIdentity, db: Database
) -> CreationView:
    item = editable(db, identity, creation_id, data.expected_version)
    draft = view(item)
    product = member_product(db, item.tenant_id, item.task_id, item.product_id)
    if data.prompt is not None:
        item.prompt = data.prompt
    if data.video_parameters is not None:
        if item.purpose != "video":
            reject("video_parameters", "parameters_media_mismatch")
        item.video_parameters = data.video_parameters.model_dump()
    if data.parameters is not None and item.purpose == "video":
        reject("parameters", "parameters_media_mismatch")
    return save(
        db,
        item,
        product,
        draft.references,
        data.parameters or draft.parameters,
        validate_sources=False,
    )


@router.post("/creations/{creation_id}/template")
def apply_creation_template(
    creation_id: str, data: ApplyTemplate, identity: WriteIdentity, db: Database
) -> CreationView:
    item = editable(db, identity, creation_id, data.expected_version)
    return apply_template(
        db, item, member_product(db, item.tenant_id, item.task_id, item.product_id), data
    )


@router.get("/creations/{creation_id}/readiness")
def creation_readiness(creation_id: str, identity: ActiveIdentity, db: Database) -> Readiness:
    require_permission(identity, Permission.VIEW)
    return Readiness(issues=readiness(db, get_creation(db, identity.tenant.id, creation_id)))


@router.get("/creations/{creation_id}/input-snapshot")
def input_snapshot(creation_id: str, identity: ActiveIdentity, db: Database) -> InputSnapshot:
    require_permission(identity, Permission.VIEW)
    return build_input_snapshot(db, get_creation(db, identity.tenant.id, creation_id))


@router.post("/creations/{creation_id}/references")
def add_creation_reference(
    creation_id: str, data: ReferenceCreate, identity: WriteIdentity, db: Database
) -> CreationView:
    require_permission(identity, Permission.CREATE)
    target = get_creation(db, identity.tenant.id, creation_id)
    get_task(db, target.tenant_id, target.task_id, lock=True)
    db.expire(target)
    item = editable(db, identity, creation_id, data.expected_version)
    draft = view(item)
    product = member_product(db, item.tenant_id, item.task_id, item.product_id)
    field = f"references.{len(draft.references)}"
    reference = resolve_reference(db, product, data, field, item.purpose, draft=item)
    if (data.file_version is not None and data.file_version != reference.file_version) or (
        data.source_version is not None and data.source_version != reference.source_version
    ):
        reject(field, "reference_version_invalid")
    if any(ref.file_id == reference.file_id for ref in draft.references):
        reject(field, "reference_duplicate")
    return save(db, item, product, [*draft.references, reference], draft.parameters)


@router.patch("/creations/{creation_id}/references/{reference_id}")
def edit_creation_reference(
    creation_id: str, reference_id: str, data: ReferenceEdit, identity: WriteIdentity, db: Database
) -> CreationView:
    require_permission(identity, Permission.CREATE)
    target = get_creation(db, identity.tenant.id, creation_id)
    get_task(db, target.tenant_id, target.task_id, lock=True)
    db.expire(target)
    item = editable(db, identity, creation_id, data.expected_version)
    draft = view(item)
    reference = next((ref for ref in draft.references if ref.id == reference_id), None)
    if reference is None:
        raise HTTPException(404, "reference_not_found")
    if reference.origin == "template":
        reject("references", "template_reference_read_only")
    reference.usage = data.usage
    product = member_product(db, item.tenant_id, item.task_id, item.product_id)
    return save(db, item, product, draft.references, draft.parameters)


@router.delete("/creations/{creation_id}/references/{reference_id}")
def delete_creation_reference(
    creation_id: str,
    reference_id: str,
    identity: WriteIdentity,
    db: Database,
    expected_version: Annotated[int, Query(ge=1)],
) -> CreationView:
    item = editable(db, identity, creation_id, expected_version)
    draft = view(item)
    reference = next((ref for ref in draft.references if ref.id == reference_id), None)
    if reference is None:
        raise HTTPException(404, "reference_not_found")
    if reference.origin == "template":
        reject("references", "template_reference_read_only")
    product = member_product(db, item.tenant_id, item.task_id, item.product_id)
    return save(
        db,
        item,
        product,
        [ref for ref in draft.references if ref.id != reference_id],
        ImageParameters.model_validate(item.parameters),
        validate_sources=False,
    )


@router.post("/creations/{creation_id}/template/clear")
def clear_creation_template(
    creation_id: str, data: VersionInput, identity: WriteIdentity, db: Database
) -> CreationView:
    item = editable(db, identity, creation_id, data.expected_version)
    draft = view(item)
    product = member_product(db, item.tenant_id, item.task_id, item.product_id)
    item.template_id = None
    item.template_version = None
    return save(
        db,
        item,
        product,
        [ref for ref in draft.references if ref.origin == "independent"],
        draft.parameters,
        validate_sources=False,
    )
