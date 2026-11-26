from datetime import datetime
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import Field
from sqlalchemy import select

from app.modules.creation.models import CreationOutput
from app.modules.creation.service import get_creation
from app.modules.delivery.service import has_reservation
from app.modules.identity.domain import Permission
from app.modules.identity.security import (
    ActiveIdentity,
    AppSettings,
    Database,
    WriteIdentity,
    require_permission,
)
from app.modules.identity.team import record
from app.modules.products.schemas import WriteSchema
from app.modules.tasks.service import get_task

from .models import Execution, ImageStep
from .service import (
    ExecutionState,
    Submission,
    image_ceiling,
    lock_budget,
    position_for,
    require_budget,
    require_video_provider,
    state,
    submit,
)

router = APIRouter(tags=["生成执行"])


class Reconciliation(WriteSchema):
    provider_id: str = Field(min_length=1, max_length=200)
    actual_cents: int = Field(ge=0)
    outcome: Literal["billed", "not_accepted"]
    evidence: str = Field(min_length=1, max_length=500)


@router.post("/outputs/{identifier}/reconcile")
def reconcile(
    identifier: str, data: Reconciliation, identity: WriteIdentity, db: Database
) -> ExecutionState:
    require_permission(identity, Permission.MANAGE)
    step, output, job = lookup(db, identity.tenant.id, identifier)
    if step.fee_state != "unverified" or (
        step.provider_id and step.provider_id != data.provider_id
    ):
        raise HTTPException(409, "reconciliation_conflict")
    if data.outcome == "not_accepted" and (data.actual_cents or output.status != "unknown"):
        raise HTTPException(409, "reconciliation_conflict")
    step.provider_id, step.actual_cents, step.fee_state = (
        data.provider_id,
        data.actual_cents,
        "settled",
    )
    step.reconciliation = {**data.model_dump(), "user_id": identity.user.id}
    if output.status == "unknown":
        output.status = (
            "generation_failed" if data.outcome == "not_accepted" else "result_unavailable"
        )
    record(db, identity, "核实生成费用", identifier)
    db.commit()
    return state(db, job)


def lookup(
    db: Database, tenant: str, identifier: str
) -> tuple[ImageStep, CreationOutput, Execution]:
    row = db.execute(
        select(ImageStep, CreationOutput, Execution)
        .join(CreationOutput, CreationOutput.id == ImageStep.output_id)
        .join(Execution, Execution.id == ImageStep.execution_id)
        .where(Execution.tenant_id == tenant, ImageStep.output_id == identifier)
        .with_for_update()
    ).first()
    if not row:
        raise HTTPException(404, "output_not_found")
    return row[0], row[1], row[2]


@router.post("/outputs/{identifier}/retry")
def retry(
    identifier: str, identity: WriteIdentity, db: Database, settings: AppSettings
) -> ExecutionState:
    require_permission(identity, Permission.CREATE)
    lock_budget(db, identity.tenant.id)
    step, output, job = lookup(db, identity.tenant.id, identifier)
    following = {"save_failed": "saving", "generation_failed": "queued"}
    if output.status not in following:
        raise HTTPException(409, "retry_unavailable")
    if step.lease and step.lease > datetime.utcnow():
        raise HTTPException(
            429,
            "retry_deferred",
            headers={
                "Retry-After": str(max(1, int((step.lease - datetime.utcnow()).total_seconds())))
            },
        )
    is_video = job.snapshot.get("media") == "video"
    if is_video and output.status == "generation_failed":
        if step.actual_cents != 0 or step.provider_id:
            raise HTTPException(409, "retry_unavailable")
        require_video_provider(settings)
    if output.status == "generation_failed" and step.actual_cents == 0:
        ceiling = settings.video_ceiling_cents if is_video else image_ceiling(
            settings, job.snapshot.get("provider", "ark")
        )
        require_budget(
            db, identity.tenant.id, settings, ceiling, for_image=not is_video, for_video=is_video,
        )
        step.reserved_cents, step.actual_cents, step.fee_state = (
            ceiling,
            None,
            "reserved",
        )
    output.status, step.error, step.lease = following[output.status], None, None
    record(db, identity, "恢复生成输出", identifier)
    db.commit()
    return state(db, job)


@router.get("/creations/{creation_id}/executions")
def history(creation_id: str, identity: ActiveIdentity, db: Database) -> list[ExecutionState]:
    require_permission(identity, Permission.VIEW)
    get_creation(db, identity.tenant.id, creation_id)
    jobs = db.scalars(
        select(Execution)
        .where(Execution.creation_id == creation_id, Execution.tenant_id == identity.tenant.id)
        .order_by(Execution.created_at.desc())
        .limit(10)
    )
    return [state(db, job) for job in jobs]


@router.post("/creations/{creation_id}/executions", status_code=202)
def start(
    creation_id: str, data: Submission, identity: WriteIdentity, db: Database, settings: AppSettings
) -> ExecutionState:
    require_permission(identity, Permission.CREATE)
    return submit(db, identity.tenant.id, identity.user.id, creation_id, data, settings)


def job_for(db: Database, tenant: str, identifier: str) -> Execution:
    job = db.scalar(
        select(Execution).where(Execution.tenant_id == tenant, Execution.id == identifier)
    )
    if not job:
        raise HTTPException(404, "execution_not_found")
    return job


@router.get("/executions/{execution_id}")
def progress(execution_id: str, identity: ActiveIdentity, db: Database) -> ExecutionState:
    require_permission(identity, Permission.VIEW)
    return state(db, job_for(db, identity.tenant.id, execution_id))


@router.post("/executions/{execution_id}/cancel")
def cancel(execution_id: str, identity: WriteIdentity, db: Database) -> ExecutionState:
    require_permission(identity, Permission.CREATE)
    lock_budget(db, identity.tenant.id)
    job = job_for(db, identity.tenant.id, execution_id)
    draft = get_creation(db, identity.tenant.id, job.creation_id)
    get_task(db, identity.tenant.id, draft.task_id, lock=True)
    position = position_for(db, draft, job.position_id) if job.position_id else None
    for output, step in db.execute(
        select(CreationOutput, ImageStep)
        .join(ImageStep)
        .where(ImageStep.execution_id == job.id)
        .with_for_update()
    ):
        if output.status == "queued":
            output.status = "cancelled"
            step.fee_state, step.actual_cents = "released", 0
    db.flush()
    if position and position.status == "reserved" and not has_reservation(db, position.id):
        position.status = "unfilled"
    record(db, identity, "取消未发出输出", job.id)
    db.commit()
    return state(db, job)
