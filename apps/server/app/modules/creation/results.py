from collections.abc import Sequence
from typing import Literal
from uuid import UUID, uuid5

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.assets.models import PrivateFile
from app.modules.assets.preview import image_preview
from app.modules.assets.routes import Storage, stream_private_file
from app.modules.identity.domain import Permission
from app.modules.identity.security import ActiveIdentity, Database, require_permission
from app.modules.tasks.service import get_task

from .models import Creation, CreationOutput

router = APIRouter(prefix="/tasks/{task_id}/results", tags=["任务产出"])
_ASSET_NAMESPACE = UUID("0b2805de-4e9a-4df7-9ffe-e572b7f31eb4")
IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


class TaskResult(BaseModel):
    category_label: str | None = None
    task_name: str | None = None
    scene: str | None = None
    matching_positions: list[str] | None = None
    width: int | None = None
    height: int | None = None
    duration: float | None = None
    sku: str = ""
    task_id: str
    purpose: str
    asset_id: str
    version_id: str
    version: int
    creation_id: str
    execution_id: str
    product_id: str
    label: str
    media: Literal["image", "video"]
    status: str
    file_id: str | None
    file_version: int | None
    previewable: bool
    referenceable: bool


def file_ready(file: PrivateFile | None, version: int | None) -> bool:
    return bool(
        file
        and file.status == "ready"
        and file.object_key
        and file.version == version
        and file.content_type in IMAGE_TYPES | {"video/mp4"}
    )


def result_rows(
    db: Session, tenant: str, task_id: str, *, version_id: str | None = None
) -> Sequence[tuple[CreationOutput, Creation, PrivateFile | None]]:
    query = (
        select(CreationOutput, Creation, PrivateFile)
        .join(Creation, Creation.id == CreationOutput.creation_id)
        .outerjoin(
            PrivateFile,
            (PrivateFile.id == CreationOutput.file_id) & (PrivateFile.tenant_id == tenant),
        )
        .where(Creation.tenant_id == tenant, Creation.task_id == task_id)
    )
    if version_id is not None:
        query = query.where(CreationOutput.id == version_id)
    return [
        (output, owner, file)
        for output, owner, file in db.execute(
            query.order_by(CreationOutput.output_index, CreationOutput.version, CreationOutput.id)
        )
    ]


def asset_id_for(output: CreationOutput) -> str:
    return output.asset_id or str(
        uuid5(_ASSET_NAMESPACE, f"{output.creation_id}/{output.execution_id}/{output.output_index}")
    )


def result_view(output: CreationOutput, owner: Creation, file: PrivateFile | None) -> TaskResult:
    ready = file_ready(file, output.file_version)
    return TaskResult(
        width=file.width if file else None,
        height=file.height if file else None,
        duration=file.duration_seconds if file else None,
        task_id=owner.task_id,
        purpose=owner.purpose,
        asset_id=asset_id_for(output),
        version_id=output.id,
        version=output.version,
        creation_id=owner.id,
        execution_id=output.execution_id,
        product_id=owner.product_id,
        label=file.filename if file is not None else f"结果 {output.output_index + 1}",
        media="video" if owner.purpose == "video" else "image",
        status=output.status,
        file_id=file.id if file is not None else None,
        file_version=output.file_version,
        previewable=ready,
        referenceable=(
            ready
            and output.status == "approved"
            and file is not None
            and (file.content_type == "video/mp4" or file.size_bytes <= 10 * 1024 * 1024)
        ),
    )


@router.get("")
def list_task_results(task_id: str, identity: ActiveIdentity, db: Database) -> list[TaskResult]:
    require_permission(identity, Permission.VIEW)
    tenant = identity.tenant.id
    get_task(db, tenant, task_id)
    return [
        result_view(output, owner, file)
        for output, owner, file in result_rows(db, tenant, task_id)
        if file is not None
    ]


@router.get("/{version_id}/preview", response_class=Response)
def preview_task_result(
    task_id: str,
    version_id: str,
    file_version: int,
    request: Request,
    identity: ActiveIdentity,
    db: Database,
    storage: Storage,
    source_version: int | None = None,
    detailed: bool = False,
) -> Response:
    require_permission(identity, Permission.VIEW)
    tenant = identity.tenant.id
    get_task(db, tenant, task_id)
    rows = result_rows(db, tenant, task_id, version_id=version_id)
    if not rows:
        raise HTTPException(404, "result_preview_unavailable")
    output, _, file = rows[0]
    if (
        not file_ready(file, output.file_version)
        or file is None
        or file.object_key is None
        or output.file_version != file_version
        or (source_version is not None and output.version != source_version)
    ):
        raise HTTPException(404, "result_preview_unavailable")
    if file.content_type == "video/mp4":
        return stream_private_file(file, request, identity, db, storage, inline=True)
    key = file.object_key
    db.rollback()
    return image_preview(storage, key, max_bytes=20 * 1024 * 1024, edge=2048 if detailed else 384)
