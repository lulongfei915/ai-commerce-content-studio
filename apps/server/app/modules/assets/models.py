from datetime import datetime

from sqlalchemy import DateTime, ForeignKeyConstraint, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.modules.identity.models import new_id
from app.shared.db import Base


class PrivateFile(Base):
    __tablename__ = "private_files"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "created_by"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        Index("ix_private_files_tenant_id", "tenant_id", "id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(36))
    created_by: Mapped[str] = mapped_column(String(36))
    filename: Mapped[str] = mapped_column(String(240))
    content_type: Mapped[str] = mapped_column(String(32))
    size_bytes: Mapped[int]
    status: Mapped[str] = mapped_column(String(16), default="pending")
    version: Mapped[int] = mapped_column(default=1)
    expires_at: Mapped[datetime] = mapped_column(DateTime())
    object_key: Mapped[str | None] = mapped_column(String(150), unique=True)
    width: Mapped[int | None]
    height: Mapped[int | None]
    duration_seconds: Mapped[float | None]
