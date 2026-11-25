from datetime import datetime

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.modules.identity.models import new_id
from app.shared.db import Base

from .schemas import Category


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="uq_products_tenant_id"),
        UniqueConstraint("tenant_id", "sku", name="uq_products_tenant_sku"),
        ForeignKeyConstraint(
            ["tenant_id", "created_by"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        Index("ix_products_tenant_name", "tenant_id", "name"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(36))
    created_by: Mapped[str] = mapped_column(String(36))
    owner_id: Mapped[str | None] = mapped_column(String(36))
    sku: Mapped[str] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(160))
    category: Mapped[Category] = mapped_column(String(40))
    version: Mapped[int] = mapped_column(default=1)
    fact_version: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=datetime.utcnow)


class ProductFact(Base):
    __tablename__ = "product_facts"
    __table_args__ = (
        UniqueConstraint("tenant_id", "product_id", "version", name="uq_product_facts_version"),
        ForeignKeyConstraint(
            ["tenant_id", "created_by"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        ForeignKeyConstraint(["tenant_id", "product_id"], ["products.tenant_id", "products.id"]),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column(String(36))
    product_id: Mapped[str] = mapped_column(String(36))
    version: Mapped[int]
    facts: Mapped[dict[str, dict[str, str]]] = mapped_column(JSON)
    photos: Mapped[list[dict[str, str | int]]] = mapped_column(JSON)
    created_by: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=datetime.utcnow)


class ProductPhotoBinding(Base):
    __tablename__ = "product_photo_bindings"
    __table_args__ = (
        ForeignKeyConstraint(["tenant_id", "product_id"], ["products.tenant_id", "products.id"]),
    )

    file_id: Mapped[str] = mapped_column(ForeignKey("private_files.id"), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(36))
    product_id: Mapped[str] = mapped_column(String(36))
