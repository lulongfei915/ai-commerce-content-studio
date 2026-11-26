"""Allow independently configured positions in a delivery plan."""

import sqlalchemy as sa
from alembic import op

revision = "0013_delivery_plan"
down_revision = "0012_company_team"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_delivery_member", "delivery_positions", ["tenant_id", "task_id", "product_id"]
    )
    with op.batch_alter_table("delivery_positions") as batch:
        batch.add_column(sa.Column("module", sa.String(40), nullable=False, server_default=""))
        batch.add_column(sa.Column("sequence", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("ratio", sa.String(12)))
        batch.add_column(sa.Column("resolution", sa.String(12)))
        batch.add_column(sa.Column("duration", sa.Integer()))
        batch.drop_constraint("uq_delivery_positions_scope", type_="unique")
        batch.create_unique_constraint(
            "uq_delivery_slot", ["task_id", "product_id", "purpose", "module", "sequence"]
        )


def downgrade() -> None:
    with op.batch_alter_table("delivery_positions") as batch:
        batch.drop_constraint("uq_delivery_slot", type_="unique")
        batch.create_unique_constraint(
            "uq_delivery_positions_scope", ["tenant_id", "task_id", "product_id", "purpose"]
        )
        for col in ("module", "sequence", "ratio", "resolution", "duration"):
            batch.drop_column(col)
    op.drop_index("ix_delivery_member", table_name="delivery_positions")
