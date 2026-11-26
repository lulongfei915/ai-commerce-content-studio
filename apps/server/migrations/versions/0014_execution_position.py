"""Persist the delivery position reserved by an execution."""

import sqlalchemy as sa
from alembic import op

revision = "0014_execution_position"
down_revision = "0013_delivery_plan"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("image_executions") as batch:
        batch.add_column(sa.Column("position_id", sa.String(36), nullable=True))
        batch.create_index("ix_image_executions_position_id", ["position_id"])
        batch.create_foreign_key(
            "fk_execution_position", "delivery_positions", ["position_id"], ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("image_executions") as batch:
        batch.drop_constraint("fk_execution_position", type_="foreignkey")
        batch.drop_index("ix_image_executions_position_id")
        batch.drop_column("position_id")
