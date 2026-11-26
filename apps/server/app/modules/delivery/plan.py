import json
import shutil
from collections.abc import Iterator
from pathlib import PurePath
from tempfile import TemporaryFile
from zipfile import ZipFile

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import Field
from sqlalchemy import select, update

from app.modules.assets.routes import Storage
from app.modules.creation.capabilities import GPT_SIZES, SIZES
from app.modules.execution.models import Execution
from app.modules.identity.domain import Permission
from app.modules.identity.security import (
    ActiveIdentity,
    Database,
    WriteIdentity,
    require_permission,
)
from app.modules.identity.team import record
from app.modules.products.schemas import WriteSchema
from app.modules.tasks.models import DeliveryPosition
from app.modules.tasks.schemas import Purpose, TaskResponse
from app.modules.tasks.service import get_task, task_view
from app.shared.studio_errors import check_version

from .models import Adoption
from .routes import deliverable
from .service import LABELS, fill_open_position, module_for

router = APIRouter(prefix="/tasks/{task_id}", tags=["交付清单"])


class Requirement(WriteSchema):
    product_id: str
    purpose: Purpose
    module: str = Field(min_length=1, max_length=40)
    count: int = Field(ge=1, le=6)
    ratio: str | None = None
    resolution: str | None = None
    duration: int | None = None


class PlanEdit(WriteSchema):
    expected_version: int = Field(ge=1)
    rows: list[Requirement] = Field(min_length=1, max_length=150)


def slots(db: Database, tenant: str, task_id: str) -> list[DeliveryPosition]:
    return list(
        db.scalars(
            select(DeliveryPosition)
            .where(DeliveryPosition.tenant_id == tenant, DeliveryPosition.task_id == task_id)
            .order_by(DeliveryPosition.id)
            .with_for_update()
        )
    )


def validate_plan(data: PlanEdit, products: set[str]) -> None:
    if sum(row.count for row in data.rows) > 100:
        raise HTTPException(422, "delivery_position_limit")
    seen = set()
    for row in data.rows:
        key = (row.product_id, row.purpose, row.module)
        if row.product_id not in products or key in seen:
            raise HTTPException(422, "invalid_delivery_requirement")
        seen.add(key)
        if any((row.ratio, row.resolution, row.duration)):
            valid = (
                (
                    row.ratio in {"1:1", "16:9", "9:16"}
                    and row.resolution in {"720p", "1080p"}
                    and row.duration in {5, 6, 10, 12, 15}
                )
                if row.purpose == "video"
                else (
                    not row.duration
                    and any(
                        (s["ratio"], s["resolution"]) == (row.ratio, row.resolution)
                        for s in SIZES + GPT_SIZES
                    )
                )
            )
            if not valid:
                raise HTTPException(422, "invalid_delivery_requirement")


@router.post("/requirements/preview")
def preview(task_id: str, data: PlanEdit, identity: WriteIdentity, db: Database) -> dict[str, int]:
    require_permission(identity, Permission.CREATE)
    task = get_task(db, identity.tenant.id, task_id, lock=True)
    check_version(task.version, data.expected_version)
    validate_plan(data, {p.id for p in task_view(db, task).products})
    rows: dict[tuple[str, str, str], Requirement] = {
        (r.product_id, r.purpose, r.module): r for r in data.rows
    }
    removed = 0
    for pos in slots(db, task.tenant_id, task_id):
        adoption = db.get(Adoption, pos.id)
        if not adoption:
            continue
        row = rows.get((pos.product_id, pos.purpose, pos.module or LABELS[pos.purpose]))
        if not row or pos.sequence >= row.count:
            removed += 1
            continue
        proposed = DeliveryPosition(
            tenant_id=pos.tenant_id,
            product_id=row.product_id,
            purpose=row.purpose,
            module=row.module,
            ratio=row.ratio,
            resolution=row.resolution,
            duration=row.duration,
        )
        if not still_deliverable(db, proposed, adoption):
            removed += 1
    return {"removed": removed}


def still_deliverable(db: Database, pos: DeliveryPosition, adoption: Adoption) -> bool:
    try:
        deliverable(db, pos, adoption.output_id)
        return True
    except HTTPException as exc:
        if exc.status_code not in (404, 409, 422):
            raise
        return False


@router.put("/requirements")
def configure(task_id: str, data: PlanEdit, identity: WriteIdentity, db: Database) -> TaskResponse:
    require_permission(identity, Permission.CREATE)
    task = get_task(db, identity.tenant.id, task_id, lock=True)
    check_version(task.version, data.expected_version)
    validate_plan(data, {p.id for p in task_view(db, task).products})
    existing = {
        (p.product_id, p.purpose, p.module or LABELS[p.purpose], p.sequence): p
        for p in slots(db, task.tenant_id, task_id)
    }
    changed = []
    for row in data.rows:
        key = (row.product_id, row.purpose, row.module)
        for seq in range(row.count):
            pos = existing.pop((*key, seq), None)
            if not pos:
                pos = DeliveryPosition(
                    tenant_id=task.tenant_id,
                    task_id=task.id,
                    product_id=row.product_id,
                    purpose=row.purpose,
                    module=row.module,
                    sequence=seq,
                )
                db.add(pos)
                changed.append(pos)
            elif (pos.ratio, pos.resolution, pos.duration) != (
                row.ratio,
                row.resolution,
                row.duration,
            ):
                changed.append(pos)
                db.execute(
                    update(Execution)
                    .where(Execution.position_id == pos.id)
                    .values(position_id=None)
                )
                if pos.status == "reserved":
                    pos.status = "unfilled"
            pos.ratio, pos.resolution, pos.duration = row.ratio, row.resolution, row.duration
            if pos.id and (adoption := db.get(Adoption, pos.id)):
                if not still_deliverable(db, pos, adoption):
                    db.delete(adoption)
                    pos.status = "unfilled"
    for pos in existing.values():
        if adoption := db.get(Adoption, pos.id):
            db.delete(adoption)
            db.flush()
        db.execute(
            update(Execution).where(Execution.position_id == pos.id).values(position_id=None)
        )
        db.delete(pos)
    task.version += 1
    record(db, identity, "配置交付要求", task.name)
    db.flush()
    for pos in changed:
        fill_open_position(db, pos)
        db.flush()
    result = task_view(db, task)
    db.commit()
    return result


@router.get("/delivery-package", response_class=StreamingResponse)
def export(
    task_id: str, identity: ActiveIdentity, db: Database, storage: Storage
) -> StreamingResponse:
    require_permission(identity, Permission.DOWNLOAD)
    task = get_task(db, identity.tenant.id, task_id, lock=True)
    products = {p.id: p.sku for p in task_view(db, task).products}
    archive = TemporaryFile()
    manifest = []
    count = 0
    try:
        with ZipFile(archive, "w") as package:
            for pos in slots(db, task.tenant_id, task.id):
                row = {
                    "position": pos.id,
                    "sku": products[pos.product_id],
                    "module": module_for(pos),
                    "purpose": pos.purpose,
                    "sequence": pos.sequence + 1,
                    "ratio": pos.ratio,
                    "resolution": pos.resolution,
                    "duration": pos.duration,
                    "status": "待补齐",
                    "reason": (
                        "待确认成片" if pos.purpose == "video"
                        else "已有制作预留" if pos.status == "reserved"
                        else "未采用有效版本"
                    ),
                }
                manifest.append(row)
                if not (adoption := db.get(Adoption, pos.id)):
                    continue
                try:
                    file = deliverable(db, pos, adoption.output_id)
                except HTTPException as exc:
                    if exc.status_code not in (404, 409, 422):
                        raise
                    row["reason"] = "原采用版本已失效"
                    continue
                assert file.object_key
                suffix = PurePath(file.filename).suffix.lower()
                ext = suffix if suffix in {".png", ".jpg", ".jpeg", ".webp", ".mp4"} else ""
                name = f"assets/{pos.id}/{adoption.output_id}{ext}"
                with storage.read(file.object_key, None) as source, package.open(name, "w") as dest:
                    shutil.copyfileobj(source, dest, 256 * 1024)
                if package.getinfo(name).file_size != file.size_bytes:
                    raise HTTPException(409, "delivery_file_changed")
                row.update(status="可交付", version_id=adoption.output_id, file=name)
                row.pop("reason")
                count += 1
            if not count:
                raise HTTPException(409, "delivery_empty")
            package.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        record(db, identity, "导出交付包", f"{task.name} · {count}/{len(manifest)}")
        db.commit()
        archive.seek(0)
    except BaseException:
        archive.close()
        raise

    def chunks() -> Iterator[bytes]:
        with archive:
            while data := archive.read(256 * 1024):
                yield data

    return StreamingResponse(
        chunks(),
        media_type="application/zip",
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": f'attachment; filename="delivery-{task.id}.zip"',
        },
    )
