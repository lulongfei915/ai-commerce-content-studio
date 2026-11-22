from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.cases.service import licensed_case_file, ready_file
from app.modules.identity.models import new_id
from app.modules.products.models import Product, ProductPhotoBinding
from app.shared.studio_errors import reject

from .schemas import ReferenceInput, ReferenceView

IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


def resolve_reference(
    db: Session,
    product: Product,
    data: ReferenceInput,
    field: str,
    purpose: str,
    origin: str = "independent",
) -> ReferenceView:
    if data.kind == "case":
        case, file = licensed_case_file(
            db, product.tenant_id, data.source_id, product.category, purpose, field
        )
        label, source_version = case.name, case.version
    else:
        file = ready_file(db, product.tenant_id, data.source_id, field)
        label, source_version = file.filename, file.version
    binding = db.scalar(
        select(ProductPhotoBinding).where(
            ProductPhotoBinding.tenant_id == product.tenant_id,
            ProductPhotoBinding.file_id == file.id,
        )
    )
    if binding is not None and binding.product_id != product.id:
        reject(field, "reference_other_sku")
    if file.content_type not in IMAGE_TYPES or file.size_bytes > 10 * 1024 * 1024:
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
        }
    )


def validate_references(
    db: Session, product: Product, references: list[ReferenceView], purpose: str
) -> None:
    files: set[str] = set()
    for index, reference in enumerate(references):
        field = f"references.{index}"
        actual = resolve_reference(db, product, reference, field, purpose)
        if (actual.file_id, actual.file_version, actual.source_version) != (
            reference.file_id,
            reference.file_version,
            reference.source_version,
        ):
            reject(field, "reference_version_invalid")
        if actual.file_id in files:
            reject(field, "reference_duplicate")
        files.add(actual.file_id)
