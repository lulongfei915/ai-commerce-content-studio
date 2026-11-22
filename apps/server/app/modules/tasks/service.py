from collections.abc import Sequence
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.products.models import Product
from app.modules.products.service import product_views

from .models import DeliveryPosition, Task, TaskProduct
from .schemas import PositionResponse, TaskCreate, TaskResponse, TaskSummary, TaskUpdate

PURPOSE_LABELS = {"main": "主图", "detail": "详情素材", "video": "带货视频"}


def get_task(db: Session, tenant: str, task_id: str, *, lock: bool = False) -> Task:
    query = select(Task).where(Task.tenant_id == tenant, Task.id == task_id)
    task = db.scalar(query.with_for_update() if lock else query)
    if task is None:
        raise HTTPException(404, "task_not_found")
    return task


def summary(task: Task) -> TaskSummary:
    return TaskSummary(id=task.id, name=task.name, status=task.status, version=task.version)


def task_view(db: Session, task: Task) -> TaskResponse:
    members = list(
        db.scalars(
            select(Product)
            .join(TaskProduct, Product.id == TaskProduct.product_id)
            .where(
                TaskProduct.tenant_id == task.tenant_id,
                TaskProduct.task_id == task.id,
                Product.tenant_id == task.tenant_id,
            )
            .order_by(TaskProduct.sequence)
        )
    )
    positions = db.scalars(
        select(DeliveryPosition)
        .join(
            TaskProduct,
            (TaskProduct.task_id == DeliveryPosition.task_id)
            & (TaskProduct.product_id == DeliveryPosition.product_id)
            & (TaskProduct.tenant_id == DeliveryPosition.tenant_id),
        )
        .where(DeliveryPosition.tenant_id == task.tenant_id, DeliveryPosition.task_id == task.id)
        .order_by(TaskProduct.sequence, DeliveryPosition.purpose)
    )
    return TaskResponse(
        **summary(task).model_dump(),
        products=product_views(db, task.tenant_id, members),
        positions=[
            PositionResponse.model_validate(item, from_attributes=True) for item in positions
        ],
    )


def _products(db: Session, tenant: str, ids: list[str]) -> list[Product]:
    if len(ids) != len(set(ids)):
        raise HTTPException(422, "task_product_duplicate")
    by_id = {
        item.id: item
        for item in db.scalars(
            select(Product).where(
                Product.tenant_id == tenant,
                Product.id.in_(ids),
            )
        )
    }
    if any(identifier not in by_id for identifier in ids):
        raise HTTPException(404, "product_not_found")
    return [by_id[identifier] for identifier in ids]


def _add_members(
    db: Session, task: Task, products: list[Product], purposes: Sequence[str], start: int
) -> None:
    db.add_all(
        [
            TaskProduct(
                tenant_id=task.tenant_id, task_id=task.id, product_id=product.id, sequence=index
            )
            for index, product in enumerate(products, start=start)
        ]
    )
    db.flush()
    db.add_all(
        [
            DeliveryPosition(
                tenant_id=task.tenant_id, task_id=task.id, product_id=product.id, purpose=purpose
            )
            for product in products
            for purpose in purposes
        ]
    )
    db.flush()


def create_task(db: Session, tenant: str, user: str, data: TaskCreate) -> TaskResponse:
    products = _products(db, tenant, data.product_ids)
    purposes = list(dict.fromkeys(data.contents))
    product_name = products[0].name + (f"等 {len(products)} 件" if len(products) > 1 else "")
    content_name = "、".join(PURPOSE_LABELS[purpose] for purpose in purposes)
    today = datetime.now(timezone.utc).date().isoformat()
    task = Task(
        tenant_id=tenant,
        created_by=user,
        name=data.name or f"{product_name} · {content_name} · {today}",
    )
    db.add(task)
    db.flush()
    _add_members(db, task, products, purposes, 0)
    result = task_view(db, task)
    db.commit()
    return result


def _check_version(task: Task, expected: int) -> None:
    if task.version != expected:
        raise HTTPException(409, {"code": "version_conflict", "version": task.version})


def rename_task(db: Session, task: Task, data: TaskUpdate) -> TaskResponse:
    _check_version(task, data.expected_version)
    task.name = data.name
    task.version += 1
    result = task_view(db, task)
    db.commit()
    return result


def add_products(db: Session, task: Task, expected_version: int, ids: list[str]) -> TaskResponse:
    _check_version(task, expected_version)
    existing = set(
        db.scalars(
            select(TaskProduct.product_id)
            .where(
                TaskProduct.tenant_id == task.tenant_id,
                TaskProduct.task_id == task.id,
            )
            .with_for_update()
        )
    )
    if existing.intersection(ids):
        raise HTTPException(409, "task_product_exists")
    if len(existing) + len(ids) > 50:
        raise HTTPException(422, "task_product_limit")
    purposes = sorted(
        set(
            db.scalars(
                select(DeliveryPosition.purpose)
                .where(
                    DeliveryPosition.tenant_id == task.tenant_id,
                    DeliveryPosition.task_id == task.id,
                )
                .with_for_update()
            )
        )
    )
    _add_members(db, task, _products(db, task.tenant_id, ids), purposes, len(existing))
    task.version += 1
    result = task_view(db, task)
    db.commit()
    return result
