from typing import Any

from sqlalchemy import JSON, ForeignKeyConstraint, String
from sqlalchemy.orm import Mapped, mapped_column

from app.shared.db import Base


class CanvasLayout(Base):
    __tablename__ = "canvas_layouts"
    __table_args__ = (
        ForeignKeyConstraint(["tenant_id", "task_id"], ["tasks.tenant_id", "tasks.id"]),
    )

    tenant_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    task_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    positions: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    version: Mapped[int]


class CanvasViewport(Base):
    __tablename__ = "canvas_viewports"
    __table_args__ = (
        ForeignKeyConstraint(["tenant_id", "task_id"], ["tasks.tenant_id", "tasks.id"]),
        ForeignKeyConstraint(
            ["tenant_id", "user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
    )

    tenant_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    task_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    x: Mapped[float]
    y: Mapped[float]
    zoom: Mapped[float]
    version: Mapped[int]
