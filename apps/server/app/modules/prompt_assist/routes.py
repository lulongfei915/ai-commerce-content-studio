from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from app.adapters.object_storage import get_object_storage
from app.adapters.vision import suggest
from app.modules.assets.models import PrivateFile
from app.modules.commerce.models import ModelCall
from app.modules.creation.batch_domain import override, require_unsubmitted
from app.modules.creation.references import resolve_reference
from app.modules.creation.schemas import CreationView, ReferenceInput
from app.modules.creation.service import get_creation, view
from app.modules.execution.runner import read_media
from app.modules.execution.service import lock_budget, require_budget
from app.modules.identity.domain import Permission
from app.modules.identity.security import (
    ActiveIdentity,
    AppSettings,
    Database,
    WriteIdentity,
    require_permission,
)
from app.modules.products.service import get_fact, get_product
from app.modules.templates.schemas import VersionInput
from app.shared.studio_errors import check_version

router = APIRouter(tags=["提示词辅助"])


class AssistanceInput(VersionInput):
    kind: Literal["optimize", "reference"]
    reference: ReferenceInput | None = None


class AssistanceView(BaseModel):
    id: str
    creation_id: str
    source_version: int
    original: str
    suggestion: str | None
    status: str


class Card(BaseModel):
    id: str
    version: int
    title: str
    prompt: str


@router.get("/prompt-cards")
def cards(identity: ActiveIdentity) -> list[Card]:
    require_permission(identity, Permission.VIEW)
    return [
        Card(
            id="studio",
            version=1,
            title="白底棚拍",
            prompt="纯白背景，柔和侧光，保留实拍商品外观。",
        ),
        Card(
            id="detail", version=1, title="细节特写", prompt="局部近景，清晰呈现已确认的商品结构。"
        ),
    ]


@router.post("/creations/{identifier}/assistances", status_code=201)
def assist(
    identifier: str,
    data: AssistanceInput,
    identity: WriteIdentity,
    db: Database,
    settings: AppSettings,
) -> AssistanceView:
    require_permission(identity, Permission.CREATE)
    tenant = identity.tenant.id
    lock_budget(db, tenant)
    draft = get_creation(db, tenant, identifier, lock=True)
    require_unsubmitted(db, draft)
    check_version(draft.version, data.expected_version)
    product = get_product(db, tenant, draft.product_id)
    if data.kind == "optimize" and not draft.prompt.strip():
        raise HTTPException(422, "prompt_required")
    sources: list[tuple[str, str]] = []
    context = {
        "prompt": draft.prompt,
        "sku": product.sku,
        "facts": get_fact(db, product, product.fact_version).facts,
    }
    if data.kind == "reference":
        if not data.reference:
            raise HTTPException(422, "reference_required")
        ref = resolve_reference(db, product, data.reference, "reference", "main", draft=draft)
        file = db.get(PrivateFile, ref.file_id)
        assert file and file.object_key
        sources.append((file.object_key, file.content_type))
    require_budget(db, tenant, settings, settings.assistance_ceiling_cents)
    item = ModelCall(
        tenant_id=tenant,
        creation_id=identifier,
        user_id=identity.user.id,
        kind=data.kind,
        source_version=draft.version,
        original=draft.prompt,
        reserved_cents=settings.assistance_ceiling_cents,
        evidence={
            "model": settings.ark_vision_model,
            "method_version": "prompt-assist-v1",
            "fact_version": product.fact_version,
            "reference": ref.model_dump() if sources else None,
        },
    )
    db.add(item)
    db.commit()
    try:
        media = read_media(get_object_storage(), sources) if sources else []
        instruction = "保留当前SKU已核实事实，输出可用于商品图的中文提示词正文。" + (
            "只分析参考图构图、光线、背景，不继承参考图商品属性。"
            if sources
            else "优化原文，不新增商品属性。"
        )
        text, request, usage = suggest(settings, instruction, context, media)
        if len(text) > 6000:
            raise ValueError("suggestion_too_long")
        item.suggestion, item.provider_id, item.status = text, request, "ready"
        item.evidence = {**item.evidence, "usage": usage}
    except Exception:
        item.status = "unverified"
    db.commit()
    return AssistanceView.model_validate(item, from_attributes=True)


@router.get("/creations/{identifier}/assistances")
def recent(identifier: str, identity: ActiveIdentity, db: Database) -> list[AssistanceView]:
    require_permission(identity, Permission.CREATE)
    get_creation(db, identity.tenant.id, identifier)
    records = db.scalars(
        select(ModelCall)
        .where(
            ModelCall.tenant_id == identity.tenant.id,
            ModelCall.creation_id == identifier,
            ModelCall.user_id == identity.user.id,
            ModelCall.kind.in_(("optimize", "reference")),
        )
        .order_by(ModelCall.source_version.desc(), ModelCall.id.desc())
        .limit(10)
    )
    return [AssistanceView.model_validate(item, from_attributes=True) for item in records]


def own(db: Database, tenant: str, user: str, identifier: str) -> ModelCall:
    item = db.scalar(
        select(ModelCall)
        .where(
            ModelCall.tenant_id == tenant,
            ModelCall.user_id == user,
            ModelCall.id == identifier,
            ModelCall.kind.in_(("reference", "optimize")),
        )
        .with_for_update()
    )
    if not item:
        raise HTTPException(404, "assistance_not_found")
    return item


@router.get("/assistances/{identifier}")
def read(identifier: str, identity: ActiveIdentity, db: Database) -> AssistanceView:
    return AssistanceView.model_validate(
        own(db, identity.tenant.id, identity.user.id, identifier), from_attributes=True
    )


def change(identifier: str, identity: WriteIdentity, db: Database, undo: bool) -> CreationView:
    require_permission(identity, Permission.CREATE)
    item = own(db, identity.tenant.id, identity.user.id, identifier)
    draft = get_creation(db, identity.tenant.id, item.creation_id, lock=True)
    require_unsubmitted(db, draft)
    if not item.suggestion or item.status != ("applied" if undo else "ready"):
        raise HTTPException(409, "assistance_unavailable")
    check_version(draft.version, (item.applied_version or 0) if undo else item.source_version)
    draft.prompt = item.original if undo else item.suggestion
    override(draft, "prompt")
    draft.version += 1
    item.status = "undone" if undo else "applied"
    item.applied_version = draft.version
    db.commit()
    return view(draft)


@router.post("/assistances/{identifier}/apply")
def apply(identifier: str, identity: WriteIdentity, db: Database) -> CreationView:
    return change(identifier, identity, db, False)


@router.post("/assistances/{identifier}/undo")
def undo(identifier: str, identity: WriteIdentity, db: Database) -> CreationView:
    return change(identifier, identity, db, True)
