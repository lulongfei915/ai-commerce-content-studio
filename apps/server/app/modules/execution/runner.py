import json
from datetime import datetime, timedelta
from io import BytesIO
from typing import Any

import httpx
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.adapters.ark_image import ArkImageClient, ArkImageError, ImageGenerationRequest
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
    if output.status == "generating":
        output.status, step.fee_state, step.error = (
            "unknown",
            "unverified",
            "provider_status_unknown",
        )
        step.lease = None
        db.commit()
        return
    phase = output.status
    if phase not in ("queued", "saving"):
        db.rollback()
        return
    snap = job.snapshot
    try:
        if phase == "queued":
            active = list(
                db.scalars(
                    select(Execution.tenant_id)
                    .join(ImageStep)
                    .join(CreationOutput, CreationOutput.id == ImageStep.output_id)
                    .where(CreationOutput.status.in_(("generating", "unknown")))
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
        lease = (now + timedelta(seconds=max(300, settings.ark_timeout_seconds * 3))).replace(
            microsecond=0
        )
        step.lease = lease
        db.commit()
    except Exception:
        output.status = "generation_failed" if phase == "queued" else "save_failed"
        step.error = "input_unavailable" if phase == "queued" else "saving_failed"
        if phase == "queued":
            step.fee_state, step.actual_cents = "released", 0
        db.commit()
        return
    sent = False
    cooldown = 0
    try:
        if phase == "queued":
            images = read_media(storage, sources)
            size = validate_parameters(ImageParameters.model_validate(snap["draft"]["parameters"]))
            prompt = snap["draft"]["prompt"]
            if snap["facts"]:
                prompt += "\n已确认商品事实：" + json.dumps(snap["facts"], ensure_ascii=False)
            if snap.get("feedback"):
                prompt += "\n返工意见：" + json.dumps(snap["feedback"], ensure_ascii=False)
            request = ImageGenerationRequest(
                model=snap["model"],
                prompt=prompt,
                image=images or None,
                size=f"{size['width']}x{size['height']}",
            )
            with ArkImageClient(settings) as provider:
                sent = True
                result = provider.generate(request)
            step.provider_id = result.request_id
            if not result.data[0].url:
                raise ValueError("missing_result")
            output.status, step.result_url, step.fee_state = (
                "saving",
                str(result.data[0].url),
                "unverified",
            )
        else:
            body = download(step.result_url or "", settings.max_image_bytes)
            size = validate_parameters(ImageParameters.model_validate(snap["draft"]["parameters"]))
            with Image.open(BytesIO(body)) as img:
                width, height = img.size
                if img.format != "PNG" or img.size != (size["width"], size["height"]):
                    raise ValueError("invalid_result")
                img.verify()
            key = f"generated/{job.tenant_id}/{identifier}.png"
            storage.put(key, BytesIO(body), "image/png", len(body))
            current = db.get(ImageStep, identifier, with_for_update=True, populate_existing=True)
            if not current or current.lease != lease:
                db.rollback()
                return
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
    except ArkImageError as exc:
        if exc.category == "rate_limited":
            cooldown = min(max(1, exc.retry_after or 30), 86400)
        step.provider_id, step.error = exc.request_id, exc.category
        if exc.category in ("configuration", "authentication", "invalid_request", "rate_limited"):
            output.status = "generation_failed"
            step.fee_state, step.actual_cents = "released", 0
        else:
            output.status, step.fee_state = "unknown", "unverified"
    except Exception:
        output.status = "unknown" if phase == "queued" else "save_failed"
        if phase == "queued":
            step.fee_state = "unverified"
            if not sent:
                output.status, step.fee_state, step.actual_cents = (
                    "generation_failed",
                    "released",
                    0,
                )
        step.error = f"{phase}_failed"
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
