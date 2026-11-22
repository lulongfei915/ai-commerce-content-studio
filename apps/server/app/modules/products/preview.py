from fastapi import APIRouter, HTTPException, Response
from sqlalchemy import select

from app.modules.assets.models import PrivateFile
from app.modules.assets.preview import image_preview
from app.modules.assets.routes import Storage
from app.modules.identity.domain import Permission
from app.modules.identity.security import ActiveIdentity, Database, require_permission

from .models import ProductPhotoBinding
from .service import get_fact, get_product

router = APIRouter(prefix="/products", tags=["商品"])


@router.get(
    "/{product_id}/photos/{file_id}/preview",
    operation_id="previewProductPhoto",
    response_class=Response,
    responses={
        200: {"content": {"image/jpeg": {"schema": {"type": "string", "format": "binary"}}}}
    },
)
def preview_photo(
    product_id: str, file_id: str, identity: ActiveIdentity, db: Database, storage: Storage
) -> Response:
    require_permission(identity, Permission.VIEW)
    tenant = identity.tenant.id
    product = get_product(db, tenant, product_id)
    fact = get_fact(db, product, product.fact_version)
    version = next((ref["version"] for ref in fact.photos if ref["file_id"] == file_id), None)
    photo = (
        db.scalar(
            select(PrivateFile)
            .join(ProductPhotoBinding, PrivateFile.id == ProductPhotoBinding.file_id)
            .where(
                PrivateFile.id == file_id,
                PrivateFile.tenant_id == tenant,
                PrivateFile.version == version,
                PrivateFile.status == "ready",
                ProductPhotoBinding.tenant_id == tenant,
                ProductPhotoBinding.product_id == product_id,
            )
        )
        if version is not None
        else None
    )
    if photo is None or photo.object_key is None:
        raise HTTPException(404, "product_photo_not_found")
    key = photo.object_key
    db.rollback()
    return image_preview(storage, key)
