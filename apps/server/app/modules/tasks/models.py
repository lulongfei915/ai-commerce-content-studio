from datetime import datetime

from sqlalchemy import DateTime, ForeignKeyConstraint, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.modules.identity.models import new_id
from app.shared.db import Base


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "created_by"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        UniqueConstraint("tenant_id", "id", name="uq_tasks_tenant_id"),
        Index("ix_tasks_tenant_updated", "tenant_id", "updated_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(36))
    created_by: Mapped[str] = mapped_column(String(36))
    name: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(24), default="draft")
    version: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(), default=datetime.utcnow, onupdate=datetime.utcnow
    )


class TaskProduct(Base):
    __tablename__ = "task_products"
    __table_args__ = (
        UniqueConstraint("tenant_id", "task_id", "product_id", name="uq_task_products_membership"),
        ForeignKeyConstraint(["tenant_id", "task_id"], ["tasks.tenant_id", "tasks.id"]),
        ForeignKeyConstraint(["tenant_id", "product_id"], ["products.tenant_id", "products.id"]),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(36))
    task_id: Mapped[str] = mapped_column(String(36))
    product_id: Mapped[str] = mapped_column(String(36))
    sequence: Mapped[int]


class DeliveryPosition(Base):
    __tablename__ = "delivery_positions"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "task_id", "product_id", "purpose", name="uq_delivery_positions_scope"
        ),
        ForeignKeyConstraint(
            ["tenant_id", "task_id", "product_id"],
            ["task_products.tenant_id", "task_products.task_id", "task_products.product_id"],
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(36))
    task_id: Mapped[str] = mapped_column(String(36))
    product_id: Mapped[str] = mapped_column(String(36))
    purpose: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(24), default="unfilled")
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=datetime.utcnow)
