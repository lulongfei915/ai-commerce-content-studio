from typing import Any

from sqlalchemy import JSON, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.modules.identity.models import new_id
from app.shared.db import Base


class ModelCall(Base):
    __tablename__ = "studio_model_calls"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    creation_id: Mapped[str] = mapped_column(ForeignKey("creations.id"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(String(24))
    source_version: Mapped[int]
    original: Mapped[str] = mapped_column(Text)
    suggestion: Mapped[str | None] = mapped_column(Text)
    applied_version: Mapped[int | None]
    status: Mapped[str] = mapped_column(String(24), default="pending")
    reserved_cents: Mapped[int]
    provider_id: Mapped[str | None] = mapped_column(String(200))
    evidence: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
