from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.assets.models import PrivateFile
from app.modules.cases.models import Case
from app.modules.creation.lineage import output_files
from app.modules.creation.models import Creation, CreationOutput
from app.modules.creation.references import IMAGE_TYPES
from app.modules.creation.schemas import ReferenceView
from app.modules.creation.service import view
from app.modules.products.models import ProductPhotoBinding
from app.modules.tasks.models import Task, TaskProduct
from app.shared.studio_errors import reject

from .models import CanvasLayout, CanvasViewport
from .schemas import CanvasEdge, CanvasNode, CanvasView, LayoutView, ViewportView


def layout_view(row: CanvasLayout | None) -> LayoutView:
    return LayoutView.model_validate(row, from_attributes=True) if row else LayoutView()


def query_files(db: Session, tenant: str, ids: set[str]) -> dict[str, PrivateFile]:
    if not ids:
        return {}
    return {
        file.id: file
        for file in db.scalars(
            select(PrivateFile).where(PrivateFile.tenant_id == tenant, PrivateFile.id.in_(ids))
        )
    }


def project(db: Session, task: Task, user_id: str, layout: LayoutView) -> CanvasView:
    tenant, task_id = task.tenant_id, task.id
    personal = db.get(CanvasViewport, (tenant, task_id, user_id))
    creations = [
        view(item)
        for item in db.scalars(
            select(Creation)
            .where(Creation.tenant_id == tenant, Creation.task_id == task_id)
            .order_by(Creation.id)
        )
    ]
    by_creation = {draft.id: draft for draft in creations}
    outputs = list(
        db.scalars(
            select(CreationOutput)
            .join(Creation, Creation.id == CreationOutput.creation_id)
            .where(Creation.tenant_id == tenant, Creation.task_id == task_id)
            .order_by(CreationOutput.output_index, CreationOutput.version, CreationOutput.id)
        )
    )
    active_status = {
        output.creation_id: output.status
        for output in outputs
        if output.status in {"queued", "running", "saving"}
    }
    edges: list[CanvasEdge] = []
    references: dict[str, ReferenceView] = {}
    for draft in creations:
        for ref in draft.references:
            source = f"{ref.kind}:{ref.source_id}"
            references[source] = ref
            edges.append(
                CanvasEdge(id=ref.id, source=source, target=f"creation:{draft.id}", usage=ref.usage)
            )
    explicit = {point.id for point in layout.positions} | references.keys()
    case_ids = {key.split(":", 1)[1] for key in explicit if key.startswith("case:")}
    upload_ids = {key.split(":", 1)[1] for key in explicit if key.startswith("upload:")}
    cases = (
        list(db.scalars(select(Case).where(Case.tenant_id == tenant, Case.id.in_(case_ids))))
        if case_ids
        else []
    )
    hidden_files = output_files(db, tenant, upload_ids | {case.file_id for case in cases})
    files = query_files(
        db,
        tenant,
        upload_ids
        | {case.file_id for case in cases}
        | {item.file_id for item in outputs if item.file_id},
    )
    member_ids = set(
        db.scalars(
            select(TaskProduct.product_id).where(
                TaskProduct.tenant_id == tenant,
                TaskProduct.task_id == task_id,
            )
        )
    )
    bindings = (
        {
            binding.file_id: binding.product_id
            for binding in db.scalars(
                select(ProductPhotoBinding).where(
                    ProductPhotoBinding.tenant_id == tenant,
                    ProductPhotoBinding.file_id.in_(upload_ids),
                )
            )
        }
        if upload_ids
        else {}
    )
    nodes = [
        CanvasNode(
            id=f"creation:{draft.id}",
            kind="creation",
            source_id=draft.id,
            label="视频生成" if draft.purpose == "video" else "图片生成",
            media="video" if draft.purpose == "video" else "image",
            product_id=draft.product_id,
            status=active_status.get(draft.id, "draft"),
        )
        for draft in creations
    ]
    for source_id in sorted(upload_ids):
        file = files.get(source_id)
        product_id = bindings.get(source_id)
        if (
            file is None
            or source_id in hidden_files
            or (product_id is not None and product_id not in member_ids)
        ):
            continue
        media: Literal["image", "video"] = "video" if file.content_type == "video/mp4" else "image"
        ready = file_ready(file, file.version)
        nodes.append(
            CanvasNode(
                id=f"upload:{source_id}",
                kind="upload",
                source_id=source_id,
                label=file.filename,
                media=media,
                product_id=product_id,
                status=file.status,
                file_id=file.id,
                file_version=file.version,
                source_version=file.version,
                previewable=ready,
                referenceable=ready and (media == "video" or file.size_bytes <= 10 * 1024 * 1024),
            )
        )
    for case in cases:
        if case.file_id in hidden_files:
            continue
        ready = file_ready(files.get(case.file_id), case.file_version)
        nodes.append(
            CanvasNode.model_validate(
                {
                    "id": f"case:{case.id}",
                    "kind": "case",
                    "source_id": case.id,
                    "label": case.name,
                    "media": case.media,
                    "status": "licensed" if case.usage_scope else "unlicensed",
                    "file_id": case.file_id,
                    "file_version": case.file_version,
                    "source_version": case.version,
                    "allowed_purposes": case.usage_purposes,
                    "previewable": ready,
                    "referenceable": ready and bool(case.usage_scope),
                }
            )
        )
    for output in outputs:
        owner = by_creation[output.creation_id]
        ready = file_ready(files.get(output.file_id or ""), output.file_version)
        node_id = f"result:{output.id}"
        nodes.append(
            CanvasNode(
                id=node_id,
                kind="result",
                source_id=output.id,
                label=f"结果 {output.output_index + 1}",
                media="video" if owner.purpose == "video" else "image",
                product_id=owner.product_id,
                source_creation_id=owner.id,
                status=output.status,
                file_id=output.file_id,
                file_version=output.file_version,
                source_version=output.version,
                execution_id=output.execution_id,
                previewable=ready,
                referenceable=ready and output.status == "approved",
            )
        )
    existing = {node.id for node in nodes}
    for key, ref in references.items():
        if key not in existing:
            nodes.append(
                CanvasNode(
                    id=key,
                    kind=ref.kind,
                    source_id=ref.source_id,
                    label=ref.label,
                    media=ref.media,
                    file_id=ref.file_id,
                    file_version=ref.file_version,
                    source_version=ref.source_version,
                    status="unavailable",
                )
            )
    return CanvasView(
        layout=layout,
        viewport=ViewportView.model_validate(personal, from_attributes=True) if personal else None,
        nodes=nodes,
        edges=edges,
        creations=creations,
    )


def file_ready(file: PrivateFile | None, version: int | None) -> bool:
    return bool(
        file
        and file.status == "ready"
        and file.object_key
        and file.version == version
        and file.content_type in IMAGE_TYPES | {"video/mp4"}
    )


def check_positions(canvas: CanvasView) -> None:
    ids = {node.id for node in canvas.nodes if node.status != "unavailable"}
    incoming = [point.id for point in canvas.layout.positions]
    if len(set(incoming)) != len(incoming):
        reject("positions", "canvas_node_duplicate")
    if set(incoming) - ids:
        reject("positions", "canvas_node_unknown")
