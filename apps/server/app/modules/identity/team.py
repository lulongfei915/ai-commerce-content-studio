from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update

from app.modules.products.models import Product
from app.modules.tasks.models import Task
from app.shared.studio_errors import check_version

from .domain import Permission, Role
from .models import CompanyRecord, LoginSession, Membership, Tenant, User
from .security import ActiveIdentity, Database, WriteIdentity, require_permission
from .service import Identity

router = APIRouter(prefix="/company", tags=["公司管理"])


class MemberView(BaseModel):
    id: str
    email: str
    role: Role
    active: bool
    download_allowed: bool
    version: int
    tasks: int


class MemberEdit(BaseModel):
    expected_version: int = Field(ge=1)
    role: Role
    download_allowed: bool


class Handover(BaseModel):
    expected_version: int = Field(ge=1)
    successor: str = Field(min_length=1, max_length=36)


class RecordView(BaseModel):
    id: str
    actor: str
    action: str
    detail: str
    created_at: datetime


def record(db: Database, identity: Identity, action: str, detail: str) -> None:
    db.add(
        CompanyRecord(
            tenant_id=identity.tenant.id, actor=identity.user.email, action=action, detail=detail
        )
    )


@router.get("/records")
def records(identity: ActiveIdentity, db: Database) -> list[RecordView]:
    require_permission(identity, Permission.MANAGE)
    rows = db.scalars(
        select(CompanyRecord)
        .where(CompanyRecord.tenant_id == identity.tenant.id)
        .order_by(CompanyRecord.created_at.desc(), CompanyRecord.id.desc())
        .limit(200)
    )
    return [RecordView.model_validate(row, from_attributes=True) for row in rows]


@router.get("/members")
def members(identity: ActiveIdentity, db: Database) -> list[MemberView]:
    require_permission(identity, Permission.MANAGE)
    tenant = identity.tenant.id
    counts = dict(
        db.execute(
            select(func.coalesce(Task.owner_id, Task.created_by), func.count())
            .where(Task.tenant_id == tenant)
            .group_by(func.coalesce(Task.owner_id, Task.created_by))
        ).all()
    )
    rows = db.execute(
        select(Membership, User)
        .join(User, Membership.user_id == User.id)
        .where(Membership.tenant_id == tenant)
        .order_by(User.email)
    )
    return [
        MemberView(
            id=m.user_id,
            email=u.email,
            role=Role(m.role),
            active=m.active and u.active,
            download_allowed=m.download_allowed,
            version=m.version,
            tasks=counts.get(m.user_id, 0),
        )
        for m, u in rows
    ]


def locked_member(db: Database, identity: Identity, user_id: str, expected: int) -> Membership:
    require_permission(identity, Permission.MANAGE)
    tenant = identity.tenant.id
    db.scalar(select(Tenant).where(Tenant.id == tenant).with_for_update())
    db.refresh(identity.member, with_for_update=True)
    if not identity.member.active:
        raise HTTPException(403, "member_inactive")
    require_permission(identity, Permission.MANAGE)
    member = db.get(Membership, (tenant, user_id), populate_existing=True, with_for_update=True)
    user = db.get(User, user_id)
    if not member or not user:
        raise HTTPException(404, "member_not_found")
    check_version(member.version, expected)
    if not member.active or not user.active:
        raise HTTPException(409, "member_inactive")
    return member


def protect_admin(db: Database, m: Membership) -> None:
    if m.role == "admin" and not db.scalar(
        select(Membership.user_id)
        .join(User, User.id == Membership.user_id)
        .where(
            Membership.tenant_id == m.tenant_id,
            Membership.user_id != m.user_id,
            Membership.active.is_(True),
            User.active.is_(True),
            Membership.role == "admin",
        )
        .with_for_update()
    ):
        raise HTTPException(409, "last_admin")


@router.patch("/members/{user_id}")
def edit(user_id: str, data: MemberEdit, identity: WriteIdentity, db: Database) -> bool:
    m = locked_member(db, identity, user_id, data.expected_version)
    if data.role != Role.ADMIN:
        protect_admin(db, m)
    m.role, m.download_allowed = data.role.value, data.download_allowed
    m.version += 1
    email = db.scalar(select(User.email).where(User.id == user_id))
    record(db, identity, "调整成员权限", f"{email} · {m.role}")
    db.commit()
    return True


@router.post("/members/{user_id}/disable", status_code=204)
def disable(user_id: str, data: Handover, identity: WriteIdentity, db: Database) -> None:
    m = locked_member(db, identity, user_id, data.expected_version)
    if user_id == identity.user.id:
        raise HTTPException(409, "member_self_disable")
    protect_admin(db, m)
    successor = db.get(Membership, (m.tenant_id, data.successor), with_for_update=True)
    recipient = db.get(User, data.successor)
    if (
        not successor
        or successor.user_id == user_id
        or not successor.active
        or not recipient
        or not recipient.active
        or successor.role not in {"admin", "designer"}
    ):
        raise HTTPException(409, "invalid_successor")
    for model in (Task, Product):
        db.execute(
            update(model)
            .where(
                model.tenant_id == m.tenant_id,
                func.coalesce(model.owner_id, model.created_by) == user_id,
            )
            .values(owner_id=successor.user_id)
        )
    m.active = False
    m.version += 1
    db.execute(
        delete(LoginSession).where(
            LoginSession.tenant_id == m.tenant_id, LoginSession.user_id == user_id
        )
    )
    email = db.scalar(select(User.email).where(User.id == user_id))
    record(db, identity, "停用并交接", f"{email} → {recipient.email}")
    db.commit()
