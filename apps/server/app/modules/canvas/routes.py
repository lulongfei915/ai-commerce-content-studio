from fastapi import APIRouter, HTTPException, Request, Response

from app.modules.assets.preview import image_preview
from app.modules.assets.routes import Storage, stream_private_file
from app.modules.creation.results import file_ready, preview_task_result
from app.modules.identity.domain import Permission
from app.modules.identity.security import (
    ActiveIdentity,
    Database,
    WriteIdentity,
    require_permission,
)
from app.modules.tasks.service import get_task
from app.shared.studio_errors import check_version

from .models import CanvasLayout, CanvasViewport
from .schemas import CanvasView, LayoutEdit, LayoutView, ViewportEdit, ViewportView
from .service import check_positions, layout_view, project, query_files

router = APIRouter(prefix="/tasks/{task_id}/canvas", tags=["画布"])


@router.get("")
def get_canvas(task_id: str, identity: ActiveIdentity, db: Database) -> CanvasView:
    require_permission(identity, Permission.VIEW)
    tenant = identity.tenant.id
    task = get_task(db, tenant, task_id)
    return project(db, task, identity.user.id, layout_view(db.get(CanvasLayout, (tenant, task_id))))


@router.put("/layout")
def put_layout(task_id: str, data: LayoutEdit, identity: WriteIdentity, db: Database) -> LayoutView:
    require_permission(identity, Permission.CREATE)
    tenant = identity.tenant.id
    task = get_task(db, tenant, task_id, lock=True)
    row = db.get(CanvasLayout, (tenant, task_id), with_for_update=True)
    version = row.version if row else 0
    check_version(version, data.expected_version)
    updated = LayoutView(version=version + 1, positions=data.positions)
    check_positions(project(db, task, identity.user.id, updated), layout_view(row))
    if row is None:
        row = CanvasLayout(tenant_id=tenant, task_id=task_id)
        db.add(row)
    row.positions = [point.model_dump() for point in data.positions]
    row.version = updated.version
    db.commit()
    return updated


@router.put("/viewport")
def put_viewport(
    task_id: str, data: ViewportEdit, identity: WriteIdentity, db: Database
) -> ViewportView:
    require_permission(identity, Permission.VIEW)
    tenant, user = identity.tenant.id, identity.user.id
    get_task(db, tenant, task_id, lock=True)
    row = db.get(CanvasViewport, (tenant, task_id, user), with_for_update=True)
    version = row.version if row else 0
    check_version(version, data.expected_version)
    if row is None:
        row = CanvasViewport(tenant_id=tenant, task_id=task_id, user_id=user)
        db.add(row)
    row.x, row.y, row.zoom, row.version = data.x, data.y, data.zoom, version + 1
    db.commit()
    return ViewportView(x=data.x, y=data.y, zoom=data.zoom, version=version + 1)


@router.get("/preview/{node_id}", response_class=Response)
def preview(
    task_id: str,
    node_id: str,
    file_version: int,
    request: Request,
    identity: ActiveIdentity,
    db: Database,
    storage: Storage,
    source_version: int | None = None,
) -> Response:
    canvas = get_canvas(task_id, identity, db)
    node = next((node for node in canvas.nodes if node.id == node_id), None)
    if (
        node is None
        or not node.previewable
        or node.file_id is None
        or node.file_version != file_version
        or (source_version is not None and node.source_version != source_version)
    ):
        raise HTTPException(404, "canvas_preview_unavailable")
    if node.kind == "result":
        return preview_task_result(
            task_id, node.source_id, file_version, request, identity, db, storage, source_version
        )
    file = query_files(db, identity.tenant.id, {node.file_id}).get(node.file_id)
    if not file_ready(file, file_version) or file is None or file.object_key is None:
        raise HTTPException(404, "canvas_preview_unavailable")
    if node.media == "video":
        return stream_private_file(file, request, identity, db, storage, inline=True)
    key = file.object_key
    db.rollback()
    return image_preview(storage, key)
