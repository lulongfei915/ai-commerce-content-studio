from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response
from sqlalchemy import or_, select
from sqlalchemy.sql.elements import ColumnElement

from app.modules.assets.preview import image_preview
from app.modules.assets.routes import Storage
from app.modules.cases.service import ready_file
from app.modules.identity.domain import Permission
from app.modules.identity.models import new_id
from app.modules.identity.security import (
    ActiveIdentity,
    AppSettings,
    Database,
    WriteIdentity,
    require_permission,
)
from app.modules.identity.team import record
from app.modules.products.service import get_fact
from app.modules.tasks.models import DeliveryPosition
from app.modules.tasks.service import get_task
from app.modules.templates.schemas import VersionInput
from app.shared.studio_errors import check_version, reject

from .batch_domain import BatchConfig, apply_public, media_for, override, require_unsubmitted
from .capabilities import (
    MAX_OUTPUTS,
    MODEL,
    SIZES,
    ImageParameters,
    image_models,
    validate_parameters,
)
from .models import Creation, CreationOutput
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
    StoryboardInput,
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
    uses_explicit_image_references,
    view,
)

router = APIRouter(tags=["共用创作草稿"])


def entry_filter(entry: CreationEntry) -> ColumnElement[bool]:
    if entry == "quick":
        return or_(Creation.entry == entry, Creation.entry.is_(None))
    return (Creation.entry == entry) & Creation.discarded.is_(False)


@router.get("/creation-capabilities")
def get_creation_capabilities(identity: ActiveIdentity, settings: AppSettings) -> Capabilities:
    require_permission(identity, Permission.VIEW)
    return Capabilities(
        model=MODEL, max_outputs=MAX_OUTPUTS, sizes=SIZES, models=image_models(settings),
        video_models=["seedance-2.0"] + (["seedance-2.5"] if settings.ark_video_25_model else []),
    )


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
    position = None
    if data.position_id:
        position = db.scalar(select(DeliveryPosition).where(
            DeliveryPosition.id == data.position_id,
            DeliveryPosition.task_id == task_id,
            DeliveryPosition.product_id == product.id,
            DeliveryPosition.purpose == data.purpose,
        ))
        if data.entry != "batch" or not position:
            raise HTTPException(422, "position_unavailable")
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
    if data.purpose != "video":
        if data.video_parameters is not None:
            reject("video_parameters", "parameters_media_mismatch")
        photo_count = (
            0
            if uses_explicit_image_references(data.entry, data.purpose)
            else len(get_fact(db, product, product.fact_version).photos)
        )
        validate_parameters(data.parameters, photo_count)
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
        batch_position_id=data.position_id,
    )
    if data.entry == "batch":
        parameters = data.video_parameters if data.purpose == "video" else data.parameters
        item.batch_overrides = []
        if data.prompt:
            override(item, "prompt")
        if parameters:
            override(item, *parameters.model_fields_set)
        config = db.get(BatchConfig, (task_id, media_for(item)))
        if config:
            apply_public(item, config.values)
        if position and position.ratio and position.resolution and data.purpose != "video":
            item.parameters = {
                **item.parameters, "ratio": position.ratio, "resolution": position.resolution,
            }
            override(item, "ratio", "resolution")
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
    require_unsubmitted(db, item)
    return item


@router.post("/creations/{creation_id}/storyboard")
def confirm_storyboard(
    creation_id: str, data: StoryboardInput, identity: WriteIdentity, db: Database,
) -> CreationView:
    from app.modules.execution.service import position_for, position_version

    target = get_creation(db, identity.tenant.id, creation_id)
    get_task(db, target.tenant_id, target.task_id, lock=True)
    item = editable(db, identity, creation_id, data.expected_version)
    if item.purpose != "video":
        reject("shots", "parameters_media_mismatch")
    source = build_input_snapshot(db, item)
    product = member_product(db, item.tenant_id, item.task_id, item.product_id)
    facts = get_fact(db, product, source.product_fact_version).facts
    params = source.draft.video_parameters or VideoParameters()
    if sum(shot.duration for shot in data.shots) != params.duration:
        reject("shots", "storyboard_duration_mismatch")
    for index, shot in enumerate(data.shots):
        if (shot.narration and not shot.fact_keys) or any(
            key not in facts or not facts[key].get("value") or not facts[key].get("evidence")
            for key in shot.fact_keys
        ):
            reject(f"shots.{index}.fact_keys", "storyboard_fact_required")
    position = position_for(db, item, data.position_id)
    if not position or (item.batch_position_id and item.batch_position_id != position.id):
        raise HTTPException(422, "position_unavailable")
    item.version += 1
    item.storyboard = {
        "position_id": position.id,
        "shots": [shot.model_dump() for shot in data.shots],
        "confirmed_version": item.version,
        "product_fact_version": source.product_fact_version,
        "position_version": position_version(position),
    }
    db.commit()
    return view(item)


@router.post("/creations/{creation_id}/storyboard/clear")
def clear_storyboard(
    creation_id: str, data: VersionInput, identity: WriteIdentity, db: Database,
) -> CreationView:
    item = editable(db, identity, creation_id, data.expected_version)
    item.storyboard = None
    item.version += 1
    db.commit()
    return view(item)


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
    if source.entry == "batch":
        reject("source_id", "draft_incompatible")
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
        if data.prompt != item.prompt:
            override(item, "prompt")
        item.prompt = data.prompt
    if data.video_parameters is not None:
        if item.purpose != "video":
            reject("video_parameters", "parameters_media_mismatch")
        item.video_parameters = data.video_parameters.model_dump()
        override(item, *(
            key for key, value in item.video_parameters.items()
            if draft.video_parameters is None or getattr(draft.video_parameters, key) != value
        ))
    if data.parameters is not None and item.purpose == "video":
        reject("parameters", "parameters_media_mismatch")
    if data.parameters is not None:
        override(item, *(
            key for key, value in data.parameters.model_dump().items()
            if getattr(draft.parameters, key) != value
        ))
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
    refs = draft.references
    if data.company_library and item.entry == "batch" and data.kind == "result":
        if db.scalar(
            select(CreationOutput.id).where(CreationOutput.creation_id == item.id).limit(1)
        ):
            raise HTTPException(409, "batch_item_submitted")
        replaced = [r for r in refs if r.origin == "independent" and r.usage == "expression"]
        for old in replaced:
            item.prompt = item.prompt.replace(f"[[ref:{old.id}]]", f"[[ref:{reference.id}]]")
        refs = [r for r in refs if r not in replaced]
    if data.kind == "result":
        detail = f"{product.sku} · {reference.label} · V{reference.source_version}"
        record(db, identity, "引用公司素材", detail)
    return save(db, item, product, [*refs, reference], draft.parameters)


@router.get(
    "/creations/{creation_id}/references/{reference_id}/preview",
    operation_id="previewCreationReference",
    response_class=Response,
    responses={
        200: {"content": {"image/jpeg": {"schema": {"type": "string", "format": "binary"}}}}
    },
)
def preview_creation_reference(
    creation_id: str, reference_id: str, identity: ActiveIdentity, db: Database, storage: Storage
) -> Response:
    require_permission(identity, Permission.VIEW)
    item = get_creation(db, identity.tenant.id, creation_id)
    ref = next((ref for ref in view(item).references if ref.id == reference_id), None)
    if ref is None or ref.media != "image":
        raise HTTPException(404, "reference_not_found")
    product = member_product(db, item.tenant_id, item.task_id, item.product_id)
    resolved = resolve_reference(db, product, ref, "references", item.purpose, draft=item)
    if (resolved.file_id, resolved.file_version, resolved.source_version) != (
        ref.file_id,
        ref.file_version,
        ref.source_version,
    ):
        reject("references", "reference_version_invalid")
    key = ready_file(db, item.tenant_id, resolved.file_id, "references").object_key
    assert key is not None
    db.rollback()
    return image_preview(storage, key)


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
