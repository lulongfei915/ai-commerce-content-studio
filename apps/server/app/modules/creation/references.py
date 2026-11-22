from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.cases.service import licensed_case_file, ready_file
from app.modules.identity.models import new_id
from app.modules.products.models import Product, ProductPhotoBinding
from app.modules.products.service import get_fact
from app.shared.studio_errors import reject

from .lineage import output_files, output_source
from .models import Creation
from .schemas import ReferenceInput, ReferenceView

IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


def resolve_reference(
    db: Session,
    product: Product,
    data: ReferenceInput,
    field: str,
    purpose: str,
    origin: str = "independent",
    *,
    draft: Creation | None = None,
) -> ReferenceView:
    if data.kind == "case":
        case, file = licensed_case_file(
            db, product.tenant_id, data.source_id, product.category, purpose, field
        )
        label, source_version = case.name, case.version
    elif data.kind == "result":
        if draft is None:
            reject(field, "reference_not_ready")
        output = output_source(db, draft, data.source_id, field)
        file = ready_file(db, product.tenant_id, output.file_id or "", field)
        if output.file_version != file.version:
            reject(field, "reference_version_invalid")
        label, source_version = file.filename, output.version
    else:
        file = ready_file(db, product.tenant_id, data.source_id, field)
        label, source_version = file.filename, file.version
    if data.kind != "result" and output_files(db, product.tenant_id, {file.id}):
        reject(field, "reference_result_required")
    binding = db.scalar(
        select(ProductPhotoBinding).where(
            ProductPhotoBinding.tenant_id == product.tenant_id,
            ProductPhotoBinding.file_id == file.id,
        )
    )
    if binding is not None and binding.product_id != product.id:
        reject(field, "reference_other_sku")
    if binding is not None:
        fact = get_fact(db, product, product.fact_version)
        if not any(
            photo["file_id"] == file.id and photo["version"] == file.version
            for photo in fact.photos
        ):
            reject(field, "reference_version_invalid")
    if data.usage == "product" and (data.kind != "upload" or binding is None):
        reject(field, "reference_usage_unsupported")
    is_video = file.content_type == "video/mp4"
    frame = data.usage in {"first_frame", "last_frame"}
    if (frame and (purpose != "video" or is_video)) or (
        is_video and (purpose != "video" or data.usage != "expression")
    ):
        reject(field, "reference_usage_unsupported")
    if not is_video and (
        file.content_type not in IMAGE_TYPES or file.size_bytes > 10 * 1024 * 1024
    ):
        reject(field, "reference_media_unsupported")
    return ReferenceView.model_validate(
        {
            **data.model_dump(include={"kind", "source_id", "usage"}),
            "id": new_id(),
            "origin": origin,
            "file_id": file.id,
            "file_version": file.version,
            "label": label,
            "source_version": source_version,
            "media": "video" if is_video else "image",
        }
    )


def validate_references(
    db: Session, product: Product, references: list[ReferenceView], draft: Creation
) -> None:
    files: set[str] = set()
    for index, reference in enumerate(references):
        field = f"references.{index}"
        actual = resolve_reference(db, product, reference, field, draft.purpose, draft=draft)
        if (actual.file_id, actual.file_version, actual.source_version) != (
            reference.file_id,
            reference.file_version,
            reference.source_version,
        ):
            reject(field, "reference_version_invalid")
        if actual.file_id in files:
            reject(field, "reference_duplicate")
        files.add(actual.file_id)
    for usage in ("first_frame", "last_frame"):
        if sum(ref.usage == usage for ref in references) > 1:
            reject("references", "reference_usage_duplicate")
