from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.assets.models import PrivateFile
from app.modules.creation.models import Creation, CreationOutput
from app.modules.creation.results import file_ready
from app.modules.execution.models import Execution
from app.modules.execution.sources import verify_sources
from app.modules.identity.models import new_id
from app.modules.tasks.models import DeliveryPosition

from .models import Adoption


def lock_matching_position(db: Session, draft: Creation) -> DeliveryPosition | None:
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
        .with_for_update()
    )
    selected: CreationOutput | None = None
    for output, file in candidates:
        if not file_ready(file, output.file_version):
            continue
        job = db.get(Execution, output.execution_id)
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
