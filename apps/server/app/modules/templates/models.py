from typing import Any

from sqlalchemy import JSON, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.modules.identity.models import new_id
from app.shared.db import Base


class Template(Base):
    __tablename__ = "company_templates"
    __table_args__ = (Index("ix_company_templates_tenant", "tenant_id", "id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"))
    draft: Mapped[dict[str, Any]] = mapped_column(JSON)
    enabled: Mapped[bool] = mapped_column(default=True)
    version: Mapped[int] = mapped_column(default=1)
    published_version: Mapped[int | None]


class TemplateVersion(Base):
    __tablename__ = "company_template_versions"

    template_id: Mapped[str] = mapped_column(ForeignKey("company_templates.id"), primary_key=True)
    number: Mapped[int] = mapped_column(primary_key=True)
    content: Mapped[dict[str, Any]] = mapped_column(JSON)
