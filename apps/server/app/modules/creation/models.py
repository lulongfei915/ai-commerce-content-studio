from typing import Any

from sqlalchemy import JSON, ForeignKey, ForeignKeyConstraint, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.modules.identity.models import new_id
from app.shared.db import Base


class Creation(Base):
    __tablename__ = "creations"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "task_id", "product_id"],
            ["task_products.tenant_id", "task_products.task_id", "task_products.product_id"],
        ),
        ForeignKeyConstraint(
            ["template_id", "template_version"],
            ["company_template_versions.template_id", "company_template_versions.number"],
        ),
        UniqueConstraint(
            "tenant_id", "task_id", "product_id", "purpose", "slot", name="uq_creation_slot"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(36))
    task_id: Mapped[str] = mapped_column(String(36))
    product_id: Mapped[str] = mapped_column(String(36))
    purpose: Mapped[str] = mapped_column(String(16))
    slot: Mapped[str] = mapped_column(String(36))
    entry: Mapped[str | None] = mapped_column(String(12))
    prompt: Mapped[str] = mapped_column(Text)
    parameters: Mapped[dict[str, Any]] = mapped_column(JSON)
    video_parameters: Mapped[dict[str, Any] | None] = mapped_column(JSON(none_as_null=True))
    references: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    template_id: Mapped[str | None] = mapped_column(String(36))
    template_version: Mapped[int | None]
    version: Mapped[int] = mapped_column(default=1)


class CreationOutput(Base):
    """Versioned output written by the execution and review services."""

    __tablename__ = "creation_outputs"
    __table_args__ = (UniqueConstraint("creation_id", "execution_id", "output_index", "version"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    creation_id: Mapped[str] = mapped_column(String(36), ForeignKey("creations.id"))
    execution_id: Mapped[str] = mapped_column(String(36))
    output_index: Mapped[int]
    version: Mapped[int]
    status: Mapped[str] = mapped_column(String(24))
    file_id: Mapped[str | None] = mapped_column(String(36))
    file_version: Mapped[int | None]
