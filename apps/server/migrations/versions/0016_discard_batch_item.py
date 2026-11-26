"""Keep the cost history of removed batch drafts."""

import sqlalchemy as sa
from alembic import op

revision = "0016_discard_batch_item"
down_revision = "0015_batch_lists"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "creations", sa.Column("discarded", sa.Boolean(), nullable=False, server_default=sa.false())
    )


def downgrade() -> None:
    op.drop_column("creations", "discarded")
