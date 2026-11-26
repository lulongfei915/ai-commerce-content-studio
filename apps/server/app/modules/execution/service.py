from typing import Any, Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.commerce.models import ModelCall
from app.modules.creation.capabilities import validate_parameters
from app.modules.creation.models import Creation, CreationOutput
from app.modules.creation.results import asset_id_for
from app.modules.creation.schemas import InputSnapshot, VideoParameters
from app.modules.creation.service import REFERENCE_TAG, build_input_snapshot, get_creation
from app.modules.delivery.service import LABELS, has_reservation, module_for
from app.modules.identity.models import Tenant, User, new_id
from app.modules.identity.team import add_record
from app.modules.products.schemas import ResourceId
from app.modules.products.service import get_fact, get_product
from app.modules.tasks.models import DeliveryPosition
from app.modules.tasks.service import get_task
from app.modules.templates.schemas import VersionInput
from app.shared.config import Settings
from app.shared.studio_errors import check_version

from .models import Execution, ImageStep
from .sources import verify_sources


class Submission(VersionInput):
    idempotency_key: str = Field(min_length=1, max_length=100)
    position_id: ResourceId | None = None


class OutputState(BaseModel):
    id: str
    status: str
    fee_state: str
    error: str | None
    provider_id: str | None
    reserved_cents: int
    actual_cents: int | None
    result_size: str | None = None


class ExecutionState(BaseModel):
    id: str
    media: Literal["image", "video"] = "image"
    outputs: list[OutputState]


def state(db: Session, job: Execution) -> ExecutionState:
    rows = db.execute(
        select(CreationOutput, ImageStep)
        .join(ImageStep, ImageStep.output_id == CreationOutput.id)
        .where(ImageStep.execution_id == job.id)
        .order_by(CreationOutput.output_index)
    )
    return ExecutionState(
        id=job.id,
        media="video" if job.snapshot.get("media") == "video" else "image",
        outputs=[
            OutputState(
                id=o.id,
                status=o.status,
                fee_state=s.fee_state,
                error=s.error,
                provider_id=s.provider_id,
                reserved_cents=s.reserved_cents,
                actual_cents=s.actual_cents,
                result_size=s.result_size,
            )
            for o, s in rows
        ],
    )


def lock_budget(db: Session, tenant: str) -> None:
    db.execute(select(Tenant.id).where(Tenant.id == tenant).with_for_update())


def require_budget(
    db: Session, tenant: str, settings: Settings, amount: int, *,
    for_image: bool = False, for_video: bool = False,
) -> None:
    if for_video and settings.video_budget_unlimited:
        return
    budget = settings.video_budget_cents if for_video else settings.image_budget_cents
    missing = "video_budget_not_configured" if for_video else "budget_not_configured"
    if amount <= 0:
        raise HTTPException(402, missing)
    if for_image and settings.image_budget_unlimited:
        return
    if budget <= 0:
        raise HTTPException(402, missing)
    media = func.coalesce(Execution.snapshot["media"].as_string(), "image")
    rows = db.scalars(
        select(ImageStep).join(Execution).where(
            Execution.tenant_id == tenant, media == ("video" if for_video else "image"),
        ).with_for_update()
    )
    committed = sum(
        s.actual_cents if s.actual_cents is not None else s.reserved_cents for s in rows
    )
    if not for_video:
        committed += sum(
            db.scalars(
                select(ModelCall.reserved_cents).where(ModelCall.tenant_id == tenant)
                .with_for_update()
            )
        )
    if committed + amount > budget:
        raise HTTPException(402, "video_budget_unavailable" if for_video else "budget_unavailable")


def image_ceiling(settings: Settings, provider: str) -> int:
    if provider == "gpt-image" and settings.itaiapi_image_ceiling_cents is not None:
        return settings.itaiapi_image_ceiling_cents
    return settings.image_ceiling_cents


def require_video_provider(settings: Settings) -> None:
    if not settings.ark_api_key or not settings.ark_api_key.get_secret_value().strip():
        raise HTTPException(503, "video_provider_not_configured")


def video_snapshot(source: InputSnapshot, settings: Settings) -> dict[str, Any]:
    require_video_provider(settings)
    frames = [ref for ref in source.references if ref.usage in {"first_frame", "last_frame"}]
    if frames and (
        len(frames) != len(source.references) or {ref.usage for ref in frames} == {"last_frame"}
    ):
        raise HTTPException(422, "video_frame_combination_unsupported")
    if sum(ref.media == "video" for ref in source.references) > 3:
        raise HTTPException(422, "video_reference_limit")
    if sum(ref.media == "image" for ref in source.references) > 9:
        raise HTTPException(422, "video_reference_limit")
    if any(ref.media == "video" for ref in source.references) and not (
        settings.storage_signed_endpoint or ""
    ).startswith("https://"):
        raise HTTPException(503, "video_reference_storage_not_configured")
    ordered = (
        sorted(frames, key=lambda ref: ref.usage) if frames else source.references
    )
    labels = {}
    for media, label in (("image", "图片"), ("video", "视频")):
        labels.update({
            ref.id: f"{label}{index}"
            for index, ref in enumerate((ref for ref in ordered if ref.media == media), 1)
        })
    params = source.draft.video_parameters or VideoParameters()
    return {
        **source.model_dump(exclude={"references"}),
        "references": [ref.model_dump() for ref in ordered],
        "media": "video",
        "provider": "ark",
        "model": settings.ark_video_model,
        "video_request": {
            **params.model_dump(exclude={"model", "count"}),
            "prompt": REFERENCE_TAG.sub(lambda match: labels[match[1]], source.draft.prompt),
        },
    }


def submit(
    db: Session,
    tenant: str,
    user: str,
    identifier: str,
    data: Submission,
    settings: Settings,
    parent: CreationOutput | None = None,
    *,
    batch: bool = False,
) -> ExecutionState:
    lock_budget(db, tenant)
    scope = get_creation(db, tenant, identifier)
    get_task(db, tenant, scope.task_id, lock=True)
    draft = get_creation(db, tenant, identifier, lock=True)
    prior = db.scalar(
        select(Execution)
        .where(Execution.tenant_id == tenant, Execution.request_key == data.idempotency_key)
        .with_for_update()
    )
    if prior:
        if (
            prior.creation_id != identifier
            or prior.snapshot["draft"]["version"] != data.expected_version
            or prior.parent_output != (parent.id if parent else None)
            or prior.snapshot.get("requested_position") != data.position_id
        ):
            raise HTTPException(409, "idempotency_conflict")
        return state(db, prior)
    check_version(draft.version, data.expected_version)
    is_video = draft.purpose == "video"
    old_position = None
    if (draft.entry == "batch" and not (batch or parent)) or (is_video and (batch or parent)):
        raise HTTPException(422, "image_entry_required")
    count = 1 if parent or is_video else int(draft.parameters["count"])
    if is_video and db.scalar(
        select(CreationOutput.id)
        .join(Execution, Execution.id == CreationOutput.execution_id)
        .where(
            Execution.creation_id == draft.id,
            CreationOutput.status.in_(("queued", "generating", "saving")),
        )
        .limit(1).with_for_update()
    ):
        raise HTTPException(409, "video_execution_in_progress")
    if parent:
        old = db.get(Execution, parent.execution_id)
        step = db.get(ImageStep, parent.id)
        if not old or not step or parent.status != "rejected":
            raise HTTPException(409, "rework_unavailable")
        old_position = old.position_id
        snapshot = {**old.snapshot, "feedback": step.decision}
        snapshot["draft"] = {**snapshot["draft"], "version": data.expected_version}
    elif is_video:
        snapshot = video_snapshot(build_input_snapshot(db, draft, settings=settings), settings)
    else:
        source = build_input_snapshot(db, draft, settings=settings)
        params = source.draft.parameters
        size = validate_parameters(params, settings=settings)
        product = get_product(db, tenant, draft.product_id)
        snapshot = {
            **source.model_dump(),
            "facts": get_fact(db, product, source.product_fact_version).facts,
            "category": product.category,
            "provider": params.provider,
            "model": params.model if params.provider == "gpt-image" else settings.ark_image_model,
            "size": f"{size['width']}x{size['height']}",
            "quality": (params.quality or "low") if params.provider == "gpt-image" else None,
        }
    verify_sources(db, tenant, snapshot)
    position = None
    if is_video and data.position_id:
        raise HTTPException(422, "video_delivery_confirmation_required")
    if not is_video:
        position = position_for(db, draft, data.position_id or old_position)
        if not position and not parent:
            raise HTTPException(409, "position_unavailable")
        if position and not parent:
            if position.ratio and (
                (params.ratio, params.resolution) != (position.ratio, position.resolution)
            ):
                raise HTTPException(422, "delivery_spec_mismatch")
            if data.position_id and (
                has_reservation(db, position.id) or position.status == "adopted"
            ):
                raise HTTPException(409, "position_already_reserved")
            snapshot["delivery_module"] = module_for(position)
        snapshot["requested_position"] = data.position_id
    ceiling = (
        settings.video_ceiling_cents if is_video
        else image_ceiling(settings, snapshot.get("provider", "ark"))
    )
    require_budget(
        db, tenant, settings, count * ceiling, for_image=not is_video, for_video=is_video,
    )
    job = Execution(
        id=new_id(),
        tenant_id=tenant,
        creation_id=draft.id,
        user_id=user,
        request_key=data.idempotency_key,
        snapshot=snapshot,
        parent_output=parent.id if parent else None,
        position_id=position.id if position else None,
    )
    db.add(job)
    db.flush()
    for index in range(count):
        output = CreationOutput(
            id=new_id(),
            creation_id=draft.id,
            execution_id=job.id,
            output_index=parent.output_index if parent else index,
            asset_id=asset_id_for(parent) if parent else new_id(),
            version=(
                max(
                    parent.version,
                    db.scalar(
                        select(func.max(CreationOutput.version)).where(
                            CreationOutput.asset_id == asset_id_for(parent)
                        )
                    )
                    or 0,
                )
                + 1
                if parent
                else 1
            ),
            status="queued",
        )
        db.add(output)
        db.flush()
        db.add(
            ImageStep(
                output_id=output.id,
                execution_id=job.id,
                reserved_cents=ceiling,
            )
        )
    if position and position.status == "unfilled":
        position.status = "reserved"
    actor = db.get_one(User, user)
    action = "提交视频生成" if is_video else "提交图片返工" if parent else "提交图片生成"
    add_record(db, tenant, actor.email, action, f"{job.id} · {count}")
    if batch:
        db.flush()
    else:
        db.commit()
    return state(db, job)


def position_for(
    db: Session, draft: Creation, identifier: str | None = None
) -> DeliveryPosition | None:
    query = select(DeliveryPosition).where(
        DeliveryPosition.tenant_id == draft.tenant_id,
        DeliveryPosition.task_id == draft.task_id,
        DeliveryPosition.product_id == draft.product_id,
        DeliveryPosition.purpose == draft.purpose,
    )
    if identifier:
        query = query.where(DeliveryPosition.id == identifier)
    positions = list(db.scalars(query.order_by(DeliveryPosition.id).with_for_update()))
    if identifier:
        return positions[0] if positions else None
    return next(
        (p for p in positions if module_for(p) == LABELS[draft.purpose]),
        positions[0] if len(positions) == 1 else None,
    )
