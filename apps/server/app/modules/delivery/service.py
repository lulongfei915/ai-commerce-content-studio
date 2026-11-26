from collections.abc import Sequence

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.adapters.ark_video import matches_video_dimensions
from app.modules.assets.models import PrivateFile
from app.modules.creation.capabilities import GPT_SIZES, SIZES
from app.modules.creation.models import Creation, CreationOutput
from app.modules.creation.results import TaskResult, file_ready
from app.modules.execution.models import Execution
from app.modules.execution.sources import verify_sources
from app.modules.identity.models import new_id
from app.modules.tasks.models import DeliveryPosition

from .models import Adoption

LABELS = {"main": "商品主图", "detail": "详情素材", "video": "带货视频"}


def module_for(position: DeliveryPosition) -> str:
    return position.module or LABELS[position.purpose]


def matches_module(position: DeliveryPosition, job: Execution | None) -> bool:
    if position.purpose == "video" and (not job or not job.snapshot.get("storyboard")):
        return False
    module = job.snapshot.get("delivery_module") if job else None
    return module_for(position) == (module or LABELS[position.purpose])


def has_reservation(db: Session, position_id: str) -> bool:
    return db.scalar(
        select(CreationOutput.id)
        .join(Execution, Execution.id == CreationOutput.execution_id)
        .where(
            Execution.position_id == position_id,
            CreationOutput.status.not_in(("cancelled", "approved", "revoked")),
        )
        .limit(1)
        .with_for_update()
    ) is not None


def matches_spec(position: DeliveryPosition, file: PrivateFile | TaskResult) -> bool:
    if not position.ratio:
        return True
    if position.purpose == "video":
        duration = file.duration_seconds if isinstance(file, PrivateFile) else file.duration
        return bool(
            matches_video_dimensions(
                file.width or 0, file.height or 0, position.ratio, position.resolution or "",
            )
            and duration
            and abs(duration - (position.duration or 0)) < 0.5
        )
    return any(
        s["ratio"] == position.ratio
        and s["resolution"] == position.resolution
        and (s["width"], s["height"]) == (file.width, file.height)
        for s in SIZES + GPT_SIZES
    )


def lock_matching_positions(db: Session, draft: Creation) -> Sequence[DeliveryPosition]:
    return db.scalars(
        select(DeliveryPosition)
        .where(
            DeliveryPosition.tenant_id == draft.tenant_id,
            DeliveryPosition.task_id == draft.task_id,
            DeliveryPosition.product_id == draft.product_id,
            DeliveryPosition.purpose == draft.purpose,
        )
        .order_by(DeliveryPosition.id)
        .with_for_update()
    ).all()


def lock_adoption(db: Session, position_id: str) -> Adoption | None:
    return db.scalar(
        select(Adoption)
        .where(Adoption.position_id == position_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def fill_open_position(db: Session, position: DeliveryPosition) -> None:
    """Select a unique candidate while the caller holds the position lock."""
    if lock_adoption(db, position.id) is not None:
        return
    candidates = db.execute(
        select(CreationOutput, PrivateFile)
        .join(Creation, Creation.id == CreationOutput.creation_id)
        .join(PrivateFile, PrivateFile.id == CreationOutput.file_id)
        .outerjoin(Adoption, Adoption.output_id == CreationOutput.id)
        .where(
            Creation.tenant_id == position.tenant_id,
            Creation.task_id == position.task_id,
            Creation.product_id == position.product_id,
            Creation.purpose == position.purpose,
            CreationOutput.status == "approved",
            PrivateFile.tenant_id == position.tenant_id,
            Adoption.output_id.is_(None),
        )
        .with_for_update(of=CreationOutput)
    )
    selected: CreationOutput | None = None
    for output, file in candidates:
        if not file_ready(file, output.file_version) or not matches_spec(position, file):
            continue
        job = db.get(Execution, output.execution_id)
        if not matches_module(position, job):
            continue
        if job:
            try:
                verify_sources(db, position.tenant_id, job.snapshot)
            except HTTPException as error:
                if error.status_code in (404, 409, 422):
                    continue
                raise
        if selected is not None:
            return
        selected = output
    if selected is not None:
        db.add(Adoption(position_id=position.id, output_id=selected.id, token=new_id()))
        position.status = "adopted"
