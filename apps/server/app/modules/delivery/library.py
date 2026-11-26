from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.modules.assets.models import PrivateFile
from app.modules.creation.capabilities import ImageParameters
from app.modules.creation.models import Creation, CreationOutput
from app.modules.creation.references import resolve_reference
from app.modules.creation.results import result_view
from app.modules.creation.schemas import CreationView, ReferenceInput, VideoParameters
from app.modules.creation.service import member_product, save, view
from app.modules.execution.models import Execution
from app.modules.identity.domain import Permission
from app.modules.identity.models import User
from app.modules.identity.security import (
    ActiveIdentity,
    Database,
    WriteIdentity,
    require_permission,
)
from app.modules.identity.team import record
from app.modules.products.service import get_product
from app.modules.reviews.routes import version_for
from app.modules.tasks.schemas import TaskResponse
from app.modules.tasks.service import get_task, stage_products, task_view
from app.modules.templates.models import TemplateVersion
from app.shared.studio_errors import reject

router = APIRouter(prefix="/assets/{identifier}", tags=["公司素材"])


class SourceDetails(BaseModel):
    product: str
    task: str
    creator: str | None
    template: str
    evidence: str
    referenceable: bool
    status: str


@router.get("/source")
def source(identifier: str, identity: ActiveIdentity, db: Database) -> SourceDetails:
    require_permission(identity, Permission.VIEW)
    tenant = identity.tenant.id
    output, draft = version_for(db, tenant, identifier)
    task = get_task(db, tenant, draft.task_id)
    product = get_product(db, tenant, draft.product_id)
    job = db.get(Execution, output.execution_id)
    snap = job.snapshot if job and job.tenant_id == tenant else {}
    owner = db.get(User, job.user_id) if job and job.tenant_id == tenant else None
    inputs = snap.get("draft", {})
    template = "未使用模板" if "template_id" in inputs else "历史版本未记录"
    if inputs.get("template_id") and inputs.get("template_version"):
        number = inputs["template_version"]
        published = db.get(TemplateVersion, (inputs["template_id"], number))
        template = f"{published.content['name'] if published else '历史模板'} · V{number}"
    evidence = []
    if snap.get("product_fact_version") is not None:
        evidence.append(f"商品事实 V{snap['product_fact_version']}")
    if "product_photos" in snap:
        evidence.append(f"{len(snap['product_photos'])} 份商品实拍")
    if "references" in snap:
        evidence.append(f"{len(snap['references'])} 份输入引用")
    file = db.get(PrivateFile, output.file_id) if output.file_id else None
    return SourceDetails(
        product=f"{product.name} · {product.sku}",
        task=task.name,
        creator=owner.email if owner else None,
        template=template,
        evidence=" · ".join(evidence) or "历史输入快照未记录",
        referenceable=result_view(output, draft, file).referenceable,
        status=output.status,
    )


@router.get("/reference-targets")
def targets(
    identifier: str, task_id: str, identity: ActiveIdentity, db: Database
) -> list[CreationView]:
    require_permission(identity, Permission.CREATE)
    tenant = identity.tenant.id
    get_task(db, tenant, task_id)
    out, origin = version_for(db, tenant, identifier)
    file = db.get(PrivateFile, out.file_id) if out.file_id else None
    asset = result_view(out, origin, file)
    if not asset.referenceable:
        raise HTTPException(409, "reference_not_ready")
    rows = db.scalars(
        select(Creation)
        .where(
            Creation.tenant_id == tenant,
            Creation.task_id == task_id,
            Creation.product_id == origin.product_id,
            Creation.id != origin.id,
        )
        .order_by(Creation.id)
    )
    submitted = set(
        db.scalars(
            select(CreationOutput.creation_id)
            .join(Creation)
            .where(Creation.task_id == task_id, Creation.entry == "batch")
        )
    )
    return [
        view(c)
        for c in rows
        if c.id not in submitted and not c.discarded
        and (asset.media == "image" or c.purpose == "video")
        and not any(r.get("file_id") == out.file_id for r in c.references)
    ]


class ReferenceDraftInput(BaseModel):
    task_id: str
    request_id: UUID
    expected_version: int = Field(ge=1)
    source_version: int = Field(ge=1)
    file_version: int = Field(ge=1)
    add_product: bool


class ReferencedDraft(BaseModel):
    draft: CreationView
    task: TaskResponse


@router.post("/reference-draft")
def new_reference_draft(
    identifier: str, data: ReferenceDraftInput, identity: WriteIdentity, db: Database
) -> ReferencedDraft:
    require_permission(identity, Permission.CREATE)
    try:
        return create_referenced_draft(identifier, data, identity, db)
    except Exception:
        db.rollback()
        raise


def create_referenced_draft(
    identifier: str, data: ReferenceDraftInput, identity: WriteIdentity, db: Database
) -> ReferencedDraft:
    tenant = identity.tenant.id
    task = get_task(db, tenant, data.task_id, lock=True)
    _, origin = version_for(db, tenant, identifier)
    slot = str(data.request_id)
    existing = db.scalar(select(Creation).where(Creation.task_id == task.id, Creation.slot == slot))
    if existing:
        if not any(r["source_id"] == identifier for r in existing.references):
            raise HTTPException(409, "reference_request_conflict")
        return ReferencedDraft(draft=view(existing), task=task_view(db, task))
    if data.add_product:
        stage_products(db, task, data.expected_version, [origin.product_id])
    product = member_product(db, tenant, task.id, origin.product_id)
    parameters = ImageParameters()
    draft = Creation(
        tenant_id=tenant,
        task_id=task.id,
        product_id=product.id,
        purpose=origin.purpose,
        entry="quick",
        slot=slot,
        prompt="",
        parameters=parameters.model_dump(),
        video_parameters=VideoParameters().model_dump() if origin.purpose == "video" else None,
    )
    db.add(draft)
    db.flush()
    reference = resolve_reference(
        db,
        product,
        ReferenceInput(kind="result", source_id=identifier),
        "references.0",
        draft.purpose,
        draft=draft,
    )
    if (reference.source_version, reference.file_version) != (
        data.source_version,
        data.file_version,
    ):
        reject("references.0", "reference_version_invalid")
    record(
        db,
        identity,
        "引用公司素材",
        f"{product.sku} · {reference.label} · V{reference.source_version}",
    )
    updated_task = task_view(db, task)
    return ReferencedDraft(
        draft=save(db, draft, product, [reference], parameters), task=updated_task
    )
