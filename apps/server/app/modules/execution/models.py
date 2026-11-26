from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.modules.identity.models import new_id
from app.shared.db import Base


class Execution(Base):
    __tablename__ = "image_executions"
    __table_args__ = (UniqueConstraint("tenant_id", "request_key"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"))
    creation_id: Mapped[str] = mapped_column(ForeignKey("creations.id"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    request_key: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON)
    parent_output: Mapped[str | None] = mapped_column(ForeignKey("creation_outputs.id"))
    position_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("delivery_positions.id", ondelete="SET NULL"), index=True
    )


class ImageStep(Base):
    __tablename__ = "image_steps"

    output_id: Mapped[str] = mapped_column(ForeignKey("creation_outputs.id"), primary_key=True)
    execution_id: Mapped[str] = mapped_column(ForeignKey("image_executions.id"), index=True)
    reserved_cents: Mapped[int]
    actual_cents: Mapped[int | None]
    fee_state: Mapped[str] = mapped_column(String(20), default="reserved")
    provider_id: Mapped[str | None] = mapped_column(String(200))
    result_url: Mapped[str | None] = mapped_column(Text)
    result_object_key: Mapped[str | None] = mapped_column(String(256))
    result_size: Mapped[str | None] = mapped_column(String(24))
    lease: Mapped[datetime | None]
    error: Mapped[str | None] = mapped_column(String(80))
    quality: Mapped[dict[str, Any] | None] = mapped_column(JSON(none_as_null=True))
    decision: Mapped[dict[str, Any] | None] = mapped_column(JSON(none_as_null=True))
    reconciliation: Mapped[dict[str, Any] | None] = mapped_column(JSON(none_as_null=True))
