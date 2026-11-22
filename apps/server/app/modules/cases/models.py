from sqlalchemy import JSON, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.modules.identity.models import new_id
from app.shared.db import Base


class Case(Base):
    __tablename__ = "creative_cases"
    __table_args__ = (Index("ix_creative_cases_catalog", "tenant_id", "category", "media", "id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"))
    name: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(24))
    media: Mapped[str] = mapped_column(String(10))
    file_id: Mapped[str] = mapped_column(ForeignKey("private_files.id"))
    file_version: Mapped[int]
    source: Mapped[str] = mapped_column(String(300))
    usage_scope: Mapped[str | None] = mapped_column(String(300))
    usage_purposes: Mapped[list[str]] = mapped_column(JSON)
    version: Mapped[int] = mapped_column(default=1)
