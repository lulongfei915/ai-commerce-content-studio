import json
from datetime import datetime, timedelta
from io import BytesIO
from typing import Any

import httpx
from PIL import Image, UnidentifiedImageError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.adapters.ark_image import ArkImageClient, ImageGenerationRequest
from app.adapters.gpt_image import IMAGE_MIME_EXTENSIONS, GptImageClient
from app.adapters.image_errors import ImageProviderError
from app.adapters.object_storage import ObjectStorage, S3Storage
from app.adapters.vision import data_url
from app.modules.assets.models import PrivateFile
from app.modules.creation.capabilities import ImageParameters, validate_parameters
from app.modules.creation.models import CreationOutput
from app.modules.identity.models import Tenant
from app.shared.config import Settings

from .models import Execution, ImageStep
from .sources import verify_sources


def download(url: str, limit: int) -> bytes:
    if not url.startswith("https://"):
        raise ValueError("invalid_result_url")
    with httpx.stream("GET", url, timeout=60) as response:
        response.raise_for_status()
        body = bytearray()
        for chunk in response.iter_bytes():
            body.extend(chunk)
            if len(body) > limit:
                raise ValueError("result_too_large")
    return bytes(body)


def frozen_media(db: Session, tenant: str, snap: dict[str, Any]) -> list[tuple[str, str]]:
    files = {p["file_id"]: p["version"] for p in snap["product_photos"]}
    files.update({r["file_id"]: r["file_version"] for r in snap["references"]})
    sources = []
    for identifier, version in files.items():
        file = db.get(PrivateFile, identifier)
        if (
            not file
            or file.tenant_id != tenant
            or file.version != version
            or file.status != "ready"
            or not file.object_key
        ):
            raise ValueError("input_version_unavailable")
        sources.append((file.object_key, file.content_type))
    return sources


def read_media(storage: ObjectStorage, sources: list[tuple[str, str]]) -> list[str]:
    result = []
    for key, mime in sources:
        if isinstance(storage, S3Storage):
            signed = storage.provider_url(key)
            if signed:
                result.append(signed)
                continue
        with storage.read(key, None) as stream:
            result.append(data_url(mime, stream.read()))
    return result


def read_object(storage: ObjectStorage, key: str, limit: int) -> bytes:
    with storage.read(key, None) as stream:
        result = bytearray()
        while chunk := stream.read(min(65536, limit + 1 - len(result))):
            result.extend(chunk)
            if len(result) > limit:
                raise ValueError("image_too_large")
    return bytes(result)


def gpt_media(
    storage: ObjectStorage, sources: list[tuple[str, str]], limit: int
) -> list[tuple[str, bytes]]:
    references = []
    for key, mime in sources:
        if mime not in IMAGE_MIME_EXTENSIONS:
            raise ValueError("reference_media_unsupported")
        references.append((mime, read_object(storage, key, limit)))
    return references


def inline_key(tenant: str, output: str, lease: datetime) -> str:
    return f"generated/{tenant}/{output}/{lease:%Y%m%d%H%M%S}.png"


def target_size(snapshot: dict[str, Any]) -> str:
    size = snapshot.get("size")
    if isinstance(size, str):
        return size
    legacy = validate_parameters(ImageParameters.model_validate(snapshot["draft"]["parameters"]))
    return f"{legacy['width']}x{legacy['height']}"


class InvalidImageResult(ValueError):
    pass


def measure_png(body: bytes) -> tuple[int, int]:
    try:
        with Image.open(BytesIO(body)) as img:
            if img.format != "PNG":
                raise InvalidImageResult
            img.verify()
            return img.size
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError) as exc:
        raise InvalidImageResult from exc


def process(db: Session, identifier: str, storage: ObjectStorage, settings: Settings) -> None:
    # Serialize slot acquisition across tenants. The transaction ends before any I/O.
    db.execute(select(Tenant.id).order_by(Tenant.id).limit(1).with_for_update())
    output = db.get(CreationOutput, identifier, with_for_update=True, populate_existing=True)
    step = db.get(ImageStep, identifier, with_for_update=True, populate_existing=True)
    if not step or not output:
        db.rollback()
        return
    job = db.get(Execution, step.execution_id)
    assert job
    now = datetime.utcnow()
    if step.lease and step.lease > now:
        db.rollback()
        return
    snap = job.snapshot
    if snap.get("media") == "video":
        from .video_runner import process_video

        process_video(db, job, output, step, storage, settings, now)
        return
    gpt = snap.get("provider") == "gpt-image"
    phase = output.status
    recovery_key = (
        inline_key(job.tenant_id, identifier, step.lease)
        if gpt and phase == "generating" and step.lease else None
    )
    if phase == "generating" and recovery_key is None:
        output.status, step.fee_state, step.error = (
            "unknown",
            "unverified",
            "provider_status_unknown",
        )
        step.lease = None
        db.commit()
        return
    if phase not in ("queued", "saving", "generating"):
        db.rollback()
        return
    try:
        if phase == "queued":
            active = list(
                db.scalars(
                    select(Execution.tenant_id)
                    .join(ImageStep)
                    .join(CreationOutput, CreationOutput.id == ImageStep.output_id)
                    .where(CreationOutput.status.in_(("generating", "unknown")))
                    .where(
                        func.coalesce(Execution.snapshot["media"].as_string(), "image") != "video"
                    )
                )
            )
            if (
                len(active) >= settings.image_provider_slots
                or active.count(job.tenant_id) >= settings.image_tenant_slots
            ):
                db.rollback()
                return
            sources = frozen_media(db, job.tenant_id, snap)
            verify_sources(db, job.tenant_id, snap)
            output.status = "generating"
        timeout = settings.itaiapi_timeout_seconds if gpt else settings.ark_timeout_seconds
        lease = (now + timedelta(seconds=max(300, timeout * 3))).replace(microsecond=0)
        step.lease = lease
        db.commit()
    except Exception:
        if phase == "queued":
            output.status, step.error = "generation_failed", "input_unavailable"
            step.fee_state, step.actual_cents = "released", 0
        elif phase == "generating":
            output.status, step.error, step.fee_state = (
                "unknown", "provider_status_unknown", "unverified",
            )
        else:
            output.status, step.error = "save_failed", "saving_failed"
        db.commit()
        return
    sent = False
    cooldown = 0
    try:
        if recovery_key is not None:
            # The previous Worker may have stored the bytes before its DB commit.
            with storage.read(recovery_key, None):
                pass
            step.result_object_key = recovery_key
            output.status, step.fee_state = "saving", "unverified"
        elif phase == "queued":
            prompt = snap["draft"]["prompt"]
            if snap["facts"]:
                prompt += "\n已确认商品事实：" + json.dumps(snap["facts"], ensure_ascii=False)
            if snap.get("feedback"):
                prompt += "\n返工意见：" + json.dumps(snap["feedback"], ensure_ascii=False)
            size = target_size(snap)
            if gpt:
                references = gpt_media(storage, sources, settings.max_image_bytes)
                with GptImageClient(settings) as gpt_client:
                    sent = True
                    inline = gpt_client.generate(
                        snap["model"], prompt, size, snap["quality"], references
                    )
                step.provider_id = inline.request_id
                object_key = inline_key(job.tenant_id, identifier, lease)
                storage.put(object_key, BytesIO(inline.body), "image/png", len(inline.body))
                step.result_object_key = object_key
            else:
                images = read_media(storage, sources)
                request = ImageGenerationRequest(
                    model=snap["model"], prompt=prompt, image=images or None, size=size,
                )
                with ArkImageClient(settings) as ark_client:
                    sent = True
                    result = ark_client.generate(request)
                step.provider_id = result.request_id
                if not result.data[0].url:
                    raise ValueError("missing_result")
                step.result_url = str(result.data[0].url)
            output.status, step.fee_state = "saving", "unverified"
        else:
            if step.result_object_key:
                key = step.result_object_key
                body = read_object(storage, key, settings.max_image_bytes)
            else:
                key = f"generated/{job.tenant_id}/{identifier}.png"
                body = download(step.result_url or "", settings.max_image_bytes)
            width, height = measure_png(body)
            step.result_size = f"{width}x{height}"
            if step.result_size != target_size(snap):
                raise InvalidImageResult
            if not step.result_object_key:
                storage.put(key, BytesIO(body), "image/png", len(body))
            file = PrivateFile(
                id=identifier,
                tenant_id=job.tenant_id,
                created_by=job.user_id,
                filename=f"{identifier}.png",
                content_type="image/png",
                size_bytes=len(body),
                width=width,
                height=height,
                status="ready",
                version=1,
                object_key=key,
                expires_at=now,
            )
            db.add(file)
            output.file_id, output.file_version, output.status = file.id, 1, "pending_review"
        step.error = None
    except InvalidImageResult:
        output.status = "result_unavailable"
        step.error = "result_size_mismatch" if step.result_size else "invalid_result"
    except ImageProviderError as exc:
        if exc.category == "rate_limited":
            cooldown = min(max(1, exc.retry_after or 30), 86400)
        step.provider_id, step.error = exc.request_id, exc.category
        if exc.category in ("configuration", "authentication", "invalid_request", "rate_limited"):
            output.status = "generation_failed"
            step.fee_state, step.actual_cents = "released", 0
        else:
            output.status, step.fee_state = "unknown", "unverified"
    except Exception:
        if phase == "queued":
            output.status, step.fee_state, step.error = "unknown", "unverified", "queued_failed"
            if not sent:
                output.status, step.fee_state, step.actual_cents = (
                    "generation_failed",
                    "released",
                    0,
                )
        elif phase == "generating":
            output.status, step.error, step.fee_state = (
                "unknown", "provider_status_unknown", "unverified",
            )
        else:
            output.status, step.error = "save_failed", "saving_failed"
    # A late response must not overwrite a newer lease or an operator's reconciliation.
    with db.no_autoflush:
        owned = db.execute(
            select(ImageStep.lease).where(ImageStep.output_id == identifier).with_for_update()
        ).scalar_one()
    if owned != lease:
        db.rollback()
        return
    step.lease = datetime.utcnow() + timedelta(seconds=cooldown) if cooldown else None
    db.commit()
