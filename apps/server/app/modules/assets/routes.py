import logging
from collections.abc import Iterator
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Annotated, BinaryIO
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool
from starlette.requests import ClientDisconnect

from app.adapters.media_probe import InvalidMedia, MediaUnavailable
from app.adapters.object_storage import ObjectStorage, StorageUnavailable, get_object_storage
from app.modules.identity.domain import Permission
from app.modules.identity.security import (
    ActiveIdentity,
    AppSettings,
    Database,
    WriteIdentity,
    require_permission,
)

from .schemas import MediaFile, UploadRequest, UploadReservation
from .service import (
    FileError,
    complete_upload,
    find_file,
    metadata,
    parse_byte_range,
    reserve_file,
    store_upload,
    upload_target,
)

router = APIRouter(prefix="/files", tags=["私有媒体"])
logger = logging.getLogger(__name__)


def get_storage() -> ObjectStorage:
    try:
        return get_object_storage()
    except StorageUnavailable as exc:
        raise HTTPException(503, "storage_unavailable") from exc


Storage = Annotated[ObjectStorage, Depends(get_storage)]


@router.post("/uploads", status_code=201, operation_id="createUpload")
def create_upload(
    data: UploadRequest,
    identity: WriteIdentity,
    db: Database,
    settings: AppSettings,
) -> UploadReservation:
    require_permission(identity, Permission.CREATE)
    try:
        return reserve_file(db, identity.tenant.id, identity.user.id, data, settings)
    except FileError as exc:
        raise HTTPException(exc.status, exc.code) from exc


@router.put(
    "/{file_id}/upload",
    status_code=204,
    operation_id="uploadFileContent",
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "application/octet-stream": {"schema": {"type": "string", "format": "binary"}},
            },
        }
    },
)
async def put_content(
    file_id: str,
    request: Request,
    identity: WriteIdentity,
    db: Database,
    storage: Storage,
) -> Response:
    require_permission(identity, Permission.CREATE)
    try:
        target = await run_in_threadpool(
            upload_target, db, identity.tenant.id, identity.user.id, file_id
        )
        content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if content_type not in {target.content_type, "application/octet-stream"}:
            raise FileError(415, "media_type_mismatch")
        announced = request.headers.get("content-length")
        if announced is not None and announced != str(target.size):
            raise FileError(413, "file_size_mismatch")
        with TemporaryDirectory(prefix="studio-media-") as directory:
            path = Path(directory) / "upload"
            count = 0
            with path.open("wb") as stream:
                async for chunk in request.stream():
                    count += len(chunk)
                    if count > target.size:
                        raise FileError(413, "file_size_mismatch")
                    if chunk:
                        await run_in_threadpool(stream.write, chunk)
            if count != target.size:
                raise FileError(400, "file_size_mismatch")
            await run_in_threadpool(store_upload, db, target, path, storage)
    except FileError as exc:
        raise HTTPException(exc.status, exc.code) from exc
    except InvalidMedia as exc:
        raise HTTPException(415, str(exc)) from exc
    except (MediaUnavailable, StorageUnavailable) as exc:
        raise HTTPException(503, "media_processing_unavailable") from exc
    except ClientDisconnect as exc:
        raise HTTPException(400, "upload_interrupted") from exc
    return Response(status_code=204)


@router.post("/{file_id}/complete", operation_id="completeUpload")
def complete(file_id: str, identity: WriteIdentity, db: Database) -> MediaFile:
    require_permission(identity, Permission.CREATE)
    try:
        return complete_upload(db, identity.tenant.id, identity.user.id, file_id)
    except FileError as exc:
        raise HTTPException(exc.status, exc.code) from exc


@router.get("/{file_id}", operation_id="getFileMetadata")
def get_metadata(
    file_id: str, response: Response, identity: ActiveIdentity, db: Database
) -> MediaFile:
    try:
        result = metadata(find_file(db, identity.tenant.id, file_id))
    except FileError as exc:
        raise HTTPException(exc.status, exc.code) from exc
    response.headers["Cache-Control"] = "private, no-store"
    return result


def _chunks(body: BinaryIO) -> Iterator[bytes]:
    with body:
        while chunk := body.read(256 * 1024):
            yield chunk


@router.get(
    "/{file_id}/content",
    operation_id="downloadFileContent",
    response_class=StreamingResponse,
    responses={
        200: {
            "content": {
                "application/octet-stream": {"schema": {"type": "string", "format": "binary"}}
            }
        },
        206: {"description": "经授权的部分内容"},
    },
)
def download(
    file_id: str,
    request: Request,
    identity: ActiveIdentity,
    db: Database,
    storage: Storage,
) -> StreamingResponse:
    try:
        item = find_file(db, identity.tenant.id, file_id)
        media = metadata(item)
        if item.object_key is None:
            raise FileError(404, "file_not_found")
        require_permission(identity, Permission.DOWNLOAD)
        tenant_id, user_id, key = identity.tenant.id, identity.user.id, item.object_key
        byte_range = parse_byte_range(request.headers.get("range"), media.size_bytes)
    except FileError as exc:
        headers = {"Content-Range": f"bytes */{item.size_bytes}"} if exc.status == 416 else None
        raise HTTPException(exc.status, exc.code, headers=headers) from exc
    db.rollback()
    try:
        body = storage.read(key, byte_range)
    except StorageUnavailable as exc:
        raise HTTPException(503, "storage_unavailable") from exc
    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(media.filename, safe='')}",
        "Content-Length": str(media.size_bytes),
        "X-Content-Type-Options": "nosniff",
    }
    if byte_range is not None:
        start, end = byte_range
        headers.update(
            {
                "Content-Range": f"bytes {start}-{end}/{media.size_bytes}",
                "Content-Length": str(end - start + 1),
            }
        )
    logger.info("private file read tenant=%s user=%s file=%s", tenant_id, user_id, media.id)
    return StreamingResponse(
        _chunks(body),
        status_code=206 if byte_range else 200,
        media_type=media.content_type,
        headers=headers,
    )
