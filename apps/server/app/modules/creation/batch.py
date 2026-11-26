from hashlib import sha256
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.modules.execution.models import Execution
from app.modules.execution.service import ExecutionState, Submission, lock_budget, state, submit
from app.modules.identity.domain import Permission
from app.modules.identity.models import new_id
from app.modules.identity.security import (
    ActiveIdentity,
    AppSettings,
    Database,
    WriteIdentity,
    require_permission,
)
from app.modules.products.schemas import ResourceId, WriteSchema
from app.modules.tasks.models import DeliveryPosition
from app.modules.tasks.service import get_task
from app.modules.templates.schemas import VersionInput
from app.shared.studio_errors import check_version

from .batch_domain import (
    BatchConfig,
    BatchRequest,
    apply_public,
    media_for,
    override,
    require_unsubmitted,
    submitted,
)
from .capabilities import ImageParameters, validate_parameters
from .models import Creation
from .schemas import CreationView, VideoParameters
from .service import REFERENCE_TAG, get_creation, member_product, reuse_configuration, view

router = APIRouter(prefix="/tasks/{task_id}/batches", tags=["批量制作"])
Media = Literal["image", "video"]


class PublicConfig(WriteSchema):
    prompt: str = Field(default="", max_length=6000)
    count: int = Field(default=1, ge=1, le=6)
    ratio: str | None = None
    resolution: str | None = None


class PublicEdit(PublicConfig):
    expected_version: int = Field(ge=0)


class PublicState(PublicConfig):
    version: int


class ItemInput(WriteSchema):
    id: ResourceId
    expected_version: int = Field(ge=1)


class BatchSubmission(WriteSchema):
    idempotency_key: str = Field(min_length=1, max_length=100)
    items: list[ItemInput] = Field(min_length=1, max_length=100)


class ItemExecution(BaseModel):
    item_id: str
    execution: ExecutionState


class ItemScope(VersionInput):
    position_id: ResourceId


class ItemRestore(VersionInput):
    field: Literal["prompt", "count", "size"] | None = None


def config_view(config: BatchConfig | None) -> PublicState:
    if config:
        return PublicState(version=config.version, **config.values)
    return PublicState(version=0)


@router.get("/{media}")
def public_config(
    task_id: str, media: Media, identity: ActiveIdentity, db: Database
) -> PublicState:
    require_permission(identity, Permission.VIEW)
    get_task(db, identity.tenant.id, task_id)
    return config_view(db.get(BatchConfig, (task_id, media)))


@router.put("/{media}")
def edit_public(
    task_id: str, media: Media, data: PublicEdit, identity: WriteIdentity, db: Database
) -> PublicState:
    require_permission(identity, Permission.CREATE)
    get_task(db, identity.tenant.id, task_id, lock=True)
    config = db.get(BatchConfig, (task_id, media), with_for_update=True)
    check_version(config.version if config else 0, data.expected_version)
    values = data.model_dump(exclude={"expected_version"}, exclude_none=True)
    if data.ratio is not None or data.resolution is not None:
        if media != "image" or data.ratio is None or data.resolution is None:
            raise HTTPException(422, "invalid_batch_specification")
        validate_parameters(ImageParameters(ratio=data.ratio, resolution=data.resolution))
    if media == "video" and data.count != 1:
        raise HTTPException(422, "output_count_unsupported")
    defaults = ImageParameters()
    inherited = (
        {"ratio": defaults.ratio, "resolution": defaults.resolution, **values}
        if media == "image" else values
    )
    if not config:
        config = BatchConfig(task_id=task_id, media=media, version=0, values=values)
        db.add(config)
    config.values = values
    config.version += 1
    for item in db.scalars(
        select(Creation).where(
            Creation.task_id == task_id,
            Creation.entry == "batch",
            Creation.discarded.is_(False),
            (Creation.purpose == "video") == (media == "video"),
        ).order_by(Creation.id).with_for_update()
    ):
        if not submitted(db, item) and apply_public(item, inherited):
            if media == "image":
                validate_parameters(ImageParameters.model_validate(item.parameters))
            item.version += 1
    db.commit()
    return config_view(config)


def editable_item(
    db: Database, identity: WriteIdentity, task_id: str, media: Media, item_id: str, expected: int,
    *, allow_submitted: bool = False,
) -> Creation:
    require_permission(identity, Permission.CREATE)
    tenant = identity.tenant.id
    get_task(db, tenant, task_id, lock=True)
    item = get_creation(db, tenant, item_id, lock=True)
    if item.task_id != task_id or item.entry != "batch" or media_for(item) != media:
        raise HTTPException(404, "creation_not_found")
    check_version(item.version, expected)
    if not allow_submitted:
        require_unsubmitted(db, item)
    return item


@router.patch("/{media}/items/{item_id}")
def change_scope(
    task_id: str, media: Media, item_id: str, data: ItemScope,
    identity: WriteIdentity, db: Database,
) -> CreationView:
    item = editable_item(db, identity, task_id, media, item_id, data.expected_version)
    position = db.scalar(select(DeliveryPosition).where(
        DeliveryPosition.task_id == task_id, DeliveryPosition.id == data.position_id,
    ))
    if not position or (position.purpose == "video") != (media == "video"):
        raise HTTPException(422, "position_unavailable")
    member_product(db, item.tenant_id, task_id, position.product_id)
    if (item.product_id, item.purpose) != (position.product_id, position.purpose):
        item.references = []
        item.template_id = item.template_version = None
        item.prompt = REFERENCE_TAG.sub("", item.prompt)
    item.product_id, item.purpose, item.batch_position_id = (
        position.product_id, position.purpose, position.id,
    )
    if media == "image" and position.ratio and position.resolution:
        item.parameters = {
            **item.parameters, "ratio": position.ratio, "resolution": position.resolution,
        }
        override(item, "ratio", "resolution")
    item.version += 1
    db.commit()
    return view(item)


@router.post("/{media}/items/{item_id}/copy", status_code=201)
def copy_item(
    task_id: str, media: Media, item_id: str, data: VersionInput,
    identity: WriteIdentity, db: Database,
) -> CreationView:
    source = editable_item(
        db, identity, task_id, media, item_id, data.expected_version, allow_submitted=True,
    )
    target = Creation(
        tenant_id=source.tenant_id, task_id=task_id, product_id=source.product_id,
        purpose=source.purpose, slot=new_id(), entry="batch",
        prompt="", parameters=source.parameters, video_parameters=source.video_parameters,
        batch_overrides=[],
    )
    db.add(target)
    return reuse_configuration(db, target, source)


@router.post("/{media}/items/{item_id}/restore")
def restore_item(
    task_id: str, media: Media, item_id: str, data: ItemRestore,
    identity: WriteIdentity, db: Database,
) -> CreationView:
    item = editable_item(db, identity, task_id, media, item_id, data.expected_version)
    config = db.get(BatchConfig, (task_id, media))
    defaults = (VideoParameters() if media == "video" else ImageParameters()).model_dump()
    public = {"prompt": "", **defaults, **(config.values if config else {})}
    if data.field:
        keys = ("ratio", "resolution") if data.field == "size" else (data.field,)
        overrides = item.batch_overrides
        if overrides is None:
            overrides = list(public)
        item.batch_overrides = [key for key in overrides if key not in keys]
        apply_public(item, {key: public[key] for key in keys})
    else:
        item.parameters = ImageParameters().model_dump()
        if media == "video":
            item.video_parameters = defaults
        item.references = []
        item.template_id = item.template_version = None
        item.batch_overrides = []
        apply_public(item, public)
    if media == "image":
        validate_parameters(ImageParameters.model_validate(item.parameters))
    item.version += 1
    db.commit()
    return view(item)


@router.delete("/{media}/items/{item_id}", status_code=204)
def discard_item(
    task_id: str, media: Media, item_id: str, identity: WriteIdentity,
    db: Database, expected_version: int = Query(ge=1),
) -> None:
    item = editable_item(db, identity, task_id, media, item_id, expected_version)
    item.discarded = True
    item.slot = f"discarded-{item.id[:25]}"
    db.commit()


@router.get("/{media}/executions")
def history(
    task_id: str, media: Media, identity: ActiveIdentity, db: Database
) -> list[ItemExecution]:
    require_permission(identity, Permission.VIEW)
    get_task(db, identity.tenant.id, task_id)
    jobs = db.scalars(
        select(Execution).join(Creation).where(
            Creation.task_id == task_id,
            Creation.entry == "batch",
            (Creation.purpose == "video") == (media == "video"),
            Execution.parent_output.is_(None),
        ).order_by(Execution.created_at, Execution.id)
    ).all()
    return [ItemExecution(item_id=job.creation_id, execution=state(db, job)) for job in jobs]


@router.post("/image/executions", status_code=202)
def start(
    task_id: str, data: BatchSubmission, identity: WriteIdentity,
    db: Database, settings: AppSettings,
) -> list[ItemExecution]:
    require_permission(identity, Permission.CREATE)
    tenant = identity.tenant.id
    lock_budget(db, tenant)
    get_task(db, tenant, task_id, lock=True)
    items = [item.model_dump() for item in data.items]
    if len({item.id for item in data.items}) != len(items):
        raise HTTPException(422, "batch_item_duplicate")
    prior = db.get(BatchRequest, (task_id, data.idempotency_key), with_for_update=True)
    if prior:
        if prior.items != items:
            raise HTTPException(409, "idempotency_conflict")
        jobs = [db.get_one(Execution, identifier) for identifier in prior.executions]
        return [ItemExecution(item_id=job.creation_id, execution=state(db, job)) for job in jobs]
    results = []
    try:
        for request in data.items:
            try:
                item = get_creation(db, tenant, request.id, lock=True)
                if item.task_id != task_id or item.entry != "batch" or item.purpose == "video":
                    raise HTTPException(422, "invalid_batch_item")
                require_unsubmitted(db, item)
                key = sha256(f"{task_id}/{data.idempotency_key}/{item.id}".encode()).hexdigest()
                execution = submit(
                    db, tenant, identity.user.id, item.id,
                    Submission(
                        expected_version=request.expected_version,
                        idempotency_key=f"batch-{key}",
                        position_id=item.batch_position_id,
                    ),
                    settings, batch=True,
                )
            except HTTPException as exc:
                detail = exc.detail if isinstance(exc.detail, dict) else {"code": exc.detail}
                raise HTTPException(exc.status_code, {**detail, "item_id": request.id}) from exc
            results.append(ItemExecution(item_id=item.id, execution=execution))
        db.add(BatchRequest(
            task_id=task_id, key=data.idempotency_key, items=items,
            executions=[row.execution.id for row in results],
        ))
        db.commit()
    except Exception:
        db.rollback()
        raise
    return results
