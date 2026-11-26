import re

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.products.models import Product
from app.modules.products.schemas import ProductPhoto
from app.modules.products.service import get_fact, get_product, require_generation_inputs
from app.modules.tasks.models import TaskProduct
from app.modules.templates.service import find_template, version_content
from app.shared.config import Settings
from app.shared.studio_errors import FieldIssue, reject

from .batch_domain import override
from .capabilities import ImageParameters, validate_parameters
from .models import Creation
from .references import resolve_reference, validate_references
from .schemas import ApplyTemplate, CreationView, InputSnapshot, ReferenceInput, ReferenceView

REFERENCE_TAG = re.compile(r"\[\[ref:([^\]\r\n]+)\]\]")


def uses_explicit_image_references(entry: str | None, purpose: str) -> bool:
    return entry in (None, "quick", "canvas") and purpose in ("main", "detail")


def uses_explicit_references(entry: str | None, purpose: str) -> bool:
    return uses_explicit_image_references(entry, purpose) or purpose == "video"


def get_creation(db: Session, tenant: str, identifier: str, *, lock: bool = False) -> Creation:
    query = select(Creation).where(
        Creation.tenant_id == tenant, Creation.id == identifier, Creation.discarded.is_(False)
    )
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    item = db.scalar(query)
    if item is None:
        raise HTTPException(404, "creation_not_found")
    return item


def member_product(db: Session, tenant: str, task: str, product: str) -> Product:
    member = db.scalar(
        select(TaskProduct.id).where(
            TaskProduct.tenant_id == tenant,
            TaskProduct.task_id == task,
            TaskProduct.product_id == product,
        )
    )
    if member is None:
        raise HTTPException(404, "task_product_not_found")
    return get_product(db, tenant, product)


def view(item: Creation) -> CreationView:
    draft = CreationView.model_validate(item, from_attributes=True)
    if draft.slot in {"quick-primary", "canvas-primary", "batch-primary"}:
        draft.slot = "primary"
    return draft


def save(
    db: Session,
    item: Creation,
    product: Product,
    references: list[ReferenceView],
    parameters: ImageParameters,
    *,
    validate_sources: bool = True,
) -> CreationView:
    files = {ref.file_id for ref in references}
    if not uses_explicit_references(item.entry, item.purpose):
        fact = get_fact(db, product, product.fact_version)
        files.update(str(photo["file_id"]) for photo in fact.photos)
    if validate_sources:
        validate_references(db, product, references, item)
    if item.purpose != "video":
        validate_parameters(parameters, len(files))
    item.references = [ref.model_dump() for ref in references]
    item.parameters = parameters.model_dump()
    item.version += 1
    db.commit()
    return view(item)


def apply_template(
    db: Session, item: Creation, product: Product, data: ApplyTemplate
) -> CreationView:
    template = find_template(db, item.tenant_id, data.template_id)
    if not template.enabled:
        reject("template_id", "template_disabled")
    content = version_content(db, template, data.template_version)
    if content.category != product.category or content.purpose != item.purpose:
        reject("template_id", "template_incompatible")
    refs = [ref for ref in view(item).references if ref.origin == "independent"]
    for index, case_id in enumerate(content.case_ids):
        ref = resolve_reference(
            db,
            product,
            ReferenceInput(kind="case", source_id=case_id),
            f"case_ids.{index}",
            item.purpose,
            "template",
        )
        if all(item.file_id != ref.file_id for item in refs):
            refs.append(ref)
    item.template_id, item.template_version = template.id, data.template_version
    if content.purpose == "video" and content.video_parameters:
        item.video_parameters = content.video_parameters.model_dump()
        override(item, *item.video_parameters)
    if data.prompt_action == "replace":
        override(item, "prompt")
        facts = get_fact(db, product, product.fact_version).facts
        values = {
            "商品名称": product.name,
            "SKU": product.sku,
            "商品事实": "、".join(str(f["value"]) for f in facts.values()) or "已确认的商品外观",
        }
        item.prompt = re.sub(
            r"\{\{(商品名称|SKU|商品事实)\}\}", lambda m: values[m[1]], content.prompt
        )
    override(item, *content.parameters.model_dump())
    return save(db, item, product, refs, content.parameters)


def template_check(db: Session, item: Creation) -> None:
    if (
        item.template_id is not None
        and not find_template(db, item.tenant_id, item.template_id).enabled
    ):
        reject("template_id", "template_disabled")


def reuse_configuration(db: Session, target: Creation, source: Creation) -> CreationView:
    if target.entry != "batch" or target.purpose != source.purpose:
        reject("source_id", "draft_incompatible")
    product = member_product(db, target.tenant_id, target.task_id, target.product_id)
    template_check(db, source)
    if source.template_id is not None and source.template_version is not None:
        template = find_template(db, target.tenant_id, source.template_id)
        content = version_content(db, template, source.template_version)
        if content.category != product.category:
            reject("template_id", "template_incompatible")
    draft = view(source)
    references: list[ReferenceView] = []
    labels: dict[str, str] = {}
    for index, ref in enumerate(draft.references):
        field = f"references.{index}"
        copied = resolve_reference(
            db, product, ref, field, target.purpose, ref.origin, draft=target
        )
        if (ref.source_version, ref.file_id, ref.file_version) != (
            copied.source_version,
            copied.file_id,
            copied.file_version,
        ):
            reject(field, "reference_version_invalid")
        labels[ref.id] = copied.id
        references.append(copied)
    if set(REFERENCE_TAG.findall(draft.prompt)) - labels.keys():
        reject("prompt", "reference_label_dangling")
    target.prompt = REFERENCE_TAG.sub(lambda match: f"[[ref:{labels[match[1]]}]]", draft.prompt)
    target.video_parameters = source.video_parameters
    target.template_id, target.template_version = source.template_id, source.template_version
    override(target, "prompt", *draft.parameters.model_dump(), *(target.video_parameters or {}))
    return save(db, target, product, references, draft.parameters)


def build_input_snapshot(
    db: Session, item: Creation, *, settings: Settings | None = None
) -> InputSnapshot:
    template_check(db, item)
    draft = view(item)
    product = get_product(db, item.tenant_id, item.product_id)
    if not draft.prompt.strip():
        reject("prompt", "prompt_required")
    if set(REFERENCE_TAG.findall(draft.prompt)) - {ref.id for ref in draft.references}:
        reject("prompt", "reference_label_dangling")
    if uses_explicit_references(item.entry, item.purpose):
        photos = [
            ProductPhoto(file_id=ref.file_id, version=ref.file_version)
            for ref in draft.references
            if ref.usage == "product"
        ]
    else:
        photos = require_generation_inputs(db, product, draft.purpose)
    validate_references(db, product, draft.references, item)
    files = {photo.file_id for photo in photos} | {ref.file_id for ref in draft.references}
    if item.purpose != "video":
        validate_parameters(draft.parameters, len(files), settings=settings)
    return InputSnapshot(
        draft=draft,
        product_fact_version=product.fact_version,
        product_photos=photos,
        references=draft.references,
    )


def require_ready(db: Session, item: Creation) -> CreationView:
    """Shared submission guard for execution services."""
    return build_input_snapshot(db, item).draft


def readiness(db: Session, item: Creation) -> list[FieldIssue]:
    try:
        require_ready(db, item)
    except HTTPException as exc:
        if isinstance(exc.detail, dict):
            if "fields" in exc.detail:
                return [
                    FieldIssue(field=f"product.{field}", code=exc.detail["code"])
                    for field in exc.detail["fields"]
                ]
            if "field" in exc.detail:
                return [FieldIssue.model_validate(exc.detail)]
        raise
    return []
