from fastapi import APIRouter, HTTPException, Request, Response
from sqlalchemy import select

from app.modules.assets.models import PrivateFile
from app.modules.assets.routes import Storage, stream_private_file
from app.modules.creation.results import TaskResult, file_ready, result_view
from app.modules.execution.models import Execution
from app.modules.execution.sources import verify_sources
from app.modules.identity.domain import Permission
from app.modules.identity.models import new_id
from app.modules.identity.security import (
    ActiveIdentity,
    AppSettings,
    Database,
    WriteIdentity,
    require_permission,
)
from app.modules.identity.team import record
from app.modules.products.schemas import ResourceId, WriteSchema
from app.modules.reviews.routes import list_versions, version_for
from app.modules.tasks.models import DeliveryPosition

from .models import Adoption
from .service import has_reservation, lock_adoption, matches_module, matches_spec

router = APIRouter(tags=["公司资产与交付"])


class AdoptInput(WriteSchema):
    version_id: ResourceId


@router.get("/assets")
def assets(
    identity: ActiveIdentity,
    db: Database,
    status: str | None = "approved",
    product_id: str | None = None,
    task_id: str | None = None,
) -> list[TaskResult]:
    require_permission(identity, Permission.VIEW)
    items = list_versions(db, identity.tenant.id, status, product_id, task_id)
    if task_id:
        positions = db.scalars(
            select(DeliveryPosition).where(
                DeliveryPosition.task_id == task_id,
                DeliveryPosition.tenant_id == identity.tenant.id,
            )
        ).all()
        jobs = {
            job.id: job
            for job in db.scalars(
                select(Execution).where(Execution.id.in_({i.execution_id for i in items}))
            )
        }
        for item in items:
            item.matching_positions = [
                p.id
                for p in positions
                if p.purpose == item.purpose
                and p.product_id == item.product_id
                and p.purpose != "video"
                and matches_module(p, jobs.get(item.execution_id))
                and matches_spec(p, item)
            ]
    return items


@router.get("/assets/{identifier}")
def asset(identifier: str, identity: ActiveIdentity, db: Database) -> TaskResult:
    require_permission(identity, Permission.VIEW)
    out, draft = version_for(db, identity.tenant.id, identifier)
    return result_view(out, draft, db.get(PrivateFile, out.file_id) if out.file_id else None)


def position(db: Database, tenant: str, identifier: str) -> DeliveryPosition:
    row = db.scalar(
        select(DeliveryPosition)
        .where(DeliveryPosition.tenant_id == tenant, DeliveryPosition.id == identifier)
        .with_for_update()
    )
    if not row:
        raise HTTPException(404, "position_not_found")
    return row


def deliverable(db: Database, pos: DeliveryPosition, identifier: str) -> PrivateFile:
    out, draft = version_for(db, pos.tenant_id, identifier, True)
    file = db.get(PrivateFile, out.file_id) if out.file_id else None
    job = db.get(Execution, out.execution_id)
    if (
        not file
        or file.tenant_id != pos.tenant_id
        or out.status != "approved"
        or not file_ready(file, out.file_version)
        or not matches_spec(pos, file)
        or draft.product_id != pos.product_id
        or draft.purpose != pos.purpose
        or pos.purpose == "video"
        or not matches_module(pos, job)
    ):
        raise HTTPException(409, "asset_not_deliverable")
    if job:
        verify_sources(db, pos.tenant_id, job.snapshot)
    return file


@router.get("/delivery-positions/{identifier}/adoption")
def adoption(
    identifier: str, identity: ActiveIdentity, db: Database, settings: AppSettings
) -> dict[str, str] | None:
    require_permission(identity, Permission.VIEW)
    position(db, identity.tenant.id, identifier)
    item = db.get(Adoption, identifier)
    if not item:
        return None
    return {
        "version_id": item.output_id,
        "download": f"{settings.api_prefix}/delivery-positions/{identifier}/download/{item.token}",
    }


@router.put("/delivery-positions/{identifier}/adoption")
def adopt(
    identifier: str, data: AdoptInput, identity: WriteIdentity, db: Database, settings: AppSettings
) -> dict[str, str]:
    require_permission(identity, Permission.ADOPT)
    pos = position(db, identity.tenant.id, identifier)
    deliverable(db, pos, data.version_id)
    other = db.scalar(
        select(Adoption).where(Adoption.output_id == data.version_id).with_for_update()
    )
    if other and other.position_id != identifier:
        raise HTTPException(409, "version_already_adopted")
    item = lock_adoption(db, identifier)
    if not item:
        item = Adoption(position_id=identifier, output_id=data.version_id, token=new_id())
        db.add(item)
        record(db, identity, "采用交付版本", f"{identifier} · {data.version_id}")
    elif item.output_id != data.version_id:
        item.output_id, item.token = data.version_id, new_id()
        record(db, identity, "更换交付版本", f"{identifier} · {data.version_id}")
    pos.status = "adopted"
    db.commit()
    return {
        "version_id": item.output_id,
        "download": f"{settings.api_prefix}/delivery-positions/{identifier}/download/{item.token}",
    }


@router.delete("/delivery-positions/{identifier}/adoption", status_code=204)
def withdraw(identifier: str, identity: WriteIdentity, db: Database) -> Response:
    require_permission(identity, Permission.ADOPT)
    pos = position(db, identity.tenant.id, identifier)
    item = lock_adoption(db, identifier)
    if item:
        db.delete(item)
        pos.status = "reserved" if has_reservation(db, pos.id) else "unfilled"
        record(db, identity, "撤销交付采用", f"{identifier} · {item.output_id}")
    db.commit()
    return Response(status_code=204)


@router.get("/delivery-positions/{identifier}/download/{token}", response_class=Response)
def download(
    identifier: str,
    token: str,
    request: Request,
    identity: ActiveIdentity,
    db: Database,
    storage: Storage,
) -> Response:
    require_permission(identity, Permission.DOWNLOAD)
    pos = position(db, identity.tenant.id, identifier)
    item = db.get(Adoption, identifier)
    if not item or item.token != token:
        raise HTTPException(409, "adoption_withdrawn")
    file = deliverable(db, pos, item.output_id)
    return stream_private_file(
        file, request, identity, db, storage,
        audit=("下载交付版本", f"{identifier} · {item.output_id}"),
    )
