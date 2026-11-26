from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.adapters.ark_video import (
    ArkVideoClient,
    ArkVideoError,
    VideoGenerationRequest,
    VideoReference,
    matches_video_dimensions,
)
from app.adapters.media_probe import InvalidMedia, inspect_media
from app.adapters.object_storage import ObjectStorage, S3Storage
from app.adapters.vision import data_url
from app.modules.assets.models import PrivateFile
from app.modules.creation.models import CreationOutput
from app.shared.config import Settings
from app.shared.entitlements import PaidCallBlocked, check_provider_send

from .models import Execution, ImageStep
from .runner import download, read_object
from .sources import verify_sources

REJECTED = {"configuration", "authentication", "invalid_request", "rate_limited"}
POLL_RETRY = {"provider_timeout", "provider_unavailable", "rate_limited", "invalid_response"}


def reference_payload(
    storage: ObjectStorage, files: list[tuple[dict[str, Any], str, str]]
) -> list[VideoReference]:
    refs = []
    for ref, key, mime in files:
        role: Literal["first_frame", "last_frame", "reference_image", "reference_video"]
        if mime == "video/mp4":
            role = "reference_video"
        elif ref["usage"] in {"first_frame", "last_frame"}:
            role = ref["usage"]
        else:
            role = "reference_image"
        url = storage.provider_url(key) if isinstance(storage, S3Storage) else None
        if not url or not url.startswith("https://"):
            if role == "reference_video":
                raise ValueError("video_reference_storage_not_configured")
            url = data_url(mime, read_object(storage, key, 10 * 1024 * 1024))
        refs.append(VideoReference(role=role, url=url))
    return refs


def save_result(
    db: Session, job: Execution, output: CreationOutput, step: ImageStep,
    storage: ObjectStorage, settings: Settings, now: datetime,
) -> None:
    body = download(step.result_url or "", settings.max_video_bytes)
    with TemporaryDirectory(prefix="studio-generated-video-") as directory:
        path = Path(directory) / "result.mp4"
        path.write_bytes(body)
        info = inspect_media(path, "video/mp4")
    spec = job.snapshot["video_request"]
    if (
        not matches_video_dimensions(
            info.width, info.height, spec["ratio"], spec["resolution"],
            seedance_25=spec.get("seedance_25", False), frame_size=job.snapshot.get("frame_size"),
        )
        or abs(info.duration_seconds - spec["duration"]) >= 0.5
    ):
        raise InvalidMedia("video_spec_mismatch")
    key = f"generated/{job.tenant_id}/{output.id}.mp4"
    storage.put(key, BytesIO(body), "video/mp4", len(body))
    db.add(PrivateFile(
        id=output.id,
        tenant_id=job.tenant_id,
        created_by=job.user_id,
        filename=f"视频 {output.output_index + 1} · {output.id[:8]}.mp4",
        content_type="video/mp4",
        size_bytes=len(body),
        width=info.width,
        height=info.height,
        duration_seconds=info.duration_seconds,
        status="ready",
        version=1,
        object_key=key,
        expires_at=now,
    ))
    step.result_size = f"{info.width}x{info.height}"
    step.result_object_key = key
    step.result_url = None
    output.file_id, output.file_version, output.status = output.id, 1, "pending_review"


def process_video(
    db: Session, job: Execution, output: CreationOutput, step: ImageStep,
    storage: ObjectStorage, settings: Settings, now: datetime,
) -> None:
    phase = output.status
    if phase not in ("queued", "generating", "saving"):
        db.rollback()
        return
    if phase == "generating" and (
        not step.provider_id or now - job.created_at > timedelta(hours=24)
    ):
        output.status, step.fee_state, step.error = (
            "unknown", "unverified", "provider_status_unknown",
        )
        step.lease = None
        db.commit()
        return

    files = []
    if phase == "queued":
        active = list(db.scalars(
            select(Execution.tenant_id).join(ImageStep)
            .join(CreationOutput, CreationOutput.id == ImageStep.output_id)
            .where(
                Execution.snapshot["media"].as_string() == "video",
                CreationOutput.status == "generating",
            )
        ))
        if (
            len(active) >= settings.image_provider_slots
            or active.count(job.tenant_id) >= settings.image_tenant_slots
        ):
            db.rollback()
            return
        try:
            verify_sources(db, job.tenant_id, job.snapshot)
            for ref in job.snapshot["references"]:
                file = db.get(PrivateFile, ref["file_id"])
                if not file or not file.object_key:
                    raise ValueError("input_unavailable")
                files.append((ref, file.object_key, file.content_type))
        except Exception:
            output.status, step.error = "generation_failed", "input_unavailable"
            step.fee_state, step.actual_cents = "released", 0
            db.commit()
            return
        output.status = "generating"
    lease = now + timedelta(seconds=max(300, settings.ark_timeout_seconds * 3))
    lease = lease.replace(microsecond=0)
    step.lease = lease
    db.commit()

    sent = False
    cooldown = 0
    step.error = None
    try:
        if phase == "queued":
            request = VideoGenerationRequest(
                model=job.snapshot["model"],
                **job.snapshot["video_request"],
                references=reference_payload(storage, files),
            )
            with ArkVideoClient(settings) as provider:
                check_provider_send(settings)
                sent = True
                step.provider_id = provider.create_task(request).id
            step.fee_state = "unverified"
            cooldown = 10
        elif phase == "generating":
            with ArkVideoClient(settings) as provider:
                task = provider.get_task(step.provider_id or "")
            if task.status == "succeeded":
                step.result_url = str(task.video_url)
                output.status = "saving"
            elif task.status in ("queued", "running"):
                cooldown = 10
            else:
                output.status = "generation_failed"
                step.error = f"video_provider_{task.status}"
        else:
            save_result(db, job, output, step, storage, settings, now)
    except PaidCallBlocked:
        output.status = "queued"
    except ArkVideoError as exc:
        step.error = exc.category
        if phase == "queued" and exc.category in REJECTED:
            output.status = "generation_failed"
            step.fee_state, step.actual_cents = "released", 0
            if exc.category == "rate_limited":
                cooldown = 30
        elif phase == "generating" and exc.category in POLL_RETRY:
            cooldown = 30
        else:
            output.status, step.fee_state = "unknown", "unverified"
    except InvalidMedia:
        output.status, step.error = "result_unavailable", "invalid_result"
        step.result_url = None
    except Exception:
        if phase == "saving":
            output.status, step.error = "save_failed", "saving_failed"
        elif phase == "queued" and not sent:
            output.status, step.error = "generation_failed", "input_unavailable"
            step.fee_state, step.actual_cents = "released", 0
        else:
            output.status, step.fee_state, step.error = (
                "unknown", "unverified", "provider_status_unknown",
            )

    with db.no_autoflush:
        owned = db.execute(
            select(ImageStep.lease).where(ImageStep.output_id == output.id).with_for_update()
        ).scalar_one()
    if owned != lease:
        db.rollback()
        return
    step.lease = datetime.utcnow() + timedelta(seconds=cooldown) if cooldown else None
    db.commit()
