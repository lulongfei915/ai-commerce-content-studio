from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.assets.models import PrivateFile
from app.modules.cases.service import licensed_case_file
from app.modules.creation.models import CreationOutput
from app.modules.products.service import get_product

from .models import Execution


def verify_sources(db: Session, tenant: str, snapshot: dict[str, Any]) -> None:
    pending = [snapshot]
    visited: set[str] = set()
    while pending:
        snap = pending.pop()
        product = get_product(db, tenant, snap["draft"]["product_id"])
        if product.fact_version != snap["product_fact_version"]:
            raise HTTPException(409, "source_review_required")
        for photo in snap["product_photos"]:
            media = db.get(PrivateFile, photo["file_id"])
            if not media or (media.tenant_id, media.status, media.version) != (
                tenant,
                "ready",
                photo["version"],
            ):
                raise HTTPException(409, "source_review_required")
        for ref in snap["references"]:
            file = db.get(PrivateFile, ref["file_id"])
            if not file or (file.tenant_id, file.status, file.version) != (
                tenant,
                "ready",
                ref["file_version"],
            ):
                raise HTTPException(409, "source_review_required")
            if ref["kind"] == "case":
                case, media = licensed_case_file(
                    db,
                    tenant,
                    ref["source_id"],
                    product.category,
                    snap["draft"]["purpose"],
                    "references",
                )
                if case.version != ref["source_version"] or media.id != file.id:
                    raise HTTPException(409, "source_review_required")
            if ref["kind"] == "result":
                output = db.get(CreationOutput, ref["source_id"])
                if not output or (output.status, output.version, output.file_id) != (
                    "approved",
                    ref["source_version"],
                    file.id,
                ):
                    raise HTTPException(409, "source_review_required")
                if output.id not in visited:
                    visited.add(output.id)
                    parent = db.get(Execution, output.execution_id)
                    if parent:
                        pending.append(parent.snapshot)
