from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import or_, select

from app.modules.identity.domain import Permission
from app.modules.identity.security import (
    ActiveIdentity,
    Database,
    WriteIdentity,
    require_permission,
)
from app.modules.products.models import Product

from .models import Task, TaskProduct
from .schemas import TaskCreate, TaskList, TaskProductAdd, TaskResponse, TaskUpdate
from .service import add_products, create_task, get_task, rename_task, summary, task_view

router = APIRouter(prefix="/tasks", tags=["任务"])


@router.get("", operation_id="listTasks")
def list_tasks(
    identity: ActiveIdentity,
    db: Database,
    q: Annotated[str, Query(max_length=100)] = "",
    cursor: Annotated[str | None, Query(max_length=36)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> TaskList:
    require_permission(identity, Permission.VIEW)
    tenant = identity.tenant.id
    query = select(Task).where(Task.tenant_id == tenant)
    if q.strip():
        term = q.strip()
        products = (
            select(TaskProduct.task_id)
            .join(Product, TaskProduct.product_id == Product.id)
            .where(
                TaskProduct.tenant_id == tenant,
                Product.tenant_id == tenant,
                or_(
                    Product.name.contains(term, autoescape=True),
                    Product.sku.icontains(term, autoescape=True),
                ),
            )
        )
        query = query.where(or_(Task.name.contains(term, autoescape=True), Task.id.in_(products)))
    if cursor:
        query = query.where(Task.id > cursor)
    page = list(db.scalars(query.order_by(Task.id).limit(limit + 1)))
    return TaskList(
        items=[summary(item) for item in page[:limit]],
        next_cursor=page[limit - 1].id if len(page) > limit else None,
    )


@router.post("", status_code=201, operation_id="createTask")
def create(data: TaskCreate, identity: WriteIdentity, db: Database) -> TaskResponse:
    require_permission(identity, Permission.CREATE)
    return create_task(db, identity.tenant.id, identity.user.id, data)


@router.get("/{task_id}", operation_id="getTask")
def get(task_id: str, identity: ActiveIdentity, db: Database) -> TaskResponse:
    require_permission(identity, Permission.VIEW)
    return task_view(db, get_task(db, identity.tenant.id, task_id))


@router.patch("/{task_id}", operation_id="updateTask")
def update(task_id: str, data: TaskUpdate, identity: WriteIdentity, db: Database) -> TaskResponse:
    require_permission(identity, Permission.CREATE)
    return rename_task(db, get_task(db, identity.tenant.id, task_id, lock=True), data)


@router.post("/{task_id}/products", operation_id="addTaskProducts")
def add(task_id: str, data: TaskProductAdd, identity: WriteIdentity, db: Database) -> TaskResponse:
    require_permission(identity, Permission.CREATE)
    return add_products(
        db,
        get_task(db, identity.tenant.id, task_id, lock=True),
        data.expected_version,
        data.product_ids,
    )
