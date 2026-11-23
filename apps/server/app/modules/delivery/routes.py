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
from app.modules.products.schemas import ResourceId, WriteSchema
from app.modules.reviews.routes import list_versions, version_for
from app.modules.tasks.models import DeliveryPosition

from .models import Adoption

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
    return list_versions(db, identity.tenant.id, status, product_id, task_id)


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
    if (
        not file
        or file.tenant_id != pos.tenant_id
        or out.status != "approved"
        or not file_ready(file, out.file_version)
        or draft.product_id != pos.product_id
        or draft.purpose != pos.purpose
    ):
        raise HTTPException(409, "asset_not_deliverable")
    job = db.get(Execution, out.execution_id)
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
    item = db.get(Adoption, identifier)
    if not item:
        item = Adoption(position_id=identifier, output_id=data.version_id, token=new_id())
        db.add(item)
    elif item.output_id != data.version_id:
        item.output_id, item.token = data.version_id, new_id()
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
    item = db.get(Adoption, identifier)
    if item:
        db.delete(item)
        pos.status = "unfilled"
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
    return stream_private_file(deliverable(db, pos, item.output_id), request, identity, db, storage)
