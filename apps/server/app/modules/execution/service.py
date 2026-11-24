from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.commerce.models import ModelCall
from app.modules.creation.capabilities import validate_parameters
from app.modules.creation.models import Creation, CreationOutput
from app.modules.creation.results import asset_id_for
from app.modules.creation.service import build_input_snapshot, get_creation
from app.modules.identity.models import Tenant, new_id
from app.modules.products.service import get_fact, get_product
from app.modules.tasks.models import DeliveryPosition
from app.modules.templates.schemas import VersionInput
from app.shared.config import Settings
from app.shared.studio_errors import check_version

from .models import Execution, ImageStep
from .sources import verify_sources


class Submission(VersionInput):
    idempotency_key: str = Field(min_length=1, max_length=100)


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
    db: Session, tenant: str, settings: Settings, amount: int, *, for_image: bool = False
) -> None:
    if amount <= 0:
        raise HTTPException(402, "budget_not_configured")
    if for_image and settings.image_budget_unlimited:
        return
    if settings.image_budget_cents <= 0:
        raise HTTPException(402, "budget_not_configured")
    rows = db.scalars(
        select(ImageStep).join(Execution).where(Execution.tenant_id == tenant).with_for_update()
    )
    committed = sum(
        s.actual_cents if s.actual_cents is not None else s.reserved_cents for s in rows
    )
    committed += sum(
        db.scalars(
            select(ModelCall.reserved_cents).where(ModelCall.tenant_id == tenant).with_for_update()
        )
    )
    if committed + amount > settings.image_budget_cents:
        raise HTTPException(402, "budget_unavailable")


def image_ceiling(settings: Settings, provider: str) -> int:
    if provider == "gpt-image" and settings.itaiapi_image_ceiling_cents is not None:
        return settings.itaiapi_image_ceiling_cents
    return settings.image_ceiling_cents


def submit(
    db: Session,
    tenant: str,
    user: str,
    identifier: str,
    data: Submission,
    settings: Settings,
    parent: CreationOutput | None = None,
) -> ExecutionState:
    lock_budget(db, tenant)
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
        ):
            raise HTTPException(409, "idempotency_conflict")
        return state(db, prior)
    check_version(draft.version, data.expected_version)
    if draft.purpose == "video" or draft.entry == "batch":
        raise HTTPException(422, "image_entry_required")
    count = 1 if parent else int(draft.parameters["count"])
    if parent:
        old = db.get(Execution, parent.execution_id)
        step = db.get(ImageStep, parent.id)
        if not old or not step or parent.status != "rejected":
            raise HTTPException(409, "rework_unavailable")
        snapshot = {**old.snapshot, "feedback": step.decision}
        snapshot["draft"] = {**snapshot["draft"], "version": data.expected_version}
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
    ceiling = image_ceiling(settings, snapshot.get("provider", "ark"))
    require_budget(db, tenant, settings, count * ceiling, for_image=True)
    job = Execution(
        id=new_id(),
        tenant_id=tenant,
        creation_id=draft.id,
        user_id=user,
        request_key=data.idempotency_key,
        snapshot=snapshot,
        parent_output=parent.id if parent else None,
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
    position = position_for(db, draft)
    if position is None:
        raise HTTPException(409, "position_unavailable")
    if position.status == "unfilled":
        position.status = "reserved"
    db.commit()
    return state(db, job)


def position_for(db: Session, draft: Creation) -> DeliveryPosition | None:
    return db.scalar(
        select(DeliveryPosition)
        .where(
            DeliveryPosition.tenant_id == draft.tenant_id,
            DeliveryPosition.task_id == draft.task_id,
            DeliveryPosition.product_id == draft.product_id,
            DeliveryPosition.purpose == draft.purpose,
        )
        .with_for_update()
    )
