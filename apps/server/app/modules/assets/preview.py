from io import BytesIO

from fastapi import HTTPException, Response
from PIL import Image, ImageOps

from app.adapters.object_storage import ObjectStorage, StorageUnavailable


def image_preview(
    storage: ObjectStorage, key: str, *, max_bytes: int = 10 * 1024 * 1024
) -> Response:
    try:
        with storage.read(key, None) as stream:
            data = stream.read(max_bytes + 1)
        if len(data) > max_bytes:
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
