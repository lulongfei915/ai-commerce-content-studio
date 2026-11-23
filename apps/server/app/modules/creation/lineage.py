from sqlalchemy import select
from sqlalchemy.orm import Session

from app.shared.studio_errors import reject

from .models import Creation, CreationOutput


def output_files(db: Session, tenant: str, file_ids: set[str]) -> set[str]:
    if not file_ids:
        return set()
    return {
        file_id
        for file_id in db.scalars(
            select(CreationOutput.file_id)
            .join(Creation, Creation.id == CreationOutput.creation_id)
            .where(Creation.tenant_id == tenant, CreationOutput.file_id.in_(file_ids))
        )
        if file_id is not None
    }


def output_source(db: Session, draft: Creation, identifier: str, field: str) -> CreationOutput:
    output = db.scalar(
        select(CreationOutput)
        .join(Creation, Creation.id == CreationOutput.creation_id)
        .where(
            CreationOutput.id == identifier,
            Creation.tenant_id == draft.tenant_id,
        )
        .with_for_update()
    )
    if output is None:
        reject(field, "reference_not_ready")
    source = db.get(Creation, output.creation_id)
    if source is None or source.product_id != draft.product_id:
        reject(field, "reference_other_sku")
    pending = [source.id]
    visited: set[str] = set()
    while pending:
        identifier = pending.pop()
        if identifier == draft.id:
            reject(field, "reference_cycle")
        if identifier in visited:
            continue
        visited.add(identifier)
        ancestor = db.get(Creation, identifier, populate_existing=True, with_for_update=True)
        if ancestor is None:
            continue
        outputs = [ref["source_id"] for ref in ancestor.references if ref["kind"] == "result"]
        if outputs:
            pending.extend(
                db.scalars(
                    select(CreationOutput.creation_id)
                    .join(Creation, Creation.id == CreationOutput.creation_id)
                    .where(
                        CreationOutput.id.in_(outputs),
                        Creation.tenant_id == draft.tenant_id,
                    )
                    .with_for_update()
                )
            )
    if output.status != "approved" or output.file_id is None:
        reject(field, "reference_not_ready")
    from app.modules.execution.models import Execution
    from app.modules.execution.sources import verify_sources

    job = db.get(Execution, output.execution_id)
    if job:
        verify_sources(db, draft.tenant_id, job.snapshot)
    return output
