"""Persist shared batch configuration and atomic submission receipts."""

import sqlalchemy as sa
from alembic import op

revision = "0015_batch_lists"
down_revision = "0014_execution_position"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("creations", sa.Column("batch_position_id", sa.String(36)))
    op.add_column("creations", sa.Column("batch_overrides", sa.JSON()))
    op.create_table(
        "batch_configs",
        sa.Column("task_id", sa.String(36), sa.ForeignKey("tasks.id"), primary_key=True),
        sa.Column("media", sa.String(5), primary_key=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("values", sa.JSON(), nullable=False),
    )
    op.create_table(
        "batch_requests",
        sa.Column("task_id", sa.String(36), sa.ForeignKey("tasks.id"), primary_key=True),
        sa.Column("key", sa.String(100), primary_key=True),
        sa.Column("items", sa.JSON(), nullable=False),
        sa.Column("executions", sa.JSON(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("batch_requests")
    op.drop_table("batch_configs")
    op.drop_column("creations", "batch_overrides")
    op.drop_column("creations", "batch_position_id")
