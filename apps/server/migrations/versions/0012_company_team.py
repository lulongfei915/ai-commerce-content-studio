"""Separate current ownership from immutable authorship and record company actions."""

import sqlalchemy as sa
from alembic import op

revision = "0012_company_team"
down_revision = "0011_gpt_image_results"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("products", "tasks"):
        op.add_column(table, sa.Column("owner_id", sa.String(36), nullable=True))
    op.create_table(
        "company_records",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("actor", sa.String(254), nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("detail", sa.String(600), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_company_records_tenant_id", "company_records", ["tenant_id"])


def downgrade() -> None:
    op.drop_table("company_records")
    for table in ("products", "tasks"):
        op.drop_column(table, "owner_id")
