"""Versioned object backup and verification for a quiesced MySQL snapshot."""

import argparse
import hashlib
import json
import os
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO, Literal, cast

from pydantic import BaseModel, Field
from sqlalchemy import Table, func, select, text
from sqlalchemy.orm import Session

from app.adapters.object_storage import s3_client
from app.api.router import api_router  # noqa: F401
from app.modules.assets.models import PrivateFile
from app.modules.commerce.models import ModelCall
from app.modules.creation.models import Creation, CreationOutput
from app.modules.delivery.models import Adoption
from app.modules.execution.models import Execution, ImageStep
from app.modules.tasks.models import Task
from app.shared.config import get_settings
from app.shared.db import SessionLocal


class ObjectEntry(BaseModel):
    key: str
    version: str
    content_type: str
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    size: int = Field(ge=0)


class Manifest(BaseModel):
    format: Literal[1] = 1
    captured_at: datetime
    mysql_sha256: str
    inventory: dict[str, Any]
    objects: list[ObjectEntry]


def stream_digest(source: BinaryIO, destination: BinaryIO | None = None) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    while block := source.read(1024 * 1024):
        digest.update(block)
        size += len(block)
        if destination:
            destination.write(block)
    return digest.hexdigest(), size


def file_digest(path: Path) -> tuple[str, int]:
    with path.open("rb") as source:
        return stream_digest(source)


def blob_path(directory: Path, key: str) -> Path:
    return directory / hashlib.sha256(key.encode()).hexdigest()


def keys(s3: Any, bucket: str) -> list[str]:
    return sorted(
        item["Key"]
        for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket)
        for item in page.get("Contents", [])
    )


def require_versioning(s3: Any, bucket: str) -> None:
    if s3.get_bucket_versioning(Bucket=bucket).get("Status") != "Enabled":
        raise ValueError("bucket versioning must be enabled")


def capture_objects(s3: Any, bucket: str, directory: Path) -> list[ObjectEntry]:
    require_versioning(s3, bucket)
    entries = []
    for key in keys(s3, bucket):
        response = s3.get_object(Bucket=bucket, Key=key)
        with closing(response["Body"]) as source, blob_path(directory, key).open("xb") as target:
            digest, size = stream_digest(source, target)
        entries.append(ObjectEntry(
            key=key, version=response.get("VersionId", "null"),
            content_type=response.get("ContentType", "application/octet-stream"),
            sha256=digest, size=size,
        ))
    return entries


def restore_objects(
    s3: Any, bucket: str, directory: Path, entries: list[ObjectEntry],
) -> None:
    require_versioning(s3, bucket)
    if keys(s3, bucket):
        raise ValueError("restore requires an empty destination bucket")
    if len({entry.key for entry in entries}) != len(entries):
        raise ValueError("duplicate object keys in manifest")
    for entry in entries:
        if file_digest(blob_path(directory, entry.key)) != (entry.sha256, entry.size):
            raise ValueError("object archive checksum mismatch")
    for entry in entries:
        s3.upload_file(
            str(blob_path(directory, entry.key)), bucket, entry.key,
            ExtraArgs={"ContentType": entry.content_type},
        )


def database_inventory(db: Session) -> dict[str, Any]:
    # Digest complete business rows without putting prompts or review notes in the manifest.
    models = (Task, Creation, CreationOutput, ImageStep, Adoption)
    business = {}
    for model in models:
        table = cast(Table, model.__table__)
        digest = hashlib.sha256()
        count = 0
        for row in db.execute(select(table).order_by(*table.primary_key.columns)):
            record = json.dumps(dict(row._mapping), sort_keys=True, default=str, ensure_ascii=True)
            digest.update(record.encode() + b"\n")
            count += 1
        business[table.name] = {"count": count, "sha256": digest.hexdigest()}
    files = dict(db.execute(select(
        PrivateFile.object_key, PrivateFile.size_bytes,
    ).where(PrivateFile.status == "ready", PrivateFile.object_key.is_not(None))).all())
    return {
        "revision": db.execute(text("SELECT version_num FROM alembic_version")).scalar_one(),
        "business": business,
        "files": files,
    }


def verify_references(manifest: Manifest) -> None:
    sizes = {entry.key: entry.size for entry in manifest.objects}
    if any(sizes.get(key) != size for key, size in manifest.inventory["files"].items()):
        raise ValueError("ready file missing or size mismatch")


def verify_restore(s3: Any, bucket: str, manifest: Manifest, db: Session) -> None:
    verify_references(manifest)
    if database_inventory(db) != manifest.inventory:
        raise ValueError("restored database inventory differs from the backup")
    if keys(s3, bucket) != sorted(entry.key for entry in manifest.objects):
        raise ValueError("restored object list differs from the backup")
    for entry in manifest.objects:
        response = s3.get_object(Bucket=bucket, Key=entry.key)
        with closing(response["Body"]) as body:
            if stream_digest(body) != (entry.sha256, entry.size):
                raise ValueError("restored object checksum mismatch")


def provider_inventory(db: Session) -> list[dict[str, Any]]:
    execution_rows = db.execute(
        select(
            Execution.tenant_id, Execution.id.label("execution_id"), Execution.created_at,
            ImageStep.output_id, ImageStep.provider_id, ImageStep.fee_state,
            ImageStep.actual_cents, ImageStep.reserved_cents, CreationOutput.status,
        ).select_from(Execution)
        .join(ImageStep, ImageStep.execution_id == Execution.id)
        .join(CreationOutput, CreationOutput.id == ImageStep.output_id)
        .order_by(Execution.created_at, ImageStep.output_id)
    ).mappings()
    assistances = db.execute(select(
        ModelCall.id, ModelCall.tenant_id, ModelCall.kind, ModelCall.provider_id,
        ModelCall.status, ModelCall.reserved_cents,
    ).order_by(ModelCall.id)).mappings()
    return [
        *({"kind": "execution", **row} for row in execution_rows),
        *(dict(row) for row in assistances),
    ]


def metrics(db: Session) -> str:
    counts = dict(db.execute(
        select(CreationOutput.status, func.count()).group_by(CreationOutput.status)
    ).all())
    pending = db.scalar(select(func.count()).select_from(ImageStep).where(
        ImageStep.fee_state == "unverified",
    ))
    assistance = db.scalar(select(func.count()).select_from(ModelCall).where(
        ModelCall.status.in_(("pending", "unverified")),
    ))
    return "\n".join([
        *(f'studio_outputs{{status="{status}"}} {counts.get(status, 0)}'
          for status in ("queued", "generating", "saving", "save_failed", "unknown")),
        f"studio_unverified_execution_fees {pending}",
        f"studio_unverified_assistance_fees {assistance}",
        "",
    ])


def run() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("capture", "restore", "verify", "providers", "metrics"))
    parser.add_argument("bundle", type=Path, nargs="?")
    args = parser.parse_args()
    os.umask(0o077)
    settings = get_settings()
    if args.action in ("providers", "metrics"):
        with SessionLocal() as db:
            print(json.dumps(provider_inventory(db), default=str) if args.action == "providers"
                  else metrics(db), end="\n" if args.action == "providers" else "")
        return
    if args.bundle is None or not settings.paid_calls_paused:
        parser.error("provide a bundle and set PAID_CALLS_PAUSED=true for backup or restore")
    directory = args.bundle
    dump = directory / "mysql.sql"
    dump_checksum, dump_size = file_digest(dump)
    if not dump_size:
        parser.error("mysql.sql is empty")
    manifest_path = directory / "manifest.json"
    blobs = directory / "objects"
    s3 = s3_client(settings, settings.storage_endpoint)
    bucket = settings.storage_bucket
    if args.action == "capture":
        blobs.mkdir()
        with SessionLocal() as db:
            manifest = Manifest(
                captured_at=datetime.now(timezone.utc), mysql_sha256=dump_checksum,
                inventory=database_inventory(db), objects=capture_objects(s3, bucket, blobs),
            )
        verify_references(manifest)
        with manifest_path.open("x") as destination:
            destination.write(manifest.model_dump_json(indent=2))
    else:
        manifest = Manifest.model_validate_json(manifest_path.read_bytes())
        if dump_checksum != manifest.mysql_sha256:
            parser.error("MySQL dump checksum mismatch")
        if args.action == "restore":
            verify_references(manifest)
            restore_objects(s3, bucket, blobs, manifest.objects)
        else:
            with SessionLocal() as db:
                verify_restore(s3, bucket, manifest, db)
    revision = manifest.inventory["revision"]
    print(f"{args.action}: revision={revision} objects={len(manifest.objects)}")


if __name__ == "__main__":
    run()
