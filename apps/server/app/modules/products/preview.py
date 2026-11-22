from io import BytesIO

from fastapi import APIRouter, HTTPException, Response
from PIL import Image, ImageOps
from sqlalchemy import select

from app.adapters.object_storage import StorageUnavailable
from app.modules.assets.models import PrivateFile
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
    try:
        with storage.read(key, None) as stream:
            data = stream.read(10 * 1024 * 1024 + 1)
        if len(data) > 10 * 1024 * 1024:
            raise ValueError("preview source exceeds limit")
        with Image.open(BytesIO(data), formats=["JPEG", "PNG", "WEBP"]) as source:
            if source.width * source.height > 25_000_000:
                raise ValueError("preview source exceeds pixel limit")
            image = ImageOps.exif_transpose(source)
            image.thumbnail((384, 384))
            output = BytesIO()
            # A fresh RGB image drops metadata and original encoded bytes.
            rgb = Image.new("RGB", image.size, "white")
            rgba = image.convert("RGBA")
            rgb.paste(rgba, mask=rgba.getchannel("A"))
            rgb.save(output, format="JPEG", quality=80)
    except (StorageUnavailable, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise HTTPException(503, "product_preview_unavailable") from exc
    return Response(
        output.getvalue(),
        media_type="image/jpeg",
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
