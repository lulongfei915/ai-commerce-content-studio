import re
from dataclasses import dataclass
from datetime import timedelta, timezone
from pathlib import Path
from typing import cast
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from app.adapters.media_probe import inspect_media
from app.adapters.object_storage import ObjectStorage, StorageUnavailable
from app.modules.identity.service import utc_now
from app.shared.config import Settings

from .models import PrivateFile
from .schemas import MediaFile, UploadRequest, UploadReservation


class FileError(Exception):
    def __init__(self, status: int, code: str) -> None:
        self.status, self.code = status, code
        super().__init__(code)


@dataclass(frozen=True)
class UploadTarget:
    id: str
    tenant_id: str
    size: int
    content_type: str


def reserve_file(
    db: Session,
    tenant_id: str,
    user_id: str,
    data: UploadRequest,
    settings: Settings,
) -> UploadReservation:
    maximum = (
        settings.max_image_bytes
        if data.content_type.startswith("image/")
        else settings.max_video_bytes
    )
    if data.size_bytes > maximum:
        raise FileError(413, "file_too_large")
    file = PrivateFile(
        tenant_id=tenant_id,
        created_by=user_id,
        filename=data.filename,
        content_type=data.content_type,
        size_bytes=data.size_bytes,
        expires_at=utc_now() + timedelta(seconds=settings.upload_ttl_seconds),
    )
    db.add(file)
    db.commit()
    return UploadReservation(
        id=file.id,
        expires_at=file.expires_at.replace(tzinfo=timezone.utc),
        upload_path=f"{settings.api_prefix}/files/{file.id}/upload",
    )


def find_file(db: Session, tenant_id: str, file_id: str) -> PrivateFile:
    item = db.scalar(
        select(PrivateFile)
        .where(
            PrivateFile.tenant_id == tenant_id,
            PrivateFile.id == file_id,
        )
        .execution_options(populate_existing=True)
    )
    if item is None:
        raise FileError(404, "file_not_found")
    return item


def upload_target(db: Session, tenant_id: str, user_id: str, file_id: str) -> UploadTarget:
    item = find_file(db, tenant_id, file_id)
    if item.created_by != user_id:
        raise FileError(404, "file_not_found")
    if item.expires_at <= utc_now():
        raise FileError(409, "upload_expired")
    if item.status != "pending":
        raise FileError(409, "upload_not_pending")
    result = UploadTarget(item.id, item.tenant_id, item.size_bytes, item.content_type)
    db.rollback()
    return result


def store_upload(db: Session, target: UploadTarget, path: Path, storage: ObjectStorage) -> None:
    info = inspect_media(path, target.content_type)
    key = f"{target.tenant_id}/{target.id}/{uuid4().hex}"
    with path.open("rb") as stream:
        storage.put(key, stream, target.content_type, target.size)
    result = db.execute(
        update(PrivateFile)
        .where(
            PrivateFile.id == target.id,
            PrivateFile.tenant_id == target.tenant_id,
            PrivateFile.status == "pending",
            PrivateFile.expires_at > utc_now(),
        )
        .values(
            status="uploaded",
            object_key=key,
            width=info.width,
            height=info.height,
            duration_seconds=info.duration_seconds,
        ),
    )
    affected = cast(CursorResult[tuple[()]], result).rowcount
    db.commit()
    if affected != 1:
        try:
            storage.delete(key)
        except StorageUnavailable:
            pass
        raise FileError(409, "upload_not_pending")


def complete_upload(db: Session, tenant_id: str, user_id: str, file_id: str) -> MediaFile:
    item = find_file(db, tenant_id, file_id)
    if item.created_by != user_id:
        raise FileError(404, "file_not_found")
    if item.status == "ready":
        return metadata(item)
    if item.status != "uploaded" or item.expires_at <= utc_now():
        raise FileError(409, "upload_not_ready")
    db.execute(
        update(PrivateFile)
        .where(
            PrivateFile.id == file_id,
            PrivateFile.tenant_id == tenant_id,
            PrivateFile.status == "uploaded",
            PrivateFile.expires_at > utc_now(),
        )
        .values(status="ready")
    )
    db.commit()
    item = find_file(db, tenant_id, file_id)
    if item.status != "ready":
        raise FileError(409, "upload_not_ready")
    return metadata(item)


def metadata(item: PrivateFile) -> MediaFile:
    if item.status != "ready" or item.width is None or item.height is None:
        raise FileError(404, "file_not_found")
    return MediaFile(
        id=item.id,
        filename=item.filename,
        size_bytes=item.size_bytes,
        content_type=item.content_type,
        version=item.version,
        width=item.width,
        height=item.height,
        duration_seconds=item.duration_seconds,
    )


def parse_byte_range(value: str | None, size: int) -> tuple[int, int] | None:
    if value is None:
        return None
    match = re.fullmatch(r"bytes=([0-9]{0,20})-([0-9]{0,20})", value)
    if match is None or not any(match.groups()):
        raise FileError(416, "range_not_satisfiable")
    first, last = match.groups()
    if not first:
        suffix = int(last)
        if suffix > 0:
            return max(size - suffix, 0), size - 1
    else:
        start = int(first)
        end = min(int(last), size - 1) if last else size - 1
        if start <= end:
            return start, end
    raise FileError(416, "range_not_satisfiable")
