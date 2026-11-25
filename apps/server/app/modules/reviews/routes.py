from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.assets.models import PrivateFile
from app.modules.creation.models import Creation, CreationOutput
from app.modules.creation.results import TaskResult, file_ready, result_view
from app.modules.delivery.service import fill_open_position, lock_matching_positions
from app.modules.execution.models import Execution, ImageStep
from app.modules.execution.service import ExecutionState, Submission, submit
from app.modules.execution.sources import verify_sources
from app.modules.identity.domain import Permission
from app.modules.identity.security import (
    ActiveIdentity,
    AppSettings,
    Database,
    WriteIdentity,
    require_permission,
)
from app.modules.products.facts import CATEGORIES
from app.modules.products.models import Product
from app.modules.products.schemas import WriteSchema
from app.modules.tasks.models import Task
from app.shared.studio_errors import check_version

router = APIRouter(tags=["图片审核"])


def version_for(
    db: Session, tenant: str, identifier: str, lock: bool = False
) -> tuple[CreationOutput, Creation]:
    query = (
        select(CreationOutput, Creation)
        .join(Creation)
        .where(Creation.tenant_id == tenant, CreationOutput.id == identifier)
    )
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    row = db.execute(query).first()
    if row is None:
        raise HTTPException(404, "asset_version_not_found")
    return row[0], row[1]


def list_versions(
    db: Session, tenant: str, status: str | None, product_id: str | None, task_id: str | None
) -> list[TaskResult]:
    query = (
        select(CreationOutput, Creation, PrivateFile, Product.sku, Product.category, Task.name)
        .join(Creation, Creation.id == CreationOutput.creation_id)
        .join(PrivateFile, PrivateFile.id == CreationOutput.file_id)
        .join(Product, Product.id == Creation.product_id)
        .join(Task, Task.id == Creation.task_id)
        .where(Creation.tenant_id == tenant, PrivateFile.tenant_id == tenant)
    )
    if status:
        query = query.where(CreationOutput.status == status)
    if product_id:
        query = query.where(Creation.product_id == product_id)
    if task_id:
        query = query.where(Creation.task_id == task_id)
    return [
        result_view(o, c, f).model_copy(
            update={"sku": sku, "category_label": CATEGORIES[category].label, "task_name": name}
        )
        for o, c, f, sku, category, name in db.execute(query.order_by(CreationOutput.id))
    ]


class Region(WriteSchema):
    x: float = Field(ge=0, lt=1)
    y: float = Field(ge=0, lt=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)
    note: str = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def inside_image(self) -> "Region":
        if self.x + self.width > 1 or self.y + self.height > 1:
            raise ValueError("region_outside_image")
        return self


class Decision(WriteSchema):
    version: int = Field(ge=1)
    decision: Literal["approved", "rejected"]
    reason: str = Field(default="", max_length=1000)
    regions: list[Region] = Field(default_factory=list, max_length=40)


@router.get("/reviews")
def reviews(
    identity: ActiveIdentity,
    db: Database,
    status: str | None = "pending_review",
    task_id: str | None = None,
) -> list[TaskResult]:
    require_permission(identity, Permission.VIEW)
    return list_versions(db, identity.tenant.id, status, None, task_id)


@router.get("/assets/{identifier}/quality")
def quality(identifier: str, identity: ActiveIdentity, db: Database) -> dict[str, Any]:
    require_permission(identity, Permission.VIEW)
    output, draft = version_for(db, identity.tenant.id, identifier)
    step = db.get(ImageStep, output.id)
    job = db.get(Execution, output.execution_id)
    return {
        "parent_version_id": job.parent_output if job else None,
        "product_id": draft.product_id,
        "product_fact_version": job.snapshot["product_fact_version"] if job else None,
        "product_photos": job.snapshot["product_photos"] if job else [],
        "status": output.status,
        "quality": step.quality if step else None,
        "decision": step.decision if step else None,
    }


@router.post("/assets/{identifier}/review")
def decide(
    identifier: str, data: Decision, identity: WriteIdentity, db: Database
) -> dict[str, str]:
    require_permission(identity, Permission.REVIEW)
    positions = []
    if data.decision == "approved":
        _, draft = version_for(db, identity.tenant.id, identifier)
        positions = list(lock_matching_positions(db, draft))
    output, _ = version_for(db, identity.tenant.id, identifier, True)
    check_version(output.version, data.version)
    step = db.get(ImageStep, identifier)
    if output.status != "pending_review" or not step or step.decision:
        raise HTTPException(409, "review_unavailable")
    file = db.get(PrivateFile, output.file_id) if output.file_id else None
    if (
        not file
        or file.tenant_id != identity.tenant.id
        or not file_ready(file, output.file_version)
    ):
        raise HTTPException(409, "review_unavailable")
    if data.decision == "rejected" and not data.reason.strip():
        raise HTTPException(422, "reason_required")
    job = db.get(Execution, output.execution_id)
    if job:
        verify_sources(db, identity.tenant.id, job.snapshot)
    step.decision = {
        **data.model_dump(),
        "user_id": identity.user.id,
        "file_id": output.file_id,
        "file_version": output.file_version,
        "decided_at": datetime.utcnow().isoformat() + "Z",
    }
    output.status = data.decision
    for position in positions:
        db.flush()
        fill_open_position(db, position)
    db.commit()
    return {"status": output.status}


class Revocation(WriteSchema):
    version: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=1000)


@router.post("/assets/{identifier}/revoke")
def revoke(
    identifier: str, data: Revocation, identity: WriteIdentity, db: Database
) -> dict[str, str]:
    require_permission(identity, Permission.REVIEW)
    output, _ = version_for(db, identity.tenant.id, identifier, True)
    check_version(output.version, data.version)
    step = db.get(ImageStep, identifier)
    if not step or output.status != "approved":
        raise HTTPException(409, "revocation_unavailable")
    step.decision = {
        **(step.decision or {}),
        "revocation": {
            "reason": data.reason,
            "user_id": identity.user.id,
            "at": datetime.utcnow().isoformat() + "Z",
        },
    }
    output.status = "revoked"
    db.commit()
    return {"status": output.status}


@router.post("/assets/{identifier}/rework", status_code=202)
def rework(
    identifier: str, data: Submission, identity: WriteIdentity, db: Database, settings: AppSettings
) -> ExecutionState:
    require_permission(identity, Permission.CREATE)
    output, draft = version_for(db, identity.tenant.id, identifier)
    return submit(db, identity.tenant.id, identity.user.id, draft.id, data, settings, output)
